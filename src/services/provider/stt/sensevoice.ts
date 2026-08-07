/**
 * SenseVoice STT Provider
 *
 * 调用 STT 服务器（server/stt_server.py）的 SenseVoice 引擎。
 * FunAudioLLM 出品，识别文本 + 情绪标签（happy/sad/angry/neutral）。
 *
 * 默认端口 8002，启动命令：
 *   python server/stt_server.py --port 8002
 */

import type { ProviderType, STTProvider, STTProviderConfig, STTResult } from '../types';
import { DEFAULT_ENDPOINTS } from '../defaults';

export interface SenseVoiceConfig extends STTProviderConfig {
  apiBase: string;
}

const DEFAULT_CONFIG: Partial<SenseVoiceConfig> = {
  apiBase: DEFAULT_ENDPOINTS.sensevoice,
  language: 'auto',
};

export class SenseVoiceProvider implements STTProvider {
  readonly config: SenseVoiceConfig;
  private abortController: AbortController | null = null;

  constructor(config: SenseVoiceConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getName(): string {
    return this.config.name;
  }

  getType(): ProviderType {
    return 'stt';
  }

  supportStreaming(): boolean {
    return false;
  }

  async validate(): Promise<boolean> {
    let resp: Response;
    try {
      resp = await fetch(`${this.config.apiBase}/health`, {
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
      throw new Error(`HTTP ${resp.status}：SenseVoice 服务返回错误`);
    }
    return true;
  }

  /**
   * 语音转文本 + 情绪检测
   * 返回 STTResult 包含 emotion 字段
   */
  async transcribe(audio: ArrayBuffer, format?: string): Promise<STTResult> {
    this.abortController = new AbortController();

    const blob = new Blob([audio], { type: format ?? 'audio/wav' });
    const formData = new FormData();
    formData.append('audio', blob, 'recording.wav');
    formData.append('engine', 'sensevoice');

    const resp = await fetch(`${this.config.apiBase}/transcribe`, {
      method: 'POST',
      body: formData,
      signal: this.abortController.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'Unknown error');
      throw new Error(`SenseVoice error (${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    return {
      text: data.text ?? '',
      emotion: data.emotion, // 'happy' | 'sad' | 'angry' | 'neutral' | undefined
      confidence: data.confidence,
    };
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}
