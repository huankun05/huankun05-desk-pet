import type {
  EmotionState,
  EmotionHistoryEntry,
  Personality,
  EmotionConfig,
} from '../hooks/useEmotion';

/**
 * 主窗 → 状态面板 的情绪跨窗同步（Tauri 全局事件）。
 *
 * 背景：Tauri2 多 webview 下 localStorage 的 storage 事件不一定跨窗触发，
 * 状态面板原先靠 2s 轮询读 localStorage 同步，改为事件驱动 + 低频兜底。
 */
export const EMOTION_CHANGED_EVENT = 'deskpet:emotion-changed';

const DEFAULT_PERSONALITY: Personality = {
  cheerfulness: 0.7,
  sensitivity: 0.6,
  sociability: 0.8,
  energy: 0.7,
};

const DEFAULT_CONFIG: EmotionConfig = {
  decayInterval: 120000,
  decayMood: 0.01,
  decayEmotion: 0.03,
  idleDecayStart: 900000,
  cooldownMs: 3000,
  cooldownFactor: 0.3,
  maxIntensityPerAction: 0.9,
  favPatHead: 3,
  favTapBody: 1,
  favStepFoot: -5,
  favTalk: 2,
  favTooMuch: -2,
};

/**
 * 把外部载荷（localStorage JSON 对象 / Tauri 事件 payload）规整为完整 EmotionState。
 * 事件 payload 与 localStorage 里存的字段结构一致（lastChange 可能是 ISO 字符串）。
 */
export function normalizeEmotionState(p: Record<string, unknown>): EmotionState {
  return {
    mood: (p.mood as EmotionState['mood']) || 'cheerful',
    moodIntensity: (p.moodIntensity as number) ?? 0.7,
    emotion: (p.emotion as EmotionState['emotion']) || 'happy',
    emotionIntensity: (p.emotionIntensity as number) ?? 0.8,
    favorability: (p.favorability as number) ?? 50,
    personality: {
      ...DEFAULT_PERSONALITY,
      ...(p.personality as Partial<Personality>),
    },
    config: {
      ...DEFAULT_CONFIG,
      ...(p.config as Partial<EmotionConfig>),
    },
    lastChange: p.lastChange ? new Date(p.lastChange as string | number) : new Date(),
    reason: (p.reason as string) || '',
  };
}

/** 读取 localStorage 中的情绪快照（不存在返回 null） */
export function readEmotionSnapshot(): EmotionState | null {
  try {
    const raw = localStorage.getItem('deskpet_emotion');
    if (!raw) return null;
    return normalizeEmotionState(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** 读取 localStorage 中的情绪历史（不存在返回空数组） */
export function readEmotionHistory(): EmotionHistoryEntry[] {
  try {
    const raw = localStorage.getItem('deskpet_emotionHistory');
    if (raw) return JSON.parse(raw) as EmotionHistoryEntry[];
  } catch {
    /* ignore */
  }
  return [];
}
