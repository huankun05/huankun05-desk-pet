/**
 * Memory Extractor — automatic structured memory extraction from conversations.
 *
 * Bilingual (中文 + English) rule-based extractor (no LLM dependency). Extracts
 * facts, preferences, and events from user+assistant message exchanges, then
 * deduplicates and merges them.
 *
 * 设计说明：
 * - M2「自动记忆抽取」的落地实现。规则式、零延迟、可离线，足以把「整条消息当文档」
 *   升级为「结构化事实/偏好/事件」，显著降低 BM25 噪声、提升中文召回。
 * - 可选 LLM 增强层见 `llm-enhancer.ts`：当 RAGEngine 启用 `llmEnhancementEnabled`
 *   且注入 LLM 回调时，把规则候选 + 对话交给对话模型补充 / 修正，再经
 *   `mergeExtractedMemories` 与规则结果去重合并。默认关闭，需用户在设置中开启。
 */

// ===== Types =====

export type MemoryEntryType = 'fact' | 'preference' | 'event';

export interface ExtractedMemory {
  id: string;
  type: MemoryEntryType;
  content: string;
  confidence: number; // 0-1
  source?: string;
  createdAt: number;
}

interface ExtractorConfig {
  /** Max characters per extracted memory */
  maxContentLength: number;
  /** Min confidence to keep */
  minConfidence: number;
  /** Enable dedup by normalized content */
  dedupEnabled: boolean;
}

const DEFAULT_CONFIG: ExtractorConfig = {
  maxContentLength: 300,
  minConfidence: 0.4,
  dedupEnabled: true,
};

// ===== Pattern Definitions =====
//
// captureGroup: 抽取内容取自第几个捕获组（默认 1；事件类用整句 match[0]）。

const CJK = '\\u4e00-\\u9fa5';
const CN_NAME = `[${CJK}A-Za-z·]+`;
const CN_WORD = `[${CJK}A-Za-z0-9]+`;

interface PatternDef {
  pattern: RegExp;
  weight: number;
  /** 事件类用整句（0），事实/偏好用主捕获组（1） */
  captureGroup?: number;
}

// --- 英文事实 ---
const EN_FACT_PATTERNS: PatternDef[] = [
  { pattern: /\b(i am|i'm)\s+(a|an|the)\s+([\w\s]+?)(?:\.|,|!|$)/i, weight: 0.85 },
  { pattern: /\bmy name is\s+([\w\s]+?)(?:\.|,|!|$)/i, weight: 0.95 },
  { pattern: /\bi live in\s+([\w\s]+?)(?:\.|,|!|$)/i, weight: 0.9 },
  { pattern: /\bi work(?:ed)? at\s+([\w\s]+?)(?:\.|,|!|$)/i, weight: 0.9 },
  { pattern: /\bi study(?:ied)? at\s+([\w\s]+?)(?:\.|,|!|$)/i, weight: 0.9 },
  { pattern: /\bi have (?:a|an|the)\s+([\w\s]+?)(?:\.|,|!|$)/i, weight: 0.8 },
  { pattern: /\bi'm (?:a|an|the)\s+([\w\s]+?)(?:\.|,|!|$)/i, weight: 0.85 },
  {
    pattern: /\bmy (?:birthday|age|phone number|email|address) is\s+([\w\s@.,-]+?)(?:\.|,|!|$)/i,
    weight: 0.9,
  },
];

// --- 中文事实 ---
const CN_FACT_PATTERNS: PatternDef[] = [
  { pattern: new RegExp(`我叫(${CN_NAME})`, 'u'), weight: 0.95 }, // 我叫小明
  { pattern: new RegExp(`我是(${CN_NAME}?)(?:[。，,!！?？]|$)`), weight: 0.85 }, // 我是学生
  { pattern: new RegExp(`我住在?(${CN_WORD}?)(?:[。，,!！?？]|$)`), weight: 0.9 }, // 我住北京
  { pattern: new RegExp(`我生活(?:在)?(${CN_WORD}?)(?:[。，,!！?？]|$)`), weight: 0.85 },
  {
    pattern: new RegExp(`我在(${CN_NAME}[${CJK}A-Za-z·&0-9]*?)(?:工作|上班|上学|读书|公司|学校)`),
    weight: 0.9,
  }, // 我在腾讯工作
  {
    pattern: new RegExp(
      `我的(生日|电话|手机号|手机|邮箱|微信|地址|年龄)是?([${CJK}A-Za-z0-9@.\\-]+)`,
    ),
    weight: 0.9,
  }, // 我的生日是...
  { pattern: new RegExp(`我有(${CN_WORD}?)(?:[。，,!！?？]|只|个|条|只|$)`), weight: 0.8 }, // 我有猫
  { pattern: new RegExp(`我(\\d+岁)`, 'u'), weight: 0.9 }, // 我18岁
];

// --- 英文偏好 ---
const EN_PREFERENCE_PATTERNS: PatternDef[] = [
  {
    pattern: /\bi (?:really\s+)?(?:like|love|enjoy|prefer)\s+([\w\s]+?)(?:\.|,|!|$)/i,
    weight: 0.9,
  },
  { pattern: /\bi don't like\s+([\w\s]+?)(?:\.|,|!|$)/i, weight: 0.85 },
  { pattern: /\bi hate\s+([\w\s]+?)(?:\.|,|!|$)/i, weight: 0.8 },
  { pattern: /\bmy favorite\s+([\w\s]+?)\s+(?:is|are)\s+([\w\s]+?)(?:\.|,|!|$)/i, weight: 0.9 },
  { pattern: /\bi'd rather\s+([\w\s]+?)(?:\.|,|!|$)/i, weight: 0.75 },
  { pattern: /\bi prefer\s+([\w\s]+?)(?:\.|,|!|$)/i, weight: 0.85 },
];

// --- 中文偏好 ---
const CN_PREFERENCE_PATTERNS: PatternDef[] = [
  {
    pattern: new RegExp(`我(?:真的)?(?:喜欢|爱|挺喜欢|超喜欢)(${CN_WORD}?)(?:[。，,!！?？]|$)`),
    weight: 0.9,
  },
  {
    pattern: new RegExp(`我(?:不(?:喜欢|爱)|讨厌|不喜欢)(${CN_WORD}?)(?:[。，,!！?？]|$)`),
    weight: 0.85,
  },
  { pattern: new RegExp(`我最喜欢(${CN_WORD}?)(?:[。，,!！?？]|$)`), weight: 0.9 },
  {
    pattern: new RegExp(`我(?:更)?(?:倾向|偏好|更喜欢)(${CN_WORD}?)(?:[。，,!！?？]|$)`),
    weight: 0.85,
  },
];

// --- 英文事件（整句） ---
const EN_EVENT_PATTERNS: PatternDef[] = [
  {
    pattern: /\b(?:yesterday|today|last week|last month|last year|this morning|this evening)\b.*/i,
    weight: 0.7,
    captureGroup: 0,
  },
  {
    pattern:
      /\bi (?:went to|visited|attended|finished|started|completed|launched|met|saw|tried)\s+([\w\s]+?)(?:\.|,|!|$)/i,
    weight: 0.75,
    captureGroup: 0,
  },
  { pattern: /\bi'm (?:going to|planning to|about to)\s+([\w\s]+?)(?:\.|,|!|$)/i, weight: 0.7 },
  {
    pattern: /\b(?:on|at|in)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*/i,
    weight: 0.65,
    captureGroup: 0,
  },
];

// --- 中文事件（整句） ---
const CN_EVENT_PATTERNS: PatternDef[] = [
  {
    pattern: new RegExp(
      `(?:昨天|今天|前天|上周|上个月|去年|这周|这个月|今年)(${CN_WORD}?)(?:[。，,!！?？]|$)`,
    ),
    weight: 0.7,
    captureGroup: 0,
  },
  {
    pattern: new RegExp(
      `我(?:去|去了|访问了?|参加了?|完成|了|开始|了|尝试了?|见到|了)(${CN_WORD}?)(?:[。，,!！?？]|$)`,
    ),
    weight: 0.75,
    captureGroup: 0,
  },
  {
    pattern: new RegExp(`我(?:要|打算|准备|计划)(?:去|做|了)?(${CN_WORD}?)(?:[。，,!！?？]|$)`),
    weight: 0.7,
    captureGroup: 0,
  },
  {
    pattern: new RegExp(
      `(?:周[一二三四五六日天]|星期一|星期二|星期三|星期四|星期五|星期六|星期日)(${CN_WORD}?)(?:[。，,!！?？]|$)`,
    ),
    weight: 0.65,
    captureGroup: 0,
  },
];

const FACT_PATTERNS = [...EN_FACT_PATTERNS, ...CN_FACT_PATTERNS];
const PREFERENCE_PATTERNS = [...EN_PREFERENCE_PATTERNS, ...CN_PREFERENCE_PATTERNS];
const EVENT_PATTERNS = [...EN_EVENT_PATTERNS, ...CN_EVENT_PATTERNS];

// ===== Helpers =====

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s.,!?;:()[\]{}<>/\\]+/g, ' ')
    .trim();
}

function generateId(type: MemoryEntryType, content: string): string {
  const hash = content.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return `${type}_${Date.now()}_${Math.abs(hash)}`;
}

/** 确保正则带全局标志，供 matchAll 使用（matchAll 强制要求 g）。 */
function globalOf(pattern: RegExp): RegExp {
  return pattern.global ? pattern : new RegExp(pattern.source, pattern.flags + 'g');
}

// ===== Extractor =====

export class MemoryExtractor {
  private config: ExtractorConfig;
  private seen = new Set<string>(); // normalized content dedup

  constructor(config: Partial<ExtractorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Extract structured memories from a user+assistant exchange.
   *
   * @param userText - user message
   * @param assistantText - assistant reply (optional)
   * @returns array of extracted memories
   */
  extractFromExchange(userText: string, assistantText?: string): ExtractedMemory[] {
    const combined = `${userText} ${assistantText ?? ''}`.trim();

    if (!combined || combined.length < 3) return [];

    // Extract from user text first (higher weight), then assistant
    const memories: ExtractedMemory[] = [];
    memories.push(...this.extractFromText(userText, 'user', 1.0));
    if (assistantText && assistantText.trim().length > 2) {
      memories.push(...this.extractFromText(assistantText, 'assistant', 0.7));
    }

    // Dedup + merge
    return this.dedup(memories);
  }

  /**
   * Extract from a single text string (bilingual, multi-match aware).
   */
  extractFromText(text: string, source: string, sourceWeight: number): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];

    for (const { pattern, weight, captureGroup = 1 } of FACT_PATTERNS) {
      const re = globalOf(pattern);
      for (const m of text.matchAll(re)) {
        const raw = (captureGroup === 0 ? m[0] : (m[captureGroup] ?? m[0])) as string;
        const content = this.cleanCapture(raw);
        if (content && content.length >= 1) {
          memories.push({
            id: generateId('fact', content),
            type: 'fact',
            content: content.slice(0, this.config.maxContentLength),
            confidence: Math.min(1, weight * sourceWeight),
            source,
            createdAt: Date.now(),
          });
        }
      }
    }

    for (const { pattern, weight, captureGroup = 1 } of PREFERENCE_PATTERNS) {
      const re = globalOf(pattern);
      for (const m of text.matchAll(re)) {
        const raw = (captureGroup === 0 ? m[0] : (m[captureGroup] ?? m[0])) as string;
        const content = this.cleanCapture(raw);
        if (content && content.length >= 1) {
          memories.push({
            id: generateId('preference', content),
            type: 'preference',
            content: content.slice(0, this.config.maxContentLength),
            confidence: Math.min(1, weight * sourceWeight),
            source,
            createdAt: Date.now(),
          });
        }
      }
    }

    for (const { pattern, weight, captureGroup = 0 } of EVENT_PATTERNS) {
      const re = globalOf(pattern);
      for (const m of text.matchAll(re)) {
        const raw = (captureGroup === 0 ? m[0] : (m[captureGroup] ?? m[0])) as string;
        const content = this.cleanCapture(raw);
        if (content && content.length >= 2) {
          memories.push({
            id: generateId('event', content),
            type: 'event',
            content: content.slice(0, this.config.maxContentLength),
            confidence: Math.min(1, weight * sourceWeight),
            source,
            createdAt: Date.now(),
          });
        }
      }
    }

    return memories;
  }

  /**
   * Deduplicate memories by normalized content.
   * If duplicates found, keep the one with higher confidence.
   */
  private dedup(memories: ExtractedMemory[]): ExtractedMemory[] {
    if (!this.config.dedupEnabled) return memories;

    const map = new Map<string, ExtractedMemory>();

    for (const m of memories) {
      if (m.confidence < this.config.minConfidence) continue;

      const key = normalize(m.content);
      if (this.seen.has(key)) continue;

      const existing = map.get(key);
      if (!existing || m.confidence > existing.confidence) {
        map.set(key, m);
      }
      this.seen.add(key);
    }

    return [...map.values()];
  }

  /**
   * Clean captured group: trim, remove leading articles/fillers and trailing particles.
   */
  private cleanCapture(raw: string): string {
    return raw
      .replace(/^(a|an|the|to|at|in|on|for|with|about|from)\s+/i, '') // 英文冠词/介词，需后接空格
      .replace(/^[我就也还挺]+/u, '') // 中文主语/语气 filler
      .replace(/[了啊呢吧嘛哦呀哈]+$/u, '') // 中文句尾语气词
      .trim();
  }

  /**
   * Reset dedup state (call when loading new context).
   */
  reset(): void {
    this.seen.clear();
  }
}

/**
 * 合并多个来源的结构化记忆（规则 + LLM），按归一化内容去重，保留置信度更高者。
 * 纯函数，无内部状态，便于在 RAGEngine 中把规则候选与 LLM 增强结果合并。
 */
export function mergeExtractedMemories(list: ExtractedMemory[]): ExtractedMemory[] {
  const map = new Map<string, ExtractedMemory>();
  for (const m of list) {
    const key = normalize(m.content);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || m.confidence > existing.confidence) {
      map.set(key, m);
    }
  }
  return [...map.values()];
}

/**
 * Global extractor instance with default config.
 */
export const memoryExtractor = new MemoryExtractor();
