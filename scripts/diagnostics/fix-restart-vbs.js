const fs = require("fs");
const path = require("path");
const root = "F:/Work/Create/desk_pet/desk-pet";

// 1) 仓库内固定 runner VBS（纯 ASCII，避免编码/引号问题）
const systemNode = "E:/software/Nodejs/node.exe";
const workerJs = "F:/Work/Create/desk_pet/desk-pet/scripts/dev-restart-worker.js";
const runner =
  "Set sh = CreateObject(\"WScript.Shell\")\r\n" +
  "cmd = Chr(34) & \"" + systemNode + "\" & Chr(34) & \" \" & Chr(34) & \"" + workerJs + "\" & Chr(34)\r\n" +
  "sh.Run cmd, 0, False\r\n";
fs.writeFileSync(path.join(root, "scripts", "dev-restart-run.vbs"), runner, "ascii");
console.log("runner vbs:\n" + runner);

// 2) toast VBS：ASCII 标题避免编码问题；正文用英文+中文转 Unicode 可选
const toast =
  "Set sh = CreateObject(\"WScript.Shell\")\r\n" +
  "sh.Popup \"Cyrene is restarting...\", 4, \"Cyrene\", 64\r\n";
fs.writeFileSync(path.join(root, "scripts", "dev-restart-toast.vbs"), toast, "ascii");
console.log("toast vbs:\n" + toast);

// 3) appRestart：改成跑仓库内固定 vbs，不生成到 TEMP
const f = path.join(root, "src/main/services/appRestart.ts");
let t = fs.readFileSync(f, "utf8");
t = t.replace(
  /function spawnDevSessionRestarter\(\): void \{[\s\S]*?\n\}\n\nexport function restartApp/,
  `function spawnDevSessionRestarter(): void {
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

export function restartApp`,
);
t = t.replace(
  /const toastVbs = join\(projectRoot, "scripts", "dev-restart-toast\.vbs"\);[\s\S]*?spawnHiddenWscript\(toastVbs\);/,
  `const toastVbs = join(projectRoot, "scripts", "dev-restart-toast.vbs");
    spawnHiddenWscript(toastVbs);`,
);
fs.writeFileSync(f, t, "utf8");
console.log("appRestart uses repo vbs", t.includes("dev-restart-run.vbs"));
