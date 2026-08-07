import { describe, it, expect, beforeEach } from 'vitest';
import { RAGEngine } from './engine';

describe('RAGEngine M3 离线轻量遗忘', () => {
  let engine: RAGEngine;
  beforeEach(() => {
    engine = new RAGEngine();
    engine.clear();
  });

  it('upsert 时锚定 baseImportance（避免反复衰减雪崩）', async () => {
    await engine.upsert({
      id: 'm1',
      content: '我喜欢吃苹果',
      createdAt: new Date(),
      accessCount: 0,
      lastAccessed: new Date(),
      importance: 0.8,
    });
    const doc = engine.get('m1')!;
    expect(doc.baseImportance).toBe(0.8);
    expect(doc.importance).toBeCloseTo(0.8);
  });

  it('宽限期内（graceDays）不遗忘低重要性记忆', async () => {
    await engine.upsert({
      id: 'recent',
      content: '苹果 香蕉',
      createdAt: new Date(),
      accessCount: 0,
      lastAccessed: new Date(),
      importance: 0.1,
    });
    const results = await engine.search('苹果 香蕉');
    expect(results.length).toBe(1); // 刚创建，宽限期内保留
  });

  it('超过宽限期且有效重要性低于阈值的旧记忆会被软遗忘删除', async () => {
    await engine.upsert({
      id: 'stale',
      content: '苹果 香蕉',
      createdAt: new Date(),
      accessCount: 0,
      lastAccessed: new Date(),
      importance: 0.05,
    });
    const doc = engine.get('stale')!;
    // 模拟 3 年前创建
    doc.createdAt = new Date(Date.now() - 3 * 365 * 86400000);
    doc.baseImportance = 0.05;

    const results = await engine.search('苹果 香蕉');
    expect(results.length).toBe(0);
    expect(engine.get('stale')).toBeUndefined();
  });

  it('永久记忆（metadata.permanent）永不被遗忘', async () => {
    await engine.upsert({
      id: 'perm',
      content: '苹果 香蕉',
      createdAt: new Date(),
      accessCount: 0,
      lastAccessed: new Date(),
      importance: 0.9,
      metadata: { permanent: 'true' },
    });
    const doc = engine.get('perm')!;
    doc.createdAt = new Date(Date.now() - 5 * 365 * 86400000); // 5 年前
    doc.baseImportance = 0.9;

    const results = await engine.search('苹果 香蕉');
    expect(results.length).toBe(1); // 永久保留
  });

  it('硬上限安全阀：超过 maxDocuments 时逐出最低重要性文档', async () => {
    const small = new RAGEngine({ maxDocuments: 3 });
    small.clear();
    for (let i = 0; i < 5; i++) {
      await small.upsert({
        id: `d${i}`,
        content: `条目 ${i}`,
        createdAt: new Date(),
        accessCount: 0,
        lastAccessed: new Date(),
        importance: i === 0 ? 0.9 : 0.1,
      });
    }
    expect(small.size).toBeLessThanOrEqual(3);
    expect(small.get('d0')).toBeDefined(); // 高重要性保留
  });

  it('重新提及会抬升基底且不被已衰减值拉低', async () => {
    await engine.upsert({
      id: 'r1',
      content: '事实一',
      createdAt: new Date(Date.now() - 100 * 86400000), // 很老
      accessCount: 0,
      lastAccessed: new Date(),
      importance: 0.1,
    });
    // 重新写入更高重要性
    await engine.upsert({
      id: 'r1',
      content: '事实一（更新）',
      createdAt: new Date(),
      accessCount: 0,
      lastAccessed: new Date(),
      importance: 0.9,
    });
    const doc = engine.get('r1')!;
    expect(doc.baseImportance).toBe(0.9); // 取较大值，不被旧的 0.1 拉低
  });
});
