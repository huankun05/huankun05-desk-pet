const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/main/services/appRestart.ts";
let t = fs.readFileSync(f, "utf8");

const start = t.indexOf("  // 仓库内固定脚本");
if (start >= 0) {
  const end = t.indexOf("\n}\n", start);
  // 找 showRestartToast 函数结尾
  let brace = 0;
  let i = t.lastIndexOf("function showRestartToast", start);
  let fnStart = t.indexOf("{", i);
  let j = fnStart;
  brace = 0;
  for (; j < t.length; j++) {
    if (t[j] === "{") brace++;
    else if (t[j] === "}") {
      brace--;
      if (brace === 0) break;
    }
  }
  // 重写 showRestartToast 为只保留 Notification
  const neu = `function showRestartToast(): void {
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
}`;
  t = t.slice(0, i) + neu + t.slice(j + 1);
  fs.writeFileSync(f, t, "utf8");
  console.log("showRestartToast = Notification only");
} else {
  console.log("no vbs block, check Notification");
}

console.log("has toast vbs", t.includes("dev-restart-toast"));
console.log("has Notification", t.includes("Notification.isSupported"));
