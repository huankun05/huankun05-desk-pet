import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

/**
 * 应用冒烟测试：验证 Electron 应用能完整启动并正常渲染窗口。
 *
 * 前置条件：
 * - 已执行 npm run build（生产模式加载 dist/renderer 产物）
 * - 无其他正在运行的实例（应用有单实例锁）
 *
 * 说明：启动时应用创建状态窗口（桌宠）；聊天窗口（"Cyrene · 聊天"）
 * 需交互激活后才打开，不作为启动冒烟断言。
 */

let app: ElectronApplication;

test.beforeAll(async () => {
  app = await electron.launch({ args: ["."] });
});

test.afterAll(async () => {
  await app?.close();
});

/** 轮询等待标题匹配的窗口出现（应用窗口异步创建，顺序不固定）。 */
async function waitForWindow(
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

test("应用启动：主进程创建窗口", async () => {
  await expect.poll(async () => app.windows().length, { timeout: 60_000 }).toBeGreaterThan(0);
});

test("应用启动：状态窗口渲染完成", async () => {
  const statusWindow = await waitForWindow(app, /昔涟 · 状态|状态/);
  await statusWindow.waitForLoadState("domcontentloaded");
  // 页面 DOM 已挂载（窗口主体非空）
  await expect(statusWindow.locator("body")).not.toBeEmpty();
});
