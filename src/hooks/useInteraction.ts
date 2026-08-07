import { useRef, useCallback, useEffect, useState } from 'react';
import { getIdleMessage, randomPick, INTERACT_MESSAGES } from '../data/idleMessages';
import { aiService } from '../services/ai';
import { eventBus } from '../services/eventBus';
import type { Personality } from './useEmotion';
import { loadBehaviorConfig } from '../services/behavior/behaviorConfig';

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

  // 智能闲聊
  const trySmartChat = useCallback(async () => {
    const behavior = loadBehaviorConfig();
    if (!behavior.enable || !behavior.enableSmartChat) return false;

    const config = aiService.getConfig();
    if (!config.apiKey) return false;

    const now = Date.now();
    const intervalMs = behavior.smartChatInterval * 1000;
    if (now - lastSmartChatRef.current < intervalMs) return false;

    const { count } = getSmartChatCount();
    if (count >= behavior.smartChatDailyLimit) return false;

    try {
      const msg = await aiService.generateProactiveMessage(currentEmotion, currentMood);
      if (msg && msg.length > 2 && msg.length < 100) {
        showBubble(msg, 6000);
        lastSmartChatRef.current = now;
        incrementSmartChatCount();
        return true;
      }
    } catch {
      // 静默失败
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
        showBubble(randomPick(INTERACT_MESSAGES.tooMuchClick));
        clicksRef.current = [];
        return;
      }

      const favMod = getFavorabilityModifier();

      if (relativeY < 0.4) {
        onPatHead();
        showBubble(favMod.prefix + randomPick(INTERACT_MESSAGES.headPat));
        eventBus.emit('interaction:pat', { target: 'head', count: recentClicks.length });
      } else if (relativeY < 0.7) {
        onTapBody();
        showBubble(favMod.prefix + randomPick(INTERACT_MESSAGES.bodyTap));
        eventBus.emit('interaction:tap', { target: 'body', intensity: recentClicks.length / 5 });
      } else {
        onStepFoot();
        showBubble(randomPick(INTERACT_MESSAGES.stepFoot), 3000);
        eventBus.emit('interaction:step', { target: 'feet' });
      }
    },
    [onPatHead, onTapBody, onStepFoot, onTooMuchClick, showBubble, getFavorabilityModifier],
  );

  // 闲聊调度（受性格影响）
  useEffect(() => {
    const soc = personality?.sociability ?? 0.7;
    const cheer = personality?.cheerfulness ?? 0.7;

    const scheduleNext = () => {
      // 社交性越高 → 闲聊间隔越短
      const baseInterval = 20000 + (1 - soc) * 50000; // soc=1: 20s, soc=0: 70s
      const jitter = Math.random() * 30000;
      const interval = baseInterval + jitter;

      idleTimerRef.current = setTimeout(async () => {
        const timeSince = Date.now() - lastInteractRef.current;

        if (timeSince > 60000) {
          if (timeSince > 180000) {
            onIdleTooLong();
          }

          // 优先尝试智能闲聊
          const didSmartChat = await trySmartChat();
          if (didSmartChat) {
            scheduleNext();
            return;
          }

          // 回退到静态消息池（开朗度影响消息积极程度）
          const favMod = getFavorabilityModifier();
          const chatChance = 0.4 + soc * 0.3 + favMod.extraChance;
          if (Math.random() < chatChance) {
            const msg = getIdleMessage(currentEmotion, currentMood);
            // 高开朗度 → 用愉快前缀
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
