/**
 * ProviderRegistry：Provider 适配器注册表
 *
 * 存储 Provider 工厂函数，按 typeName 创建 Provider 实例。
 * AstrBot 用 Python 装饰器注册，TypeScript 等价物是工厂函数注册。
 *
 * @example
 * providerRegistry.registerChatProvider(
 *   'openai_chat',
 *   { displayName: 'OpenAI 兼容接口', description: '...' },
 *   (config) => new OpenAIChatProvider(config),
 * );
 */

import type {
  ChatProvider,
  ChatProviderConfig,
  ProviderMeta,
  ProviderType,
  STTProvider,
  STTProviderConfig,
  TTSProvider,
  TTSProviderConfig,
  VisionProvider,
  VisionProviderConfig,
} from './types';

// ===== 工厂类型 =====

type ChatProviderFactory = (config: ChatProviderConfig) => ChatProvider;
type TTSProviderFactory = (config: TTSProviderConfig) => TTSProvider;
type STTProviderFactory = (config: STTProviderConfig) => STTProvider;
type VisionProviderFactory = (config: VisionProviderConfig) => VisionProvider;

// ===== 注册表 =====

interface FactoryEntry<T> {
  factory: T;
  meta: ProviderMeta;
}

class ProviderRegistry {
  private chatFactories = new Map<string, FactoryEntry<ChatProviderFactory>>();
  private ttsFactories = new Map<string, FactoryEntry<TTSProviderFactory>>();
  private sttFactories = new Map<string, FactoryEntry<STTProviderFactory>>();
  private visionFactories = new Map<string, FactoryEntry<VisionProviderFactory>>();

  // ===== Chat =====

  registerChatProvider(
    typeName: string,
    meta: Omit<ProviderMeta, 'providerType' | 'typeName'>,
    factory: ChatProviderFactory,
  ): void {
    this.register(this.chatFactories, typeName, 'chat', meta, factory);
  }

  createChatProvider(typeName: string, config: ChatProviderConfig): ChatProvider | null {
    return this.create(this.chatFactories, 'ChatProvider', typeName, config);
  }

  getChatTypeNames(): string[] {
    return [...this.chatFactories.keys()];
  }

  // ===== TTS =====

  registerTTSProvider(
    typeName: string,
    meta: Omit<ProviderMeta, 'providerType' | 'typeName'>,
    factory: TTSProviderFactory,
  ): void {
    this.register(this.ttsFactories, typeName, 'tts', meta, factory);
  }

  createTTSProvider(typeName: string, config: TTSProviderConfig): TTSProvider | null {
    return this.create(this.ttsFactories, 'TTSProvider', typeName, config);
  }

  getTTSTypeNames(): string[] {
    return [...this.ttsFactories.keys()];
  }

  // ===== STT =====

  registerSTTProvider(
    typeName: string,
    meta: Omit<ProviderMeta, 'providerType' | 'typeName'>,
    factory: STTProviderFactory,
  ): void {
    this.register(this.sttFactories, typeName, 'stt', meta, factory);
  }

  createSTTProvider(typeName: string, config: STTProviderConfig): STTProvider | null {
    return this.create(this.sttFactories, 'STTProvider', typeName, config);
  }

  getSTTTypeNames(): string[] {
    return [...this.sttFactories.keys()];
  }

  // ===== Vision =====

  registerVisionProvider(
    typeName: string,
    meta: Omit<ProviderMeta, 'providerType' | 'typeName'>,
    factory: VisionProviderFactory,
  ): void {
    this.register(this.visionFactories, typeName, 'vision', meta, factory);
  }

  createVisionProvider(typeName: string, config: VisionProviderConfig): VisionProvider | null {
    return this.create(this.visionFactories, 'VisionProvider', typeName, config);
  }

  getVisionTypeNames(): string[] {
    return [...this.visionFactories.keys()];
  }

  // ===== 通用查询 =====

  /**
   * 获取指定类型下所有已注册的适配器元信息
   */
  getRegisteredTypes(type: ProviderType): ProviderMeta[] {
    const map =
      type === 'chat'
        ? this.chatFactories
        : type === 'tts'
          ? this.ttsFactories
          : type === 'stt'
            ? this.sttFactories
            : type === 'vision'
              ? this.visionFactories
              : null;
    if (!map) return [];
    return [...map.values()].map((e) => e.meta);
  }

  /**
   * 检查某个 typeName 是否已注册（跨所有类型）
   */
  hasType(typeName: string): boolean {
    return (
      this.chatFactories.has(typeName) ||
      this.ttsFactories.has(typeName) ||
      this.sttFactories.has(typeName) ||
      this.visionFactories.has(typeName)
    );
  }

  // ===== 内部工具 =====

  private register<T>(
    map: Map<string, FactoryEntry<T>>,
    typeName: string,
    providerType: ProviderType,
    meta: Omit<ProviderMeta, 'providerType' | 'typeName'>,
    factory: T,
  ): void {
    if (map.has(typeName)) {
      console.warn(
        `[ProviderRegistry] ${providerType} type '${typeName}' already registered, overwriting.`,
      );
    }
    map.set(typeName, {
      factory,
      meta: { ...meta, typeName, providerType },
    });
  }

  private create<T, C>(
    map: Map<string, FactoryEntry<(config: C) => T>>,
    label: string,
    typeName: string,
    config: C,
  ): T | null {
    const entry = map.get(typeName);
    if (!entry) {
      console.error(`[ProviderRegistry] Unknown ${label} type: '${typeName}'`);
      return null;
    }
    try {
      return entry.factory(config);
    } catch (err) {
      console.error(`[ProviderRegistry] Failed to create ${label} '${typeName}':`, err);
      return null;
    }
  }
}

/** 全局单例注册表 */
export const providerRegistry = new ProviderRegistry();
