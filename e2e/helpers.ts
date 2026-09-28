import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

/**
 * E2E 公共工具：Electron 启动与窗口等待。
 *
 * 前置条件：
 * - 已执行 pnpm run build（生产模式加载 dist/renderer 产物）
 * - 无其他正在运行的实例（应用有单实例锁）
 */

export async function launchApp(options?: {
  env?: Record<string, string>;
}): Promise<ElectronApplication> {
  return electron.launch({ args: ["."], env: options?.env });
}

/** 轮询等待标题匹配的窗口出现（应用窗口异步创建，顺序不固定）。 */
export async function waitForWindow(
  target: ElectronApplication,
  titleRe: RegExp,
  timeoutMs = 60_000,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const win of target.windows()) {
      const title = await win.title().catch(() => "");
      if (titleRe.test(title)) return win;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`未在 ${timeoutMs}ms 内找到标题匹配 ${titleRe} 的窗口`);
}

/**
 * 打开（或复用已打开的）设置窗口。
 *
 * 经任意标准 preload 窗口的桥（window.sidebar.openSettings）触发，与真实
 * 用户路径一致。启动默认窗口是聊天窗（状态窗按需打开），因此不假设
 * 某个特定窗口存在，轮询找第一个带桥的窗口。
 */
export async function openSettingsWindow(target: ElectronApplication): Promise<Page> {
  const existing = target.windows().find((w) => /设置/.test(w.title()));
  if (existing) return existing;

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const win of target.windows()) {
      try {
        const hasBridge = await win.evaluate(
          () =>
            typeof (window as unknown as { sidebar?: { openSettings?: unknown } }).sidebar
              ?.openSettings === "function",
        );
        if (!hasBridge) continue;
        await win.evaluate(() =>
          (window as unknown as { sidebar: { openSettings: () => void } }).sidebar.openSettings(),
        );
        return waitForWindow(target, /昔涟 · 设置/);
      } catch {
        // 窗口页面尚未就绪（about:blank / 加载中），继续轮询
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("未找到暴露 sidebar.openSettings 桥的窗口，无法打开设置窗");
}
