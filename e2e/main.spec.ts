import { test, expect } from '@playwright/test';

/**
 * 主窗口 E2E 测试
 *
 * index.html 依赖 Tauri API（invoke、窗口操作），在普通浏览器中部分功能不可用。
 * 这些测试验证基础 UI 结构和关键元素的存在性。
 */

test.describe('Main App — Basic Render', () => {
  test('index.html loads root element', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 根节点存在
    const root = page.locator('#root');
    await expect(root).toBeVisible({ timeout: 10_000 });
  });

  test('page title is set', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Tauri/);
  });
});

test.describe('Main App — Panel Queries', () => {
  test('panel mode query string renders without crash', async ({ page }) => {
    // 测试聊天面板模式（独立窗口）
    await page.goto('/?panel=chat');
    await page.waitForLoadState('networkidle');

    const root = page.locator('#root');
    await expect(root).toBeVisible({ timeout: 10_000 });
  });

  test('settings panel mode renders without crash', async ({ page }) => {
    await page.goto('/?panel=settings');
    await page.waitForLoadState('networkidle');

    const root = page.locator('#root');
    await expect(root).toBeVisible({ timeout: 10_000 });
  });

  test('status panel mode renders without crash', async ({ page }) => {
    await page.goto('/?panel=status');
    await page.waitForLoadState('networkidle');

    const root = page.locator('#root');
    await expect(root).toBeVisible({ timeout: 10_000 });
  });
});
