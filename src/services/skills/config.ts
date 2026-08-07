import type { PluginConfigSchema } from './types';
import { createStorage } from '../storage';

interface PluginConfigStorage {
  [pluginId: string]: Record<string, unknown>;
}

const storage = createStorage<PluginConfigStorage>('plugin-configs', {});

export class PluginConfigManager {
  private static instance: PluginConfigManager;
  private schemas = new Map<string, PluginConfigSchema>();
  private cachedConfigs = new Map<string, Record<string, unknown>>();

  private constructor() {}

  static getInstance(): PluginConfigManager {
    if (!PluginConfigManager.instance) {
      PluginConfigManager.instance = new PluginConfigManager();
    }
    return PluginConfigManager.instance;
  }

  registerSchema(pluginId: string, schema: PluginConfigSchema): void {
    this.schemas.set(pluginId, schema);
  }

  getSchema(pluginId: string): PluginConfigSchema | undefined {
    return this.schemas.get(pluginId);
  }

  async loadConfig(pluginId: string): Promise<Record<string, unknown>> {
    if (this.cachedConfigs.has(pluginId)) {
      return this.cachedConfigs.get(pluginId)!;
    }

    try {
      const saved = storage.get();
      const pluginSaved = saved[pluginId] || {};
      const schema = this.schemas.get(pluginId);
      const config: Record<string, unknown> = { ...pluginSaved };

      if (schema && schema.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
          if (!(key in config) && prop.default !== undefined) {
            config[key] = prop.default;
          }
        }
      }

      this.cachedConfigs.set(pluginId, config);
      return config;
    } catch {
      return {};
    }
  }

  async saveConfig(pluginId: string, config: Record<string, unknown>): Promise<void> {
    this.cachedConfigs.set(pluginId, config);
    const saved = storage.get();
    storage.set({ ...saved, [pluginId]: config });
  }

  getConfigValue<T>(pluginId: string, key: string, defaultVal: T): T {
    const config = this.cachedConfigs.get(pluginId);
    if (config && key in config) {
      return config[key] as T;
    }
    const schema = this.schemas.get(pluginId);
    if (schema?.properties?.[key]?.default !== undefined) {
      return schema.properties[key].default as T;
    }
    return defaultVal;
  }

  async setConfigValue<T>(pluginId: string, key: string, value: T): Promise<void> {
    let config = this.cachedConfigs.get(pluginId);
    if (!config) {
      config = await this.loadConfig(pluginId);
    }
    config[key] = value;
    await this.saveConfig(pluginId, config);
  }
}

export const pluginConfigManager = PluginConfigManager.getInstance();
