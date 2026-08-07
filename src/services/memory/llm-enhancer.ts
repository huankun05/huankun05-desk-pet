/**
 * LLM 增强记忆抽取层（可选，默认关闭）
 *
 * 配合 M2 规则抽取器使用：当启用时，把规则抽到的候选 + 原始对话交给对话模型，
 * 让其补充 / 修正为更高质量的结构化记忆（fact / preference / event），再与规则结果去重合并。
 *
 * 设计为依赖倒置：本模块不耦合任何具体 provider，只接收一个 `LLMCall`
 * （由调用方注入，通常来自 providerManager.getActiveChatProvider().chat）。
 * 这样可独立单测（用 mock LLMCall），也避免 extractor 与 provider 层耦合。
 */

import type { ExtractedMemory, MemoryEntryType } from './extractor';

/** 注入的 LLM 调用：给定 prompt 文本，返回模型输出文本。 */
export type LLMCall = (prompt: string) => Promise<string>;

export interface LLMEnhanceInput {
  userText: string;
  assistantText?: string;
  /** 规则抽取器已识别的候选，作为参考喂给模型 */
  ruleCandidates: ExtractedMemory[];
  /** 注入的 LLM 调用（依赖倒置，不在此处直接依赖 provider） */
  llmCall: LLMCall;
}

interface RawLLMItem {
  type?: unknown;
  content?: unknown;
  confidence?: unknown;
}

const SYSTEM_HINT =
  '你是桌面宠物助手的长期记忆抽取器。根据对话补充抽取值得长期记住的事实(fact)、偏好(preference)、事件(event)。只输出 JSON 数组，不要解释或代码块。';

function buildUserPrompt(
  userText: string,
  assistantText: string | undefined,
  ruleCandidates: ExtractedMemory[],
): string {
  const ruleJson = ruleCandidates.length
    ? JSON.stringify(
        ruleCandidates.map((m) => ({ type: m.type, content: m.content, confidence: m.confidence })),
        null,
        0,
      )
    : '（无）';
  const assistantPart = assistantText && assistantText.trim() ? assistantText : '（无）';
  return [
    '【已有规则抽取候选】（可能不全或有遗漏，供参考）',
    ruleJson,
    '',
    '【用户消息】',
    userText,
    '',
    '【助手回复】',
    assistantPart,
    '',
    '请输出 JSON 数组，每个元素格式：',
    '{"type":"fact"|"preference"|"event","content":"简短陈述(简体中文,≤30字,去掉主语我/用户)","confidence":0.0~1.0}',
    '只输出 JSON 数组本身。',
  ].join('\n');
}

/**
 * 调用 LLM 增强抽取。解析失败 / LLM 抛错时返回空数组（调用方会回退到规则结果）。
 */
export async function enhanceMemoriesWithLLM(input: LLMEnhanceInput): Promise<ExtractedMemory[]> {
  const { userText, assistantText, ruleCandidates, llmCall } = input;
  if (!userText.trim() && !(assistantText && assistantText.trim())) return [];

  const prompt = [SYSTEM_HINT, '', buildUserPrompt(userText, assistantText, ruleCandidates)].join(
    '\n',
  );
  let raw: string;
  try {
    raw = await llmCall(prompt);
  } catch {
    return [];
  }
  return parseLLMItems(raw);
}

function parseLLMItems(raw: string): ExtractedMemory[] {
  if (!raw) return [];
  // 去掉 markdown 代码块围栏
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) text = fenceMatch[1].trim();
  // 截取第一个 [ 到最后一个 ]
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  const jsonStr = text.slice(start, end + 1);

  let arr: unknown;
  try {
    arr = JSON.parse(jsonStr);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const out: ExtractedMemory[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const it = item as RawLLMItem;
    const type = it.type;
    const content = typeof it.content === 'string' ? it.content.trim() : '';
    if (type !== 'fact' && type !== 'preference' && type !== 'event') continue;
    if (!content) continue;
    const conf = typeof it.confidence === 'number' ? Math.max(0, Math.min(1, it.confidence)) : 0.6;
    out.push({
      id: `${type}_llm_${Date.now()}_${out.length}_${Math.abs(
        content.split('').reduce((a, c) => a + c.charCodeAt(0), 0),
      )}`,
      type: type as MemoryEntryType,
      content: content.slice(0, 300),
      confidence: conf,
      source: 'llm',
      createdAt: Date.now(),
    });
  }
  return out;
}
