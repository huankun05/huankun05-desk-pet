/**
 * 内容安全检查：类型定义
 *
 * Strategy 模式 — 借鉴 AstrBot ContentSafetyCheckStage。
 * 每个策略实现 SafetyStrategy 接口，SafetyChecker 编排多策略 fail-fast。
 */

/** 安全检查结果 */
export interface SafetyCheckResult {
  ok: boolean;
  reason: string;
}

/** 安全策略接口 */
export interface SafetyStrategy {
  /** 检查内容是否安全 */
  check(content: string, sessionId?: string): SafetyCheckResult;
}

/** 内容安全配置 */
export interface SafetyConfig {
  /** 是否启用内容安全检查（总开关） */
  enabled: boolean;
  /** 是否同时检查 LLM 响应内容 */
  checkResponse: boolean;
  /** 关键词过滤策略 */
  keywords: {
    enabled: boolean;
    /** 正则表达式模式列表 */
    patterns: string[];
  };
  /** 输入长度限制 */
  lengthLimit: {
    enabled: boolean;
    /** 最大字符数 */
    maxLength: number;
  };
  /** 频率限制（滑动窗口） */
  rateLimit: {
    enabled: boolean;
    /** 窗口内最大消息数 */
    maxMessages: number;
    /** 窗口时长（秒） */
    windowSeconds: number;
  };
}

/** 默认配置 */
export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  enabled: false,
  checkResponse: false,
  keywords: {
    enabled: true,
    patterns: [],
  },
  lengthLimit: {
    enabled: true,
    maxLength: 4096,
  },
  rateLimit: {
    enabled: true,
    maxMessages: 20,
    windowSeconds: 60,
  },
};
