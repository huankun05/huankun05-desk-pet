/**
 * usageLedger：LLM / 视觉调用成本账本（借鉴 Miru 的 llm_usage.jsonl）
 *
 * 每次 Chat / Vision 调用都记一笔：tier / model / callLabel / 输入输出量 /
 * 是否缓存命中。用于回答「今天烧了多少」这一类问题，避免盲飞。
 *
 * 说明：
 * - provider 回传真实 token 用量（lastUsage）时记录 promptTokens /
 *   completionTokens；否则以字符数（promptChars / completionChars）作代理。
 *   报表优先展示 token，缺失时展示字符并注明"估算"。
 * - 持久化用 localStorage 环形缓冲（上限 1000 条），避免无限增长；
 *   如需落盘到 data/ 目录可改为 Tauri fs 写入。
 */

const STORAGE_KEY = 'deskpet_llm_usage';
const MAX_ENTRIES = 1000;

export interface UsageEntry {
  /** ISO 时间戳 */
  ts: string;
  /** 调用层级：chat / vision / tts / stt / embedding */
  tier: string;
  /** 模型名 */
  model: string;
  /** 调用标签：chat / chat_stream / vision_watch ... */
  callLabel: string;
  /** 输入字符数（无真实 token 时的代理指标） */
  promptChars: number;
  /** 输出字符数（无真实 token 时的代理指标） */
  completionChars: number;
  /** 输入 token 数（provider 回传 usage 时才有） */
  promptTokens?: number;
  /** 输出 token 数（provider 回传 usage 时才有） */
  completionTokens?: number;
  /** 是否命中缓存（预留，当前 provider 未回传） */
  cacheHit?: boolean;
}

export function recordUsage(entry: Omit<UsageEntry, 'ts'>): void {
  try {
    const full: UsageEntry = { ts: new Date().toISOString(), ...entry };
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr: UsageEntry[] = raw ? (JSON.parse(raw) as UsageEntry[]) : [];
    arr.push(full);
    if (arr.length > MAX_ENTRIES) arr.splice(0, arr.length - MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    /* 账本写入失败不应影响主流程 */
  }
}

export interface UsageSummary {
  today: {
    calls: number;
    promptChars: number;
    completionChars: number;
    promptTokens: number;
    completionTokens: number;
    /** 含真实 token 的调用占比（0-1），0 = 全部是字符估算 */
    tokenCoverage: number;
  };
  total: number;
}

export function getUsageSummary(): UsageSummary {
  try {
    const arr = readEntries();
    const today = new Date().toISOString().slice(0, 10);
    const todays = arr.filter((e) => e.ts.slice(0, 10) === today);
    const withTokens = todays.filter((e) => e.promptTokens !== undefined);
    return {
      today: {
        calls: todays.length,
        promptChars: todays.reduce((s, e) => s + e.promptChars, 0),
        completionChars: todays.reduce((s, e) => s + e.completionChars, 0),
        promptTokens: todays.reduce((s, e) => s + (e.promptTokens ?? 0), 0),
        completionTokens: todays.reduce((s, e) => s + (e.completionTokens ?? 0), 0),
        tokenCoverage: todays.length > 0 ? withTokens.length / todays.length : 0,
      },
      total: arr.length,
    };
  } catch {
    return {
      today: {
        calls: 0,
        promptChars: 0,
        completionChars: 0,
        promptTokens: 0,
        completionTokens: 0,
        tokenCoverage: 0,
      },
      total: 0,
    };
  }
}

/** 读取全部账本条目（按时间升序，供用量报表页使用） */
export function getUsageEntries(): UsageEntry[] {
  try {
    return readEntries();
  } catch {
    return [];
  }
}

function readEntries(): UsageEntry[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as UsageEntry[]) : [];
}

/** 估算消息列表的总字符数（用作 prompt tokens 代理） */
export function estimateChars(text: string | null | undefined): number {
  return text ? text.length : 0;
}
