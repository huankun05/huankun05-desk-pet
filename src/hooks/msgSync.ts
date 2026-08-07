/**
 * 跨窗口消息同步的纯函数（主窗 ↔ 聊天面板窗）。
 *
 * 两个 webview 各自维护 useHermesGateway 的 messages state，
 * 但共享同一 localStorage 会话。收到其他窗口广播的完成态消息后，
 * 用本函数按「会话匹配 + 消息 id upsert」合并进本地列表。
 */

import type { Message } from '../components/Chat/ChatWindow';

export interface SyncedMessagePayload {
  sessionId: string;
  msg: Message;
}

/**
 * 合并远端同步消息：
 * - 会话不匹配 → 原样返回（同一引用，不触发重渲染）
 * - 新 id → 追加
 * - 同 id 不同内容 → 替换
 * - 同 id 同内容同时刻 → 原样返回（幂等：自广播/重复事件无谓重渲染）
 * - timestamp 统一还原为 Date（Tauri 事件 JSON 序列化后是 ISO 字符串，
 *   ChatWindow 日期分隔 isSameDay() 依赖 .getTime()，字符串会崩溃）
 */
export function mergeSyncedMessage(
  prev: Message[],
  payload: SyncedMessagePayload | undefined | null,
  currentSessionId: string | null | undefined,
): Message[] {
  if (!payload?.sessionId || payload.sessionId !== currentSessionId) return prev;

  const msg: Message = {
    ...payload.msg,
    timestamp: new Date(payload.msg.timestamp),
  };

  const idx = prev.findIndex((m) => m.id === msg.id);
  if (idx >= 0) {
    const existing = prev[idx];
    const sameContent = existing.content === msg.content;
    const sameTime = new Date(existing.timestamp).getTime() === new Date(msg.timestamp).getTime();
    if (sameContent && sameTime) return prev;
    const next = [...prev];
    next[idx] = msg;
    return next;
  }
  return [...prev, msg];
}
