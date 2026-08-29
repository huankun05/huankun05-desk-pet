// ===== 持久化键 =====
export const INTERACTION_CONFIG_KEY = 'deskpet_interaction_config';

export interface InteractionConfig {
  /** 点击语言冷却时间（毫秒） */
  clickCooldownMs: number;
  /** 是否启用预制台词 TTS */
  enableInteractTTS: number;
  /** 是否启用语音识别智能润色（LLM 纠正同音错字 + 结合上下文理解） */
  enableSTTPolish: number;
}

export const DEFAULT_INTERACTION_CONFIG: InteractionConfig = {
  clickCooldownMs: 3000,
  enableInteractTTS: 0,
  enableSTTPolish: 0,
};

/** 读取交互配置 */
export function loadInteractionConfig(): InteractionConfig {
  try {
    const raw = localStorage.getItem(INTERACTION_CONFIG_KEY);
    if (raw)
      return { ...DEFAULT_INTERACTION_CONFIG, ...(JSON.parse(raw) as Partial<InteractionConfig>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_INTERACTION_CONFIG };
}

/** 保存交互配置 */
export function saveInteractionConfig(config: InteractionConfig): void {
  localStorage.setItem(INTERACTION_CONFIG_KEY, JSON.stringify(config));
}
