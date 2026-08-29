/**
 * CosyVoice V3 TTS Provider（纳西妲微调）
 *
 * 调用 CosyVoice V3 FastAPI HTTP 服务（server/cosyvoice_server.py）。
 * 复用参考项目 F:\Work\Create\TTS 的完整代码 + 权重，是当前主力离线引擎。
 *
 * 默认端口 8003，启动命令：
 *   python server/cosyvoice_server.py --port 8003
 */

import type { ProviderType, TTSOptions, TTSProvider, TTSProviderConfig, TTSResult } from '../types';
import { DEFAULT_ENDPOINTS } from '../defaults';

/** CosyVoice V3 特有配置 */
export interface CosyVoiceConfig extends TTSProviderConfig {
  /** 参考音频文本（用于零样本声音克隆对齐） */
  promptText?: string;
  /** 语速倍率 */
  speed?: number;
  /** 输出采样率（服务端固定 24kHz） */
  sampleRate?: number;
  /** 合成超时时间（毫秒，模型较大首词较慢） */
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Partial<CosyVoiceConfig> = {
  apiBase: DEFAULT_ENDPOINTS.cosyvoice,
  promptText: '我没事。最近我的空余时间有不少，又听说奥摩斯港很热闹，就过来到处走走看看。',
  speed: 1.0,
  sampleRate: 24000,
  timeoutMs: 120000,
};

export class CosyVoiceProvider implements TTSProvider {
  readonly config: CosyVoiceConfig;
  private abortController: AbortController | null = null;
  private synthesizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: CosyVoiceConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getName(): string {
    return this.config.name;
  }

  getType(): ProviderType {
    return 'tts';
  }

  supportStream(): boolean {
    // 服务端 /tts/stream 为真流式（边合成边返回）；若服务端较旧无此端点，
    // 调用方会捕获失败并回退到整段合成。
    return true;
  }

  async validate(): Promise<boolean> {
    const resp = await this.fetchHealth();
    if (resp.status >= 500) {
      throw new Error(`HTTP ${resp.status}：CosyVoice 服务内部错误`);
    }
    return true;
  }

  /**
   * 运行时健康探针（区别于 validate 的"连通性测试"）：
   * CosyVoice 服务进程启动后，模型仍在后台加载（首词较慢，约 10~20s），
   * 期间 /health 立即返回 200 但 model_loaded=false。
   * 此探针要求模型真正就绪（model_loaded 且权重存在且无加载错误），
   * 用于"自动拉起后端后等待就绪"的精确判断，避免提前放行导致首句卡顿。
   */
  async isAvailable(): Promise<boolean> {
    let resp: Response;
    try {
      resp = await this.fetchHealth();
    } catch {
      return false;
    }
    if (!resp.ok) return false;
    try {
      const data = (await resp.json()) as {
        model_loaded?: boolean;
        model_exists?: boolean;
        load_error?: string | null;
      };
      return Boolean(data.model_loaded) && Boolean(data.model_exists) && !data.load_error;
    } catch {
      return false;
    }
  }

  private async fetchHealth(): Promise<Response> {
    try {
      return await fetch(`${this.config.apiBase}/health`, {
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
  }

  async getVoices(): Promise<string[]> {
    return ['cosyvoice_v3_nahida'];
  }

  /**
   * 合成语音（非流式，返回完整 WAV）
   */
  async synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
    this.abortController = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? 120000;
    this.synthesizeTimer = setTimeout(() => {
      this.abortController?.abort();
    }, timeoutMs);

    const body: Record<string, unknown> = {
      text,
      prompt_text: this.config.promptText,
      speed: options?.speed ?? this.config.speed ?? 1.0,
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
          `CosyVoice TTS error (${resp.status}): ${errText}\nRequest: text_len=${text.length}`,
        );
      }

      const audio = await resp.arrayBuffer();
      // 服务端返回 X-Sample-Rate 头，确保前端用正确采样率解码播放
      const srHeader = resp.headers.get('X-Sample-Rate');
      const sampleRate = srHeader ? parseInt(srHeader, 10) : (this.config.sampleRate ?? 24000);
      return { audio, sampleRate };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        err.message = `CosyVoice TTS timeout (${timeoutMs}ms) or aborted`;
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
   * 流式合成：调用服务端 /tts/stream，边合成边 yield WAV 分块。
   *
   * 传输格式为长度前缀：[4 字节 big-endian 长度][WAV 字节]，
   * 长度为 0 时其后为 JSON 错误串 —— 此时抛错，由调用方回退到整段合成。
   * 注意：底层 chunk 边界不保证与消息边界一致，必须自己按长度前缀缓冲重组。
   */
  async *synthesizeStream(
    text: string,
    options?: TTSOptions,
  ): AsyncGenerator<ArrayBuffer, void, unknown> {
    const timeoutMs = this.config.timeoutMs ?? 120000;
    const controller = new AbortController();
    this.abortController = controller;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const body: Record<string, unknown> = {
      text,
      prompt_text: this.config.promptText,
      speed: options?.speed ?? this.config.speed ?? 1.0,
    };

    try {
      const resp = await fetch(`${this.config.apiBase}/tts/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => 'Unknown error');
        throw new Error(`CosyVoice TTS stream error (${resp.status}): ${errText}`);
      }

      const reader = resp.body.getReader();
      let pending = new Uint8Array(0);

      /** 从缓冲区尝试取出一个完整消息（长度前缀 + 负载） */
      const takeMessage = (): { payload: Uint8Array } | 'need-more' | null => {
        if (pending.length < 4) return 'need-more';
        const len = new DataView(pending.buffer, pending.byteOffset, 4).getUint32(0, false);
        if (pending.length < 4 + len) return 'need-more';
        return { payload: pending.subarray(4, 4 + len) };
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

        // 追加到待处理缓冲
        const merged = new Uint8Array(pending.length + value.length);
        merged.set(pending, 0);
        merged.set(value, pending.length);
        pending = merged;

        // 尽可能多地取出完整消息
        for (;;) {
          const msg = takeMessage();
          if (msg === 'need-more') break;
          if (msg === null) break;
          const { payload } = msg;
          const consumed = 4 + payload.length;
          pending = pending.subarray(consumed);

          if (payload.length === 0) continue; // 长度为 0 在本协议中不携带数据
          // 复制一份独立内存，避免复用底层 buffer 时数据被后续 chunk 覆盖
          const out = new Uint8Array(payload.length);
          out.set(payload);
          yield out.buffer;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        err.message = `CosyVoice TTS stream timeout (${timeoutMs}ms) or aborted`;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      this.abortController = null;
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
