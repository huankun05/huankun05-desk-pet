// MCP Adapter — 将 MCP server 的工具发现和调用适配到 ToolRegistry
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CreateMessageRequestSchema,
  type CreateMessageRequest,
  type CreateMessageResult,
  type SamplingMessage,
} from "@modelcontextprotocol/sdk/types.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolDefinition, toolRegistry, type ToolEffectKind } from "./tools/registry/tool-registry";
import { createLlmClient, type LlmClient } from "../services/llm/llm-client";
import { loadModelSettings, type ModelSettings } from "../settings/model-settings";

const LOG_PREFIX = "[MCP Adapter]";

/** sampling/createMessage 单次调用的 LLM 超时（毫秒）。 */
const MCP_SAMPLING_TIMEOUT_MS = 60_000;

/**
 * MCP sampling 配置（挂在 McpServerConfig.sampling 上）。
 * MCP 协议允许 server 反向请求 client 用本机 LLM 生成文本（sampling/createMessage），
 * 常见场景：server 内部做工具结果归纳、记忆压缩、文本润色。
 */
export interface McpSamplingConfig {
  /** 总开关（默认 false：不注册 sampling handler，server 请求会收到错误响应） */
  enabled?: boolean;
  /** 覆盖采样使用的模型（默认跟随当前活动模型） */
  model?: string;
  /** 覆盖最大输出 token（默认跟随厂商默认） */
  maxTokens?: number;
}

export interface McpServerConfig {
  id: string;              // 唯一标识
  name: string;            // 展示名
  transport: "stdio" | "sse" | "http";
  command?: string;         // stdio 必填，sse/http 不用
  args?: string[];         // 命令行参数
  env?: Record<string, string>;
  cwd?: string;
  url?: string;            // sse/http 必填，stdio 不用
  /** http transport 请求头（如 Authorization: Bearer xxx），直接透传给 Streamable HTTP */
  headers?: Record<string, string>;
  /** 按 toolName 显式覆盖 effectKind（serverId + toolName 作为 key） */
  effectKindOverrides?: Record<string, ToolEffectKind>;
  /** 允许该 server 通过 sampling/createMessage 请求本机 LLM（默认关闭） */
  sampling?: McpSamplingConfig;
}

/** MCP Tool annotations（MCP 协议 2025-03-26 版） */
interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  [key: string]: unknown;
}

interface McpServerState {
  config: McpServerConfig;
  client: Client;
  transport: Transport;
  connected: boolean;
  toolIds: string[];       // 已注册到 ToolRegistry 的工具 ID 列表
}

/**
 * 从 MCP Tool annotations 推导 effectKind。
 *
 * 优先级（保守策略）：
 * 1. 本地显式 override（最高优先级）
 * 2. destructiveHint=true → external_side_effect（第三方 annotations 矛盾时采用保守策略）
 * 3. readOnlyHint=true → read
 * 4. 无匹配 → unknown（会被 ExecutionPolicyGuard 拒绝）
 *
 * 注意：destructiveHint=false 不等于 readOnlyHint=true。
 * 第三方 annotations 同时设置 readOnlyHint + destructiveHint 时，destructive 优先（不放行）。
 */
function resolveMcpEffectKind(
  annotations: McpToolAnnotations | undefined,
  overrides: Record<string, ToolEffectKind> | undefined,
  toolName: string,
): ToolEffectKind {
  // 优先级 1：本地显式 override
  if (overrides && overrides[toolName]) {
    return overrides[toolName];
  }
  if (!annotations) return "unknown";
  // 优先级 2：destructiveHint=true（保守策略，不放行）
  if (annotations.destructiveHint === true) return "external_side_effect";
  // 优先级 3：readOnlyHint=true
  if (annotations.readOnlyHint === true) return "read";
  // 优先级 4：无匹配 → unknown
  return "unknown";
}

/**
 * 连接一个 MCP server，发现其工具并注册到 ToolRegistry。
 * 返回注册的工具 ID 列表。
 */
export async function connectMcpServer(config: McpServerConfig): Promise<string[]> {
  console.log(LOG_PREFIX, "连接 MCP server:", config.name, "(" + config.id + ")");

  let transport: Transport;
  if (config.transport === "sse") {
    if (!config.url) {
      throw new Error("sse transport requires url");
    }
    transport = new SSEClientTransport(new URL(config.url));
  } else if (config.transport === "http") {
    if (!config.url) {
      throw new Error("http transport requires url");
    }
    // Streamable HTTP（MCP 规范 2025-06-18）：POST 发消息 + GET SSE 收消息。
    // headers 直接透传（如 Authorization），供需要鉴权的远端 server 使用。
    transport = new StreamableHTTPClientTransport(new URL(config.url), {
      ...(config.headers ? { requestInit: { headers: config.headers } } : {}),
    });
  } else {
    if (!config.command) {
      throw new Error("stdio transport requires command");
    }
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
    });
  }

  // 监听 transport 错误
  transport.onerror = (err: Error) => {
    console.error(LOG_PREFIX, "transport 错误 [" + config.name + "]:", err.message);
  };

  const samplingEnabled = config.sampling?.enabled === true;
  const client = new Client(
    { name: "cyrene", version: "0.8.0" },
    // 仅在注册了 sampling handler 时声明 sampling 能力，避免"声而不实"误导 server
    { capabilities: samplingEnabled ? { sampling: {} } : {} },
  );

  // MCP sampling：server 可反向请求本机 LLM 生成文本（工具结果归纳、记忆压缩等）。
  // 用当前活动模型非流式生成，失败时抛错 → SDK 转成 JSON-RPC error 响应给 server。
  if (samplingEnabled) {
    client.setRequestHandler(CreateMessageRequestSchema, createMcpSamplingHandler(config));
    console.log(LOG_PREFIX, "sampling 已启用 [" + config.name + "]");
  }

  try {
    await client.connect(transport);
    console.log(LOG_PREFIX, "已连接到", config.name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, "连接失败 [" + config.name + "]:", msg);
    // 连接失败时清理 transport
    try { await transport.close(); } catch (_) { /* ignore */ }
    throw err;
  }

  // 发现工具
  let mcpTools: Array<{
    name: string;
    description?: string;
    annotations?: McpToolAnnotations;
    inputSchema: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  }> = [];

  try {
    const result = await client.listTools();
    mcpTools = result.tools as Array<{
      name: string;
      description?: string;
      annotations?: McpToolAnnotations;
      inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
      };
    }>;
    console.log(LOG_PREFIX, "发现 " + mcpTools.length + " 个工具:", mcpTools.map(t => t.name).join(", "));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, "listTools 失败 [" + config.name + "]:", msg);
    await client.close();
    throw err;
  }

  // 注册到 ToolRegistry
  const registeredIds: string[] = [];
  for (const mt of mcpTools) {
    // 用短横线拼接，不用冒号——Kimi 等厂商 function.name 正则不允许冒号
    // （Kimi: ^[a-zA-Z_][a-zA-Z0-9-_]$）。短横线所有厂商都接受。
    const toolId = config.id + "-" + mt.name;

    // 如果已存在同名工具，跳过
    if (toolRegistry.getById(toolId)) {
      console.warn(LOG_PREFIX, "工具已存在，跳过:", toolId);
      continue;
    }

    // 从 annotations 或 override 解析 effectKind
    const resolvedEffectKind = resolveMcpEffectKind(mt.annotations, config.effectKindOverrides, mt.name);
    if (resolvedEffectKind === "unknown") {
      console.warn(LOG_PREFIX, `工具 ${toolId} 的 effectKind 为 unknown（无 annotations 且无 override），将被 ExecutionPolicyGuard 拒绝`);
    }

    const toolDef: ToolDefinition = {
      id: toolId,
      name: "[" + config.name + "] " + mt.name,
      description: mt.description || mt.name,
      enabled: true,
      effectKind: resolvedEffectKind,
      inputSchema: {
        type: "object",
        properties: mt.inputSchema?.properties as Record<string, { type: string; description: string }> || {},
        required: mt.inputSchema?.required,
      },
      // TODO: 未来若 MCP 工具需要 ToolContext，在此将 ctx 映射为 MCP 协议 arguments 的隐藏字段。
      // 当前 MCP 工具 execute 签名不带 ctx，按需接入时改签名为 (args, ctx?) 并在这里处理。
      execute: async (args: Record<string, unknown>) => {
        console.log(LOG_PREFIX, "调用工具:", toolId, JSON.stringify(args));
        try {
          const result = await client.callTool({
            name: mt.name,
            arguments: args,
          });
          // 提取文本内容
          const texts: string[] = [];
          if (result.content && Array.isArray(result.content)) {
            for (const block of result.content) {
              if (block && typeof block === "object" && (block as { type: string }).type === "text") {
                texts.push(String((block as { text: string }).text));
              }
            }
          }
          const output = texts.join("\n") || JSON.stringify(result.content);
          if (result.isError === true) {
            throw new Error(`E_MCP_TOOL_FAILED${output ? `: ${output}` : ""}`);
          }
          console.log(LOG_PREFIX, "工具返回 [" + toolId + "]:", output.slice(0, 200));
          return output;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(LOG_PREFIX, "工具调用失败 [" + toolId + "]:", msg);
          if (msg.startsWith("E_MCP_TOOL_FAILED")) throw err;
          throw new Error(`E_MCP_TOOL_FAILED: ${msg}`);
        }
      },
    };

    toolRegistry.register(toolDef);
    registeredIds.push(toolId);
    console.log(LOG_PREFIX, "已注册工具:", toolId);
  }

  // 保存状态
  const state: McpServerState = {
    config,
    client,
    transport,
    connected: true,
    toolIds: registeredIds,
  };
  mcpServerStates.set(config.id, state);

  console.log(LOG_PREFIX, "MCP server 就绪:", config.name, "(" + registeredIds.length + " 个工具)");
  return registeredIds;
}

/**
 * 断开并清理一个 MCP server 及其注册的工具。
 */
export async function disconnectMcpServer(serverId: string): Promise<boolean> {
  console.log(LOG_PREFIX, "断开 MCP server:", serverId);
  const state = mcpServerStates.get(serverId);
  if (!state) {
    console.warn(LOG_PREFIX, "未找到 MCP server:", serverId);
    return false;
  }

  // 从 ToolRegistry 移除工具
  for (const toolId of state.toolIds) {
    toolRegistry.unregister(toolId);
    console.log(LOG_PREFIX, "已移除工具:", toolId);
  }

  try {
    await state.client.close();
    console.log(LOG_PREFIX, "已断开:", serverId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, "client.close 失败 [" + serverId + "]:", msg);
    // 即使 client.close 失败，也尝试关闭 transport
    try { await state.transport.close(); } catch (_) { /* ignore */ }
  }

  state.connected = false;
  mcpServerStates.delete(serverId);
  return true;
}

/**
 * 获取所有已连接的 MCP server 状态。
 */
export function getMcpServerStates(): Array<{
  id: string;
  name: string;
  connected: boolean;
  toolCount: number;
  toolIds: string[];
}> {
  return Array.from(mcpServerStates.values()).map(s => ({
    id: s.config.id,
    name: s.config.name,
    connected: s.connected,
    toolCount: s.toolIds.length,
    toolIds: [...s.toolIds],
  }));
}

// ── MCP sampling（server → client 反向 LLM 请求） ────────────────
// 协议：server 发 sampling/createMessage，client 用本机 LLM 生成文本返回。
// 复用 llm-client 的非流式调用，避免在 adapter 里重复 HTTP/解析逻辑。

/** sampling 处理器依赖（可注入，便于测试与定制）。 */
export interface McpSamplingDeps {
  /** 非流式 LLM 调用（默认 createLlmClient().chatNonStream） */
  chatNonStream?: LlmClient["chatNonStream"];
  /** 读取当前活动模型设置（默认 loadModelSettings） */
  loadSettings?: () => ModelSettings;
}

/**
 * 构建 MCP sampling/createMessage 请求处理器。
 *
 * 把请求里的 SamplingMessage 映射为厂商对话消息（仅文本块，image/audio 跳过），
 * systemPrompt 前置为 system 消息，用当前活动模型（或 config.sampling.model 覆盖）
 * 非流式生成一段文本返回给 server。
 */
export function createMcpSamplingHandler(
  config: McpServerConfig,
  deps: McpSamplingDeps = {},
): (request: CreateMessageRequest) => Promise<CreateMessageResult> {
  const chatNonStream = deps.chatNonStream ?? createLlmClient().chatNonStream;
  const loadSettings = deps.loadSettings ?? loadModelSettings;

  return async (request): Promise<CreateMessageResult> => {
    const params = request.params;
    const messages = toVendorMessages(params.messages);
    if (params.systemPrompt) {
      messages.unshift({ role: "system", content: params.systemPrompt });
    }

    const settings = loadSettings();
    const effectiveModel = config.sampling?.model ?? settings.model;
    const result = await chatNonStream(
      { ...settings, model: effectiveModel },
      messages,
      params.temperature,
      MCP_SAMPLING_TIMEOUT_MS,
      `MCP sampling [${config.name}]`,
      undefined,
      { maxTokens: config.sampling?.maxTokens ?? params.maxTokens },
    );
    console.log(LOG_PREFIX, `sampling 完成 [${config.name}] resultLen=${result.text.length}`);
    return {
      role: "assistant",
      content: { type: "text", text: result.text },
      model: effectiveModel,
    };
  };
}

/**
 * 把 MCP SamplingMessage 列表映射为厂商 ChatMessage 列表。
 * 仅取 text 内容块（image/audio 块跳过并记日志——厂商消息体是纯文本）。
 */
export function toVendorMessages(
  samplingMessages: SamplingMessage[],
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  return samplingMessages.map((m) => {
    const blocks = Array.isArray(m.content) ? m.content : [m.content];
    const texts: string[] = [];
    let skipped = 0;
    for (const block of blocks) {
      if (block && block.type === "text") {
        texts.push(block.text);
      } else {
        skipped++;
      }
    }
    if (skipped > 0) {
      console.warn(LOG_PREFIX, `sampling 跳过 ${skipped} 个非文本内容块（image/audio 暂不支持）`);
    }
    return { role: m.role, content: texts.join("\n") };
  });
}

// 内部状态存储
const mcpServerStates = new Map<string, McpServerState>();



