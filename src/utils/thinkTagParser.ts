/**
 * think 标签解析器
 *
 * 解析 AI 回复中的 <think>...</think> 标签，
 * 将其分离为文本段和内心独白段。
 */

export interface ParsedSegment {
  type: 'text' | 'think';
  content: string;
}

/**
 * 解析 <think> 标签
 *
 * @example
 * parseThinkTags("<think>脸红了一下</think>哈哈，才没有呢！")
 * // → [
 * //   { type: "think", content: "脸红了一下" },
 * //   { type: "text", content: "哈哈，才没有呢！" }
 * // ]
 */
export function parseThinkTags(raw: string): ParsedSegment[] {
  if (!raw) return [{ type: 'text', content: '' }];

  const segments: ParsedSegment[] = [];
  const regex = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    // match 前面的文本
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: raw.slice(lastIndex, match.index),
      });
    }
    // think 标签内容
    segments.push({
      type: 'think',
      content: match[1],
    });
    lastIndex = match.index + match[0].length;
  }

  // 剩余文本
  if (lastIndex < raw.length) {
    segments.push({
      type: 'text',
      content: raw.slice(lastIndex),
    });
  }

  // 如果没有任何匹配，返回原始文本
  if (segments.length === 0) {
    segments.push({ type: 'text', content: raw });
  }

  return segments;
}

/**
 * 只获取可朗读的文本（排除 think 标签内容）
 */
export function getSpeakableText(segments: ParsedSegment[]): string {
  return segments
    .filter((s) => s.type === 'text')
    .map((s) => s.content)
    .join('');
}

/**
 * 获取显示文本（think 内容转为括号形式）
 */
export function getDisplayText(segments: ParsedSegment[]): string {
  return segments.map((s) => (s.type === 'think' ? `（${s.content}）` : s.content)).join('');
}
