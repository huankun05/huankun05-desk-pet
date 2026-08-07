/**
 * PersonalityInjectStage — 人格注入阶段
 *
 * 位置：MemoryStage 之后，LLMStage 之前
 *
 * 使用 PersonaManager + PromptEngine 动态构建 system prompt，
 * 替代此前 openai/chat.ts 中简单的 getSystemPrompt() 字符串拼接。
 *
 * 多层叠加：
 *   base → personality → mood → emotion → relationship → time → rules → fewShot
 */

import type { Stage, MessageContext, PipelineCallbacks } from '../types';
import { personaManager } from '../../persona/manager';
import { buildSystemPrompt } from '../../persona/promptEngine';
import type { PersonaResolutionContext, CharacterProfile } from '../../persona/types';
import type { Personality } from '../../../hooks/useEmotion';

/** 读取全局默认提示词（直接从 localStorage 读取，避免缓存不一致） */
function getGlobalPrompt(): string {
  try {
    return localStorage.getItem('deskpet_deskpet_global_system_prompt') ?? '';
  } catch {
    return '';
  }
}

export class PersonalityInjectStage implements Stage {
  readonly name = 'personality-inject';

  async process(ctx: MessageContext, _callbacks: PipelineCallbacks): Promise<void> {
    // 等待人设管理器初始化
    await personaManager.ready;

    const profile = personaManager.getActiveProfile();
    const globalPrompt = getGlobalPrompt();

    // 如果角色没有单独设置提示词，使用全局默认提示词
    const effectiveProfile: CharacterProfile = {
      ...profile,
      systemPrompt: profile.systemPrompt || globalPrompt,
    };
    const emo = ctx.emotionSnapshot;

    const resolutionCtx: PersonaResolutionContext = {
      personality: {
        cheerfulness: emo.personality?.cheerfulness ?? 0.7,
        sensitivity: emo.personality?.sensitivity ?? 0.6,
        sociability: emo.personality?.sociability ?? 0.8,
        energy: emo.personality?.energy ?? 0.7,
      } as unknown as Personality,
      mood: emo.mood,
      moodIntensity: emo.moodIntensity,
      emotion: emo.emotion,
      emotionIntensity: emo.emotionIntensity,
      favorability: emo.favorability,
      now: new Date(),
    };

    const systemPrompt = buildSystemPrompt(effectiveProfile, resolutionCtx);

    // 将生成的 system prompt 合并到 memoryContext 前面
    // memoryContext 已包含记忆/规则等，人格层作为系统级前置
    if (ctx.memoryContext) {
      ctx.memoryContext = systemPrompt + '\n\n' + ctx.memoryContext;
    } else {
      ctx.memoryContext = systemPrompt;
    }
  }
}
