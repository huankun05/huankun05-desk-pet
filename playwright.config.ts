import { defineConfig } from "@playwright/test";

/**
 * Playwright E2E 配置（项目根，CI/CD 使用）。
 *
 * - testDir 指向 e2e/，仅冒烟级：验证 Electron 应用能启动、主窗口正常渲染。
 * - 应用存在单实例锁（installSingleInstanceGuard），E2E 启动的实例是唯一的；
 *   本地运行前请先关闭正在运行的开发实例（npm run dev），CI 无此顾虑。
 * - 生产模式下应用加载 dist/renderer 产物，跑 E2E 前需先 npm run build。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
});
