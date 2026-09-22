const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/main/services/appRestart.ts";
let t = fs.readFileSync(f, "utf8");

t = t.replace(
  "const RESTART_SILENT_EXIT_MS = 900;",
  "const RESTART_SILENT_EXIT_MS = 1500;",
);

const oldFn = t.indexOf("function showRestartToast");
const oldEnd = t.indexOf("function spawnDevSessionRestarter");
if (oldFn < 0 || oldEnd < 0) {
  console.log("markers", oldFn, oldEnd);
  process.exit(1);
}

const neu = `function showRestartToast(): void {
  // 1) Electron Notification（进系统通知中心）
  try {
    if (Notification.isSupported()) {
      const toast = new Notification({
        title: "昔涟 正在重新启动",
        body: "请稍候，将自动重新打开…",
      });
      toast.show();
    }
  } catch (err) {
    safeLog("restart toast error", String(err));
  }
  // 2) 系统托盘气球（独立进程，应用退出后仍显示）
  try {
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      "$ni = New-Object System.Windows.Forms.NotifyIcon",
      "$ni.Icon = [System.Drawing.SystemIcons]::Information",
      "$ni.Visible = $true",
      "$ni.ShowBalloonTip(5000, '昔涟 正在重新启动', '请稍候，将自动重新打开…', 'Info')",
      "Start-Sleep -Seconds 5",
      "$ni.Dispose()",
    ].join("; ");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch (err) {
    safeLog("balloon error", String(err));
  }
}

`;

t = t.slice(0, oldFn) + neu + t.slice(oldEnd);
fs.writeFileSync(f, t, "utf8");
console.log("ok", t.includes("ShowBalloonTip"), t.includes("RESTART_SILENT_EXIT_MS = 1500"));
