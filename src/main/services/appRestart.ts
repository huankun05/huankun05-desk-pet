/**
 * 应用重启服务（参考 Assa/Xiyue 的 appRestart 思路，适配本项目 npm run dev 栈）。
 *
 * 打包：app.relaunch() 后退出。  
 * 开发：electron-vite/本栈里 Vite 与 Electron 同生命周期，直接 relaunch 会连到已死的 dev server  
 * → 派生隐藏 restarter：等本进程退出后再执行 `npm run dev`。
 */
import { app, Notification } from "electron";
import { spawn } from "child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "fs";
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
    safeLog("restart toast error", String(err));
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

  const restartConfig = { parentPid: pid, projectRoot, logFile, systemNode, npmCli };
  writeFileSync(configFile, JSON.stringify(restartConfig, null, 2), "utf8");

  const script = `/* cyrene dev restarter */
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const cfg = JSON.parse(fs.readFileSync(${JSON.stringify(configFile)}, "utf8"));
const log = cfg.logFile;
function logLine(s) { try { fs.appendFileSync(log, s + "\\n"); } catch (e) {} }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function alive(p) {
  try { process.kill(p, 0); return true; } catch (e) { return false; }
}
function waitPortBusyGone(port, host) {
  if (!port) return Promise.resolve(true);
  return new Promise((ok) => {
    const sock = net.connect({ port, host: host || "127.0.0.1" }, () => { sock.destroy(); ok(false); });
    sock.on("error", () => ok(true));
    setTimeout(() => { try { sock.destroy(); } catch (e) {} ok(true); }, 250);
  });
}
(async () => {
  logLine("===== restarter start parent=" + cfg.parentPid + " root=" + cfg.projectRoot + " =====");
  const deadline = Date.now() + ${maxMs};
  while (alive(cfg.parentPid) && Date.now() < deadline) await sleep(250);
  logLine("parent gone");
  await sleep(500);
  logLine("spawn npm run dev");
  const out = fs.openSync(log, "a");
  const child = spawn(cfg.systemNode, [cfg.npmCli, "run", "dev"], {
    cwd: cfg.projectRoot,
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
  });
  child.unref();
  logLine("npm run dev detached pid=" + child.pid);
  process.exit(0);
})();
`;

  writeFileSync(scriptPath, script, "utf8");
  const vbs = [
    "Set sh = CreateObject(\\"WScript.Shell\\")",
    `sh.Run """${systemNode}"" ""${scriptPath.replace(/\\/g, "\\\\")}""", 0, False`,
  ].join("\r\n");
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
      // dev：等本进程退出后重新 npm run dev，避免连到死掉的 Vite
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
  } catch (err) {
    safeLog("restart cleanup error", String(err));
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
