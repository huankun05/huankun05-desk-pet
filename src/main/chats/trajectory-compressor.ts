/**
 * Trajectory 压缩模块（移植 Hermes trajectory_compressor.py）
 *
 * 对已完成 Agent 会话的轨迹做后处理压缩，把总 token 控制在目标预算内，
 * 同时尽量保留训练/评测信号质量。
 *
 * 压缩策略：
 * 1. 保护头部轮次（首个 system / user / assistant / tool）
 * 2. 保护尾部 N 轮（最终动作与结论）
 * 3. 只压缩中部的可压缩区间（从第 2 个工具响应之后开始）
 * 4. 只压缩到恰好满足预算为止，不多压
 * 5. 把被压缩区间替换为单条 human 摘要消息（[CONTEXT SUMMARY]: 前缀）
 * 6. 剩余轮次原样保留（模型在摘要后继续工作）
 *
 * 与 llm-reviewer / skill-creation 同模式：LLM 摘要调用抽象为 SummarizeFn，
 * 由调用方注入（默认通过 llm-client.chatNonStream 包装），不依赖具体模型客户端；
 * 未注入时压缩仍可用，生成确定性占位摘要（便于离线流水线与单测）。
 *
 * 输入输出均复用 trajectory-exporter 的 TrajectoryTurn 结构：
 * 导出器产出 → 本模块压缩 → 导出器写出（见 exportTrajectoryCompressed）。
 */

import type { TrajectoryTurn } from "./trajectory-exporter";

/** LLM 摘要函数：输入摘要提示词，返回摘要文本。 */
export type SummarizeFn = (prompt: string) => Promise<string>;

export interface CompressionConfig {
  /** 压缩目标：总 token 超过该值才压缩 */
  targetMaxTokens: number;
  /** 摘要目标 token 数（提示词中引导，非硬约束） */
  summaryTargetTokens: number;
  /** 保护首个 system / user / assistant / tool 轮次 */
  protectFirstSystem: boolean;
  protectFirstHuman: boolean;
  protectFirstAssistant: boolean;
  protectFirstTool: boolean;
  /** 保护末尾 N 轮 */
  protectLastNTurns: number;
  /** 摘要模型温度（仅语义记录，注入方决定是否生效） */
  temperature?: number;
  /** 摘要 API 重试次数 */
  maxRetries: number;
  /** 重试基础延迟（毫秒，指数退避） */
  retryDelayMs: number;
  /** 是否给 system 消息追加摘要提示 */
  addSummaryNotice: boolean;
  summaryNoticeText: string;
  /** 批量处理时，低于目标的轨迹是否直接跳过（不产出） */
  skipUnderTarget: boolean;
  /** 批量处理时，压缩后仍超限的轨迹是否保留产出 */
  saveOverLimit: boolean;
  /** token 计数函数（可注入；默认 CJK 感知的轻量估算） */
  countTokens: (text: string) => number;
  /** LLM 摘要函数；未注入时使用确定性占位摘要 */
  summarize?: SummarizeFn;
}

/** 轻量 token 估算：CJK 字符约 1 token，其余约 4 字符/token（对齐 Hermes 回退 len/4，适配中文）。 */
export function countTokensCjkAware(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  for (const ch of text) {
    tokens += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 1 : 0.25;
  }
  return Math.ceil(tokens);
}

export function defaultCompressionConfig(overrides: Partial<CompressionConfig> = {}): CompressionConfig {
  return {
    targetMaxTokens: 15250,
    summaryTargetTokens: 750,
    protectFirstSystem: true,
    protectFirstHuman: true,
    protectFirstAssistant: true,
    protectFirstTool: true,
    protectLastNTurns: 4,
    temperature: 0.3,
    maxRetries: 3,
    retryDelayMs: 2000,
    addSummaryNotice: true,
    summaryNoticeText: "\n\nSome of your previous tool responses may be summarized to preserve context.",
    skipUnderTarget: true,
    saveOverLimit: true,
    countTokens: countTokensCjkAware,
    ...overrides,
  };
}

export interface TrajectoryMetrics {
  originalTokens: number;
  compressedTokens: number;
  tokensSaved: number;
  compressionRatio: number;
  originalTurns: number;
  compressedTurns: number;
  turnsRemoved: number;
  turnsCompressedStartIdx: number;
  turnsCompressedEndIdx: number;
  turnsInCompressedRegion: number;
  wasCompressed: boolean;
  stillOverLimit: boolean;
  skippedUnderTarget: boolean;
  summarizationApiCalls: number;
  summarizationErrors: number;
  /** 摘要是否走了降级路径（未注入摘要函数或 LLM 失败） */
  summarizationFallback: boolean;
}

export function emptyTrajectoryMetrics(): TrajectoryMetrics {
  return {
    originalTokens: 0,
    compressedTokens: 0,
    tokensSaved: 0,
    compressionRatio: 1,
    originalTurns: 0,
    compressedTurns: 0,
    turnsRemoved: 0,
    turnsCompressedStartIdx: -1,
    turnsCompressedEndIdx: -1,
    turnsInCompressedRegion: 0,
    wasCompressed: false,
    stillOverLimit: false,
    skippedUnderTarget: false,
    summarizationApiCalls: 0,
    summarizationErrors: 0,
    summarizationFallback: false,
  };
}

export function trajectoryMetricsToDict(m: TrajectoryMetrics): Record<string, unknown> {
  return {
    original_tokens: m.originalTokens,
    compressed_tokens: m.compressedTokens,
    tokens_saved: m.tokensSaved,
    compression_ratio: Math.round(m.compressionRatio * 10000) / 10000,
    original_turns: m.originalTurns,
    compressed_turns: m.compressedTurns,
    turns_removed: m.turnsRemoved,
    compression_region: {
      start_idx: m.turnsCompressedStartIdx,
      end_idx: m.turnsCompressedEndIdx,
      turns_count: m.turnsInCompressedRegion,
    },
    was_compressed: m.wasCompressed,
    still_over_limit: m.stillOverLimit,
    skipped_under_target: m.skippedUnderTarget,
    summarization_api_calls: m.summarizationApiCalls,
    summarization_errors: m.summarizationErrors,
    summarization_fallback: m.summarizationFallback,
  };
}

export interface AggregateMetrics {
  totalTrajectories: number;
  trajectoriesCompressed: number;
  trajectoriesSkippedUnderTarget: number;
  trajectoriesStillOverLimit: number;
  trajectoriesFailed: number;
  totalTokensBefore: number;
  totalTokensAfter: number;
  totalTokensSaved: number;
  totalTurnsBefore: number;
  totalTurnsAfter: number;
  totalTurnsRemoved: number;
  totalSummarizationCalls: number;
  totalSummarizationErrors: number;
  compressionRatios: number[];
  tokensSavedList: number[];
  turnsRemovedList: number[];
}

export function emptyAggregateMetrics(): AggregateMetrics {
  return {
    totalTrajectories: 0,
    trajectoriesCompressed: 0,
    trajectoriesSkippedUnderTarget: 0,
    trajectoriesStillOverLimit: 0,
    trajectoriesFailed: 0,
    totalTokensBefore: 0,
    totalTokensAfter: 0,
    totalTokensSaved: 0,
    totalTurnsBefore: 0,
    totalTurnsAfter: 0,
    totalTurnsRemoved: 0,
    totalSummarizationCalls: 0,
    totalSummarizationErrors: 0,
    compressionRatios: [],
    tokensSavedList: [],
    turnsRemovedList: [],
  };
}

export function addTrajectoryMetrics(agg: AggregateMetrics, m: TrajectoryMetrics): void {
  agg.totalTrajectories += 1;
  agg.totalTokensBefore += m.originalTokens;
  agg.totalTokensAfter += m.compressedTokens;
  agg.totalTokensSaved += m.tokensSaved;
  agg.totalTurnsBefore += m.originalTurns;
  agg.totalTurnsAfter += m.compressedTurns;
  agg.totalTurnsRemoved += m.turnsRemoved;
  agg.totalSummarizationCalls += m.summarizationApiCalls;
  agg.totalSummarizationErrors += m.summarizationErrors;

  if (m.wasCompressed) {
    agg.trajectoriesCompressed += 1;
    agg.compressionRatios.push(m.compressionRatio);
    agg.tokensSavedList.push(m.tokensSaved);
    agg.turnsRemovedList.push(m.turnsRemoved);
  }
  if (m.skippedUnderTarget) agg.trajectoriesSkippedUnderTarget += 1;
  if (m.stillOverLimit) agg.trajectoriesStillOverLimit += 1;
}

export function aggregateMetricsToDict(agg: AggregateMetrics): Record<string, unknown> {
  const avg = (arr: number[]): number => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const avgRatio = agg.compressionRatios.length ? avg(agg.compressionRatios) : 1;
  return {
    summary: {
      total_trajectories: agg.totalTrajectories,
      trajectories_compressed: agg.trajectoriesCompressed,
      trajectories_skipped_under_target: agg.trajectoriesSkippedUnderTarget,
      trajectories_still_over_limit: agg.trajectoriesStillOverLimit,
      trajectories_failed: agg.trajectoriesFailed,
      compression_rate: Math.round((agg.trajectoriesCompressed / Math.max(agg.totalTrajectories, 1)) * 10000) / 10000,
    },
    tokens: {
      total_before: agg.totalTokensBefore,
      total_after: agg.totalTokensAfter,
      total_saved: agg.totalTokensSaved,
      overall_compression_ratio:
        Math.round((agg.totalTokensAfter / Math.max(agg.totalTokensBefore, 1)) * 10000) / 10000,
    },
    turns: {
      total_before: agg.totalTurnsBefore,
      total_after: agg.totalTurnsAfter,
      total_removed: agg.totalTurnsRemoved,
    },
    averages: {
      avg_compression_ratio: Math.round(avgRatio * 10000) / 10000,
      avg_tokens_saved_per_compressed: Math.round(avg(agg.tokensSavedList) * 10) / 10,
      avg_turns_removed_per_compressed: Math.round(avg(agg.turnsRemovedList) * 100) / 100,
    },
    summarization: {
      total_api_calls: agg.totalSummarizationCalls,
      total_errors: agg.totalSummarizationErrors,
      success_rate:
        Math.round((1 - agg.totalSummarizationErrors / Math.max(agg.totalSummarizationCalls, 1)) * 10000) / 10000,
    },
  };
}

/**
 * 找出受保护轮次的索引，并确定可压缩区间 [compressibleStart, compressibleEnd)。
 *
 * 规则（对齐 Hermes）：
 * - 每个角色首个出现的位置入保护集（可按配置关闭）
 * - 末尾 protectLastNTurns 轮入保护集
 * - 以 n/2 为界区分头/尾保护，可压缩区间 = 头保护最大索引 + 1 起，到尾保护最小索引止
 */
export function findProtectedIndices(
  turns: TrajectoryTurn[],
  config: CompressionConfig,
): { protectedSet: Set<number>; compressibleStart: number; compressibleEnd: number } {
  const n = turns.length;
  const protectedSet = new Set<number>();
  let firstSystem: number | null = null;
  let firstHuman: number | null = null;
  let firstAssistant: number | null = null;
  let firstTool: number | null = null;

  for (let i = 0; i < n; i++) {
    const role = turns[i].role;
    if (role === "system" && firstSystem === null) firstSystem = i;
    else if (role === "user" && firstHuman === null) firstHuman = i;
    else if (role === "assistant" && firstAssistant === null) firstAssistant = i;
    else if (role === "tool" && firstTool === null) firstTool = i;
  }

  if (config.protectFirstSystem && firstSystem !== null) protectedSet.add(firstSystem);
  if (config.protectFirstHuman && firstHuman !== null) protectedSet.add(firstHuman);
  if (config.protectFirstAssistant && firstAssistant !== null) protectedSet.add(firstAssistant);
  if (config.protectFirstTool && firstTool !== null) protectedSet.add(firstTool);

  for (let i = Math.max(0, n - config.protectLastNTurns); i < n; i++) protectedSet.add(i);

  const headProtected: number[] = [];
  const tailProtected: number[] = [];
  for (const i of protectedSet) {
    if (i < n / 2) headProtected.push(i);
    else tailProtected.push(i);
  }

  const compressibleStart = headProtected.length ? Math.max(...headProtected) + 1 : 0;
  const compressibleEnd = tailProtected.length ? Math.min(...tailProtected) : n;

  return { protectedSet, compressibleStart, compressibleEnd };
}

/**
 * 边界是否干净：不会把 tool 轮与其所属 assistant 轮拆开。
 *
 * 在 from/value 格式中，tool 轮（携带 <tool_response>）总是紧跟产生它的 gpt 轮；
 * 落在 tool 轮上的边界会把一对调用/响应拆散。边界只有在轨迹末尾或落在非 tool 轮上才干净。
 * Cyrene 的 tool 调用内嵌在 assistant 轮中，但保留同样的防御语义。
 */
export function isBoundaryClean(turns: TrajectoryTurn[], idx: number): boolean {
  return idx >= turns.length || turns[idx].role !== "tool";
}

/**
 * 把压缩边界挪到最近的干净轮次边界上。
 * 优先前移（把被孤立的 tool 轮并入已持有其 assistant 轮的区间）；
 * 前向无干净边界（如受保护尾部本身从 tool 轮开始）则回退，结果钳制在 [minIdx, maxIdx]。
 */
export function snapBoundary(turns: TrajectoryTurn[], idx: number, minIdx: number, maxIdx: number): number {
  let forward = idx;
  while (forward < maxIdx && !isBoundaryClean(turns, forward)) forward += 1;
  if (isBoundaryClean(turns, forward)) return forward;
  let backward = idx;
  while (backward > minIdx && !isBoundaryClean(turns, backward)) backward -= 1;
  return backward;
}

/**
 * 抽取 [start, end) 区间轮次内容，格式化为供摘要提示词使用的文本。
 * 超长值截断（对齐 Hermes：超 3000 字符 → 头 1500 + 尾 500）。
 */
export function extractTurnContentForSummary(turns: TrajectoryTurn[], start: number, end: number): string {
  const parts: string[] = [];
  for (let i = start; i < end; i++) {
    const turn = turns[i];
    const role = turn.role || "unknown";
    let value = turn.content ?? "";
    if (value.length > 3000) {
      value = value.slice(0, 1500) + "\n...[truncated]...\n" + value.slice(-500);
    }
    parts.push(`[Turn ${i} - ${role.toUpperCase()}]:\n${value}`);
  }
  return parts.join("\n\n");
}

/** 构建摘要提示词（对齐 Hermes，英文保持训练数据一致性）。 */
export function buildSummaryPrompt(content: string, summaryTargetTokens: number): string {
  return `Summarize the following agent conversation turns concisely. This summary will replace these turns in the conversation history.

Write the summary from a neutral perspective describing what the assistant did and learned. Include:
1. What actions the assistant took (tool calls, searches, file operations)
2. Key information or results obtained
3. Any important decisions or findings
4. Relevant data, file names, values, or outputs

Keep the summary factual and informative. Target approximately ${summaryTargetTokens} tokens.

---
TURNS TO SUMMARIZE:
${content}
---

Write only the summary, starting with "[CONTEXT SUMMARY]:" prefix.`;
}

/** 规范化模型输出为安全字符串。 */
export function coerceSummaryContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  return content ? String(content).trim() : "";
}

/** 确保摘要带且只带一次 [CONTEXT SUMMARY]: 前缀。 */
export function ensureSummaryPrefix(summary: string): string {
  const text = (summary || "").trim();
  if (text.startsWith("[CONTEXT SUMMARY]:")) return text;
  return "[CONTEXT SUMMARY]:" + (text ? ` ${text}` : "");
}

const SUMMARY_FALLBACK_TEXT =
  "[CONTEXT SUMMARY]: [Summary generation failed - previous turns contained tool calls and responses that have been compressed to save context space.]";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 生成摘要。带重试（指数退避）；无注入摘要函数或重试耗尽时降级为占位摘要。
 */
export async function generateSummary(
  content: string,
  config: CompressionConfig,
  metrics: TrajectoryMetrics,
): Promise<string> {
  const prompt = buildSummaryPrompt(content, config.summaryTargetTokens);
  if (!config.summarize) {
    metrics.summarizationFallback = true;
    return "[CONTEXT SUMMARY]: [Summary generation unavailable - compressed turns are omitted to fit the target context budget.]";
  }
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      metrics.summarizationApiCalls += 1;
      const raw = await config.summarize(prompt);
      return ensureSummaryPrefix(coerceSummaryContent(raw));
    } catch {
      metrics.summarizationErrors += 1;
      if (attempt < config.maxRetries - 1) {
        await sleep(Math.min(30000, config.retryDelayMs * 2 ** attempt) + Math.floor(Math.random() * 500));
      }
    }
  }
  metrics.summarizationFallback = true;
  return SUMMARY_FALLBACK_TEXT;
}

export interface CompressedTrajectory {
  turns: TrajectoryTurn[];
  metrics: TrajectoryMetrics;
}

/**
 * 压缩单条轨迹以适配目标 token 预算（异步版，摘要走注入的 summarize）。
 *
 * 算法（对齐 Hermes compress_trajectory）：
 * 1. 统计每轮 token 与总 token
 * 2. 低于目标 → 跳过
 * 3. 找出受保护头部/尾部之间的可压缩区间
 * 4. 需要省下的 token = 总 token - 目标；需压入的 token = 省下量 + 摘要目标
 * 5. 从区间起点累加轮次直到省下量满足
 * 6. 不够时压缩整个区间；边界做 tool 配对完整性修正
 * 7. 生成摘要 → 头部 + 单条 user 摘要 + 尾部
 */
export async function compressTrajectory(
  turns: TrajectoryTurn[],
  config: CompressionConfig = defaultCompressionConfig(),
): Promise<CompressedTrajectory> {
  const metrics = emptyTrajectoryMetrics();
  metrics.originalTurns = turns.length;

  const turnTokens = turns.map((t) => config.countTokens(t.content ?? ""));
  const totalTokens = turnTokens.reduce((a, b) => a + b, 0);
  metrics.originalTokens = totalTokens;

  if (totalTokens <= config.targetMaxTokens) {
    metrics.skippedUnderTarget = true;
    metrics.compressedTokens = totalTokens;
    metrics.compressedTurns = turns.length;
    metrics.compressionRatio = 1;
    return { turns, metrics };
  }

  const { compressibleStart: rawStart, compressibleEnd } = findProtectedIndices(turns, config);

  // 头部边界修正：可压缩区间不能从孤立的 tool 轮开始
  const compressStart = snapBoundary(turns, rawStart, rawStart, compressibleEnd);

  if (compressStart >= compressibleEnd) {
    metrics.compressedTokens = totalTokens;
    metrics.compressedTurns = turns.length;
    metrics.stillOverLimit = totalTokens > config.targetMaxTokens;
    return { turns, metrics };
  }

  const tokensToSave = totalTokens - config.targetMaxTokens;
  const targetTokensToCompress = tokensToSave + config.summaryTargetTokens;

  let accumulated = 0;
  let compressUntil = compressStart;
  for (let i = compressStart; i < compressibleEnd; i++) {
    accumulated += turnTokens[i];
    compressUntil = i + 1;
    if (accumulated >= targetTokensToCompress) break;
  }

  if (accumulated < targetTokensToCompress && compressUntil < compressibleEnd) {
    compressUntil = compressibleEnd;
    accumulated = turnTokens.slice(compressStart, compressibleEnd).reduce((a, b) => a + b, 0);
  }

  // 尾部边界修正：不能切断 tool 调用/响应配对
  compressUntil = snapBoundary(turns, compressUntil, compressStart, compressibleEnd);
  if (compressUntil <= compressStart) {
    metrics.compressedTokens = totalTokens;
    metrics.compressedTurns = turns.length;
    metrics.stillOverLimit = totalTokens > config.targetMaxTokens;
    return { turns, metrics };
  }

  metrics.turnsCompressedStartIdx = compressStart;
  metrics.turnsCompressedEndIdx = compressUntil;
  metrics.turnsInCompressedRegion = compressUntil - compressStart;

  const contentToSummarize = extractTurnContentForSummary(turns, compressStart, compressUntil);
  const summary = await generateSummary(contentToSummarize, config, metrics);

  const compressed: TrajectoryTurn[] = [];

  // 头部（区间之前），system 消息追加摘要提示
  for (let i = 0; i < compressStart; i++) {
    const turn = { ...turns[i] };
    if (turn.role === "system" && config.addSummaryNotice) {
      turn.content = (turn.content ?? "") + config.summaryNoticeText;
    }
    compressed.push(turn);
  }

  // 摘要作为 user 消息（时间戳取被压缩区间的最后一轮，保持时间线连续）
  const anchor = turns[Math.min(compressUntil, turns.length - 1)] ?? turns[0];
  compressed.push({
    session_id: anchor?.session_id ?? "",
    session_title: anchor?.session_title ?? "",
    session_mode: anchor?.session_mode ?? "chat",
    turn_index: 0,
    role: "user",
    content: summary,
    timestamp: anchor?.timestamp ?? Date.now(),
  });

  // 尾部（区间之后）原样保留
  for (let i = compressUntil; i < turns.length; i++) compressed.push({ ...turns[i] });

  // 重新编号 turn_index，保持连续
  compressed.forEach((t, i) => {
    t.turn_index = i;
  });

  metrics.compressedTurns = compressed.length;
  metrics.compressedTokens = compressed.reduce((sum, t) => sum + config.countTokens(t.content ?? ""), 0);
  metrics.turnsRemoved = metrics.originalTurns - metrics.compressedTurns;
  metrics.tokensSaved = metrics.originalTokens - metrics.compressedTokens;
  metrics.compressionRatio = metrics.compressedTokens / Math.max(metrics.originalTokens, 1);
  metrics.wasCompressed = true;
  metrics.stillOverLimit = metrics.compressedTokens > config.targetMaxTokens;

  return { turns: compressed, metrics };
}

export interface CompressBatchResult {
  /** 压缩后的轨迹列表（按输入顺序对齐；失败时原样返回） */
  trajectories: TrajectoryTurn[][];
  /** 每条轨迹的压缩指标（按输入顺序对齐） */
  metrics: TrajectoryMetrics[];
  /** 汇总指标 */
  aggregate: AggregateMetrics;
}

/**
 * 批量压缩多条轨迹（有并发上限，对齐 Hermes num_workers 语义）。
 * 单条失败不影响其余：失败轨迹原样返回并计入 aggregate.trajectoriesFailed。
 */
export async function compressTrajectories(
  turnLists: TrajectoryTurn[][],
  config: CompressionConfig = defaultCompressionConfig(),
  options: { concurrency?: number } = {},
): Promise<CompressBatchResult> {
  const aggregate = emptyAggregateMetrics();
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, turnLists.length));
  const results = new Array<TrajectoryTurn[]>(turnLists.length);
  const metricsList = new Array<TrajectoryMetrics>(turnLists.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= turnLists.length) return;
      try {
        const res = await compressTrajectory(turnLists[i], config);
        results[i] = res.turns;
        metricsList[i] = res.metrics;
      } catch {
        results[i] = turnLists[i];
        // 失败路径不重复调用 countTokens（其自身可能就是抛错源），token 数记 0 仅作占位
        const m = emptyTrajectoryMetrics();
        m.originalTurns = turnLists[i].length;
        m.compressedTurns = turnLists[i].length;
        m.stillOverLimit = true;
        metricsList[i] = m;
        aggregate.trajectoriesFailed += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  for (const m of metricsList) addTrajectoryMetrics(aggregate, m);
  return { trajectories: results, metrics: metricsList, aggregate };
}
