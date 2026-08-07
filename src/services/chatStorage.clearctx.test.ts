import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Tauri invoke 以避免环境依赖
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

import {
  createSession,
  switchSession,
  saveMessage,
  listSessions,
  clearSessionMessages,
  renameSession,
} from './chatStorage';
import type { Message } from '../components/Chat/ChatWindow';

function fakeMessage(id: string, content: string): Message {
  return { id, role: 'user', content, timestamp: new Date() };
}

describe('会话存储 - /clearctx 与 /rename 支撑', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clearSessionMessages 清空指定会话消息但保留会话本身', () => {
    const s = createSession();
    switchSession(s.id);
    saveMessage(fakeMessage('m1', 'hello'));

    expect(listSessions().find((x) => x.id === s.id)!.messages).toHaveLength(1);

    clearSessionMessages(s.id);

    const after = listSessions().find((x) => x.id === s.id);
    expect(after).toBeDefined();
    expect(after!.messages).toEqual([]);
  });

  it('renameSession 更新会话标题', () => {
    const s = createSession();
    renameSession(s.id, '新的标题');
    expect(listSessions().find((x) => x.id === s.id)?.title).toBe('新的标题');
  });
});
