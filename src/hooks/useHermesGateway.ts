/**
 * useHermesGateway — 使用 Hermes 大脑引擎的对话 Hook
 *
 * 作为 useChatPipeline 的替代方案，通过 WebSocket 直连
 * Python 后端的 Hermes Gateway，实现大脑驱动的对话。
 *
 * 使用方式：
 * ```tsx
 * const { sendMessage, messages, isLoading, gatewayReady } = useHermesGateway();
 * ```
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { emit, listen } from '@tauri-apps/api/event';
import { getHermesGatewayClient, destroyHermesGatewayClient } from '../services/hermesGateway';
import { eventBus } from '../services/eventBus';
import { createLogger } from '../utils/logger';
import { showToast } from '../utils/toast';
import { isTauriEnv } from '../utils/tauriEnv';
import { providerManager } from '../services/provider/manager';
import { toolRegistry } from '../services/tools/registry';
import {
  createSession,
  saveMessage,
  getOrCreateActiveSession,
  switchSession,
  type ChatSession,
} from '../services/chatStorage';
import type { Message } from '../components/Chat/ChatWindow';
import { mergeSyncedMessage } from './msgSync';

const log = createLogger('HermesGatewayHook');

const GATEWAY_READY_KEY = 'deskpet_hermes_gateway_enabled';

/** 跨窗口消息同步事件：完成态消息广播（主窗 ↔ 聊天面板窗，共享同一 localStorage 会话） */
const MSG_SYNC_EVENT = 'chat:msg-synced';

let _msgCounter = 0;
function nextMsgId(): string {
  _msgCounter += 1;
  // 加随机后缀：主窗/面板窗各自维护 counter，同毫秒发消息时 id 可能撞车，
  // 跨窗同步后相同 id 会互相覆盖，必须保证全局唯一。
  return `hermes_${Date.now()}_${_msgCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface UseHermesGatewayOptions {
  /** 每收到一个 token 时触发 */
  onToken?: (token: string) => void;
  /** 整条回复完成时触发（可用于 RAG、情感分析、TTS） */
  onMessageComplete?: (
    userText: string,
    assistantText: string,
    sessionId: string,
    userMessageId?: string,
    assistantMessageId?: string,
  ) => void;
  /** 回复被中断时触发 */
  onInterrupt?: () => void;
  /** TTS 是否启用 */
  ttsEnabled?: boolean;
}

export interface HermesGatewayState {
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  gatewayReady: boolean;
  sendMessage: (
    content: string,
    mode?: 'work' | 'chat',
    opts?: {
      attachments?: Message['attachments'];
      quoted?: { messageId: string; content: string; role: 'user' | 'assistant' };
    },
  ) => Promise<void>;
  interruptResponse: () => void;
  newChat: () => void;
  /** 切换到指定会话并加载其消息 */
  loadSession: (sessionId: string) => void;
  setGatewayEnabled: (enabled: boolean) => void;
}

export function useHermesGateway(options?: UseHermesGatewayOptions): HermesGatewayState {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [gatewayReady, setGatewayReady] = useState(false);

  const sessionRef = useRef<ChatSession | null>(null);
  const assistantMessageIdRef = useRef<string>('');
  const currentResponseRef = useRef('');
  const abortedRef = useRef(false);
  // 用 ref 保存最新 assistantId，避免闭包过期
  const latestAssistantIdRef = useRef<string>('');

  // 读取启用状态
  const [gatewayEnabled, setGatewayEnabledState] = useState(() => {
    try {
      return localStorage.getItem(GATEWAY_READY_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const setGatewayEnabled = useCallback((enabled: boolean) => {
    setGatewayEnabledState(enabled);
    try {
      localStorage.setItem(GATEWAY_READY_KEY, enabled ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, []);

  // 连接/断开 Gateway
  useEffect(() => {
    if (!gatewayEnabled) {
      destroyHermesGatewayClient();
      // destroyHermesGatewayClient 会触发 onclose → hermes:disconnected → setGatewayReady(false)
      return;
    }

    const client = getHermesGatewayClient();
    client.connect();

    const unsub1 = eventBus.on('hermes:connected', () => {
      setGatewayReady(true);
      log.info('Hermes Gateway ready');
    });

    const unsub2 = eventBus.on('hermes:disconnected', () => {
      setGatewayReady(false);
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [gatewayEnabled]);

  // 中断回复
  const interruptResponse = useCallback(() => {
    abortedRef.current = true;
    setIsStreaming(false);
    setIsLoading(false);
    // 使用 ref 保存的最新 assistantId，避免闭包过期
    const assistantId = latestAssistantIdRef.current;
    if (assistantId) {
      const partialContent = currentResponseRef.current;
      if (partialContent) {
        const partialMsg: Message = {
          id: assistantId,
          role: 'assistant',
          content: partialContent,
          timestamp: new Date(),
        };
        saveMessage(partialMsg);
      }
    }
  }, []);

  // 发送消息
  const handleSendMessage = useCallback(
    async (
      content: string,
      mode?: 'work' | 'chat',
      opts?: {
        attachments?: Message['attachments'];
        quoted?: { messageId: string; content: string; role: 'user' | 'assistant' };
      },
    ) => {
      const session = sessionRef.current;
      if (!session) return;

      abortedRef.current = false;
      currentResponseRef.current = '';

      const buildFrontendTools = (): Array<Record<string, unknown>> => {
        try {
          const all = toolRegistry.getAll();
          return all
            .filter((t) => t.enabled !== false)
            .map((t) => ({
              name: t.name,
              description: t.description,
              parameters: Object.fromEntries(
                Object.entries(t.parameters).map((entry) => {
                  const [k, v] = entry as [string, { type: string; description: string }];
                  return [k, { type: v.type, description: v.description }];
                }),
              ),
            }));
        } catch {
          return [];
        }
      };

      // 用户消息（携带引用与附件，供气泡渲染 + 持久化）
      const userMessage: Message = {
        id: nextMsgId(),
        role: 'user',
        content,
        timestamp: new Date(),
        ...(opts?.attachments && opts.attachments.length > 0
          ? { attachments: opts.attachments }
          : {}),
        ...(opts?.quoted ? { quoted: opts.quoted } : {}),
      };
      saveMessage(userMessage);
      setMessages((prev) => [...prev, userMessage]);
      // 广播给其他窗口（主窗/面板窗同步同一会话）
      if (isTauriEnv()) {
        emit(MSG_SYNC_EVENT, { sessionId: session.id, msg: userMessage }).catch(() => {});
      }

      // 占位助手消息
      const assistantId = nextMsgId();
      assistantMessageIdRef.current = assistantId;
      latestAssistantIdRef.current = assistantId;
      const assistantMessage: Message = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      setIsLoading(true);
      setIsStreaming(true);

      // 通过 WebSocket 发送
      const frontendTools = buildFrontendTools();
      const client = getHermesGatewayClient();
      client.sendChat(content, {
        mode,
        frontendTools,
        onToken: (token) => {
          if (abortedRef.current) return;
          currentResponseRef.current += token;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: currentResponseRef.current } : m,
            ),
          );
          options?.onToken?.(token);
        },
        onDone: async (fullResponse) => {
          if (abortedRef.current) return;
          const finalMsg: Message = {
            id: assistantId,
            role: 'assistant',
            content: fullResponse,
            timestamp: new Date(),
          };
          // 仅当当前仍是发起回复的会话时才落盘/更新 UI，防止切会话后串写
          if (sessionRef.current?.id === session.id) {
            saveMessage(finalMsg);
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? finalMsg : m)));
          }
          // 广播最终消息给其他窗口（不随 token 广播，避免事件风暴）
          if (isTauriEnv()) {
            emit(MSG_SYNC_EVENT, { sessionId: session.id, msg: finalMsg }).catch(() => {});
          }
          setIsLoading(false);
          setIsStreaming(false);
          eventBus.emit('message:response', { text: fullResponse, sessionId: session.id });

          options?.onMessageComplete?.(
            content,
            fullResponse,
            session.id,
            userMessage.id,
            assistantId,
          );
          if (options?.ttsEnabled && fullResponse.trim()) {
            try {
              await providerManager.ready;
              const ttsProvider = providerManager.getActiveTTSProvider();
              if (ttsProvider) {
                const result = await ttsProvider.synthesize(fullResponse.trim());
                const { audioPlayer } = await import('../services/audio/player');
                audioPlayer.enqueue(result.audio, result.sampleRate, `tts-${assistantId}`);
              }
            } catch {
              // ignore TTS playback errors
            }
          }
        },
        onError: (error) => {
          const errorMsg: Message = {
            id: assistantId,
            role: 'assistant',
            content: t('app.error_api_key', { message: error }),
            timestamp: new Date(),
          };
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? errorMsg : m)));
          setIsLoading(false);
          setIsStreaming(false);
          showToast(t('app.error_api_key', { message: error }), 'error');
        },
      });
    },
    [options, t],
  );

  // 新聊天
  const handleNewChat = useCallback(() => {
    const session = createSession();
    sessionRef.current = session;
    setMessages([]);
  }, []);

  // 切换会话：换 sessionRef 并加载该会话消息
  const handleLoadSession = useCallback((sessionId: string) => {
    const session = switchSession(sessionId);
    if (!session) return;
    // 先终止在途回复，避免旧会话的 token/onDone 串入新会话
    abortedRef.current = true;
    setIsStreaming(false);
    setIsLoading(false);
    sessionRef.current = session;
    setMessages(session.messages);
  }, []);

  // 初始化
  useEffect(() => {
    if (!gatewayEnabled) return;
    const session = getOrCreateActiveSession();
    sessionRef.current = session;
    const id = setTimeout(() => setMessages(session.messages));
    return () => clearTimeout(id);
  }, [gatewayEnabled]);

  const buildFrontendTools = useCallback((): Array<Record<string, unknown>> => {
    try {
      const all = toolRegistry.getAll();
      return all
        .filter((t) => t.enabled !== false)
        .map((t) => ({
          name: t.name,
          description: t.description,
          parameters: Object.fromEntries(
            Object.entries(t.parameters).map((entry) => {
              const [k, v] = entry as [string, { type: string; description: string }];
              return [k, { type: v.type, description: v.description }];
            }),
          ),
        }));
    } catch {
      return [];
    }
  }, []);

  // 跨窗口消息同步：主窗与聊天面板共享同一 localStorage 会话但内存 state 各自独立。
  // 收到其他窗口广播的完成态消息时，用纯函数按「会话匹配 + id upsert」合并（见 msgSync.ts）。
  const upsertRemoteMessage = useCallback((payload: { sessionId: string; msg: Message }) => {
    setMessages((prev) => mergeSyncedMessage(prev, payload, sessionRef.current?.id));
  }, []);

  useEffect(() => {
    if (!isTauriEnv()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<{ sessionId: string; msg: Message }>(MSG_SYNC_EVENT, (e) => {
      upsertRemoteMessage(e.payload);
    })
      .then((fn) => {
        // 卸载可能早于 listen resolve，此时直接注销避免监听器泄漏
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* 事件不可用时退化为仅本窗口 */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [upsertRemoteMessage]);

  return {
    messages,
    isLoading,
    isStreaming,
    gatewayReady,
    sendMessage: handleSendMessage,
    interruptResponse,
    newChat: handleNewChat,
    loadSession: handleLoadSession,
    setGatewayEnabled,
  };
}
