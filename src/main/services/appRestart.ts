/**
 * 应用重启（Assa 思路）：
 * - 提示：应用内右下角 toast（不依赖系统通知）
 * - 开发：隐藏 Node restarter → 等旧进程退出 → 快速拉起 vite+electron（不重复编译）
 * - 打包：app.relaunch()
 */
import { app, BrowserWindow, screen } from "electron";
import { spawn } from "child_process";
import { appendFileSync, existsSync, unlinkSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const RESTART_SILENT_EXIT_MS = 1200;
const RESTARTER_MAX_TRIES = 120;

let restarting = false;
let applicationQuitting = false;
let restartCleanup: (() => void) | null = null;

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

/** 右下角应用内 toast（必现，不依赖系统通知权限） */
function showRestartToast(): void {
  try {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;
    const w = 320;
    const h = 64;
    const win = new BrowserWindow({
      width: w,
      height: h,
      x: width - w - 16,
      y: height - h - 16,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
    });
    const html = `data:text/html;charset=utf-8,${encodeURIComponent(
      `<!doctype html><html><body style="margin:0;font:13px/1.4 system-ui,sans-serif;">
<div style="margin:6px;padding:12px 14px;border-radius:10px;background:rgba(28,28,30,.92);color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.25);">
  <b>昔涟 正在重新启动</b><br/><span style="opacity:.85">请稍候，将自动重新打开…</span>
</div></body></html>`,
    )}`;
    void win.loadURL(html);
    win.once("ready-to-show", () => {
      win.show();
      setTimeout(() => {
        try {
          if (!win.isDestroyed()) win.close();
        } catch {
          /* ignore */
        }
      }, RESTART_SILENT_EXIT_MS - 200);
    });
  } catch (err) {
    safeLog("toast error", String(err));
  }
}

function spawnDevSessionRestarter(): void {
  const projectRoot = resolve(app.getAppPath());
  const pid = process.pid;
  const tempDir = app.getPath("temp");
  const logFile = join(tempDir, "cyrene-dev-restart.log");
  const scriptPath = join(tempDir, `cyrene-dev-restart-${pid}.js`);
  const systemNode = "E:/software/Nodejs/node.exe";
  const npmCli = "E:/software/Nodejs/node_modules/npm/bin/npm-cli.js";
  const maxMs = RESTARTER_MAX_TRIES * 1000;

  const lines = [
    "const { spawn } = require('child_process');",
    "const fs = require('fs');",
    "const net = require('net');",
    `const logFile = ${JSON.stringify(logFile)};`,
    `const projectRoot = ${JSON.stringify(projectRoot)};`,
    `const parentPid = ${pid};`,
    `const systemNode = ${JSON.stringify(systemNode)};`,
    `const npmCli = ${JSON.stringify(npmCli)};`,
    `const deadline = Date.now() + ${maxMs};`,
    "function logLine(s){ try { fs.appendFileSync(logFile, s + String.fromCharCode(10)); } catch (e) {} }",
    "function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }",
    "function alive(p){ try { process.kill(p, 0); return true; } catch (e) { return false; } }",
    "function portFree(port){ return new Promise(ok => { const s = net.connect({port: port, host: '127.0.0.1'}, () => { s.destroy(); ok(false); }); s.on('error', () => ok(true)); setTimeout(() => { try { s.destroy(); } catch (e) {} ok(true); }, 200); }); }",
    "(async () => {",
    "  logLine('===== restarter start =====');",
    "  while (alive(parentPid) && Date.now() < deadline) await sleep(200);",
    "  logLine('parent gone');",
    "  try { fs.rmSync(projectRoot + '/dist/main/.vite-dev-url.json', { force: true }); } catch (e) {}",
    "  const portDeadline = Date.now() + 6000;",
    "  while (!(await portFree(5174)) && Date.now() < portDeadline) await sleep(150);",
    "  await sleep(250);",
    // 快速重启：不重复 build:main/preload，直接 vite + electron（dist 已就绪）
    "  logLine('spawn npm run dev:quick (silent)');",
    "  const out = fs.openSync(logFile, 'a');",
    "  const child = spawn(systemNode, [npmCli, 'run', 'dev:quick'], { cwd: projectRoot, detached: true, stdio: ['ignore', out, out], windowsHide: true, shell: false });",
    "  child.unref();",
    "  logLine('dev:quick pid=' + child.pid);",
    "  process.exit(0);",
    "})();",
  ];

  writeFileSync(scriptPath, lines.join(String.fromCharCode(10)), "utf8");

  // 直接 node 拉起 restarter，windowsHide 静默；不用 npm.cmd / VBS / PowerShell
  const child = spawn(systemNode, [scriptPath], {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  child.unref();
  safeLog("restarter scheduled silent", scriptPath);
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
