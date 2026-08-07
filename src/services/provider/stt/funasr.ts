/**
 * FunASR Paraformer STT Provider
 *
 * 调用 STT 服务器（server/stt_server.py）的 FunASR 引擎。
 * Paraformer 模型，CPU 模式，流式 ASR + VAD + 标点恢复。
 *
 * 默认端口 8002，启动命令：
 *   python server/stt_server.py --port 8002
 */

import type { ProviderType, STTProvider, STTProviderConfig, STTResult } from '../types';
import { DEFAULT_ENDPOINTS } from '../defaults';

export interface FunASRConfig extends STTProviderConfig {
  /** 服务地址 */
  apiBase: string;
}

const DEFAULT_CONFIG: Partial<FunASRConfig> = {
  apiBase: DEFAULT_ENDPOINTS.funasr,
  language: 'zh',
};

export class FunASRProvider implements STTProvider {
  readonly config: FunASRConfig;
  private abortController: AbortController | null = null;

  constructor(config: FunASRConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getName(): string {
    return this.config.name;
  }

  getType(): ProviderType {
    return 'stt';
  }

  supportStreaming(): boolean {
    // HTTP API 模式暂不支持流式，预留接口
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
      throw new Error(`HTTP ${resp.status}：FunASR 服务返回错误`);
    }
    return true;
  }

  async transcribe(audio: ArrayBuffer, format?: string): Promise<STTResult> {
    this.abortController = new AbortController();

    const blob = new Blob([audio], { type: format ?? 'audio/wav' });
    const formData = new FormData();
    formData.append('audio', blob, 'recording.wav');
    formData.append('engine', 'funasr');

    const resp = await fetch(`${this.config.apiBase}/transcribe`, {
      method: 'POST',
      body: formData,
      signal: this.abortController.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'Unknown error');
      throw new Error(`FunASR error (${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    return {
      text: data.text ?? '',
      confidence: data.confidence,
    };
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}
