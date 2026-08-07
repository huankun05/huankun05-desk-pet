import { useCallback, useEffect, useState } from 'react';
import {
  APPEARANCE_KEYS,
  CHAT_APPEARANCE_EVENT,
  isSystemDark,
  readAppearance,
} from '../../settings/appearanceConfig';
import { useStorageEvents } from '../../hooks/useStorageEvent';
import { isTauriEnv } from '../../utils/tauriEnv';

/** 聊天窗口实际生效的外观（已解析 follow） */
export interface ChatAppearance {
  fontSize: number;
  backgroundImage: string;
  theme: 'light' | 'dark';
  accent: string;
  bubbleRadius: number;
  bubbleTail: boolean;
  showAvatar: boolean;
  userAvatar: string;
  aiAvatar: string;
}

const CHAT_KEYS = [
  APPEARANCE_KEYS.chatFontSize,
  APPEARANCE_KEYS.chatBackgroundImage,
  APPEARANCE_KEYS.chatTheme,
  APPEARANCE_KEYS.chatAccent,
  APPEARANCE_KEYS.chatBubbleRadius,
  APPEARANCE_KEYS.chatBubbleTail,
  APPEARANCE_KEYS.chatShowAvatar,
  APPEARANCE_KEYS.chatUserAvatar,
  APPEARANCE_KEYS.chatAiAvatar,
];

function snapshot(): ChatAppearance {
  const cfg = readAppearance();
  const theme = cfg.chatTheme === 'follow' ? (isSystemDark() ? 'dark' : 'light') : cfg.chatTheme;
  return {
    fontSize: cfg.chatFontSize,
    backgroundImage: cfg.chatBackgroundImage ?? '',
    theme,
    accent: cfg.chatAccent,
    bubbleRadius: cfg.chatBubbleRadius,
    bubbleTail: cfg.chatBubbleTail,
    showAvatar: cfg.chatShowAvatar,
    userAvatar: cfg.chatUserAvatar ?? '',
    aiAvatar: cfg.chatAiAvatar ?? '',
  };
}

/**
 * 订阅聊天外观配置。
 *
 * 三条刷新通道，缺一不可：
 * 1. `storage` 事件 —— 同一个 webview 内的改动（writeStorage 会手动派发）；
 * 2. Tauri `chat-appearance-changed` —— 设置窗是另一个 webview，storage 事件不会传过来；
 * 3. window focus —— 兜底，防止事件在窗口未创建时丢失。
 */
export function useChatAppearance(): ChatAppearance {
  const [appearance, setAppearance] = useState<ChatAppearance>(snapshot);

  const refresh = useCallback(() => setAppearance(snapshot()), []);

  useStorageEvents(CHAT_KEYS, refresh);

  useEffect(() => {
    if (!isTauriEnv()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen(CHAT_APPEARANCE_EVENT, refresh))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* 非 Tauri 或事件系统不可用时忽略 */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refresh]);

  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  return appearance;
}
