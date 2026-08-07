import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enhanceMemoriesWithLLM, type LLMCall } from './llm-enhancer';
import { mergeExtractedMemories, memoryExtractor } from './extractor';
import type { ExtractedMemory } from './extractor';
import { RAGEngine } from '../rag/engine';

function mk(content: string, type: ExtractedMemory['type'], confidence: number): ExtractedMemory {
  return { id: `id_${content}`, type, content, confidence, createdAt: Date.now() };
}

describe('enhanceMemoriesWithLLM (解析)', () => {
  it('解析纯 JSON 数组', async () => {
    const llmCall: LLMCall = async () =>
      JSON.stringify([{ type: 'fact', content: '测试', confidence: 0.8 }]);
    const out = await enhanceMemoriesWithLLM({ userText: 'x', ruleCandidates: [], llmCall });
    expect(out.length).toBe(1);
    expect(out[0].content).toBe('测试');
    expect(out[0].source).toBe('llm');
    expect(out[0].confidence).toBe(0.8);
  });

  it('解析包裹在 markdown 代码块中的 JSON', async () => {
    const llmCall: LLMCall = async () =>
      '```json\n[{"type":"fact","content":"公园","confidence":0.7}]\n```';
    const out = await enhanceMemoriesWithLLM({ userText: 'x', ruleCandidates: [], llmCall });
    expect(out.map((m) => m.content)).toEqual(['公园']);
  });

  it('无效 JSON 返回空数组（不抛错）', async () => {
    const llmCall: LLMCall = async () => '完全不是 json';
    const out = await enhanceMemoriesWithLLM({ userText: 'x', ruleCandidates: [], llmCall });
    expect(out).toEqual([]);
  });

  it('LLM 抛错时返回空数组（不抛错）', async () => {
    const llmCall: LLMCall = async () => {
      throw new Error('network down');
    };
    const out = await enhanceMemoriesWithLLM({ userText: 'x', ruleCandidates: [], llmCall });
    expect(out).toEqual([]);
  });

  it('丢弃非法 type 或空 content', async () => {
    const llmCall: LLMCall = async () =>
      JSON.stringify([
        { type: 'bogus', content: '坏类型' },
        { type: 'fact', content: '' },
        { type: 'fact', content: '有效' },
      ]);
    const out = await enhanceMemoriesWithLLM({ userText: 'x', ruleCandidates: [], llmCall });
    expect(out.map((m) => m.content)).toEqual(['有效']);
  });

  it('缺失 confidence 时回退默认 0.6', async () => {
    const llmCall: LLMCall = async () => JSON.stringify([{ type: 'fact', content: '默认分' }]);
    const out = await enhanceMemoriesWithLLM({ userText: 'x', ruleCandidates: [], llmCall });
    expect(out[0].confidence).toBe(0.6);
  });
});

describe('mergeExtractedMemories', () => {
  it('按归一化内容去重，保留更高置信度', () => {
    const merged = mergeExtractedMemories([
      mk('我喜欢猫', 'preference', 0.5),
      mk('我喜欢猫', 'preference', 0.9),
      mk('我喜欢狗', 'preference', 0.8),
    ]);
    expect(merged.length).toBe(2);
    const cat = merged.find((m) => m.content === '我喜欢猫');
    expect(cat?.confidence).toBe(0.9);
  });
});

describe('RAGEngine.extractStructuredMemories + LLM 增强', () => {
  // 全局 extractor 的 seen 去重集跨调用累积，测试间需重置，避免互相污染
  beforeEach(() => memoryExtractor.reset());

  it('默认关闭时不调用 LLM，仅规则抽取', async () => {
    const engine = new RAGEngine(); // llmEnhancementEnabled 默认 false
    const llmCall = vi.fn<LLMCall>(async () => '[]');
    engine.setLLMEnhancer(llmCall);
    const ids = await engine.extractStructuredMemories('我叫小明', '好的');
    expect(llmCall).not.toHaveBeenCalled();
    // 规则抽取从「我叫小明」得到 小明(fact)
    expect(ids.length).toBe(1);
    expect(engine.get(ids[0])?.content).toContain('小明');
  });

  it('启用时合并规则 + LLM 结果并去重', async () => {
    const engine = new RAGEngine({ llmEnhancementEnabled: true });
    const llmCall: LLMCall = async () =>
      JSON.stringify([
        { type: 'fact', content: '小明', confidence: 0.9 }, // 与规则重复 -> 去重
        { type: 'event', content: '去了公园', confidence: 0.7 },
      ]);
    engine.setLLMEnhancer(llmCall);
    const ids = await engine.extractStructuredMemories('我叫小明', '好的');
    // 规则: 小明; LLM: 小明(重复) + 去了公园 => 2 条唯一
    expect(ids.length).toBe(2);
    const contents = ids.map((id) => engine.get(id)?.content ?? '');
    expect(contents.some((c) => c.includes('小明'))).toBe(true);
    expect(contents.some((c) => c.includes('去了公园'))).toBe(true);
  });

  it('LLM 抛错时回退为纯规则结果', async () => {
    const engine = new RAGEngine({ llmEnhancementEnabled: true });
    const llmCall: LLMCall = async () => {
      throw new Error('boom');
    };
    engine.setLLMEnhancer(llmCall);
    const ids = await engine.extractStructuredMemories('我叫小明', '好的');
    expect(ids.length).toBe(1);
    expect(engine.get(ids[0])?.content).toContain('小明');
  });
});
