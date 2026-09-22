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
  const configFile = join(tempDir, `cyrene-dev-restart-${pid}.json`);
  const scriptPath = join(tempDir, `cyrene-dev-restart-${pid}.js`);
  const vbsPath = join(tempDir, `cyrene-dev-restart-${pid}.vbs`);
  const systemNode = "E:/software/Nodejs/node.exe";
  const npmCli = "E:/software/Nodejs/node_modules/npm/bin/npm-cli.js";
  const maxMs = RESTARTER_MAX_TRIES * 1000;

  writeFileSync(
    configFile,
    JSON.stringify({ parentPid: pid, projectRoot, logFile, systemNode, npmCli }, null, 2),
    "utf8",
  );

  const script = [
    "/* cyrene dev restarter */",
    'const { spawn } = require("child_process");',
    'const fs = require("fs");',
    "const cfg = JSON.parse(fs.readFileSync(" + JSON.stringify(configFile) + ', "utf8"));',
    "function logLine(s) { try { fs.appendFileSync(cfg.logFile, s + \"\\\\n\"); } catch (e) {} }",
    "function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }",
    "function alive(p) { try { process.kill(p, 0); return true; } catch (e) { return false; } }",
    "(async () => {",
    "  logLine('===== restarter start parent=' + cfg.parentPid + ' =====');",
    "  const deadline = Date.now() + " + String(maxMs) + ";",
    "  while (alive(cfg.parentPid) && Date.now() < deadline) await sleep(250);",
    "  logLine('parent gone');",
    "  await sleep(500);",
    "  logLine('spawn npm run dev');",
    "  const out = fs.openSync(cfg.logFile, 'a');",
    "  const child = spawn(cfg.systemNode, [cfg.npmCli, 'run', 'dev'], {",
    "    cwd: cfg.projectRoot,",
    "    detached: true,",
    "    stdio: ['ignore', out, out],",
    "    windowsHide: true,",
    "  });",
    "  child.unref();",
    "  logLine('npm run dev pid=' + child.pid);",
    "  process.exit(0);",
    "})();",
  ].join("\n");

  writeFileSync(scriptPath, script, "utf8");

  // VBS 隐藏窗口调用 node 脚本（不用 PowerShell，避免安全软件拦截）
  const vbs =
    'Set sh = CreateObject("WScript.Shell")\r\n' +
    'sh.Run """' + systemNode + '"" """' + scriptPath + '"""", 0, False';
  writeFileSync(vbsPath, vbs, "ascii");
  appendFileSync(logFile, `===== scheduled pid=${pid} root=${projectRoot} =====\n`);

  const child = spawn("wscript.exe", [vbsPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    cwd: projectRoot,
  });
  child.unref();
  safeLog("restarter scheduled", scriptPath);
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
