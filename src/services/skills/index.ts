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
