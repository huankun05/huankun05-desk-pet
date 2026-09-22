/**
 * 应用重启（参考 Assa/Xiyue：通知 + dev 软重启 restarter）。
 * 打包：app.relaunch()；开发：等本进程退出后重新 npm run dev，避免连到已死 Vite。
 */
import { app, Notification } from "electron";
import { spawn } from "child_process";
import { appendFileSync, existsSync, unlinkSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const RESTART_SILENT_EXIT_MS = 900;
const RESTARTER_MAX_TRIES = 120;

let restarting = false;
let applicationQuitting = false;
let restartCleanup: (() => void) | null = null;
let pendingForceKillVbsPath: string | null = null;

function safeLog(...args: unknown[]): void {
  try {
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    appendFileSync(join(app.getPath("temp"), "cyrene-dev-restart.log"), `[app] ${msg}\n`);
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

function cancelPendingForceKill(): void {
  if (!pendingForceKillVbsPath) return;
  try {
    if (existsSync(pendingForceKillVbsPath)) unlinkSync(pendingForceKillVbsPath);
  } catch {
    /* ignore */
  }
  pendingForceKillVbsPath = null;
}

process.on("exit", () => {
  cancelPendingForceKill();
});

function showRestartToast(): void {
  try {
    if (!Notification.isSupported()) return;
    const toast = new Notification({
      title: "昔涟 正在重新启动",
      body: "应用将关闭以完成重启，结束后会自动重新打开。",
    });
    toast.show();
  } catch (err) {
    safeLog("toast error", String(err));
  }
}

function spawnDevSessionRestarter(): void {
  const projectRoot = resolve(app.getAppPath());
  const pid = process.pid;
  const tempDir = app.getPath("temp");
  const logFile = join(tempDir, "cyrene-dev-restart.log");
  const scriptPath = join(tempDir, "cyrene-dev-restart-" + pid + ".js");
  const systemNode = "E:/software/Nodejs/node.exe";
  const npmCli = "E:/software/Nodejs/node_modules/npm/bin/npm-cli.js";
  const maxMs = RESTARTER_MAX_TRIES * 1000;

  const lines = [
    "const { spawn } = require('child_process');",
    "const fs = require('fs');",
    "const net = require('net');",
    "const logFile = " + JSON.stringify(logFile) + ";",
    "const projectRoot = " + JSON.stringify(projectRoot) + ";",
    "const parentPid = " + pid + ";",
    "const systemNode = " + JSON.stringify(systemNode) + ";",
    "const npmCli = " + JSON.stringify(npmCli) + ";",
    "const deadline = Date.now() + " + maxMs + ";",
    "function logLine(s){ try { fs.appendFileSync(logFile, s + String.fromCharCode(10)); } catch (e) {} }",
    "function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }",
    "function alive(p){ try { process.kill(p, 0); return true; } catch (e) { return false; } }",
    "function portFree(port){ return new Promise(ok => { const s = net.connect({port: port, host: '127.0.0.1'}, () => { s.destroy(); ok(false); }); s.on('error', () => ok(true)); setTimeout(() => { try { s.destroy(); } catch (e) {} ok(true); }, 200); }); }",
    "(async () => {",
    "  logLine('===== restarter start =====');",
    "  while (alive(parentPid) && Date.now() < deadline) await sleep(250);",
    "  logLine('parent gone');",
    "  try { fs.rmSync(projectRoot + '/dist/main/.vite-dev-url.json', { force: true }); } catch (e) {}",
    "  const portDeadline = Date.now() + 8000;",
    "  while (!(await portFree(5174)) && Date.now() < portDeadline) await sleep(200);",
    "  await sleep(400);",
    "  logLine('spawn npm run dev');",
    "  const out = fs.openSync(logFile, 'a');",
    "  const child = spawn(systemNode, [npmCli, 'run', 'dev'], { cwd: projectRoot, detached: true, stdio: ['ignore', out, out], windowsHide: true });",
    "  child.unref();",
    "  logLine('npm run dev pid=' + child.pid);",
    "  process.exit(0);",
    "})();",
  ];

  writeFileSync(scriptPath, lines.join(String.fromCharCode(10)), "utf8")
  const child = spawn(systemNode, [scriptPath], {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  safeLog("restarter scheduled (node windowsHide)", scriptPath);
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
    cancelPendingForceKill();
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
    cancelPendingForceKill();
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
