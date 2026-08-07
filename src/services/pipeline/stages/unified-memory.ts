/**
 * UnifiedMemoryStage — 合并原 MemoryStage（Hermes 核心 / 在线权威）
 * 与原 RAGStage（自研离线兜底）为单一检索链路（M4）。
 *
 * 设计（统一后：本地优先单方案）：
 *   - 记忆完全运行在本地（RAG 引擎），不再有「后端在线 / 离线」分流，
 *     因此永不离线、也无双存储漂移问题。
 *   - 长期记忆检索统一走 getRAGEngine().getContext（BM25 + 轻量 Ebbinghaus 衰减）。
 *   - Python 后端记忆（Brain）不再参与检索链路；如需同步可另做可选写端。
 *
 * 合并后逐行哈希去重，并按 LONG_TERM_BUDGET 预算截断写入 ctx.memoryContext。
 *
 * 注意：记忆“写入 / 抽取”不在本 Stage（已移到写端 useRagPersistence.addToRag），
 * 因此本 Stage 是纯检索链路，可在管道首段无副作用执行。
 */

import type { Stage, MessageContext, PipelineCallbacks } from '../types';
import { getRAGEngine } from '../../rag/engine';
import { isRAGEnabled } from './rag';
import { createLogger } from '../../../utils/logger';

const log = createLogger('UnifiedMemory');

/** 注入 LLM 的长期记忆预算上限（字符），保护 prompt 长度 */
const LONG_TERM_BUDGET = 1800;

export class UnifiedMemoryStage implements Stage {
  readonly name = 'unified-memory';
  private getContext: () => string;

  constructor(getContext: () => string) {
    this.getContext = getContext;
  }

  async process(ctx: MessageContext, _callbacks: PipelineCallbacks): Promise<void> {
    const userQuery = ctx.userText || '';

    // 1. 短期 / 设定上下文（始终注入，用户偏好优先保留）
    const localCtx = (this.getContext() || '').trim();

    // 2. 长期记忆：统一走本地 RAG 引擎（不再有在线/离线分流）
    let longTerm = '';
    try {
      if (isRAGEnabled()) {
        longTerm = (await getRAGEngine().getContext(userQuery, LONG_TERM_BUDGET)) || '';
      }
    } catch (err) {
      log.warn('Local memory retrieval failed, skipping long-term', { err: String(err) });
    }

    // 3. 合并 + 去重 + 预算截断
    ctx.memoryContext = this._mergeDedup(localCtx, longTerm, LONG_TERM_BUDGET);
  }

  /**
   * 合并短期与长期上下文：
   * - 短期上下文优先、不受 long-term 预算挤压（ cap = budget ）；
   * - 长期上下文受剩余预算约束（ cap = budget - localCtx.length ）；
   * - 全局逐行哈希去重，避免用户设定与记忆重复注入。
   */
  private _mergeDedup(localCtx: string, longTerm: string, budget: number): string {
    const seen = new Set<string>();
    const out: string[] = [];
    let used = 0;
    const longBudget = Math.max(0, budget - localCtx.length);

    const push = (text: string, cap: number): void => {
      for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const key = line.replace(/\s+/g, '');
        if (seen.has(key)) continue;
        seen.add(key);
        if (used + line.length > cap) return;
        out.push(line);
        used += line.length;
      }
    };

    push(localCtx, budget); // 用户设定优先，使用全预算
    push(longTerm, longBudget); // 长期记忆受剩余预算约束
    return out.join('\n');
  }
}
