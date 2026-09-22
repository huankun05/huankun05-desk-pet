const fs = require("fs");
const dp = "F:/Work/Create/desk_pet/desk-pet";

// tray.ts：使用 restartApp
const trayPath = dp + "/src/main/tray.ts";
let tray = fs.readFileSync(trayPath, "utf8");
if (!tray.includes("appRestart")) {
  tray = tray.replace(
    'import { getCurrentAppIconPath } from "./windows/window-state";',
    'import { getCurrentAppIconPath } from "./windows/window-state";\nimport { restartApp } from "./services/appRestart";',
  );
}
tray = tray.replace(
  `    {
      label: "重启应用",
      click: () => { deps.restart(); },
    },`,
  `    {
      label: "重启应用",
      click: () => {
        try {
          restartApp();
        } catch {
          deps.restart();
        }
      },
    },`,
);
fs.writeFileSync(trayPath, tray, "utf8");
console.log("tray", tray.includes("restartApp"));

// default-dependencies：quit 也可用 quitAppFast（保留 deps.quit）
const depPath = dp + "/src/main/application/default-dependencies.ts";
let dep = fs.readFileSync(depPath, "utf8");
if (!dep.includes("appRestart")) {
  dep = dep.replace(
    'import { createTray } from "../tray";',
    'import { createTray } from "../tray";\nimport { registerRestartCleanup, restartApp } from "../services/appRestart";',
  );
  dep = dep.replace(
    `        restart: () => {
          // 开发模式：只 relaunch Electron；Vite 由 npm run dev 保持。
          // 若 Vite 未就绪，下次启动会 waitDevServerReady 重试加载。
          app.relaunch({ args: process.argv.slice(1) });
          app.exit(0);
        },`,
    `        restart: () => {
          restartApp();
        },`,
  );
}
fs.writeFileSync(depPath, dep, "utf8");
console.log("deps", dep.includes("restartApp"));

// IPC 可选：设置里也可触发
const ipcPath = dp + "/src/main/settings/settings-ipc.ts";
let ipc = fs.readFileSync(ipcPath, "utf8");
if (!ipc.includes("app:restart")) {
  // 托盘已够用
}

// preload 导出 restartApp 供设置页（可选）
const pre = dp + "/src/preload/index.ts";
let p = fs.readFileSync(pre, "utf8");
if (!p.includes("restartApp:")) {
  p = p.replace(
    "  minimize: () => ipcRenderer.send(IPC.SETTINGS_MINIMIZE),",
    `  restartApp: () => ipcRenderer.invoke("app:restart"),
  minimize: () => ipcRenderer.send(IPC.SETTINGS_MINIMIZE),`,
  );
}
fs.writeFileSync(pre, p, "utf8");
console.log("preload restartApp", p.includes("restartApp"));
