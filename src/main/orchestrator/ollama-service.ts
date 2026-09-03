// ollama-service —— Ollama 本地模型服务管理。
// 功能：检测 Ollama 是否运行、自动启动 Ollama 服务、等待服务就绪。
// 当视觉模型/主模型使用本地 Ollama 时，如果检测到服务未运行，自动拉起。
//
// 改进：
// 1. 全局锁 + 启动中状态：确保一次性拉起，避免并发请求重复启动导致终端闪烁
// 2. PowerShell Start-Process -WindowStyle Hidden：真正静默启动，无控制台窗口
// 3. 启动前双重检测（HTTP 接口 + 进程列表），避免重复启动

import * as fs from "node:fs";
import { execFile } from "node:child_process";

/** Ollama 服务默认端口 */
const OLLAMA_DEFAULT_PORT = 11434;
/** 等待 Ollama 启动的超时时间（毫秒） */
const OLLAMA_START_TIMEOUT_MS = 30000;
/** 轮询 Ollama 服务就绪的间隔（毫秒） */
const OLLAMA_POLL_INTERVAL_MS = 1000;

/** 启动中状态：true 表示正在启动，后续请求直接等待 */
let isStarting = false;
/** 启动 Promise：用于并发请求等待同一次启动完成 */
let startPromise: Promise<boolean> | null = null;

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
 * 优先从常见安装路径查找，然后尝试 PATH。
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
 * 检查系统中是否已有 Ollama 进程在运行。
 * 通过任务列表检查，避免重复启动。
 */
function isOllamaProcessRunning(): boolean {
  try {
    const { execSync } = require("node:child_process");
    const output = execSync('tasklist /FI "IMAGENAME eq ollama.exe" /NH', {
      encoding: "utf-8",
      timeout: 5000,
    });
    return output.toLowerCase().includes("ollama.exe");
  } catch {
    return false;
  }
}

/**
 * 使用 PowerShell Start-Process 静默启动 Ollama。
 * -WindowStyle Hidden 确保无控制台窗口闪烁
 * -PassThru 返回进程对象（但我们不跟踪，让它独立运行）
 */
function startOllamaSilent(exePath: string): boolean {
  return new Promise<boolean>((resolve) => {
    // 使用 powershell.exe 的 Start-Process 启动，-WindowStyle Hidden 真正隐藏窗口
    const psCommand = `Start-Process -FilePath "${exePath}" -ArgumentList "serve" -WindowStyle Hidden -PassThru | Out-Null`;

    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", psCommand],
      {
        timeout: 10000,
        windowsHide: true,
      },
      (error) => {
        if (error) {
          console.error("[Ollama] PowerShell 启动失败:", error.message);
          resolve(false);
        } else {
          console.log("[Ollama] PowerShell 静默启动命令已执行");
          resolve(true);
        }
      },
    );
  }) as unknown as boolean;
}

/**
 * 启动 Ollama 服务（静默，无终端窗口）。
 * 如果已经启动或正在启动，不重复启动。
 */
async function doStartOllama(): Promise<boolean> {
  // 双重检测：HTTP 接口 + 进程列表
  if (await isOllamaRunning()) {
    console.log("[Ollama] 服务已在运行（HTTP 检测），跳过启动");
    return true;
  }
  if (isOllamaProcessRunning()) {
    console.log("[Ollama] 检测到 Ollama 进程已存在，等待服务就绪...");
    return waitForOllamaReady();
  }

  const exePath = findOllamaExecutable();
  if (!exePath) {
    console.error("[Ollama] 未找到 Ollama 可执行文件，请手动安装或启动 Ollama");
    return false;
  }

  console.log("[Ollama] 静默启动 Ollama 服务:", exePath);

  const started = await startOllamaSilent(exePath);
  if (!started) {
    return false;
  }

  // 等待服务就绪
  return waitForOllamaReady();
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
 * 全局锁确保并发请求只启动一次，后续请求等待同一次启动完成。
 * @returns 是否成功确保服务运行
 */
export async function ensureOllamaRunning(port: number = OLLAMA_DEFAULT_PORT): Promise<boolean> {
  // 快速路径：已经在运行，直接返回
  if (await isOllamaRunning(port)) {
    return true;
  }

  // 如果正在启动，等待同一次启动完成，不重复启动
  if (isStarting && startPromise) {
    console.log("[Ollama] 检测到正在启动中，等待启动完成...");
    return startPromise;
  }

  // 开始启动，设置全局锁
  isStarting = true;
  startPromise = doStartOllama();

  try {
    const result = await startPromise;
    return result;
  } finally {
    // 启动完成后清除状态
    isStarting = false;
    startPromise = null;
  }
}

/**
 * 判断给定的 baseUrl 是否是本地 Ollama 地址。
 */
export function isLocalOllamaUrl(baseUrl: string): boolean {
  if (!baseUrl) return false;
  const lower = baseUrl.toLowerCase();
  return lower.includes("localhost:11434") || lower.includes("127.0.0.1:11434");
}
