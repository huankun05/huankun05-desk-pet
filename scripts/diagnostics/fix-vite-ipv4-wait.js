const fs = require("fs");
const dp = "F:/Work/Create/desk_pet/desk-pet";

// 统一用 127.0.0.1，避免 Windows 上 localhost→::1 导致 ECONNREFUSED
const devPath = dp + "/src/main/dev-server-url.ts";
fs.writeFileSync(
  devPath,
  `import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { isDev } from "./env";

/**
 * 开发服务器地址。强制 127.0.0.1（Windows 上 localhost 可能走 ::1 导致拒连）。
 */
function toIpv4(url: string): string {
  return url.replace(/\\/\\/localhost(\\:\\d+)?\\//, (_m, p1) => \`//127.0.0.1\${p1 || ""}/\`)
    .replace(/\\/\\/localhost(\\:\\d+)?$/, (_m, p1) => \`//127.0.0.1\${p1 || ""}\`);
}

export function getDevServerBaseUrl(dev: boolean = isDev): string {
  if (!dev) return "";
  try {
    const file = join(app.getAppPath(), "dist", "main", ".vite-dev-url.json");
    const { url } = JSON.parse(readFileSync(file, "utf8")) as { url?: string };
    if (typeof url === "string" && url.length > 0) return toIpv4(url.replace(/\\/+$/, ""));
  } catch {
    /* ignore */
  }
  return "http://127.0.0.1:5174";
}

/** 轮询直到 Vite 真正可访问（含 /react/），托盘重启后避免 ECONNREFUSED。 */
export async function waitDevServerReady(timeoutMs = 45_000, dev: boolean = isDev): Promise<boolean> {
  if (!dev) return true;
  const base = getDevServerBaseUrl(true);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const path of ["/", "/react/", "/settings/"]) {
      try {
        const res = await fetch(\`\${base}\${path}\`, { signal: AbortSignal.timeout(1200) });
        if (res.status > 0) return true;
      } catch {
        /* not ready */
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
`,
  "utf8",
);
console.log("dev-server-url ipv4+wait ok");

// startShell：dev 未就绪时继续等，不要静默跳过
const shPath = dp + "/src/main/application/shell-bootstrap.ts";
let sh = fs.readFileSync(shPath, "utf8");
sh = sh.replace(
  `  // 0. 开发模式等待 Vite
  try {
    await deps.ensureDevServer?.();
  } catch {
    /* continue */
  }`,
  `  // 0. 开发模式等待 Vite（托盘重启后必须就绪再 loadURL）
  if (deps.ensureDevServer) {
    const ready = await deps.ensureDevServer().catch(() => false);
    if (!ready) {
      console.error("[Shell] dev server 未就绪，继续尝试加载（窗口层会重试）");
    }
  }`,
);
fs.writeFileSync(shPath, sh, "utf8");
console.log("shell wait strict");
