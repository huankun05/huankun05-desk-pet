// ── 工具：execute_code ─────────────────────────────────────
// 执行代码片段（Python / Node.js / Shell），写入临时文件后用对应运行时执行。
//
// 设计原则：
// - 完全复用 run_shell 的安全执行逻辑（沙箱包装、双计时器、进程树终止、输出解码、权限档位）
// - execute_code 只负责：写入临时文件 → 构建运行时命令 → 调用 run_shell → 清理临时文件
// - 临时文件放在 cwd 下的 .cyrene-temp/ 目录，确保沙箱能访问
// - 语言运行时不可用时，命令会自然失败，返回明确错误（不预检测，避免额外开销）
//
// 与 run_shell 的区别：
// - run_shell：用户直接给命令字符串（cmd/bash 语法），通用命令执行
// - execute_code：用户给代码片段，有明确的语言运行时，更适合写代码/跑脚本/快速验证

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ToolDefinition } from "../registry/tool-registry";
import { runShellTool } from "./run-shell-tool";
import { logger, LogTag } from "../../../logger";

const LOG_PREFIX = "[BuiltinTools]";

// ── 语言运行时配置 ─────────────────────────────────────────

interface LanguageRuntime {
  /** 运行时命令（Windows 上 python/node 都在 PATH 里） */
  command: string;
  /** 临时文件扩展名 */
  extension: string;
  /** 运行时不存在时的错误提示 */
  notFoundHint: string;
}

const LANGUAGE_RUNTIMES: Record<string, LanguageRuntime> = {
  python: {
    command: "python",
    extension: ".py",
    notFoundHint: "未找到 Python。请安装 Python 3.x 并确保 python 在 PATH 中。",
  },
  node: {
    command: "node",
    extension: ".js",
    notFoundHint: "未找到 Node.js。请安装 Node.js 并确保 node 在 PATH 中。",
  },
  shell: {
    command: "cmd",
    extension: ".bat",
    notFoundHint: "Shell 执行失败。",
  },
};

export type CodeLanguage = keyof typeof LANGUAGE_RUNTIMES;

// ── 临时文件管理 ───────────────────────────────────────────

/**
 * 写入代码到临时文件，返回文件路径。
 * 临时文件放在 cwd 下的 .cyrene-temp/ 目录，确保沙箱能访问。
 */
function writeCodeToTempFile(
  code: string,
  language: CodeLanguage,
  cwd?: string,
): { filePath: string; tempDir: string } {
  const runtime = LANGUAGE_RUNTIMES[language];
  const baseDir = cwd || process.cwd();
  const tempDir = path.join(baseDir, ".cyrene-temp");

  // 确保临时目录存在
  try {
    fs.mkdirSync(tempDir, { recursive: true });
  } catch (err) {
    logger.warn(LogTag.BuiltinTools, `[execute_code] mkdir temp dir failed: ${tempDir}`, err);
    // 回退到系统 temp 目录
    const fallbackDir = path.join(os.tmpdir(), "cyrene-code");
    fs.mkdirSync(fallbackDir, { recursive: true });
    return { filePath: path.join(fallbackDir, `code_${Date.now()}${runtime.extension}`), tempDir: fallbackDir };
  }

  const filePath = path.join(tempDir, `code_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${runtime.extension}`);
  fs.writeFileSync(filePath, code, "utf8");
  return { filePath, tempDir };
}

/** 安全删除临时文件（忽略错误） */
function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    logger.warn(LogTag.BuiltinTools, `[execute_code] cleanup temp file failed: ${filePath}`, err);
  }
}

// ── 执行逻辑 ───────────────────────────────────────────────

interface ExecuteCodeResult {
  language: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  /** 是否经沙箱执行 */
  sandboxed: boolean;
  /** 运行时错误（如未找到 Python） */
  errorCode?: string;
}

async function executeCode(
  args: Record<string, unknown>,
  context?: import("../registry/tool-context").ToolContext,
): Promise<string> {
  const language = String(args.language || "python").toLowerCase() as CodeLanguage;
  const code = String(args.code || "");
  const cwd = args.cwd ? String(args.cwd) : undefined;

  if (!code.trim()) {
    return JSON.stringify({
      language,
      exitCode: -1,
      stdout: "",
      stderr: "[错误] code 不能为空",
      timedOut: false,
      truncated: false,
      sandboxed: false,
    });
  }

  if (!(language in LANGUAGE_RUNTIMES)) {
    return JSON.stringify({
      language,
      exitCode: -1,
      stdout: "",
      stderr: `[错误] 不支持的语言: ${language}。支持: ${Object.keys(LANGUAGE_RUNTIMES).join(", ")}`,
      timedOut: false,
      truncated: false,
      sandboxed: false,
    });
  }

  const runtime = LANGUAGE_RUNTIMES[language];

  // 1. 写入临时文件
  let tempFilePath: string;
  try {
    const result = writeCodeToTempFile(code, language, cwd);
    tempFilePath = result.filePath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({
      language,
      exitCode: -1,
      stdout: "",
      stderr: `[错误] 写入临时文件失败: ${msg}`,
      timedOut: false,
      truncated: false,
      sandboxed: false,
    });
  }

  logger.info(LogTag.BuiltinTools, `[execute_code] entry: language=${language} cwd=${cwd || "(undefined)"} tempFile=${tempFilePath} codeLen=${code.length}`);

  // 2. 构建运行时命令
  // Windows 路径含空格时需要引号
  const quotedPath = `"${tempFilePath}"`;
  let command: string;
  if (language === "shell") {
    // shell 语言：直接执行 .bat 文件
    command = `cmd /c ${quotedPath}`;
  } else {
    command = `${runtime.command} ${quotedPath}`;
  }

  // 3. 调用 run_shell 执行（复用沙箱、双计时器、进程树终止、输出解码）
  let shellResult: string;
  try {
    shellResult = await runShellTool.execute(
      { command, cwd, shell: "cmd" },
      context,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    cleanupTempFile(tempFilePath);
    return JSON.stringify({
      language,
      exitCode: -1,
      stdout: "",
      stderr: `[执行异常] ${msg}`,
      timedOut: false,
      truncated: false,
      sandboxed: false,
    });
  }

  // 4. 清理临时文件（无论成功失败都清理）
  cleanupTempFile(tempFilePath);

  // 5. 解析 run_shell 返回的 JSON，转换为 execute_code 格式
  try {
    const parsed = JSON.parse(shellResult) as {
      exitCode: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
      truncated: boolean;
      sandboxed: boolean;
      errorCode?: string;
    };

    const result: ExecuteCodeResult = {
      language,
      exitCode: parsed.exitCode,
      stdout: parsed.stdout,
      stderr: parsed.stderr,
      timedOut: parsed.timedOut,
      truncated: parsed.truncated,
      sandboxed: parsed.sandboxed,
    };

    // 运行时不存在时，stderr 通常会包含 "'python' 不是内部或外部命令" 或类似信息
    // 在这里补充更友好的提示
    if (parsed.exitCode !== 0 && parsed.exitCode !== null) {
      const stderrLower = (parsed.stderr || "").toLowerCase();
      if (
        stderrLower.includes("不是内部或外部命令") ||
        stderrLower.includes("not recognized") ||
        stderrLower.includes("command not found") ||
        stderrLower.includes("no such file or directory")
      ) {
        result.stderr = `${parsed.stderr}\n\n[提示] ${runtime.notFoundHint}`;
        result.errorCode = "RUNTIME_NOT_FOUND";
      }
    }

    logger.info(LogTag.BuiltinTools, `[execute_code] done: language=${language} exitCode=${result.exitCode} timedOut=${result.timedOut} stdoutLen=${result.stdout.length} stderrLen=${result.stderr.length} sandboxed=${result.sandboxed}`);

    return JSON.stringify(result);
  } catch (err) {
    // 解析失败时返回原始输出
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({
      language,
      exitCode: -1,
      stdout: shellResult.slice(0, 4000),
      stderr: `[结果解析失败] ${msg}`,
      timedOut: false,
      truncated: true,
      sandboxed: false,
    });
  }
}

// ── 工具定义 ───────────────────────────────────────────────

export const executeCodeTool: ToolDefinition = {
  id: "execute_code",
  name: "执行代码",
  description:
    "执行代码片段（Python / Node.js / Shell），写入临时文件后用对应运行时执行。返回 exitCode + stdout + stderr。\n\n" +
    "支持语言：\n" +
    "- python：Python 3.x，需要系统已安装 Python 且 python 在 PATH 中\n" +
    "- node：Node.js，需要系统已安装 Node.js 且 node 在 PATH 中\n" +
    "- shell：Windows 批处理（.bat），用 cmd.exe 执行\n\n" +
    "何时用：\n" +
    "- 快速验证一段代码逻辑\n" +
    "- 跑数据处理脚本（Python pandas / Node.js 脚本）\n" +
    "- 计算/转换/生成内容\n" +
    "- 调用 API 测试\n" +
    "- 用户明确要求'跑一下这段代码'\n\n" +
    "不要用于：\n" +
    "- 执行系统命令（git/npm/pip 等）→ run_shell（更适合命令行操作）\n" +
    "- 读文件 → read_file\n" +
    "- 写文件 → write_file\n" +
    "- 启动常驻进程（dev server / watch）→ 本工具只适合跑完就退出的代码，常驻进程会在 2 分钟无输出后被强制终止\n\n" +
    "安全说明：非完全信任档位下，代码在沙箱中执行（限制文件系统访问范围）。" +
    "代码写入工作区下的 .cyrene-temp/ 临时目录，执行后自动清理。\n" +
    "参数：language (python/node/shell，默认 python)，code (代码内容)，cwd (可选工作目录绝对路径)。",
  enabled: true,
  risk: "shell",
  modes: ["code", "work"],
  effectKind: "unknown" as const,
  inputSchema: {
    type: "object",
    properties: {
      language: {
        type: "string",
        enum: ["python", "node", "shell"],
        default: "python",
        description: "编程语言：python（默认）/ node / shell",
      },
      code: {
        type: "string",
        description: "要执行的代码内容",
      },
      cwd: {
        type: "string",
        description: "工作目录绝对路径，可选。不指定时使用当前工作区",
      },
    },
    required: ["code"],
  },
  execute: executeCode,
};
