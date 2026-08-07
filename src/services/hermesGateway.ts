/**
 * Hermes Gateway — WebSocket 实时对话网关客户端
 *
 * 连接到 Python 后端的 Hermes Gateway（port 8765），
 * 提供流式对话能力作为前端 pipeline 的替代引擎。
 *
 * 核心功能：
 * - WebSocket 自动重连（指数退避）
 * - 消息队列（断线时积压，重连后自动发送）
 * - 流式 token 回调
 * - 会话历史获取
 */

import { createLogger } from '../utils/logger';
import { eventBus } from './eventBus';

const log = createLogger('HermesGateway');

const GATEWAY_URL = 'ws://127.0.0.1:8765/ws';
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export interface HermesGatewayCallbacks {
  mode?: 'work' | 'chat';
  onToken?: (token: string) => void;
  onDone?: (fullResponse: string) => void;
  onError?: (error: string) => void;
}

class HermesGatewayClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private messageQueue: string[] = [];
  private pendingCallbacks: Map<string, HermesGatewayCallbacks> = new Map();
  private messageIdCounter = 0;
  private destroyed = false;

  /** 是否已连接 */
  get isConnected(): boolean {
    return this.connected;
  }

  /** 连接 WebSocket */
  connect(): void {
    if (this.destroyed) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    )
      return;

    this.reconnectAttempt++;
    log.info('Connecting to Hermes Gateway...', { attempt: this.reconnectAttempt });

    try {
      this.ws = new WebSocket(GATEWAY_URL);
    } catch (err) {
      log.warn('Failed to create WebSocket', { err: String(err) });
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempt = 0;
      log.info('Hermes Gateway connected');

      // 发送积压消息
      const queue = this.messageQueue.splice(0);
      for (const msg of queue) {
        this.ws?.send(msg);
      }

      eventBus.emit('hermes:connected', {});
    };

    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        this.handleMessage(data);
      } catch {
        log.warn('Invalid message from gateway', { raw: ev.data.slice(0, 100) });
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      log.info('Hermes Gateway disconnected');
      eventBus.emit('hermes:disconnected', {});
      if (!this.destroyed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose 会跟随 onerror 触发，所以这里只记日志
      log.warn('Hermes Gateway WebSocket error');
    };
  }

  /** 断开连接 */
  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.messageQueue = [];
    this.pendingCallbacks.clear();
  }

  /** 发送聊天消息 */
  sendChat(text: string, callbacks?: HermesGatewayCallbacks, mode?: 'work' | 'chat'): string {
    const msgId = `msg_${++this.messageIdCounter}_${Date.now()}`;
    const payload: Record<string, unknown> = { type: 'chat', text, id: msgId };
    if (mode) payload.mode = mode;

    if (callbacks) {
      this.pendingCallbacks.set(msgId, callbacks);
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else {
      this.messageQueue.push(JSON.stringify(payload));
      this.connect();
    }

    return msgId;
  }

  /** 测量延迟（毫秒） */
  measureLatency(): Promise<number> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        resolve(-1);
        return;
      }
      const t0 = performance.now();
      const timer = setTimeout(() => resolve(-1), 5000);
      const handler = (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === 'pong') {
            clearTimeout(timer);
            resolve(Math.round(performance.now() - t0));
          }
        } catch {
          /* ignore */
        }
      };
      this.ws.addEventListener('message', handler, { once: true });
      this.ws.send(JSON.stringify({ type: 'ping' }));
    });
  }

  /** 请求可用模型列表 */
  fetchModels(): void {
    const payload = JSON.stringify({ type: 'list_models' });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      this.messageQueue.push(payload);
      this.connect();
    }
  }

  /** 请求账号用量/余额 */
  fetchUsage(): void {
    const payload = JSON.stringify({ type: 'account_usage' });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      this.messageQueue.push(payload);
      this.connect();
    }
  }

  /** 发送 ping */
  ping(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ping' }));
    }
  }

  /** 获取历史 */
  fetchHistory(limit = 50): void {
    const payload = JSON.stringify({ type: 'history', limit });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      this.messageQueue.push(payload);
      this.connect();
    }
  }

  // ===== 内部 =====

  private handleMessage(data: Record<string, unknown>): void {
    const msgType = data.type as string;

    if (msgType === 'pong') return;

    if (msgType === 'token') {
      const token = data.token as string;
      const msgId = (data.id as string) || '';
      const cb = this.pendingCallbacks.get(msgId);
      cb?.onToken?.(token);
      // 也通过事件总线广播
      eventBus.emit('hermes:token', { token, msgId });
      return;
    }

    if (msgType === 'done') {
      const fullResponse = data.full_response as string;
      // 查找最近的 pending callback
      // 由于 done 可能没有 id 匹配，我们通知所有活跃 callback
      for (const [, cb] of this.pendingCallbacks) {
        cb?.onDone?.(fullResponse);
      }
      this.pendingCallbacks.clear();
      eventBus.emit('hermes:done', { fullResponse });
      return;
    }

    if (msgType === 'history') {
      const messages = data.messages as Array<Record<string, unknown>>;
      const sessionId = data.session_id as string;
      eventBus.emit('hermes:history', { sessionId, messages });
      return;
    }

    if (msgType === 'error') {
      const message = data.message as string;
      // 通知所有 callback
      for (const [, cb] of this.pendingCallbacks) {
        cb?.onError?.(message);
      }
      this.pendingCallbacks.clear();
      eventBus.emit('hermes:error', { message });
      return;
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectTimer) return;

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt - 1),
      RECONNECT_MAX_MS,
    );

    log.info('Scheduling reconnect', { attempt: this.reconnectAttempt, delayMs: delay });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

/** 全局单例 */
let _client: HermesGatewayClient | null = null;

export function getHermesGatewayClient(): HermesGatewayClient {
  if (!_client) {
    _client = new HermesGatewayClient();
  }
  return _client;
}

export function destroyHermesGatewayClient(): void {
  _client?.disconnect();
  _client = null;
}
