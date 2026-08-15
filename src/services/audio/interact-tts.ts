/**
 * InteractTTS — 预制台词 TTS 预生成与播放服务
 *
 * 功能：
 * 1. 批量预生成预制台词的音频并缓存
 * 2. 按文本匹配播放缓存音频
 * 3. 支持增量更新（消息变更时只重新生成变化的）
 * 4. 通过 AudioPlayer 播放（支持嘴型同步）
 */

import { createLogger } from '../../utils/logger';
import { audioPlayer } from '../audio/player';
import type { TTSProvider } from '../provider/types';
import { loadInteractionConfig } from '../../settings/pages/models/InteractionPage';
import { collectAllPresetTexts } from '../../data/idleMessages';
import { providerManager } from '../provider/manager';
import { ensureActiveTTSBackend } from '../provider/ttsBackend';

const log = createLogger('InteractTTS');

// ===== 缓存类型 =====

interface CachedAudio {
  /** WAV 音频数据 */
  audio: ArrayBuffer;
  /** 采样率 */
  sampleRate: number;
  /** 缓存时间戳（用于失效判断） */
  cachedAt: number;
  /** 原文（用于匹配） */
  text: string;
}

// ===== 配置 =====

const INTERACT_TTS_VERSION = 1; // 版本号，结构变化时清空缓存

/** 最大缓存条目数 */
const MAX_CACHE_SIZE = 200;

// ===== IndexedDB 持久化层 =====
// 音频数据体积大，localStorage 无法承载，使用 IndexedDB 持久化，
// 避免每次启动都重新生成所有预制台词（节省 TTS API 调用与启动耗时）。

const DB_NAME = 'deskpet_interact_tts';
const DB_STORE = 'audio';
const DB_VERSION = 1;

interface IDBEntry {
  text: string;
  blob: Blob;
  sampleRate: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'text' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(): Promise<Map<string, IDBEntry>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const map = new Map<string, IDBEntry>();
      for (const e of req.result as IDBEntry[]) map.set(e.text, e);
      resolve(map);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(text: string, blob: Blob, sampleRate: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put({ text, blob, sampleRate });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(text: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(text);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ===== 服务类 =====

export class InteractTTS {
  private cache: Map<string, CachedAudio> = new Map();
  private provider: TTSProvider | null = null;
  private enabled = false;
  private isGenerating = false;
  /** 当前正在生成的队列（用于去重） */
  private generatingSet: Set<string> = new Set();
  /** 是否已完成从配置初始化 */
  private initialized = false;
  /** 上次读取的 enabled 状态，用于跳过重复初始化 */
  private lastEnabled: boolean | null = null;
  /** 上次 provider 获取失败时间（节流重试，避免高频空转） */
  private lastProviderFailAt = 0;
  /** 上次接入的活跃 TTS 模型 id（用于热插拔检测，变化时重置旧实例与缓存） */
  private lastProviderId: string | null = null;
  /** IndexedDB 恢复完成的 Promise（prewarm/play 前可等待） */
  private cacheLoadPromise: Promise<void> | null = null;

  constructor() {
    this.cacheLoadPromise = this.loadCacheFromIDB();
  }

  /**
   * 确保已从持久化配置初始化（懒调用，重复调用安全）。
   * 关键：热插拔——若活跃 TTS 模型已变化，自动丢弃旧 provider 实例与旧缓存，
   * 用新模型重新接入，避免切换后还播放旧声音 / 调用已卸载的旧后端。
   */
  ensureInitialized(): void {
    const config = loadInteractionConfig();
    const enabled = config.enableInteractTTS === 1;

    // 取当前活跃模型 id（只是一次 map 查找，开销可忽略）
    const active = enabled ? providerManager.getActiveTTSProvider() : null;
    const activeId = active?.config.id ?? null;

    // 热插拔检测：之前已绑定某模型，现在活跃模型变了 → 重置
    if (this.lastProviderId !== null && activeId !== this.lastProviderId) {
      log.info('检测到活跃 TTS 模型变化，重置 InteractTTS', {
        from: this.lastProviderId,
        to: activeId,
      });
      this.provider = null;
      this.clearCache(); // 清掉旧模型音频，避免切换后还播放旧声音
      this.initialized = false;
    }
    this.lastProviderId = activeId;

    // 状态未变且已初始化：跳过（除非已启用但 provider 还没拿到，需重试）
    if (this.initialized && this.lastEnabled === enabled) {
      if (!enabled || this.provider) return;
      // enabled 但 provider 未就绪：节流重试（每 10s 一次）
      if (Date.now() - this.lastProviderFailAt < 10000) return;
    }
    this.lastEnabled = enabled;
    this.enabled = enabled;

    if (enabled) {
      if (!this.provider) {
        const ttsProvider = providerManager.getActiveTTSProvider();
        if (ttsProvider) {
          this.provider = ttsProvider;
          this.lastProviderId = ttsProvider.config.id;
          log.info('已自动连接 TTS Provider', { name: ttsProvider.getName() });
        } else {
          this.lastProviderFailAt = Date.now();
          log.warn('TTS 已启用但无可用 Provider（10s 后重试）');
        }
      }
    } else {
      this.provider = null; // 禁用时释放引用
    }

    this.initialized = true;
  }

  /** 设置 TTS Provider（在确认可用后调用） */
  setupProvider(provider: TTSProvider): void {
    this.provider = provider;
    log.info('Provider 已设置', { name: provider.getName() });
  }

  /** 启用/禁用 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      // 禁用时停止当前播放
      audioPlayer.stop();
    }
    log.info('TTS', enabled ? '已启用' : '已禁用');
  }

  /** 是否已就绪（有 provider 且启用） */
  get isReady(): boolean {
    return this.enabled && this.provider !== null;
  }

  /**
   * 预生成一批文本的音频
   * @param texts 待生成的文本数组
   * @param onProgress 进度回调 (completed, total)
   */
  async pregenerate(
    texts: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    this.ensureInitialized();
    if (!this.isReady || !this.provider) {
      log.warn('pregenerate: 未就绪');
      return;
    }

    // 过滤：跳过已有且未过期的缓存
    const needGenerate = texts.filter((t) => !this.cache.has(t));
    if (needGenerate.length === 0) {
      log.info('所有音频已缓存');
      onProgress?.(texts.length, texts.length);
      return;
    }

    this.isGenerating = true;
    let completed = this.cache.size;

    try {
      // 并发生成（最多 3 个并发）
      const concurrency = 3;
      for (let i = 0; i < needGenerate.length; i += concurrency) {
        const batch = needGenerate.slice(i, i + concurrency);
        await Promise.all(
          batch.map(async (text) => {
            if (this.generatingSet.has(text)) return; // 正在生成中

            this.generatingSet.add(text);
            try {
              const result = await this.provider!.synthesize(text);
              this.setCache(text, result.audio, result.sampleRate);
              completed++;
              onProgress?.(completed, texts.length);

              // 节流：避免缓存过大
              this.evictIfNeeded();
            } catch (err) {
              log.warn('生成失败', { text: text.slice(0, 30), err });
            } finally {
              this.generatingSet.delete(text);
            }
          }),
        );
      }
    } finally {
      this.isGenerating = false;
      this.persistCache();
    }

    log.info('预生成完成', { total: texts.length, cached: this.cache.size });
  }

  /**
   * 播放指定文本的缓存音频
   * @returns 是否成功播放
   */
  play(text: string): boolean {
    if (!this.enabled) return false;

    const cached = this.cache.get(text);
    if (!cached) {
      log.debug('未找到缓存', { text: text.slice(0, 30) });
      return false;
    }

    audioPlayer.enqueue(cached.audio, cached.sampleRate, `interact-${Date.now()}`);
    return true;
  }

  /**
   * 应用启动时预热：等待 IndexedDB 恢复完成后，对缺失的预制台词批量预生成。
   * 仅在 TTS 已启用时生效。首次使用需生成一次，之后均从 IndexedDB 恢复。
   * @param texts 全部预制台词文本（来自默认 + 自定义消息）
   */
  async prewarm(texts: string[]): Promise<void> {
    // 等待 IndexedDB 恢复完成
    if (this.cacheLoadPromise) {
      try {
        await this.cacheLoadPromise;
      } catch {
        /* ignore */
      }
    }
    this.ensureInitialized();
    if (!this.isReady) {
      log.info('TTS 未启用或无 Provider，跳过预热');
      return;
    }
    // 确保活跃 TTS 后端已启动（首次会拉起本地引擎并等待模型加载，约 10~20s）。
    // 否则下方批量预生成会因后端未运行而全部静默失败、缓存永远为空。
    const backendOk = await ensureActiveTTSBackend({ waitReady: true, timeoutMs: 60000 });
    if (!backendOk) {
      log.warn('TTS 后端未能启动，预热将尝试实时合成（可能失败，可重试）');
    }
    await this.pregenerate(texts);
  }

  /**
   * 切换活跃 TTS 模型后调用：用新模型重新预热全部预制台词。
   * 内部会先等待新后端就绪（约 10~20s 模型加载），再批量生成并覆盖缓存。
   * 失败则保留空缓存，后续 tryPlay 会实时合成兜底，不会静音。
   * 注意：会先 clearCache() 清掉旧模型音频，避免新旧声音混用。
   */
  async reprewarm(): Promise<void> {
    this.ensureInitialized();
    if (!this.isReady) {
      log.info('TTS 未启用或无 Provider，跳过重新预热');
      return;
    }
    this.clearCache();
    await this.prewarm(collectAllPresetTexts());
  }

  /**
   * 尝试播放（无缓存时用当前活跃模型实时合成）
   * 这是给 useInteraction 的便捷方法。切换 TTS 模型后旧缓存已清空，
   * 此处兜底实时合成，保证交互台词立即以新声音出声、不静音、不播旧声。
   */
  tryPlay(text: string): void {
    this.ensureInitialized();
    if (!this.enabled) return;
    if (this.play(text)) return;
    // 缓存未命中：实时用当前活跃模型合成（覆盖切换模型后旧缓存已清空的情形）
    void this.synthesizeLive(text);
  }

  /** 实时合成并播放（缓存未命中 / 模型切换后的兜底），失败静默降级 */
  private async synthesizeLive(text: string): Promise<void> {
    if (!this.isReady || !this.provider) return;
    try {
      const ok = await ensureActiveTTSBackend({ waitReady: true, timeoutMs: 40000 });
      if (!ok) {
        log.warn('实时合成：TTS 后端不可用，跳过', { text: text.slice(0, 30) });
        return;
      }
      const result = await this.provider.synthesize(text);
      this.setCache(text, result.audio, result.sampleRate);
      audioPlayer.enqueue(result.audio, result.sampleRate, `interact-${Date.now()}`);
    } catch (err) {
      log.warn('实时合成失败（交互台词）', { text: text.slice(0, 30), err });
    }
  }

  /** 清除所有缓存（内存 + IndexedDB） */
  clearCache(): void {
    this.cache.clear();
    this.persistCache();
    idbClear().catch(() => undefined);
    log.info('缓存已清空');
  }

  /** 获取缓存状态 */
  getStats(): { size: number; ready: boolean; generating: boolean } {
    return {
      size: this.cache.size,
      ready: this.isReady,
      generating: this.isGenerating,
    };
  }

  /** 获取已缓存的文本列表（用于调试） */
  getCachedTexts(): string[] {
    return Array.from(this.cache.keys());
  }

  // ===== 内部方法 =====

  private setCache(text: string, audio: ArrayBuffer, sampleRate: number): void {
    this.cache.set(text, {
      audio,
      sampleRate,
      cachedAt: Date.now(),
      text,
    });
    // 持久化到 IndexedDB（异步，不阻塞）
    idbPut(text, new Blob([audio], { type: 'audio/wav' }), sampleRate).catch(() => undefined);
  }

  /** LRU 淘汰：超过上限时移除最旧的（同时清理 IndexedDB） */
  private evictIfNeeded(): void {
    if (this.cache.size <= MAX_CACHE_SIZE) return;

    // 按 cachedAt 排序，删除最旧的 10%
    const entries = Array.from(this.cache.entries()).sort((a, b) => a[1].cachedAt - b[1].cachedAt);
    const toEvict = Math.ceil(MAX_CACHE_SIZE * 0.1);
    for (let i = 0; i < toEvict && i < entries.length; i++) {
      const key = entries[i][0];
      this.cache.delete(key);
      idbDelete(key).catch(() => undefined);
    }
  }

  /** 从 IndexedDB 异步恢复音频缓存（启动时调用） */
  private async loadCacheFromIDB(): Promise<void> {
    try {
      const all = await idbGetAll();
      for (const [text, entry] of all) {
        if (this.cache.has(text)) continue;
        const audio = await entry.blob.arrayBuffer();
        this.cache.set(text, {
          audio,
          sampleRate: entry.sampleRate,
          cachedAt: Date.now(),
          text,
        });
      }
      log.info('已从 IndexedDB 恢复 TTS 缓存', { size: this.cache.size });
    } catch (e) {
      log.warn('IndexedDB 恢复失败，将在使用时重新生成', { e });
    }
  }

  /** 同步占位：构造函数调用，实际恢复在 ensureCacheLoaded 中异步完成 */
  private loadCache(): void {
    // 异步恢复，不阻塞构造
    void this.loadCacheFromIDB();
  }

  /** 持久化缓存元数据（仅统计信息到 localStorage） */
  private persistCache(): void {
    try {
      localStorage.setItem(
        'deskpet_interact_tts_meta',
        JSON.stringify({
          size: this.cache.size,
          version: INTERACT_TTS_VERSION,
          updatedAt: Date.now(),
        }),
      );
    } catch {
      /* ignore */
    }
  }
}

/** 全局单例 */
export const interactTTS = new InteractTTS();
