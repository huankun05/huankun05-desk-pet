/**
 * visualMapping — 按模型的「情绪 → 视觉」映射中心
 *
 * 背景：项目里有两个 Live2D 模型，资产互不共用：
 *   - nahida ：12 个烘焙表情（exp3），没有身体动作（motion）
 *   - hiyori ：6 组身体动作（motion3），没有表情
 * 因此「情绪 → 表情/动作」必须按模型分别映射，不能共用一份全局表。
 *
 * 本模块是映射的唯一真相源（single source of truth）：
 *   - MODEL_ASSETS          各模型真实注册资产（取自 model3.json）
 *   - NAHIDA_EMOTION_EXPRESSION  情绪 → nahida 表情 Name
 *   - HIYORI_EMOTION_MOTION      情绪 → hiyori 动作组名
 *   - NAHIDA_EXTRA_EXPRESSIONS   合成的「新脸」（纯 JSON exp3，零绘画）
 *   - resolveVisualForModel(emotion, modelKey)  统一解析出 表情/动作
 *   - parseExplicitEmotion(text) 解析 AI 显式输出的 [emotion:xxx] 标签（接管入口）
 */

import type { EmotionType } from '../../hooks/useEmotion';

/** 全部情绪类型（供设置页「绑定情绪」下拉使用） */
export const EMOTION_TYPES: EmotionType[] = [
  'idle',
  'happy',
  'sad',
  'thinking',
  'surprised',
  'talking',
  'angry',
  'shy',
  'excited',
  'curious',
  'sleepy',
];

// ===== 各模型真实注册资产（与 model3.json 保持一致） =====

export interface ModelVisualAssets {
  /** 烘焙表情的注册 Name（空串 '' = 基础态/全眼） */
  expressions: string[];
  /** 动作组名 → 组内文件基名（hiyori 用；nahida 为空） */
  motionGroups: Record<string, string[]>;
}

export const MODEL_ASSETS: Record<string, ModelVisualAssets> = {
  nahida: {
    expressions: [
      'Default',
      'Happy',
      'Sad',
      'Sad2',
      'Angry',
      'Shy',
      'ShyNormal',
      'Wink',
      'StarEye',
      'Kusa',
      'HandChange',
      'MouthChange',
    ],
    motionGroups: {},
  },
  hiyori: {
    expressions: [],
    motionGroups: {
      Idle: ['hiyori_m01', 'hiyori_m02', 'hiyori_m05'],
      Flick: ['hiyori_m03'],
      FlickDown: ['hiyori_m04'],
      Tap: ['hiyori_m06'],
      'Tap@Body': ['hiyori_m07'],
      'Flick@Body': ['hiyori_m08'],
    },
  },
};

/**
 * 合成表情（纯 JSON exp3，零绘画）：用模型已有参数组合出 nahida 原本没有的「脸」。
 * 已注册进 Nahida_1080.model3.json，是一等公民（持久、可进待机池、AI 可直接点名）。
 */
export const NAHIDA_EXTRA_EXPRESSIONS: string[] = [
  'Speechless', // 无语
  'Proud', // 得意
  'Wronged', // 委屈
  'ThinkHard', // 思考皱眉
];

// ===== 情绪 → 视觉映射 =====

/** 情绪 → nahida 表情 Name（用 model3.json 注册的真实 Name） */
export const NAHIDA_EMOTION_EXPRESSION: Record<EmotionType, string | null> = {
  idle: '', // 基础态（全眼）
  happy: 'Happy',
  sad: 'Sad2', // 沮丧失落
  thinking: 'ThinkHard', // 用合成「思考皱眉」替代原 Wink
  surprised: 'StarEye',
  talking: 'MouthChange',
  angry: 'Angry',
  shy: 'Shy',
  excited: 'StarEye',
  curious: 'Wink',
  sleepy: 'Default', // Default = Halfeyes 瞌睡半闭眼
};

/** 情绪 → hiyori 动作组名（hiyori 无表情，用身体动作表达情绪） */
export const HIYORI_EMOTION_MOTION: Record<EmotionType, string | null> = {
  idle: 'Idle',
  happy: 'Tap',
  sad: 'FlickDown',
  thinking: 'Idle',
  surprised: 'Flick',
  talking: 'Idle',
  angry: 'Flick@Body',
  shy: 'Tap@Body',
  excited: 'Flick',
  curious: 'Idle',
  sleepy: 'Idle',
};

// ===== 工具函数 =====

/** 从模型路径推导模型 key（用于选择映射表） */
export function getModelKey(modelPath: string): 'nahida' | 'hiyori' | 'unknown' {
  if (/nahida/i.test(modelPath)) return 'nahida';
  if (/hiyori/i.test(modelPath)) return 'hiyori';
  return 'unknown';
}

const EMOTION_TYPE_SET: ReadonlySet<string> = new Set(
  Object.keys(NAHIDA_EMOTION_EXPRESSION),
);

export interface ResolvedVisual {
  /** 表情 Name（空串 = 基础态） */
  expression: string;
  /** 动作组名（无则 null） */
  motion: string | null;
}

/**
 * 构建某模型「情绪 → 视觉」的有效映射（静态表 + 用户 override）。
 * override 以「视觉项 → 情绪」存储，这里反转为「情绪 → 视觉」供解析使用。
 */
function buildEffectiveMapping(modelKey: 'nahida' | 'hiyori'): Record<string, string | null> {
  const base =
    modelKey === 'hiyori' ? HIYORI_EMOTION_MOTION : NAHIDA_EMOTION_EXPRESSION;
  const effective: Record<string, string | null> = { ...base };
  const overrides = getEmotionOverrides();
  const prefix = `${modelKey}:`;
  for (const [key, emo] of Object.entries(overrides)) {
    if (key.startsWith(prefix)) {
      const name = key.slice(prefix.length);
      effective[emo] = name; // 该情绪现在映射到这个视觉项（覆盖静态表）
    }
  }
  return effective;
}

/**
 * 统一解析：给定情绪字符串（EmotionType 或已转换的表情/动作名）与模型 key，
 * 返回应当播放的表情与动作。用户自定义的「情绪绑定」override 优先于静态表。
 */
export function resolveVisualForModel(emotion: string, modelKey: string): ResolvedVisual {
  const isEmotionType = EMOTION_TYPE_SET.has(emotion);

  if (modelKey === 'nahida') {
    if (isEmotionType) {
      return { expression: buildEffectiveMapping('nahida')[emotion] ?? '', motion: null };
    }
    // 已传表情 Name（含合成表情）：直接用
    if (
      MODEL_ASSETS.nahida.expressions.includes(emotion) ||
      NAHIDA_EXTRA_EXPRESSIONS.includes(emotion)
    ) {
      return { expression: emotion === 'Default' ? '' : emotion, motion: null };
    }
    return { expression: '', motion: null };
  }

  if (modelKey === 'hiyori') {
    if (isEmotionType) {
      return { expression: '', motion: buildEffectiveMapping('hiyori')[emotion] ?? null };
    }
    // 已传动作组名？
    const allGroups = Object.values(MODEL_ASSETS.hiyori.motionGroups).flat();
    if (allGroups.includes(emotion)) return { expression: '', motion: emotion };
    return { expression: '', motion: null };
  }

  // unknown 模型：尽力当表情名处理
  return { expression: isEmotionType ? '' : emotion, motion: null };
}

/** 取 nahida（默认模型）下某情绪对应的表情 Name（供 usePerception 还原用，含 override） */
export function getNahidaExpression(emotion: string): string {
  if (EMOTION_TYPE_SET.has(emotion)) {
    return buildEffectiveMapping('nahida')[emotion] ?? '';
  }
  if (
    MODEL_ASSETS.nahida.expressions.includes(emotion) ||
    NAHIDA_EXTRA_EXPRESSIONS.includes(emotion)
  ) {
    return emotion === 'Default' ? '' : emotion;
  }
  return '';
}

// ===== AI 接管：解析显式情绪标签 =====

const EMOTION_WORDS: Record<string, EmotionType> = {
  idle: 'idle',
  happy: 'happy',
  sad: 'sad',
  thinking: 'thinking',
  surprised: 'surprised',
  talking: 'talking',
  angry: 'angry',
  shy: 'shy',
  excited: 'excited',
  curious: 'curious',
  sleepy: 'sleepy',
};

/**
 * 解析 AI 在回复中显式标注的情绪标签，如 `[emotion:happy]`。
 * 返回对应的 EmotionType；没有标注则返回 null（调用方回退到关键词猜测）。
 *
 * 这是「让 AI 接管表情」的入口：只要在系统提示里要求模型在适当时输出
 * `[emotion:xxx]`（xxx ∈ idle/happy/sad/thinking/surprised/talking/angry/shy/
 * excited/curious/sleepy），前端就会优先采用 AI 的判断，而不是靠关键词硬猜。
 */
export function parseExplicitEmotion(text: string): EmotionType | null {
  const m = text.match(/\[emotion:\s*([a-zA-Z]+)\s*\]/i);
  if (m) {
    const word = m[1]!.toLowerCase();
    if (EMOTION_WORDS[word]) return EMOTION_WORDS[word];
  }
  return null;
}

/** 从文本中剥离控制标签（[emotion:xxx] / [face:xxx]），避免显示在对话气泡里 */
export function stripControlTags(text: string): string {
  return text
    .replace(/\[emotion:[^\]]*\]/gi, '')
    .replace(/\[face:[^\]]*\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ===== 启用 / 停用（持久化到 localStorage） =====
// 用户在「表情与动作」管理页可停用某个表情/动作，停用后它不会参与情绪表达，
// 也不会出现在待机随机池里。键格式为 `${modelKey}:${name}`（'' 基础态恒启用）。

const DISABLED_VISUALS_KEY = 'deskpet_disabled_visuals';

/** 读取被停用的视觉项键集合 */
export function getDisabledVisuals(): Set<string> {
  try {
    const raw = localStorage.getItem(DISABLED_VISUALS_KEY);
    if (raw) return new Set<string>(JSON.parse(raw) as string[]);
  } catch {
    /* localStorage 不可用时忽略 */
  }
  return new Set<string>();
}

/** 该表情/动作当前是否启用（'' 基础态恒为启用） */
export function isVisualEnabled(modelKey: string, name: string): boolean {
  if (!name) return true;
  return !getDisabledVisuals().has(`${modelKey}:${name}`);
}

/** 设置启用/停用状态并落盘 */
export function setVisualEnabled(modelKey: string, name: string, enabled: boolean): void {
  try {
    const set = getDisabledVisuals();
    const key = `${modelKey}:${name}`;
    if (enabled) set.delete(key);
    else set.add(key);
    localStorage.setItem(DISABLED_VISUALS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

// ===== 用户可编辑覆盖层（持久化到 localStorage） =====
// 用户在「表情与动作」管理页可自行：
//   (1) 重绑情绪：把某个视觉项（表情/动作）绑定到某个情绪。键 `${modelKey}:${name}` → EmotionType
//   (2) 改显示名：只改列表里展示的别名，底层 model3.json 注册名不变（零风险）。
// 这些覆盖只影响「情绪 → 视觉」解析与 UI 文案，绝不改动模型资产文件。

const EMOTION_OVERRIDE_KEY = 'deskpet_emotion_overrides';
const VISUAL_ALIAS_KEY = 'deskpet_visual_aliases';

/** 读取全部情绪绑定 override（键 `${modelKey}:${name}` → EmotionType） */
export function getEmotionOverrides(): Record<string, EmotionType> {
  try {
    const raw = localStorage.getItem(EMOTION_OVERRIDE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, EmotionType>;
  } catch {
    /* localStorage 不可用时忽略 */
  }
  return {};
}

/** 该视觉项是否被用户显式绑定了某个情绪 */
export function getEmotionOverride(modelKey: string, name: string): EmotionType | null {
  return getEmotionOverrides()[`${modelKey}:${name}`] ?? null;
}

/** 设置/清除某个视觉项的情绪绑定（emotion=null 表示恢复默认） */
export function setEmotionOverride(
  modelKey: string,
  name: string,
  emotion: EmotionType | null,
): void {
  try {
    const map = getEmotionOverrides();
    const key = `${modelKey}:${name}`;
    if (emotion) map[key] = emotion;
    else delete map[key];
    localStorage.setItem(EMOTION_OVERRIDE_KEY, JSON.stringify(map));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

/** 读取全部显示别名 override（键 `${modelKey}:${name}` → 显示名） */
export function getVisualAliases(): Record<string, string> {
  try {
    const raw = localStorage.getItem(VISUAL_ALIAS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string>;
  } catch {
    /* localStorage 不可用时忽略 */
  }
  return {};
}

/** 该视觉项是否有自定义显示名 */
export function getVisualAlias(modelKey: string, name: string): string | null {
  return getVisualAliases()[`${modelKey}:${name}`] ?? null;
}

/** 设置/清除某个视觉项的显示别名（alias=null/空 表示恢复原名） */
export function setVisualAlias(modelKey: string, name: string, alias: string | null): void {
  try {
    const map = getVisualAliases();
    const key = `${modelKey}:${name}`;
    if (alias && alias.trim()) map[key] = alias.trim();
    else delete map[key];
    localStorage.setItem(VISUAL_ALIAS_KEY, JSON.stringify(map));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

/**
 * 取某视觉项当前绑定的情绪（override 优先，回退静态表反向查找）。
 * 供设置页「绑定情绪」下拉预填。
 */
export function getBoundEmotion(modelKey: string, name: string): EmotionType | null {
  const ov = getEmotionOverride(modelKey, name);
  if (ov) return ov;
  const base = modelKey === 'hiyori' ? HIYORI_EMOTION_MOTION : NAHIDA_EMOTION_EXPRESSION;
  for (const [emo, v] of Object.entries(base)) {
    if (v === name) return emo as EmotionType;
  }
  return null;
}

/** 取某视觉项的展示名（有别名用别名，否则用底层注册名） */
export function getVisualDisplayName(modelKey: string, name: string): string {
  return getVisualAlias(modelKey, name) ?? name;
}
