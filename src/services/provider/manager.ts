/**
 * ProviderManager：Provider 生命周期管理
 *
 * 负责 Provider 实例的创建、销毁、活跃管理和配置持久化。
 * 使用 createStorage 双备份（localStorage + Tauri 文件）。
 *
 * 懒加载策略（v2）：
 * - init() 时仅加载配置，不预创建实例
 * - getActiveChatProvider() / getActiveTTSProvider() / getActiveSTTProvider() 按需创建并缓存
 * - 切换活跃 Provider 时，旧实例调用 abort() 释放连接/定时器
 * - addProvider/updateProvider 只改配置；若缓存已有实例则同步更新
 *
 * 关键行为：
 * - 创建失败不阻塞其他 provider（resilient loading）
 * - 首次启动自动从旧 settings 迁移配置
 */

import { createStorage } from '../storage';
import { createLogger } from '../../utils/logger';
import { OpenAIChatProvider } from './openai/chat';
import { OllamaChatProvider } from './ollama/chat';
import { providerRegistry } from './registry';
import { ProviderSlot } from './slot';
import { EdgeTTSProvider } from './tts/edge';
import type { EdgeTTSConfig } from './tts/edge';
import { GPTSoVitsProvider } from './tts/gptsovits';
import type { GPTSoVitsConfig } from './tts/gptsovits';
import { CosyVoiceProvider } from './tts/cosyvoice';
import type { CosyVoiceConfig } from './tts/cosyvoice';
import { PiperTTSProvider } from './tts/piper';
import type { PiperTTSConfig } from './tts/piper';
import { FunASRProvider } from './stt/funasr';
import { SenseVoiceProvider } from './stt/sensevoice';
import { SherpaONNXProvider } from './stt/sherpaonnx';
import type { SherpaONNXConfig } from './stt/sherpaonnx';
import { OllamaEmbeddingProvider } from './embedding/ollama';
import { OpenAIEmbeddingProvider } from './embedding/openai';
import type {
  ChatProvider,
  ChatProviderConfig,
  EmbeddingProvider,
  EmbeddingProviderConfig,
  Provider,
  ProviderConfig,
  ProviderMeta,
  ProviderType,
  STTProvider,
  STTProviderConfig,
  TTSProvider,
  TTSProviderConfig,
} from './types';

// ===== 注册默认适配器 =====

// 在模块加载时自动注册，确保 ProviderManager.init() 之前完成

// Chat: OpenAI 兼容接口
providerRegistry.registerChatProvider(
  'openai_chat',
  {
    displayName: 'OpenAI 兼容接口',
    description: '支持 OpenAI、DeepSeek、Moonshot 等所有 OpenAI 兼容的对话接口',
  },
  (config) =>
    new OpenAIChatProvider(
      config as ChatProviderConfig & {
        systemPrompt?: string;
        enableSmartChat?: boolean;
      },
    ),
);

// Chat: Ollama 本地模型（自动检测，无需 API Key）
providerRegistry.registerChatProvider(
  'ollama',
  {
    displayName: 'Ollama（本地）',
    description: '本地 LLM 推理，OpenAI 兼容 API，自动检测模型',
  },
  (config) => new OllamaChatProvider(config as ChatProviderConfig),
);

// TTS: Edge TTS（默认免费方案）
providerRegistry.registerTTSProvider(
  'edge_tts',
  {
    displayName: 'Edge TTS',
    description: '微软在线 TTS，免费零部署，多种中文语音可选',
  },
  (config) => new EdgeTTSProvider(config as EdgeTTSConfig),
);

// TTS: GPT-SoVITS v2（本地声音克隆）
providerRegistry.registerTTSProvider(
  'gpt_sovits',
  {
    displayName: 'GPT-SoVITS v2',
    description: '本地声音克隆，RTF 0.47x，需要 GPU 服务',
  },
  (config) => new GPTSoVitsProvider(config as GPTSoVitsConfig),
);

// TTS: CosyVoice V3（纳西妲微调，当前主力离线引擎，需 GPU）
providerRegistry.registerTTSProvider(
  'cosyvoice',
  {
    displayName: 'CosyVoice V3（纳西妲微调）',
    description: '阿里 CosyVoice V3 + 纳西妲微调，本地离线高质声音克隆，需 GPU',
  },
  (config) => new CosyVoiceProvider(config as CosyVoiceConfig),
);

// STT: FunASR Paraformer（主力识别）
providerRegistry.registerSTTProvider(
  'funasr',
  {
    displayName: 'FunASR Paraformer',
    description: '流式 ASR + VAD + 标点恢复，CPU 可用',
  },
  (config) => new FunASRProvider(config as STTProviderConfig),
);

// STT: SenseVoice（情绪检测增强）
providerRegistry.registerSTTProvider(
  'sensevoice',
  {
    displayName: 'SenseVoice',
    description: '语音识别 + 情绪标签检测（happy/sad/angry/neutral）',
  },
  (config) => new SenseVoiceProvider(config as STTProviderConfig),
);

// TTS: Piper（轻量本地 TTS，CPU 友好，RTF < 0.5）
providerRegistry.registerTTSProvider(
  'piper',
  {
    displayName: 'Piper TTS',
    description: '轻量本地 TTS，CPU 友好，合成速度快，适合低配置设备',
  },
  (config) => new PiperTTSProvider(config as PiperTTSConfig),
);

// STT: Sherpa ONNX（轻量本地 ASR，多模型支持）
providerRegistry.registerSTTProvider(
  'sherpa_onnx',
  {
    displayName: 'Sherpa ONNX',
    description: '轻量本地 ASR，支持 SenseVoice/Paraformer/Nemo 等模型',
  },
  (config) => new SherpaONNXProvider(config as SherpaONNXConfig),
);

// ===== 状态类型 =====

interface ProviderManagerState {
  /** 所有 provider 配置（完整序列化，含 provider 特有字段） */
  configs: unknown[];
  /** 当前活跃 ChatProvider 的 id */
  activeChatId: string | null;
  /** 当前活跃 TTSProvider 的 id */
  activeTTSId: string | null;
  /** 当前活跃 STTProvider 的 id */
  activeSTTId: string | null;
  /** 当前活跃 EmbeddingProvider 的 id */
  activeEmbeddingId: string | null;
  /** 会话级 Provider 覆盖（Phase 1.6 完善） */
  sessionOverrides: Record<
    string,
    { chatId?: string; ttsId?: string; sttId?: string; embeddingId?: string }
  >;
}

const DEFAULT_STATE: ProviderManagerState = {
  configs: [],
  activeChatId: null,
  activeTTSId: null,
  activeSTTId: null,
  activeEmbeddingId: null,
  sessionOverrides: {},
};

// ===== 旧配置兼容 =====

/** 旧版 AIConfig 结构（settings storage 中的） */
interface LegacyAIConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
  enableSmartChat?: boolean;
}

// ===== ProviderManager =====

const log = createLogger('ProviderManager');

export class ProviderManager {
  /**
   * 三类 Provider 的缓存实例，由 ProviderSlot 统一管理"查缓存→创建→缓存→销毁"。
   * 持久化状态（activeId / sessionOverrides / configs）仍在 this.state 中。
   */
  private chatSlot = new ProviderSlot<ChatProvider>(
    'ChatProvider',
    (config) => this.createProviderFromConfig(config) as ChatProvider | null,
  );
  private ttsSlot = new ProviderSlot<TTSProvider>(
    'TTSProvider',
    (config) => this.createProviderFromConfig(config) as TTSProvider | null,
  );
  private sttSlot = new ProviderSlot<STTProvider>(
    'STTProvider',
    (config) => this.createProviderFromConfig(config) as STTProvider | null,
  );
  private embeddingSlot = new ProviderSlot<EmbeddingProvider>(
    'EmbeddingProvider',
    (config) => this.createProviderFromConfig(config) as EmbeddingProvider | null,
  );
  private state: ProviderManagerState = { ...DEFAULT_STATE };
  private storage = createStorage<ProviderManagerState>('providers', DEFAULT_STATE);
  private _ready: Promise<void>;
  private initialized = false;

  /**
   * 运行时"不健康"标记（Phase 12.1）：id -> 过期时间戳(ms)。
   * 仅驻留内存、不持久化。provider 实际调用失败后由调用方标记，
   * 下次选取时自动避开并回退到其他可用实例（Harness 式"健康探针胜出"自愈）。
   * 带 TTL 过期，使瞬时故障可自动恢复重试。
   */
  private unhealthy = new Map<string, number>();
  private readonly UNHEALTHY_TTL_MS = 5 * 60_000;

  constructor() {
    this._ready = this.init();
  }

  /** 等待初始化完成 */
  get ready(): Promise<void> {
    return this._ready;
  }

  /**
   * 初始化：仅加载配置，不预创建实例（懒加载）
   */
  private async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // 从 storage 加载
    await this.storage.init();
    const saved = this.storage.get();

    if (saved.configs.length === 0) {
      // 首次启动：尝试从旧 settings 迁移
      await this.migrateFromLegacy();
    } else {
      this.state = { ...DEFAULT_STATE, ...saved };
    }

    // 懒加载：不在此处创建实例，等待首次 getActiveXxxProvider() 调用
    log.info('Initialized (lazy)', {
      configs: this.state.configs.length,
      activeChat: this.state.activeChatId,
      activeTTS: this.state.activeTTSId,
      activeSTT: this.state.activeSTTId,
      activeEmbedding: this.state.activeEmbeddingId,
    });
  }

  /**
   * 从旧 settings storage 迁移配置
   */
  private async migrateFromLegacy(): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const raw = await invoke<string>('load_data', { key: 'settings' });
      if (raw) {
        const legacy: LegacyAIConfig = JSON.parse(raw);
        if (legacy.apiUrl) {
          const config = this.legacyToProviderConfig(legacy);
          this.state.configs = [config];
          this.state.activeChatId = config.id;
          this.saveState();
          log.info('Migrated legacy settings to provider config');
          return;
        }
      }
    } catch {
      // 迁移失败不阻塞
    }

    // 也检查 localStorage
    try {
      const raw = localStorage.getItem('deskpet_settings');
      if (raw) {
        const legacy: LegacyAIConfig = JSON.parse(raw);
        if (legacy.apiUrl) {
          const config = this.legacyToProviderConfig(legacy);
          this.state.configs = [config];
          this.state.activeChatId = config.id;
          this.saveState();
          log.info('Migrated localStorage settings to provider config');
          return;
        }
      }
    } catch {
      // 忽略
    }
  }

  /**
   * 将旧版 AIConfig 转为 OpenAIChatProvider 配置
   */
  private legacyToProviderConfig(legacy: LegacyAIConfig): ChatProviderConfig & {
    systemPrompt?: string;
    enableSmartChat?: boolean;
  } {
    return {
      id: 'default-openai',
      type: 'chat' as const,
      typeName: 'openai_chat',
      name: 'OpenAI 兼容接口',
      enable: true,
      apiKey: legacy.apiKey || '',
      apiBase: legacy.apiUrl || 'https://api.openai.com/v1',
      model: legacy.model || 'gpt-3.5-turbo',
      systemPrompt: legacy.systemPrompt,
      enableSmartChat: legacy.enableSmartChat,
    };
  }

  /**
   * 按需创建单个 Provider 实例（懒加载核心）
   *
   * 仅在 getActiveXxxProvider() 首次请求时调用。
   * 创建失败返回 null 并记录日志，不阻塞其他 provider。
   */
  private createProviderFromConfig(config: ProviderConfig): Provider | null {
    try {
      if (config.type === 'chat') {
        return providerRegistry.createChatProvider(
          (config as ChatProviderConfig).typeName,
          config as ChatProviderConfig,
        );
      } else if (config.type === 'tts') {
        return providerRegistry.createTTSProvider(
          (config as TTSProviderConfig).typeName,
          config as TTSProviderConfig,
        );
      } else if (config.type === 'stt') {
        return providerRegistry.createSTTProvider(
          (config as STTProviderConfig).typeName,
          config as STTProviderConfig,
        );
      } else if (config.type === 'embedding') {
        const embeddingConfig = config as EmbeddingProviderConfig;
        const apiBase = (embeddingConfig.apiBase || '').replace(/\/+$/, '');
        const model = embeddingConfig.model || 'nomic-embed-text';
        if (
          apiBase.includes('localhost') ||
          apiBase.includes('127.0.0.1') ||
          apiBase.includes('11434')
        ) {
          return new OllamaEmbeddingProvider({ ...embeddingConfig, apiBase, model });
        }
        return new OpenAIEmbeddingProvider({ ...embeddingConfig, apiBase, model });
      }
    } catch (err) {
      log.error(`Failed to create provider '${config.id}'`, err);
    }
    return null;
  }

  /**
   * 查找配置（按 id 和 type）
   */
  private findConfig(id: string, type?: ProviderType): ProviderConfig | undefined {
    return this.state.configs.find((c) => {
      const cfg = c as ProviderConfig;
      return cfg.id === id && (!type || cfg.type === type);
    }) as ProviderConfig | undefined;
  }

  /**
   * 在 configs 中找下一个 enabled 的同类型 provider id（用于活跃 provider 被移除时的回退）
   */
  private findNextEnabledId(type: ProviderType): string | undefined {
    const next = this.state.configs.find((c) => {
      const cfg = c as ProviderConfig;
      return cfg.type === type && cfg.enable;
    }) as ProviderConfig | undefined;
    return next?.id;
  }

  /**
   * 清空所有缓存的 Provider 实例（先 abort 释放资源）
   */
  private clearProviderCache(): void {
    this.chatSlot.clear();
    this.ttsSlot.clear();
    this.sttSlot.clear();
  }

  // ===== CRUD =====

  /**
   * 添加新 Provider（通用，支持 Chat/TTS/STT）
   *
   * 懒加载：仅保存配置，不创建实例。
   * 实例在首次 getActiveXxxProvider() 时按需创建。
   */
  addProvider(
    config: ChatProviderConfig | TTSProviderConfig | STTProviderConfig | EmbeddingProviderConfig,
  ): boolean {
    if (this.state.configs.some((c) => (c as ProviderConfig).id === config.id)) {
      log.error(`Provider id '${config.id}' already exists`);
      return false;
    }

    // 验证配置可创建（不保留实例）
    const probe = this.createProviderFromConfig(config as ProviderConfig);
    if (!probe) {
      log.error(
        config.type === 'embedding'
          ? `Embedding provider '${config.id}' registration/create failed`
          : `Provider type '${(config as ChatProviderConfig | TTSProviderConfig | STTProviderConfig).typeName}' not registered or creation failed`,
      );
      return false;
    }
    // 立即释放探针实例（仅用于验证）
    try {
      // Provider 基础接口无 abort，但所有具体实现都有
      (probe as { abort?: () => void }).abort?.();
    } catch {
      /* ignore */
    }

    this.state.configs.push(JSON.parse(JSON.stringify(config)));
    log.info('Provider added (lazy)', {
      id: config.id,
      type: config.type,
    });

    // 自动设为对应类型的活跃 provider
    if (config.type === 'chat' && !this.state.activeChatId) this.state.activeChatId = config.id;
    if (config.type === 'tts' && !this.state.activeTTSId) this.state.activeTTSId = config.id;
    if (config.type === 'stt' && !this.state.activeSTTId) this.state.activeSTTId = config.id;

    this.saveState();
    return true;
  }

  /**
   * 移除 Provider
   *
   * 懒加载：从配置删除，并 abort 缓存实例（如有）。
   * 若移除的是活跃 provider，则从配置中找下一个 enabled 的同类型 provider。
   */
  removeProvider(id: string): void {
    log.info('Removing provider', { id });
    const config = this.state.configs.find((c) => (c as ProviderConfig).id === id) as
      ProviderConfig | undefined;
    this.state.configs = this.state.configs.filter((c) => (c as ProviderConfig).id !== id);

    const type = config?.type;
    if (type === 'chat') {
      this.chatSlot.invalidate(id);
      if (this.state.activeChatId === id) {
        this.state.activeChatId = this.findNextEnabledId('chat') ?? null;
      }
    } else if (type === 'tts') {
      this.ttsSlot.invalidate(id);
      if (this.state.activeTTSId === id) {
        this.state.activeTTSId = this.findNextEnabledId('tts') ?? null;
      }
    } else if (type === 'stt') {
      this.sttSlot.invalidate(id);
      if (this.state.activeSTTId === id) {
        this.state.activeSTTId = this.findNextEnabledId('stt') ?? null;
      }
    }

    // 清理会话级覆盖
    for (const [sessionId, overrides] of Object.entries(this.state.sessionOverrides)) {
      if (overrides.chatId === id) delete overrides.chatId;
      if (overrides.ttsId === id) delete overrides.ttsId;
      if (overrides.sttId === id) delete overrides.sttId;
      if (Object.keys(overrides).length === 0) delete this.state.sessionOverrides[sessionId];
    }

    this.saveState();
  }

  /**
   * 更新 Provider 配置
   *
   * 懒加载：仅更新配置。若该实例已缓存，则销毁旧实例（下次访问时按新配置重建）。
   */
  updateProvider(
    id: string,
    updates: Partial<
      ChatProviderConfig | TTSProviderConfig | STTProviderConfig | EmbeddingProviderConfig
    >,
  ): void {
    const idx = this.state.configs.findIndex((c) => (c as ProviderConfig).id === id);
    if (idx === -1) return;

    const oldConfig = this.state.configs[idx] as ProviderConfig;
    const newConfig = { ...oldConfig, ...updates };
    this.state.configs[idx] = JSON.parse(JSON.stringify(newConfig));

    // 若实例已缓存，销毁旧实例（下次 getActiveXxx 时按新配置重建）
    if (oldConfig.type === 'chat') {
      this.chatSlot.invalidate(id);
    } else if (oldConfig.type === 'tts') {
      this.ttsSlot.invalidate(id);
    } else if (oldConfig.type === 'stt') {
      this.sttSlot.invalidate(id);
    }

    this.saveState();
  }

  /**
   * 调整某类型 Provider 的展示顺序
   * @param type - chat / tts / stt
   * @param orderedIds - 该类型下新的 id 顺序（仅包含本类型，其他类型保持原相对顺序）
   */
  reorderProviders(type: ProviderType, orderedIds: string[]): void {
    const all = this.state.configs as ProviderConfig[];
    const byType = all.filter((c) => c.type === type);
    const others = all.filter((c) => c.type !== type);
    const map = new Map<string, ProviderConfig>(byType.map((c) => [c.id, c]));
    const reordered = orderedIds.map((id) => map.get(id)).filter((c): c is ProviderConfig => !!c);
    // 仅当传入顺序与当前一致时可原样返回；否则合并写回
    this.state.configs = [...reordered, ...others];
    this.saveState();
    log.info('Providers reordered', { type, count: reordered.length });
  }

  // ===== 活跃管理（懒加载） =====

  /**
   * 获取 ChatProvider 实例（按需创建并缓存）
   * @param id - 指定 id，不传则返回活跃 provider
   */
  getChatProvider(id?: string): ChatProvider | null {
    if (id) {
      const cached = this.chatSlot.peek(id);
      if (cached) return cached;
      const config = this.findConfig(id, 'chat');
      if (!config || !config.enable) return null;
      return this.chatSlot.getOrCreate(id, config);
    }
    return this.resolveActive('chat', this.chatSlot, this.state.activeChatId);
  }

  /**
   * 获取当前活跃的 ChatProvider
   */
  getActiveChatProvider(): ChatProvider | null {
    return this.getChatProvider();
  }

  /**
   * 获取 TTSProvider 实例（按需创建并缓存）
   */
  private getTTSProvider(id?: string): TTSProvider | null {
    if (id) {
      const cached = this.ttsSlot.peek(id);
      if (cached) return cached;
      const config = this.findConfig(id, 'tts');
      if (!config || !config.enable) return null;
      return this.ttsSlot.getOrCreate(id, config);
    }
    return this.resolveActive('tts', this.ttsSlot, this.state.activeTTSId);
  }

  /**
   * 获取当前活跃的 TTSProvider
   */
  getActiveTTSProvider(): TTSProvider | null {
    return this.getTTSProvider();
  }

  /**
   * 获取 STTProvider 实例（按需创建并缓存）
   */
  private getSTTProvider(id?: string): STTProvider | null {
    if (id) {
      const cached = this.sttSlot.peek(id);
      if (cached) return cached;
      const config = this.findConfig(id, 'stt');
      if (!config || !config.enable) return null;
      return this.sttSlot.getOrCreate(id, config);
    }
    return this.resolveActive('stt', this.sttSlot, this.state.activeSTTId);
  }

  /**
   * 获取当前活跃的 STTProvider
   */
  getActiveSTTProvider(): STTProvider | null {
    return this.getSTTProvider();
  }

  /**
   * 设置活跃 Provider（Chat/TTS/STT 通用）
   *
   * 切换时销毁旧活跃实例（释放连接/定时器），新实例在下次访问时按需创建。
   */
  private setActive(type: 'chat' | 'tts' | 'stt' | 'embedding', id: string): void {
    const displayName =
      type === 'chat'
        ? 'ChatProvider'
        : type === 'tts'
          ? 'TTSProvider'
          : type === 'stt'
            ? 'STTProvider'
            : 'EmbeddingProvider';
    const config = this.findConfig(id, type);
    if (!config) {
      log.error(`${displayName} '${id}' not found in configs`);
      return;
    }
    if (!config.enable) {
      log.error(`${displayName} '${id}' is disabled`);
      return;
    }

    const oldId = this.getActiveId(type);
    if (oldId && oldId !== id) {
      if (type === 'chat') this.chatSlot.invalidate(oldId);
      else if (type === 'tts') this.ttsSlot.invalidate(oldId);
      else if (type === 'stt') this.sttSlot.invalidate(oldId);
      else this.embeddingSlot.invalidate(oldId);
      log.debug(`Old ${displayName} aborted`, { id: oldId });
    }

    this.setActiveId(type, id);
    this.saveState();
  }

  setActiveChatProvider(id: string): void {
    this.setActive('chat', id);
  }

  setActiveTTSProvider(id: string): void {
    this.setActive('tts', id);
  }

  setActiveSTTProvider(id: string): void {
    this.setActive('stt', id);
  }

  setActiveEmbeddingProvider(id: string): void {
    this.setActive('embedding', id);
  }

  /** 读取某类型的当前活跃 id */
  private getActiveId(type: 'chat' | 'tts' | 'stt' | 'embedding'): string | null {
    if (type === 'chat') return this.state.activeChatId;
    if (type === 'tts') return this.state.activeTTSId;
    if (type === 'stt') return this.state.activeSTTId;
    return this.state.activeEmbeddingId;
  }

  /** 设置某类型的当前活跃 id */
  private setActiveId(type: 'chat' | 'tts' | 'stt' | 'embedding', id: string | null): void {
    if (type === 'chat') this.state.activeChatId = id;
    else if (type === 'tts') this.state.activeTTSId = id;
    else if (type === 'stt') this.state.activeSTTId = id;
    else this.state.activeEmbeddingId = id;
  }

  getActiveEmbeddingProvider(id?: string): EmbeddingProvider | null {
    if (id) {
      const cached = this.embeddingSlot.peek(id);
      if (cached) return cached;
      const config = this.findConfig(id, 'embedding');
      if (!config || !config.enable) return null;
      return this.embeddingSlot.getOrCreate(id, config);
    }
    return this.resolveActive('embedding', this.embeddingSlot, this.state.activeEmbeddingId);
  }

  // ===== 运行时健康标记（Phase 12.1） =====

  /**
   * 标记某 provider 当前不可用（运行时自愈入口）。
   *
   * 典型调用方：TTS 播放失败、STT 识别失败等。标记后，
   * 后续 `getActiveXxxProvider()` 会避开该 id 并自动回退到下一个可用实例。
   * 带 TTL 过期，使瞬时故障可在 {@link UNHEALTHY_TTL_MS} 后自动重试。
   */
  markUnhealthy(type: ProviderType, id: string): void {
    this.unhealthy.set(id, Date.now() + this.UNHEALTHY_TTL_MS);
    log.warn('Provider marked unhealthy (runtime fallback armed)', { type, id });
  }

  /** 主动清除某 provider 的不健康标记（调用成功后可复位） */
  markHealthy(type: ProviderType, id: string): void {
    if (this.unhealthy.delete(id)) {
      log.info('Provider cleared unhealthy', { type, id });
    }
  }

  /** 该 id 当前是否处于"不健康且未过期"状态 */
  private isUnhealthy(id: string): boolean {
    const exp = this.unhealthy.get(id);
    if (exp === undefined) return false;
    if (Date.now() > exp) {
      this.unhealthy.delete(id);
      return false;
    }
    return true;
  }

  /**
   * 健康感知解析（同步、无网络）：
   * active 优先，若其配置禁用 / 创建失败 / 被标记为不健康，则回退到同类型
   * 下一个 enabled 且未被标记不健康的实例。均无则返回 null。
   *
   * 对应 Harness "健康探针胜出"：消费者只认 active 这个"接缝"，
   * 底层具体 provider 损坏时由运行时自动换路，不污染调用方逻辑。
   */
  private resolveActive<T extends Provider>(
    type: ProviderType,
    slot: ProviderSlot<T>,
    activeId: string | null,
  ): T | null {
    const candidates: string[] = [];
    if (activeId) candidates.push(activeId);
    for (const c of this.state.configs as ProviderConfig[]) {
      if (c.type === type && c.enable && c.id !== activeId) candidates.push(c.id);
    }
    for (const id of candidates) {
      if (this.isUnhealthy(id)) continue;
      const config = this.findConfig(id, type);
      if (!config || !config.enable) continue;
      try {
        const provider = slot.getOrCreate(id, config);
        if (provider) return provider;
      } catch (err) {
        log.warn('Provider instantiate failed, skipping', { type, id, error: String(err) });
        this.unhealthy.set(id, Date.now() + this.UNHEALTHY_TTL_MS);
      }
    }
    return null;
  }

  // ===== 会话级覆盖（Phase 1.6 完善） =====

  /**
   * 获取会话级 ChatProvider（优先会话覆盖，fallback 到全局活跃）
   */
  getSessionChatProvider(sessionId: string): ChatProvider | null {
    const override = this.state.sessionOverrides[sessionId];
    if (override?.chatId) {
      // 通过 getChatProvider 触发懒加载
      return this.getChatProvider(override.chatId);
    }
    return this.getActiveChatProvider();
  }

  /**
   * 获取会话级 TTSProvider（优先会话覆盖，fallback 到全局活跃）
   *
   * 若 override 指向的 provider 已失效（配置删除/禁用/创建失败），
   * 回退到全局活跃 provider，保持原有容错语义。
   */
  getSessionTTSProvider(sessionId: string): TTSProvider | null {
    const override = this.state.sessionOverrides[sessionId];
    if (override?.ttsId) {
      const provider = this.getTTSProvider(override.ttsId);
      if (provider) return provider;
    }
    return this.getActiveTTSProvider();
  }

  /**
   * 获取会话级 STTProvider（优先会话覆盖，fallback 到全局活跃）
   *
   * 同 getSessionTTSProvider，override 失效时回退到全局活跃。
   */
  getSessionSTTProvider(sessionId: string): STTProvider | null {
    const override = this.state.sessionOverrides[sessionId];
    if (override?.sttId) {
      const provider = this.getSTTProvider(override.sttId);
      if (provider) return provider;
    }
    return this.getActiveSTTProvider();
  }

  /**
   * 设置会话级 Provider 覆盖（Chat/TTS/STT 通用）
   */
  private setSessionOverride(
    type: 'chat' | 'tts' | 'stt',
    sessionId: string,
    providerId: string | null,
  ): void {
    const key: 'chatId' | 'ttsId' | 'sttId' =
      type === 'chat' ? 'chatId' : type === 'tts' ? 'ttsId' : 'sttId';
    if (providerId === null) {
      const override = this.state.sessionOverrides[sessionId];
      if (override) {
        delete override[key];
        if (Object.keys(override).length === 0) delete this.state.sessionOverrides[sessionId];
      }
    } else {
      if (!this.state.sessionOverrides[sessionId]) this.state.sessionOverrides[sessionId] = {};
      this.state.sessionOverrides[sessionId][key] = providerId;
    }
    this.saveState();
  }

  setSessionChatProvider(sessionId: string, providerId: string | null): void {
    this.setSessionOverride('chat', sessionId, providerId);
  }

  setSessionTTSProvider(sessionId: string, providerId: string | null): void {
    this.setSessionOverride('tts', sessionId, providerId);
  }

  setSessionSTTProvider(sessionId: string, providerId: string | null): void {
    this.setSessionOverride('stt', sessionId, providerId);
  }

  // ===== 查询 =====

  /**
   * 列出所有 provider 配置
   */
  listProviders(type?: ProviderType): ProviderConfig[] {
    const configs = this.state.configs as ProviderConfig[];
    if (!type) return configs.map((c) => ({ ...c }));
    return configs.filter((c) => c.type === type).map((c) => ({ ...c }));
  }

  /**
   * 获取所有已注册的适配器类型
   */
  getRegisteredTypes(): ProviderMeta[] {
    return [
      ...providerRegistry.getRegisteredTypes('chat'),
      ...providerRegistry.getRegisteredTypes('tts'),
      ...providerRegistry.getRegisteredTypes('stt'),
    ];
  }

  /**
   * 获取指定 id 的完整配置（含 provider 特有字段）
   */
  getConfig<T = unknown>(id: string): T | null {
    const config = this.state.configs.find((c) => (c as ProviderConfig).id === id);
    return config ? (JSON.parse(JSON.stringify(config)) as T) : null;
  }

  // ===== 热重载 =====

  /**
   * 从磁盘重载 Provider 配置（admin 面板保存后调用）
   *
   * 流程：abort 所有缓存实例 → 从 providers.json 重载配置
   * 实例在下次访问时按需创建（懒加载）。
   */
  async reloadProviders(): Promise<void> {
    log.info('Reloading providers from disk...');

    // 1. 释放所有缓存实例
    this.clearProviderCache();

    // 2. 从磁盘读取最新配置
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const raw = await invoke<string>('load_data', { key: 'providers' });
      if (raw) {
        const diskState = JSON.parse(raw) as ProviderManagerState;
        this.state = { ...DEFAULT_STATE, ...diskState };
      }
    } catch (err) {
      log.error('Failed to load providers from disk, keeping current state', err);
      return;
    }

    // 3. 同步到 localStorage（让 storage 层也更新）
    this.saveState();

    log.info('Providers reloaded (lazy)', {
      configs: this.state.configs.length,
      activeChat: this.state.activeChatId,
      activeTTS: this.state.activeTTSId,
      activeSTT: this.state.activeSTTId,
    });
  }

  // ===== 内部 =====

  private saveState(): void {
    this.storage.set(this.state);
  }
}

/** 全局单例 ProviderManager */
export const providerManager = new ProviderManager();
