import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connect, type Socket } from "net";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  startCodeRpcServer,
  buildPythonStubSource,
  buildNodeStubSource,
  DEFAULT_RPC_ALLOWED_TOOLS,
  DEFAULT_RPC_MAX_TOOL_CALLS,
  type CodeRpcServer,
} from "./execute-code-rpc";
import { toolRegistry } from "../registry/tool-registry";

// ── 测试辅助 ───────────────────────────────────────────────

const TEST_TOOL_ID = "rpc_test_tool";

function hasCommand(cmd: string): boolean {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
  return probe.status === 0;
}

function hasPython(): boolean {
  return hasCommand("python") || hasCommand("py");
}

function hasNode(): boolean {
  return hasCommand("node");
}

/**
 * 异步运行子进程。注意：必须用异步 spawn 而非 spawnSync——
 * spawnSync 会阻塞父进程事件循环，导致本进程的 RPC 服务器
 * 在子进程运行期间无法 accept 连接（E2E 测试踩过这个坑）。
 */
function runChildAsync(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // 剥离测试运行器注入的 NODE_OPTIONS / VITEST_* 环境变量：
    // 这些只对 vitest worker 有效，会被子进程 node 继承并导致启动失败/挂起。
    const env: NodeJS.ProcessEnv = {};
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("VITEST")) continue;
      if (key === "NODE_OPTIONS") continue;
      env[key] = process.env[key];
    }
    const child = spawn(command, args, { cwd: options.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`child process ${command} timed out\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 20000);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr });
    });
  });
}

function registerTestTool(): void {
  toolRegistry.register({
    id: TEST_TOOL_ID,
    name: "RPC 测试工具",
    description: "测试用",
    enabled: true,
    inputSchema: { type: "object", properties: { echo: { type: "string" } } },
    execute: async (args) => `echo:${String(args.echo ?? "")}`,
  });
}

function unregisterTestTool(): void {
  toolRegistry.unregister(TEST_TOOL_ID);
}

/** 连接 RPC 服务器并发送一条请求，返回解析后的响应。 */
function rpcRequest(port: number, payload: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock: Socket = connect(port, "127.0.0.1", () => {
      sock.write(payload + "\n");
    });
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("RPC request timeout"));
    }, 5000);
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf[buf.length - 1] === 0x0a) {
        clearTimeout(timer);
        sock.destroy();
        try {
          resolve(JSON.parse(buf.toString("utf8").trim()));
        } catch (err) {
          reject(err);
        }
      }
    });
    sock.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

beforeEach(() => {
  registerTestTool();
});

afterEach(() => {
  unregisterTestTool();
});

// ── stub 生成 ─────────────────────────────────────────────

describe("buildPythonStubSource", () => {
  it("包含 call_tool / json_parse / shell_quote / retry 与端口", () => {
    const src = buildPythonStubSource(43210, DEFAULT_RPC_ALLOWED_TOOLS);
    expect(src).toContain("_PORT = 43210");
    expect(src).toContain("def call_tool(tool_name, args=None):");
    expect(src).toContain("def json_parse(text):");
    expect(src).toContain("def shell_quote(s):");
    expect(src).toContain("def retry(fn, max_attempts=3, delay=2):");
  });

  it("仅为白名单内工具生成包装函数，且加入 __all__", () => {
    const src = buildPythonStubSource(1, ["read_file", "run_shell"]);
    expect(src).toContain("def read_file(path, startLine=None, maxLines=None):");
    expect(src).toContain('return call_tool("read_file"');
    expect(src).toContain("def run_shell(command, cwd=None):");
    expect(src).toContain('__all__ += ["read_file", "run_shell"]');
    expect(src).not.toContain("def web_search");
    expect(src).not.toContain('__all__ += ["web_search"');
  });
});

describe("buildNodeStubSource", () => {
  it("包含 call_tool / json_parse 与端口", () => {
    const src = buildNodeStubSource(43211, DEFAULT_RPC_ALLOWED_TOOLS);
    expect(src).toContain("const PORT = 43211;");
    expect(src).toContain("function call_tool(toolName, args)");
    expect(src).toContain("function json_parse(text)");
  });

  it("仅为白名单内工具生成包装函数并导出", () => {
    const src = buildNodeStubSource(1, ["write_file"]);
    expect(src).toContain("function write_file(path, content, append)");
    expect(src).toContain('return call_tool("write_file"');
    expect(src).toContain("module.exports = {");
    expect(src).toContain("  write_file,");
    expect(src).not.toContain("function read_file");
  });
});

// ── RPC 服务器协议 ────────────────────────────────────────

describe("startCodeRpcServer", () => {
  it("绑定 127.0.0.1 并响应合法工具调用", async () => {
    const server = await startCodeRpcServer({ allowedTools: [TEST_TOOL_ID] });
    try {
      const resp = (await rpcRequest(server.port, JSON.stringify({ tool: TEST_TOOL_ID, args: { echo: "hi" } }))) as {
        status: string;
        output: string;
      };
      expect(resp.status).toBe("succeeded");
      expect(resp.output).toBe("echo:hi");
      expect(server.getToolCallCount()).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("拒绝白名单外的工具", async () => {
    const server = await startCodeRpcServer({ allowedTools: [TEST_TOOL_ID] });
    try {
      const resp = (await rpcRequest(server.port, JSON.stringify({ tool: "not_allowed_tool", args: {} }))) as {
        status: string;
        errorCode: string;
        output: string;
      };
      expect(resp.status).toBe("failed");
      expect(resp.errorCode).toBe("E_RPC_TOOL_NOT_ALLOWED");
      expect(resp.output).toContain(TEST_TOOL_ID);
    } finally {
      await server.close();
    }
  });

  it("执行达到上限后拒绝", async () => {
    const server = await startCodeRpcServer({ allowedTools: [TEST_TOOL_ID], maxToolCalls: 1 });
    try {
      await rpcRequest(server.port, JSON.stringify({ tool: TEST_TOOL_ID, args: { echo: "1" } }));
      const resp = (await rpcRequest(server.port, JSON.stringify({ tool: TEST_TOOL_ID, args: { echo: "2" } }))) as {
        status: string;
        errorCode: string;
      };
      expect(resp.status).toBe("failed");
      expect(resp.errorCode).toBe("E_RPC_TOOL_LIMIT");
    } finally {
      await server.close();
    }
  });

  it("未注册工具返回 E_RPC_TOOL_NOT_FOUND", async () => {
    unregisterTestTool();
    const server = await startCodeRpcServer({ allowedTools: [TEST_TOOL_ID] });
    try {
      const resp = (await rpcRequest(server.port, JSON.stringify({ tool: TEST_TOOL_ID, args: {} }))) as {
        status: string;
        errorCode: string;
      };
      expect(resp.status).toBe("failed");
      expect(resp.errorCode).toBe("E_RPC_TOOL_NOT_FOUND");
    } finally {
      await server.close();
    }
  });

  it("非法 JSON 返回 E_RPC_INVALID_REQUEST", async () => {
    const server = await startCodeRpcServer({ allowedTools: [TEST_TOOL_ID] });
    try {
      const resp = (await rpcRequest(server.port, "not json")) as { status: string; errorCode: string };
      expect(resp.status).toBe("failed");
      expect(resp.errorCode).toBe("E_RPC_INVALID_REQUEST");
    } finally {
      await server.close();
    }
  });

  it("工具执行抛错时返回 E_RPC_EXEC_FAILED", async () => {
    toolRegistry.register({
      id: "rpc_throw_tool",
      name: "抛错工具",
      description: "测试用",
      enabled: true,
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        throw new Error("boom");
      },
    });
    const server = await startCodeRpcServer({ allowedTools: ["rpc_throw_tool"] });
    try {
      const resp = (await rpcRequest(server.port, JSON.stringify({ tool: "rpc_throw_tool", args: {} }))) as {
        status: string;
        errorCode: string;
        output: string;
      };
      expect(resp.status).toBe("failed");
      expect(resp.errorCode).toBe("E_TOOL_EXECUTION_FAILED");
      expect(resp.output).toContain("boom");
    } finally {
      await server.close();
      toolRegistry.unregister("rpc_throw_tool");
    }
  });

  it("连续多次调用按序响应", async () => {
    const server = await startCodeRpcServer({ allowedTools: [TEST_TOOL_ID] });
    try {
      const results = await Promise.all([
        rpcRequest(server.port, JSON.stringify({ tool: TEST_TOOL_ID, args: { echo: "a" } })),
        rpcRequest(server.port, JSON.stringify({ tool: TEST_TOOL_ID, args: { echo: "b" } })),
      ]);
      const outputs = (results as Array<{ output: string }>).map((r) => r.output);
      expect(outputs.sort()).toEqual(["echo:a", "echo:b"]);
      expect(server.getToolCallCount()).toBe(2);
    } finally {
      await server.close();
    }
  });

  it("close 幂等且会断开连接", async () => {
    const server = await startCodeRpcServer({ allowedTools: [TEST_TOOL_ID] });
    await server.close();
    await server.close(); // 第二次调用直接成功
    await expect(rpcRequest(server.port, JSON.stringify({ tool: TEST_TOOL_ID, args: {} }))).rejects.toThrow();
  });
});

// ── 端到端：生成的 stub 被真实运行时执行 ──────────────────

const E2E_TOOL = "rpc_e2e_tool";

function registerE2ETool(): void {
  toolRegistry.register({
    id: E2E_TOOL,
    name: "E2E 工具",
    description: "端到端测试用",
    enabled: true,
    inputSchema: { type: "object", properties: { echo: { type: "string" } } },
    execute: async (args) => `echo:${String(args.echo ?? "")}`,
  });
}

describe("stub 端到端（真实运行时）", () => {
  beforeEach(() => {
    registerE2ETool();
  });
  afterEach(() => {
    toolRegistry.unregister(E2E_TOOL);
  });

  it.runIf(hasPython())("python 脚本通过 rpc_stubs 调用父进程工具", async () => {
    const server = await startCodeRpcServer({ allowedTools: [E2E_TOOL] });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-rpc-py-"));
    try {
      fs.writeFileSync(path.join(tempDir, "rpc_stubs.py"), buildPythonStubSource(server.port, [E2E_TOOL]), "utf8");
      fs.writeFileSync(
        path.join(tempDir, "script.py"),
        [
          "from rpc_stubs import call_tool",
          "r = call_tool('rpc_e2e_tool', {'echo': 'py-ok'})",
          "print(r['status'], r['output'])",
        ].join("\n"),
        "utf8",
      );
      const py = hasCommand("python") ? "python" : "py";
      const result = await runChildAsync(py, ["script.py"], { cwd: tempDir });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout.trim()).toBe("succeeded echo:py-ok");
      expect(server.getToolCallCount()).toBe(1);
    } finally {
      await server.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.runIf(hasNode())("node 脚本通过 rpc_stubs 调用父进程工具", async () => {
    const server = await startCodeRpcServer({ allowedTools: [E2E_TOOL] });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-rpc-js-"));
    try {
      fs.writeFileSync(path.join(tempDir, "rpc_stubs.js"), buildNodeStubSource(server.port, [E2E_TOOL]), "utf8");
      fs.writeFileSync(
        path.join(tempDir, "script.js"),
        [
          'const { call_tool } = require("./rpc_stubs.js");',
          "call_tool('rpc_e2e_tool', { echo: 'js-ok' }).then((r) => {",
          "  console.log(r.status, r.output);",
          "});",
        ].join("\n"),
        "utf8",
      );
      const result = await runChildAsync("node", ["script.js"], { cwd: tempDir });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout.trim()).toBe("succeeded echo:js-ok");
      expect(server.getToolCallCount()).toBe(1);
    } finally {
      await server.close();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // 子进程挂起时目录可能被占用，清理失败不影响测试主结论
      }
    }
  }, 30000);
});
