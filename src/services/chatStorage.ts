/**
 * 聊天会话持久化服务
 *
 * 管理多个聊天会话，支持创建、保存、加载、切换、删除。
 * 使用 createStorage 双备份（localStorage + Tauri 文件）。
 */

import { createStorage } from './storage';
import type { Message } from '../components/Chat/ChatWindow';

// ===== 类型 =====

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

interface ChatStorageData {
  sessions: ChatSession[];
  activeSessionId: string | null;
}

// ===== 常量 =====

const MAX_SESSIONS = 50;
const TITLE_MAX_LENGTH = 20;

// ===== 存储 =====

const chatStorage = createStorage<ChatStorageData>(
  'chat_sessions',
  {
    sessions: [],
    activeSessionId: null,
  },
  { location: 'project', subdir: 'sessions' },
);

// ===== 工具函数 =====

function generateId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function autoTitle(messages: Message[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg) return '新对话';
  const text = firstUserMsg.content.replace(/\n/g, ' ');
  return text.length > TITLE_MAX_LENGTH ? text.slice(0, TITLE_MAX_LENGTH) + '…' : text;
}

function restoreDates(session: ChatSession): ChatSession {
  return {
    ...session,
    messages: session.messages.map((m) => ({
      ...m,
      timestamp: new Date(m.timestamp),
    })),
  };
}

// ===== API =====

let initialized = false;

export async function initChatStorage(): Promise<void> {
  if (initialized) return;
  initialized = true;
  await chatStorage.init();
}

/** 从磁盘重新加载（管理后台修改后调用） */
export async function reloadSessionsFromDisk(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<string>('load_project_data', {
      key: 'chat_sessions',
      subdir: 'sessions',
    });
    if (raw) {
      const data: ChatStorageData = JSON.parse(raw);
      chatStorage.set({
        sessions: (data.sessions || []).map(restoreDates),
        activeSessionId: data.activeSessionId || null,
      });
    }
  } catch {
    /* 忽略 */
  }
}

export function createSession(): ChatSession {
  const session: ChatSession = {
    id: generateId(),
    title: '新对话',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const data = chatStorage.get();
  chatStorage.set({
    sessions: [session, ...data.sessions].slice(0, MAX_SESSIONS),
    activeSessionId: session.id,
  });
  return session;
}

export function getActiveSession(): ChatSession | null {
  const data = chatStorage.get();
  if (!data.activeSessionId) return null;
  const session = data.sessions.find((s) => s.id === data.activeSessionId);
  return session ? restoreDates(session) : null;
}

export function getOrCreateActiveSession(): ChatSession {
  const existing = getActiveSession();
  if (existing) return existing;
  return createSession();
}

export function saveMessage(message: Message): void {
  const data = chatStorage.get();
  const sessionId = data.activeSessionId;
  if (!sessionId) return;

  const sessions = data.sessions.map((s) => {
    if (s.id !== sessionId) return s;
    const updatedMessages = [...s.messages, message];
    return {
      ...s,
      messages: updatedMessages,
      title: s.title === '新对话' ? autoTitle(updatedMessages) : s.title,
      updatedAt: Date.now(),
    };
  });
  chatStorage.set({ ...data, sessions });
}

export function updateLastAssistantMessage(content: string): void {
  const data = chatStorage.get();
  const sessionId = data.activeSessionId;
  if (!sessionId) return;

  const sessions = data.sessions.map((s) => {
    if (s.id !== sessionId) return s;
    const msgs = [...s.messages];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i] = { ...msgs[i], content, timestamp: new Date() };
        break;
      }
    }
    return { ...s, messages: msgs, updatedAt: Date.now() };
  });
  chatStorage.set({ ...data, sessions });
}

export function listSessions(): ChatSession[] {
  const data = chatStorage.get();
  return data.sessions.map(restoreDates);
}

export function switchSession(sessionId: string): ChatSession | null {
  const data = chatStorage.get();
  const session = data.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  chatStorage.set({ ...data, activeSessionId: sessionId });
  return restoreDates(session);
}

export function deleteSession(sessionId: string): void {
  const data = chatStorage.get();
  const sessions = data.sessions.filter((s) => s.id !== sessionId);
  const activeSessionId =
    data.activeSessionId === sessionId ? (sessions[0]?.id ?? null) : data.activeSessionId;
  chatStorage.set({ sessions, activeSessionId });
}

export function renameSession(sessionId: string, title: string): void {
  const data = chatStorage.get();
  const sessions = data.sessions.map((s) => (s.id === sessionId ? { ...s, title } : s));
  chatStorage.set({ ...data, sessions });
}

/** 清空某个会话的消息历史（保留会话本身，用于 /clearctx 重置上下文） */
export function clearSessionMessages(sessionId: string): void {
  const data = chatStorage.get();
  const sessions = data.sessions.map((s) => (s.id === sessionId ? { ...s, messages: [] } : s));
  chatStorage.set({ ...data, sessions });
}
