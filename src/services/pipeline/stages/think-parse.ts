/**
 * ThinkParseStage — 解析 think 标签，提取可朗读文本
 *
 * 从 LLM 累积响应中剥离 <think>...</think> 标签，
 * 将可朗读文本写入 ctx.speakableText。
 * 行为开关由 localStorage 中 deskpet_behaviorConfig 的 enableThinkTags 控制。
 */

import type { Stage, MessageContext, PipelineCallbacks } from '../types';
import { parseThinkTags, getSpeakableText } from '../../../utils/thinkTagParser';
import { loadBehaviorConfig } from '../../behavior/behaviorConfig';

export class ThinkParseStage implements Stage {
  readonly name = 'think-parse';

  async process(ctx: MessageContext, _callbacks: PipelineCallbacks): Promise<void> {
    const behavior = loadBehaviorConfig();

    if (!behavior.enableThinkTags) {
      ctx.speakableText = ctx.accumulated.trim();
      return;
    }

    const segments = parseThinkTags(ctx.accumulated);
    ctx.speakableText = getSpeakableText(segments).trim();
  }
}
