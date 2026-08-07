import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 配置
 *
 * 桌面宠物项目有两套入口：
 * - index.html   (main)    — React 桌面宠物主窗口，依赖 Tauri API
 * - admin.html   (admin)   — 管理后台，纯 Web，可直接测试
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],

  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'npx vite --port 1420 --strictPort',
      port: 1420,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
