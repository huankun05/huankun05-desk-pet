/**
 * 自定义 / 其他 TTS Provider（通用 HTTP）
 *
 * 适用于任何暴露简单 HTTP 接口的本地/远程 TTS 服务，例如：
 *  - 用户自己部署的 fish-speech / ChatTTS / Bert-VITS2 / GPT-SoVITS API / CosyVoice 等；
 *  - 一个已在运行的第三方 TTS 服务（只需填网址）。
 *
 * 兼容性策略（尽力而为，覆盖最常见的两种形态）：
 *  合成  POST {apiBase}/tts  body={text, voice?, speed?}
 *    - 返回 audio/wav 或 audio/*  → 直接作为 WAV 音频；
 *    - 返回 application/json      → 解析 {audio|wav|data: base64, sample_rate|sr}。
 *  健康检查 GET {apiBase}/health 或 {apiBase}/ 返回 2xx 即视为可用。
 */

import type { ProviderType, TTSOptions, TTSProvider, TTSProviderConfig, TTSResult } from '../types';

export interface CustomTTSConfig extends TTSProviderConfig {
  /** 语速倍率 */
  speed?: number;
  /** 输出采样率（未知时回退 24000） */
  sampleRate?: number;
  /** 合成超时（毫秒） */
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Partial<CustomTTSConfig> = {
  speed: 1.0,
  sampleRate: 24000,
  timeoutMs: 120000,
};

export class CustomTTSProvider implements TTSProvider {
  readonly config: CustomTTSConfig;
  private abortController: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: CustomTTSConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getName(): string {
    return this.config.name;
  }

  getType(): ProviderType {
    return 'tts';
  }

  supportStream(): boolean {
    return false;
  }

  async validate(): Promise<boolean> {
    const base = this.config.apiBase?.replace(/\/+$/, '');
    if (!base) throw new Error('未填写 API 地址');
    let resp: Response;
    try {
      resp = await fetch(`${base}/health`, { method: 'GET', signal: AbortSignal.timeout(5000) });
    } catch {
      // 很多服务没有 /health，退而求其次探根路径
      try {
        resp = await fetch(`${base}/`, { method: 'GET', signal: AbortSignal.timeout(5000) });
      } catch (err) {
        throw new Error(
          `无法连接到 ${base}：${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }
    if (resp.status >= 500) {
      throw new Error(`HTTP ${resp.status}：TTS 服务内部错误`);
    }
    return true;
  }

  async getVoices(): Promise<string[]> {
    return [this.config.voice || 'default'];
  }

  async synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
    const base = this.config.apiBase?.replace(/\/+$/, '');
    if (!base) throw new Error('未填写 API 地址');

    this.abortController = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? 120000;
    this.timer = setTimeout(() => this.abortController?.abort(), timeoutMs);

    const body: Record<string, unknown> = {
      text,
      speed: options?.speed ?? this.config.speed ?? 1.0,
    };
    if (this.config.voice || options?.voice) {
      body.voice = options?.voice ?? this.config.voice;
    }

    try {
      const resp = await fetch(`${base}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'Unknown error');
        throw new Error(`自定义 TTS 错误 (${resp.status}): ${errText}`);
      }

      const contentType = resp.headers.get('Content-Type') || '';
      const srHeader = resp.headers.get('X-Sample-Rate');
      const sampleRate = srHeader
        ? parseInt(srHeader, 10)
        : (this.config.sampleRate ?? 24000);

      // 音频直接返回
      if (contentType.includes('audio/') || contentType.includes('application/octet-stream')) {
        const audio = await resp.arrayBuffer();
        return { audio, sampleRate };
      }

      // JSON 包了一层音频
      if (contentType.includes('application/json')) {
        const json = (await resp.json()) as Record<string, unknown>;
        const b64 =
          (json.audio as string) ||
          (json.wav as string) ||
          (json.data as string) ||
          '';
        if (!b64) throw new Error('自定义 TTS 返回的 JSON 中找不到 audio/wav/data 字段');
        const clean = b64.includes(',') ? b64.split(',')[1] : b64;
        const audio = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0)).buffer;
        const sr = (json.sample_rate as number) || (json.sr as number) || sampleRate;
        return { audio, sampleRate: sr };
      }

      // 兜底：当作原始音频
      const audio = await resp.arrayBuffer();
      return { audio, sampleRate };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        err.message = `自定义 TTS 超时（${timeoutMs}ms）或已取消`;
      }
      throw err;
    } finally {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    }
  }

  async *synthesizeStream(
    text: string,
    options?: TTSOptions,
  ): AsyncGenerator<ArrayBuffer, void, unknown> {
    const result = await this.synthesize(text, options);
    yield result.audio;
  }

  abort(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.abortController?.abort();
    this.abortController = null;
  }
}
