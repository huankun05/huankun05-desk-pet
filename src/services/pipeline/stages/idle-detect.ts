/**
 * IdleDetectStage — 空闲检测阶段
 *
 * 位置：管道第一站
 *
 * 检测用户是否长时间未互动，如果是自主触发（如 Live Mode）
 * 则注入额外的上下文提示，让 LLM 以更自然的方式开启话题。
 */

import type { Stage, MessageContext, PipelineCallbacks } from '../types';
import { IDLE_THRESHOLDS } from '../../idle/constants';

const IDLE_THRESHOLD_MS = IDLE_THRESHOLDS.short; // 5分钟算"久未互动"

export class IdleDetectStage implements Stage {
  readonly name = 'idle-detect';

  private lastInteractionTime: number = Date.now();
  private idleCount = 0;

  recordInteraction(): void {
    this.lastInteractionTime = Date.now();
    this.idleCount = 0;
  }

  async process(ctx: MessageContext, _callbacks: PipelineCallbacks): Promise<void> {
    const idleMs = Date.now() - this.lastInteractionTime;

    if (idleMs > IDLE_THRESHOLD_MS) {
      this.idleCount++;
      const minutes = Math.round(idleMs / 60000);

      // 注入空闲上下文到 memoryContext 尾部
      const idleHint = `\n[系统提示：用户已有 ${minutes} 分钟未互动，这是久违的对话，回复可以热情一些]`;
      ctx.memoryContext = (ctx.memoryContext || '') + idleHint;
    }
  }
}
