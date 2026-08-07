/**
 * Sherpa ONNX STT Provider
 *
 * 调用 Sherpa ONNX 语音识别服务。
 * 轻量本地 ASR，支持多种模型（SenseVoice、Paraformer、Nemo 等），CPU 友好。
 *
 * 安装：
 *   pip install sherpa-onnx
 *
 * 启动命令：
 *   sherpa-onnx-offline-recognizer --model ./model.onnx --tokens ./tokens.txt --port 6000
 *
 * 或使用 sherpa-onnx Python API 启动 HTTP 服务。
 *
 * API 参考：https://github.com/k2-fsa/sherpa-onnx
 */

import type { ProviderType, STTProvider, STTProviderConfig, STTResult } from '../types';
import { DEFAULT_ENDPOINTS } from '../defaults';
import { createLogger } from '../../../utils/logger';

const log = createLogger('SherpaONNX');

/** Sherpa ONNX 特有配置 */
export interface SherpaONNXConfig extends STTProviderConfig {
  /** ASR 模型类型 */
  modelType?: 'sensevoice' | 'paraformer' | 'nemo';
  /** 识别语言 */
  language?: string;
  /** 合成超时时间（毫秒） */
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Partial<SherpaONNXConfig> = {
  apiBase: DEFAULT_ENDPOINTS.sherpaonnx,
  modelType: 'sensevoice',
  language: 'auto',
  timeoutMs: 10000,
};

export class SherpaONNXProvider implements STTProvider {
  readonly config: SherpaONNXConfig;
  private abortController: AbortController | null = null;

  constructor(config: SherpaONNXConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getName(): string {
    return this.config.name;
  }

  getType(): ProviderType {
    return 'stt';
  }

  supportStreaming(): boolean {
    // Sherpa ONNX 当前通过 HTTP 批量识别，不支持流式
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
      throw new Error(`HTTP ${resp.status}：Sherpa ONNX 服务返回错误`);
    }
    return true;
  }

  /**
   * 语音转文本
   * 发送 WAV 音频到 Sherpa ONNX 服务，返回识别文本
   */
  async transcribe(audio: ArrayBuffer, format?: string): Promise<STTResult> {
    this.abortController = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? 10000;
    const timer = setTimeout(() => {
      this.abortController?.abort();
    }, timeoutMs);

    try {
      const blob = new Blob([audio], { type: format ?? 'audio/wav' });
      const formData = new FormData();
      formData.append('audio', blob, 'audio.wav');
      formData.append('model_type', this.config.modelType ?? 'sensevoice');
      formData.append('language', this.config.language ?? 'auto');

      log.info('Sherpa ONNX 开始识别', {
        modelType: this.config.modelType,
        audioSize: audio.byteLength,
      });

      const resp = await fetch(`${this.config.apiBase}/recognize`, {
        method: 'POST',
        body: formData,
        signal: this.abortController.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'Unknown error');
        throw new Error(`Sherpa ONNX error (${resp.status}): ${errText}`);
      }

      const data = await resp.json();
      const text = data.text ?? data.result ?? '';

      log.info('Sherpa ONNX 识别完成', {
        textLen: text.length,
        preview: text.slice(0, 50),
      });

      return {
        text,
        emotion: data.emotion,
        confidence: data.confidence,
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        log.warn('Sherpa ONNX 识别超时或中断');
      } else {
        log.error('Sherpa ONNX 识别异常', err);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}
