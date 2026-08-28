/**
 * EventBus — 轻量级发布/订阅事件总线
 *
 * 用于解耦模块间通信。Phase 1.6 引入，
 * 后续 Phase 4 插件系统可订阅这些事件。
 */

import type { ConsentRequest, ConsentDecision } from './permission/types';

/**
 * 跨窗口（Tauri 全局）事件名常量。
 * eventBus 是内存级的、不跨窗；这些事件通过 @tauri-apps/api/event 的
 * emit/listen 跨 WebView 传播，用于聊天面板窗 ↔ 主窗口 的状态同步。
 */
export const CHAT_EMOTION_EVENT = 'deskpet:chat-emotion';
export const CHAT_ACTIVE_EVENT = 'deskpet:chat-active';
export const RAG_UPDATED_EVENT = 'deskpet:rag-updated';

type EventMap = {
  'message:sent': { text: string; sessionId: string };
  'message:response': { text: string; sessionId: string };
  'emotion:changed': { emotion: string; intensity: number; reason: string };
  'favorability:changed': { delta: number; favorability: number };
  'persona:changed': {
    previousId: string;
    previousName: string;
    nextId: string;
    nextName: string;
    source: string;
  };
  // 感知事件：手势/面部表情识别结果
  'perception:gesture': { gesture: string; confidence: number; handX?: number; handY?: number };
  'perception:face_expr': { expression: string; intensity: number };
  // 感知服务连接丢失（例如达到最大重连次数后放弃）
  'perception:disconnected': { reason: string; attempts: number };
  // 离线模式切换（手动 / 浏览器自动）
  'offline:changed': { offline: boolean; source: 'manual' | 'browser' };
  // 模型视觉装饰事件
  'expression:change': { expression: string; emotion: string; intensity: number };
  'param:update': { key: string; value: number };
  'animation:trigger': { name: string; duration: number };
  // 工具调用事件
  'tool:call': { name: string; args: Record<string, unknown> };
  'tool:result': { name: string; content: string; isError?: boolean };
  'tool:execute': { id: string; name: string; args: Record<string, unknown> };
  // 权限网关：工具执行前的授权确认（与 ConsentGate 解耦通信）
  'permission:request': ConsentRequest;
  'permission:resolve': { requestId: string; decision: ConsentDecision };
  // 交互事件：用户点击/触摸宠物
  'interaction:pat': { target: string; count: number };
  'interaction:tap': { target: string; intensity: number };
  'interaction:step': { target: string };
  // Hermes Gateway 事件
  'hermes:connected': Record<string, never>;
  'hermes:disconnected': Record<string, never>;
  'hermes:token': { token: string; msgId: string };
  'hermes:done': { fullResponse: string; msgId?: string };
  'hermes:history': { sessionId: string; messages: Array<Record<string, unknown>> };
  'hermes:error': { message: string; msgId?: string };
  'hermes:voice': Record<string, unknown>;
  'hermes:skill': { command: string; args: string; behaviorEvent: string };
  // 顶部刘海字幕层事件（唤醒/聊天回复/语音通话 全场景共用）
  // phase: 'listening' 识别中(partial) | 'recognized' 识别完成 | 'speaking' 角色回复(流式)
  'subtitle:update': {
    phase: 'listening' | 'recognized' | 'speaking' | 'idle';
    text: string;
    /** 声波振幅 0~1（listening/speaking 时驱动律动），缺省由文本长度估算 */
    amplitude?: number;
  };
  // 紧急停止（Kill Switch）：中断当前工具循环/语音链路
  'tool:abort': { reason: string };
  // Service Watchdog events
  'service:recovered': { name: string; port: number };
  'service:restart:request': { name: string; port: number };
  'service:restarted': { name: string; port: number };
  'service:unhealthy': { name: string; port: number; failureCount: number };
};

type Handler<T> = (payload: T) => void;

class EventBus {
  private handlers = new Map<keyof EventMap, Set<Handler<unknown>>>();

  /** 订阅事件，返回取消订阅函数 */
  on<E extends keyof EventMap>(event: E, handler: Handler<EventMap[E]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const set = this.handlers.get(event)!;
    set.add(handler as Handler<unknown>);
    return () => set.delete(handler as Handler<unknown>);
  }

  /** 发布事件 */
  emit<E extends keyof EventMap>(event: E, payload: EventMap[E]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[EventBus] handler error for '${event}':`, err);
      }
    }
  }

  /** 取消订阅 */
  off<E extends keyof EventMap>(event: E, handler: Handler<EventMap[E]>): void {
    this.handlers.get(event)?.delete(handler as Handler<unknown>);
  }

  /**
   * 订阅全部事件（无侵入追踪用，Phase 12.2）。
   * @returns 取消全量订阅的函数
   */
  onAny(handler: (event: keyof EventMap, payload: unknown) => void): () => void {
    const offs = (Object.keys(this.handlers) as Array<keyof EventMap>).map((event) =>
      this.on(event, (payload) => handler(event, payload)),
    );
    return () => {
      for (const off of offs) off();
    };
  }
}

/** 全局单例 EventBus */
export const eventBus = new EventBus();
