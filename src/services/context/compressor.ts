/**
 * LLM 摘要压缩器
 *
 * 当对话历史超出 Token 限制时，将旧轮次交由 LLM 生成结构化摘要，
 * 保留最近 ~15% token 的精确上下文。
 */

import { estimateTokens, estimateMessagesTokens } from '../../utils/tokenEstimator';

export interface SummaryResult {
  /** 摘要文本 */
  summary: string;
  /** 摘要包含的消息索引范围 [start, end) */
  summarizedRange: [number, number];
  /** 保留的最近消息索引范围 [start, end) */
  retainedRange: [number, number];
}

/**
 * 构建摘要请求的 Prompt
 */
function buildSummaryPrompt(
  messages: Array<{ role: string; content: string }>,
  range: [number, number],
): string {
  const conversation = messages
    .slice(range[0], range[1])
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  return `请对以下对话历史生成一个结构化的摘要，保留关键信息：

${conversation}

要求：
- 保留重要的事实、偏好、决定和关键对话内容
- 忽略闲聊和重复内容
- 输出纯文本（不要 markdown）
- 长度不超过 500 字

摘要：`;
}

/**
 * LLM 摘要压缩器
 *
 * 将旧的对话轮次压缩为结构化摘要，保留最近的精确对话。
 *
 * @param messages - 完整对话消息列表
 * @param maxTokens - 最大允许的 token 数
 * @param summaryFn - 调用 LLM 生成摘要的函数（由外部注入）
 * @param preserveRecentRatio - 保留最近消息的比例（默认 0.15）
 * @returns 摘要结果，包含摘要文本和保留的消息范围
 */
export function planCompression(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  preserveRecentRatio = 0.15,
): SummaryResult | null {
  if (messages.length < 4) return null; // 太少消息不值得压缩

  const { tokens: totalTokens } = estimateMessagesTokens(messages);
  if (totalTokens <= maxTokens) return null; // 不需要压缩

  // 保留最近 preserveRecentRatio 比例的消息
  const recentTokenBudget = Math.floor(maxTokens * preserveRecentRatio);
  let recentCount = 0;
  let recentTokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateTokens(messages[i].content) + 4;
    if (recentTokens + t > recentTokenBudget) break;
    recentTokens += t;
    recentCount++;
  }

  const oldCount = messages.length - recentCount;
  if (oldCount <= 1) return null; // 旧消息太少，不值得压缩

  return {
    summary: '',
    summarizedRange: [0, oldCount],
    retainedRange: [oldCount, messages.length],
  };
}

/**
 * 调用 LLM 执行实际摘要
 */
export async function generateSummary(
  messages: Array<{ role: string; content: string }>,
  range: [number, number],
  summarizeFn: (prompt: string) => Promise<string>,
): Promise<string> {
  const prompt = buildSummaryPrompt(messages, range);
  try {
    const result = await summarizeFn(prompt);
    return result || '[无法生成摘要]';
  } catch {
    return '[摘要生成失败]';
  }
}

/**
 * 应用摘要到消息列表
 * 返回一个新的消息列表：system 消息 + 摘要消息 + 保留的最近消息
 */
export function applySummary(
  systemMessage: { role: string; content: string },
  summary: string,
  retainedMessages: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  const result = [systemMessage];
  if (summary) {
    result.push({ role: 'system', content: `[对话历史摘要]\n${summary}` });
  }
  result.push(...retainedMessages);
  return result;
}
