import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RAGEngine, resetRagStoreForTests } from './engine';

function doc(
  id: string,
  content: string,
  importance: number,
  extra?: Partial<Parameters<RAGEngine['upsert']>[0]>,
) {
  return {
    id,
    content,
    createdAt: new Date(),
    accessCount: 0,
    lastAccessed: new Date(),
    importance,
    ...extra,
  };
}

describe('RAGEngine 持久化与超限降级', () => {
  let engine: RAGEngine;
  beforeEach(() => {
    engine = new RAGEngine();
    engine.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetRagStoreForTests();
    localStorage.clear();
  });

  it('saveToStorage 超限时按有效重要性逐出非永久文档（最多 20%），永久记忆保留', async () => {
    await engine.upsert(doc('perm', '永久记忆内容', 0.9, { metadata: { permanent: 'true' } }));
    await engine.upsert(doc('high', '重要记忆内容', 0.9));
    await engine.upsert(doc('low1', '低效记忆一', 0.05));
    await engine.upsert(doc('low2', '低效记忆二', 0.05));

    // 模拟 localStorage 配额满：setItem 抛异常，触发降级逐出
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    engine.saveToStorage();
    spy.mockRestore();

    // 4 条 × 20% = 0.8 → floor=0 → max(1,0)=1：逐出 1 条最低效的
    expect(engine.size).toBe(3);
    expect(engine.get('perm')).toBeDefined(); // 永久跳过
    expect(engine.get('high')).toBeDefined(); // 高重要性保留
    expect(engine.get('low1')).toBeUndefined(); // 最低效被逐出
    expect(engine.get('low2')).toBeDefined();
  });

  it('saveToStorage 正常时可完整写回 localStorage', async () => {
    await engine.upsert(doc('d1', '用户说：你好', 0.5));
    engine.saveToStorage();
    const raw = localStorage.getItem('deskpet_rag_docs_v1');
    expect(raw).toBeTruthy();
    const arr = JSON.parse(raw!) as Array<{ id: string; content: string }>;
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toBe('d1');
    expect(arr[0].content).toBe('用户说：你好');
  });

  it('saveToStorage / loadFromStorage 往返保留文档字段并还原 Date', async () => {
    await engine.upsert(doc('d1', '往返测试文档', 0.5));
    const created = new Date();
    const accessed = new Date();
    const raw = engine.get('d1')!;
    raw.accessCount = 7;
    raw.lastAccessed = accessed;
    raw.createdAt = created;
    engine.saveToStorage();

    // 新引擎实例从 localStorage 恢复
    const engine2 = new RAGEngine();
    engine2.loadFromStorage();
    const restored = engine2.get('d1')!;
    expect(restored).toBeDefined();
    expect(restored.content).toBe('往返测试文档');
    expect(restored.accessCount).toBe(7);
    expect(restored.createdAt).toBeInstanceOf(Date);
    expect(restored.createdAt.getTime()).toBe(created.getTime());
    expect(restored.lastAccessed.getTime()).toBe(accessed.getTime());
    expect(restored.baseImportance).toBeCloseTo(0.5);
    // 恢复后可正常检索
    const results = await engine2.search('往返测试');
    expect(results.length).toBe(1);
    expect(results[0].doc.id).toBe('d1');
  });

  it('loadFromStorage 遇损坏数据时清空键避免反复失败', () => {
    localStorage.setItem('deskpet_rag_docs_v1', '{ 这不是合法 JSON');
    const engine2 = new RAGEngine();
    expect(() => engine2.loadFromStorage()).not.toThrow();
    expect(engine2.size).toBe(0);
    expect(localStorage.getItem('deskpet_rag_docs_v1')).toBeNull(); // 损坏键被清掉
  });
});

describe('RAGEngine BM25 中文检索', () => {
  let engine: RAGEngine;
  beforeEach(() => {
    engine = new RAGEngine();
    engine.clear();
  });

  it('unigram+bigram 分词命中相关文档', async () => {
    await engine.upsert(doc('apple', '我喜欢吃苹果和香蕉', 0.5));
    await engine.upsert(doc('sport', '今天去操场跑步锻炼身体', 0.5));
    const results = await engine.search('苹果');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].doc.id).toBe('apple');
  });

  it('相关性排序：匹配词多的文档排前面', async () => {
    await engine.upsert(doc('less', '苹果是水果', 0.5));
    await engine.upsert(doc('more', '苹果苹果苹果 香蕉', 0.5));
    const results = await engine.search('苹果 香蕉');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].doc.id).toBe('more');
  });

  it('空查询与空索引安全返回', async () => {
    expect(await engine.search('')).toEqual([]);
    await engine.upsert(doc('d1', '一些内容', 0.5));
    expect((await engine.search('')).length).toBe(0);
  });
});
