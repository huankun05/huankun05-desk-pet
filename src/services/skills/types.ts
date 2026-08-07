export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  icon?: string;
  configSchema?: PluginConfigSchema;
  isBuiltin: boolean;
  enabled: boolean;
}

export interface PluginConfigSchema {
  type: 'object';
  properties: Record<string, PluginConfigProperty>;
  required?: string[];
}

export interface PluginConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  items?: PluginConfigProperty;
}

export interface PluginContext {
  say(message: string): void;
  showBubble(message: string, duration?: number): void;
  playAnimation(name: string): void;
  getEmotion(): EmotionState;
  setEmotion(emotion: Partial<EmotionState>): void;
  getConfig<T>(key: string, defaultVal: T): T;
  setConfig<T>(key: string, value: T): void;
  saveData<T>(key: string, data: T): void;
  loadData<T>(key: string, defaultVal: T): T;
  notify(title: string, message: string): void;
  scheduleJob(options: ScheduleOptions): string | null;
  cancelJob(jobId: string): void;
}

export interface ScheduleOptions {
  id: string;
  cronExpression?: string;
  intervalMs?: number;
  runAt?: Date;
  handler: () => void;
}

export interface EmotionState {
  mood: string;
  moodIntensity: number;
  emotion: string;
  emotionIntensity: number;
  favorability: number;
}

export type PluginEventType =
  | 'chat:message'
  | 'chat:response'
  | 'interaction:click'
  | 'interaction:drag'
  | 'emotion:change'
  | 'timer:tick'
  | 'system:start'
  | 'system:stop'
  | 'perception:gesture'
  | 'perception:face';

export interface PluginEvent {
  type: PluginEventType;
  payload?: unknown;
}
