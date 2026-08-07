/**
 * 上下文压缩配置与类型
 */

export interface ContextConfig {
  /** 最大上下文窗口 token 数（默认 8000，适合大多数模型） */
  maxContextTokens: number;
  /** 压缩触发阈值（0-1，默认 0.82，即满 82% 时触发） */
  compressionThreshold: number;
  /** 轮次硬截断上限（0 = 不限制） */
  enforceMaxTurns: number;
  /** 是否启用 LLM 摘要压缩 */
  compressionEnabled: boolean;
}

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  maxContextTokens: 8000,
  compressionThreshold: 0.85,
  enforceMaxTurns: 30,
  compressionEnabled: true,
};

export interface CompressionResult {
  /** 压缩后的消息列表 */
  messages: Array<{ role: string; content: string }>;
  /** 是否执行了压缩 */
  compressed: boolean;
  /** 压缩前后的 token 数 */
  beforeTokens: number;
  afterTokens: number;
  /** 使用的压缩策略 */
  strategy: 'none' | 'turn_truncation' | 'halving' | 'llm_summarize';
}
