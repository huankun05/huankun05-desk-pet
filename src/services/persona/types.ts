/**
 * Persona System — 人格系统类型定义
 *
 * 借鉴 AstrBot persona_mgr.py，支持：
 * - 多个人设切换
 * - 每个 Persona 绑定独立的 system_prompt / few-shot / tools / skills
 * - 多层 Prompt 叠加（base → personality → mood → relationship → time → few-shot）
 */

import type { Personality } from '../../hooks/useEmotion';

// ===== CharacterProfile =====

/** 单个人设定义 */
export interface CharacterProfile {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 角色核心 system prompt */
  systemPrompt: string;
  /** Few-shot 对话示例（偶数条，交替 user/assistant） */
  beginDialogs: string[];
  /** 每种心情的额外 prompt 片段（可选） */
  moodPrompts: Record<string, string>;
  /** 绑定的工具列表：null = 全部可用，[] = 无工具 */
  tools?: string[] | null;
  /** 绑定的技能列表：null = 全部可用，[] = 无技能 */
  skills?: string[] | null;
  /** 自定义错误消息 */
  customErrorMessage?: string;
  /** 所属文件夹 ID */
  folderId?: string;
  /** 排序权重（越小越靠前） */
  sortOrder: number;
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

/** 人设文件夹 */
export interface PersonaFolder {
  id: string;
  name: string;
  sortOrder: number;
}

// ===== Personality Layer（多层 Prompt 叠加引擎） =====

/** Prompt 叠加层类型 */
export type PromptLayerType =
  | 'base' // 角色基底
  | 'personality' // 性格参数转换
  | 'mood' // 心情影响语气
  | 'emotion' // 情绪即时影响
  | 'relationship' // 好感度关系状态
  | 'time' // 时段上下文
  | 'fewShot' // Few-shot 示例
  | 'rules' // 用户自定义规则
  | 'liveMode'; // Live Mode 额外指令

/** 单层 Prompt 片段 */
export interface PromptLayer {
  type: PromptLayerType;
  /** 优先级（数字越小越靠前，即在 system prompt 越前面） */
  priority: number;
  /** 生成的 prompt 文本片段 */
  content: string;
  /** 该层是否启用 */
  enabled: boolean;
}

/** 多层 Prompt 栈 */
export interface PromptStack {
  layers: PromptLayer[];
  /** 是否启用 Live Mode（主动互动模式） */
  liveMode: boolean;
}

// ===== 人格解析上下文 =====

export interface PersonaResolutionContext {
  /** 当前性格参数 */
  personality: Personality;
  /** 当前心情 */
  mood: string;
  moodIntensity: number;
  /** 当前情绪 */
  emotion: string;
  emotionIntensity: number;
  /** 好感度 */
  favorability: number;
  /** 当前时间 */
  now: Date;
  /** 用户自定义规则列表 */
  rules?: string[];
  /** 是否启用 Live Mode */
  liveMode?: boolean;
}

// ===== 人格存储 =====

export interface PersonaStore {
  /** 当前活跃的人设 ID */
  activePersonaId: string;
  /** 所有人设 */
  profiles: CharacterProfile[];
  /** 文件夹 */
  folders: PersonaFolder[];
}
