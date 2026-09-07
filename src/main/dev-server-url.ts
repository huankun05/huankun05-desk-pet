import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { isDev } from "./env";

/**
 * 开发服务器地址解析。
 *
 * Vite 在 5173 被占用时（如遗留的旧实例）会按 strictPort=false 自动顺延端口，
 * 主进程若硬编码 5173 会加载到错误地址导致窗口无响应。
 * 因此 dev 模式下优先读取 Vite 启动时写入的 `dist/main/.vite-dev-url.json`
 * （记录实际监听端口），读不到时回退默认 5173。
 */
export function getDevServerBaseUrl(dev: boolean = isDev): string {
  if (!dev) return "";
  try {
    const file = join(app.getAppPath(), "dist", "main", ".vite-dev-url.json");
    const { url } = JSON.parse(readFileSync(file, "utf8")) as { url?: string };
    if (typeof url === "string" && url.length > 0) return url.replace(/\/+$/, "");
  } catch {
    // 文件缺失/损坏时回退默认端口，保持向后兼容
  }
  return "http://localhost:5174";
}
