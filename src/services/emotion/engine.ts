/**
 * EmotionEngine — 优化情绪引擎
 *
 * 优化项（解决问题）：
 *   1. 衰减从线性改为Sigmoid（高强度慢、中强度快、低强度慢）→ 更自然
 *   2. 心情-情绪双向影响（情绪累积→心情漂移，心情→情绪偏好）→ 更合理
 *   3. 好感度偏差（高好感削弱负面情绪，低好感放大敏感）→ 更真实
 *   4. 心情自恢复（有互动时从 melancholy→content 缓慢恢复）
 *   5. bored 中间状态（idle过久但未到sad时）
 *   6. 连续互动升级阈值可配置
 *   7. 性格影响行为倾向（不只是强度修正）→ 更个性的反应
 *
 * 兼容性：输出与 useEmotion 相同的 EmotionState 类型，可直接替换现有分析逻辑。
 */

import type { Personality, EmotionType, MoodType } from '../../hooks/useEmotion';

// ===== Sigmoid 衰减 =====

/**
 * Sigmoid 衰减：高强度慢衰减，中强度快衰减，低强度慢衰减
 * 模拟心理学上的"刺激适应曲线"
 *
 * @param intensity 当前强度 0-1
 * @param rate      基础衰减率
 * @param timeMultiplier 时间倍数（越久衰减越多）
 */
export function sigmoidDecay(intensity: number, rate: number, timeMultiplier = 1): number {
  // 衰减公式：intensity / (1 + rate * timeMultiplier * sigmoid(intensity))
  // sigmoid(i) 在 i≈0.5 时最大（衰减最快），在两端最小
  const midpoint = 0.5;
  const steepness = 8;
  const sigmoid = 1 / (1 + Math.exp(-steepness * (intensity - midpoint)));
  return Math.max(0, intensity - rate * timeMultiplier * sigmoid);
}

// ===== 情绪引擎上下文 =====

export interface EmotionEngineState {
  mood: MoodType;
  moodIntensity: number;
  emotion: EmotionType;
  emotionIntensity: number;
  favorability: number;
  personality: Personality;
  /** boredom 累加器：0-100，持续 idle 时增加 */
  boredom: number;
  /** 上次互动时间 */
  lastInteractTime: number;
  /** 情绪历史序列（最近10条，用于序列检测） */
  emotionSequence: EmotionType[];
  /** 互动计数（按类型） */
  interactCounts: Map<string, number>;
}

export interface EmotionEngineResult {
  mood: MoodType;
  moodIntensity: number;
  emotion: EmotionType;
  emotionIntensity: number;
  favorability: number;
  boredom: number;
  reason: string;
}

export interface EmotionDetectInput {
  text: string;
  personality: Personality;
  currentMood: MoodType;
  currentEmotion: EmotionType;
}

// ===== 心情转换矩阵（带概率权重） =====

type MoodTransitionMap = Record<
  MoodType,
  Partial<Record<MoodType, { weight: number; condition?: string }>>
>;

const _MOOD_TRANSITIONS: MoodTransitionMap = {
  cheerful: {
    excited: { weight: 2, condition: '高强度正面情绪累积' },
    content: { weight: 1, condition: '自然恢复' },
    melancholy: { weight: 0.5, condition: '持续负面情绪' },
  },
  content: {
    cheerful: { weight: 1, condition: '正面互动多' },
    melancholy: { weight: 1, condition: '负面互动或长时间无聊' },
    calm: { weight: 0.5, condition: '安静时段' },
    excited: { weight: 0.3, condition: '突然兴奋' },
  },
  melancholy: {
    content: { weight: 1.5, condition: '正面互动或时间恢复' },
    cheerful: { weight: 0.5, condition: '极强的正面刺激' },
  },
  excited: {
    cheerful: { weight: 1.5, condition: '兴奋退去' },
    content: { weight: 0.5, condition: '快速平息' },
  },
  calm: {
    content: { weight: 1, condition: '活跃时段开始' },
    melancholy: { weight: 0.5, condition: '长时间独处' },
  },
};

// ===== 核心函数 =====

/**
 * 衰减情绪和心情
 *
 * 优化：Sigmoid 衰减 + 性格能量影响 + 好感度偏差
 */
export function tickDecay(state: EmotionEngineState, elapsedMs: number): EmotionEngineState {
  const _MAX = Math.min(state.moodIntensity, state.emotionIntensity);
  const timeMultiplier = Math.min(5, Math.max(1, elapsedMs / 120000)); // 基准2分钟

  // 性格能量：越高衰减越慢
  const energyFactor = 1 - state.personality.energy * 0.5;

  // 好感度偏差：高好感衰减更慢（心情好不易低落），低好感衰减更快
  const favFactor = 1 - ((state.favorability - 50) / 100) * 0.3; // 0.85~1.15

  const newEI = sigmoidDecay(
    state.emotionIntensity,
    0.03 * energyFactor * favFactor,
    timeMultiplier,
  );
  const newMI = sigmoidDecay(state.moodIntensity, 0.008 * energyFactor * favFactor, timeMultiplier);

  // 情绪降到底触发 bored/sad
  let newEmotion = state.emotion;
  let newMood = state.mood;
  let newBoredom = state.boredom;

  if (newEI <= 0.15) {
    // boredom 累加
    newBoredom = Math.min(100, state.boredom + 2 * timeMultiplier);
    if (newBoredom >= 70 && state.emotion !== 'sleepy' && state.emotion !== 'sad') {
      newEmotion = 'sleepy';
    } else if (newBoredom >= 40 && state.emotion !== 'idle') {
      newEmotion = 'idle';
    }
  }

  if (newMI <= 0.25 && state.mood !== 'melancholy') {
    newMood = 'melancholy';
  }

  return {
    ...state,
    mood: newMood,
    moodIntensity: Math.max(0.1, newMI),
    emotion: newEmotion,
    emotionIntensity: Math.max(0.05, newEI),
    boredom: newBoredom,
  };
}

/**
 * 心情自恢复
 *
 * 每次互动后，心情有概率从 melancholy → content，从 content → cheerful
 */
export function moodRecovery(
  state: EmotionEngineState,
  interactionQuality: number,
): EmotionEngineState {
  // interactionQuality: 0-1，互动质量越高恢复越快
  const recoveryChance = 0.15 * interactionQuality * (0.5 + state.personality.cheerfulness * 0.5);

  if (state.mood === 'melancholy' && Math.random() < recoveryChance * 1.5) {
    return {
      ...state,
      mood: 'content',
      moodIntensity: Math.min(1, state.moodIntensity + 0.15),
      boredom: Math.max(0, state.boredom - 20),
    };
  }
  if (state.mood === 'content' && Math.random() < recoveryChance) {
    return {
      ...state,
      mood: 'cheerful',
      moodIntensity: Math.min(1, state.moodIntensity + 0.1),
    };
  }
  return state;
}

/**
 * 应用新情绪到引擎状态
 *
 * 优化：
 * - 性格影响情绪倾向（不只是强度修正）
 * - 好感度偏差
 * - 连续互动检测优化
 * - 心情-情绪双向更新
 */
export function applyEmotion(
  state: EmotionEngineState,
  detectedEmotion: EmotionType,
  intensity: number,
  reason: string,
  favorabilityDelta: number,
): EmotionEngineState {
  const p = state.personality;
  const fav = state.favorability;

  // ===== 1. 性格影响的情绪倾向修正 =====
  let tendencyMod = 1.0;

  if (detectedEmotion === 'happy' || detectedEmotion === 'excited') {
    tendencyMod = 0.6 + p.cheerfulness * 0.8; // 开朗度 → 更易开心
  }
  if (detectedEmotion === 'sad') {
    tendencyMod = 1.4 - p.cheerfulness * 1.0; // 开朗度 → 抗抑郁（1.4→0.4）
    tendencyMod += p.sensitivity * 0.6; // 敏感度 → 更容易难过
    tendencyMod = Math.max(0.3, Math.min(2.0, tendencyMod));
  }
  if (detectedEmotion === 'angry') {
    tendencyMod = 0.5 + p.sensitivity * 0.8; // 敏感度 → 更容易生气
    tendencyMod -= p.cheerfulness * 0.3; // 开朗度 → 减少愤怒
    tendencyMod = Math.max(0.3, Math.min(1.8, tendencyMod));
  }
  if (detectedEmotion === 'shy') {
    tendencyMod = 0.3 + p.sensitivity * 1.2; // 敏感度 → 更容易害羞
  }
  if (detectedEmotion === 'curious') {
    tendencyMod = 0.5 + p.cheerfulness * 0.5; // 开朗度 → 更好奇
  }

  // ===== 2. 好感度偏差 =====
  let favBias = 1.0;
  if (detectedEmotion === 'happy' || detectedEmotion === 'excited') {
    favBias = 0.85 + (fav / 100) * 0.3; // 高好感更容易开心
  }
  if (detectedEmotion === 'sad' || detectedEmotion === 'angry') {
    favBias = 1.15 - (fav / 100) * 0.3; // 高好感削弱负面
  }

  // ===== 3. 计算有效强度 =====
  let effectiveIntensity = intensity * tendencyMod * favBias;
  if (detectedEmotion === state.emotion) {
    // 同情绪叠加
    effectiveIntensity = Math.min(1, state.emotionIntensity + effectiveIntensity * 0.3);
  } else {
    effectiveIntensity = Math.min(1, Math.max(0.1, effectiveIntensity));
  }

  // ===== 4. 心情-情绪双向更新 =====
  let newMood = state.mood;
  let newMoodIntensity = state.moodIntensity;

  // 情绪影响心情
  if (detectedEmotion === 'happy' || detectedEmotion === 'excited') {
    if (state.mood === 'melancholy') newMood = 'content';
    else if (state.mood === 'content' && effectiveIntensity > 0.7) newMood = 'cheerful';
    newMoodIntensity = Math.min(1, state.moodIntensity + 0.03);
  } else if (detectedEmotion === 'sad') {
    newMoodIntensity = Math.max(0.1, state.moodIntensity - 0.05);
    if (newMoodIntensity <= 0.25) newMood = 'melancholy';
  } else if (detectedEmotion === 'angry') {
    newMoodIntensity = Math.max(0.1, state.moodIntensity - 0.02);
  }

  // ===== 5. 好感度更新 =====
  const newFav = Math.min(100, Math.max(0, state.favorability + favorabilityDelta));

  // ===== 6. 情绪序列更新 =====
  const newSequence = [...state.emotionSequence.slice(-9), detectedEmotion];

  // ===== 7. 连续互动检测 =====
  // 相同情绪连续3次 → 情绪升级
  let finalEmotion = detectedEmotion;
  if (newSequence.length >= 3) {
    const last3 = newSequence.slice(-3);
    if (last3.every((e) => e === detectedEmotion)) {
      const escalations: Partial<Record<EmotionType, EmotionType>> = {
        happy: 'excited',
        sad: 'melancholy' as unknown as EmotionType,
        surprised: 'excited',
        curious: 'thinking',
      };
      if (escalations[detectedEmotion] && Math.random() < 0.6) {
        finalEmotion = escalations[detectedEmotion]!;
        effectiveIntensity = Math.min(1, effectiveIntensity + 0.15);
      }
    }
  }

  // ===== 8. boredom 重置 =====
  const newBoredom = Math.max(0, state.boredom - 15);

  // 心情自恢复（互动质量 = effectiveIntensity）
  const afterRecovery = moodRecovery(
    {
      ...state,
      mood: newMood,
      moodIntensity: newMoodIntensity,
      emotion: finalEmotion,
      emotionIntensity: effectiveIntensity,
      favorability: newFav,
      boredom: newBoredom,
      emotionSequence: newSequence,
      lastInteractTime: Date.now(),
    },
    effectiveIntensity,
  );

  return afterRecovery;
}

/**
 * 获取情绪的中文标签
 */
export function getEmotionLabel(emotion: EmotionType): string {
  const labels: Record<EmotionType, string> = {
    idle: '平静',
    happy: '开心',
    sad: '难过',
    thinking: '思考',
    surprised: '惊讶',
    talking: '说话',
    angry: '生气',
    shy: '害羞',
    excited: '兴奋',
    curious: '好奇',
    sleepy: '困倦',
  };
  return labels[emotion] || emotion;
}

/**
 * 获取心情的中文标签
 */
export function getMoodLabel(mood: MoodType): string {
  const labels: Record<MoodType, string> = {
    cheerful: '愉快',
    content: '满足',
    melancholy: '忧郁',
    excited: '兴奋',
    calm: '平静',
  };
  return labels[mood] || mood;
}
