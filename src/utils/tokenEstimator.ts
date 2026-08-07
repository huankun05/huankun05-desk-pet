/**
 * Token 估算器 — 零 API 开销的本地 Token 计数
 *
 * 字符级估算：
 * - 中文字符 ≈ 0.6 token
 * - 其他字符 ≈ 0.3 token
 * - 图片 ≈ 765 tokens
 * - 音频 ≈ 500 tokens
 */

export interface TokenEstimate {
  /** 估算的 token 数 */
  tokens: number;
  /** 估算的字符数 */
  chars: number;
}

/** 单条消息估算 token */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(ch)) {
      tokens += 0.6;
    } else {
      tokens += 0.3;
    }
  }
  return Math.ceil(tokens);
}

/** 估算多条消息的总 token 数 */
export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string }>,
): TokenEstimate {
  let totalChars = 0;
  let totalTokens = 0;
  for (const msg of messages) {
    totalChars += msg.content.length;
    totalTokens += estimateTokens(msg.content);
    // 每条消息的角色标记附加 ~4 tokens (role + formatting)
    totalTokens += 4;
  }
  return { tokens: totalTokens, chars: totalChars };
}

/** 获取当前 token 使用率 */
export function getTokenUsageRate(currentTokens: number, maxTokens: number): number {
  if (maxTokens <= 0) return 0;
  return currentTokens / maxTokens;
}

/** 当前 token 是否超出阈值 */
export function isOverThreshold(
  currentTokens: number,
  maxTokens: number,
  threshold = 0.82,
): boolean {
  return getTokenUsageRate(currentTokens, maxTokens) > threshold;
}
