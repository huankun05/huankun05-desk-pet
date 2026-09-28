import { test, expect } from "@playwright/test";
import { launchApp, waitForWindow, openSettingsWindow, type ElectronApplication } from "./helpers";

/**
 * 设置窗口关键路径 E2E：设置窗可从状态窗打开、导航渲染完整、
 * 「本地引擎」（Hermes P0）面板可切换且渲染。
 *
 * 这是架构迁移 P0/P1 的 UI 回归守卫：换脑期间设置面板与本地引擎
 * 链路是最先被触碰的部分，此文件保证其基本可用性（不依赖 LLM/网络）。
 *
 * 前置条件见 helpers.ts（已 build、无其他实例）。
 */

let app: ElectronApplication;

test.beforeAll(async () => {
  app = await launchApp();
});

test.afterAll(async () => {
  await app?.close();
});

test("设置窗口可通过 preload 桥打开且导航渲染完整", async () => {
  const settingsWindow = await openSettingsWindow(app);
  await settingsWindow.waitForLoadState("domcontentloaded");
  // 核心导航项渲染（模型服务 / 本地引擎）
  await expect(settingsWindow.locator('button.nav-item[data-section="api"]')).toBeVisible();
  await expect(settingsWindow.locator('button.nav-item[data-section="hermes"]')).toBeVisible();
});

test("本地引擎面板可切换且渲染（Hermes P0 回归守卫）", async () => {
  const settingsWindow = await openSettingsWindow(app);
  const nav = settingsWindow.locator('button.nav-item[data-section="hermes"]');
  await expect(nav).toBeVisible();
  await nav.click();

  const panel = settingsWindow.locator("#hermes-panel");
  await expect(panel).toBeVisible();
  await expect(panel).not.toHaveClass(/is-hidden/);
  // 面板关键元素：健康状态、端点展示、冒烟按钮
  await expect(panel.locator("#hermes-health")).toBeVisible();
  await expect(panel.locator("#hermes-endpoint")).toBeVisible();
  await expect(panel.locator("#hermes-health-btn")).toBeVisible();
});

test("设置窗口标题正确（窗口系统冒烟）", async () => {
  await waitForWindow(app, /昔涟 · 设置/);
});
