import { describe, expect, it } from "vitest";
import {
  aggregateMetricsToDict,
  addTrajectoryMetrics,
  buildSummaryPrompt,
  coerceSummaryContent,
  compressTrajectories,
  compressTrajectory,
  countTokensCjkAware,
  defaultCompressionConfig,
  emptyAggregateMetrics,
  emptyTrajectoryMetrics,
  ensureSummaryPrefix,
  extractTurnContentForSummary,
  findProtectedIndices,
  generateSummary,
  isBoundaryClean,
  snapBoundary,
  trajectoryMetricsToDict,
  type CompressionConfig,
  type TrajectoryTurn,
} from "./trajectory-compressor";

/** 测试用确定性 token 计数（对齐 Hermes 单测的 len//4 mock）。 */
function tokens4(text: string): number {
  return Math.floor(text.length / 4);
}

function makeTurn(role: string, content: string, overrides: Partial<TrajectoryTurn> = {}): TrajectoryTurn {
  return {
    session_id: "s1",
    session_title: "S",
    session_mode: "work",
    turn_index: 0,
    role,
    content,
    timestamp: 1700000000000,
    ...overrides,
  };
}

function cfg(overrides: Partial<CompressionConfig> = {}): CompressionConfig {
  return defaultCompressionConfig({ countTokens: tokens4, ...overrides });
}

/** 带 <tool_call> 标记的 assistant 轮，内容约 tokens 个 token。 */
function assistantWithToolCall(label: string, tokens: number): TrajectoryTurn {
  const body = `<tool_call>\n{"name": "${label}"}\n</tool_call>`;
  return makeTurn("assistant", body + "x".repeat(Math.max(0, tokens * 4 - body.length)));
}

/** 带 <tool_response> 标记的 tool 轮，内容约 tokens 个 token。 */
function toolResponse(label: string, tokens: number): TrajectoryTurn {
  const body = `<tool_response>\n{"name": "${label}"}\n</tool_response>`;
  return makeTurn("tool", body + "x".repeat(Math.max(0, tokens * 4 - body.length)));
}

function countMarker(turns: TrajectoryTurn[], marker: string): number {
  return turns.reduce((n, t) => n + (t.content.match(new RegExp(marker, "g"))?.length ?? 0), 0);
}

/** 10 轮 gpt/tool 配对轨迹，中间有一个超大 assistant 轮，强制产生"切在配对中间"的候选边界。 */
function pairedTrajectory(): TrajectoryTurn[] {
  return [
    makeTurn("system", "You are an agent. ".repeat(4)),
    makeTurn("user", "Please do the task. ".repeat(4)),
    assistantWithToolCall("a", 12),
    toolResponse("a", 12),
    assistantWithToolCall("b", 400),
    toolResponse("b", 12),
    assistantWithToolCall("c", 12),
    toolResponse("c", 12),
    makeTurn("assistant", "<think>\n</think>\nAll done."),
    makeTurn("user", "Thanks!"),
  ];
}

/** 构造让 token 累加在索引 4（assistant）之后立即停止的压缩配置 → 边界落在配对的 tool 上。 */
function makeSplitConfig(): CompressionConfig {
  const c = cfg({ protectLastNTurns: 2, summaryTargetTokens: 4 });
  const turns = pairedTrajectory();
  const turnTokens = turns.map((t) => c.countTokens(t.content));
  const total = turnTokens.reduce((a, b) => a + b, 0);
  c.targetMaxTokens = total - turnTokens[4] + c.summaryTargetTokens;
  return c;
}

describe("token 计数", () => {
  it("空字符串为 0", () => {
    expect(countTokensCjkAware("")).toBe(0);
  });

  it("CJK 字符按 1 token 估算", () => {
    expect(countTokensCjkAware("你好世界")).toBe(4);
  });

  it("ASCII 按 4 字符/token 估算", () => {
    expect(countTokensCjkAware("12345678")).toBe(2);
  });
});

describe("defaultCompressionConfig", () => {
  it("默认值与 Hermes 对齐", () => {
    const c = defaultCompressionConfig();
    expect(c.targetMaxTokens).toBe(15250);
    expect(c.summaryTargetTokens).toBe(750);
    expect(c.protectLastNTurns).toBe(4);
    expect(c.skipUnderTarget).toBe(true);
    expect(c.saveOverLimit).toBe(true);
  });

  it("覆盖项生效且其余保持默认", () => {
    const c = defaultCompressionConfig({ targetMaxTokens: 8000 });
    expect(c.targetMaxTokens).toBe(8000);
    expect(c.protectLastNTurns).toBe(4);
  });
});

describe("TrajectoryMetrics 序列化", () => {
  it("空指标默认值", () => {
    const d = trajectoryMetricsToDict(emptyTrajectoryMetrics());
    expect(d.original_tokens).toBe(0);
    expect(d.was_compressed).toBe(false);
    expect(d.skipped_under_target).toBe(false);
    expect(d.compression_region).toEqual({ start_idx: -1, end_idx: -1, turns_count: 0 });
  });

  it("完整指标序列化", () => {
    const m = emptyTrajectoryMetrics();
    m.originalTokens = 10000;
    m.compressedTokens = 5000;
    m.tokensSaved = 5000;
    m.compressionRatio = 0.5;
    m.originalTurns = 20;
    m.compressedTurns = 10;
    m.turnsRemoved = 10;
    m.wasCompressed = true;
    m.summarizationFallback = true;
    const d = trajectoryMetricsToDict(m);
    expect(d.original_tokens).toBe(10000);
    expect(d.compression_ratio).toBe(0.5);
    expect(d.was_compressed).toBe(true);
    expect(d.summarization_fallback).toBe(true);
  });
});

describe("AggregateMetrics", () => {
  it("空汇总序列化不除零", () => {
    const d = aggregateMetricsToDict(emptyAggregateMetrics());
    expect(d.summary.total_trajectories).toBe(0);
    expect(d.averages.avg_compression_ratio).toBe(1.0);
    expect(d.summarization.success_rate).toBe(1.0);
    expect(d.tokens.overall_compression_ratio).toBe(0.0);
  });

  it("汇总压缩与非压缩轨迹", () => {
    const agg = emptyAggregateMetrics();
    const m = emptyTrajectoryMetrics();
    m.originalTokens = 20000;
    m.compressedTokens = 10000;
    m.tokensSaved = 10000;
    m.compressionRatio = 0.5;
    m.originalTurns = 30;
    m.compressedTurns = 15;
    m.turnsRemoved = 15;
    m.wasCompressed = true;
    addTrajectoryMetrics(agg, m);

    const m2 = emptyTrajectoryMetrics();
    m2.skippedUnderTarget = true;
    addTrajectoryMetrics(agg, m2);

    expect(agg.totalTrajectories).toBe(2);
    expect(agg.trajectoriesCompressed).toBe(1);
    expect(agg.trajectoriesSkippedUnderTarget).toBe(1);
    expect(agg.totalTokensSaved).toBe(10000);
    expect(agg.compressionRatios).toEqual([0.5]);

    const d = aggregateMetricsToDict(agg);
    expect(d.summary.total_trajectories).toBe(2);
    expect(d.summary.trajectories_compressed).toBe(1);
    expect(d.tokens.total_saved).toBe(10000);
    expect(d.averages.avg_compression_ratio).toBe(0.5);
  });
});

describe("findProtectedIndices", () => {
  function basicTrajectory(): TrajectoryTurn[] {
    return [
      makeTurn("system", "You are an agent."),
      makeTurn("user", "Do something."),
      makeTurn("assistant", "I will use a tool."),
      makeTurn("tool", "Tool result."),
      makeTurn("assistant", "More work."),
      makeTurn("tool", "Another result."),
      makeTurn("assistant", "Work continues."),
      makeTurn("tool", "Result 3."),
      makeTurn("assistant", "Done."),
      makeTurn("user", "Thanks."),
    ];
  }

  it("保护首个各类角色与末尾 N 轮", () => {
    const turns = basicTrajectory();
    const { protectedSet, compressibleStart, compressibleEnd } = findProtectedIndices(turns, cfg());
    for (const i of [0, 1, 2, 3]) expect(protectedSet.has(i)).toBe(true);
    for (const i of [6, 7, 8, 9]) expect(protectedSet.has(i)).toBe(true);
    expect(compressibleStart).toBeGreaterThanOrEqual(4);
    expect(compressibleEnd).toBeLessThanOrEqual(6);
  });

  it("短轨迹全部受保护，无可压缩区间", () => {
    const turns = [makeTurn("system", "sys"), makeTurn("user", "hi"), makeTurn("assistant", "hello")];
    const { protectedSet, compressibleStart, compressibleEnd } = findProtectedIndices(turns, cfg());
    expect(protectedSet.size).toBe(3);
    expect(compressibleStart).toBeGreaterThanOrEqual(compressibleEnd);
  });

  it("protectLastNTurns=0 时无尾部保护", () => {
    const turns = [
      makeTurn("system", "sys"),
      makeTurn("user", "q"),
      makeTurn("assistant", "a"),
      makeTurn("tool", "r"),
      makeTurn("assistant", "b"),
      makeTurn("tool", "r2"),
      makeTurn("assistant", "c"),
      makeTurn("tool", "r3"),
    ];
    const { protectedSet } = findProtectedIndices(turns, cfg({ protectLastNTurns: 0 }));
    expect(protectedSet.has(0)).toBe(true);
    expect(protectedSet.has(3)).toBe(true);
    expect(protectedSet.has(7)).toBe(false);
  });

  it("关闭 protectFirstSystem 后 system 不入保护", () => {
    const turns = [
      makeTurn("system", "sys"),
      makeTurn("user", "q"),
      makeTurn("assistant", "a"),
      makeTurn("tool", "r"),
      makeTurn("assistant", "b"),
      makeTurn("tool", "r2"),
      makeTurn("assistant", "c"),
      makeTurn("tool", "r3"),
    ];
    const { protectedSet } = findProtectedIndices(turns, cfg({ protectFirstSystem: false }));
    expect(protectedSet.has(0)).toBe(false);
  });
});

describe("extractTurnContentForSummary", () => {
  it("基本抽取（end 不包含）", () => {
    const turns = [
      makeTurn("assistant", "I will search."),
      makeTurn("tool", "Search result: found it."),
      makeTurn("assistant", "Great, done."),
    ];
    const content = extractTurnContentForSummary(turns, 0, 2);
    expect(content).toContain("[Turn 0 - ASSISTANT]");
    expect(content).toContain("I will search.");
    expect(content).toContain("[Turn 1 - TOOL]");
    expect(content).toContain("Search result: found it.");
    expect(content).not.toContain("[Turn 2");
  });

  it("超长内容截断", () => {
    const turns = [makeTurn("tool", "x".repeat(5000))];
    const content = extractTurnContentForSummary(turns, 0, 1);
    expect(content).toContain("...[truncated]...");
    expect(content.length).toBeLessThan(5000);
  });

  it("空区间返回空串", () => {
    const turns = [makeTurn("assistant", "hello")];
    expect(extractTurnContentForSummary(turns, 0, 0)).toBe("");
  });
});

describe("isBoundaryClean / snapBoundary", () => {
  it("落在 tool 轮上的边界不干净，前移优先", () => {
    const turns = pairedTrajectory();
    expect(isBoundaryClean(turns, 5)).toBe(false); // index 5 是 tool
    expect(snapBoundary(turns, 5, 4, 8)).toBe(6);
    expect(snapBoundary(turns, 4, 4, 8)).toBe(4); // assistant 轮本身干净
  });

  it("前向无干净边界时回退", () => {
    const turns = [
      makeTurn("assistant", "<tool_call>a</tool_call>"),
      makeTurn("tool", "<tool_response>a</tool_response>"),
    ];
    expect(snapBoundary(turns, 1, 0, 1)).toBe(0);
  });
});

describe("generateSummary", () => {
  it("带 [CONTEXT SUMMARY]: 前缀输出，缺失时自动补全", async () => {
    const m = emptyTrajectoryMetrics();
    const config = cfg({ summarize: async () => "summarized content" });
    const summary = await generateSummary("content", config, m);
    expect(summary.startsWith("[CONTEXT SUMMARY]:")).toBe(true);
    expect(m.summarizationApiCalls).toBe(1);
  });

  it("模型输出 None 时归一为空前缀", async () => {
    const m = emptyTrajectoryMetrics();
    const config = cfg({ summarize: async () => null as unknown as string });
    expect(await generateSummary("content", config, m)).toBe("[CONTEXT SUMMARY]:");
  });

  it("未注入摘要函数时降级为占位摘要", async () => {
    const m = emptyTrajectoryMetrics();
    const summary = await generateSummary("content", cfg(), m);
    expect(summary.startsWith("[CONTEXT SUMMARY]:")).toBe(true);
    expect(m.summarizationFallback).toBe(true);
  });

  it("重试耗尽后降级为失败占位摘要", async () => {
    const m = emptyTrajectoryMetrics();
    const config = cfg({ maxRetries: 1, summarize: async () => { throw new Error("llm down"); } });
    const summary = await generateSummary("content", config, m);
    expect(summary).toContain("Summary generation failed");
    expect(m.summarizationErrors).toBe(1);
    expect(m.summarizationFallback).toBe(true);
  });
});

describe("buildSummaryPrompt / coerce / prefix", () => {
  it("提示词包含目标 token 数与内容", () => {
    const prompt = buildSummaryPrompt("turn content", 500);
    expect(prompt).toContain("500 tokens");
    expect(prompt).toContain("turn content");
    expect(prompt).toContain("[CONTEXT SUMMARY]:");
  });

  it("coerceSummaryContent 非字符串归一为字符串", () => {
    expect(coerceSummaryContent(123 as unknown)).toBe("123");
    expect(coerceSummaryContent(null)).toBe("");
    expect(coerceSummaryContent(undefined)).toBe("");
  });

  it("ensureSummaryPrefix 只保留一次前缀", () => {
    expect(ensureSummaryPrefix("[CONTEXT SUMMARY]: x")).toBe("[CONTEXT SUMMARY]: x");
    expect(ensureSummaryPrefix("x")).toBe("[CONTEXT SUMMARY]: x");
    expect(ensureSummaryPrefix("")).toBe("[CONTEXT SUMMARY]:");
  });
});

describe("compressTrajectory", () => {
  it("低于目标直接跳过", async () => {
    const turns = [makeTurn("system", "sys"), makeTurn("user", "hi"), makeTurn("assistant", "hello")];
    const config = cfg({ targetMaxTokens: 10000, summarize: async () => "summary" });
    const { turns: out, metrics } = await compressTrajectory(turns, config);
    expect(out).toBe(turns);
    expect(metrics.skippedUnderTarget).toBe(true);
    expect(metrics.wasCompressed).toBe(false);
  });

  it("无注入摘要函数时仍可压缩（占位摘要 + fallback 标记）", async () => {
    const turns = Array.from({ length: 12 }, (_, i) =>
      makeTurn(i % 2 === 0 ? "assistant" : "tool", "content ".repeat(400)),
    );
    const config = cfg({ targetMaxTokens: 2000, protectLastNTurns: 2 });
    const { turns: out, metrics } = await compressTrajectory(turns, config);
    expect(metrics.wasCompressed).toBe(true);
    expect(metrics.summarizationFallback).toBe(true);
    expect(out.some((t) => t.role === "user" && t.content.startsWith("[CONTEXT SUMMARY]: [Summary generation unavailable"))).toBe(true);
  });

  it("压缩中部区间为单条 user 摘要，保留头尾并重编号", async () => {
    const turns = pairedTrajectory();
    const config = makeSplitConfig();
    config.summarize = async () => "middle turns summarized.";
    const { turns: out, metrics } = await compressTrajectory(turns, config);

    expect(metrics.wasCompressed).toBe(true);
    expect(out[0].role).toBe("system");
    // system 消息追加摘要提示
    expect(out[0].content).toContain("may be summarized to preserve context");
    // 摘要作为 user 消息插入
    const summaryIdx = out.findIndex((t) => t.role === "user" && t.content.startsWith("[CONTEXT SUMMARY]:"));
    expect(summaryIdx).toBeGreaterThan(0);
    // 尾部保留（受保护的 assistant 最终回复 + user 致谢）
    expect(out[out.length - 1].role).toBe("user");
    expect(out[out.length - 1].content).toBe("Thanks!");
    // turn_index 连续
    out.forEach((t, i) => expect(t.turn_index).toBe(i));
    // 指标
    expect(metrics.turnsRemoved).toBe(metrics.originalTurns - metrics.compressedTurns);
    expect(metrics.tokensSaved).toBeGreaterThan(0);
    expect(metrics.compressionRatio).toBeLessThan(1);
    expect(metrics.turnsCompressedStartIdx).toBeGreaterThanOrEqual(0);
  });

  it("不拆散 tool 调用/响应配对", async () => {
    const turns = pairedTrajectory();
    const config = makeSplitConfig();
    config.summarize = async () => "middle turns summarized.";
    const { turns: out, metrics } = await compressTrajectory(turns, config);

    expect(metrics.wasCompressed).toBe(true);
    expect(countMarker(out, "<tool_call>")).toBe(countMarker(out, "<tool_response>"));
    for (let i = 0; i < out.length; i++) {
      if (out[i].role === "tool") {
        expect(i).toBeGreaterThan(0);
        expect(out[i - 1].role).toBe("assistant");
      }
    }
  });

  it("无可压缩内容时原样返回并标记仍超限", async () => {
    // 全部轮次受保护（短轨迹 + 大尾部保护）
    const turns = pairedTrajectory().slice(0, 4);
    const config = cfg({
      targetMaxTokens: 1,
      protectLastNTurns: 10,
      summarize: async () => "summary",
    });
    const { turns: out, metrics } = await compressTrajectory(turns, config);
    expect(metrics.wasCompressed).toBe(false);
    expect(metrics.stillOverLimit).toBe(true);
    expect(out).toBe(turns);
  });
});

describe("compressTrajectories", () => {
  it("批量压缩并汇总指标", async () => {
    const big = Array.from({ length: 10 }, (_, i) => makeTurn(i % 2 === 0 ? "assistant" : "tool", "x".repeat(2000)));
    const small = [makeTurn("user", "hi")];
    const config = cfg({ targetMaxTokens: 4000, summarize: async () => "[CONTEXT SUMMARY]: ok" });
    const { trajectories, metrics, aggregate } = await compressTrajectories([big, small, big], config);

    expect(trajectories).toHaveLength(3);
    expect(metrics[0].wasCompressed).toBe(true);
    expect(metrics[1].skippedUnderTarget).toBe(true);
    expect(metrics[2].wasCompressed).toBe(true);
    expect(aggregate.totalTrajectories).toBe(3);
    expect(aggregate.trajectoriesCompressed).toBe(2);
    expect(aggregate.trajectoriesSkippedUnderTarget).toBe(1);
  });

  it("摘要失败降级为占位摘要，轨迹仍正常压缩", async () => {
    const bad = Array.from({ length: 10 }, (_, i) => makeTurn(i % 2 === 0 ? "assistant" : "tool", "x".repeat(2000)));
    const config = cfg({
      targetMaxTokens: 4000,
      maxRetries: 1,
      summarize: async () => {
        throw new Error("llm down");
      },
    });
    const { turns, metrics } = await compressTrajectory(bad, config);
    expect(metrics.wasCompressed).toBe(true);
    expect(metrics.summarizationErrors).toBe(1);
    expect(metrics.summarizationFallback).toBe(true);
    expect(turns.some((t) => t.role === "user" && t.content.includes("Summary generation failed"))).toBe(true);
  });

  it("单条压缩抛错不影响其余，失败轨迹原样返回", async () => {
    const good = [makeTurn("user", "hi")];
    const bad = Array.from({ length: 10 }, (_, i) => makeTurn(i % 2 === 0 ? "assistant" : "tool", "x".repeat(2000)));
    let countCalls = 0;
    const config = cfg({
      targetMaxTokens: 4000,
      summarize: async () => "[CONTEXT SUMMARY]: ok",
      countTokens: (text: string) => {
        countCalls += 1;
        if (countCalls === 30) throw new Error("counter exploded");
        return tokens4(text);
      },
    });
    const { trajectories, aggregate } = await compressTrajectories([bad, bad, good], config);

    // 三条轨迹并发：恰好一条因计数抛错原样返回（轮数不变），其余正常
    const badLengths = [trajectories[0].length, trajectories[1].length];
    expect(badLengths.filter((l) => l === bad.length)).toHaveLength(1);
    expect(badLengths.filter((l) => l < bad.length)).toHaveLength(1);
    expect(trajectories[2]).toHaveLength(1);
    expect(aggregate.trajectoriesFailed).toBe(1);
    expect(aggregate.totalTrajectories).toBe(3);
  });
});
