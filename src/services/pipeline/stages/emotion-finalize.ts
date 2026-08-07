/**
 * EmotionFinalizeStage — 流结束后的最终情感分析
 *
 * 处理 LLMStage 中剩余的 sentenceBuffer，
 * 确保最后一个不完整的句子也触发情感分析。
 *
 * 同时从 callbacks.getLatestEmotion 获取最新情绪并更新 ctx.emotionSnapshot，
 * 供下游 TTSStage 和 BehaviorDecorateStage 使用真实的响应情绪。
 */

import type { Stage, MessageContext, PipelineCallbacks } from '../types';

export class EmotionFinalizeStage implements Stage {
  readonly name = 'emotion-finalize';

  async process(ctx: MessageContext, callbacks: PipelineCallbacks): Promise<void> {
    if (ctx.sentenceBuffer) {
      callbacks.onEmotionAnalyze(ctx.sentenceBuffer);
    }

    // 更新 emotionSnapshot 为最新情绪（LLM 推导后）
    if (callbacks.getLatestEmotion) {
      ctx.emotionSnapshot = callbacks.getLatestEmotion();
    }
  }
}
