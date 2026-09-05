// LSP 协议层 —— JSON-RPC 消息编码/解码。
//
// 纯函数模块，不依赖进程/网络，易于测试。
// 参考：https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/

// ── 类型定义 ────────────────────────────────────────────────

/** JSON-RPC 请求消息 */
export interface LSPRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

/** JSON-RPC 响应消息 */
export interface LSPResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: LSPError;
}

/** JSON-RPC 通知消息（无 id） */
export interface LSPNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

/** LSP 错误 */
export interface LSPError {
  code: number;
  message: string;
  data?: unknown;
}

/** LSP 消息（请求/响应/通知的联合类型） */
export type LSPMessage = LSPRequest | LSPResponse | LSPNotification;

// ── 标准错误码 ──────────────────────────────────────────────

export const LSP_ERROR_CODES = {
  // JSON-RPC 标准错误码
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,

  // LSP 特定错误码
  ServerNotInitialized: -32002,
  UnknownErrorCode: -32001,

  // 内容修改（需要重试）
  ContentModified: -32801,

  // 请求被取消
  RequestCancelled: -32800,
} as const;

// ── 消息编码 ────────────────────────────────────────────────

/**
 * 编码 LSP 消息为 LSP 协议格式（Content-Length header + JSON body）。
 *
 * LSP 协议使用 HTTP 风格的 header：
 *   Content-Length: <bytes>\r\n
 *   \r\n
 *   <json body>
 */
export function encodeLSPMessage(message: LSPMessage): string {
  const body = JSON.stringify(message);
  const contentLength = Buffer.byteLength(body, "utf-8");
  return `Content-Length: ${contentLength}\r\n\r\n${body}`;
}

/**
 * 编码 LSP 请求消息。
 */
export function encodeRequest(
  id: number | string,
  method: string,
  params?: unknown,
): string {
  const request: LSPRequest = {
    jsonrpc: "2.0",
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  };
  return encodeLSPMessage(request);
}

/**
 * 编码 LSP 通知消息。
 */
export function encodeNotification(method: string, params?: unknown): string {
  const notification: LSPNotification = {
    jsonrpc: "2.0",
    method,
    ...(params !== undefined ? { params } : {}),
  };
  return encodeLSPMessage(notification);
}

/**
 * 编码 LSP 响应消息。
 */
export function encodeResponse(
  id: number | string | null,
  result?: unknown,
  error?: LSPError,
): string {
  const response: LSPResponse = {
    jsonrpc: "2.0",
    id,
    ...(result !== undefined ? { result } : {}),
    ...(error !== undefined ? { error } : {}),
  };
  return encodeLSPMessage(response);
}

// ── 消息解码 ────────────────────────────────────────────────

/** 解码错误 */
export class LSPDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LSPDecodeError";
  }
}

/**
 * 从缓冲区中提取一条完整的 LSP 消息。
 *
 * 返回 { message, remaining }，如果缓冲区中没有完整消息，返回 null。
 *
 * LSP 协议格式：
 *   Content-Length: <bytes>\r\n
 *   \r\n
 *   <json body>
 */
export function decodeLSPMessage(
  buffer: string,
): { message: LSPMessage; remaining: string } | null {
  // 查找 header 结束符 \r\n\r\n
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) return null;

  // 解析 Content-Length
  const header = buffer.slice(0, headerEnd);
  const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
  if (!contentLengthMatch) {
    throw new LSPDecodeError("Missing Content-Length header");
  }
  const contentLength = parseInt(contentLengthMatch[1], 10);

  // 检查 body 是否完整
  const bodyStart = headerEnd + 4; // 跳过 \r\n\r\n
  const bodyEnd = bodyStart + contentLength;
  if (buffer.length < bodyEnd) return null;

  // 解析 JSON body
  const body = buffer.slice(bodyStart, bodyEnd);
  let message: LSPMessage;
  try {
    message = JSON.parse(body);
  } catch (e) {
    throw new LSPDecodeError(`Invalid JSON body: ${(e as Error).message}`);
  }

  // 验证 jsonrpc 字段
  if (message.jsonrpc !== "2.0") {
    throw new LSPDecodeError(`Invalid jsonrpc version: ${message.jsonrpc}`);
  }

  const remaining = buffer.slice(bodyEnd);
  return { message, remaining };
}

/**
 * 从缓冲区中提取所有完整的 LSP 消息。
 *
 * 返回 { messages, remaining }。
 */
export function decodeAllLSPMessages(
  buffer: string,
): { messages: LSPMessage[]; remaining: string } {
  const messages: LSPMessage[] = [];
  let remaining = buffer;

  while (true) {
    const result = decodeLSPMessage(remaining);
    if (!result) break;
    messages.push(result.message);
    remaining = result.remaining;
  }

  return { messages, remaining };
}

// ── 消息分类 ────────────────────────────────────────────────

/** 判断消息是否为请求 */
export function isRequest(message: LSPMessage): message is LSPRequest {
  return "id" in message && "method" in message && !("result" in message) && !("error" in message);
}

/** 判断消息是否为响应 */
export function isResponse(message: LSPMessage): message is LSPResponse {
  return "id" in message && ("result" in message || "error" in message);
}

/** 判断消息是否为通知 */
export function isNotification(message: LSPMessage): message is LSPNotification {
  return !("id" in message) && "method" in message;
}

// ── 常用 LSP 方法 ───────────────────────────────────────────

/** LSP 标准方法名 */
export const LSP_METHODS = {
  // 生命周期
  Initialize: "initialize",
  Initialized: "initialized",
  Shutdown: "shutdown",
  Exit: "exit",

  // 文本文档同步
  TextDocumentDidOpen: "textDocument/didOpen",
  TextDocumentDidChange: "textDocument/didChange",
  TextDocumentDidClose: "textDocument/didClose",
  TextDocumentDidSave: "textDocument/didSave",

  // 诊断
  TextDocumentPublishDiagnostics: "textDocument/publishDiagnostics",
  TextDocumentDiagnostic: "textDocument/diagnostic",

  // 补全
  TextDocumentCompletion: "textDocument/completion",
  CompletionItemResolve: "completionItem/resolve",

  // 悬停
  TextDocumentHover: "textDocument/hover",

  // 定义
  TextDocumentDefinition: "textDocument/definition",

  // 引用
  TextDocumentReferences: "textDocument/references",

  // 工作区
  WorkspaceDidChangeWatchedFiles: "workspace/didChangeWatchedFiles",
} as const;

// ── 诊断类型 ────────────────────────────────────────────────

/** 诊断严重程度 */
export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

/** 文档位置 */
export interface Position {
  line: number; // 0-based
  character: number; // 0-based
}

/** 文档范围 */
export interface Range {
  start: Position;
  end: Position;
}

/** 诊断 */
export interface Diagnostic {
  range: Range;
  severity?: DiagnosticSeverity;
  code?: number | string;
  source?: string;
  message: string;
  tags?: number[];
  relatedInformation?: unknown[];
  data?: unknown;
}

/** 发布诊断通知的参数 */
export interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: Diagnostic[];
  version?: number;
}
