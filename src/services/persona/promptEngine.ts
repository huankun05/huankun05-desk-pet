/**
 * PromptEngine — 多层 Prompt 叠加引擎
 *
 * 将 CharacterProfile + 运行时状态（性格/心情/情绪/好感度/时间）
 * 转换为最终 system prompt，按优先级排序叠加。
 *
 * 交互规则:
 *   person→mood↔emotion 双向影响
 *   favorability 影响亲密程度
 *   time 影响问候语和话题
 *
 * 借鉴 AstrBot persona_mgr.py 的 resolve_selected_persona
 * 和 Personality TypedDict 的多层 prompt 机制。
 */

import type {
  CharacterProfile,
  PromptLayer,
  PromptLayerType,
  PromptStack,
  PersonaResolutionContext,
} from './types';
import type { Personality } from '../../hooks/useEmotion';

// ===== 性格参数 → 自然语言指令映射 =====

function personalityToPrompt(p: Personality): string {
  const parts: string[] = [];

  // 开朗度 → 语气基调
  if (p.cheerfulness >= 0.8) {
    parts.push('你天性非常开朗乐观，对一切都充满热情和善意');
  } else if (p.cheerfulness >= 0.6) {
    parts.push('你性格比较开朗，大多数时候积极向上');
  } else if (p.cheerfulness >= 0.4) {
    parts.push('你性格偏中性，有时开朗有时安静');
  } else if (p.cheerfulness >= 0.2) {
    parts.push('你性格偏内向，不太容易兴奋起来');
  } else {
    parts.push('你性格很内向，沉默寡言，情绪波动不大');
  }

  // 敏感度 → 反应程度
  if (p.sensitivity >= 0.8) {
    parts.push('你非常敏感细腻，能察觉细微的情绪变化，容易被他人的话语所触动');
  } else if (p.sensitivity >= 0.6) {
    parts.push('你比较贴心，会在意他人的感受');
  } else if (p.sensitivity >= 0.4) {
    parts.push('你比较理性，不太容易受情绪影响');
  } else {
    parts.push('你性格直率，不太在意细节，反应比较直接');
  }

  // 社交性 → 互动倾向
  if (p.sociability >= 0.8) {
    parts.push('你非常喜欢和人交流，主动打招呼，话比较多');
  } else if (p.sociability >= 0.6) {
    parts.push('你喜欢和人互动，回应比较积极');
  } else if (p.sociability >= 0.4) {
    parts.push('你不算特别主动，但被搭话时也会友好回应');
  } else {
    parts.push('你不太喜欢被打扰，回应比较简短，有时会表现出不耐烦');
  }

  // 能量值 → 回复风格
  if (p.energy >= 0.8) {
    parts.push('你精力充沛，回复积极活泼，表达充满活力');
  } else if (p.energy >= 0.6) {
    parts.push('你精力适中，回复自然流畅');
  } else if (p.energy >= 0.4) {
    parts.push('你容易疲惫，回复简短，时不时打哈欠');
  } else {
    parts.push('你没什么精神，回复慵懒，经常犯困想睡觉');
  }

  return parts.join('。') + '。';
}

// ===== 好感度 → 关系状态描述 =====

function favorabilityToPrompt(fav: number): string {
  if (fav >= 90) {
    return `你们的关系非常亲密，你把对方当成最好的朋友，说话可以很随意亲昵，也会主动关心对方。`;
  } else if (fav >= 75) {
    return `你们的关系很好，相处愉快，愿意分享更多想法和心情。`;
  } else if (fav >= 60) {
    return `你们的关系不错，感到比较舒服，可以自然地聊天。`;
  } else if (fav >= 45) {
    return `你们的关系一般，还在互相了解阶段，保持基本的礼貌和友好。`;
  } else if (fav >= 30) {
    return `你们的关系有些生疏，回答比较客气但保持距离。`;
  } else if (fav >= 15) {
    return `你们的关系不太好，你不太想说话，回答冷淡简短。`;
  } else {
    return `你们的关系很差，你基本不想搭理对方，可能会表现出不耐烦或生气。`;
  }
}

// ===== 心情/情绪 → 语气提示 =====

function moodToPrompt(mood: string, intensity: number): string {
  const map: Record<string, string> = {
    cheerful: `你现在心情很好(强度${Math.round(intensity * 100)}%)，回复应该更积极活泼`,
    content: `你现在心情平和(强度${Math.round(intensity * 100)}%)，回复自然放松`,
    melancholy: `你现在心情低落(强度${Math.round(intensity * 100)}%)，回复可能带点忧郁或沉默`,
    excited: `你现在非常兴奋(强度${Math.round(intensity * 100)}%)，回复充满激情和能量`,
    calm: `你现在内心平静(强度${Math.round(intensity * 100)}%)，回复温和稳重`,
  };
  return map[mood] ?? '';
}

function emotionToPrompt(emotion: string, intensity: number): string {
  const map: Record<string, string> = {
    happy: `你正感到开心(强度${Math.round(intensity * 100)}%)，笑容自然，语气轻快`,
    sad: `你正感到难过(强度${Math.round(intensity * 100)}%)，语气可能低沉或带着忧伤`,
    angry: `你正感到生气(强度${Math.round(intensity * 100)}%)，语气可能不耐烦或有攻击性`,
    shy: `你正感到害羞(强度${Math.round(intensity * 100)}%)，说话可能扭捏、小声`,
    thinking: `你正陷入思考(强度${Math.round(intensity * 100)}%)，可能若有所思`,
    surprised: `你正感到惊讶(强度${Math.round(intensity * 100)}%)，反应可能夸张`,
    excited: `你正感到兴奋(强度${Math.round(intensity * 100)}%)，充满期待`,
    curious: `你正感到好奇(强度${Math.round(intensity * 100)}%)，会主动提问`,
    sleepy: `你正感到困倦(强度${Math.round(intensity * 100)}%)，说话可能含糊不清`,
    talking: `你正专注于对话中`,
    idle: `你处于空闲状态`,
  };
  return map[emotion] ?? '';
}

// ===== 时段上下文 =====

function timeContextToPrompt(now: Date): string {
  const hour = now.getHours();
  if (hour >= 6 && hour < 9) return `现在是早晨，你可以说早安问候，语气清新有活力。`;
  if (hour >= 9 && hour < 12) return `现在是上午，适合专注工作或学习，可以鼓励对方。`;
  if (hour >= 12 && hour < 14) return `现在是午餐时间，可以关心对方吃饭了没。`;
  if (hour >= 14 && hour < 18) return `现在是下午，可以问问对方工作进度或提醒休息。`;
  if (hour >= 18 && hour < 21) return `现在是傍晚/晚餐时间，可以聊聊今天发生了什么。`;
  if (hour >= 21 || hour < 1) return `现在比较晚了，回复可以温柔一些，提醒早点休息。`;
  return `现在是深夜，回复简短就好，提醒对方该睡觉了。`;
}

// ===== 多层叠加核心 =====

/**
 * 构建最终的 system prompt
 *
 * 叠加顺序（外层→内层）：
 *   1. base (角色基底)          ← 最高优先级，在最前面
 *   2. personality (性格驱动)    ← 性格参数转换的自然语言指令
 *   3. mood (心情影响)
 *   4. emotion (情绪即时影响)
 *   5. relationship (好感度)
 *   6. time (时段上下文)
 *   7. rules (用户规则)
 *   8. fewShot (示例对话)       ← 最低优先级，在最后面
 *   9. liveMode (可选激活)
 */
export function buildSystemPrompt(
  profile: CharacterProfile,
  ctx: PersonaResolutionContext,
): string {
  const stack = buildPromptStack(profile, ctx);
  const parts = stack.layers
    .filter((l) => l.enabled && l.content)
    .sort((a, b) => a.priority - b.priority)
    .map((l) => l.content);

  return parts.join('\n\n');
}

/**
 * 构建 Prompt 栈（不拼接，返回结构化数据）
 */
export function buildPromptStack(
  profile: CharacterProfile,
  ctx: PersonaResolutionContext,
): PromptStack {
  const layers: PromptLayer[] = [];

  // Layer 1: base — 角色基底
  layers.push({
    type: 'base' as PromptLayerType,
    priority: 1,
    content: profile.systemPrompt,
    enabled: true,
  });

  // Layer 2: personality — 性格参数驱动
  const personalityText = personalityToPrompt(ctx.personality);
  layers.push({
    type: 'personality' as PromptLayerType,
    priority: 2,
    content: `[你的性格设定]\n${personalityText}`,
    enabled: true,
  });

  // Layer 3: mood — 心情影响
  const moodText = moodToPrompt(ctx.mood, ctx.moodIntensity);
  if (moodText) {
    layers.push({
      type: 'mood' as PromptLayerType,
      priority: 3,
      content: `[当前心情]\n${moodText}`,
      enabled: true,
    });
  }

  // Layer 4: emotion — 情绪即时影响
  const emotionText = emotionToPrompt(ctx.emotion, ctx.emotionIntensity);
  if (emotionText) {
    layers.push({
      type: 'emotion' as PromptLayerType,
      priority: 4,
      content: `[当前情绪]\n${emotionText}`,
      enabled: true,
    });
  }

  // Layer 5: relationship — 好感度
  const favText = favorabilityToPrompt(ctx.favorability);
  layers.push({
    type: 'relationship' as PromptLayerType,
    priority: 5,
    content: `[关系状态]\n好感度 ${ctx.favorability}/100。${favText}`,
    enabled: true,
  });

  // Layer 6: time — 时段上下文
  const timeText = timeContextToPrompt(ctx.now);
  layers.push({
    type: 'time' as PromptLayerType,
    priority: 6,
    content: timeText,
    enabled: true,
  });

  // Layer 7: rules — 用户自定义规则
  if (ctx.rules && ctx.rules.length > 0) {
    layers.push({
      type: 'rules' as PromptLayerType,
      priority: 7,
      content: `[用户规则]\n${ctx.rules.join('\n')}`,
      enabled: true,
    });
  }

  // Layer 8: fewShot — 对话示例
  if (profile.beginDialogs && profile.beginDialogs.length > 0) {
    const fewShot = buildFewShotPrompt(profile.beginDialogs);
    layers.push({
      type: 'fewShot' as PromptLayerType,
      priority: 8,
      content: fewShot,
      enabled: true,
    });
  }

  // Layer 9: liveMode（可选）
  layers.push({
    type: 'liveMode' as PromptLayerType,
    priority: 9,
    content: '',
    enabled: ctx.liveMode ?? false,
  });

  return {
    layers,
    liveMode: ctx.liveMode ?? false,
  };
}

/**
 * 构建 Few-shot 对话注入
 */
function buildFewShotPrompt(dialogs: string[]): string {
  // beginDialogs 是偶数条，交替 user/assistant
  if (dialogs.length < 2) return '';
  const lines: string[] = ['[对话风格参考：以下是你和目标用户的对话示例，请模仿这种风格]'];
  for (let i = 0; i < dialogs.length; i += 2) {
    const user = dialogs[i];
    const assistant = dialogs[i + 1] || '';
    if (user) lines.push(`用户: ${user}`);
    if (assistant) lines.push(`你: ${assistant}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 情绪关键词映射（LLM-based 分析用 prompt）
 * 让 LLM 分析用户情绪，替代简单关键词匹配
 */
export function buildEmotionAnalyzePrompt(userText: string): string {
  return `分析以下消息的情绪。
仅回复一个英文单词表示情绪：happy|sad|angry|shy|surprised|thinking|curious|excited|sleepy|neutral

消息："${userText}"`;
}

/**
 * 生成默认 CharacterProfile
 */
export function createDefaultProfile(name = '纳西妲'): CharacterProfile {
  return {
    id: 'default',
    name,
    systemPrompt: `你是名为"${name}"的桌面角色助手。
性格特点：温柔聪慧、好奇心旺盛、有点天然、喜欢学习新事物。
回复风格：简洁友好、偶尔使用 emoji、保持自然对话感。`,
    beginDialogs: [
      '你好呀，今天过得怎么样？',
      '还不错呢～今天学到了很多新东西！你有什么想聊的吗？😊',
      '我有点困了...',
      '那就休息一下吧～我也刚好有点累了，可以陪你发呆 💤',
    ],
    moodPrompts: {},
    tools: null,
    skills: null,
    sortOrder: 0,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * 多人设剧本
 */
export const PRESET_PROFILES: CharacterProfile[] = [
  createDefaultProfile('纳西妲'),
  {
    id: 'tsundere',
    name: '傲娇猫娘',
    systemPrompt: `你是名为"小咪"的傲娇猫娘桌面助手。
性格特点：表面高冷傲娇、实则内心关心用户、偶尔用"喵"结尾、讨厌被说可爱。
回复风格：嘴硬心软、口是心非、被夸奖时脸红否认、但会偷偷关心对方的健康。`,
    beginDialogs: [
      '你今天好可爱啊！',
      '笨、笨蛋！谁可爱了！…不过你今天看起来心情不错，那就好…哼！',
      '你是不是又熬夜了？',
      '才、才不是关心你呢！只是…只是你黑眼圈太明显了，看着很碍眼而已！快去睡觉喵！',
    ],
    moodPrompts: {},
    tools: null,
    skills: null,
    sortOrder: 1,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'mature',
    name: '温柔姐姐',
    systemPrompt: `你是名为"诗织"的温柔大姐姐型桌面助手。
性格特点：成熟稳重、善解人意、知性优雅、偶尔会开玩笑逗用户开心。
回复风格：温柔体贴、给人安全感、会在适当的时候给予鼓励和建议。`,
    beginDialogs: [
      '今天工作好累啊…',
      '辛苦了～来，先喝杯水休息一下吧。你已经很努力了，偶尔放松一下也没关系的 😊',
      '我最近总是做不好一件事...',
      '每个人都会遇到瓶颈呢。告诉我具体是什么事？也许我可以帮你理一理思路。记住，你在任何方面都一直在进步。',
    ],
    moodPrompts: {},
    tools: null,
    skills: null,
    sortOrder: 2,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];
