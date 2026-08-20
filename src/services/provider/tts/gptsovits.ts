/**
 * GPT-SoVITS v2 TTS Provider
 *
 * 调用 GPT-SoVITS v2 FastAPI HTTP 服务（api_v2.py）。
 * 支持声音克隆、流式合成、模型权重热切换。
 *
 * 默认端口 9880，启动命令：
 *   python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
 */

import type { ProviderType, TTSOptions, TTSProvider, TTSProviderConfig, TTSResult } from '../types';
import { DEFAULT_ENDPOINTS } from '../defaults';

/** GPT-SoVITS 特有配置 */
export interface GPTSoVitsConfig extends TTSProviderConfig {
  /** 参考音频路径（服务端路径） */
  refAudioPath?: string;
  /** 参考音频文本 */
  promptText?: string;
  /** 参考音频语言 */
  promptLang?: string;
  /** 文本语言 */
  textLang?: string;
  /** 温度 */
  temperature?: number;
  /** top_k */
  topK?: number;
  /** top_p */
  topP?: number;
  /** 语速倍率 */
  speedFactor?: number;
  /** 采样步数 */
  sampleSteps?: number;
  /** 合成超时时间（毫秒） */
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Partial<GPTSoVitsConfig> = {
  apiBase: DEFAULT_ENDPOINTS.gpt_sovits,
  refAudioPath: 'nahida/slicer_opt_trimmed/trimmed_vo_HSEQ002_11_nahida_12.wav',
  promptText: '我没事。最近我的空余时间不少，能做的事情也不少。',
  promptLang: 'zh',
  textLang: 'zh',
  temperature: 0.6,
  topK: 5,
  topP: 0.9,
  speedFactor: 1.0,
  sampleSteps: 16,
  sampleRate: 32000,
  timeoutMs: 30000,
};

export class GPTSoVitsProvider implements TTSProvider {
  readonly config: GPTSoVitsConfig;
  private abortController: AbortController | null = null;
  private synthesizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: GPTSoVitsConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getName(): string {
    return this.config.name;
  }

  getType(): ProviderType {
    return 'tts';
  }

  supportStream(): boolean {
    return true;
  }

  async validate(): Promise<boolean> {
    let resp: Response;
    try {
      resp = await fetch(`${this.config.apiBase}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new Error(`连接超时（5s）：无法连接到 ${this.config.apiBase}`, { cause: err });
      }
      throw new Error(
        `网络错误：${err instanceof Error ? err.message : String(err)}（${this.config.apiBase}）`,
        { cause: err },
      );
    }
    // GPT-SoVITS API 根路径可能返回 404 或 405，但服务在线即可
    if (resp.status >= 500) {
      throw new Error(`HTTP ${resp.status}：GPT-SoVITS 服务内部错误`);
    }
    return true;
  }

  async getVoices(): Promise<string[]> {
    // GPT-SoVITS 通过参考音频切换声音，不提供内置语音列表
    return ['nahida'];
  }

  /**
   * 合成语音（非流式，返回完整 WAV）
   */
  async synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
    this.abortController = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? 30000;
    this.synthesizeTimer = setTimeout(() => {
      this.abortController?.abort();
    }, timeoutMs);

    const body: Record<string, unknown> = {
      text,
      text_lang: this.config.textLang ?? 'zh',
      ref_audio_path: this.config.refAudioPath,
      prompt_text: this.config.promptText,
      prompt_lang: this.config.promptLang ?? 'zh',
      top_k: this.config.topK,
      top_p: this.config.topP,
      temperature: this.config.temperature,
      speed_factor: options?.speed ?? this.config.speedFactor ?? 1.0,
      streaming_mode: 0, // 非流式，返回完整 WAV
      sample_steps: this.config.sampleSteps,
    };

    try {
      const resp = await fetch(`${this.config.apiBase}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'Unknown error');
        throw new Error(
          `GPT-SoVITS TTS error (${resp.status}): ${errText}\nRequest: ref=${this.config.refAudioPath} text_len=${text.length}`,
        );
      }

      const audio = await resp.arrayBuffer();
      return { audio, sampleRate: this.config.sampleRate ?? 32000 };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        err.message = `GPT-SoVITS TTS timeout (${timeoutMs}ms) or aborted`;
      }
      throw err;
    } finally {
      if (this.synthesizeTimer) {
        clearTimeout(this.synthesizeTimer);
        this.synthesizeTimer = null;
      }
    }
  }

  /**
   * 流式合成，yield 音频 chunk
   * GPT-SoVITS streaming_mode=1 返回分句 WAV chunk
   */
  async *synthesizeStream(
    text: string,
    options?: TTSOptions,
  ): AsyncGenerator<ArrayBuffer, void, unknown> {
    this.abortController = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? 30000;
    this.synthesizeTimer = setTimeout(() => {
      this.abortController?.abort();
    }, timeoutMs);

    const body: Record<string, unknown> = {
      text,
      text_lang: this.config.textLang ?? 'zh',
      ref_audio_path: this.config.refAudioPath,
      prompt_text: this.config.promptText,
      prompt_lang: this.config.promptLang ?? 'zh',
      top_k: this.config.topK,
      top_p: this.config.topP,
      temperature: this.config.temperature,
      speed_factor: options?.speed ?? this.config.speedFactor ?? 1.0,
      streaming_mode: 1, // SSE 流式
      sample_steps: this.config.sampleSteps,
    };

    try {
      const resp = await fetch(`${this.config.apiBase}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'Unknown error');
        throw new Error(`GPT-SoVITS TTS stream error (${resp.status}): ${errText}`);
      }

      // 读取流式 response body
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('GPT-SoVITS: no response body');

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) {
            yield value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        err.message = `GPT-SoVITS TTS stream timeout (${timeoutMs}ms) or aborted`;
      }
      throw err;
    } finally {
      if (this.synthesizeTimer) {
        clearTimeout(this.synthesizeTimer);
        this.synthesizeTimer = null;
      }
    }
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
