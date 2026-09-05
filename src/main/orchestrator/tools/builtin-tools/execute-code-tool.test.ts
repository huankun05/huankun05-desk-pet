import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Mock runShellTool
vi.mock("./run-shell-tool", () => ({
  runShellTool: {
    execute: vi.fn(),
  },
}));

import { runShellTool } from "./run-shell-tool";
import { executeCodeTool } from "./execute-code-tool";

const mockExecute = runShellTool.execute as unknown as ReturnType<typeof vi.fn>;

describe("execute_code tool", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  describe("工具定义", () => {
    it("id 为 execute_code", () => {
      expect(executeCodeTool.id).toBe("execute_code");
    });

    it("name 为 执行代码", () => {
      expect(executeCodeTool.name).toBe("执行代码");
    });

    it("仅在 code/work 模式启用", () => {
      expect(executeCodeTool.modes).toEqual(["code", "work"]);
    });

    it("risk 为 shell", () => {
      expect(executeCodeTool.risk).toBe("shell");
    });

    it("inputSchema 要求 code 字段", () => {
      expect(executeCodeTool.inputSchema.required).toContain("code");
    });

    it("inputSchema 支持 python/node/shell 三种语言", () => {
      expect(executeCodeTool.inputSchema.properties.language.enum).toEqual(["python", "node", "shell"]);
    });
  });

  describe("参数校验", () => {
    it("空 code 返回错误", async () => {
      const result = JSON.parse(await executeCodeTool.execute({ code: "" }));
      expect(result.exitCode).toBe(-1);
      expect(result.stderr).toContain("code 不能为空");
    });

    it("仅含空白的 code 返回错误", async () => {
      const result = JSON.parse(await executeCodeTool.execute({ code: "   \n  " }));
      expect(result.exitCode).toBe(-1);
      expect(result.stderr).toContain("code 不能为空");
    });

    it("不支持的语言返回错误", async () => {
      const result = JSON.parse(await executeCodeTool.execute({ code: "print(1)", language: "ruby" }));
      expect(result.exitCode).toBe(-1);
      expect(result.stderr).toContain("不支持的语言");
      expect(result.stderr).toContain("ruby");
    });
  });

  describe("Python 执行", () => {
    beforeEach(() => {
      mockExecute.mockResolvedValue(
        JSON.stringify({
          exitCode: 0,
          stdout: "hello from python",
          stderr: "",
          timedOut: false,
          truncated: false,
          sandboxed: true,
        }),
      );
    });

    it("调用 run_shell 执行 python 命令", async () => {
      await executeCodeTool.execute({ code: "print('hello')", language: "python" });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const callArgs = mockExecute.mock.calls[0][0];
      expect(callArgs.command).toContain("python");
      expect(callArgs.command).toContain(".py");
      expect(callArgs.shell).toBe("cmd");
    });

    it("返回正确的执行结果", async () => {
      const result = JSON.parse(
        await executeCodeTool.execute({ code: "print('hello')", language: "python" }),
      );
      expect(result.language).toBe("python");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello from python");
      expect(result.stderr).toBe("");
      expect(result.timedOut).toBe(false);
      expect(result.sandboxed).toBe(true);
    });

    it("默认语言为 python", async () => {
      await executeCodeTool.execute({ code: "print(1)" });
      const callArgs = mockExecute.mock.calls[0][0];
      expect(callArgs.command).toContain("python");
    });
  });

  describe("Node.js 执行", () => {
    beforeEach(() => {
      mockExecute.mockResolvedValue(
        JSON.stringify({
          exitCode: 0,
          stdout: "hello from node",
          stderr: "",
          timedOut: false,
          truncated: false,
          sandboxed: true,
        }),
      );
    });

    it("调用 run_shell 执行 node 命令", async () => {
      await executeCodeTool.execute({ code: "console.log('hello')", language: "node" });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const callArgs = mockExecute.mock.calls[0][0];
      expect(callArgs.command).toContain("node");
      expect(callArgs.command).toContain(".js");
    });

    it("返回正确的执行结果", async () => {
      const result = JSON.parse(
        await executeCodeTool.execute({ code: "console.log('hello')", language: "node" }),
      );
      expect(result.language).toBe("node");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello from node");
    });
  });

  describe("Shell 执行", () => {
    beforeEach(() => {
      mockExecute.mockResolvedValue(
        JSON.stringify({
          exitCode: 0,
          stdout: "hello from bat",
          stderr: "",
          timedOut: false,
          truncated: false,
          sandboxed: true,
        }),
      );
    });

    it("调用 run_shell 执行 cmd /c 命令", async () => {
      await executeCodeTool.execute({ code: "@echo hello", language: "shell" });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const callArgs = mockExecute.mock.calls[0][0];
      expect(callArgs.command).toContain("cmd /c");
      expect(callArgs.command).toContain(".bat");
    });
  });

  describe("运行时不存在", () => {
    it("python 不存在时添加友好提示", async () => {
      mockExecute.mockResolvedValue(
        JSON.stringify({
          exitCode: 1,
          stdout: "",
          stderr: "'python' 不是内部或外部命令，也不是可运行的程序",
          timedOut: false,
          truncated: false,
          sandboxed: false,
        }),
      );

      const result = JSON.parse(
        await executeCodeTool.execute({ code: "print(1)", language: "python" }),
      );
      expect(result.errorCode).toBe("RUNTIME_NOT_FOUND");
      expect(result.stderr).toContain("未找到 Python");
    });

    it("node 不存在时添加友好提示", async () => {
      mockExecute.mockResolvedValue(
        JSON.stringify({
          exitCode: 1,
          stdout: "",
          stderr: "'node' is not recognized as an internal or external command",
          timedOut: false,
          truncated: false,
          sandboxed: false,
        }),
      );

      const result = JSON.parse(
        await executeCodeTool.execute({ code: "console.log(1)", language: "node" }),
      );
      expect(result.errorCode).toBe("RUNTIME_NOT_FOUND");
      expect(result.stderr).toContain("未找到 Node.js");
    });
  });

  describe("超时", () => {
    it("传递 timedOut 字段", async () => {
      mockExecute.mockResolvedValue(
        JSON.stringify({
          exitCode: null,
          stdout: "partial output",
          stderr: "[已终止] 命令超过 30 分钟总上限",
          timedOut: true,
          truncated: false,
          sandboxed: true,
        }),
      );

      const result = JSON.parse(
        await executeCodeTool.execute({ code: "while True: pass", language: "python" }),
      );
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBeNull();
    });
  });

  describe("临时文件清理", () => {
    it("执行后清理临时文件", async () => {
      const tempDir = path.join(process.cwd(), ".cyrene-temp");
      // 确保目录存在
      try { fs.mkdirSync(tempDir, { recursive: true }); } catch { /* ignore */ }

      mockExecute.mockResolvedValue(
        JSON.stringify({
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          timedOut: false,
          truncated: false,
          sandboxed: true,
        }),
      );

      await executeCodeTool.execute({ code: "print(1)", language: "python" });

      // 检查 .cyrene-temp 目录下没有残留的 code_*.py 文件
      const files = fs.existsSync(tempDir)
        ? fs.readdirSync(tempDir).filter((f) => f.startsWith("code_") && f.endsWith(".py"))
        : [];
      expect(files.length).toBe(0);
    });

    it("执行失败时也清理临时文件", async () => {
      mockExecute.mockResolvedValue(
        JSON.stringify({
          exitCode: 1,
          stdout: "",
          stderr: "syntax error",
          timedOut: false,
          truncated: false,
          sandboxed: true,
        }),
      );

      await executeCodeTool.execute({ code: "invalid python code!!!", language: "python" });

      const tempDir = path.join(process.cwd(), ".cyrene-temp");
      const files = fs.existsSync(tempDir)
        ? fs.readdirSync(tempDir).filter((f) => f.startsWith("code_") && f.endsWith(".py"))
        : [];
      expect(files.length).toBe(0);
    });
  });

  describe("cwd 传递", () => {
    it("传递 cwd 给 run_shell", async () => {
      mockExecute.mockResolvedValue(
        JSON.stringify({
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          timedOut: false,
          truncated: false,
          sandboxed: true,
        }),
      );

      const testCwd = "C:\\test\\project";
      await executeCodeTool.execute({ code: "print(1)", cwd: testCwd });

      const callArgs = mockExecute.mock.calls[0][0];
      expect(callArgs.cwd).toBe(testCwd);
    });
  });

  describe("异常处理", () => {
    it("run_shell 抛异常时返回错误并清理临时文件", async () => {
      mockExecute.mockRejectedValue(new Error("run_shell internal error"));

      const result = JSON.parse(
        await executeCodeTool.execute({ code: "print(1)", language: "python" }),
      );
      expect(result.exitCode).toBe(-1);
      expect(result.stderr).toContain("执行异常");
      expect(result.stderr).toContain("run_shell internal error");

      // 临时文件已清理
      const tempDir = path.join(process.cwd(), ".cyrene-temp");
      const files = fs.existsSync(tempDir)
        ? fs.readdirSync(tempDir).filter((f) => f.startsWith("code_"))
        : [];
      expect(files.length).toBe(0);
    });

    it("run_shell 返回非 JSON 时返回原始输出", async () => {
      mockExecute.mockResolvedValue("this is not json");

      const result = JSON.parse(
        await executeCodeTool.execute({ code: "print(1)", language: "python" }),
      );
      expect(result.exitCode).toBe(-1);
      expect(result.stderr).toContain("结果解析失败");
      expect(result.stdout).toContain("this is not json");
    });
  });
});
