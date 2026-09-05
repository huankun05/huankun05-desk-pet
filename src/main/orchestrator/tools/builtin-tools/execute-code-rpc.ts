// execute-code-rpc —— 让 execute_code 脚本内可调用受白名单约束的工具。
//
// 移植自 Hermes code_execution_tool.py 的 RPC 设计：
// - 父进程在 127.0.0.1 上起一个回环 TCP 服务（每次 execute_code 调用一个）
// - 子进程脚本里注入自动生成的 stub（rpc_stubs.py / rpc_stubs.js），
//   通过 call_tool(name, args) 发送 newline-delimited JSON 请求，
//   父进程走 executeToolDefinition（标准工具执行边界）后返回结果 + "\n"
// - 约束：工具白名单 + 单次执行调用上限；端口只绑 127.0.0.1 回环，
//   仅脚本运行窗口期存在，脚本结束即关闭
//
// 协议（与 Hermes 一致）：
//   请求  = {"tool": string, "args": object}\n
//   响应  = <ToolExecutionOutcome JSON>\n

import { createServer, type Server, type Socket } from "net";
import { logger, LogTag } from "../../../logger";
import type { ToolContext } from "../registry/tool-context";
import { executeToolDefinition } from "../registry/tool-executor";
import { toolRegistry } from "../registry/tool-registry";
import type { ToolExecutionOutcome } from "../../types";

const LOG_PREFIX = "[CodeRpc]";

// ── 默认约束（与 Hermes DEFAULT_MAX_TOOL_CALLS=50 对齐） ──

export const DEFAULT_RPC_MAX_TOOL_CALLS = 50;

/** 与 Hermes SANDBOX_ALLOWED_TOOLS 对齐的默认白名单（Cyrene 工具 id）。 */
export const DEFAULT_RPC_ALLOWED_TOOLS: readonly string[] = [
  "read_file",
  "list_dir",
  "write_file",
  "search_code",
  "search_text",
  "run_shell",
  "web_search",
  "fetch_url",
  "apply_patch",
];

// ── 对外接口 ────────────────────────────────────────────

export interface CodeRpcServerOptions {
  /** 脚本内可调用的工具 id 白名单。 */
  allowedTools: ReadonlyArray<string>;
  /** 单次执行最多工具调用次数（默认 50）。 */
  maxToolCalls?: number;
  /** 工具执行上下文（复用调用方 runId / resolvedWorkspaceRoot / permissionMode 等）。 */
  context?: ToolContext;
}

export interface CodeRpcServer {
  /** 回环端口（127.0.0.1）。 */
  port: number;
  /** 已处理的工具调用次数。 */
  getToolCallCount(): number;
  /** 关闭服务器并断开全部客户端连接（幂等）。 */
  close(): Promise<void>;
}

interface DispatchContext {
  allowed: Set<string>;
  maxToolCalls: number;
  context?: ToolContext;
  counter: { count: number };
}

// ── 服务器 ─────────────────────────────────────────────

/**
 * 启动回环 RPC 服务器。返回后端口即已可连接。
 */
export function startCodeRpcServer(options: CodeRpcServerOptions): Promise<CodeRpcServer> {
  const maxToolCalls = options.maxToolCalls ?? DEFAULT_RPC_MAX_TOOL_CALLS;
  const ctx: DispatchContext = {
    allowed: new Set(options.allowedTools),
    maxToolCalls,
    context: options.context,
    counter: { count: 0 },
  };
  const sockets = new Set<Socket>();
  let closing = false;
  let server: Server | null = null;

  return new Promise((resolve, reject) => {
    server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      // Windows 上子进程退出后，服务器侧 socket 可能收到 ECONNRESET（RST 而非 FIN）。
      // 必须显式监听 error，否则 unhandled 'error' 事件会崩掉父进程。
      socket.on("error", (err) => {
        logger.debug(LogTag.BuiltinTools, `${LOG_PREFIX} client socket error: ${err instanceof Error ? err.message : String(err)}`);
      });
      handleConnection(socket, ctx);
    });
    server.on("error", (err) => reject(err));
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      if (!address || typeof address === "string") {
        reject(new Error("RPC server bound to unexpected address"));
        return;
      }
      const port = address.port;
      logger.info(LogTag.BuiltinTools, `${LOG_PREFIX} listening on 127.0.0.1:${port} (allowed=${ctx.allowed.size}, maxCalls=${maxToolCalls})`);
      resolve({
        port,
        getToolCallCount: () => ctx.counter.count,
        close: () => {
          if (closing) return Promise.resolve();
          closing = true;
          logger.info(LogTag.BuiltinTools, `${LOG_PREFIX} closing server on 127.0.0.1:${port}, toolCalls=${ctx.counter.count}`);
          for (const s of sockets) s.destroy();
          sockets.clear();
          return new Promise<void>((done) => {
            if (!server) return done();
            server.close(() => done());
            // 兜底：极端情况下连接不干净时强制返回，不阻塞调用方
            setTimeout(() => done(), 1000).unref();
          });
        },
      });
    });
  });
}

/** 单条连接：newline-delimited JSON 协议，请求按到达顺序串行处理。 */
function handleConnection(socket: Socket, ctx: DispatchContext): void {
  let buffer = Buffer.alloc(0);
  let queue: Promise<void> = Promise.resolve();

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const nl = buffer.indexOf(0x0a);
      if (nl === -1) break;
      const line = buffer.subarray(0, nl).toString("utf8").trim();
      buffer = buffer.subarray(nl + 1);
      if (!line) continue;
      // 串行化：避免并发请求交错响应
      queue = queue.then(() => processRequest(line, socket, ctx)).catch((err) => {
        logger.warn(LogTag.BuiltinTools, `${LOG_PREFIX} request processing error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  });
}

async function processRequest(line: string, socket: Socket, ctx: DispatchContext): Promise<void> {
  let request: { tool?: unknown; args?: unknown };
  try {
    request = JSON.parse(line) as { tool?: unknown; args?: unknown };
  } catch {
    send(socket, {
      status: "failed",
      output: "Invalid RPC request: JSON 解析失败",
      errorCode: "E_RPC_INVALID_REQUEST",
      category: "invalid_arguments",
    });
    return;
  }

  const toolName = typeof request.tool === "string" ? request.tool : "";
  const args = request.args && typeof request.args === "object" && !Array.isArray(request.args)
    ? (request.args as Record<string, unknown>)
    : {};

  if (!toolName || !ctx.allowed.has(toolName)) {
    const available = Array.from(ctx.allowed).sort().join(", ");
    send(socket, {
      status: "failed",
      output: `工具 '${toolName}' 不在 execute_code 可调用白名单内。可用工具: ${available}`,
      errorCode: "E_RPC_TOOL_NOT_ALLOWED",
      category: "permission_denied",
    });
    return;
  }

  if (ctx.counter.count >= ctx.maxToolCalls) {
    send(socket, {
      status: "failed",
      output: `工具调用次数已达上限（${ctx.maxToolCalls}），本次脚本内不允许再调用工具。`,
      errorCode: "E_RPC_TOOL_LIMIT",
      category: "permission_denied",
    });
    return;
  }

  const tool = toolRegistry.getById(toolName);
  if (!tool) {
    send(socket, {
      status: "failed",
      output: `工具 '${toolName}' 未注册`,
      errorCode: "E_RPC_TOOL_NOT_FOUND",
      category: "not_found",
    });
    return;
  }

  ctx.counter.count += 1;
  logger.info(LogTag.BuiltinTools, `${LOG_PREFIX} call #${ctx.counter.count}: ${toolName} argsPreview=${JSON.stringify(args).slice(0, 120)}`);
  try {
    const outcome = await executeToolDefinition(tool, args, ctx.context);
    send(socket, outcome);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send(socket, {
      status: "failed",
      output: msg,
      errorCode: "E_RPC_EXEC_FAILED",
      category: "fatal",
    });
  }
}

function send(socket: Socket, outcome: ToolExecutionOutcome): void {
  if (socket.destroyed) return; // 客户端已断开（如脚本提前退出），丢弃响应即可
  const payload = JSON.stringify(outcome) + "\n";
  socket.write(payload);
}

// ── stub 代码生成 ────────────────────────────────────────
// 每次执行根据白名单生成 stub 模块源码，写到脚本同目录（rpc_stubs.py / rpc_stubs.js）。

interface StubFnSpec {
  /** 工具 id（父进程白名单内）。 */
  tool: string;
  /** stub 里的函数名。 */
  fn: string;
  /** 中文描述（用于 stub docstring）。 */
  desc: string;
  /** Python 签名参数。 */
  pyParams: string;
  /** Node 签名参数。 */
  nodeParams: string;
  /** Python：构建 args dict 的表达式。 */
  pyArgs: string;
  /** Node：构建 args 对象的表达式。 */
  nodeArgs: string;
}

const STUB_FN_SPECS: StubFnSpec[] = [
  {
    tool: "read_file", fn: "read_file", desc: "读取本地文本文件",
    pyParams: "path, startLine=None, maxLines=None",
    nodeParams: "path, startLine, maxLines",
    pyArgs: `{"path": path, **({"startLine": startLine} if startLine is not None else {}), **({"maxLines": maxLines} if maxLines is not None else {})}`,
    nodeArgs: `{ path, ...(startLine !== undefined ? { startLine } : {}), ...(maxLines !== undefined ? { maxLines } : {}) }`,
  },
  {
    tool: "list_dir", fn: "list_dir", desc: "列举目录内容",
    pyParams: "path",
    nodeParams: "path",
    pyArgs: `{"path": path}`,
    nodeArgs: `{ path }`,
  },
  {
    tool: "write_file", fn: "write_file", desc: "写入文本文件",
    pyParams: "path, content, append=None",
    nodeParams: "path, content, append",
    pyArgs: `{"path": path, "content": content, **({"append": append} if append is not None else {})}`,
    nodeArgs: `{ path, content, ...(append !== undefined ? { append } : {}) }`,
  },
  {
    tool: "search_code", fn: "search_code", desc: "代码语义搜索",
    pyParams: "query, topK=None",
    nodeParams: "query, topK",
    pyArgs: `{"query": query, **({"topK": topK} if topK is not None else {})}`,
    nodeArgs: `{ query, ...(topK !== undefined ? { topK } : {}) }`,
  },
  {
    tool: "search_text", fn: "search_text", desc: "文本关键词搜索",
    pyParams: "query, path=None",
    nodeParams: "query, path",
    pyArgs: `{"query": query, **({"path": path} if path is not None else {})}`,
    nodeArgs: `{ query, ...(path !== undefined ? { path } : {}) }`,
  },
  {
    tool: "run_shell", fn: "run_shell", desc: "执行 shell 命令",
    pyParams: "command, cwd=None",
    nodeParams: "command, cwd",
    pyArgs: `{"command": command, **({"cwd": cwd} if cwd is not None else {})}`,
    nodeArgs: `{ command, ...(cwd !== undefined ? { cwd } : {}) }`,
  },
  {
    tool: "web_search", fn: "web_search", desc: "联网搜索",
    pyParams: "query, topK=None",
    nodeParams: "query, topK",
    pyArgs: `{"query": query, **({"topK": topK} if topK is not None else {})}`,
    nodeArgs: `{ query, ...(topK !== undefined ? { topK } : {}) }`,
  },
  {
    tool: "fetch_url", fn: "fetch_url", desc: "抓取网页内容",
    pyParams: "url",
    nodeParams: "url",
    pyArgs: `{"url": url}`,
    nodeArgs: `{ url }`,
  },
  {
    tool: "apply_patch", fn: "apply_patch", desc: "应用代码补丁",
    pyParams: "patch",
    nodeParams: "patch",
    pyArgs: `{"patch": patch}`,
    nodeArgs: `{ patch }`,
  },
];

function filteredStubSpecs(allowedTools: ReadonlyArray<string>): StubFnSpec[] {
  const allowed = new Set(allowedTools);
  return STUB_FN_SPECS.filter((s) => allowed.has(s.tool));
}

const PY_HEADER = `\
"""Auto-generated Cyrene tools RPC stubs (file-based port + loopback TCP transport)."""
import json, socket, threading, time

_PORT = {port}
_sock = None
# RPC 服务器单连接串行处理请求；多线程调用时用锁串行化 send+recv 往返
_call_lock = threading.Lock()

def _connect():
    global _sock
    if _sock is None:
        _sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        _sock.settimeout(300)
        _sock.connect(("127.0.0.1", _PORT))
    return _sock

def call_tool(tool_name, args=None):
    """调用父进程的受白名单工具，返回 {status, output, errorCode?, category?}。"""
    if args is None:
        args = {}
    request = json.dumps({"tool": tool_name, "args": args}) + "\\n"
    with _call_lock:
        conn = _connect()
        conn.sendall(request.encode("utf-8"))
        buf = b""
        while True:
            chunk = conn.recv(65536)
            if not chunk:
                raise RuntimeError("Cyrene RPC 连接已断开（父进程已结束本次执行）")
            buf += chunk
            if buf.endswith(b"\\n"):
                break
    raw = buf.decode("utf-8").strip()
    result = json.loads(raw)
    if isinstance(result, str):
        try:
            return json.loads(result)
        except (json.JSONDecodeError, TypeError):
            return result
    return result

def json_parse(text):
    """容错解析 JSON（strict=False），用于解析工具输出里的控制字符。"""
    return json.loads(text, strict=False)

def shell_quote(s):
    """Shell 转义动态字符串，用于安全拼接到 shell 命令。"""
    import shlex
    return shlex.quote(s)

def retry(fn, max_attempts=3, delay=2):
    """指数退避重试，用于瞬态失败（网络错误、限流）。"""
    last_err = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except Exception as e:
            last_err = e
            if attempt < max_attempts - 1:
                time.sleep(delay * (2 ** attempt))
    raise last_err

__all__ = ["call_tool", "json_parse", "shell_quote", "retry"]
`;

const NODE_HEADER = `\
// Auto-generated Cyrene tools RPC stubs (loopback TCP transport)
"use strict";
const net = require("net");
const PORT = {port};
let _sock = null;
// 串行化整个 send+recv 往返，避免并发调用错读响应
let _queue = Promise.resolve();

function _connect() {
  if (_sock === null) {
    _sock = net.connect(PORT, "127.0.0.1");
    _sock.setTimeout(300000);
    // 连接关闭后置空，下次调用重新建立
    _sock.on("close", () => { _sock = null; });
    _sock.on("error", () => { _sock = null; });
  }
  return _sock;
}

function call_tool(toolName, args) {
  if (args === undefined || args === null) args = {};
  const request = JSON.stringify({ tool: toolName, args }) + "\\n";
  const run = () => new Promise((resolve, reject) => {
    const conn = _connect();
    conn.write(request, "utf8", () => {
      let buf = Buffer.alloc(0);
      const onData = (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf[buf.length - 1] === 0x0a) {
          conn.removeListener("data", onData);
          conn.removeListener("error", onError);
          // 响应消费完即关闭连接：否则持久 socket 会一直占住事件循环，
          // 脚本在最后一次 call_tool 后无法自然退出（Node 与 Python 不同，
          // 没有解释器关闭时自动回收 fd 的机制）。
          conn.destroy();
          const raw = buf.toString("utf8").trim();
          let result;
          try {
            result = JSON.parse(raw);
          } catch (e) {
            return reject(new Error("RPC 响应解析失败: " + raw.slice(0, 200)));
          }
          resolve(result);
        }
      };
      const onError = (err) => {
        conn.removeListener("data", onData);
        reject(new Error("Cyrene RPC 连接失败: " + err.message));
      };
      conn.on("data", onData);
      conn.on("error", onError);
    });
  });
  const next = _queue.then(run, run);
  _queue = next.catch(() => {});
  return next;
}

function json_parse(text) {
  return JSON.parse(text);
}

const __all__ = ["call_tool", "json_parse"];
`;

/**
 * 生成 Python stub 模块源码（写入脚本同目录 rpc_stubs.py）。
 * 用户在脚本开头 `from rpc_stubs import *` 即可使用 call_tool 与各工具包装函数。
 */
export function buildPythonStubSource(port: number, allowedTools: ReadonlyArray<string>): string {
  const header = PY_HEADER.replace("{port}", String(port));
  const fns = filteredStubSpecs(allowedTools)
    .map((s) => {
      const lines = [
        `def ${s.fn}(${s.pyParams}):`,
        `    """调用父进程工具 ${s.tool}（${s.desc}）。返回 {status, output, ...}。"""`,
        `    return call_tool(${JSON.stringify(s.tool)}, ${s.pyArgs})`,
        "",
      ];
      return lines.join("\n");
    })
    .join("\n");
  // 把各工具函数追加到 __all__（由 from rpc_stubs import * 引入）
  const fnNames = filteredStubSpecs(allowedTools).map((s) => `"${s.fn}"`).join(", ");
  const allLine = `__all__ += [${fnNames}]`;
  return `${header}\n\n${fns}${allLine}\n`;
}

/**
 * 生成 Node.js stub 模块源码（写入脚本同目录 rpc_stubs.js）。
 * 用户在脚本开头 `const { call_tool, ... } = require("./rpc_stubs.js")` 使用。
 */
export function buildNodeStubSource(port: number, allowedTools: ReadonlyArray<string>): string {
  const header = NODE_HEADER.replace("{port}", String(port));
  const fns = filteredStubSpecs(allowedTools)
    .map((s) => {
      return [
        `function ${s.fn}(${s.nodeParams}) {`,
        `  return call_tool(${JSON.stringify(s.tool)}, ${s.nodeArgs});`,
        `}`,
        "",
      ].join("\n");
    })
    .join("\n");
  const exports = filteredStubSpecs(allowedTools).map((s) => `  ${s.fn},`).join("\n");
  return `${header}\n\n${fns}module.exports = {\n  call_tool,\n  json_parse,\n${exports}\n};\n`;
}
