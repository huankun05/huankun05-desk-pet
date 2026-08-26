import { useState, useCallback, useEffect, useRef } from 'react';
import { createStorage } from '../services/storage';
import { createLogger } from '../utils/logger';
import { eventBus } from '../services/eventBus';
import { getNahidaExpression, parseExplicitEmotion } from '../services/live2d/visualMapping';
import {
  tickDecay,
  applyEmotion,
  getEmotionLabel,
  getMoodLabel,
  type EmotionEngineState,
} from '../services/emotion/engine';
import {
  getEmotion as apiGetEmotion,
  postEmotionEvent as apiPostEmotionEvent,
} from '../services/coreApi';
import { apiEmotionToLocal } from '../services/emotionBackendMap';
import { isTauriEnv } from '../utils/tauriEnv';

const log = createLogger('Emotion');

// ===== 预编译情绪关键词 → EmotionType 映射表 =====
type CompiledPattern = { word: string; emotion: EmotionType };
let _compiledPatterns: CompiledPattern[] | null = null;
function getCompiledPatterns(): CompiledPattern[] {
  if (_compiledPatterns) return _compiledPatterns;
  const patterns: [string[], EmotionType][] = [
    [
      [
        'angry',
        'mad',
        'furious',
        'hate',
        'stupid',
        '😠',
        '😡',
        '生气',
        '烦',
        '讨厌',
        '可恶',
        '气死',
        '受不了',
        '滚',
        '闭嘴',
        '别烦',
        '走开',
        '恶心',
        '🤬',
      ],
      'angry',
    ],
    [
      [
        'sad',
        'sorry',
        'unfortunately',
        'terrible',
        '😢',
        '😭',
        '难过',
        '伤心',
        '委屈',
        '失落',
        '孤单',
        '寂寞',
        '想哭',
        '心累',
        '好难',
        '累了',
        '😞',
        '😔',
      ],
      'sad',
    ],
    [
      [
        'happy',
        'great',
        'awesome',
        'wonderful',
        '😊',
        '😄',
        '开心',
        '高兴',
        '好棒',
        '太好',
        '喜欢',
        '可爱',
        '好呀',
        '嘻嘻',
        '哈哈',
        '嘿嘿',
        '耶',
        '🥰',
        '😍',
        '🤗',
      ],
      'happy',
    ],
    [
      [
        'wow',
        'incredible',
        'surprise',
        'omg',
        '😮',
        '😲',
        '哇',
        '真的吗',
        '不会吧',
        '天哪',
        '居然',
        '竟然',
        '没想到',
        '好厉害',
        '😱',
        '🤯',
      ],
      'surprised',
    ],
    [
      [
        'think',
        'consider',
        'hmm',
        'perhaps',
        'maybe',
        '🤔',
        '嗯',
        '让我想想',
        '考虑',
        '也许',
        '可能',
        '大概',
        '不确定',
        '怎么说',
        '🤔',
        '🧐',
      ],
      'thinking',
    ],
    [
      [
        'shy',
        'embarrassed',
        'blush',
        '😅',
        '😳',
        '害羞',
        '不好意思',
        '难为情',
        '脸红',
        '🥺',
        '别这样',
        '讨厌啦',
        '😊',
        '☺️',
      ],
      'shy',
    ],
    [
      [
        'excited',
        'amazing',
        'fantastic',
        '🎉',
        '太棒',
        '万岁',
        '激动',
        '期待',
        '好想',
        '迫不及待',
        '兴奋',
        '🤩',
        '🎊',
      ],
      'excited',
    ],
    [
      ['sleepy', 'tired', 'zzz', '😴', '困', '好困', '累了', '晚安', '睡觉', '打哈欠', '🥱'],
      'sleepy',
    ],
    [
      [
        'curious',
        'interesting',
        '🧐',
        '好奇',
        '想知道',
        '为什么',
        '怎么回事',
        '什么情况',
        '真的假的',
        '👀',
      ],
      'curious',
    ],
  ];
  _compiledPatterns = patterns.flatMap(([words, emotion]) =>
    words.map((word) => ({ word, emotion })),
  );
  return _compiledPatterns;
}

/**
 * 纯函数：从文本快速检测情绪（不含用户自定义情绪，因那依赖 React state）。
 * 显式 [emotion:xxx] 标签由调用方先用 parseExplicitEmotion 解析；本函数做关键词兜底。
 * 供流式首句即时判定复用，避免与 useEmotion 强耦合。
 */
export function detectEmotionFromText(text: string): EmotionType {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!cleaned) return 'thinking';
  const t = cleaned.toLowerCase();
  const compiled = getCompiledPatterns();
  for (const { word, emotion } of compiled) {
    if (t.includes(word)) return emotion;
  }
  return 'happy';
}

// ===== 类型定义 =====

export type MoodType = 'cheerful' | 'content' | 'melancholy' | 'excited' | 'calm';

export type EmotionType =
  | 'idle'
  | 'happy'
  | 'sad'
  | 'thinking'
  | 'surprised'
  | 'talking'
  | 'angry'
  | 'shy'
  | 'excited'
  | 'curious'
  | 'sleepy';

export interface Personality {
  cheerfulness: number;
  sensitivity: number;
  sociability: number;
  energy: number;
}

export interface EmotionState {
  mood: MoodType;
  moodIntensity: number;
  emotion: EmotionType;
  emotionIntensity: number;
  favorability: number;
  personality: Personality;
  config: EmotionConfig;
  lastChange: Date;
  reason?: string;
  expressionMap?: Record<string, string>;
  idleExpressions?: string[];
  customEmotions?: { key: string; label: string }[];
  boredom?: number;
  loneliness?: number;
}

export interface EmotionConfig {
  decayInterval: number;
  decayMood: number;
  decayEmotion: number;
  idleDecayStart: number;
  cooldownMs: number;
  cooldownFactor: number;
  maxIntensityPerAction: number;
  favPatHead: number;
  favTapBody: number;
  favStepFoot: number;
  favTalk: number;
  favTooMuch: number;
}

export interface EmotionHistoryEntry {
  emotion: EmotionType;
  intensity: number;
  mood: MoodType;
  favorability: number;
  timestamp: Date;
  reason?: string;
}

// ===== 配置 =====

export const DEFAULT_PERSONALITY: Personality = {
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

const DEFAULT_STATE: EmotionState = {
  mood: 'cheerful',
  moodIntensity: 0.7,
  emotion: 'happy',
  emotionIntensity: 0.8,
  favorability: 50,
  personality: DEFAULT_PERSONALITY,
  config: DEFAULT_CONFIG,
  lastChange: new Date(),
  reason: '初始状态',
  boredom: 0,
};

// ===== SenseVoice 情绪映射 =====

const VOICE_EMOTION_MAP: Record<string, EmotionType> = {
  happy: 'happy',
  sad: 'sad',
  angry: 'angry',
  neutral: 'idle',
};

// ===== 存储 =====

const emotionStorage = createStorage<EmotionState>('emotion', DEFAULT_STATE);
const historyStorage = createStorage<EmotionHistoryEntry[]>('emotionHistory', []);

// ===== Hook =====

export function useEmotion() {
  const [emotionState, setEmotionState] = useState<EmotionState>(DEFAULT_STATE);
  const [emotionHistory, setEmotionHistory] = useState<EmotionHistoryEntry[]>([]);
  const lastInteractRef = useRef<number>(0);
  const dailyFirstRef = useRef(true);
  const consecutivePatRef = useRef(0);
  const consecutiveTapRef = useRef(0);
  const cooldownRef = useRef<Map<string, number>>(new Map());
  const emotionSequenceRef = useRef<EmotionType[]>([]);
  const boredomRef = useRef<number>(0);
  const customEmotionsRef = useRef<{ key: string; label: string }[]>([]);
  const prevStateRef = useRef<EmotionState | null>(null);

  // ===== 事件总线：情绪/好感度变化时通知外部模块（行为系统、proactive scheduler 等） =====
  useEffect(() => {
    const prev = prevStateRef.current;
    if (!prev) {
      prevStateRef.current = emotionState;
      return;
    }

    if (
      prev.emotion !== emotionState.emotion ||
      prev.emotionIntensity !== emotionState.emotionIntensity
    ) {
      eventBus.emit('emotion:changed', {
        emotion: emotionState.emotion,
        intensity: emotionState.emotionIntensity,
        reason: emotionState.reason || '',
      });
    }

    if (prev.favorability !== emotionState.favorability) {
      eventBus.emit('favorability:changed', {
        delta: emotionState.favorability - prev.favorability,
        favorability: emotionState.favorability,
      });
    }

    prevStateRef.current = emotionState;
  }, [emotionState]);

  const initEngineState = useCallback(
    (state: EmotionState): EmotionEngineState => ({
      mood: state.mood,
      moodIntensity: state.moodIntensity,
      emotion: state.emotion,
      emotionIntensity: state.emotionIntensity,
      favorability: state.favorability,
      personality: state.personality,
      boredom: state.boredom ?? 0,
      lastInteractTime: lastInteractRef.current,
      emotionSequence: emotionSequenceRef.current,
      interactCounts: new Map(),
    }),
    [],
  );

  useEffect(() => {
    emotionStorage.init().then(() => {
      const saved = emotionStorage.get();
      const merged: EmotionState = {
        ...DEFAULT_STATE,
        ...saved,
        personality: { ...DEFAULT_PERSONALITY, ...saved.personality },
        config: { ...DEFAULT_CONFIG, ...saved.config },
        boredom: saved.boredom ?? 0,
      };
      setEmotionState(merged);
      lastInteractRef.current = Date.now();
      boredomRef.current = merged.boredom ?? 0;
      if (merged.customEmotions) customEmotionsRef.current = merged.customEmotions;
      log.info('State restored', {
        emotion: merged.emotion,
        mood: merged.mood,
        favorability: merged.favorability,
      });
    });
    historyStorage.init().then(() => {
      const saved = historyStorage.get();
      if (saved && saved.length > 0) {
        setEmotionHistory(saved);
      }
    });
  }, []);

  // 前后端合并：core 服务在线时，以后端情绪（含人格基线回落后的值）为源初始化本地。
  // 本地保留 personality/config/favorability 等后端没有的字段，只覆盖情绪相关。
  useEffect(() => {
    if (!isTauriEnv()) return;
    let cancelled = false;
    apiGetEmotion()
      .then((api) => {
        if (cancelled || !api.mood) return;
        setEmotionState((prev) => ({ ...prev, ...apiEmotionToLocal(api) }));
      })
      .catch(() => {
        /* core 服务未启动：保持本地状态 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (emotionState.customEmotions) customEmotionsRef.current = emotionState.customEmotions;
  }, [emotionState.customEmotions]);

  const saveState = useCallback((newState: EmotionState) => {
    try {
      emotionStorage.set(newState);
    } catch (err) {
      console.error('[Emotion] saveState error:', err);
    }
  }, []);

  const getFavDelta = useCallback(
    (reason?: string, cfg: EmotionConfig = DEFAULT_CONFIG): number => {
      if (reason?.includes('头部抚摸')) return cfg.favPatHead;
      if (reason?.includes('身体拍打')) return cfg.favTapBody;
      if (reason?.includes('用户发言') || reason?.includes('AI 回复')) return cfg.favTalk;
      if (reason?.includes('踩脚')) return cfg.favStepFoot;
      if (reason?.includes('频繁点击')) return cfg.favTooMuch;
      return 0;
    },
    [],
  );

  const setNewEmotion = useCallback(
    (newEmotion: EmotionType, intensity: number = 0.7, reason?: string) => {
      lastInteractRef.current = Date.now();

      const now = Date.now();
      const lastTime = cooldownRef.current.get(newEmotion) || 0;
      const timeSince = now - lastTime;
      const currentConfig = emotionStorage.get().config || DEFAULT_CONFIG;
      let effectiveIntensity = intensity;
      if (timeSince < currentConfig.cooldownMs) {
        effectiveIntensity = intensity * currentConfig.cooldownFactor;
      }
      cooldownRef.current.set(newEmotion, now);

      setEmotionState((prev) => {
        const engineState: EmotionEngineState = initEngineState(prev);
        const favDelta = getFavDelta(reason, prev.config);

        let finalFavDelta = favDelta;
        if (dailyFirstRef.current && favDelta > 0) {
          finalFavDelta += 5;
          dailyFirstRef.current = false;
        }

        const result = applyEmotion(
          engineState,
          newEmotion,
          effectiveIntensity,
          reason || '',
          finalFavDelta,
        );

        emotionSequenceRef.current = result.emotionSequence;
        boredomRef.current = result.boredom;

        log.debug('setNewEmotion', {
          trigger: reason,
          input: newEmotion,
          final: result.emotion,
          intensity: result.emotionIntensity.toFixed(2),
          cooldown: timeSince < currentConfig.cooldownMs,
          favDelta: finalFavDelta,
        });

        const newState: EmotionState = {
          ...prev,
          mood: result.mood,
          moodIntensity: result.moodIntensity,
          emotion: result.emotion,
          emotionIntensity: result.emotionIntensity,
          favorability: result.favorability,
          boredom: result.boredom,
          lastChange: new Date(),
          reason,
        };

        saveState(newState);

        // 事件双写后端（合并为单引擎）：后端负责长期状态持久化 + HEXACO 人格漂移
        if (isTauriEnv() && reason) {
          apiPostEmotionEvent(reason).catch(() => {});
        }

        setEmotionHistory((h) => {
          const next = [
            ...h.slice(-30),
            {
              emotion: result.emotion,
              intensity: result.emotionIntensity,
              mood: result.mood,
              favorability: result.favorability,
              timestamp: new Date(),
              reason,
            },
          ];
          historyStorage.set(next);
          return next;
        });

        return newState;
      });
    },
    [saveState, initEngineState, getFavDelta],
  );

  const analyzeTextEmotion = useCallback((text: string): EmotionType => {
    const base = detectEmotionFromText(text);
    if (base !== 'happy') return base;
    // 仅当关键词默认 happy 时，再回退检查用户自定义情绪
    const t = text.toLowerCase();
    for (const ce of customEmotionsRef.current) {
      if (t.includes(ce.key) || t.includes(ce.label)) return ce.key as EmotionType;
    }
    return 'happy';
  }, []);

  const setEmotionFromResponse = useCallback(
    (response: string) => {
      // 优先采用 AI 显式标注的情绪标签（[emotion:xxx]），否则回退关键词猜测
      const explicit = parseExplicitEmotion(response);
      const detected = explicit ?? analyzeTextEmotion(response);
      setNewEmotion(detected, 0.8, 'AI 回复');
    },
    [analyzeTextEmotion, setNewEmotion],
  );

  const updateFromVoice = useCallback(
    (text: string, voiceEmotion?: string) => {
      if (voiceEmotion && VOICE_EMOTION_MAP[voiceEmotion]) {
        log.info('Voice emotion detected', {
          voiceEmotion,
          mapped: VOICE_EMOTION_MAP[voiceEmotion],
        });
        setNewEmotion(VOICE_EMOTION_MAP[voiceEmotion], 0.85, '语音情绪');
      } else {
        const detected = analyzeTextEmotion(text);
        log.info('Voice fallback to text analysis', { detected });
        setNewEmotion(detected, 0.7, '语音输入');
      }
    },
    [analyzeTextEmotion, setNewEmotion],
  );

  const setTalkingEmotion = useCallback(() => {
    setNewEmotion('talking', 0.6, '用户发言');
  }, [setNewEmotion]);

  useEffect(() => {
    const timer = setInterval(() => {
      const timeSince = Date.now() - lastInteractRef.current;
      const cfg = emotionStorage.get().config || DEFAULT_CONFIG;
      if (timeSince < cfg.idleDecayStart) return;

      setEmotionState((prev) => {
        const engineState: EmotionEngineState = initEngineState(prev);
        const result = tickDecay(engineState, cfg.decayInterval);

        boredomRef.current = result.boredom;

        const newState: EmotionState = {
          ...prev,
          emotion: result.emotion,
          emotionIntensity: result.emotionIntensity,
          mood: result.mood,
          moodIntensity: result.moodIntensity,
          boredom: result.boredom,
        };
        saveState(newState);
        return newState;
      });
    }, 120000);

    return () => clearInterval(timer);
  }, [saveState, initEngineState]);

  const recordInteract = useCallback((type: string) => {
    lastInteractRef.current = Date.now();
    if (type === 'pat') {
      consecutivePatRef.current++;
      consecutiveTapRef.current = 0;
    } else if (type === 'tap') {
      consecutiveTapRef.current++;
      consecutivePatRef.current = 0;
    } else {
      consecutivePatRef.current = 0;
      consecutiveTapRef.current = 0;
    }
  }, []);

  const getEmotionEmoji = useCallback((e: EmotionType): string => {
    const m: Record<EmotionType, string> = {
      idle: '😊',
      happy: '😄',
      sad: '😢',
      thinking: '🤔',
      surprised: '😮',
      talking: '💬',
      angry: '😠',
      shy: '😳',
      excited: '🤩',
      curious: '🧐',
      sleepy: '😴',
    };
    return m[e];
  }, []);

  const getLive2DEmotion = useCallback((e: string): string => {
    // 走统一的按模型映射（默认 nahida）；供 usePerception 还原表情用
    return getNahidaExpression(e);
  }, []);

  const patHead = useCallback(() => {
    recordInteract('pat');
    const shy = consecutivePatRef.current >= 5;
    setNewEmotion(shy ? 'shy' : 'happy', shy ? 0.9 : 0.7, '头部抚摸');
  }, [recordInteract, setNewEmotion]);

  const tapBody = useCallback(() => {
    recordInteract('tap');
    const angry = consecutiveTapRef.current >= 10;
    setNewEmotion(angry ? 'angry' : 'happy', angry ? 0.8 : 0.6, '身体拍打');
  }, [recordInteract, setNewEmotion]);

  const stepFoot = useCallback(() => {
    recordInteract('step');
    setNewEmotion('angry', 0.8, '踩脚');
  }, [recordInteract, setNewEmotion]);

  const idleTooLong = useCallback(() => {
    setNewEmotion('sad', 0.5, '长时间未互动');
  }, [setNewEmotion]);

  const tooMuchClick = useCallback(() => {
    setNewEmotion('shy', 0.8, '频繁点击');
  }, [setNewEmotion]);

  const setPersonality = useCallback(
    (p: Partial<Personality>) => {
      setEmotionState((prev) => {
        const newState = { ...prev, personality: { ...prev.personality, ...p } };
        saveState(newState);
        return newState;
      });
    },
    [saveState],
  );

  const setConfig = useCallback(
    (c: Partial<EmotionConfig>) => {
      setEmotionState((prev) => {
        const newState = { ...prev, config: { ...prev.config, ...c } };
        saveState(newState);
        return newState;
      });
    },
    [saveState],
  );

  const setFavorability = useCallback(
    (fav: number) => {
      setEmotionState((prev) => {
        const newState = { ...prev, favorability: Math.max(0, Math.min(100, fav)) };
        saveState(newState);
        return newState;
      });
    },
    [saveState],
  );

  const applyAdminUpdate = useCallback(
    (update: Partial<EmotionState>) => {
      setEmotionState((prev) => {
        const next = { ...prev, lastChange: new Date() };
        if (update.emotion) next.emotion = update.emotion;
        if (update.mood) next.mood = update.mood;
        if (update.emotionIntensity !== undefined) next.emotionIntensity = update.emotionIntensity;
        if (update.moodIntensity !== undefined) next.moodIntensity = update.moodIntensity;
        if (update.favorability !== undefined)
          next.favorability = Math.max(0, Math.min(100, update.favorability));
        if (update.reason) next.reason = update.reason;
        if (update.personality) next.personality = { ...prev.personality, ...update.personality };
        if (update.expressionMap) next.expressionMap = update.expressionMap;
        if (update.idleExpressions) next.idleExpressions = update.idleExpressions;
        if (update.config) next.config = { ...prev.config, ...update.config };
        saveState(next);
        return next;
      });
    },
    [saveState],
  );

  const setExpressionMap = useCallback(
    (map: Record<string, string>) => {
      setEmotionState((prev) => {
        const newState = { ...prev, expressionMap: map };
        saveState(newState);
        return newState;
      });
    },
    [saveState],
  );

  const setIdleExpressions = useCallback(
    (list: string[]) => {
      setEmotionState((prev) => {
        const newState = { ...prev, idleExpressions: list };
        saveState(newState);
        return newState;
      });
    },
    [saveState],
  );

  const setCustomEmotions = useCallback(
    (list: { key: string; label: string }[]) => {
      setEmotionState((prev) => {
        const newState = { ...prev, customEmotions: list };
        saveState(newState);
        return newState;
      });
    },
    [saveState],
  );

  return {
    emotionState,
    emotionHistory,
    setNewEmotion,
    setEmotionFromResponse,
    updateFromVoice,
    setTalkingEmotion,
    analyzeTextEmotion,
    getEmotionEmoji,
    getLive2DEmotion,
    getEmotionLabel,
    getMoodLabel,
    patHead,
    tapBody,
    stepFoot,
    idleTooLong,
    tooMuchClick,
    setPersonality,
    setConfig,
    setFavorability,
    applyAdminUpdate,
    setExpressionMap,
    setIdleExpressions,
    setCustomEmotions,
    recordInteract,
  };
}
