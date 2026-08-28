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
import { isOfflineModeEnabled } from '../services/provider/watchdog';
import { detectEmotionFromText, type EmotionType } from '../hooks/useEmotion';
import { parseExplicitEmotion, stripControlTags } from '../services/live2d/visualMapping';
import { audioPlayer } from '../services/audio/player';
import { StreamingTTSPlayer } from '../services/audio/streaming-tts';
import { llmScheduler } from '../services/provider/llmScheduler';
import { toolRegistry } from '../services/tools/registry';
import { getDisabledTools } from '../services/tools/toolManagement';
import {
  createSession,
  saveMessage,
  getOrCreateActiveSession,
  switchSession,
  type ChatSession,
} from '../services/chatStorage';
import type { Message } from '../components/Chat/ChatWindow';
import { mergeSyncedMessage } from './msgSync';

/** 聊天消息发送选项（共享类型，供语音通话等复用，避免函数类型逆变报错） */
export interface SendMessageOptions {
  attachments?: Message['attachments'];
  quoted?: { messageId: string; content: string; role: 'user' | 'assistant' };
  /** 静默模式：LLM 照常跑、回复照常回传，但不落聊天历史、不渲染气泡、不播 TTS（用于语音通话等） */
  silent?: boolean;
  /** 不落历史：不写聊天历史、不渲染气泡，但回复 TTS 照常播放（用于唤醒词/VAD 语音交流） */
  noHistory?: boolean;
}

export type SendMessageFn = (
  content: string,
  mode?: 'auto' | 'work' | 'chat',
  opts?: SendMessageOptions,
) => Promise<void>;

const log = createLogger('HermesGatewayHook');

/** 句子结束符（与 StreamingTTSPlayer 切句规则一致），用于首句完成时判定情绪 */
const SENTENCE_END_RE = /[。！？!?；;\n]/;

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
  /** 说话开始（首句出声前）触发，用于立即进入 talking 态 */
  onSpeechStart?: () => void;
  /** 首句情绪判定完成触发，参数为检测到的情绪（显式标签优先，否则关键词），用于即时同步表情/语气 */
  onSpeechEmotion?: (emotion: EmotionType) => void;
}

export interface HermesGatewayState {
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  gatewayReady: boolean;
  sendMessage: (
    content: string,
    mode?: 'auto' | 'work' | 'chat',
    opts?: {
      attachments?: Message['attachments'];
      quoted?: { messageId: string; content: string; role: 'user' | 'assistant' };
      silent?: boolean;
      noHistory?: boolean;
    },
  ) => Promise<void>;
  interruptResponse: () => void;
  newChat: () => void;
  /** 切换到指定会话并加载其消息 */
  loadSession: (sessionId: string) => void;
  setGatewayEnabled: (enabled: boolean) => void;
  /** 注入助手消息（不走 LLM），供插件 say() 等使用 */
  injectAssistantMessage: (content: string) => void;
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
      mode?: 'auto' | 'work' | 'chat',
      opts?: {
        attachments?: Message['attachments'];
        quoted?: { messageId: string; content: string; role: 'user' | 'assistant' };
        /** 静默模式：LLM 照常跑、回复照常回传，但不落聊天历史、不渲染气泡、不播 TTS（用于语音通话等） */
        silent?: boolean;
        /** 不落历史：不写聊天历史、不渲染气泡，但回复 TTS 照常播放（用于唤醒词/VAD 语音交流） */
        noHistory?: boolean;
      },
    ) => {
      const session = sessionRef.current;
      if (!session) return;
      // noHistory 与 silent 都不落历史/不渲染；仅显式 silent 额外关闭回复 TTS
      const silent = (opts?.silent ?? false) || (opts?.noHistory ?? false);

      if (isOfflineModeEnabled()) {
        showToast(t('settings.system.offline_mode_hint'), 'warning');
        return;
      }

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
      if (!silent) {
        saveMessage(userMessage);
        setMessages((prev) => [...prev, userMessage]);
        // 广播给其他窗口（主窗/面板窗同步同一会话）
        if (isTauriEnv()) {
          emit(MSG_SYNC_EVENT, { sessionId: session.id, msg: userMessage }).catch(() => {});
        }
      }

      // 占位助手消息：不再提前占位，等首 token 到达后再插入消息，
      // 避免输入前出现空白气泡 + 打字动画。
      let assistantId = '';
      let placeholderCreated = false;

      const appendAssistant = (content: string) => {
        if (placeholderCreated) return;
        placeholderCreated = true;
        assistantId = nextMsgId();
        assistantMessageIdRef.current = assistantId;
        latestAssistantIdRef.current = assistantId;
        const assistantMessage: Message = {
          id: assistantId,
          role: 'assistant',
          content,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      };

      setIsLoading(true);
      setIsStreaming(true);

      // 通过 LLM 调度器发送（限制并发，避免 GPU/CPU 瞬间过载）
      const frontendTools = buildFrontendTools();
      const client = getHermesGatewayClient();
      let ttsStream: StreamingTTSPlayer | null = null;
      let speechText = '';
      let firstSentenceFired = false;
      log.info(
        '[WS->SEND] sendChat id=%s text=%s mode=%s tools=%d',
        assistantId,
        content.slice(0, 80),
        mode,
        frontendTools.length,
      );

      // 检查调度器状态
      const schedStatus = llmScheduler.getStatus();
      if (schedStatus.queueLength > 0) {
        showToast(
          t('app.llm_queue_hint', { defaultValue: '正在处理上一个请求，请稍候...' }),
          'info',
        );
      }

      await llmScheduler.schedule(async () => {
        client.sendChat(content, {
          mode,
          frontendTools,
          disabledTools: getDisabledTools(),
          onToken: (token) => {
            if (abortedRef.current) return;
            // 显示/落库用剥离控制标签（[emotion:xxx]）后的文本；情绪判定仍用原始 token
            const displayToken = stripControlTags(token);
            if (!silent) {
              if (!placeholderCreated) {
                appendAssistant(displayToken);
                currentResponseRef.current = displayToken;
              } else {
                currentResponseRef.current += displayToken;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: currentResponseRef.current } : m,
                  ),
                );
              }
            }
            log.info('[WS->TOKEN] id=%s token_len=%d', assistantId, token.length);
            options?.onToken?.(token);
            // 流式 TTS：把 token 增量喂给渐进式播放器（仅聊天回复、且未显式静默时；noHistory 保留语音）
            if (options?.ttsEnabled && !(opts?.silent ?? false)) {
              if (!ttsStream) {
                ttsStream = new StreamingTTSPlayer((audio, sr) =>
                  audioPlayer.enqueue(audio, sr, `tts-${assistantId}`),
                );
                // 说话开始：立即进入 talking 态（说话脸 + 口型），消除「脸慢半拍」
                options?.onSpeechStart?.();
              }
              // 首句完成即判定情绪：驱动表情 + 透传 TTS 语气，使「脸 / 语气 / 话」同源统一
              speechText += token;
              if (!firstSentenceFired) {
                const boundary = speechText.search(SENTENCE_END_RE);
                if (boundary >= 0) {
                  firstSentenceFired = true;
                  const firstSentence = speechText.slice(0, boundary + 1).trim();
                  const e =
                    parseExplicitEmotion(firstSentence) ?? detectEmotionFromText(firstSentence);
                  ttsStream.setEmotion(e);
                  options?.onSpeechEmotion?.(e);
                }
              }
              ttsStream.push(token);
            }
          },
          onDone: async (fullResponse) => {
            if (abortedRef.current) return;
            // 剥离 [emotion:xxx] 等控制标签后再显示/落库；原始文本仍传给 onMessageComplete 供情绪解析
            const cleanResponse = stripControlTags(fullResponse);
            if (!silent) {
              if (!placeholderCreated) {
                appendAssistant(cleanResponse);
              } else {
                const finalMsg: Message = {
                  id: assistantId,
                  role: 'assistant',
                  content: cleanResponse,
                  timestamp: new Date(),
                };
                if (sessionRef.current?.id === session.id) {
                  saveMessage(finalMsg);
                  setMessages((prev) => prev.map((m) => (m.id === assistantId ? finalMsg : m)));
                }
              }
              // 广播最终消息给其他窗口（不随 token 广播，避免事件风暴）
              if (isTauriEnv()) {
                emit(MSG_SYNC_EVENT, {
                  sessionId: session.id,
                  msg: {
                    id: assistantId,
                    role: 'assistant',
                    content: cleanResponse,
                    timestamp: new Date(),
                  },
                }).catch(() => {});
              }
            }
            setIsLoading(false);
            setIsStreaming(false);
            eventBus.emit('message:response', { text: cleanResponse, sessionId: session.id });

            options?.onMessageComplete?.(
              content,
              fullResponse,
              session.id,
              userMessage.id,
              assistantId,
            );
            if (options?.ttsEnabled && fullResponse.trim() && !(opts?.silent ?? false)) {
              // 流式 TTS：收尾，把残留文本作为最后一句合成播放
              if (!ttsStream) {
                ttsStream = new StreamingTTSPlayer((audio, sr) =>
                  audioPlayer.enqueue(audio, sr, `tts-${assistantId}`),
                );
              }
              ttsStream.finish();
            }
          },
          onError: (error) => {
            if (!placeholderCreated) {
              appendAssistant(t('app.error_api_key', { message: error }));
            } else {
              const errorMsg: Message = {
                id: assistantId,
                role: 'assistant',
                content: t('app.error_api_key', { message: error }),
                timestamp: new Date(),
              };
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? errorMsg : m)));
            }
            setIsLoading(false);
            setIsStreaming(false);
            showToast(t('app.error_api_key', { message: error }), 'error');
          },
        });
      }, 10); // LLM 请求优先级：10（高于默认 50）
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options],
  );

  // 新聊天
  const handleNewChat = useCallback(() => {
    const session = createSession();
    sessionRef.current = session;
    setMessages([]);
    // 真正的新对话：清空 Gateway 服务端的会话上下文，避免 AI 沿用旧历史
    try {
      getHermesGatewayClient().resetConversation();
    } catch {
      /* ignore — 本地会话已新建，Gateway 上下文重置失败不阻塞 UI */
    }
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

  // 初始化：立即加载会话消息（rIC 优先，降级到 setTimeout，保证消息一定能渲染） */
  useEffect(() => {
    if (!gatewayEnabled) return;
    const session = getOrCreateActiveSession();
    sessionRef.current = session;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(() => setMessages(session.messages), { timeout: 200 });
        return () => cancelIdleCallback(id);
      }
      timer = setTimeout(() => setMessages(session.messages), 0);
      return () => clearTimeout(timer);
    };
    const cleanup = schedule();
    return cleanup;
  }, [gatewayEnabled]);

  // buildFrontendTools 已内联到 handleSendMessage 中，此处移除重复定义

  // 跨窗口消息同步：主窗与聊天面板共享同一 localStorage 会话但内存 state 各自独立。
  // 收到其他窗口广播的完成态消息时，用纯函数按「会话匹配 + id upsert」合并（见 msgSync.ts）。
  const upsertRemoteMessage = useCallback((payload: { sessionId: string; msg: Message }) => {
    setMessages((prev) => mergeSyncedMessage(prev, payload, sessionRef.current?.id));
  }, []);

  /** 注入一条助手消息（不走 LLM/Gateway），供插件 say() 等场景使用 */
  const injectAssistantMessage = useCallback((content: string) => {
    const session = sessionRef.current;
    if (!session) return;
    const msg: Message = {
      id: nextMsgId(),
      role: 'assistant',
      content,
      timestamp: new Date(),
    };
    saveMessage(msg);
    setMessages((prev) => [...prev, msg]);
    if (isTauriEnv()) {
      emit(MSG_SYNC_EVENT, { sessionId: session.id, msg }).catch(() => {});
    }
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

  // 打包后首次运行会自动 bootstrap Python venv（pip 安装 torch/funasr 等，耗时数十秒~数分钟）。
  // 监听 Rust 侧进度事件并 toast，否则这段时间应用看起来像卡死。
  useEffect(() => {
    if (!isTauriEnv()) return;
    let disposed = false;
    const unlistens: Array<() => void> = [];
    const reg = (event: string, kind: 'info' | 'warning' | 'error' | 'success') =>
      listen<string>(event, (e) => {
        showToast(e.payload, kind);
      })
        .then((fn) => {
          if (disposed) fn();
          else unlistens.push(fn);
        })
        .catch(() => {});
    reg('backend:install-start', 'info');
    reg('backend:install-step', 'info');
    reg('backend:install-done', 'success');
    reg('backend:install-failed', 'error');
    return () => {
      disposed = true;
      unlistens.forEach((u) => u());
    };
  }, []);

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
    injectAssistantMessage,
  };
}
