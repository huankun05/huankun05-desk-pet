import { spawnSync } from "node:child_process";

/**
 * 杀掉本应用（desk-pet / live2d-cyrene）残留的 electron 实例。
 *
 * 背景：应用启用了单实例锁，重复 `npm run dev` 时新实例会因锁静默退出，
 * 旧的（可能加载了错误端口地址）实例会一直保留，造成「修复了却还是打不开」的错觉。
 * dev 启动前先清理残留实例，确保每次都是全新、正确的实例。
 *
 * 识别方式：进程名为 electron.exe，且命令行同时包含本项目路径特征
 * （desk_pet + node_modules\electron）或 live2d-cyrene 用户数据目录。
 */
const psCmd = [
  "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\"",
  "| Where-Object { $_.CommandLine -and ( ( $_.CommandLine -like '*desk_pet*' -and $_.CommandLine -like '*node_modules\\electron*' ) -or $_.CommandLine -like '*live2d-cyrene*' ) }",
  "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force; \"$($_.ProcessId)\" }",
].join(" ");

const result = spawnSync("powershell", ["-NoProfile", "-Command", psCmd], {
  encoding: "utf8",
  windowsHide: true,
});

if (result.status === 0 && result.stdout && result.stdout.trim()) {
  const ids = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (ids.length > 0) console.log(`[dev] 已清理 ${ids.length} 个残留 electron 实例: ${ids.join(", ")}`);
} else if (result.status !== 0) {
  console.log("[dev] 清理残留实例失败（忽略，继续启动）:", (result.stderr || "").trim().slice(0, 200));
}
