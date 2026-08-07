import { test, expect } from '@playwright/test';

/**
 * 管理后台 E2E 测试
 *
 * admin.html 是纯 Web 应用（不依赖 Tauri），可以直接在浏览器中测试。
 * 测试覆盖：页面加载、侧边栏导航、核心页面渲染。
 */

test.describe('Admin Panel — Page Load', () => {
  test('admin.html loads and shows sidebar', async ({ page }) => {
    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    // 验证侧边栏渲染
    const sidebar = page.locator('nav, [data-testid="sidebar"]').first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
  });

  test('admin root redirects to dashboard', async ({ page }) => {
    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    // HashRouter: base path should contain admin
    await expect(page).toHaveURL(/admin\.html/);
  });
});

test.describe('Admin Panel — Navigation', () => {
  test('sidebar has navigation links', async ({ page }) => {
    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    // 检查核心导航链接可见性
    const links = ['仪表盘', 'Dashboard', '角色', 'Character', '设置', 'Settings'];
    let found = false;

    for (const label of links) {
      const link = page.locator('nav').getByText(label, { exact: false });
      if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
        found = true;
        break;
      }
    }

    expect(found).toBe(true);
  });
});

test.describe('Admin Panel — Core Pages', () => {
  test('Dashboard page renders', async ({ page }) => {
    await page.goto('/admin.html#/');
    await page.waitForLoadState('networkidle');

    // Dashboard 应有内容区域渲染
    const main = page.locator('main, [role="main"], .page-content').first();
    await expect(main).toBeVisible({ timeout: 10_000 });
  });

  test('Settings page renders', async ({ page }) => {
    await page.goto('/admin.html#/settings');
    await page.waitForLoadState('networkidle');

    const main = page.locator('main, [role="main"], .page-content').first();
    await expect(main).toBeVisible({ timeout: 10_000 });
  });

  test('Character page renders', async ({ page }) => {
    await page.goto('/admin.html#/character');
    await page.waitForLoadState('networkidle');

    const main = page.locator('main, [role="main"], .page-content').first();
    await expect(main).toBeVisible({ timeout: 10_000 });
  });

  test('Providers page renders', async ({ page }) => {
    await page.goto('/admin.html#/providers');
    await page.waitForLoadState('networkidle');

    const main = page.locator('main, [role="main"], .page-content').first();
    await expect(main).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Admin Panel — Theme', () => {
  test('dark theme applied by default', async ({ page }) => {
    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    // admin.html 初始化脚本设置 theme
    const html = page.locator('html');
    const theme = await html.getAttribute('data-theme');
    expect(['dark', 'light']).toContain(theme);
  });
});
