import { useRef, useCallback, useEffect, useState } from 'react';
import { getIdleMessage, randomPick, getActualInteractMessages } from '../data/idleMessages';
import { aiService } from '../services/ai';
import { eventBus } from '../services/eventBus';
import type { Personality } from './useEmotion';
import { loadBehaviorConfig } from '../services/behavior/behaviorConfig';
import { loadInteractionConfig } from '../settings/pages/models/interactionConfig';
import { interactTTS } from '../services/audio/interact-tts';
import { proactiveScheduler } from '../services/proactive/scheduler';

interface UseInteractionOptions {
  onPatHead: () => void;
  onTapBody: () => void;
  onStepFoot: () => void;
  onIdleTooLong: () => void;
  onTooMuchClick: () => void;
  currentMood: string;
  currentEmotion: string;
  favorability: number;
  personality?: Personality;
  showBubble?: (text: string, duration?: number) => void;
}

interface ClickRecord {
  time: number;
  y: number;
}

const SMART_CHAT_COUNT_KEY = 'deskpet_smartChatCount';
const SMART_CHAT_DATE_KEY = 'deskpet_smartChatDate';

function getSmartChatCount(): { count: number; date: string } {
  try {
    const date = localStorage.getItem(SMART_CHAT_DATE_KEY) || '';
    const today = new Date().toDateString();
    if (date !== today) {
      localStorage.setItem(SMART_CHAT_DATE_KEY, today);
      localStorage.setItem(SMART_CHAT_COUNT_KEY, '0');
      return { count: 0, date: today };
    }
    return { count: parseInt(localStorage.getItem(SMART_CHAT_COUNT_KEY) || '0', 10), date };
  } catch {
    return { count: 0, date: '' };
  }
}

function incrementSmartChatCount() {
  const { count } = getSmartChatCount();
  try {
    localStorage.setItem(SMART_CHAT_COUNT_KEY, String(count + 1));
  } catch (e) {
    console.warn('[useInteraction] failed to persist smart chat count:', e);
  }
}

export function useInteraction({
  onPatHead,
  onTapBody,
  onStepFoot,
  onIdleTooLong,
  onTooMuchClick,
  currentMood,
  currentEmotion,
  favorability,
  personality,
  showBubble: externalShowBubble,
}: UseInteractionOptions) {
  const clicksRef = useRef<ClickRecord[]>([]);
  const lastInteractRef = useRef<number>(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSmartChatRef = useRef<number>(0);
  // 点击语言冷却：cooldown 期间内不重复触发语言气泡（动作仍触发）
  const lastBubbleTimeRef = useRef<number>(0);
  const CLICK_BUBBLE_COOLDOWN_MS = 3000;

  // 配置/消息内存缓存：点击路径不再每次读 localStorage
  const cooldownMsRef = useRef<number>(
    loadInteractionConfig().clickCooldownMs || CLICK_BUBBLE_COOLDOWN_MS,
  );
  const interactMsgsRef = useRef(getActualInteractMessages());

  // 监听设置变更（跨窗口 storage + 本窗口 focus），刷新缓存
  useEffect(() => {
    const refresh = () => {
      cooldownMsRef.current = loadInteractionConfig().clickCooldownMs || CLICK_BUBBLE_COOLDOWN_MS;
      interactMsgsRef.current = getActualInteractMessages();
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const [_internalBubble, setInternalBubble] = useState<{
    id: number;
    text: string;
    duration: number;
  } | null>(null);
  const bubbleIdRef = useRef(0);

  const showBubble = useCallback(
    (text: string, duration = 4000) => {
      if (externalShowBubble) {
        externalShowBubble(text, duration);
      } else {
        setInternalBubble({ id: ++bubbleIdRef.current, text, duration });
      }
      // 尝试播放预制台词 TTS（异步，不阻塞）
      interactTTS.tryPlay(text);
    },
    [externalShowBubble],
  );

  // 好感度影响
  const getFavorabilityModifier = useCallback(() => {
    if (favorability >= 80) return { extraChance: 0.3, prefix: '' };
    if (favorability >= 60) return { extraChance: 0.15, prefix: '' };
    if (favorability >= 40) return { extraChance: 0, prefix: '' };
    if (favorability >= 20) return { extraChance: -0.1, prefix: '' };
    return { extraChance: -0.2, prefix: '... ' };
  }, [favorability]);

  // 智能闲聊：已由 proactiveScheduler 统一接管，此处仅保留静态消息池 fallback
  const trySmartChat = useCallback(async (): Promise<boolean> => {
    const behavior = loadBehaviorConfig();
    if (!behavior.enable || !behavior.enableSmartChat) return false;

    const now = Date.now();
    const intervalMs = behavior.smartChatInterval * 1000;
    if (now - lastSmartChatRef.current < intervalMs) return false;

    const { count } = getSmartChatCount();
    if (count >= behavior.smartChatDailyLimit) return false;

    const emotionCtx = currentEmotion;
    const moodCtx = currentMood;
    const config = aiService.getConfig();
    const apiKey = config.apiKey;

    try {
      if (apiKey) {
        const messages: Array<{ role: string; content: string }> = [
          {
            role: 'system',
            content: `你是一个可爱的桌面宠物助手。当前情绪：${emotionCtx}，心情：${moodCtx}。请主动说一句简短可爱的话，不要用问句，不要超过20个字。`,
          },
          { role: 'user', content: '请主动说一句话' },
        ];
        const response = await fetch(`${config.apiUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages,
            temperature: 0.9,
            max_tokens: 50,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const msg = data.choices?.[0]?.message?.content || '';
          if (msg && msg.length > 2 && msg.length < 100) {
            showBubble(msg, 6000);
            lastSmartChatRef.current = now;
            incrementSmartChatCount();
            return true;
          }
        }
      }
    } catch {
      // 静默失败，回退到静态池
    }
    return false;
  }, [currentEmotion, currentMood, showBubble]);

  // 点击区域检测
  const handleCanvasClick = useCallback(
    (relativeY: number) => {
      const now = Date.now();
      lastInteractRef.current = now;

      clicksRef.current.push({ time: now, y: relativeY });
      if (clicksRef.current.length > 10) {
        clicksRef.current = clicksRef.current.slice(-10);
      }

      const recentClicks = clicksRef.current.filter((c) => now - c.time < 2000);
      if (recentClicks.length >= 5) {
        onTooMuchClick();
        showBubble(randomPick(interactMsgsRef.current.tooMuchClick));
        clicksRef.current = [];
        return;
      }

      // 点击语言冷却：从内存缓存读取（默认 3 秒）
      const cooldownMs = cooldownMsRef.current;
      const canShowBubble = now - lastBubbleTimeRef.current >= cooldownMs;

      const favMod = getFavorabilityModifier();
      const msgs = interactMsgsRef.current;

      if (relativeY < 0.4) {
        onPatHead();
        if (canShowBubble) {
          lastBubbleTimeRef.current = now;
          showBubble(favMod.prefix + randomPick(msgs.headPat));
        }
        eventBus.emit('interaction:pat', { target: 'head', count: recentClicks.length });
      } else if (relativeY < 0.7) {
        onTapBody();
        if (canShowBubble) {
          lastBubbleTimeRef.current = now;
          showBubble(favMod.prefix + randomPick(msgs.bodyTap));
        }
        eventBus.emit('interaction:tap', { target: 'body', intensity: recentClicks.length / 5 });
      } else {
        onStepFoot();
        if (canShowBubble) {
          lastBubbleTimeRef.current = now;
          showBubble(randomPick(msgs.stepFoot), 3000);
        }
        eventBus.emit('interaction:step', { target: 'feet' });
      }
    },
    [onPatHead, onTapBody, onStepFoot, onTooMuchClick, showBubble, getFavorabilityModifier],
  );

  // 闲聊调度：此处只做“轻量随机触发 + 静态消息池 fallback”，
  // 真正的 LLM 主动消息由 proactiveScheduler 统一负责，避免两套系统抢发。
  useEffect(() => {
    const soc = personality?.sociability ?? 0.7;
    const cheer = personality?.cheerfulness ?? 0.7;

    // 聊天窗口发消息/收到回复也算互动：刷新"上次点击/互动"计时，避免聊天中闲聊抢话
    const offSent = eventBus.on('message:sent', () => {
      lastInteractRef.current = Date.now();
    });
    const offResponse = eventBus.on('message:response', () => {
      lastInteractRef.current = Date.now();
    });

    const scheduleNext = () => {
      const baseInterval = 45000 + (1 - soc) * 60000; // soc=1: 45s, soc=0: 105s
      const jitter = Math.random() * 30000;
      const interval = baseInterval + jitter;

      idleTimerRef.current = setTimeout(async () => {
        const timeSince = Date.now() - lastInteractRef.current;

        // 行为总开关或主动聊天未开启：不触发任何主动消息
        const behavior = loadBehaviorConfig();
        if (!behavior.enable || !behavior.enableSmartChat) {
          scheduleNext();
          return;
        }

        // 对话/通话忙碌中（语音通话、语音助手、回复流式）：跳过本次闲聊，等下一轮
        if (proactiveScheduler.isBusy()) {
          scheduleNext();
          return;
        }

        // 发言门槛 = 行为设置的「多久没互动才触发」（分钟→毫秒，默认 30 分钟）
        const idleMs = (behavior.smartChatIdleThreshold ?? 30) * 60 * 1000;
        if (timeSince > idleMs) {
          if (timeSince > 300000) {
            onIdleTooLong();
          }

          const didSmartChat = await trySmartChat();
          if (didSmartChat) {
            scheduleNext();
            return;
          }

          const favMod = getFavorabilityModifier();
          const chatChance = 0.35 + soc * 0.25 + favMod.extraChance;
          if (Math.random() < chatChance) {
            const msg = getIdleMessage(currentEmotion, currentMood);
            const prefix = cheer > 0.8 ? '✨ ' : cheer > 0.5 ? '' : '... ';
            showBubble(prefix + msg);
          }
        }

        scheduleNext();
      }, interval);
    };

    scheduleNext();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      offSent();
      offResponse();
    };
  }, [
    currentEmotion,
    currentMood,
    personality,
    onIdleTooLong,
    showBubble,
    getFavorabilityModifier,
    trySmartChat,
  ]);

  return { handleCanvasClick };
}
