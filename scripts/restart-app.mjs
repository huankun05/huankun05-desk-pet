import { spawnSync } from "node:child_process";

/**
 * 只重启本应用（desk-pet / live2d-cyrene）的 dev 运行时（electron + vite），
 * 不触碰 NapCat / QQ 等独立进程，避免因终止 dev 进程树而连带杀掉 QQ 链路
 * （连带杀掉会导致 QQ 登录态丢失，每次重启都要重新扫码，且频繁重登会触发风控）。
 *
 * 用法：
 *   1. node scripts/restart-app.mjs        # 只杀 electron（concurrently -k 会带走 vite）
 *   2. 等待原 dev 任务完全退出（5173 端口释放）后，重新执行 pnpm dev
 */
const ELECTRON_PS = [
  "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\"",
  "| Where-Object { $_.CommandLine -and ( ( $_.CommandLine -like '*desk_pet*' -and $_.CommandLine -like '*node_modules\\electron*' ) -or $_.CommandLine -like '*live2d-cyrene*' ) }",
  "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force; \"$($_.ProcessId)\" }",
].join(" ");

const result = spawnSync("powershell", ["-NoProfile", "-Command", ELECTRON_PS], {
  encoding: "utf8",
  windowsHide: true,
});

const ids = result.status === 0 && result.stdout
  ? result.stdout.trim().split(/\r?\n/).filter(Boolean)
  : [];

if (ids.length > 0) {
  console.log(`[restart-app] 已停止 ${ids.length} 个本应用 electron 实例: ${ids.join(", ")}`);
  console.log("[restart-app] 提示：NapCat / QQ 进程不受影响，链路无需重扫。");
  console.log("[restart-app] 等待旧 dev 任务退出（vite 释放 5173 端口）后，重新执行 pnpm dev 即可。");
} else {
  console.log("[restart-app] 未发现本应用 electron 实例，可能已停止。");
}
