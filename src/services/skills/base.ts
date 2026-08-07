import type { PluginMetadata, PluginContext, PluginEvent } from './types';

export abstract class DeskPetPlugin {
  readonly metadata: PluginMetadata;
  protected context: PluginContext | null = null;
  private isInitialized = false;

  constructor(metadata: PluginMetadata) {
    this.metadata = metadata;
  }

  initialize(context: PluginContext): void {
    if (this.isInitialized) return;
    this.context = context;
    this.onInitialize();
    this.isInitialized = true;
  }

  terminate(): void {
    if (!this.isInitialized) return;
    this.onTerminate();
    this.context = null;
    this.isInitialized = false;
  }

  handleEvent(event: PluginEvent): void {
    if (!this.isInitialized) return;
    this.onEvent(event);
  }

  getConfig<T>(key: string, defaultVal: T): T {
    return this.context?.getConfig(key, defaultVal) ?? defaultVal;
  }

  setConfig<T>(key: string, value: T): void {
    this.context?.setConfig(key, value);
  }

  say(message: string): void {
    this.context?.say(message);
  }

  showBubble(message: string, duration?: number): void {
    this.context?.showBubble(message, duration);
  }

  playAnimation(name: string): void {
    this.context?.playAnimation(name);
  }

  saveData<T>(key: string, data: T): void {
    this.context?.saveData(key, data);
  }

  loadData<T>(key: string, defaultVal: T): T {
    return this.context?.loadData(key, defaultVal) ?? defaultVal;
  }

  notify(title: string, message: string): void {
    this.context?.notify(title, message);
  }

  scheduleJob(options: {
    id: string;
    cronExpression?: string;
    intervalMs?: number;
    runAt?: Date;
    handler: () => void;
  }): string | null {
    return this.context?.scheduleJob(options) ?? null;
  }

  cancelJob(jobId: string): void {
    this.context?.cancelJob(jobId);
  }

  protected onInitialize(): void {}
  protected onTerminate(): void {}
  protected onEvent(_event: PluginEvent): void {}

  get isEnabled(): boolean {
    return this.metadata.enabled;
  }

  set isEnabled(value: boolean) {
    this.metadata.enabled = value;
  }
}

export type PluginConstructor = new () => DeskPetPlugin;
