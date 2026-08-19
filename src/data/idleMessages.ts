/**
 * 闲聊消息池 + 互动反馈消息
 */

export interface IdleMessage {
  time?: 'morning' | 'afternoon' | 'evening' | 'night';
  emotion?: string;
  messages: string[];
}

// 闲聊消息（根据时间和情感状态筛选）
export const IDLE_MESSAGES: IdleMessage[] = [
  // 通用闲聊
  {
    messages: [
      '在想什么呢？',
      '嘿嘿，我在这里哦~',
      '要不要聊聊天？',
      '今天过得怎么样呀？',
      '我发现了一个有趣的事情...',
      '你有没有什么想告诉我的？',
      '嗯...好想出去玩~',
      '你在忙什么呀？',
      '需要我帮忙吗？',
      '我觉得你今天看起来心情不错呢！',
    ],
  },
  // 时间相关
  {
    time: 'morning',
    messages: [
      '早上好呀！今天也要加油哦~',
      '早安~昨晚睡得好吗？',
      '新的一天开始啦！',
      '早上好！要不要来杯咖啡？',
    ],
  },
  {
    time: 'afternoon',
    messages: [
      '下午好~是不是有点累了？',
      '午后时光，适合休息一下呢~',
      '下午了，要不要起来活动活动？',
      '你已经工作好久了，休息一下吧~',
    ],
  },
  {
    time: 'evening',
    messages: [
      '晚上好~今天辛苦了！',
      '天黑了呢，记得吃晚饭哦~',
      '晚上好！今天有什么开心的事吗？',
      '夜晚了，要不要听首歌放松一下？',
    ],
  },
  {
    time: 'night',
    messages: [
      '这么晚了还不睡呀？',
      '夜深了...要注意休息哦',
      '晚安~早点睡觉吧！',
      '熬夜对身体不好哦~',
      '我都要困了...你还不睡吗？',
    ],
  },
  // 情感相关
  {
    emotion: 'sad',
    messages: [
      '不要难过啦，我陪着你呢~',
      '有什么不开心的事吗？跟我说说吧~',
      '呜...看到你不开心我也不开心...',
      '没关系的，一切都会好起来的！',
    ],
  },
  {
    emotion: 'happy',
    messages: [
      '嘿嘿，你开心我也开心！',
      '看到你笑我也想笑~',
      '你的快乐传染给我了！',
      '继续保持好心情哦~',
    ],
  },
  {
    emotion: 'thinking',
    messages: [
      '在想什么呢？需要我帮忙分析吗？',
      '看起来你在认真思考呢~',
      '有什么问题可以问我哦~',
      '思考的时候好认真呀~',
    ],
  },
  {
    emotion: 'angry',
    messages: [
      '别生气啦~气坏了身体不值得',
      '谁惹你生气了？我帮你出气！',
      '深呼吸~放松一下~',
      '生气的时候要记得喝水哦~',
    ],
  },
  {
    emotion: 'shy',
    messages: [
      '嗯...不要一直盯着人家看啦~',
      '脸...脸红了才不是因为你呢！',
      '哼...别以为我会害羞！',
      '你...你靠太近了啦！',
    ],
  },
  // 久未互动
  {
    emotion: 'lonely',
    messages: [
      '呜...你是不是把我忘了...',
      '好久没跟我说话了呢...',
      '我在这里等你回来...',
      '你去哪里了呀？我好想你~',
      '是不是不需要我了...呜呜...',
    ],
  },
];

// 互动反馈消息
export const INTERACT_MESSAGES = {
  headPat: [
    '诶？别摸头啦~',
    '嗯...好舒服...',
    '嘿嘿~再摸摸~',
    '头...头发会乱的啦！',
    '你这样摸我会害羞的...',
    '咕噜咕噜~（开心）',
  ],
  bodyTap: ['嘿嘿~', '干嘛呀~', '你好呀！', '拍什么拍~', '别闹~', '有事吗？'],
  stepFoot: ['好痛！踩我干嘛！', '呜...我的脚...', '你踩到我了啦！', '过分！', '哼！不理你了！'],
  tooMuchClick: [
    '好啦好啦~别一直点了！',
    '头...头好晕...',
    '停...停下来啦~',
    '你是不是很闲？',
    '我要生气了哦！',
  ],
  longNoInteract: ['你终于回来了！', '呜...等你好久了...', '我以为你不要我了呢...', '欢迎回来~'],
};

/** 获取当前时段 */
export function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/** 从数组中随机选一个 */
export function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 根据时间、情感和心情获取闲聊消息 */
export function getIdleMessage(emotion?: string, mood?: string): string {
  const timeOfDay = getTimeOfDay();
  // 使用自定义消息（优先）或默认消息
  const messages = getActualIdleMessages();
  const candidates: string[] = [];

  for (const group of messages) {
    if (group.time && group.time !== timeOfDay) continue;
    if (group.emotion && group.emotion !== emotion) continue;
    if (!group.time && !group.emotion) {
      candidates.push(...group.messages);
    } else if (group.emotion === emotion) {
      candidates.push(...group.messages);
    } else if (group.time === timeOfDay) {
      candidates.push(...group.messages);
    }
  }

  // 心情影响：melancholy 优先选 sad 消息，cheerful 优先选 happy 消息
  if (mood === 'melancholy' && candidates.length > 0) {
    const sadGroup = messages.find((g) => g.emotion === 'sad');
    if (sadGroup) candidates.push(...sadGroup.messages);
  }

  return candidates.length > 0 ? randomPick(candidates) : '...';
}

// ===== 自定义消息持久化读取 =====

const CUSTOM_MESSAGES_KEY = 'deskpet_custom_messages';

interface CustomMessagesRaw {
  idle?: IdleMessage[];
  interact?: Partial<Record<keyof typeof INTERACT_MESSAGES, string[]>>;
}

/**
 * 模块级缓存：支持运行时从后端注入台词，优先于 localStorage。
 * 这样在去 localStorage 化的过渡期，运行时仍然可用。
 */
let _backendInteractMessages: typeof INTERACT_MESSAGES | null = null;
let _backendIdleMessages: IdleMessage[] | null = null;

/** 从后端设置互动消息缓存 */
export function setBackendInteractMessages(messages: typeof INTERACT_MESSAGES | null) {
  _backendInteractMessages = messages;
}

/** 从后端设置闲聊消息缓存 */
export function setBackendIdleMessages(messages: IdleMessage[] | null) {
  _backendIdleMessages = messages;
}

let _interactCache: typeof INTERACT_MESSAGES | null = null;
let _interactRaw = '';

export function getActualInteractMessages(): typeof INTERACT_MESSAGES {
  if (_backendInteractMessages) return _backendInteractMessages;

  const raw = localStorage.getItem(CUSTOM_MESSAGES_KEY) ?? '';
  if (raw === _interactRaw && _interactCache) return _interactCache;
  _interactRaw = raw;

  try {
    const custom: CustomMessagesRaw | null = raw ? (JSON.parse(raw) as CustomMessagesRaw) : null;
    _interactCache = custom?.interact
      ? {
          headPat: custom.interact.headPat ?? INTERACT_MESSAGES.headPat,
          bodyTap: custom.interact.bodyTap ?? INTERACT_MESSAGES.bodyTap,
          stepFoot: custom.interact.stepFoot ?? INTERACT_MESSAGES.stepFoot,
          tooMuchClick: custom.interact.tooMuchClick ?? INTERACT_MESSAGES.tooMuchClick,
          longNoInteract: custom.interact.longNoInteract ?? INTERACT_MESSAGES.longNoInteract,
        }
      : INTERACT_MESSAGES;
  } catch {
    _interactCache = INTERACT_MESSAGES;
  }
  return _interactCache;
}

let _idleCache: IdleMessage[] | null = null;
let _idleRaw = '';

export function getActualIdleMessages(): IdleMessage[] {
  if (_backendIdleMessages) return _backendIdleMessages;

  const raw = localStorage.getItem(CUSTOM_MESSAGES_KEY) ?? '';
  if (raw === _idleRaw && _idleCache) return _idleCache;
  _idleRaw = raw;

  try {
    const custom: CustomMessagesRaw | null = raw ? (JSON.parse(raw) as CustomMessagesRaw) : null;
    _idleCache = custom?.idle ?? IDLE_MESSAGES;
  } catch {
    _idleCache = IDLE_MESSAGES;
  }
  return _idleCache;
}

/**
 * 收集全部预制台词文本（默认 + 自定义消息的并集），用于 TTS 预热。
 */
export function collectAllPresetTexts(): string[] {
  const texts = new Set<string>();
  const interact = getActualInteractMessages();
  Object.values(interact).forEach((arr) => arr.forEach((t) => texts.add(t)));
  getActualIdleMessages().forEach((g) => g.messages.forEach((t) => texts.add(t)));
  return Array.from(texts);
}
