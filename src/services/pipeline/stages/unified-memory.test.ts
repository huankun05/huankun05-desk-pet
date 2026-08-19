import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../rag/engine');
vi.mock('./rag');

import { UnifiedMemoryStage } from './unified-memory';
import { getRAGEngine } from '../../rag/engine';
import { isRAGEnabled } from './rag';
import type { MessageContext, PipelineCallbacks } from '../types';

const mockedGetRAGEngine = vi.mocked(getRAGEngine);
const mockedIsRAGEnabled = vi.mocked(isRAGEnabled);

function mkCtx(userText = '今天天气真好'): MessageContext {
  return {
    userText,
    session: {} as unknown as MessageContext['session'],
    assistantMessageId: 'a1',
    accumulated: '',
    sentenceBuffer: '',
    emotionSnapshot: {} as unknown as MessageContext['emotionSnapshot'],
    memoryContext: '',
    speakableText: '',
    ttsAudio: null,
    ttsSampleRate: 0,
    aborted: false,
  };
}

const LOCAL = '用户设定：喜欢猫';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UnifiedMemoryStage 路由（统一本地单方案）', () => {
  it('RAG 开启：始终走本地 RAG 检索（不再区分后端在线/离线）', async () => {
    mockedIsRAGEnabled.mockReturnValue(true);
    const ragStub = { getContext: vi.fn().mockResolvedValue('[记忆] 用户喜欢蓝色') };
    mockedGetRAGEngine.mockReturnValue(ragStub as unknown as ReturnType<typeof getRAGEngine>);

    const stage = new UnifiedMemoryStage(() => LOCAL);
    const ctx = mkCtx();
    await stage.process(ctx, {} as unknown as PipelineCallbacks);

    expect(ragStub.getContext).toHaveBeenCalledWith('今天天气真好', 1800);
    expect(ctx.memoryContext).toContain('[记忆] 用户喜欢蓝色');
    expect(ctx.memoryContext).toContain(LOCAL);
  });

  it('RAG 关闭：仅注入短期设定上下文', async () => {
    mockedIsRAGEnabled.mockReturnValue(false);
    const ragStub = { getContext: vi.fn().mockResolvedValue('[记忆] 不应出现') };
    mockedGetRAGEngine.mockReturnValue(ragStub as unknown as ReturnType<typeof getRAGEngine>);

    const stage = new UnifiedMemoryStage(() => LOCAL);
    const ctx = mkCtx();
    await stage.process(ctx, {} as unknown as PipelineCallbacks);

    expect(ragStub.getContext).not.toHaveBeenCalled();
    expect(ctx.memoryContext).toBe(LOCAL);
  });

  it('合并时逐行哈希去重（短期与长期重复行只保留一次）', async () => {
    mockedIsRAGEnabled.mockReturnValue(true);
    const ragStub = {
      getContext: vi.fn().mockResolvedValue('用户设定：喜欢猫\n重复行\n[记忆] 独有记忆'),
    };
    mockedGetRAGEngine.mockReturnValue(ragStub as unknown as ReturnType<typeof getRAGEngine>);

    const stage = new UnifiedMemoryStage(() => '用户设定：喜欢猫\n重复行');
    const ctx = mkCtx();
    await stage.process(ctx, {} as unknown as PipelineCallbacks);

    const lines: string[] = ctx.memoryContext.split('\n');
    expect(lines.filter((l: string) => l === '用户设定：喜欢猫').length).toBe(1);
    expect(lines.filter((l: string) => l === '重复行').length).toBe(1);
    expect(ctx.memoryContext).toContain('独有记忆');
  });

  it('长期记忆超预算时按 LONG_TERM_BUDGET 截断', async () => {
    mockedIsRAGEnabled.mockReturnValue(true);
    const huge = Array.from(
      { length: 200 },
      (_, i) => `[记忆] 长记忆条目编号${i} 内容填充内容填充`,
    ).join('\n');
    const ragStub = { getContext: vi.fn().mockResolvedValue(huge) };
    mockedGetRAGEngine.mockReturnValue(ragStub as unknown as ReturnType<typeof getRAGEngine>);

    const stage = new UnifiedMemoryStage(() => LOCAL);
    const ctx = mkCtx();
    await stage.process(ctx, {} as unknown as PipelineCallbacks);

    expect(ctx.memoryContext).toContain('编号0');
    expect(ctx.memoryContext).not.toContain('编号199'); // 超出预算被截断
  });

  it('本地 RAG 检索异常时优雅降级（不抛出，跳过长期记忆）', async () => {
    mockedIsRAGEnabled.mockReturnValue(true);
    const ragStub = { getContext: vi.fn().mockRejectedValue(new Error('engine boom')) };
    mockedGetRAGEngine.mockReturnValue(ragStub as unknown as ReturnType<typeof getRAGEngine>);

    const stage = new UnifiedMemoryStage(() => LOCAL);
    const ctx = mkCtx();
    await expect(stage.process(ctx, {} as unknown as PipelineCallbacks)).resolves.toBeUndefined();
    expect(ctx.memoryContext).toBe(LOCAL);
  });
});
