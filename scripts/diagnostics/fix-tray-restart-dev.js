const fs = require("fs");
const dp = "F:/Work/Create/desk_pet/desk-pet";

// 1) dev-server-url.ts：等待 Vite 就绪
const devPath = dp + "/src/main/dev-server-url.ts";
fs.writeFileSync(
  devPath,
  `import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { isDev } from "./env";

/**
 * 开发服务器地址解析 + 就绪等待。
 * Vite 端口写入 dist/main/.vite-dev-url.json；托盘「重启」时若 Vite 尚未就绪，
 * 必须先 waitDevServerReady() 再 loadURL，否则 ERR_CONNECTION_REFUSED。
 */
export function getDevServerBaseUrl(dev: boolean = isDev): string {
  if (!dev) return "";
  try {
    const file = join(app.getAppPath(), "dist", "main", ".vite-dev-url.json");
    const { url } = JSON.parse(readFileSync(file, "utf8")) as { url?: string };
    if (typeof url === "string" && url.length > 0) return url.replace(/\\/+$/, "");
  } catch {
    // 文件缺失/损坏时回退默认端口
  }
  return "http://localhost:5174";
}

/** 开发模式下轮询 Vite，直到可访问或超时。生产恒 true。 */
export async function waitDevServerReady(timeoutMs = 30_000, dev: boolean = isDev): Promise<boolean> {
  if (!dev) return true;
  const base = getDevServerBaseUrl(true);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(\`\${base}/\`, { signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status === 404) return true;
    } catch {
      /* vite 未起来 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
`,
  "utf8",
);
console.log("dev-server-url ok");

// 2) startup-window-load.ts：连接拒绝时重试
const loadPath = dp + "/src/main/windows/startup-window-load.ts";
let load = fs.readFileSync(loadPath, "utf8");
load = load.replace(
  "export interface LoadWindowForStartupInput {",
  `export interface LoadWindowForStartupInput {
  /** 开发模式下 ERR_CONNECTION_REFUSED 等可重试（Vite 刚起来时） */
  retryOnConnRefused?: boolean;
  retryDelayMs?: number;
  maxRetries?: number;`,
);
load = load.replace(
  `  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const onReady = () => settle(resolve);
    const onFail = (_event: unknown, code: number, description: string, url: string, isMainFrame: boolean) => {
      if (!isMainFrame) return;
      settle(() => reject(new Error(\`chat page did-fail-load \${code}: \${description} \${url}\`)));
    };`,
  `  const retryOnConnRefused = input.retryOnConnRefused ?? false;
  const retryDelayMs = input.retryDelayMs ?? 800;
  const maxRetries = input.maxRetries ?? 6;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const onReady = () => settle(resolve);
    const onFail = (_event: unknown, code: number, description: string, url: string, isMainFrame: boolean) => {
      if (!isMainFrame) return;
      const retriable =
        retryOnConnRefused && (code === -102 || /ERR_CONNECTION_REFUSED|ERR_ABORTED/i.test(description));
      if (retriable && attempts < maxRetries) {
        attempts += 1;
        // 摘掉 once 监听后延迟再 load，避免重复触发
        window.removeListener("ready-to-show", onReady);
        window.webContents.removeListener("did-fail-load", onFail);
        void setTimeoutFn(() => {
          settled = false;
          window.once("ready-to-show", onReady);
          window.webContents.once("did-fail-load", onFail);
          void Promise.resolve()
            .then(load)
            .catch((error) => settle(() => reject(error)));
        }, retryDelayMs * attempts);
        return;
      }
      settle(() => reject(new Error(\`chat page did-fail-load \${code}: \${description} \${url}\`)));
    };`,
);
fs.writeFileSync(loadPath, load, "utf8");
console.log("startup-window-load retry", load.includes("retryOnConnRefused"));

// 3) default-dependencies：tray 重启前确保 Vite；并给 load 加 retry
const depPath = dp + "/src/main/application/default-dependencies.ts";
let dep = fs.readFileSync(depPath, "utf8");
if (!dep.includes("waitDevServerReady")) {
  dep = dep.replace(
    'import { isDev } from "../env";',
    'import { isDev } from "../env";\nimport { waitDevServerReady } from "../dev-server-url";',
  );
}
dep = dep.replace(
  `        restart: () => {
          app.relaunch();
          app.exit(0);
        },`,
  `        restart: () => {
          // 开发模式：只 relaunch Electron；Vite 由 npm run dev 保持。
          // 若 Vite 未就绪，下次启动会 waitDevServerReady 重试加载。
          app.relaunch({ args: process.argv.slice(1) });
          app.exit(0);
        },`,
);
// 在 startShell 后等 Vite
if (!dep.includes("await waitDevServerReady")) {
  dep = dep.replace(
    "      createWindowManager: () => createWindowManager({",
    `      ensureDevServer: async () => {
        if (!isDev) return true;
        return waitDevServerReady(30_000);
      },
      createWindowManager: () => createWindowManager({`,
  );
}
fs.writeFileSync(depPath, dep, "utf8");
console.log("deps restart patched", dep.includes("waitDevServerReady"));

// 4) shell-bootstrap：createWindowManager 前可选 ensure；简化：在 registerShellIpc 前
// 将 ensureDevServer 接到 startShell 开头
const shellPath = dp + "/src/main/application/shell-bootstrap.ts";
let sh = fs.readFileSync(shellPath, "utf8");
if (!sh.includes("ensureDevServer")) {
  sh = sh.replace(
    "export interface ShellDependencies {",
    `export interface ShellDependencies {
  /** 开发模式：等待 Vite 就绪（托盘重启后防 ERR_CONNECTION_REFUSED） */
  ensureDevServer?: () => Promise<boolean>;`,
  );
  sh = sh.replace(
    "  // 1. banner + 启动日志",
    `  // 0. 开发模式等待 Vite
  try {
    await deps.ensureDevServer?.();
  } catch {
    /* continue */
  }

  // 1. banner + 启动日志`,
  );
  fs.writeFileSync(shellPath, sh, "utf8");
  console.log("shell ensureDevServer", sh.includes("ensureDevServer"));
}
