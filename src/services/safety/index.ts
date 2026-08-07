/**
 * SafetyChecker — 内容安全编排器
 *
 * 管理多个 SafetyStrategy 实例，fail-fast 迭代检查。
 * 导出单例 safetyChecker，供 Pipeline Stage 和管理面板使用。
 */

import type { SafetyConfig, SafetyCheckResult, SafetyStrategy } from './types';
import { DEFAULT_SAFETY_CONFIG } from './types';
import { KeywordsStrategy, LengthLimitStrategy, RateLimitStrategy } from './strategies';

class SafetyChecker {
  private config: SafetyConfig;
  private strategies: SafetyStrategy[] = [];

  private keywordsStrategy: KeywordsStrategy | null = null;
  private lengthStrategy: LengthLimitStrategy | null = null;
  private rateLimitStrategy: RateLimitStrategy | null = null;

  constructor() {
    this.config = { ...DEFAULT_SAFETY_CONFIG };
    this.rebuild();
  }

  /** 根据配置重建策略列表 */
  private rebuild(): void {
    this.strategies = [];

    if (this.config.lengthLimit.enabled) {
      if (!this.lengthStrategy) {
        this.lengthStrategy = new LengthLimitStrategy(this.config.lengthLimit);
      } else {
        this.lengthStrategy.reload(this.config.lengthLimit);
      }
      this.strategies.push(this.lengthStrategy);
    }

    if (this.config.keywords.enabled) {
      if (!this.keywordsStrategy) {
        this.keywordsStrategy = new KeywordsStrategy(this.config.keywords);
      } else {
        this.keywordsStrategy.reload(this.config.keywords);
      }
      this.strategies.push(this.keywordsStrategy);
    }

    if (this.config.rateLimit.enabled) {
      if (!this.rateLimitStrategy) {
        this.rateLimitStrategy = new RateLimitStrategy(this.config.rateLimit);
      } else {
        this.rateLimitStrategy.reload(this.config.rateLimit);
      }
      this.strategies.push(this.rateLimitStrategy);
    }
  }

  /** 热更新配置（管理面板修改后调用） */
  reloadConfig(config: SafetyConfig): void {
    this.config = config;
    this.rebuild();
  }

  /** 获取当前配置 */
  getConfig(): SafetyConfig {
    return this.config;
  }

  /** 是否启用安全检查 */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /** 是否需要检查 LLM 响应 */
  shouldCheckResponse(): boolean {
    return this.config.enabled && this.config.checkResponse;
  }

  /**
   * 执行安全检查（fail-fast）
   *
   * 依次执行所有启用的策略，任一失败立即返回。
   */
  check(content: string, sessionId?: string): SafetyCheckResult {
    if (!this.config.enabled) {
      return { ok: true, reason: '' };
    }

    for (const strategy of this.strategies) {
      const result = strategy.check(content, sessionId);
      if (!result.ok) {
        return result;
      }
    }

    return { ok: true, reason: '' };
  }
}

/** 全局单例 */
export const safetyChecker = new SafetyChecker();
