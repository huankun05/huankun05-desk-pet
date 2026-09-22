const fs = require("fs");
const depPath = "F:/Work/Create/desk_pet/desk-pet/src/main/application/default-dependencies.ts";
let dep = fs.readFileSync(depPath, "utf8");

// 在 registerShellIpc 里注册 app:restart
if (!dep.includes('"app:restart"')) {
  dep = dep.replace(
    "      registerShellIpc: ({ ipc, windowManager, live2dWindowLifecycle }) => {",
    `      registerShellIpc: ({ ipc, windowManager, live2dWindowLifecycle }) => {
        try {
          ipc.handle("app:restart", async () => {
            restartApp();
            return true;
          });
        } catch {
          /* ignore */
        }`,
  );
}

// 启动后注册清理钩子
if (!dep.includes("registerRestartCleanup(")) {
  dep = dep.replace(
    "        registerHermesSettingsIpc({ ipc });",
    `        registerHermesSettingsIpc({ ipc });
        try {
          registerRestartCleanup(() => {
            try { stopAiEngine?.(); } catch { /* ignore */ }
          });
        } catch { /* ignore */ }`,
  );
}

fs.writeFileSync(depPath, dep, "utf8");
console.log("ipc app:restart", dep.includes("app:restart"));
