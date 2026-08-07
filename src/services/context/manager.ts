/**
 * ContextManager — Token 预算管理 + 三层防御链
 *
 * 每次 LLM 调用前，对消息列表进行压缩处理，确保不超过 context window：
 *
 * 第一层：轮次硬截断（保留最近 N 轮）
 *   - System 消息永不丢弃
 *   - 截断后首条非-system 必须是 user
 *
 * 第二层：Token 压缩（受 compressionEnabled 开关控制，使用率 > threshold 触发）
 *   - 策略 A：按 token 预算截断（快速，默认）
 *   - 策略 B：对半截断兜底（暴力保证不溢出）
 *
 * 第三层：对半截断（暴力兜底，确保永不超出窗口）
 */

import type { ContextConfig } from './types';
import { DEFAULT_CONTEXT_CONFIG } from './types';
import { estimateTokens, estimateMessagesTokens } from '../../utils/tokenEstimator';
import type { CompressionResult } from './types';

export class ContextManager {
  readonly config: ContextConfig;

  constructor(config: Partial<ContextConfig> = {}) {
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config };
  }

  /**
   * 处理消息列表：应用三层防御链
   *
   * @param messages - 当前消息列表（不含 system prompt 时 system 作为第一条）
   * @returns 压缩结果
   */
  process(messages: Array<{ role: string; content: string }>): CompressionResult {
    if (messages.length === 0) {
      return {
        messages,
        compressed: false,
        beforeTokens: 0,
        afterTokens: 0,
        strategy: 'none',
      };
    }

    const before = estimateMessagesTokens(messages);
    let processed = [...messages];
    let strategy: CompressionResult['strategy'] = 'none';

    // 第一层：轮次截断
    if (this.config.enforceMaxTurns > 0) {
      const result = this.truncateByTurns(processed);
      if (result.length < processed.length) {
        processed = result;
        strategy = 'turn_truncation';
      }
    }

    // 第二层：Token 压缩（受 compressionEnabled 开关控制）
    // compressionEnabled=true（推荐）：使用率超过阈值则按 token 预算截断（策略 A），
    //   仍超出窗口则对半截断兜底（策略 B），让模型保留最相关的近期消息而非整轮丢弃。
    // compressionEnabled=false：跳过本层，仅依赖第一层轮次截断 + 末尾安全兜底。
    if (this.config.compressionEnabled) {
      const { tokens: currentTokens } = estimateMessagesTokens(processed);
      const usageRate = currentTokens / this.config.maxContextTokens;

      if (usageRate > this.config.compressionThreshold) {
        // 策略 A：按 token 预算截断（激进）
        processed = this.truncateByTokenBudget(processed);
        const { tokens: afterTruncate } = estimateMessagesTokens(processed);
        if (afterTruncate > this.config.maxContextTokens) {
          // 策略 B：对半截断兜底
          processed = this.truncateByHalving(processed);
          strategy = 'halving';
        } else if (strategy === 'none') {
          strategy = 'turn_truncation';
        }
      }
    }

    // 第三层：安全兜底（无论如何不超过窗口，防止溢出导致 LLM 报错）
    const { tokens: finalTokens } = estimateMessagesTokens(processed);
    if (finalTokens > this.config.maxContextTokens) {
      processed = this.truncateByHalving(processed);
      if (strategy === 'none') strategy = 'halving';
    }

    const after = estimateMessagesTokens(processed);

    return {
      messages: processed,
      compressed: strategy !== 'none',
      beforeTokens: before.tokens,
      afterTokens: after.tokens,
      strategy,
    };
  }

  /**
   * 第一层：按轮次截断（保留最近 N 个 user-assistant 轮次）
   *
   * - system 消息始终保留
   * - 截断后确保首条非-system 消息是 user
   */
  private truncateByTurns(
    messages: Array<{ role: string; content: string }>,
  ): Array<{ role: string; content: string }> {
    const maxTurns = this.config.enforceMaxTurns;
    if (maxTurns <= 0 || messages.length <= 1) return messages;

    // 分离 system 消息
    const systemMsgs = messages.filter((m) => m.role === 'system');
    const nonSystemMsgs = messages.filter((m) => m.role !== 'system');

    // 收集最近的 N 轮（一个 user-assistant 交替对为一轮）
    const turns: Array<Array<{ role: string; content: string }>> = [];
    let currentTurn: Array<{ role: string; content: string }> = [];

    for (let i = 0; i < nonSystemMsgs.length; i++) {
      const msg = nonSystemMsgs[i];
      if (msg.role === 'user' && currentTurn.length > 0) {
        turns.push(currentTurn);
        currentTurn = [];
      }
      currentTurn.push(msg);
    }
    if (currentTurn.length > 0) {
      turns.push(currentTurn);
    }

    // 只保留最近 maxTurns 轮
    const recentTurns = turns.slice(-maxTurns);
    const truncated = recentTurns.flat();

    // 确保首条非-system 消息是 user；如果不是，移除前面的 assistant 消息
    while (truncated.length > 0 && truncated[0].role === 'assistant') {
      truncated.shift();
    }

    return [...systemMsgs, ...truncated];
  }

  /**
   * 第二层：按 Token 预算截断
   *
   * 从后往前保留消息，直到接近 82% 阈值
   */
  private truncateByTokenBudget(
    messages: Array<{ role: string; content: string }>,
  ): Array<{ role: string; content: string }> {
    const budget = Math.floor(this.config.maxContextTokens * this.config.compressionThreshold);
    const systemMsgs = messages.filter((m) => m.role === 'system');
    const nonSystemMsgs = messages.filter((m) => m.role !== 'system');

    const systemTokens = estimateMessagesTokens(systemMsgs).tokens;
    const available = budget - systemTokens;

    // 从后往前收集
    const kept: Array<{ role: string; content: string }> = [];
    let accTokens = 0;
    for (let i = nonSystemMsgs.length - 1; i >= 0; i--) {
      const t = estimateTokens(nonSystemMsgs[i].content) + 4;
      if (accTokens + t > available) break;
      accTokens += t;
      kept.unshift(nonSystemMsgs[i]);
    }

    // 确保首条非-system 消息是 user
    while (kept.length > 0 && kept[0].role === 'assistant') {
      kept.shift();
    }

    return [...systemMsgs, ...kept];
  }

  /**
   * 第三层：对半截断兜底
   *
   * 当压缩策略仍超出窗口时，暴力截断一半
   */
  private truncateByHalving(
    messages: Array<{ role: string; content: string }>,
  ): Array<{ role: string; content: string }> {
    const systemMsgs = messages.filter((m) => m.role === 'system');
    const nonSystemMsgs = messages.filter((m) => m.role !== 'system');

    // 保留后一半
    const half = Math.ceil(nonSystemMsgs.length / 2);
    const kept = nonSystemMsgs.slice(-half);

    // 确保首条是 user
    while (kept.length > 0 && kept[0].role === 'assistant') {
      kept.shift();
    }

    return [...systemMsgs, ...kept];
  }
}

/** 全局单例（延迟初始化，由 App 层注入配置） */
let globalManager: ContextManager | null = null;

export function getContextManager(): ContextManager | null {
  return globalManager;
}

export function initContextManager(config: Partial<ContextConfig> = {}): ContextManager {
  globalManager = new ContextManager(config);
  return globalManager;
}
