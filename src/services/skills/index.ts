export type {
  PluginMetadata,
  PluginConfigSchema,
  PluginConfigProperty,
  PluginContext,
  ScheduleOptions,
  EmotionState,
  PluginEventType,
  PluginEvent,
} from './types';

export { DeskPetPlugin } from './base';
export { PluginRegistry, pluginRegistry, registerPlugin } from './registry';
export { PluginConfigManager, pluginConfigManager } from './config';
export { PluginImporter } from './importer';
export { createPluginContext } from './context';

export { PomodoroPlugin } from './plugins/pomodoro';
export { DailyGreetingPlugin } from './plugins/dailyGreeting';
export { WaterReminderPlugin } from './plugins/waterReminder';
export { SedentaryReminderPlugin } from './plugins/sedentaryReminder';
export { EyeCarePlugin } from './plugins/eyeCare';

import { registerBuiltinPlugins } from './registerBuiltin';
export { registerBuiltinPlugins };

// ★ 模块副作用：任意窗口（主窗 / 设置窗 / 悬浮球窗，各自独立 registry 单例）只要导入
//   services/skills，内置插件即被注册，确保「插件管理页」能枚举到内置插件。
registerBuiltinPlugins();
