/**
 * IterationBudget — 移植自 Hermes agent/iteration_budget.py
 *
 * 防止 Agent 主循环死循环的迭代预算计数器。
 * 每次模型调用 consume() 一次；程序化工具调用（如 run_verification）
 * 成功后 refund()，因为这类调用的"推理成本"极低，不应消耗宝贵的迭代预算。
 *
 * Hermes 默认值：父 agent 90 次，子 agent 50 次。
 * Cyrene 通过 HarnessConfig.maxIterations 配置，默认 90。
 *
 * 设计要点（与 Hermes 对齐）：
 * - consume() 超上限返回 false，调用方负责退出循环
 * - refund() 仅在程序化工具成功后调用，不超过 maxTotal
 * - used / remaining 只读属性
 * - JavaScript 单线程无需锁，但 API 保持与 Hermes 一致
 */

export const DEFAULT_PARENT_ITERATIONS = 90;
export const DEFAULT_SUBAGENT_ITERATIONS = 50;

export class IterationBudget {
  readonly maxTotal: number;
  private _used = 0;

  constructor(maxTotal: number = DEFAULT_PARENT_ITERATIONS) {
    if (!Number.isFinite(maxTotal) || maxTotal <= 0) {
      throw new Error(`IterationBudget maxTotal must be a positive integer, got ${maxTotal}`);
    }
    this.maxTotal = Math.floor(maxTotal);
  }

  /**
   * 消耗一次迭代预算。返回 true 表示预算内，false 表示已耗尽。
   * 与 Hermes consume() 语义一致。
   */
  consume(): boolean {
    if (this._used >= this.maxTotal) return false;
    this._used += 1;
    return true;
  }

  /**
   * 退还一次迭代预算（程序化工具调用成功后调用）。
   * 与 Hermes refund() 语义一致：不会让 used 低于 0。
   */
  refund(): void {
    if (this._used > 0) {
      this._used -= 1;
    }
  }

  get used(): number {
    return this._used;
  }

  get remaining(): number {
    return this.maxTotal - this._used;
  }

  get exhausted(): boolean {
    return this._used >= this.maxTotal;
  }

  /** 诊断快照（用于日志 / 回合退出诊断）。 */
  snapshot(): { used: number; remaining: number; maxTotal: number } {
    return { used: this._used, remaining: this.remaining, maxTotal: this.maxTotal };
  }
}
