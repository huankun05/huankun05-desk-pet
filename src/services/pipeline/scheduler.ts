/**
 * PipelineScheduler — 消息处理管道调度器
 *
 * 按注册顺序依次执行 Stage。任何 Stage 可设 ctx.aborted = true 中止后续。
 * 默认开启错误隔离：单个 Stage 抛错不会终止整个管道，仅记录并通知回调；
 * 可通过 options.continueOnError = false 切换为快速失败模式。
 */

import type { Stage, MessageContext, PipelineCallbacks, PipelineExecuteOptions } from './types';

export class PipelineScheduler {
  private stages: Stage[] = [];

  /** 添加阶段（链式调用） */
  addStage(stage: Stage): this {
    this.stages.push(stage);
    return this;
  }

  /** 获取已注册阶段列表 */
  getStages(): readonly Stage[] {
    return this.stages;
  }

  /** 执行管道 */
  async execute(
    ctx: MessageContext,
    callbacks: PipelineCallbacks,
    options: PipelineExecuteOptions = {},
  ): Promise<void> {
    const continueOnError = options.continueOnError !== false;
    for (const stage of this.stages) {
      // 中止信号优先：一旦 aborted，立即停止
      if (ctx.aborted) break;
      try {
        await stage.process(ctx, callbacks);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        // 记录日志，便于排查
        console.error(`[PipelineScheduler] Stage "${stage.name}" threw error:`, error);
        // 通过回调通知上层
        try {
          callbacks.onStageError?.(stage, error, ctx);
        } catch (cbErr) {
          // 回调自身的错误不应影响管道
          console.error(`[PipelineScheduler] onStageError callback threw:`, cbErr);
        }
        // 显式中止信号仍然生效
        if (ctx.aborted) break;
        // 快速失败模式：向上抛出
        if (!continueOnError) throw error;
        // 默认继续执行下一个 Stage
      }
    }
  }
}
