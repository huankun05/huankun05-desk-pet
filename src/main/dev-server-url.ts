import { readFileSync } from "node:fs";
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
    if (typeof url === "string" && url.length > 0) return url.replace(/\/+$/, "");
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
      const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status === 404) return true;
    } catch {
      /* vite 未起来 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
