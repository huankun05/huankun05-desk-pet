/**
 * 开发态重启 worker（常驻仓库，不放 %TEMP%）。
 * 用法：由 appRestart 用 wscript 隐藏启动：node scripts/dev-restart-worker.js
 * 配置：读取项目 data/dev-restart.json（由主进程写入）
 */
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const http = require("http");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const configFile = path.join(projectRoot, "data", "dev-restart.json");
const logFile = path.join(projectRoot, "data", "dev-restart.log");

function logLine(s) {
  try {
    fs.appendFileSync(logFile, s + "\n");
  } catch (e) {}
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function alive(p) {
  try {
    process.kill(p, 0);
    return true;
  } catch (e) {
    return false;
  }
}
function portFree(port) {
  return new Promise((ok) => {
    const s = net.connect({ port, host: "127.0.0.1" }, () => {
      s.destroy();
      ok(false);
    });
    s.on("error", () => ok(true));
    setTimeout(() => {
      try {
        s.destroy();
      } catch (e) {}
      ok(true);
    }, 200);
  });
}
function viteUp() {
  return new Promise((ok) => {
    const req = http.get("http://127.0.0.1:5174/react/", (res) => {
      res.resume();
      ok(res.statusCode > 0);
    });
    req.on("error", () => ok(false));
    req.setTimeout(1500, () => {
      try {
        req.destroy();
      } catch (e) {}
      ok(false);
    });
  });
}
function silent(cmd, args, env) {
  return spawn(cmd, args, {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
    env: Object.assign({}, process.env, env || {}),
  });
}

(async () => {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(configFile, "utf8"));
  } catch (e) {
    logLine("missing config: " + configFile);
  }
  const parentPid = cfg.parentPid || 0;
  const systemNode = cfg.systemNode || "E:/software/Nodejs/node.exe";
  const viteJs = cfg.viteJs || path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
  const electronExe =
    cfg.electronExe || path.join(projectRoot, "node_modules", "electron", "dist", "electron.exe");
  const deadline = Date.now() + (cfg.maxMs || 120000);

  logLine("===== worker start parent=" + parentPid + " =====");
  while (parentPid && alive(parentPid) && Date.now() < deadline) await sleep(200);
  logLine("parent gone");
  try {
    fs.rmSync(path.join(projectRoot, "dist", "main", ".vite-dev-url.json"), { force: true });
  } catch (e) {}
  const portDeadline = Date.now() + 6000;
  while (!(await portFree(5174)) && Date.now() < portDeadline) await sleep(150);
  logLine("spawn vite silent");
  const vite = silent(systemNode, [viteJs]);
  vite.unref();
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    up = await viteUp();
    if (!up) await sleep(250);
  }
  logLine("vite up=" + up);
  await sleep(300);
  logLine("spawn electron silent");
  const el = silent(electronExe, ["."], { VITE_DEV: "1" });
  el.unref();
  logLine("electron pid=" + el.pid);
  process.exit(0);
})();
