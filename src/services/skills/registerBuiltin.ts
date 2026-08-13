import { pluginRegistry } from './registry';
import { PomodoroPlugin } from './plugins/pomodoro';
import { DailyGreetingPlugin } from './plugins/dailyGreeting';
import { WaterReminderPlugin } from './plugins/waterReminder';
import { SedentaryReminderPlugin } from './plugins/sedentaryReminder';
import { EyeCarePlugin } from './plugins/eyeCare';
import { WatchTogetherPlugin } from '../../plugins/watch-together';

/**
 * 注册全部内置插件。
 *
 * 幂等且可重复调用：`pluginRegistry.register` 按 id 覆盖（Map.set），多次调用无害；
 * 这样主窗在 HMR 卸载（shutdown 清空）后能重新注册，无需模块级一次性守卫。
 *
 * ★ 为什么需要它（2026-08-12 修复）：
 * Tauri 每个 webview（主窗 / 设置窗 / 悬浮球窗）是独立的 JS 运行时，
 * `pluginRegistry` 是 per-window 单例。原本内置插件只在主窗的 `usePluginSystem`
 * 里注册，设置窗的注册表永远为空 → 插件管理页 `getAllMetadata()` 返回空，看不到任何插件。
 * 把注册收敛到本函数，由 `services/skills/index.ts`（模块副作用）与 `usePluginSystem`、
 * `PluginsPage` 共同调用，确保任何窗口都能枚举到内置插件。
 */
export function registerBuiltinPlugins(): void {
  pluginRegistry.register(new PomodoroPlugin());
  pluginRegistry.register(new DailyGreetingPlugin());
  pluginRegistry.register(new WaterReminderPlugin());
  pluginRegistry.register(new SedentaryReminderPlugin());
  pluginRegistry.register(new EyeCarePlugin());
  pluginRegistry.register(new WatchTogetherPlugin());
}
