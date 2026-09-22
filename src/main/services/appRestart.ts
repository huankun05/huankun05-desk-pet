/**
 * 应用重启（脚本进仓库，配置进项目 data/，不依赖 %TEMP%）
 * - 提示：仅 wscript Popup（scripts/dev-restart-toast.vbs，3 秒自动消失）
 * - 开发：wscript 隐藏启动 scripts/dev-restart-worker.js
 * - 不用 PowerShell / npm / cmd，避免终端闪窗
 * - 不用 Electron Notification：Windows toast 时长不受应用控制，且会进操作中心反复可见
 */
import { app } from "electron";
import { spawn } from "child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const RESTART_SILENT_EXIT_MS = 1200;

let restarting = false;
let applicationQuitting = false;
let restartCleanup: (() => void) | null = null;

function safeLog(...args: unknown[]): void {
  try {
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    appendFileSync(join(app.getAppPath(), "data", "dev-restart.log"), "[app] " + msg + "\n");
  } catch {
    /* ignore */
  }
}

export function isRestarting(): boolean {
  return restarting;
}

export function isApplicationQuitting(): boolean {
  return applicationQuitting;
}

export function registerRestartCleanup(fn: () => void): void {
  restartCleanup = fn;
}

function spawnHiddenWscript(scriptPath: string): void {
  const child = spawn("wscript.exe", [scriptPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function showRestartToast(): void {
  try {
    // 单通道 VBS Popup：nSecondsToWait=3 自动关，不进操作中心，应用退出后仍可见
    const toastVbs = join(app.getAppPath(), "scripts", "dev-restart-toast.vbs");
    spawnHiddenWscript(toastVbs);
  } catch (err) {
    safeLog("toast error", String(err));
  }
}

function spawnDevSessionRestarter(): void {
  const projectRoot = resolve(app.getAppPath());
  const dataDir = join(projectRoot, "data");
  try {
    mkdirSync(dataDir, { recursive: true });
  } catch {
    /* ignore */
  }
  const systemNode = "E:/software/Nodejs/node.exe";
  const viteJs = join(projectRoot, "node_modules", "vite", "bin", "vite.js");
  const electronExe = join(projectRoot, "node_modules", "electron", "dist", "electron.exe");
  writeFileSync(
    join(dataDir, "dev-restart.json"),
    JSON.stringify({ parentPid: process.pid, systemNode, viteJs, electronExe, maxMs: 120000 }, null, 2),
    "utf8",
  );
  // 使用仓库内固定 VBS（引号/编码已修好），不再往 %TEMP% 写脚本
  const runnerVbs = join(projectRoot, "scripts", "dev-restart-run.vbs");
  spawnHiddenWscript(runnerVbs);
  safeLog("restarter scheduled", runnerVbs);
}

export function restartApp(): void {
  if (restarting) return;
  restarting = true;
  safeLog("restartApp start", { packaged: app.isPackaged, appPath: app.getAppPath() });
  showRestartToast();

  try {
    if (app.isPackaged) {
      app.relaunch();
    } else {
      spawnDevSessionRestarter();
    }
  } catch (err) {
    safeLog("restart schedule error", String(err));
    try {
      app.relaunch();
    } catch {
      /* ignore */
    }
  }

  try {
    restartCleanup?.();
  } catch {
    /* ignore */
  }

  setTimeout(() => {
    try {
      app.exit(0);
    } catch {
      /* ignore */
    }
    try {
      process.exit(0);
    } catch {
      /* ignore */
    }
  }, RESTART_SILENT_EXIT_MS);
}

export function quitAppFast(): void {
  if (applicationQuitting) return;
  applicationQuitting = true;
  try {
    restartCleanup?.();
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      app.exit(0);
    } catch {
      /* ignore */
    }
    try {
      process.exit(0);
    } catch {
      /* ignore */
    }
  }, 50);
}
