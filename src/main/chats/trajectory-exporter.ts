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
 * 匹配常见模式：sk-xxx, Bearer xxx, api_key=xxx, password=xxx 等。
 */
export function sanitizeText(text: string): string {
  if (!text) return text;
  let result = text;
  // OpenAI-style API keys: sk-...
  result = result.replace(/sk-[a-zA-Z0-9]{20,}/g, "[REDACTED_API_KEY]");
  // Bearer tokens
  result = result.replace(/Bearer\s+[a-zA-Z0-9._-]{20,}/gi, "Bearer [REDACTED_TOKEN]");
  // api_key=xxx or apiKey=xxx
  result = result.replace(/(api[_-]?key\s*[=:]\s*)[^\s,;"']+/gi, "$1[REDACTED]");
  // password=xxx
  result = result.replace(/(password\s*[=:]\s*)[^\s,;"']+/gi, "$1[REDACTED]");
  // token=xxx
  result = result.replace(/(token\s*[=:]\s*)[^\s,;"']{10,}/gi, "$1[REDACTED]");
  // secret=xxx
  result = result.replace(/(secret\s*[=:]\s*)[^\s,;"']+/gi, "$1[REDACTED]");
  return result;
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
  const sanitize = options.sanitize !== false;
  let allTurns: TrajectoryTurn[] = [];
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

    allTurns = allTurns.concat(turns);
    sessionCount += 1;
  }

  if (options.outputPath) {
    const dir = path.dirname(options.outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lines = allTurns.map((turn) => JSON.stringify(turn));
    fs.writeFileSync(options.outputPath, lines.join("\n") + "\n", "utf8");
    return { turnCount: allTurns.length, sessionCount, outputPath: options.outputPath };
  }

  return { turnCount: allTurns.length, sessionCount, turns: allTurns };
}
