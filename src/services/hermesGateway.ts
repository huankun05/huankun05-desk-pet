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
import { personaManager } from './persona';

const log = createLogger('HermesGateway');

const GATEWAY_URL = 'ws://127.0.0.1:8765/ws';
/** 由 WS 地址推导的 REST 基址（网关同源同端口，CORS 已放开） */
const GATEWAY_REST_BASE = GATEWAY_URL.replace('ws://', 'http://').replace(/\/ws$/, '');
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export interface HermesGatewayCallbacks {
  mode?: 'auto' | 'work' | 'chat';
  /** 可执行的前端工具 schema，Gateway 可据此发起 tool:execute */
  frontendTools?: Array<Record<string, unknown>>;
  /** 被用户在「工具管理」中禁用的工具名（前端 + 后端），Gateway 会剔除它们 */
  disabledTools?: string[];
  onToken?: (token: string) => void;
  onToolCall?: (call: Record<string, unknown>) => void;
  onToolResult?: (result: Record<string, unknown>) => void;
  onDone?: (fullResponse: string) => void;
  onError?: (error: string) => void;
}

/** 记忆类别（与后端 core.brain 对齐；scene/persona/raw 由管线自动生成） */
export type MemoryCategory =
  'fact' | 'preference' | 'rule' | 'feedback' | 'event' | 'scene' | 'persona' | 'raw';

/** 记忆分层（L0 原始对话 → L1 原子记忆 → L2 场景块 → L3 长期画像） */
export type MemoryLayer = 'L0' | 'L1' | 'L2' | 'L3';

/** 记忆条目（与后端 MemoryFragment.to_api_dict 对齐） */
export interface MemoryItem {
  id: number;
  character_id: string;
  user_id: string;
  content: string;
  category: MemoryCategory;
  source: string;
  enabled: boolean;
  meta: Record<string, unknown>;
  client_ref: string;
  importance: number;
  is_permanent: boolean;
  access_count: number;
  created_at: string;
  updated_at: string;
  /** 分层记忆所属层级（后端 to_api_dict 提供；旧条目可能缺失） */
  layer?: MemoryLayer;
  /** 原子记忆类型：persona / episodic / instruction（用于 L1 去噪与展示） */
  mem_type?: string;
}

export class HermesGatewayClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private messageQueue: string[] = [];
  private pendingCallbacks: Map<string, HermesGatewayCallbacks> = new Map();
  /** 流式回复累积文本（按 msgId 隔离），用于驱动顶部刘海字幕 */
  private streamingText: Map<string, string> = new Map();
  private messageIdCounter = 0;
  /** 记忆请求的 Promise 登记表（按 req_id 解析） */
  private pendingMemory: Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  > = new Map();
  private memoryReqCounter = 0;
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
      log.info('[WS->MSG] raw=%s', ev.data.slice(0, 200));
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
    for (const [, p] of this.pendingMemory) p.reject(new Error('disconnected'));
    this.pendingMemory.clear();
  }

  /** 发送聊天消息 */
  sendChat(
    text: string,
    callbacks?: HermesGatewayCallbacks,
    mode?: 'auto' | 'work' | 'chat',
  ): string {
    const msgId = `msg_${++this.messageIdCounter}_${Date.now()}`;
    const payload: Record<string, unknown> = { type: 'chat', text, id: msgId };
    // 携带当前活跃角色 id，确保对话记忆注入与设置页处于同一作用域（否则规则/偏好不会被注入）
    const pid = personaManager.getActiveProfile()?.id ?? 'default';
    payload.character_id = pid;
    payload.user_id = 'default';
    if (mode) payload.mode = mode;
    if (callbacks?.frontendTools && callbacks.frontendTools.length > 0) {
      payload.frontend_tools = callbacks.frontendTools;
    }
    if (callbacks?.disabledTools && callbacks.disabledTools.length > 0) {
      payload.disabled_tools = callbacks.disabledTools;
    }

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

  /** 取消指定请求的回调，中断时使用 */
  abort(msgId: string): void {
    const cb = this.pendingCallbacks.get(msgId);
    if (cb) {
      cb?.onError?.('aborted');
      this.pendingCallbacks.delete(msgId);
    }
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

  /** 清空 Gateway 服务端的会话上下文（新建对话时调用，确保 AI 从零开始） */
  resetConversation(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'reset' }));
    } else {
      // WS 未就绪则排队，连接成功后发送；失败不影响本地新建会话
      this.messageQueue.push(JSON.stringify({ type: 'reset' }));
      this.connect();
    }
  }

  /** 语音通话：按需拉起/释放本地 STT/TTS 服务（像 QQ 语音通话：用时才启动）。
   *  @param tts 活跃 TTS 的 typeName，让网关按前端激活的引擎拉起（默认 Edge TTS） */
  sendVoice(action: 'start' | 'stop', tts?: { typeName?: string }): void {
    const payload = JSON.stringify({
      type: 'voice',
      action,
      ...(action === 'start' && tts?.typeName ? { tts } : {}),
    });
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

  /** 发送前端工具执行结果回 Gateway */
  sendToolResult(id: string, name: string, content: string, isError = false): void {
    const payload = JSON.stringify({
      type: 'tool:result',
      id,
      name,
      content,
      isError,
    });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      this.messageQueue.push(payload);
      this.connect();
    }
  }

  // ===== 记忆同步（统一收口到 core.brain） =====

  private nextMemoryReqId(): string {
    return `mem_${++this.memoryReqCounter}_${Date.now()}`;
  }

  /** 发送一条记忆类请求并等待带 req_id 的响应；断线时排队，超时 8s 兜底。 */
  private requestMemory(type: string, payload: Record<string, unknown>): Promise<unknown> {
    const reqId = this.nextMemoryReqId();
    return new Promise((resolve, reject) => {
      this.pendingMemory.set(reqId, { resolve, reject });
      const msg = JSON.stringify({ type, req_id: reqId, ...payload });
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(msg);
      } else {
        this.messageQueue.push(msg);
        this.connect();
      }
      setTimeout(() => {
        if (this.pendingMemory.has(reqId)) {
          this.pendingMemory.delete(reqId);
          reject(new Error('memory request timeout'));
        }
      }, 8000);
    });
  }

  /** 拉取当前角色的全部记忆 */
  listMemories(characterId: string, userId = 'default'): Promise<MemoryItem[]> {
    return this.requestMemory('memory:list', { character_id: characterId, user_id: userId }).then(
      (res) => (res as { items?: MemoryItem[] }).items ?? [],
    );
  }

  /** 新增一条记忆（UI 手动添加） */
  addMemory(payload: {
    content: string;
    category: MemoryCategory;
    character_id: string;
    user_id?: string;
    client_ref?: string;
    importance?: number;
    is_permanent?: boolean;
    enabled?: boolean;
    meta?: Record<string, unknown>;
  }): Promise<MemoryItem> {
    return this.requestMemory('memory:add', payload).then((res) => {
      const r = res as { memory?: MemoryItem; ok?: boolean; error?: string };
      if (!r.ok || !r.memory) throw new Error(r.error || 'add memory failed');
      return r.memory;
    });
  }

  /** 更新一条记忆（按 id） */
  updateMemory(
    id: number,
    fields: Partial<
      Pick<
        MemoryItem,
        'content' | 'category' | 'enabled' | 'importance' | 'is_permanent' | 'client_ref' | 'meta'
      >
    >,
  ): Promise<MemoryItem | null> {
    return this.requestMemory('memory:update', { id, ...fields }).then((res) => {
      const r = res as { memory?: MemoryItem; ok?: boolean };
      return r.ok ? (r.memory ?? null) : null;
    });
  }

  /** 删除一条记忆（按 id 或 client_ref） */
  deleteMemory(payload: { id?: number; client_ref?: string }): Promise<boolean> {
    return this.requestMemory('memory:delete', payload).then((res) => {
      const r = res as { ok?: boolean };
      return Boolean(r.ok);
    });
  }

  /** 批量同步（前端全量 upsert，按 client_ref 去重） */
  syncMemories(payload: {
    items: Array<
      Partial<MemoryItem> & { content: string; client_ref: string; category: MemoryCategory }
    >;
    character_id: string;
    user_id?: string;
  }): Promise<number> {
    return this.requestMemory('memory:sync', payload).then((res) => {
      const r = res as { saved?: number };
      return r.saved ?? 0;
    });
  }

  /**
   * 触发后端重新生成 L2 场景块 + L3 长期画像（走 REST，因为生成可能耗时且需 LLM）。
   * 返回最新 persona / scene 内容，用于前端即时预览。
   */
  async regenerateMemory(
    characterId: string,
    userId = 'default',
  ): Promise<{ scene: string | null; persona: string | null; used_llm: boolean }> {
    const res = await fetch(`${GATEWAY_REST_BASE}/api/gateway/memory/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_id: characterId, user_id: userId }),
    });
    if (!res.ok) {
      throw new Error(`regenerate failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      scene?: string | null;
      persona?: string | null;
      used_llm?: boolean;
      ok?: boolean;
      error?: string;
    };
    if (data.ok === false && data.error) {
      throw new Error(data.error);
    }
    return {
      scene: data.scene ?? null,
      persona: data.persona ?? null,
      used_llm: Boolean(data.used_llm),
    };
  }

  // ===== 内部 =====

  private handleMessage(data: Record<string, unknown>): void {
    const msgType = data.type as string;

    if (msgType === 'pong') return;

    if (msgType === 'voice') {
      eventBus.emit('hermes:voice', data);
      return;
    }

    if (msgType === 'token') {
      const token = data.token as string;
      const msgId = (data.id as string) || '';
      const cb = msgId ? this.pendingCallbacks.get(msgId) : undefined;
      cb?.onToken?.(token);
      // 累积全文并驱动顶部刘海字幕（speaking 态）
      if (msgId) {
        const acc = (this.streamingText.get(msgId) || '') + token;
        this.streamingText.set(msgId, acc);
        eventBus.emit('subtitle:update', { phase: 'speaking', text: acc });
      }
      // 也通过事件总线广播
      eventBus.emit('hermes:token', { token, msgId });
      return;
    }

    if (msgType === 'done') {
      const fullResponse = data.full_response as string;
      const msgId = (data.id as string) || '';
      const cb = msgId ? this.pendingCallbacks.get(msgId) : undefined;
      cb?.onDone?.(fullResponse);
      if (msgId) {
        this.pendingCallbacks.delete(msgId);
        this.streamingText.delete(msgId);
      }
      // 兼容旧网关：未携带 id 时回退通知所有活跃 callback
      if (!msgId) {
        for (const [, c] of this.pendingCallbacks) {
          c?.onDone?.(fullResponse);
        }
        this.pendingCallbacks.clear();
        this.streamingText.clear();
      }
      // 顶部刘海字幕：回复结束，淡出隐藏
      eventBus.emit('subtitle:update', { phase: 'idle', text: '' });
      eventBus.emit('hermes:done', { fullResponse, msgId });
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
      const msgId = (data.id as string) || '';
      const cb = msgId ? this.pendingCallbacks.get(msgId) : undefined;
      cb?.onError?.(message);
      if (msgId) this.pendingCallbacks.delete(msgId);
      if (!msgId) {
        for (const [, c] of this.pendingCallbacks) {
          c?.onError?.(message);
        }
        this.pendingCallbacks.clear();
        this.streamingText.clear();
      }
      // 顶部刘海字幕：出错时也淡出隐藏
      eventBus.emit('subtitle:update', { phase: 'idle', text: '' });
      eventBus.emit('hermes:error', { message, msgId });
      return;
    }

    if (msgType === 'tool:call') {
      eventBus.emit('tool:call', {
        name: (data.name as string) || '',
        args: (data.arguments as Record<string, unknown>) || {},
      });
      return;
    }

    if (msgType === 'tool:result') {
      eventBus.emit('tool:result', {
        name: (data.name as string) || '',
        content: (data.content as string) || '',
        isError: data.isError === true,
      });
      return;
    }

    if (msgType === 'tool:execute') {
      this._handleFrontendToolExecute(data as Record<string, unknown>);
      return;
    }

    if (msgType === 'memory:list_result') {
      const reqId = data.req_id as string;
      const p = reqId ? this.pendingMemory.get(reqId) : undefined;
      if (p) {
        this.pendingMemory.delete(reqId);
        p.resolve({ items: (data.items as MemoryItem[]) || [] });
      }
      return;
    }

    if (msgType === 'memory:result') {
      const reqId = data.req_id as string;
      const p = reqId ? this.pendingMemory.get(reqId) : undefined;
      if (p) {
        this.pendingMemory.delete(reqId);
        p.resolve(data);
      }
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

  private _handleFrontendToolExecute(data: Record<string, unknown>): void {
    const id = (data.id as string) || '';
    const name = (data.name as string) || '';
    const args = (data.arguments as Record<string, unknown>) || {};
    if (!name) return;
    eventBus.emit('tool:execute', { id, name, args });
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
