/**
 * AI 引擎进程托管 — Hermes 作为应用内置大脑，自动发现、自动拉起。
 * 对外不暴露路径；仅主进程内部解析。
 */
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import {
  discoverHermesHome,
  discoverHermesSourceDir,
  discoverUvPath,
  loadHermesSettings,
  resolveEffectiveHermesSettings,
  writeHermesRuntimeEnv,
} from "./hermes-settings";

export type EngineStatus = {
  running: boolean;
  healthy: boolean;
  detail: string;
};

let child: ChildProcess | null = null;
let starting = false;

function looksAlive(): boolean {
  return Boolean(child && child.exitCode === null && !child.killed);
}

async function pingHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function baseUrlOf(): string {
  const s = resolveEffectiveHermesSettings(loadHermesSettings());
  return `http://${s.apiHost || "127.0.0.1"}:${s.apiPort || 8642}`;
}

/** 应用启动时调用：准备环境并拉起内置引擎（失败不阻塞壳） */
export async function ensureAiEngineRunning(): Promise<EngineStatus> {
  const settings = resolveEffectiveHermesSettings(loadHermesSettings());
  if (settings.autoStartGateway === false) {
    return { running: looksAlive(), healthy: await pingHealth(baseUrlOf()), detail: "已关闭自动启动" };
  }

  writeHermesRuntimeEnv(settings);
  const url = baseUrlOf();
  if (await pingHealth(url)) {
    return { running: true, healthy: true, detail: "已在运行" };
  }
  if (starting || looksAlive()) {
    return { running: true, healthy: false, detail: "启动中" };
  }

  const sourceDir = discoverHermesSourceDir();
  const homeDir = discoverHermesHome();
  const uv = discoverUvPath();
  const hasSource = fs.existsSync(path.join(sourceDir, "cli.py"));
  if (!hasSource) {
    return { running: false, healthy: false, detail: "未找到内置引擎组件" };
  }

  starting = true;
  try {
    const env = {
      ...process.env,
      HERMES_HOME: homeDir,
      API_SERVER_KEY: settings.apiServerKey,
      API_SERVER_PORT: String(settings.apiPort || 8642),
      API_SERVER_HOST: settings.apiHost || "127.0.0.1",
    };
    const isUv = uv.toLowerCase().endsWith("uv.exe") || uv === "uv";
    const cmd = isUv ? uv : process.execPath;
    const args = isUv ? ["run", "python", "cli.py", "--gateway"] : [path.join(sourceDir, "cli.py"), "--gateway"];
    child = spawn(cmd, args, {
      cwd: sourceDir,
      env,
      stdio: "ignore",
      detached: false,
      windowsHide: true,
    });
    child.on("exit", () => {
      child = null;
    });
    // 等待 health
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await pingHealth(url)) {
        return { running: true, healthy: true, detail: "已启动" };
      }
    }
    return { running: looksAlive(), healthy: false, detail: "启动超时，可稍后刷新状态" };
  } catch (err) {
    return { running: false, healthy: false, detail: String(err) };
  } finally {
    starting = false;
  }
}

export async function getAiEngineStatus(): Promise<EngineStatus> {
  const url = baseUrlOf();
  const healthy = await pingHealth(url);
  return { running: healthy || looksAlive(), healthy, detail: healthy ? "已连接" : "未连接" };
}

export function stopAiEngine(): void {
  if (child && child.exitCode === null) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
  child = null;
}
