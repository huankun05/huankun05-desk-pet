/**
 * ContextStage — 上下文压缩阶段
 *
 * 位于 MemoryStage 之后、LLMStage 之前。
 * 对 MessageContext 中的 memoryContext + session 消息进行 Token 预算管理：
 * 1. 估计当前消息的 token 数
 * 2. 如超出阈值，应用三层防御链压缩
 * 3. 将压缩后的 memoryContext 写回 ctx.memoryContext
 */

import type { Stage, MessageContext, PipelineCallbacks } from '../types';
import type { ContextManager } from '../../context/manager';
import { estimateTokens } from '../../../utils/tokenEstimator';
import { createLogger } from '../../../utils/logger';

const log = createLogger('ContextStage');

export class ContextStage implements Stage {
  readonly name = 'context';
  private contextManager: ContextManager;

  constructor(contextManager: ContextManager) {
    this.contextManager = contextManager;
  }

  async process(ctx: MessageContext, _callbacks: PipelineCallbacks): Promise<void> {
    if (!ctx.memoryContext && ctx.session.messages.length === 0) return;

    const config = this.contextManager.config;

    // 构建完整的消息列表用于 token 估算
    const systemLike = ctx.memoryContext || '';
    const messages = [
      { role: 'system' as const, content: systemLike },
      ...ctx.session.messages.slice(-config.enforceMaxTurns || 20).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    // 执行压缩
    const result = this.contextManager.process(messages);

    if (result.compressed) {
      log.info('Context compressed', {
        strategy: result.strategy,
        before: result.beforeTokens,
        after: result.afterTokens,
        limit: config.maxContextTokens,
      });

      // 提取压缩后的 system prompt（第一条 system 消息 + 可能的摘要 system 消息）
      const systemMessages = result.messages.filter((m) => m.role === 'system');
      // 合并所有 system 消息作为新的 memoryContext
      ctx.memoryContext = systemMessages.map((m) => m.content).join('\n\n');

      // 提取压缩后的对话历史（user/assistant 消息），供 LLMStage 使用
      const historyMessages = result.messages.filter(
        (m) => m.role === 'user' || m.role === 'assistant',
      );
      if (historyMessages.length > 0) {
        ctx.compressedHistory = historyMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
      }
    }

    // 日志：输出 token 使用率
    const totalTokens =
      estimateTokens(ctx.memoryContext) +
      messages.slice(1).reduce((acc, m) => acc + estimateTokens(m.content) + 4, 0);
    const usagePercent =
      config.maxContextTokens > 0 ? Math.round((totalTokens / config.maxContextTokens) * 100) : 0;
    if (usagePercent > 70) {
      log.info('Context usage', {
        tokens: totalTokens,
        max: config.maxContextTokens,
        usage: `${usagePercent}%`,
      });
    }
  }
}
