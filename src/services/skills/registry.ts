import type { PluginMetadata, PluginContext, PluginEvent } from './types';
import { DeskPetPlugin } from './base';
import { createStorage } from '../storage';

interface PluginStorageData {
  states: Record<string, boolean>;
}

const storage = createStorage<PluginStorageData>('plugins', { states: {} });

export class PluginRegistry {
  private static instance: PluginRegistry;
  private plugins = new Map<string, DeskPetPlugin>();
  private context: PluginContext | null = null;

  private constructor() {}

  static getInstance(): PluginRegistry {
    if (!PluginRegistry.instance) {
      PluginRegistry.instance = new PluginRegistry();
    }
    return PluginRegistry.instance;
  }

  register(plugin: DeskPetPlugin): void {
    this.plugins.set(plugin.metadata.id, plugin);
  }

  setContext(context: PluginContext): void {
    this.context = context;
    for (const plugin of this.plugins.values()) {
      if (plugin.isEnabled) {
        plugin.initialize(context);
      }
    }
  }

  getPlugin(id: string): DeskPetPlugin | undefined {
    return this.plugins.get(id);
  }

  getAllPlugins(): DeskPetPlugin[] {
    return Array.from(this.plugins.values());
  }

  getPluginMetadata(id: string): PluginMetadata | undefined {
    return this.plugins.get(id)?.metadata;
  }

  getAllMetadata(): PluginMetadata[] {
    return this.getAllPlugins().map((p) => p.metadata);
  }

  async loadPluginStates(): Promise<void> {
    try {
      const saved = storage.get();
      if (saved.states) {
        for (const [id, enabled] of Object.entries(saved.states)) {
          const plugin = this.plugins.get(id);
          if (plugin) {
            plugin.isEnabled = enabled;
            if (enabled && this.context) {
              plugin.initialize(this.context);
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  async savePluginStates(): Promise<void> {
    const states: Record<string, boolean> = {};
    for (const [id, plugin] of this.plugins) {
      states[id] = plugin.isEnabled;
    }
    const saved = storage.get();
    storage.set({ ...saved, states });
  }

  async togglePlugin(id: string): Promise<boolean> {
    const plugin = this.plugins.get(id);
    if (!plugin || plugin.metadata.isBuiltin) return false;

    plugin.isEnabled = !plugin.isEnabled;

    if (plugin.isEnabled && this.context) {
      plugin.initialize(this.context);
    } else {
      plugin.terminate();
    }

    await this.savePluginStates();
    return plugin.isEnabled;
  }

  enablePlugin(id: string): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    plugin.isEnabled = true;
    if (this.context) {
      plugin.initialize(this.context);
    }
    return true;
  }

  disablePlugin(id: string): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    plugin.isEnabled = false;
    plugin.terminate();
    return true;
  }

  emitEvent(event: PluginEvent): void {
    for (const plugin of this.plugins.values()) {
      if (plugin.isEnabled) {
        plugin.handleEvent(event);
      }
    }
  }

  /**
   * 动态加载插件（从文件系统）
   * 市场安装的插件通过此方法加载
   */
  async loadPlugin(pluginId: string): Promise<boolean> {
    try {
      // 从 plugins 目录加载插件模块
      const pluginPath = `../plugins/${pluginId}/index.ts`;
      const module = await import(/* @vite-ignore */ pluginPath);
      if (module.default instanceof DeskPetPlugin) {
        this.register(module.default);
        if (this.context && module.default.isEnabled) {
          module.default.initialize(this.context);
        }
        return true;
      }
      return false;
    } catch {
      console.warn(`[PluginRegistry] Failed to load plugin: ${pluginId}`);
      return false;
    }
  }

  /**
   * 动态卸载插件
   */
  async unloadPlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    plugin.terminate();
    this.plugins.delete(pluginId);
    await this.savePluginStates();
    return true;
  }

  shutdown(): void {
    for (const plugin of this.plugins.values()) {
      plugin.terminate();
    }
    this.plugins.clear();
  }
}

export const pluginRegistry = PluginRegistry.getInstance();

export function registerPlugin(plugin: DeskPetPlugin): void {
  pluginRegistry.register(plugin);
}
