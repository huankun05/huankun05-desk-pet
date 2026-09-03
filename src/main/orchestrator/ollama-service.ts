// ollama-service —— Ollama 本地模型服务管理。
// 功能：检测 Ollama 是否运行、自动启动 Ollama 服务、等待服务就绪。
// 当视觉模型/主模型使用本地 Ollama 时，如果检测到服务未运行，自动拉起。

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

/** Ollama 服务默认端口 */
const OLLAMA_DEFAULT_PORT = 11434;
/** 等待 Ollama 启动的超时时间（毫秒） */
const OLLAMA_START_TIMEOUT_MS = 30000;
/** 轮询 Ollama 服务就绪的间隔（毫秒） */
const OLLAMA_POLL_INTERVAL_MS = 1000;

let ollamaProcess: ChildProcess | null = null;

/**
 * 检测 Ollama 服务是否正在运行。
 * 通过访问 http://localhost:11434/api/tags 判断。
 */
export async function isOllamaRunning(port: number = OLLAMA_DEFAULT_PORT): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`http://localhost:${port}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * 查找 Ollama 可执行文件路径。
 * 优先从 PATH 查找，然后尝试常见安装路径。
 */
function findOllamaExecutable(): string | null {
  // 常见 Windows 安装路径
  const commonPaths = [
    "D:\\Ollama\\ollama.exe",
    "C:\\Program Files\\Ollama\\ollama.exe",
    "C:\\Users\\shangmeng\\AppData\\Local\\Programs\\Ollama\\ollama.exe",
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // 尝试从 PATH 查找（通过 where 命令）
  try {
    const { execSync } = require("node:child_process");
    const result = execSync("where ollama", { encoding: "utf-8", timeout: 5000 }).trim();
    if (result && fs.existsSync(result)) {
      return result;
    }
  } catch {
    // where 命令失败，忽略
  }

  return null;
}

/**
 * 启动 Ollama 服务（后台隐藏窗口）。
 * 如果已经启动了一个进程，先不重复启动。
 */
export function startOllama(): boolean {
  if (ollamaProcess) {
    console.log("[Ollama] 已有启动的 Ollama 进程，跳过重复启动");
    return true;
  }

  const exePath = findOllamaExecutable();
  if (!exePath) {
    console.error("[Ollama] 未找到 Ollama 可执行文件，请手动安装或启动 Ollama");
    return false;
  }

  console.log("[Ollama] 启动 Ollama 服务:", exePath);

  try {
    // 使用隐藏窗口启动 ollama serve
    ollamaProcess = spawn(exePath, ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });

    // 不等待子进程，让它在后台运行
    ollamaProcess.unref();

    ollamaProcess.on("error", (err) => {
      console.error("[Ollama] 进程启动失败:", err.message);
      ollamaProcess = null;
    });

    ollamaProcess.on("exit", (code) => {
      console.log("[Ollama] 进程退出，code:", code);
      ollamaProcess = null;
    });

    return true;
  } catch (err) {
    console.error("[Ollama] 启动异常:", err instanceof Error ? err.message : String(err));
    ollamaProcess = null;
    return false;
  }
}

/**
 * 等待 Ollama 服务就绪。
 * 轮询 /api/tags 接口，直到服务可用或超时。
 */
export async function waitForOllamaReady(
  port: number = OLLAMA_DEFAULT_PORT,
  timeoutMs: number = OLLAMA_START_TIMEOUT_MS,
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await isOllamaRunning(port)) {
      console.log("[Ollama] 服务已就绪，耗时:", Date.now() - startTime, "ms");
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, OLLAMA_POLL_INTERVAL_MS));
  }

  console.error("[Ollama] 等待服务就绪超时（", timeoutMs, "ms）");
  return false;
}

/**
 * 确保 Ollama 服务正在运行。
 * 如果未运行，自动启动并等待就绪。
 * @returns 是否成功确保服务运行
 */
export async function ensureOllamaRunning(port: number = OLLAMA_DEFAULT_PORT): Promise<boolean> {
  // 先检测是否已经在运行
  if (await isOllamaRunning(port)) {
    console.log("[Ollama] 服务已在运行");
    return true;
  }

  console.log("[Ollama] 检测到服务未运行，尝试自动启动...");

  // 尝试启动
  if (!startOllama()) {
    return false;
  }

  // 等待就绪
  return waitForOllamaReady(port);
}

/**
 * 判断给定的 baseUrl 是否是本地 Ollama 地址。
 */
export function isLocalOllamaUrl(baseUrl: string): boolean {
  if (!baseUrl) return false;
  const lower = baseUrl.toLowerCase();
  return lower.includes("localhost:11434") || lower.includes("127.0.0.1:11434");
}
