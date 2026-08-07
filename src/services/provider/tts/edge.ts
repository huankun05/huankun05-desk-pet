/**
 * Edge TTS Provider
 *
 * 调用 Edge TTS HTTP 服务（desk-pet/server/edge_tts_server.py）。
 * 微软在线 TTS，免费零部署，多种中文语音可选。
 *
 * 默认端口 8001，启动命令：
 *   python server/edge_tts_server.py --port 8001
 */

import type { ProviderType, TTSOptions, TTSProvider, TTSProviderConfig, TTSResult } from '../types';
import { DEFAULT_ENDPOINTS } from '../defaults';
import { createLogger } from '../../../utils/logger';

const log = createLogger('EdgeTTS');

/** Edge TTS 特有配置 */
export interface EdgeTTSConfig extends TTSProviderConfig {
  /** 语速调整，如 '+15%' / '-10%' */
  rate?: string;
  /** 音调调整，如 '+5Hz' / '-2Hz' */
  pitch?: string;
  /** 音量调整，如 '+10%' */
  volume?: string;
  /** 合成超时时间（毫秒） */
  timeoutMs?: number;
}

/** 预置中文女声列表 */
const EDGE_VOICES = [
  'zh-CN-XiaoyiNeural',
  'zh-CN-XiaoxiaoNeural',
  'zh-CN-XiaochenNeural',
  'zh-CN-XiaohanNeural',
  'zh-CN-XiaomengNeural',
  'zh-CN-XiaomoNeural',
  'zh-CN-XiaoqiuNeural',
  'zh-CN-XiaoruiNeural',
];

/** 情绪 → rate/pitch/volume 映射（借鉴 NahidaVoiceAI tts_edge.py） */
const EMOTION_PARAMS: Record<string, { rate: string; pitch: string; volume: string }> = {
  happy: { rate: '+15%', pitch: '+5Hz', volume: '+10%' },
  sad: { rate: '-10%', pitch: '-3Hz', volume: '-5%' },
  angry: { rate: '+10%', pitch: '+3Hz', volume: '+15%' },
  shy: { rate: '-5%', pitch: '+2Hz', volume: '-10%' },
  neutral: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
};

const DEFAULT_CONFIG: Partial<EdgeTTSConfig> = {
  apiBase: DEFAULT_ENDPOINTS.edge_tts,
  voice: 'zh-CN-XiaoyiNeural',
  rate: '+0%',
  pitch: '+0Hz',
  volume: '+0%',
  sampleRate: 24000,
  timeoutMs: 15000,
};

export class EdgeTTSProvider implements TTSProvider {
  readonly config: EdgeTTSConfig;
  private abortController: AbortController | null = null;
  private synthesizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: EdgeTTSConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getName(): string {
    return this.config.name;
  }

  getType(): ProviderType {
    return 'tts';
  }

  supportStream(): boolean {
    // Edge TTS 服务端是先生成完整音频再返回
    return false;
  }

  async validate(): Promise<boolean> {
    let resp: Response;
    try {
      resp = await fetch(`${this.config.apiBase}/voices`, {
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
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}：Edge TTS 服务返回错误`);
    }
    return true;
  }

  async getVoices(): Promise<string[]> {
    try {
      const resp = await fetch(`${this.config.apiBase}/voices`);
      if (resp.ok) {
        const data = await resp.json();
        return data.voices ?? EDGE_VOICES;
      }
    } catch {
      // fallback
    }
    return EDGE_VOICES;
  }

  async synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
    const synthesizeStart = performance.now();
    this.abortController = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? 15000;
    this.synthesizeTimer = setTimeout(() => {
      this.abortController?.abort();
    }, timeoutMs);

    // 从 emotion 获取参数
    const emotionParams = options?.emotion ? EMOTION_PARAMS[options.emotion] : null;

    const body = {
      text,
      voice: options?.voice ?? this.config.voice ?? 'zh-CN-XiaoyiNeural',
      rate: emotionParams?.rate ?? this.config.rate ?? '+0%',
      pitch: emotionParams?.pitch ?? this.config.pitch ?? '+0Hz',
      volume: emotionParams?.volume ?? this.config.volume ?? '+0%',
    };

    log.info('EdgeTTS 开始合成', {
      voice: body.voice,
      textLen: text.length,
      emotion: options?.emotion || 'neutral',
    });

    try {
      const resp = await fetch(`${this.config.apiBase}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'Unknown error');
        const errMsg = `Edge TTS error (${resp.status}): ${errText}\nRequest: voice=${body.voice} text_len=${text.length}`;
        log.error('EdgeTTS 合成失败', {
          status: resp.status,
          voice: body.voice,
          textLen: text.length,
          errText: errText.slice(0, 200),
        });
        throw new Error(errMsg);
      }

      const audio = await resp.arrayBuffer();
      const durationMs = Math.round(performance.now() - synthesizeStart);
      log.info('EdgeTTS 合成完成', { voice: body.voice, audioSize: audio.byteLength, durationMs });
      return { audio, sampleRate: this.config.sampleRate ?? 24000 };
    } catch (err) {
      const durationMs = Math.round(performance.now() - synthesizeStart);
      if (err instanceof Error && err.name === 'AbortError') {
        err.message = `Edge TTS timeout (${timeoutMs}ms) or aborted`;
      }
      log.error('EdgeTTS 合成异常', {
        voice: body.voice,
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
    // Edge TTS 不支持流式，降级为完整合成后一次性 yield
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
