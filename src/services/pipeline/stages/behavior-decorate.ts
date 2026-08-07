/**
 * BehaviorDecorateStage — 行为装饰阶段
 *
 * 位置：TTSStage 之后（管道最后一站）
 *
 * 根据 LLM 输出和当前情感状态，自动触发：
 * - Live2D 表情切换
 * - 模型参数更新（脸红、青筋等）
 * - 动画触发（如挥手、跳跃）
 *
 * 使角色的视觉表现与对话内容、情绪状态一致。
 */

import type { Stage, MessageContext, PipelineCallbacks } from '../types';
import type { EmotionType } from '../../../hooks/useEmotion';
import { eventBus } from '../../eventBus';

export interface BehaviorAction {
  type: 'expression' | 'param' | 'animation' | 'composite';
  data: Record<string, string | number>;
}

export class BehaviorDecorateStage implements Stage {
  readonly name = 'behavior-decorate';

  async process(ctx: MessageContext, _callbacks: PipelineCallbacks): Promise<void> {
    const emo = ctx.emotionSnapshot;
    const text = ctx.speakableText || ctx.accumulated || '';
    const emotion = (emo.emotion || 'idle') as EmotionType;

    // ===== 1. 表情选择与触发 =====
    const expression = this.selectExpression(emotion, emo.emotionIntensity);
    if (expression) {
      eventBus.emit('expression:change', { expression, emotion, intensity: emo.emotionIntensity });
    }

    // ===== 2. 模型参数调节 =====
    const params = this.computeParams(
      emotion,
      emo.emotionIntensity,
      emo.favorability,
      emo.personality,
    );
    for (const [key, value] of Object.entries(params)) {
      eventBus.emit('param:update', { key, value });
    }

    // ===== 3. 特殊动画触发（基于文本内容） =====
    const anim = this.selectAnimation(text, emotion);
    if (anim) {
      eventBus.emit('animation:trigger', { name: anim, duration: 3000 });
    }
  }

  /** 根据情绪+强度选择表情 */
  private selectExpression(emotion: EmotionType, intensity: number): string {
    const map: Record<EmotionType, string> = {
      idle: '',
      happy: 'Happy',
      sad: intensity > 0.7 ? 'Sad2' : 'Sad1',
      thinking: 'Wink',
      surprised: 'StarEye',
      talking: 'MouthChange',
      angry: 'Angry',
      shy: 'Shy',
      excited: 'StarEye',
      curious: 'Wink',
      sleepy: 'Halfeyes',
    };
    return map[emotion] ?? '';
  }

  /** 计算模型参数（Cheek脸红、Angry青筋等） */
  private computeParams(
    emotion: EmotionType,
    intensity: number,
    favorability: number,
    _personality?: {
      cheerfulness: number;
      sensitivity: number;
      sociability: number;
      energy: number;
    },
  ): Record<string, number> {
    const params: Record<string, number> = {};

    // 脸红：害羞/开心/好感度高时
    if (emotion === 'shy' && intensity > 0.5) {
      params.ParamCheek = Math.min(1, intensity * 1.2);
    } else if (emotion === 'happy' && favorability >= 70 && intensity > 0.6) {
      params.ParamCheek = Math.min(1, intensity * 0.4);
    }

    // 青筋：生气时
    if (emotion === 'angry' && intensity > 0.5) {
      params.ParamAngry = Math.min(1, intensity);
    }

    // 嘴型变化：说话时
    if (emotion === 'talking') {
      params.ParamMouthOpenY = Math.min(1, intensity * 0.8);
    }

    return params;
  }

  /** 根据文本内容触发特殊动画 */
  private selectAnimation(text: string, _emotion: EmotionType): string | null {
    const lower = text.toLowerCase();
    if (/嘿嘿|嘻嘻|哈哈|lol|😄|🤣/.test(lower)) return 'laugh';
    if (/拜拜|再见|晚安|bye/.test(lower)) return 'wave';
    if (/跳|蹦|跃|jump/.test(lower)) return 'jump';
    if (/哭|😢|😭|伤心/.test(lower)) return 'cry';
    if (/吓|惊|😱|😮|wow/.test(lower)) return 'surprise';
    return null;
  }
}
