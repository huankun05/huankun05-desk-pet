/**
 * 记忆全链路集成测试
 *
 * 模拟一次真实用户对话，验证数据在整条链路上真实流通：
 *   对话落盘(addToRag 核心逻辑) → 持久化(localStorage) → 新实例恢复
 *   → UnifiedMemoryStage 检索并注入 LLM 上下文 → 备份收集/还原
 *   → 跨窗消息同步合并
 *
 * 覆盖 useRagPersistence / ragEngine / UnifiedMemoryStage / backupEngine / msgSync
 * 的真实协作，而非各自孤立的单元测试。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Tauri invoke（备份引擎等模块顶层依赖）
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

import { RAGEngine, getRAGEngine, resetRAGEngine } from './rag/engine';
import { UnifiedMemoryStage } from './pipeline/stages/unified-memory';
import { collectBackupData, applyData } from './backup/backupEngine';
import { mergeSyncedMessage } from '../hooks/msgSync';
import type { Message } from '../components/Chat/ChatWindow';

/** 复刻 useRagPersistence.addToRag 的落盘逻辑（写端真实路径） */
async function addToRagLike(
  userText: string,
  aiText: string,
  meta: { userMessageId: string; assistantMessageId: string; sessionId: string },
) {
  const ragEngine = getRAGEngine();
  const now = new Date();
  if (userText.trim().length >= 6) {
    await ragEngine.upsert({
      id: `u_${meta.userMessageId}`,
      content: `用户说：${userText}`,
      metadata: { type: 'user', sessionId: meta.sessionId },
      createdAt: now,
      accessCount: 0,
      lastAccessed: now,
      importance: 0.3,
    });
  }
  if (aiText.trim().length >= 6) {
    await ragEngine.upsert({
      id: `a_${meta.assistantMessageId}`,
      content: `我回复：${aiText}`,
      metadata: { type: 'assistant', sessionId: meta.sessionId },
      createdAt: now,
      accessCount: 0,
      lastAccessed: now,
      importance: 0.4,
    });
  }
  await ragEngine.extractStructuredMemories(userText, aiText);
  ragEngine.saveToStorage();
}

describe('记忆全链路：对话 → 落盘 → 检索 → 上下文注入 → 备份还原 → 跨窗同步', () => {
  beforeEach(() => {
    localStorage.clear();
    resetRAGEngine();
  });
  afterEach(() => {
    resetRAGEngine();
  });

  it('一次完整对话后，检索命中记忆、上下文注入 LLM、备份还原无损、跨窗同步合并', async () => {
    const sessionId = 'session_full_chain';

    // ===== 1. 模拟一次对话落盘（真实写端路径） =====
    const userText = '我养了一只叫团子的橘猫，它特别喜欢晒太阳和吃小鱼干';
    const aiText = '记住了！团子喜欢晒太阳，下次我会主动提起它的。';
    await addToRagLike(userText, aiText, {
      userMessageId: 'm1',
      assistantMessageId: 'm2',
      sessionId,
    });

    // ===== 2. 持久化往返：新实例能恢复全部文档 =====
    const restored = new RAGEngine();
    restored.loadFromStorage();
    const docCount = restored.size;
    expect(docCount).toBeGreaterThanOrEqual(2); // user + assistant 至少 2 条
    expect(restored.get('u_m1')?.content).toContain('团子');
    expect(restored.get('u_m1')?.createdAt).toBeInstanceOf(Date);

    // ===== 3. 检索链路：UnifiedMemoryStage 把长期记忆注入 LLM 上下文 =====
    const stage = new UnifiedMemoryStage(() => ''); // 无短期上下文
    const ctx = {
      userText: '团子平时喜欢做什么呀？',
      memoryContext: '',
      userEmbedding: [],
    } as never;
    await stage.process(ctx, {} as never);
    const injected = (ctx as { memoryContext: string }).memoryContext;
    expect(injected).toContain('团子');
    expect(injected).toContain('晒太阳');
    expect(injected.length).toBeLessThanOrEqual(1800); // 预算截断生效

    // ===== 4. 备份收集 → 模拟数据丢失 → 还原 =====
    const backup = await collectBackupData();
    expect(backup.data.rag_docs).toBeTruthy(); // RAG 记忆在备份范围内
    localStorage.clear(); // 模拟数据丢失
    applyData(backup.data); // 还原
    const afterRestore = new RAGEngine();
    afterRestore.loadFromStorage();
    expect(afterRestore.size).toBe(docCount); // 还原无损

    // ===== 5. 跨窗同步：主窗广播 → 面板按会话合并 =====
    const panelLocal: Message[] = [];
    const remoteMsg = {
      id: 'hermes_888',
      role: 'assistant',
      content: '团子最喜欢晒太阳啦',
      timestamp: new Date('2026-08-07T10:00:00Z').toISOString(), // 跨窗 JSON 序列化后的字符串
    } as unknown as Message;
    const merged = mergeSyncedMessage(panelLocal, { sessionId, msg: remoteMsg }, sessionId);
    expect(merged).toHaveLength(1);
    expect(merged[0].timestamp).toBeInstanceOf(Date); // 时间戳已还原
    // 不同会话的消息不合并
    const otherSession = mergeSyncedMessage(
      merged,
      { sessionId: 'other', msg: remoteMsg },
      sessionId,
    );
    expect(otherSession).toHaveLength(1);
  });

  it('结构化记忆抽取结果也参与检索（偏好/事实型记忆）', async () => {
    await addToRagLike('我最喜欢的颜色是蓝色', '好的，蓝色是你的最爱', {
      userMessageId: 'm3',
      assistantMessageId: 'm4',
      sessionId: 's2',
    });
    const stage = new UnifiedMemoryStage(() => '');
    const ctx = { userText: '我喜欢什么颜色？', memoryContext: '' } as never;
    await stage.process(ctx, {} as never);
    const injected = (ctx as { memoryContext: string }).memoryContext;
    // 原始对话（用户说：我最喜欢的颜色是蓝色）应命中
    expect(injected).toContain('蓝色');
  });

  it('空记忆库时检索链路安全返回空上下文', async () => {
    const stage = new UnifiedMemoryStage(() => '');
    const ctx = { userText: '随便问问', memoryContext: '' } as never;
    await stage.process(ctx, {} as never);
    expect((ctx as { memoryContext: string }).memoryContext).toBe('');
  });
});
