const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/main/services/appRestart.ts";

const src = `/**
 * 应用重启（Assa 思路 + Windows 可见性修正）
 * - 提示：Notification + wscript Popup（图形框，无控制台）；应用退出后 restarter 仍可再提示
 * - 开发：wscript 隐藏启动 node restarter → 静默 vite + electron
 * - 禁止在此路径使用 PowerShell / npm / cmd——它们都会闪终端
 */
import { app, Notification } from "electron";
import { spawn } from "child_process";
import { appendFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const RESTART_SILENT_EXIT_MS = 1200;
const RESTARTER_MAX_TRIES = 120;

let restarting = false;
let applicationQuitting = false;
let restartCleanup: (() => void) | null = null;

function safeLog(...args: unknown[]): void {
  try {
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    appendFileSync(join(app.getPath("temp"), "cyrene-dev-restart.log"), "[app] " + msg + "\\n");
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

/** wscript 隐藏启动（无终端）。Assa 同款。 */
function spawnHiddenWscript(scriptPath: string): void {
  const child = spawn("wscript.exe", [scriptPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

/** 重启提示：通知 + 图形弹窗（Popup），不经过 PowerShell，不闪终端 */
function showRestartToast(): void {
  try {
    if (Notification.isSupported()) {
      const toast = new Notification({
        title: "昔涟 正在重新启动",
        body: "请稍候，将自动重新打开…",
      });
      toast.show();
    }
  } catch (err) {
    safeLog("notification error", String(err));
  }

  // WScript.Shell.Popup：图形框，wscript 为 GUI 子系统，无黑色终端
  try {
    const tempDir = app.getPath("temp");
    const vbsPath = join(tempDir, "cyrene-restart-toast.vbs");
    const vbs = [
      'Set sh = CreateObject("WScript.Shell")',
      'sh.Popup "昔涟 正在重新启动…\\n请稍候，将自动重新打开。", 4, "昔涟", 64',
    ].join("\\r\\n");
    writeFileSync(vbsPath, vbs, "ascii");
    spawnHiddenWscript(vbsPath);
  } catch (err) {
    safeLog("popup error", String(err));
  }
}

/** 开发模式：wscript 拉起隐藏 node restarter，再静默 vite + electron */
function spawnDevSessionRestarter(): void {
  const projectRoot = resolve(app.getAppPath());
  const pid = process.pid;
  const tempDir = app.getPath("temp");
  const logFile = join(tempDir, "cyrene-dev-restart.log");
  const scriptPath = join(tempDir, "cyrene-dev-restart-" + pid + ".js");
  const runnerVbs = join(tempDir, "cyrene-dev-restart-" + pid + ".vbs");
  const systemNode = "E:/software/Nodejs/node.exe";
  const viteJs = join(projectRoot, "node_modules", "vite", "bin", "vite.js");
  const electronExe = join(projectRoot, "node_modules", "electron", "dist", "electron.exe");
  const maxMs = RESTARTER_MAX_TRIES * 1000;

  const scriptLines = [
    "const { spawn } = require('child_process');",
    "const fs = require('fs');",
    "const net = require('net');",
    "const http = require('http');",
    "const logFile = " + JSON.stringify(logFile) + ";",
    "const projectRoot = " + JSON.stringify(projectRoot) + ";",
    "const parentPid = " + pid + ";",
    "const systemNode = " + JSON.stringify(systemNode) + ";",
    "const viteJs = " + JSON.stringify(viteJs) + ";",
    "const electronExe = " + JSON.stringify(electronExe) + ";",
    "const deadline = Date.now() + " + maxMs + ";",
    "function logLine(s){ try { fs.appendFileSync(logFile, s + String.fromCharCode(10)); } catch (e) {} }",
    "function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }",
    "function alive(p){ try { process.kill(p, 0); return true; } catch (e) { return false; } }",
    "function portFree(port){ return new Promise(ok => { const s = net.connect({port: port, host: '127.0.0.1'}, () => { s.destroy(); ok(false); }); s.on('error', () => ok(true)); setTimeout(() => { try { s.destroy(); } catch (e) {} ok(true); }, 200); }); }",
    "function viteUp(){ return new Promise(ok => { const req = http.get('http://127.0.0.1:5174/react/', res => { res.resume(); ok(res.statusCode > 0); }); req.on('error', () => ok(false)); req.setTimeout(1500, () => { try { req.destroy(); } catch (e) {} ok(false); }); }); }",
    "function silent(cmd, args, env){ return spawn(cmd, args, { cwd: projectRoot, detached: true, stdio: 'ignore', windowsHide: true, shell: false, env: Object.assign({}, process.env, env || {}) }); }",
    "(async () => {",
    "  logLine('===== restarter start =====');",
    "  while (alive(parentPid) && Date.now() < deadline) await sleep(200);",
    "  logLine('parent gone');",
    "  try { fs.rmSync(projectRoot + '/dist/main/.vite-dev-url.json', { force: true }); } catch (e) {}",
    "  const portDeadline = Date.now() + 6000;",
    "  while (!(await portFree(5174)) && Date.now() < portDeadline) await sleep(150);",
    "  logLine('spawn vite silent');",
    "  const vite = silent(systemNode, [viteJs]);",
    "  vite.unref();",
    "  let up = false;",
    "  for (let i = 0; i < 80 && !up; i++) { up = await viteUp(); if (!up) await sleep(250); }",
    "  logLine('vite up=' + up);",
    "  await sleep(300);",
    "  logLine('spawn electron silent');",
    "  const el = silent(electronExe, ['.'], { VITE_DEV: '1' });",
    "  el.unref();",
    "  logLine('electron pid=' + el.pid);",
    "  process.exit(0);",
    "})();",
  ];

  writeFileSync(scriptPath, scriptLines.join("\\n"), "utf8");

  // wscript 启动 node（GUI 子系统，无黑色终端）——与 Assa 相同
  const runner =
    'Set sh = CreateObject("WScript.Shell")\\r\\n' +
    'sh.Run """' + systemNode + '"" """' + scriptPath + '"""", 0, False';
  writeFileSync(runnerVbs, runner, "ascii");
  spawnHiddenWscript(runnerVbs);
  safeLog("restarter scheduled via wscript", scriptPath);
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
`;

fs.writeFileSync(f, src, "utf8");
console.log("rewritten", src.includes("WScript.Shell"), src.includes("windowsHide: true"));
