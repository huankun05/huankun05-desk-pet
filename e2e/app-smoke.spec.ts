import { test, expect } from "@playwright/test";
import { launchApp, waitForWindow, type ElectronApplication } from "./helpers";

/**
 * 应用冒烟测试：验证 Electron 应用能完整启动并正常渲染窗口。
 *
 * 前置条件见 helpers.ts（已 build、无其他运行实例）。
 *
 * 说明：启动时应用创建的是聊天窗壳（"昔涟 · 聊天（React）"，标题来自页面
 * document.title）；状态窗（桌宠）为按需打开，不作为启动断言。
 */

let app: ElectronApplication;

test.beforeAll(async () => {
  app = await launchApp();
});

test.afterAll(async () => {
  await app?.close();
});

test("应用启动：主进程创建窗口", async () => {
  await expect.poll(async () => app.windows().length, { timeout: 60_000 }).toBeGreaterThan(0);
});

test("应用启动：默认聊天窗口渲染完成", async () => {
  const chatWindow = await waitForWindow(app, /聊天/);
  await chatWindow.waitForLoadState("domcontentloaded");
  // 页面 DOM 已挂载（窗口主体非空）
  await expect(chatWindow.locator("body")).not.toBeEmpty();
});
