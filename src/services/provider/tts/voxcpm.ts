/**
 * VoxCPM2 TTS Provider
 *
 * 调用 VoxCPM2 的 vLLM OpenAI-compatible API 或 Gradio API。
 * 音质最佳（⭐⭐⭐⭐），RTF 1.4x，适合离线高质量场景。
 *
 * vLLM 模式（推荐）：
 *   vllm serve openbmb/VoxCPM2 --omni --port 8000
 *   POST /v1/audio/speech
 *
 * Gradio 模式：
 *   python app.py --port 8808
 *   Gradio API /generate
 */

import type { ProviderType, TTSOptions, TTSProvider, TTSProviderConfig, TTSResult } from '../types';
import { DEFAULT_ENDPOINTS } from '../defaults';

/** VoxCPM 特有配置 */
export interface VoxCPMConfig extends TTSProviderConfig {
  /** 连接模式：'vllm' (OpenAI 兼容) 或 'gradio' */
  mode?: 'vllm' | 'gradio';
  /** 参考音频路径（gradio 模式用） */
  referenceWav?: string;
  /** 声音描述（design 模式用） */
  controlInstruction?: string;
  /** CFG 引导强度 */
  cfgValue?: number;
  /** LocDiT 推理步数 */
  ditSteps?: number;
  /** 合成超时时间（毫秒） */
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Partial<VoxCPMConfig> = {
  apiBase: DEFAULT_ENDPOINTS.voxcpm,
  mode: 'vllm',
  sampleRate: 48000,
  cfgValue: 2.0,
  ditSteps: 10,
  controlInstruction: 'young woman, gentle and sweet voice',
  timeoutMs: 30000,
};

export class VoxCPMProvider implements TTSProvider {
  readonly config: VoxCPMConfig;
  private abortController: AbortController | null = null;
  private synthesizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: VoxCPMConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getName(): string {
    return this.config.name;
  }

  getType(): ProviderType {
    return 'tts';
  }

  supportStream(): boolean {
    // VoxCPM vLLM 模式暂不支持流式，Gradio 也不支持
    return false;
  }

  async validate(): Promise<boolean> {
    const endpoint = this.config.mode === 'vllm' ? '/v1/models' : '/info';
    let resp: Response;
    try {
      resp = await fetch(`${this.config.apiBase}${endpoint}`, {
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new Error(`连接超时（5s）：无法连接到 ${this.config.apiBase}${endpoint}`, {
          cause: err,
        });
      }
      throw new Error(
        `网络错误：${err instanceof Error ? err.message : String(err)}（${this.config.apiBase}${endpoint}）`,
        { cause: err },
      );
    }
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}：VoxCPM 服务返回错误（${this.config.mode} 模式）`);
    }
    return true;
  }

  async getVoices(): Promise<string[]> {
    return ['nahida'];
  }

  async synthesize(text: string, _options?: TTSOptions): Promise<TTSResult> {
    this.abortController = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? 30000;
    this.synthesizeTimer = setTimeout(() => {
      this.abortController?.abort();
    }, timeoutMs);

    try {
      if (this.config.mode === 'vllm') {
        return await this.synthesizeVLLM(text);
      }
      return await this.synthesizeGradio(text);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        err.message = `VoxCPM TTS timeout (${timeoutMs}ms) or aborted`;
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
   * vLLM OpenAI-compatible API
   */
  private async synthesizeVLLM(text: string): Promise<TTSResult> {
    const body = {
      model: 'openbmb/VoxCPM2',
      input: text,
      voice: this.config.voice ?? 'default',
    };

    const resp = await fetch(`${this.config.apiBase}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.abortController!.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'Unknown error');
      throw new Error(
        `VoxCPM vLLM error (${resp.status}): ${errText}\nRequest: model=${body.model} text_len=${text.length} voice=${body.voice}`,
      );
    }

    const audio = await resp.arrayBuffer();
    return { audio, sampleRate: this.config.sampleRate ?? 48000 };
  }

  /**
   * Gradio API
   */
  private async synthesizeGradio(text: string): Promise<TTSResult> {
    // Gradio API: POST /api/generate with JSON payload
    const body = {
      data: [
        text,
        this.config.controlInstruction ?? '',
        this.config.referenceWav ? { path: this.config.referenceWav } : null,
        false, // show_prompt_text
        '', // prompt_text
        this.config.cfgValue ?? 2.0,
        true, // do_normalize
        false, // denoise
        this.config.ditSteps ?? 10,
      ],
    };

    const resp = await fetch(`${this.config.apiBase}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.abortController!.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'Unknown error');
      throw new Error(`VoxCPM Gradio error (${resp.status}): ${errText}`);
    }

    const result = await resp.json();
    // Gradio 返回 { data: [{ path: "...", url: "..." }] } 或类似结构
    const audioData = result?.data?.[0];
    if (audioData?.url) {
      const audioResp = await fetch(audioData.url);
      const audio = await audioResp.arrayBuffer();
      return { audio, sampleRate: this.config.sampleRate ?? 48000 };
    }

    throw new Error('VoxCPM Gradio: unexpected response format');
  }

  async *synthesizeStream(
    _text: string,
    _options?: TTSOptions,
  ): AsyncGenerator<ArrayBuffer, void, unknown> {
    // VoxCPM 不支持流式，降级为完整合成后一次性 yield
    const result = await this.synthesize(_text, _options);
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
