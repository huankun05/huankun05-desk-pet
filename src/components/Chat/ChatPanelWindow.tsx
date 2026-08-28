import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { Icon } from '@iconify/react';
import { ChatWindow, type ChatWindowHandle, type Message } from './ChatWindow';
import { ChatDetailsPanel } from './ChatDetailsPanel';
import ConsentGate from '../../components/ConsentGate';
import { ChatAvatar } from './ChatAvatar';
import { useChatAppearance } from './useChatAppearance';
import { SlashHelpOverlay } from './SlashHelpOverlay';
import { showToast } from '../../utils/toast';
import './chat-theme.css';
import { AudioRecorder } from '../../services/audio/recorder';
import {
  initChatStorage,
  listSessions,
  getActiveSession,
  deleteSession,
  renameSession,
  clearSessionMessages,
  type ChatSession,
} from '../../services/chatStorage';
import { providerManager } from '../../services/provider/manager';
import { transcribeViaBrain } from '../../services/provider/sttBackend';
import { useHermesGateway, type SendMessageFn } from '../../hooks/useHermesGateway';
import { useVoiceCall } from '../../hooks/useVoiceCall';
import { useRagPersistence } from '../../hooks/useRagPersistence';
import { BUILTIN_COMMANDS } from '../../hooks/useSlashCommands';
import { registerGatewayToolExecutor } from '../../services/tools/executor';
import { registerBuiltinTools } from '../../services/tools/builtins';
import { getHermesGatewayClient } from '../../services/hermesGateway';
import { stripControlTags, parseExplicitEmotion } from '../../services/live2d/visualMapping';
import { detectEmotionFromText, type EmotionType } from '../../hooks/useEmotion';
import { isTauriEnv } from '../../utils/tauriEnv';
import { CHAT_EMOTION_EVENT, CHAT_ACTIVE_EVENT } from '../../services/eventBus';

/** 上下文重置时间戳（模块级，避免 hooks 声明顺序约束） */
let _contextResetTs = 0;
/** 标记是否为挂载后的首次 updateInfo 调用（跳过 localStorage 旧值） */
let _isFirstUpdate = true;

/** 顶部栏图标按钮 */
function BarButton({
  icon,
  title,
  active,
  onClick,
}: {
  icon: string;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        width: 26,
        height: 26,
        border: 'none',
        borderRadius: '6px',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <Icon icon={icon} width={16} height={16} />
    </button>
  );
}

// ===== 对话面板独立窗口 =====
function ChatPanelWindow() {
  const { t } = useTranslation();
  const appearance = useChatAppearance();

  const [isRecording, setIsRecording] = useState(false);
  const [sttAvailable, setSttAvailable] = useState(false);
  const recorderRef = useRef<AudioRecorder | null>(null);

  // 上下文栏状态
  const [currentModel, setCurrentModel] = useState<string>('gpt-3.5-turbo');
  const [contextUsed, setContextUsed] = useState<number>(0);
  const [contextTotal, setContextTotal] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('deskpet_context_total');
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch {
      // ignore
    }
    return 0;
  });
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('deskpet_tts_enabled') !== 'false';
    } catch {
      return true;
    }
  });

  // 本地 RAG 记忆写入：面板对话完成后同样落盘（消息 id 唯一，与主窗口不会双写）
  const { addToRag } = useRagPersistence();

  // 语音通话（QQ 式）：用到时由网关按需拉起本地 STT/TTS 服务。
  // 声明提前：useVoiceCall 依赖 sendMessage（来自 useHermesGateway），经 ref 中转，
  // 使下方 ttsEnabled 可直接用 voiceCall.active 渲染期派生（消除 effect 镜像 state 反模式）。
  const sendMessageRef = useRef<SendMessageFn | null>(null);
  const sendMessageViaRef = useCallback<SendMessageFn>(
    (text, mode, opts) => sendMessageRef.current?.(text, mode, opts) ?? Promise.resolve(),
    [],
  );
  const voiceCall = useVoiceCall({
    sendMessage: sendMessageViaRef,
    mode: 'auto',
    showError: (m) => showToast(m, 'error'),
    // 通话状态跨窗广播给主窗口：通话中 → 主窗暂停主动闲聊，避免"打电话时突然冒一句"
    onStateChange: (s) => {
      const active = s === 'incall' || s === 'listening' || s === 'speaking';
      emit('voicecall-active', { active }).catch(() => {});
    },
  });

  const {
    messages,
    isLoading,
    isStreaming,
    gatewayReady,
    sendMessage,
    interruptResponse,
    newChat,
    loadSession,
    setGatewayEnabled,
  } = useHermesGateway({
    // 通话激活时临时关闭聊天 TTS，避免同一回复被聊天 onDone 与通话 playTts 各播一次
    ttsEnabled: ttsEnabled && !voiceCall.active,
    onMessageComplete: async (
      userText,
      assistantText,
      sessionId,
      userMessageId,
      assistantMessageId,
    ) => {
      // 剥离 [emotion:xxx] 控制标签后再落库 RAG（避免标签污染长期记忆）
      const clean = stripControlTags(assistantText);
      if (userMessageId && assistantMessageId && sessionId) {
        await addToRag(userText, clean, {
          userMessageId,
          assistantMessageId,
          sessionId,
        });
      }
      // 跨窗回传情绪：让主窗宠物的表情跟着聊天内容变化（面板自身不渲染 Live2D）
      try {
        const head = assistantText.slice(0, 80);
        const e: EmotionType | null =
          parseExplicitEmotion(head) ?? detectEmotionFromText(head);
        if (e && isTauriEnv()) {
          emit(CHAT_EMOTION_EVENT, {
            emotion: e,
            intensity: 0.7,
            reason: '聊天回复',
          }).catch(() => {});
        }
      } catch {
        /* ignore */
      }
    },
  });

  // useHermesGateway 返回的 sendMessage 每次渲染重建（options 引用变化），同步给 useVoiceCall 的 ref 中转
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  // 跨窗广播“聊天进行中”：发送/流式输出期间 active=true，
  // 主窗据此暂停主动闲聊，避免“我正在打字它突然冒一句”
  useEffect(() => {
    if (!isTauriEnv()) return;
    emit(CHAT_ACTIVE_EVENT, { active: isLoading }).catch(() => {});
  }, [isLoading]);

  // 详情面板显隐（详情面板本身已拆到 ChatDetailsPanel.tsx，内部状态内聚）
  const [showDetails, setShowDetails] = useState(false);

  // Slash help overlay state
  const [showSlashHelp, setShowSlashHelp] = useState(false);

  // 会话管理状态（保留，用于侧边栏）
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSessionList, setShowSessionList] = useState(false);

  // Slash 命令列表（直接复用内置命令定义，避免与 useSlashCommands 漂移）
  const slashCommands = BUILTIN_COMMANDS;

  const _handleSlashHelpToggle = useCallback(() => {
    setShowSlashHelp((p) => !p);
  }, []);

  // 确保面板启动时启用 Gateway + 移除首屏加载遮罩
  useEffect(() => {
    setGatewayEnabled(true);
    // 聊天面板窗没有 Live2D，不会触发 useLive2D 的遮罩移除，需手动处理
    const splash = document.getElementById('app-loading');
    if (splash) splash.remove();
  }, [setGatewayEnabled]);

  // 录音器初始化 + STT 可用性
  useEffect(() => {
    if (AudioRecorder.isSupported()) {
      recorderRef.current = new AudioRecorder({
        sampleRate: 16000,
        silenceTimeout: 1500,
        onStateChange: (state) => {
          if (state === 'recording') setIsRecording(true);
          if (state === 'idle') setIsRecording(false);
        },
      });
    }

    let cancelled = false;
    /**
     * 面板窗口是独立 webview，其 localStorage 与主窗口相互隔离，
     * 只读主窗口写入的 deskpet_sttAvailable 标志会一直得到 false，
     * 导致「按住说话」按钮始终不显示。
     * 改为以 providerManager 为权威来源——它的配置从 %APPDATA% 文件加载，
     * 是跨窗口、跨重启一致的；同时也回写标志位以兼容其他读取方。
     */
    const checkStt = async () => {
      try {
        await providerManager.ready;
        if (cancelled) return;
        const available = providerManager.getActiveSTTConfig() !== null;
        setSttAvailable(available);
        try {
          localStorage.setItem('deskpet_sttAvailable', String(available));
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore */
      }
    };

    // 立即探测一次，避免首屏 3 秒内录音按钮缺失
    void checkStt();
    const timer = setInterval(() => void checkStt(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // 读取当前模型和上下文信息
  useEffect(() => {
    // 挂载时标记：首次 updateInfo 跳过 localStorage 旧值
    _contextResetTs = Date.now();
    _isFirstUpdate = true;
    try {
      localStorage.removeItem('deskpet_context_used');
    } catch {
      /* ignore */
    }

    const updateInfo = () => {
      try {
        const provider = providerManager.getActiveChatProvider();
        if (provider?.config?.model) {
          setCurrentModel(provider.config.model);
        }
      } catch {
        // ignore
      }
      try {
        const used = localStorage.getItem('deskpet_context_used');
        const total = localStorage.getItem('deskpet_context_total');
        // 首次更新或重置后 5 秒内不读取旧值（避免 Gateway 残余写入覆盖归零）
        if (_isFirstUpdate || Date.now() - _contextResetTs < 5000) {
          setContextUsed(0);
          _isFirstUpdate = false;
        } else {
          if (used) setContextUsed(Number(used));
        }
        if (total) setContextTotal(Number(total));
      } catch {
        // ignore
      }
    };
    // 延迟首次读取，给 Gateway 时间写入当前会话的真实值
    const initTimer = setTimeout(updateInfo, 1500);
    const timer = setInterval(updateInfo, 2000);
    return () => {
      clearInterval(timer);
      clearTimeout(initTimer);
    };
  }, []);

  // 重置上下文显示（切换/删除/新建会话时调用，避免残留旧 token 数）
  const resetContextDisplay = useCallback(() => {
    setContextUsed(0);
    _contextResetTs = Date.now();
    try {
      localStorage.removeItem('deskpet_context_used');
      localStorage.removeItem('deskpet_context_total');
    } catch {
      /* ignore */
    }
  }, []);

  // 注册内置工具并监听 Gateway 下发的前端工具调用（统一经权限网关执行）
  useEffect(() => {
    registerBuiltinTools();

    const unsub = registerGatewayToolExecutor((id, name, content, isError) =>
      getHermesGatewayClient().sendToolResult(id, name, content, isError),
    );

    return () => unsub();
  }, []);

  // 指向聊天窗口的命令式句柄，用于把 STT 结果回填到输入框
  const chatWindowRef = useRef<ChatWindowHandle>(null);

  const handleRecordStart = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    try {
      await recorder.start();
    } catch (err) {
      console.error('[Record] Failed to start:', err);
    }
  }, []);

  const handleRecordStop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    try {
      const audio = await recorder.stop();
      if (!audio) return;

      // 优先走面板内直连 STT Provider
      try {
        const result = await transcribeViaBrain(audio, 'wav');
        if (result) {
          const text = result.text?.trim() || '';
          if (text) {
            // 把识别结果回填到输入框，用户可检查/修改后再发送
            chatWindowRef.current?.setDraft(text);
            return;
          }
        }
      } catch {
        // STT Provider 不可用，走 fallback
      }

      // Fallback：浏览器 Web Speech API
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        try {
          interface SpeechRecognitionEventLike {
            results: ArrayLike<ArrayLike<{ transcript: string }>>;
          }
          interface SpeechRecognitionErrorEventLike {
            error: string;
          }
          interface SpeechRecognitionInstance {
            lang: string;
            interimResults: boolean;
            maxAlternatives: number;
            onresult: ((event: SpeechRecognitionEventLike) => void) | null;
            onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
            onend: (() => void) | null;
            start: () => void;
            stop: () => void;
          }
          const win = window as unknown as {
            webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
            SpeechRecognition?: new () => SpeechRecognitionInstance;
          };
          const SpeechRecognition = win.webkitSpeechRecognition || win.SpeechRecognition;
          if (!SpeechRecognition) throw new Error('SpeechRecognition not available');
          const recognition = new SpeechRecognition();
          recognition.lang = 'zh-CN';
          recognition.interimResults = false;
          recognition.maxAlternatives = 1;
          const text = await new Promise<string>((resolve, reject) => {
            recognition.onresult = (event) => {
              const transcript = event.results[0][0].transcript;
              resolve(transcript);
            };
            recognition.onerror = (event) => {
              reject(new Error(event.error));
            };
            recognition.onend = () => {};
            recognition.start();
            setTimeout(() => {
              recognition.stop();
              resolve('');
            }, 5000);
          });
          if (text) {
            // 把识别结果回填到输入框，用户可检查/修改后再发送
            chatWindowRef.current?.setDraft(text);
            return;
          }
        } catch {
          // ignore speech recognition errors
        }
      }

      // 最终 fallback：提示用户
      console.warn('[STT] All recognition methods failed');
    } catch (err) {
      console.error('[Record] Failed to stop:', err);
    }
  }, []);

  // 窗口尺寸+位置持久化
  useEffect(() => {
    let saveTimer: ReturnType<typeof setTimeout>;
    const dpr = window.devicePixelRatio || 1;
    const unlisteners: Array<() => void> = [];
    const save = (partial?: Record<string, number>) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try {
          const prev = JSON.parse(localStorage.getItem('deskpet_chat_geometry') || '{}');
          const next = { ...prev, ...partial };
          localStorage.setItem('deskpet_chat_geometry', JSON.stringify(next));
          invoke('save_data', { key: 'chat_panel_size', data: JSON.stringify(next) }).catch((err) =>
            console.warn('[ChatPanel] save_data failed', err),
          );
        } catch {
          /* 忽略 */
        }
      }, 300);
    };
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        win
          .onMoved((e) => save({ x: e.payload.x / dpr, y: e.payload.y / dpr }))
          .then((u) => unlisteners.push(u));
        win
          .onResized((e) => save({ w: e.payload.width / dpr, h: e.payload.height / dpr }))
          .then((u) => unlisteners.push(u));
      })
      .catch(() => {});
    save();
    return () => {
      clearTimeout(saveTimer);
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  // 聊天管理：多条会话切换
  useEffect(() => {
    let cancelled = false;
    initChatStorage()
      .then(() => {
        if (cancelled) return;
        const all = listSessions();
        setSessions(all);
        const active = getActiveSession();
        if (active) setActiveSessionId(active.id);
      })
      .catch((err) => console.error('[ChatPanel] initChatStorage failed', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSwitchSession = useCallback(
    (sessionId: string) => {
      // 切换会话：由 Gateway hook 换 sessionRef 并加载该会话消息
      loadSession(sessionId);
      resetContextDisplay();
      setActiveSessionId(sessionId);
      setShowSessionList(false);
    },
    [loadSession, resetContextDisplay],
  );

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      const wasActive = sessionId === activeSessionId;
      deleteSession(sessionId);
      resetContextDisplay();
      const all = listSessions();
      setSessions(all);
      const active = getActiveSession();
      if (active) {
        setActiveSessionId(active.id);
        try {
          localStorage.setItem('deskpet_active_session_id', active.id);
        } catch {
          /* ignore */
        }
        // 删除的是当前会话：同步加载下一个会话的消息，避免界面残留已删内容
        if (wasActive) loadSession(active.id);
      } else {
        setActiveSessionId(null);
        try {
          localStorage.removeItem('deskpet_active_session_id');
        } catch {
          /* ignore */
        }
        // 没有剩余会话：开一个新会话并同步会话列表
        if (wasActive) {
          newChat();
          const all2 = listSessions();
          setSessions(all2);
          setActiveSessionId(getActiveSession()?.id ?? null);
        }
      }
    },
    [activeSessionId, loadSession, newChat, resetContextDisplay],
  );

  // 会话列表：搜索 + 分页（每页 20 条，滚动式加载更多）
  const [sessionQuery, setSessionQuery] = useState('');
  const [sessionPage, setSessionPage] = useState(1);
  const SESSION_PAGE_SIZE = 20;

  const filteredSessions = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
  }, [sessions, sessionQuery]);

  const visibleSessions = filteredSessions.slice(0, sessionPage * SESSION_PAGE_SIZE);

  const handleSessionQueryChange = (value: string) => {
    setSessionQuery(value);
    setSessionPage(1);
  };

  /** 跳转到某条消息（详情面板查找/收藏结果调用） */
  const handleJumpToMessage = useCallback((messageId: string) => {
    chatWindowRef.current?.jumpToMessage(messageId);
  }, []);

  // 发送消息：走 Hermes Gateway
  const handleSendMessage = useCallback(
    async (
      payload:
        | string
        | {
            text: string;
            quoted?: { messageId: string; content: string; role: 'user' | 'assistant' };
            attachments?: Message['attachments'];
          },
    ) => {
      const text = typeof payload === 'string' ? payload : payload.text;
      if (!text.trim() || isLoading) return;
      const quoted = typeof payload === 'string' ? undefined : payload.quoted;
      const attachments = typeof payload === 'string' ? undefined : payload.attachments;
      // 固定使用智能模式，不再提供手动切换
      await sendMessage(text.trim(), 'auto', { quoted, attachments });
    },
    [sendMessage, isLoading],
  );

  const handleCancelStream = useCallback(() => {
    interruptResponse();
  }, [interruptResponse]);

  // 新聊天：由 Gateway hook 管理会话，同时同步本地会话列表
  const handleNewChat = useCallback(() => {
    newChat();
    resetContextDisplay();
    const all = listSessions();
    setSessions(all);
    const active = getActiveSession();
    setActiveSessionId(active?.id ?? null);
  }, [newChat, resetContextDisplay]);

  // /rename：重命名当前会话，同步刷新侧栏标题
  const handleRenameSession = useCallback(
    (title: string) => {
      if (!activeSessionId) return;
      renameSession(activeSessionId, title);
      setSessions(listSessions());
    },
    [activeSessionId],
  );

  // /clearctx：清空当前会话历史并重新加载（上下文归零，会话本身保留）
  const handleClearContext = useCallback(() => {
    if (!activeSessionId) return;
    clearSessionMessages(activeSessionId);
    resetContextDisplay();
    loadSession(activeSessionId);
    setSessions(listSessions());
  }, [activeSessionId, loadSession, resetContextDisplay]);

  const handleToggleTts = useCallback(() => {
    setTtsEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('deskpet_tts_enabled', next ? 'true' : 'false');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleMinimize = useCallback(() => {
    // 缩小到任务栏（与收起不同：收起是隐藏常驻、用聊天键再唤出；缩小是最小化到任务栏）
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().minimize())
      .catch(() => {});
  }, []);

  const handleCloseWindow = useCallback(() => {
    // 收起而非销毁：隐藏窗口常驻，再次点击聊天键秒开（与设置窗一致）
    // 注意：不要改 document.body.style.opacity —— 重开时残留 0 会导致整窗灰屏
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().hide())
      .catch(() => {});
  }, []);

  const handleBarDrag = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
      target.closest('button')
    )
      return;
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
      .catch(() => {
        /* 忽略拖拽异常 */
      });
  }, []);

  const contextRatio = Math.min(1, contextUsed / Math.max(1, contextTotal));

  return (
    <div
      className="chat-root"
      data-chat-theme={appearance.theme}
      style={
        {
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: 'var(--chat-bg)',
          color: 'var(--text-primary)',
          fontSize: '13px',
          '--accent': appearance.accent,
        } as React.CSSProperties
      }
    >
      {/* 权限确认卡（工具执行前的授权弹窗） */}
      <ConsentGate />

      {/* 会话列表侧边栏 */}
      {showSessionList && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '200px',
            height: '100%',
            background: 'var(--bg-surface)',
            zIndex: 100,
            borderRight: '1px solid var(--border)',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '12px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>{t('app.session_list')}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
                {t('app.n_sessions', { count: sessions.length })}
              </div>
            </div>
            <BarButton
              icon="solar:close-circle-linear"
              title={t('app.close', { defaultValue: '关闭' })}
              onClick={() => setShowSessionList(false)}
            />
          </div>
          <div
            style={{
              padding: '8px 10px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Icon
              icon="solar:magnifer-linear"
              width={13}
              height={13}
              style={{ color: 'var(--text-muted)', flexShrink: 0 }}
            />
            <input
              value={sessionQuery}
              onChange={(e) => handleSessionQueryChange(e.target.value)}
              placeholder={t('chat.session_search_placeholder', { defaultValue: '搜索会话…' })}
              style={{
                flex: 1,
                minWidth: 0,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: '12px',
                color: 'var(--text-primary)',
              }}
            />
            {sessionQuery && (
              <button
                onClick={() => handleSessionQueryChange('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '12px',
                  padding: '0 2px',
                }}
                title={t('app.close', { defaultValue: '清除' })}
              >
                ✕
              </button>
            )}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
            {visibleSessions.length === 0 ? (
              <div
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '12px',
                  textAlign: 'center',
                  padding: '20px',
                }}
              >
                {sessions.length === 0
                  ? t('app.no_sessions')
                  : t('chat.session_search_no_result', { defaultValue: '无匹配会话' })}
              </div>
            ) : (
              visibleSessions.map((s) => {
                const active = s.id === activeSessionId;
                return (
                  <div
                    key={s.id}
                    onClick={() => handleSwitchSession(s.id)}
                    style={{
                      padding: '8px 10px',
                      marginBottom: '2px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      background: active ? 'var(--accent-soft)' : 'transparent',
                      transition: 'background 0.15s',
                    }}
                  >
                    <div
                      style={{
                        color: active ? 'var(--accent)' : 'var(--text-primary)',
                        fontSize: '12px',
                        fontWeight: active ? 600 : 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.title || t('app.new_session')}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: '2px',
                      }}
                    >
                      <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                        {t('app.n_messages', { count: s.messages.length })}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          // 防误删：确认后才删除（原生 confirm，与收藏清空一致）
                          if (window.confirm(t('chat.delete_session_confirm', { name: s.title }))) {
                            handleDeleteSession(s.id);
                          }
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-muted)',
                          fontSize: '11px',
                          cursor: 'pointer',
                          padding: '0 2px',
                        }}
                        title={t('app.delete')}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })
            )}
            {visibleSessions.length < filteredSessions.length && (
              <button
                onClick={() => setSessionPage((p) => p + 1)}
                style={{
                  display: 'block',
                  width: '100%',
                  margin: '8px 0 4px',
                  padding: '6px 0',
                  border: 'none',
                  borderRadius: '8px',
                  background: 'var(--bg-hover)',
                  color: 'var(--text-secondary)',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                {t('chat.load_more_sessions', {
                  defaultValue: '加载更多',
                  count: filteredSessions.length - visibleSessions.length,
                })}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 对话主体 */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {/* 顶部标题栏（仿 QQ 风格：单行紧凑） */}
        <div
          onMouseDown={handleBarDrag}
          style={{
            height: '44px',
            padding: '0 10px',
            background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            userSelect: 'none',
            flexShrink: 0,
            position: 'relative',
          }}
        >
          {/* 左侧：头像 + 标题 + 状态 */}
          <ChatAvatar role="assistant" src={appearance.aiAvatar} size={30} />
          <div
            style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: '6px' }}
          >
            <span
              style={{
                fontSize: '14px',
                fontWeight: 600,
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {t('chat.title')}
            </span>
            <span
              title={gatewayReady ? 'Gateway 已连接' : 'Gateway 未连接'}
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                flexShrink: 0,
                background: gatewayReady ? 'var(--color-success)' : 'var(--color-danger)',
              }}
            />
            <span
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`${contextUsed}/${contextTotal} tokens · ${(contextRatio * 100).toFixed(0)}%`}
            >
              {currentModel}
              {contextUsed > 0 && ` · ${contextUsed}/${contextTotal}`}
            </span>
          </div>

          {/* 右侧工具按钮组 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <BarButton
              icon={ttsEnabled ? 'solar:volume-loud-linear' : 'solar:volume-cross-linear'}
              title={ttsEnabled ? 'TTS 开启' : 'TTS 关闭'}
              active={ttsEnabled}
              onClick={handleToggleTts}
            />
            <BarButton
              icon="solar:hamburger-menu-linear"
              title="会话列表"
              active={showSessionList}
              onClick={() => setShowSessionList((p) => !p)}
            />
            <BarButton
              icon="solar:add-circle-linear"
              title={t('chat.new_chat')}
              onClick={handleNewChat}
            />
            <BarButton
              icon="solar:menu-dots-linear"
              title={t('chat.more', { defaultValue: '更多' })}
              active={showDetails}
              onClick={() => setShowDetails((p) => !p)}
            />

            <div
              style={{
                width: '1px',
                height: '18px',
                background: 'var(--border)',
                margin: '0 6px',
              }}
            />

            <BarButton
              icon="solar:minimize-linear"
              title={t('chat.minimize', { defaultValue: '缩小' })}
              onClick={handleMinimize}
            />
            <BarButton
              icon="solar:close-circle-linear"
              title={t('chat.collapse', { defaultValue: '收起' })}
              onClick={handleCloseWindow}
            />
          </div>

          {/* 上下文占用进度条（贴底） */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: '-1px',
              height: '2px',
              background: 'transparent',
            }}
          >
            <div
              style={{
                width: `${contextRatio * 100}%`,
                height: '100%',
                transition: 'width 0.3s',
                background:
                  contextRatio > 0.9
                    ? 'var(--color-danger)'
                    : contextRatio > 0.7
                      ? '#f59e0b'
                      : 'var(--accent)',
              }}
            />
          </div>
        </div>

        {/* Chat + 详情面板 并排 */}
        <div style={{ flex: 1, display: 'flex', position: 'relative', minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <ChatWindow
              ref={chatWindowRef}
              messages={messages}
              onSendMessage={handleSendMessage}
              isLoading={isLoading}
              isStreaming={isStreaming}
              onCancelStream={handleCancelStream}
              onNewChat={handleNewChat}
              onRecordStart={handleRecordStart}
              onRecordStop={handleRecordStop}
              isRecording={isRecording}
              sttAvailable={sttAvailable}
              callState={voiceCall.state}
              callSeconds={voiceCall.seconds}
              onToggleCall={voiceCall.toggle}
              sessionId={activeSessionId || undefined}
              gatewayReady={gatewayReady}
              currentModel={currentModel}
              contextUsed={contextUsed}
              contextTotal={contextTotal}
              onRenameSession={handleRenameSession}
              onClearContext={handleClearContext}
            />
          </div>

          {/* 右侧详情面板（默认收起） */}
          {showDetails && (
            <ChatDetailsPanel
              messages={messages}
              gatewayReady={gatewayReady}
              isStreaming={isStreaming}
              activeSessionId={activeSessionId}
              contextUsed={contextUsed}
              contextTotal={contextTotal}
              contextRatio={contextRatio}
              onJumpToMessage={handleJumpToMessage}
            />
          )}
        </div>
      </div>

      {/* Slash help overlay */}
      <SlashHelpOverlay
        commands={slashCommands}
        visible={showSlashHelp}
        onClose={() => setShowSlashHelp(false)}
        onSelect={() => setShowSlashHelp(false)}
      />
    </div>
  );
}

export default ChatPanelWindow;
