import { describe, it, expect } from 'vitest';
import { mergeSyncedMessage, type SyncedMessagePayload } from './msgSync';
import type { Message } from '../components/Chat/ChatWindow';

function msg(id: string, content: string, ts?: Date): Message {
  return { id, role: 'user', content, timestamp: ts ?? new Date() };
}

function payload(sessionId: string, m: Message): SyncedMessagePayload {
  return { sessionId, msg: m };
}

describe('mergeSyncedMessage 跨窗消息合并', () => {
  it('会话不匹配时原样返回（同一引用）', () => {
    const prev = [msg('m1', 'A')];
    const out = mergeSyncedMessage(prev, payload('sess-b', msg('m2', 'B')), 'sess-a');
    expect(out).toBe(prev);
  });

  it('空 payload 或会话未选择时原样返回', () => {
    const prev = [msg('m1', 'A')];
    expect(mergeSyncedMessage(prev, null, 'sess-a')).toBe(prev);
    expect(mergeSyncedMessage(prev, payload('sess-a', msg('m2', 'B')), null)).toBe(prev);
    expect(mergeSyncedMessage(prev, undefined, 'sess-a')).toBe(prev);
  });

  it('新消息追加到列表尾部', () => {
    const prev = [msg('m1', 'A')];
    const out = mergeSyncedMessage(prev, payload('sess-a', msg('m2', 'B')), 'sess-a');
    expect(out).toHaveLength(2);
    expect(out[1].id).toBe('m2');
    expect(out[0]).toBe(prev[0]); // 原消息引用不变
  });

  it('同 id 不同内容替换原消息', () => {
    const prev = [msg('m1', '旧内容')];
    const out = mergeSyncedMessage(prev, payload('sess-a', msg('m1', '新内容')), 'sess-a');
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('新内容');
  });

  it('同 id 同内容同时刻幂等（返回同一引用，不触发重渲染）', () => {
    const ts = new Date('2026-08-07T10:00:00Z');
    const prev = [msg('m1', '相同内容', ts)];
    const out = mergeSyncedMessage(prev, payload('sess-a', msg('m1', '相同内容', ts)), 'sess-a');
    expect(out).toBe(prev);
  });

  it('timestamp 为 ISO 字符串时还原为 Date（Tauri 事件序列化场景）', () => {
    const ts = new Date('2026-08-07T10:00:00Z');
    const incoming = {
      id: 'm1',
      role: 'assistant' as const,
      content: '回复',
      timestamp: ts.toISOString(), // 模拟跨窗 JSON 序列化后的字符串
    };
    const out = mergeSyncedMessage([], payload('sess-a', incoming as unknown as Message), 'sess-a');
    expect(out[0].timestamp).toBeInstanceOf(Date);
    expect((out[0].timestamp as Date).getTime()).toBe(ts.getTime());
  });

  it('替换后 timestamp 也是 Date 类型', () => {
    const prev = [msg('m1', '旧', new Date('2026-01-01T00:00:00Z'))];
    const incoming = msg('m1', '新', new Date('2026-08-07T00:00:00Z'));
    incoming.timestamp = incoming.timestamp.toISOString() as unknown as Date;
    const out = mergeSyncedMessage(prev, payload('sess-a', incoming), 'sess-a');
    expect(out[0].timestamp).toBeInstanceOf(Date);
  });
});
