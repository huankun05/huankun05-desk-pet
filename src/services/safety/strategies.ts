/**
 * 内容安全策略实现
 *
 * 三个策略：KeywordsStrategy / LengthLimitStrategy / RateLimitStrategy
 * 均实现 SafetyStrategy 接口，由 SafetyChecker 编排。
 */

import type { SafetyStrategy, SafetyCheckResult, SafetyConfig } from './types';

// ===== 关键词正则匹配 =====

export class KeywordsStrategy implements SafetyStrategy {
  private patterns: RegExp[] = [];

  constructor(config: SafetyConfig['keywords']) {
    this.reload(config);
  }

  reload(config: SafetyConfig['keywords']): void {
    this.patterns = [];
    for (const pattern of config.patterns) {
      try {
        this.patterns.push(new RegExp(pattern, 'i'));
      } catch {
        console.warn(`[Safety] Invalid regex pattern: ${pattern}`);
      }
    }
  }

  check(content: string): SafetyCheckResult {
    for (const pattern of this.patterns) {
      if (pattern.test(content)) {
        return { ok: false, reason: `匹配到敏感词（${pattern.source}）` };
      }
    }
    return { ok: true, reason: '' };
  }
}

// ===== 输入长度限制 =====

export class LengthLimitStrategy implements SafetyStrategy {
  private maxLength: number;

  constructor(config: SafetyConfig['lengthLimit']) {
    this.maxLength = config.maxLength;
  }

  reload(config: SafetyConfig['lengthLimit']): void {
    this.maxLength = config.maxLength;
  }

  check(content: string): SafetyCheckResult {
    if (content.length > this.maxLength) {
      return {
        ok: false,
        reason: `消息过长（${content.length}/${this.maxLength} 字符）`,
      };
    }
    return { ok: true, reason: '' };
  }
}

// ===== 频率限制（滑动窗口） =====

export class RateLimitStrategy implements SafetyStrategy {
  private maxMessages: number;
  private windowMs: number;
  /** sessionId → 时间戳队列 */
  private timestamps = new Map<string, number[]>();

  constructor(config: SafetyConfig['rateLimit']) {
    this.maxMessages = config.maxMessages;
    this.windowMs = config.windowSeconds * 1000;
  }

  reload(config: SafetyConfig['rateLimit']): void {
    this.maxMessages = config.maxMessages;
    this.windowMs = config.windowSeconds * 1000;
  }

  check(content: string, sessionId?: string): SafetyCheckResult {
    const sid = sessionId || '__global__';
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // 获取或创建该 session 的时间戳队列
    let stamps = this.timestamps.get(sid);
    if (!stamps) {
      stamps = [];
      this.timestamps.set(sid, stamps);
    }

    // 清除过期时间戳
    while (stamps.length > 0 && stamps[0] < windowStart) {
      stamps.shift();
    }

    // 检查是否超限
    if (stamps.length >= this.maxMessages) {
      return {
        ok: false,
        reason: `发送过于频繁（${this.windowMs / 1000} 秒内已发送 ${stamps.length} 条，上限 ${this.maxMessages}）`,
      };
    }

    // 记录本次消息
    stamps.push(now);
    return { ok: true, reason: '' };
  }
}
