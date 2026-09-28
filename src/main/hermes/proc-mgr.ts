/**
 * AI 引擎进程托管 — Hermes 作为应用内置大脑，自动发现、自动拉起。
 * 对外不暴露路径；仅主进程内部解析。
 *
 * 崩溃自愈（watchdog）：gateway 意外退出后按指数退避自动重启
 * （1s→2s→4s→…→30s 封顶），恢复健康后退避档位归零；
 * stopAiEngine() 视为人工干预，不触发自愈。
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
import type { HermesSettings } from "../../shared/hermes-settings-types";

export type EngineStatus = {
  running: boolean;
  healthy: boolean;
  detail: string;
  /** 本次会话 watchdog 自动重启次数（诊断用） */
  restarts?: number;
};

/** 可注入依赖（测试 seam）：睡眠 / 健康探测 / 退避档位 / 健康等待轮数 / 定时器 */
export interface ProcMgrDeps {
  sleep: (ms: number) => Promise<void>;
  pingHealth: (baseUrl: string) => Promise<boolean>;
  /** 指数退避序列（毫秒），末位封顶 */
  backoffMs: number[];
  /** 每次拉起后等待 health 的轮询次数（1s 间隔） */
  healthWaitPolls: number;
  /** watchdog 定时器 */
  schedule: (fn: () => void, delayMs: number) => { clear(): void };
}

async function pingHealthDefault(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

const defaultDeps: ProcMgrDeps = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  pingHealth: pingHealthDefault,
  backoffMs: [1000, 2000, 4000, 8000, 16000, 30000],
  healthWaitPolls: 30,
  schedule: (fn, delayMs) => {
    const t = setTimeout(fn, delayMs);
    return { clear: () => clearTimeout(t) };
  },
};

let deps: ProcMgrDeps = defaultDeps;

/** @internal 测试专用：注入 sleep/ping/退避/定时器；部分字段基于当前值合并 */
export function __setProcMgrDepsForTest(patch: Partial<ProcMgrDeps>): void {
  deps = { ...deps, ...patch };
}

/** @internal 测试专用：整体复位为默认依赖 */
export function __resetProcMgrDepsForTest(): void {
  deps = defaultDeps;
}

let child: ChildProcess | null = null;
let starting = false;
// ── watchdog 状态 ──
let stopping = false; // 人工停止：不再自愈（ensureAiEngineRunning 会重新启用）
let respawnTimer: { clear(): void } | null = null;
let backoffIndex = 0; // 连续失败计数 → 退避档位
let restartsTotal = 0; // 自愈重启计数（诊断）

function looksAlive(): boolean {
  return Boolean(child && child.exitCode === null && !child.killed);
}

function baseUrlOf(): string {
  const s = resolveEffectiveHermesSettings(loadHermesSettings());
  return `http://${s.apiHost || "127.0.0.1"}:${s.apiPort || 8642}`;
}

function clearRespawnTimer(): void {
  respawnTimer?.clear();
  respawnTimer = null;
}

function nextBackoffMs(): number {
  return deps.backoffMs[Math.min(backoffIndex, deps.backoffMs.length - 1)];
}

/** gateway 意外退出 → 按当前退避档位计划自愈重启 */
function scheduleRespawn(): void {
  if (stopping) return;
  const delay = nextBackoffMs();
  backoffIndex += 1;
  restartsTotal += 1;
  clearRespawnTimer();
  respawnTimer = deps.schedule(() => {
    respawnTimer = null;
    void respawnNow();
  }, delay);
  console.warn(`[Hermes/proc-mgr] gateway 退出，${delay}ms 后自动重启（第 ${restartsTotal} 次）`);
}

async function respawnNow(): Promise<void> {
  if (stopping) return;
  if (resolveEffectiveHermesSettings(loadHermesSettings()).autoStartGateway === false) return;
  // 端口可能已被其他实例接管：先 ping，活着就视为恢复
  if (await deps.pingHealth(baseUrlOf())) {
    backoffIndex = 0;
    return;
  }
  if (starting || looksAlive()) {
    // 上一进程仍在启动中：继续按退避等待，不重复 spawn
    scheduleRespawn();
    return;
  }
  const settings = resolveEffectiveHermesSettings(loadHermesSettings());
  writeHermesRuntimeEnv(settings);
  const status = await spawnAndWait(settings);
  if (status.healthy) {
    backoffIndex = 0;
    return;
  }
  scheduleRespawn();
}

/** 应用启动时调用：准备环境并拉起内置引擎（失败不阻塞壳） */
export async function ensureAiEngineRunning(): Promise<EngineStatus> {
  const settings = resolveEffectiveHermesSettings(loadHermesSettings());
  if (settings.autoStartGateway === false) {
    return {
      running: looksAlive(),
      healthy: await deps.pingHealth(baseUrlOf()),
      detail: "已关闭自动启动",
      restarts: restartsTotal,
    };
  }
  stopping = false; // 启动路径重新启用自愈
  writeHermesRuntimeEnv(settings);
  const url = baseUrlOf();
  if (await deps.pingHealth(url)) {
    return { running: true, healthy: true, detail: "已在运行", restarts: restartsTotal };
  }
  if (starting || looksAlive()) {
    return { running: true, healthy: false, detail: "启动中", restarts: restartsTotal };
  }
  return spawnAndWait(settings);
}

/** spawn + 等待 health（ensure 与 watchdog 自愈共用核心） */
async function spawnAndWait(settings: HermesSettings): Promise<EngineStatus> {
  const sourceDir = discoverHermesSourceDir();
  const homeDir = discoverHermesHome();
  const uv = discoverUvPath();
  const hasSource = fs.existsSync(path.join(sourceDir, "cli.py"));
  if (!hasSource) {
    return { running: false, healthy: false, detail: "未找到内置引擎组件", restarts: restartsTotal };
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
    const url = baseUrlOf();
    const proc = spawn(cmd, args, {
      cwd: sourceDir,
      env,
      stdio: "ignore",
      detached: false,
      windowsHide: true,
    });
    child = proc;
    proc.on("exit", (code) => {
      if (child === proc) child = null;
      if (stopping) return;
      scheduleRespawn();
    });
    // 等待 health
    for (let i = 0; i < deps.healthWaitPolls; i++) {
      await deps.sleep(1000);
      if (await deps.pingHealth(url)) {
        return { running: true, healthy: true, detail: "已启动", restarts: restartsTotal };
      }
    }
    return {
      running: looksAlive(),
      healthy: false,
      detail: "启动超时，可稍后刷新状态",
      restarts: restartsTotal,
    };
  } catch (err) {
    return { running: false, healthy: false, detail: String(err), restarts: restartsTotal };
  } finally {
    starting = false;
  }
}

export async function getAiEngineStatus(): Promise<EngineStatus> {
  const url = baseUrlOf();
  const healthy = await deps.pingHealth(url);
  return {
    running: healthy || looksAlive(),
    healthy,
    detail: healthy ? "已连接" : "未连接",
    restarts: restartsTotal,
  };
}

/** 人工重启：停掉当前实例（不触发自愈）并重新拉起 */
export async function restartAiEngine(): Promise<EngineStatus> {
  stopAiEngine();
  return ensureAiEngineRunning();
}

/** 人工停止：杀进程并取消 watchdog（此后不再自愈，直到下次 ensureAiEngineRunning） */
export function stopAiEngine(): void {
  stopping = true;
  clearRespawnTimer();
  backoffIndex = 0; // 人工干预结束本次失败周期，下次自愈从最小退避开始
  if (child && child.exitCode === null) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
  child = null;
}
