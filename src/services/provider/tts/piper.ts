/**
 * Piper TTS Provider
 *
 * 调用 Piper TTS HTTP 服务（基于 piper-tts Python 包）。
 * 轻量本地 TTS，CPU 友好，合成速度快，适合低配置设备。
 *
 * 启动命令：
 *   pip install piper-tts
 *   piper-tts --model en_US-lessac-medium --output-raw --port 5000
 *
 * API 参考：https://github.com/OHF-Voice/piper-tts
 */

import type { ProviderType, TTSOptions, TTSProvider, TTSProviderConfig, TTSResult } from '../types';
import { DEFAULT_ENDPOINTS } from '../defaults';
import { createLogger } from '../../../utils/logger';

const log = createLogger('PiperTTS');

/** Piper TTS 特有配置 */
export interface PiperTTSConfig extends TTSProviderConfig {
  /** Piper 模型名称，如 'zh_CN-huayan-medium' */
  model?: string;
  /** 语速缩放（<1 更快，>1 更慢），默认 1.0 */
  lengthScale?: number;
  /** 合成超时时间（毫秒） */
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Partial<PiperTTSConfig> = {
  apiBase: DEFAULT_ENDPOINTS.piper,
  model: 'zh_CN-huayan-medium',
  lengthScale: 1.0,
  sampleRate: 16000,
  timeoutMs: 15000,
};

export class PiperTTSProvider implements TTSProvider {
  readonly config: PiperTTSConfig;
  private abortController: AbortController | null = null;
  private synthesizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: PiperTTSConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getName(): string {
    return this.config.name;
  }

  getType(): ProviderType {
    return 'tts';
  }

  supportStream(): boolean {
    // Piper 不支持流式，每次合成完整音频
    return false;
  }

  async validate(): Promise<boolean> {
    let resp: Response;
    try {
      resp = await fetch(`${this.config.apiBase}/health`, {
        signal: AbortSignal.timeout(3000),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new Error(`连接超时（3s）：无法连接到 ${this.config.apiBase}`, { cause: err });
      }
      throw new Error(
        `网络错误：${err instanceof Error ? err.message : String(err)}（${this.config.apiBase}）`,
        { cause: err },
      );
    }
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}：Piper TTS 服务返回错误`);
    }
    return true;
  }

  async getVoices(): Promise<string[]> {
    try {
      const resp = await fetch(`${this.config.apiBase}/voices`);
      if (resp.ok) {
        const data = await resp.json();
        return data.voices ?? [];
      }
    } catch {
      // fallback
    }
    return [this.config.model ?? 'zh_CN-huayan-medium'];
  }

  async synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
    const synthesizeStart = performance.now();
    this.abortController = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? 15000;
    this.synthesizeTimer = setTimeout(() => {
      this.abortController?.abort();
    }, timeoutMs);

    const body = {
      text,
      speaker: options?.voice ?? this.config.model ?? 'zh_CN-huayan-medium',
      length_scale: options?.speed ?? this.config.lengthScale ?? 1.0,
    };

    log.info('Piper TTS 开始合成', {
      model: body.speaker,
      textLen: text.length,
    });

    try {
      const resp = await fetch(`${this.config.apiBase}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'Unknown error');
        throw new Error(`Piper TTS error (${resp.status}): ${errText}`);
      }

      const audio = await resp.arrayBuffer();
      const durationMs = Math.round(performance.now() - synthesizeStart);
      log.info('Piper TTS 合成完成', {
        model: body.speaker,
        audioSize: audio.byteLength,
        durationMs,
      });
      return { audio, sampleRate: this.config.sampleRate ?? 16000 };
    } catch (err) {
      const durationMs = Math.round(performance.now() - synthesizeStart);
      if (err instanceof Error && err.name === 'AbortError') {
        err.message = `Piper TTS timeout (${timeoutMs}ms) or aborted`;
      }
      log.error('Piper TTS 合成异常', {
        model: body.speaker,
        textLen: text.length,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      if (this.synthesizeTimer) {
        clearTimeout(this.synthesizeTimer);
        this.synthesizeTimer = null;
      }
    }
  }

  async *synthesizeStream(
    text: string,
    options?: TTSOptions,
  ): AsyncGenerator<ArrayBuffer, void, unknown> {
    // Piper 不支持流式，降级为完整合成后一次性 yield
    const result = await this.synthesize(text, options);
    yield result.audio;
  }

  abort(): void {
    if (this.synthesizeTimer) {
      clearTimeout(this.synthesizeTimer);
      this.synthesizeTimer = null;
    }
    this.abortController?.abort();
    this.abortController = null;
  }
}
