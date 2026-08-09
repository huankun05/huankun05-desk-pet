import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from '@iconify/react';
import { ChatWindow, type ChatWindowHandle, type Message } from './ChatWindow';
import { ChatAvatar } from './ChatAvatar';
import { useChatAppearance } from './useChatAppearance';
import { SlashHelpOverlay } from './SlashHelpOverlay';
import { FavoritesDrawer } from './FavoritesDrawer';
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
import { useHermesGateway } from '../../hooks/useHermesGateway';
import { useRagPersistence } from '../../hooks/useRagPersistence';
import { useMode } from '../../hooks/useMode';
import { SlashCommand, BUILTIN_COMMANDS } from '../../hooks/useSlashCommands';
import { toolRegistry } from '../../services/tools/registry';
import { registerBuiltinTools } from '../../services/tools/builtins';
import { eventBus } from '../../services/eventBus';
import { getHermesGatewayClient } from '../../services/hermesGateway';

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
  const { mode, toggleMode } = useMode();
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('deskpet_tts_enabled') !== 'false';
    } catch {
      return true;
    }
  });

  // 本地 RAG 记忆写入：面板对话完成后同样落盘（消息 id 唯一，与主窗口不会双写）
  const { addToRag } = useRagPersistence();

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
    ttsEnabled,
    onMessageComplete: async (
      userText,
      assistantText,
      sessionId,
      userMessageId,
      assistantMessageId,
    ) => {
      if (userMessageId && assistantMessageId && sessionId) {
        await addToRag(userText, assistantText, {
          userMessageId,
          assistantMessageId,
          sessionId,
        });
      }
    },
  });

  // 详情面板状态
  const [showDetails, setShowDetails] = useState(false);
  const [detailsWidth, setDetailsWidth] = useState<number>(320);
  const [detailsTab, setDetailsTab] = useState<'info' | 'context' | 'tasks' | 'tools'>('info');

  // Slash help overlay state
  const [showSlashHelp, setShowSlashHelp] = useState(false);

  // 会话管理状态（保留，用于侧边栏）
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSessionList, setShowSessionList] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);

  // Slash 命令列表（直接复用内置命令定义，避免与 useSlashCommands 漂移）
  const slashCommands = BUILTIN_COMMANDS;

  const handleSlashHelpToggle = useCallback(() => {
    setShowSlashHelp((p) => !p);
  }, []);

  // 确保面板启动时启用 Gateway + 移除首屏加载遮罩
  useEffect(() => {
    setGatewayEnabled(true);
    // 聊天面板窗没有 Live2D，不会触发 useLive2D 的遮罩移除，需手动处理
    const splash = document.getElementById('app-loading');
    if (splash) splash.remove();
  }, [setGatewayEnabled]);

  // 录音器初始化 + STT 可用性（通过 localStorage 标志从主窗口同步）
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
    const timer = setInterval(() => {
      try {
        setSttAvailable(localStorage.getItem('deskpet_sttAvailable') === 'true');
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  // 读取当前模型和上下文信息
  useEffect(() => {
    // 挂载时标记：首次 updateInfo 跳过 localStorage 旧值
    _contextResetTs = Date.now();
    _isFirstUpdate = true;
    try {
      localStorage.removeItem('deskpet_context_used');
    } catch { /* ignore */ }

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
    return () => { clearInterval(timer); clearTimeout(initTimer); };
  }, []);

  // 重置上下文显示（切换/删除/新建会话时调用，避免残留旧 token 数）
  const resetContextDisplay = useCallback(() => {
    setContextUsed(0);
    _contextResetTs = Date.now();
    try {
      localStorage.removeItem('deskpet_context_used');
      localStorage.removeItem('deskpet_context_total');
    } catch { /* ignore */ }
  }, []);

  // 注册内置工具并监听 Gateway 下发的前端工具调用
  useEffect(() => {
    registerBuiltinTools();

    const unsub = eventBus.on('tool:execute', async (payload) => {
      const { id, name, args } = payload as {
        id: string;
        name: string;
        args: Record<string, unknown>;
      };
      const tool = toolRegistry.get(name);
      if (!tool) {
        getHermesGatewayClient().sendToolResult(id, name, `Error: unknown tool '${name}'`, true);
        return;
      }
      try {
        const content = await tool.execute(args);
        getHermesGatewayClient().sendToolResult(id, name, content, false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        getHermesGatewayClient().sendToolResult(id, name, `Error: ${message}`, true);
      }
    });

    return () => unsub();
  }, []);

  // 详情面板拖拽调整宽度
  const handleDetailsMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = detailsWidth;
    const handleMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(240, Math.min(480, startWidth + delta));
      setDetailsWidth(newWidth);
    };
    const handleUp = () => {
      setDragging(false);
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const [dragging, setDragging] = useState(false);

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
        await providerManager.ready;
        const sttProvider = providerManager.getActiveSTTProvider();
        if (sttProvider) {
          const result = await sttProvider.transcribe(audio, 'wav');
          const text = (result as { text?: string } | undefined)?.text?.trim() || '';
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
          const win = window as any;
          const SpeechRecognition = win.webkitSpeechRecognition || win.SpeechRecognition;
          if (!SpeechRecognition) throw new Error('SpeechRecognition not available');
          const recognition = new SpeechRecognition();
          recognition.lang = 'zh-CN';
          recognition.interimResults = false;
          recognition.maxAlternatives = 1;
          const text = await new Promise<string>((resolve, reject) => {
            recognition.onresult = (event: any) => {
              const transcript = event.results[0][0].transcript;
              resolve(transcript);
            };
            recognition.onerror = (event: any) => {
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
        // 删除的是当前会话：同步加载下一个会话的消息，避免界面残留已删内容
        if (wasActive) loadSession(active.id);
      } else {
        setActiveSessionId(null);
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
      await sendMessage(text.trim(), mode, { quoted, attachments });
    },
    [sendMessage, isLoading, mode],
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

  // 模式切换：写入 localStorage + 一次弹跳动画作为明确反馈
  const [modePop, setModePop] = useState(false);
  const handleToggleMode = useCallback(() => {
    toggleMode();
    setModePop(true);
    setTimeout(() => setModePop(false), 280);
  }, [toggleMode]);

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

  const handleCloseWindow = useCallback(() => {
    // 收起而非销毁：隐藏窗口常驻，再次点击聊天键秒开（与设置窗一致）
    document.body.style.opacity = '0';
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().hide())
      .catch(() => (document.body.style.opacity = '1'));
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
          <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: '6px' }}>
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

          {/* 右侧：工具图标（精简分组） */}
          <button
            type="button"
            onClick={handleToggleMode}
            className={`chat-chip ${mode === 'work' ? 'chat-chip--active' : ''}${
              modePop ? ' chat-chip--pop' : ''
            }`}
            title={mode === 'work' ? '切换到聊天模式' : '切换到工作模式'}
            style={{ fontSize: '10px', padding: '2px 8px' }}
          >
            <Icon
              icon={mode === 'work' ? 'solar:case-minimalistic-bold' : 'solar:chat-round-bold'}
              width={11}
              height={11}
            />
            {mode === 'work' ? '工作' : '聊天'}
          </button>

          <BarButton icon={ttsEnabled ? 'solar:volume-loud-linear' : 'solar:volume-cross-linear'} title={ttsEnabled ? 'TTS 开启' : 'TTS 关闭'} active={ttsEnabled} onClick={handleToggleTts} />
          <BarButton icon="solar:hamburger-menu-linear" title="会话列表" active={showSessionList} onClick={() => setShowSessionList((p) => !p)} />
          <BarButton icon="solar:star-linear" title={t('chat.favorites_title')} active={showFavorites} onClick={() => setShowFavorites((p) => !p)} />
          <BarButton icon="solar:add-circle-linear" title={t('chat.new_chat')} onClick={handleNewChat} />
          <BarButton icon="solar:info-circle-linear" title="详情面板" active={showDetails} onClick={() => setShowDetails((p) => !p)} />
          <BarButton icon="solar:close-circle-linear" title={t('chat.collapse', { defaultValue: '收起' })} onClick={handleCloseWindow} />

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
            <div
              style={{
                width: detailsWidth,
                minWidth: '240px',
                maxWidth: '480px',
                background: 'var(--bg-surface)',
                borderLeft: dragging ? '2px solid var(--accent)' : '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
              }}
            >
              {/* 拖拽手柄 */}
              <div
                onMouseDown={handleDetailsMouseDown}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: '4px',
                  cursor: 'col-resize',
                  zIndex: 10,
                }}
              />
              <div
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  gap: '4px',
                }}
              >
                {(['info', 'context', 'tasks', 'tools'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setDetailsTab(tab)}
                    className={`chat-chip ${detailsTab === tab ? 'chat-chip--active' : ''}`}
                  >
                    {tab === 'info'
                      ? '信息'
                      : tab === 'context'
                        ? '上下文'
                        : tab === 'tasks'
                          ? '任务'
                          : '工具'}
                  </button>
                ))}
              </div>
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '12px',
                  color: 'var(--text-secondary)',
                  fontSize: '12px',
                  lineHeight: 1.7,
                }}
              >
                {detailsTab === 'info' && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div>会话：{activeSessionId || '未选择'}</div>
                    <div>消息数：{messages.length}</div>
                    <div>Gateway：{gatewayReady ? '已连接' : '未连接'}</div>
                  </div>
                )}
                {detailsTab === 'context' && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div>已用：{contextUsed}</div>
                    <div>总计：{contextTotal}</div>
                    <div>进度：{(contextRatio * 100).toFixed(1)}%</div>
                  </div>
                )}
                {detailsTab === 'tasks' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>用户消息</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{messages.filter(m => m.role === 'user').length}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>AI 回复</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{messages.filter(m => m.role === 'assistant').length}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>工具调用</span>
                        <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{messages.reduce((sum, m) => sum + (m.toolCalls?.length || 0), 0)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>流式中</span>
                        <span style={{ fontWeight: 600, color: isStreaming ? 'var(--accent)' : 'var(--text-muted)' }}>{isStreaming ? '是' : '否'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>总消息数</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{messages.length}</span>
                      </div>
                    </div>
                    {messages.length === 0 && (
                      <div style={{ color: 'var(--text-muted)', fontSize: '11px', textAlign: 'center', paddingTop: '20px' }}>
                        暂无消息数据
                      </div>
                    )}
                  </div>
                )}
                {detailsTab === 'tools' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {messages.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '11px', textAlign: 'center', paddingTop: '20px' }}>
                        暂无工具调用记录
                      </div>
                    ) : (
                      messages
                        .filter(m => m.toolCalls && m.toolCalls.length > 0)
                        .flatMap(m =>
                          (m.toolCalls || []).map((tc, i) => ({ ...tc, msgId: m.id, idx: i }))
                        )
                        .map((tc, i) => (
                          <div
                            key={`tool-${i}`}
                            style={{
                              padding: '8px',
                              borderRadius: '8px',
                              background: 'var(--bg-glass)',
                              border: '1px solid var(--glass-border)',
                              fontSize: '11px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                              <span
                                style={{
                                  width: '6px',
                                  height: '6px',
                                  borderRadius: '50%',
                                  flexShrink: 0,
                                  background:
                                    tc.status === 'running'
                                      ? '#f59e0b'
                                      : tc.status === 'success'
                                        ? 'var(--color-success)'
                                        : 'var(--color-danger)',
                                }}
                              />
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {tc.name}
                              </span>
                              <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0, fontSize: '10px' }}>
                                {tc.status === 'running' ? '运行中' : tc.status === 'success' ? '成功' : '失败'}
                              </span>
                            </div>
                            {tc.input != null && (
                              <div style={{ color: 'var(--text-secondary)', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.8 }}>
                                输入: {typeof tc.input === 'string' ? tc.input : String(JSON.stringify(tc.input)).slice(0, 80)}
                              </div>
                            )}
                            {tc.output != null && (
                              <div style={{ color: 'var(--text-muted)', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.7 }}>
                                输出: {typeof tc.output === 'string' ? tc.output : String(JSON.stringify(tc.output)).slice(0, 80)}
                              </div>
                            )}
                          </div>
                        ))
                    )}
                    {messages.filter(m => m.toolCalls && m.toolCalls.length > 0).length === 0 && messages.length > 0 && (
                      <div style={{ color: 'var(--text-muted)', fontSize: '11px', textAlign: 'center', paddingTop: '10px' }}>
                        当前会话无工具调用
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
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

      {/* 收藏查看抽屉 */}
      <FavoritesDrawer
        open={showFavorites}
        onClose={() => setShowFavorites(false)}
        sessionId={activeSessionId || undefined}
      />
    </div>
  );
}

export default ChatPanelWindow;
