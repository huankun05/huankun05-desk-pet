/**
 * StreamingSTTClient — 流式语音识别 WebSocket 客户端
 *
 * 与 server/stt_server.py 的 /ws/transcribe 配合：连接后持续把麦克风 PCM
 * （Float32 → Int16）推给服务端，服务端边识别边回传 partial；结束后返回 final。
 *
 * 失败语义：若 WS 连接/识别失败，调用方应回退到 transcribeViaBrain（整段识别）。
 * 本客户端不假定具体业务用途——partial 仅做透传，final 由 end() 返回。
 */

import { createLogger } from '../../utils/logger';

const log = createLogger('StreamingSTT');

export interface StreamingSTTResult {
  text: string;
  emotion?: 'happy' | 'sad' | 'angry' | 'neutral';
}

type PartialCb = (text: string) => void;
type ErrorCb = (err: Error) => void;

/** 由 HTTP apiBase 推导 WebSocket 地址（http→ws，https→wss） */
function wsUrlFromApiBase(apiBase: string): string {
  const base = apiBase
    .replace(/^https:\/\//i, 'wss://')
    .replace(/^http:\/\//i, 'ws://')
    .replace(/\/+$/, '');
  return `${base}/ws/transcribe`;
}

export class StreamingSTTClient {
  private ws: WebSocket | null = null;
  private readonly apiBase: string;
  private readonly engine: string;
  private partialCb: PartialCb | null = null;
  private errorCb: ErrorCb | null = null;
  /** 连接建立前的待发帧缓冲（避免漏掉录音开头的音频） */
  private pending: Int16Array[] = [];
  private opened = false;
  private endResolve: ((r: StreamingSTTResult | null) => void) | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(apiBase: string, engine: string = 'funasr') {
    this.apiBase = apiBase;
    this.engine = engine;
  }

  onPartial(cb: PartialCb): void {
    this.partialCb = cb;
  }

  onError(cb: ErrorCb): void {
    this.errorCb = cb;
  }

  /** 建立连接并发送初始化；连接失败/超时则 reject（调用方回退整段识别） */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const url = wsUrlFromApiBase(this.apiBase);
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      this.ws = ws;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          reject(new Error('WS 连接超时'));
        }
      }, 5000);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.opened = true;
        try {
          ws.send(JSON.stringify({ engine: this.engine }));
        } catch (e) {
          this.errorCb?.(e instanceof Error ? e : new Error(String(e)));
        }
        // 冲刷连接前缓冲的帧（录音开头的若干音频帧）
        for (const frame of this.pending) this.rawSend(frame);
        this.pending = [];
        resolve();
      };

      ws.onmessage = (ev) => this.handleMessage(ev);
      ws.onerror = () => {
        log.warn('WS error event');
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('WS 连接错误'));
        }
        this.errorCb?.(new Error('WS 连接错误'));
      };
      ws.onclose = () => {
        this.opened = false;
      };
    });
  }

  private handleMessage(ev: MessageEvent): void {
    if (typeof ev.data !== 'string') return;
    let msg: { type?: string; text?: string; emotion?: string };
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'partial' && typeof msg.text === 'string') {
      this.partialCb?.(msg.text);
    } else if (msg.type === 'final') {
      if (this.endTimer) {
        clearTimeout(this.endTimer);
        this.endTimer = null;
      }
      const resolve = this.endResolve;
      this.endResolve = null;
      resolve?.({ text: msg.text ?? '', emotion: msg.emotion as StreamingSTTResult['emotion'] });
    }
  }

  /** Float32(-1..1) → Int16 PCM */
  private floatToPcm(samples: Float32Array): Int16Array {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  private rawSend(frame: Int16Array): void {
    if (this.ws && this.opened && this.ws.readyState === WebSocket.OPEN) {
      // 发送底层的 ArrayBuffer（Int16 数据），服务端按 int16 little-endian 解析
      this.ws.send(frame.buffer);
    }
  }

  /** 推入一帧 16k mono Float32 PCM */
  pushFloat32(samples: Float32Array): void {
    const pcm = this.floatToPcm(samples);
    if (!this.opened || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // 连接尚未建立：缓存（上限保护，避免无限增长占用内存）
      if (this.pending.length < 200) this.pending.push(pcm);
      return;
    }
    this.rawSend(pcm);
  }

  /** 结束流式识别，返回最终结果；超时（默认 8s）则返回 null（调用方回退整段识别） */
  end(timeoutMs = 8000): Promise<StreamingSTTResult | null> {
    return new Promise((resolve) => {
      if (!this.ws || !this.opened) {
        resolve(null);
        return;
      }
      this.endResolve = resolve;
      this.endTimer = setTimeout(() => {
        this.endResolve = null;
        this.endTimer = null;
        log.warn('WS end() 超时，回退整段识别');
        resolve(null);
      }, timeoutMs);
      try {
        this.ws.send(JSON.stringify({ action: 'end' }));
      } catch {
        if (this.endTimer) {
          clearTimeout(this.endTimer);
          this.endTimer = null;
        }
        this.endResolve = null;
        resolve(null);
      }
    });
  }

  dispose(): void {
    if (this.endTimer) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    this.endResolve = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.pending = [];
    this.opened = false;
  }
}
