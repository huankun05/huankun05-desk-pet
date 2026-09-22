const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/main/windows/window-manager.ts";
let t = fs.readFileSync(f, "utf8");
if (!t.includes("retryOnConnRefused")) {
  t = t.replace(
    `            chatLoadPromise = loadWindowForStartup({
              window,
              load: () => loadReactChatWindowPage(window, sessionId),
              timeoutMs: CHAT_READY_TIMEOUT_MS,
            })`,
    `            chatLoadPromise = loadWindowForStartup({
              window,
              load: () => loadReactChatWindowPage(window, sessionId),
              timeoutMs: CHAT_READY_TIMEOUT_MS,
              // 开发模式：托盘重启后 Vite 可能尚未就绪，连接拒绝自动重试
              retryOnConnRefused: true,
              maxRetries: 8,
              retryDelayMs: 700,
            })`,
  );
}
// import isDev not needed if always true - use process.env.VITE_DEV
if (!t.includes('from "../env"')) {
  // fine
}
fs.writeFileSync(f, t, "utf8");
console.log("window-manager retry", t.includes("retryOnConnRefused"));
