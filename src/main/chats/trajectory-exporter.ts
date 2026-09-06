/**
 * Trajectory 导出模块
 *
 * 将聊天会话导出为结构化 JSONL 格式，用于模型训练、效果评测和问题复现。
 *
 * 设计原则：
 * - 纯函数转换 + 文件写入分离，易于测试
 * - 敏感信息脱敏（API Key、Token 等）
 * - 支持按会话/时间范围/模式筛选
 * - 完全可逆：移除本模块不影响聊天存储
 *
 * 导出格式（JSONL，每行一个 turn）：
 * {
 *   "session_id": "...",
 *   "session_title": "...",
 *   "session_mode": "chat|work|code|learn",
 *   "turn_index": 0,
 *   "role": "user|assistant|system|tool",
 *   "content": "...",
 *   "reasoning": "...",          // assistant 推理过程（如有）
 *   "tool_calls": [...],         // 工具调用（如有）
 *   "tool_results": [...],       // 工具结果（如有）
 *   "timestamp": 1234567890000,
 *   "token_usage": { input, output, total }  // 如有
 * }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ChatMessage, ChatSession, ChatSessionMeta, ConversationMode } from "../../shared/chat-types";
import type { ToolExecutionRecord } from "../../shared/chat-types";
import { redactSensitiveText } from "../orchestrator/security/message-redactor";
import {
  compressTrajectories,
  defaultCompressionConfig,
  aggregateMetricsToDict,
  type CompressionConfig,
  type SummarizeFn,
} from "./trajectory-compressor";

export interface TrajectoryTurn {
  session_id: string;
  session_title: string;
  session_mode: ConversationMode;
  turn_index: number;
  role: string;
  content: string;
  reasoning?: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  tool_results?: Array<{
    tool_call_id: string;
    content: string;
    is_error: boolean;
  }>;
  timestamp: number;
  token_usage?: {
    input: number;
    output: number;
    total: number;
  };
}

export interface ExportOptions {
  /** 只导出指定会话；不传则导出所有会话 */
  sessionId?: string;
  /** 只导出指定模式的会话 */
  mode?: ConversationMode;
  /** 只导出此时间之后的消息（epoch ms） */
  since?: number;
  /** 只导出此时间之前的消息（epoch ms） */
  until?: number;
  /** 是否脱敏敏感信息（默认 true） */
  sanitize?: boolean;
  /** 输出文件路径；不传则返回记录数组 */
  outputPath?: string;
}

export interface ExportResult {
  /** 导出的 turn 总数 */
  turnCount: number;
  /** 导出的会话数 */
  sessionCount: number;
  /** 输出文件路径（如有） */
  outputPath?: string;
  /** 导出的记录（仅当未指定 outputPath 时返回完整数据） */
  turns?: TrajectoryTurn[];
}

/**
 * 敏感信息脱敏：替换 API Key、Token、密码等。
 *
 * 增强版：使用 message-redactor 模块的 redactSensitiveText，
 * 支持 30+ API key 前缀 + 15 种脱敏模式（ENV 赋值、JSON 字段、
 * Authorization header、私钥块、数据库连接串、JWT、URL 查询参数、
 * 手机号等）。
 *
 * 保留函数名保持接口兼容。
 */
export function sanitizeText(text: string): string {
  if (!text) return text;
  return redactSensitiveText(text);
}

/**
 * 从 ChatMessage 提取工具调用和结果。
 */
function extractToolExecutions(message: ChatMessage): {
  tool_calls?: TrajectoryTurn["tool_calls"];
  tool_results?: TrajectoryTurn["tool_results"];
} {
  if (!message.toolExecutions || message.toolExecutions.length === 0) return {};
  const tool_calls: NonNullable<TrajectoryTurn["tool_calls"]> = [];
  const tool_results: NonNullable<TrajectoryTurn["tool_results"]> = [];
  for (const exec of message.toolExecutions) {
    if (exec.name) {
      tool_calls.push({
        id: exec.id || `${exec.name}-${Date.now()}`,
        name: exec.name,
        arguments: exec.argsText ?? "",
      });
    }
    if (exec.result !== undefined || exec.status === "error") {
      tool_results.push({
        tool_call_id: exec.id || "",
        content: exec.status === "error" ? "error" : (exec.result ?? ""),
        is_error: exec.status === "error",
      });
    }
  }
  return {
    tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
    tool_results: tool_results.length > 0 ? tool_results : undefined,
  };
}

/**
 * 从 ChatMessage 提取 token 用量。
 */
function extractTokenUsage(message: ChatMessage): TrajectoryTurn["token_usage"] {
  const usage = message.contextUsage;
  if (!usage) return undefined;
  const input = usage.categories?.find((c) => c.key === "conversation")?.tokens ?? 0;
  const total = usage.totalTokens ?? 0;
  return {
    input,
    output: Math.max(0, total - input),
    total,
  };
}

/**
 * 将单个 ChatMessage 转换为 TrajectoryTurn。
 */
export function messageToTrajectoryTurn(
  message: ChatMessage,
  session: ChatSession,
  turnIndex: number,
  sanitize = true,
): TrajectoryTurn {
  const content = sanitize ? sanitizeText(message.content) : message.content;
  const reasoning = message.reasoning && sanitize ? sanitizeText(message.reasoning) : message.reasoning;
  const { tool_calls, tool_results } = extractToolExecutions(message);
  const token_usage = extractTokenUsage(message);

  return {
    session_id: session.id,
    session_title: session.title,
    session_mode: session.mode ?? "chat",
    turn_index: turnIndex,
    role: message.role,
    content,
    ...(reasoning ? { reasoning } : {}),
    ...(tool_calls ? { tool_calls } : {}),
    ...(tool_results ? { tool_results } : {}),
    timestamp: message.at,
    ...(token_usage ? { token_usage } : {}),
  };
}

/**
 * 将会话中的消息转换为 TrajectoryTurn 数组。
 */
export function sessionToTrajectory(
  session: ChatSession,
  options: { since?: number; until?: number; sanitize?: boolean } = {},
): TrajectoryTurn[] {
  const turns: TrajectoryTurn[] = [];
  let turnIndex = 0;
  for (const message of session.messages) {
    if (options.since !== undefined && message.at < options.since) continue;
    if (options.until !== undefined && message.at > options.until) continue;
    turns.push(messageToTrajectoryTurn(message, session, turnIndex, options.sanitize !== false));
    turnIndex += 1;
  }
  return turns;
}

/**
 * 从会话列表收集轨迹（按会话分组，供同步导出与压缩导出复用）。
 */
export function collectTrajectorySessions(
  sessions: ChatSessionMeta[],
  getSession: (id: string) => ChatSession | null,
  options: { sessionId?: string; mode?: ConversationMode; since?: number; until?: number; sanitize?: boolean } = {},
): { grouped: TrajectoryTurn[][]; sessionCount: number } {
  const sanitize = options.sanitize !== false;
  const grouped: TrajectoryTurn[][] = [];
  let sessionCount = 0;

  for (const meta of sessions) {
    if (options.sessionId && meta.id !== options.sessionId) continue;
    if (options.mode && meta.mode !== options.mode) continue;

    const session = getSession(meta.id);
    if (!session) continue;

    const turns = sessionToTrajectory(session, {
      since: options.since,
      until: options.until,
      sanitize,
    });
    if (turns.length === 0) continue;

    grouped.push(turns);
    sessionCount += 1;
  }

  return { grouped, sessionCount };
}

/**
 * 导出轨迹。
 *
 * @param sessions 要导出的会话列表（从 chats-store 获取）
 * @param getSession 按 id 获取完整会话的函数（chats-store.getSession）
 * @param options 导出选项
 */
export function exportTrajectory(
  sessions: ChatSessionMeta[],
  getSession: (id: string) => ChatSession | null,
  options: ExportOptions = {},
): ExportResult {
  const { grouped, sessionCount } = collectTrajectorySessions(sessions, getSession, options);
  const allTurns = grouped.flat();

  if (options.outputPath) {
    const dir = path.dirname(options.outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lines = allTurns.map((turn) => JSON.stringify(turn));
    fs.writeFileSync(options.outputPath, lines.join("\n") + "\n", "utf8");
    return { turnCount: allTurns.length, sessionCount, outputPath: options.outputPath };
  }

  return { turnCount: allTurns.length, sessionCount, turns: allTurns };
}

export interface CompressExportOptions extends ExportOptions {
  compression?: {
    /** 压缩配置覆盖项 */
    config?: Partial<CompressionConfig>;
    /** LLM 摘要函数；缺省时压缩仍可用（生成确定性占位摘要） */
    summarize?: SummarizeFn;
    /** 批量压缩并发上限（默认 4） */
    concurrency?: number;
  };
}

export interface CompressedExportResult extends ExportResult {
  /** 压缩汇总指标（每个会话各自压缩后汇总） */
  metrics?: Record<string, unknown>;
}

/**
 * 导出并压缩轨迹（异步）。
 *
 * 每个会话的轨迹独立压缩（保护头部/尾部、压缩中部、替换为摘要），
 * 再合并写出。outputPath 未指定时返回压缩后的 turns。
 */
export async function exportTrajectoryCompressed(
  sessions: ChatSessionMeta[],
  getSession: (id: string) => ChatSession | null,
  options: CompressExportOptions = {},
): Promise<CompressedExportResult> {
  const { grouped, sessionCount } = collectTrajectorySessions(sessions, getSession, options);
  if (grouped.length === 0) return { turnCount: 0, sessionCount: 0, turns: [], metrics: {} };

  const config = defaultCompressionConfig(options.compression?.config ?? {});
  if (options.compression?.summarize) config.summarize = options.compression.summarize;

  const { trajectories, metrics, aggregate } = await compressTrajectories(grouped, config, {
    concurrency: options.compression?.concurrency,
  });

  const allTurns: TrajectoryTurn[] = [];
  for (let i = 0; i < trajectories.length; i++) {
    // saveOverLimit=false 时丢弃压缩后仍超限的会话
    if (!config.saveOverLimit && metrics[i].stillOverLimit) continue;
    allTurns.push(...trajectories[i]);
  }

  if (options.outputPath) {
    const dir = path.dirname(options.outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lines = allTurns.map((turn) => JSON.stringify(turn));
    fs.writeFileSync(options.outputPath, lines.join("\n") + "\n", "utf8");
    return { turnCount: allTurns.length, sessionCount, outputPath: options.outputPath, metrics: aggregateMetricsToDict(aggregate) };
  }

  return { turnCount: allTurns.length, sessionCount, turns: allTurns, metrics: aggregateMetricsToDict(aggregate) };
}
