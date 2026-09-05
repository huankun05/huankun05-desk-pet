/**
 * 工具调用护栏（移植自 Hermes agent/tool_guardrails.py）。
 *
 * 核心目标：检测并阻止 Agent 陷入"重复失败"或"无进展循环"——
 * 模型反复调用同一个工具、用相同参数、得到相同失败/空结果，却不改变策略。
 *
 * 三类检测：
 * 1. exact_failure_block：相同工具+相同参数失败 N 次 → block（不再执行该调用）
 * 2. same_tool_failure_halt：同一工具（不同参数也算）失败 N 次 → halt（终止本轮）
 * 3. idempotent_no_progress_block：幂等工具（只读）相同参数返回相同结果 N 次 → block
 *
 * 设计原则：
 * - 纯函数 + 控制器类，不依赖 Electron/磁盘，可独立测试
 * - 每轮（turn）重置计数，避免跨轮累积误杀
 * - warn 只记录不拦截，block 拦截该次调用，halt 终止本轮后续执行
 * - 被 block 的调用返回 not_executed，让模型看到诚实结果后自行决策
 */

import type { SideEffectKind } from "./types";

// ── 配置 ──────────────────────────────────────────────────

export interface ToolGuardrailConfig {
  /** 相同工具+相同参数失败多少次后 block（默认 3） */
  exactFailureBlockAfter: number;
  /** 相同工具+相同参数失败多少次后 warn（默认 2） */
  exactFailureWarnAfter: number;
  /** 同一工具（任意参数）失败多少次后 halt（默认 5） */
  sameToolFailureHaltAfter: number;
  /** 同一工具（任意参数）失败多少次后 warn（默认 3） */
  sameToolFailureWarnAfter: number;
  /** 幂等工具相同参数返回相同结果多少次后 block（默认 3） */
  noProgressBlockAfter: number;
  /** 幂等工具相同参数返回相同结果多少次后 warn（默认 2） */
  noProgressWarnAfter: number;
}

export const DEFAULT_TOOL_GUARDRAIL_CONFIG: ToolGuardrailConfig = {
  exactFailureBlockAfter: 3,
  exactFailureWarnAfter: 2,
  sameToolFailureHaltAfter: 5,
  sameToolFailureWarnAfter: 3,
  noProgressBlockAfter: 3,
  noProgressWarnAfter: 2,
};

// ── 决策 ──────────────────────────────────────────────────

export type ToolGuardrailDecision =
  | { kind: "allow" }
  | { kind: "warn"; reason: string }
  | { kind: "block"; reason: string }
  | { kind: "halt"; reason: string };

// ── 工具调用签名 ───────────────────────────────────────────

/**
 * 规范化工具调用参数为可比较的签名。
 * 对参数 key 排序，value 转字符串，确保 {a:1,b:2} 和 {b:2,a:1} 签名相同。
 */
export function normalizeToolArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args).sort();
  const parts = keys.map((k) => `${k}=${stableStringify(args[k])}`);
  return parts.join("&");
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, Object.keys(value as object).sort());
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export interface ToolCallSignature {
  toolName: string;
  argsSignature: string;
}

export function makeToolSignature(toolName: string, args: Record<string, unknown>): ToolCallSignature {
  return { toolName, argsSignature: normalizeToolArgs(args) };
}

// ── 失败分类 ───────────────────────────────────────────────

/**
 * 从工具执行结果判断是否为"失败"。
 * 移植自 Hermes classify_tool_failure：
 * - outcome 为 failure / unknown → 失败
 * - 输出包含明确错误关键词 → 失败
 * - 其余 → 成功
 */
export function classifyToolFailure(
  outcome: string,
  output?: string,
): boolean {
  if (outcome === "failure" || outcome === "unknown") return true;
  if (!output) return false;

  const lower = output.toLowerCase();
  const errorPatterns = [
    "error:", "error -", "failed:", "failed to", "failure:",
    "exception:", "traceback", "permission denied", "not found",
    "no such file", "cannot", "unable to", "invalid",
  ];
  return errorPatterns.some((p) => lower.includes(p));
}

// ── 幂等工具判断 ───────────────────────────────────────────

/**
 * 判断工具是否为幂等（只读）工具。
 * 幂等工具重复调用不会改变状态，因此"相同结果"意味着无进展。
 * 基于 SideEffectKind 判断，不依赖工具名硬编码。
 */
export function isIdempotentTool(sideEffect: SideEffectKind): boolean {
  return sideEffect === "read_only";
}

// ── 控制器 ─────────────────────────────────────────────────

interface FailureRecord {
  count: number;
  lastOutput?: string;
}

interface NoProgressRecord {
  count: number;
  lastOutputHash: string;
}

/**
 * 工具调用护栏控制器。
 *
 * 每个 HarnessRun 持有一个实例，每轮（turn）开始时调用 resetForTurn()。
 * before_call 在工具执行前调用，after_call 在工具执行后调用。
 */
export class ToolCallGuardrailController {
  private readonly config: ToolGuardrailConfig;

  /** 精确失败计数：key = `${toolName}:${argsSignature}` */
  private exactFailures = new Map<string, FailureRecord>();
  /** 同工具失败计数：key = toolName */
  private toolFailures = new Map<string, number>();
  /** 无进展计数：key = `${toolName}:${argsSignature}` */
  private noProgress = new Map<string, NoProgressRecord>();
  /** 本轮已发出的 warn 集合（避免重复 warn） */
  private warnedKeys = new Set<string>();

  constructor(config?: Partial<ToolGuardrailConfig>) {
    this.config = { ...DEFAULT_TOOL_GUARDRAIL_CONFIG, ...config };
  }

  /** 每轮开始时重置所有计数（移植自 Hermes reset_for_turn）。 */
  resetForTurn(): void {
    this.exactFailures.clear();
    this.toolFailures.clear();
    this.noProgress.clear();
    this.warnedKeys.clear();
  }

  /**
   * 工具执行前检查。
   * 返回 allow / warn / block / halt。
   * block 表示该次调用不应执行；halt 表示本轮应终止。
   */
  beforeCall(
    toolName: string,
    args: Record<string, unknown>,
    sideEffect: SideEffectKind,
  ): ToolGuardrailDecision {
    const signature = makeToolSignature(toolName, args);
    const exactKey = `${signature.toolName}:${signature.argsSignature}`;

    // 1. 精确失败 block
    const exactFailure = this.exactFailures.get(exactKey);
    if (exactFailure && exactFailure.count >= this.config.exactFailureBlockAfter) {
      return {
        kind: "block",
        reason: `工具 ${toolName} 以相同参数已失败 ${exactFailure.count} 次，停止重复调用。请检查参数或换一种方式。`,
      };
    }

    // 2. 同工具失败 halt
    const toolFailureCount = this.toolFailures.get(toolName) ?? 0;
    if (toolFailureCount >= this.config.sameToolFailureHaltAfter) {
      return {
        kind: "halt",
        reason: `工具 ${toolName} 本轮已失败 ${toolFailureCount} 次，终止本轮执行。`,
      };
    }

    // 3. 幂等工具无进展 block
    if (isIdempotentTool(sideEffect)) {
      const noProgressRecord = this.noProgress.get(exactKey);
      if (noProgressRecord && noProgressRecord.count >= this.config.noProgressBlockAfter) {
        return {
          kind: "block",
          reason: `工具 ${toolName} 以相同参数已返回相同结果 ${noProgressRecord.count} 次，无进展。请换一种查询方式或先做其他操作。`,
        };
      }
    }

    // 4. warn（只记录一次）
    if (exactFailure && exactFailure.count >= this.config.exactFailureWarnAfter) {
      const warnKey = `exact:${exactKey}`;
      if (!this.warnedKeys.has(warnKey)) {
        this.warnedKeys.add(warnKey);
        return {
          kind: "warn",
          reason: `工具 ${toolName} 以相同参数已失败 ${exactFailure.count} 次，请注意可能需要换策略。`,
        };
      }
    }
    if (toolFailureCount >= this.config.sameToolFailureWarnAfter) {
      const warnKey = `tool:${toolName}`;
      if (!this.warnedKeys.has(warnKey)) {
        this.warnedKeys.add(warnKey);
        return {
          kind: "warn",
          reason: `工具 ${toolName} 本轮已失败 ${toolFailureCount} 次，请注意可能需要换策略。`,
        };
      }
    }
    if (isIdempotentTool(sideEffect)) {
      const noProgressRecord = this.noProgress.get(exactKey);
      if (noProgressRecord && noProgressRecord.count >= this.config.noProgressWarnAfter) {
        const warnKey = `noprogress:${exactKey}`;
        if (!this.warnedKeys.has(warnKey)) {
          this.warnedKeys.add(warnKey);
          return {
            kind: "warn",
            reason: `工具 ${toolName} 以相同参数已返回相同结果 ${noProgressRecord.count} 次，可能无进展。`,
          };
        }
      }
    }

    return { kind: "allow" };
  }

  /**
   * 工具执行后记录结果。
   * @param failed 是否为失败（由 classifyToolFailure 判断）
   * @param output 工具输出（用于无进展检测的 hash 比较）
   */
  afterCall(
    toolName: string,
    args: Record<string, unknown>,
    sideEffect: SideEffectKind,
    failed: boolean,
    output?: string,
  ): void {
    const signature = makeToolSignature(toolName, args);
    const exactKey = `${signature.toolName}:${signature.argsSignature}`;

    if (failed) {
      // 失败计数
      const existing = this.exactFailures.get(exactKey);
      this.exactFailures.set(exactKey, {
        count: (existing?.count ?? 0) + 1,
        lastOutput: output,
      });
      this.toolFailures.set(toolName, (this.toolFailures.get(toolName) ?? 0) + 1);
      // 失败时清除无进展记录（失败不算"相同结果"）
      this.noProgress.delete(exactKey);
    } else if (isIdempotentTool(sideEffect) && output !== undefined) {
      // 幂等工具成功 → 检测无进展
      const outputHash = hashOutput(output);
      const existing = this.noProgress.get(exactKey);
      if (existing && existing.lastOutputHash === outputHash) {
        this.noProgress.set(exactKey, {
          count: existing.count + 1,
          lastOutputHash: outputHash,
        });
      } else {
        this.noProgress.set(exactKey, {
          count: 1,
          lastOutputHash: outputHash,
        });
      }
      // 成功时清除精确失败记录（成功意味着之前的失败可能已被解决）
      this.exactFailures.delete(exactKey);
    } else {
      // 非幂等工具成功 → 清除精确失败记录
      this.exactFailures.delete(exactKey);
    }
  }

  /** 诊断快照（用于日志/测试）。 */
  snapshot(): {
    exactFailures: Record<string, number>;
    toolFailures: Record<string, number>;
    noProgress: Record<string, number>;
  } {
    const exactFailures: Record<string, number> = {};
    for (const [k, v] of this.exactFailures) exactFailures[k] = v.count;
    const toolFailures: Record<string, number> = {};
    for (const [k, v] of this.toolFailures) toolFailures[k] = v;
    const noProgress: Record<string, number> = {};
    for (const [k, v] of this.noProgress) noProgress[k] = v.count;
    return { exactFailures, toolFailures, noProgress };
  }
}

/** 简单输出 hash（用于无进展检测）。 */
function hashOutput(output: string): string {
  // 用简单的字符串 hash，不需要加密强度
  let hash = 0;
  for (let i = 0; i < output.length; i++) {
    const char = output.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return String(hash);
}
