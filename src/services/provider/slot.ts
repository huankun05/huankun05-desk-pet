/**
 * ProviderSlot：单一 Provider 类型（chat/tts/stt）的缓存管理
 *
 * 仅封装"查缓存→创建→缓存→销毁"逻辑，不持有任何持久化状态。
 * 持久化状态（activeId、sessionOverrides、configs）仍由 ProviderManager 统一管理，
 * 这样可以保持序列化结构不变，降低重构风险。
 *
 * 消除 Chat/TTS/STT 三份重复的缓存操作代码。
 */

import { createLogger } from '../../utils/logger';
import type { Provider, ProviderConfig } from './types';

const log = createLogger('ProviderSlot');

/** 所有具体 Provider 实现都具备 abort()，但基础 Provider 接口未声明，这里收窄约束 */
type AbortableProvider = Provider & { abort?: () => void };

export class ProviderSlot<T extends AbortableProvider> {
  private cache = new Map<string, T>();

  constructor(
    /** 用于日志展示，如 'ChatProvider' / 'TTSProvider' / 'STTProvider' */
    private readonly displayName: string,
    /** 按配置创建实例；失败返回 null（由调用方记录错误） */
    private readonly factory: (config: ProviderConfig) => T | null,
  ) {}

  /** 仅查缓存，不创建。命中返回实例，否则 undefined */
  peek(id: string): T | undefined {
    return this.cache.get(id);
  }

  /**
   * 查缓存→创建→缓存。
   * 调用前应已校验 config 存在且 enable=true。
   */
  getOrCreate(id: string, config: ProviderConfig): T | null {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const provider = this.factory(config);
    if (provider) {
      this.cache.set(id, provider);
      log.debug(`${this.displayName} lazily created`, { id });
    }
    return provider;
  }

  /** abort 并移除单个缓存实例（无缓存时为 no-op） */
  invalidate(id: string): void {
    const cached = this.cache.get(id);
    if (!cached) return;
    try {
      cached.abort?.();
    } catch {
      /* ignore */
    }
    this.cache.delete(id);
  }

  /** abort 并清空所有缓存实例 */
  clear(): void {
    for (const [_id, p] of this.cache) {
      try {
        p.abort?.();
      } catch {
        /* ignore */
      }
    }
    this.cache.clear();
  }
}
