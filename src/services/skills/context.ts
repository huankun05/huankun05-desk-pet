import type { PluginContext, EmotionState, ScheduleOptions } from './types';

interface CreateContextOptions {
  say: (message: string) => void;
  showBubble: (message: string, duration?: number) => void;
  playAnimation: (name: string) => void;
  getEmotion: () => EmotionState;
  setEmotion: (emotion: Partial<EmotionState>) => void;
  getConfig: (key: string, defaultVal: unknown) => unknown;
  setConfig: (key: string, value: unknown) => void;
  saveData: (key: string, data: unknown) => void;
  loadData: (key: string, defaultVal: unknown) => unknown;
  notify: (title: string, message: string) => void;
  scheduleJob?: (options: ScheduleOptions) => string | null;
  cancelJob?: (jobId: string) => void;
}

export function createPluginContext(options: CreateContextOptions): PluginContext {
  return {
    say: options.say,
    showBubble: options.showBubble,
    playAnimation: options.playAnimation,
    getEmotion: options.getEmotion,
    setEmotion: options.setEmotion,
    getConfig: options.getConfig as PluginContext['getConfig'],
    setConfig: options.setConfig as PluginContext['setConfig'],
    saveData: options.saveData as PluginContext['saveData'],
    loadData: options.loadData as PluginContext['loadData'],
    notify: options.notify,
    scheduleJob: options.scheduleJob || (() => null),
    cancelJob: options.cancelJob || (() => {}),
  };
}
