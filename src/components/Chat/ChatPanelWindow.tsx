import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from '@iconify/react';
import { ChatWindow, type ChatWindowHandle, type Message } from './ChatWindow';
import { ChatAvatar } from './ChatAvatar';
import { useChatAppearance } from './useChatAppearance';
import { SlashHelpOverlay } from './SlashHelpOverlay';
import './chat-theme.css';
import { AudioRecorder } from '../../services/audio/recorder';
import {
  initChatStorage,
  listSessions,
  getActiveSession,
  switchSession,
  deleteSession,
  type ChatSession,
} from '../../services/chatStorage';
import { providerManager } from '../../services/provider/manager';
import { useHermesGateway } from '../../hooks/useHermesGateway';
import { SlashCommand } from '../../hooks/useSlashCommands';

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
  const [contextTotal, setContextTotal] = useState<number>(8192);
  const [mode, setMode] = useState<'work' | 'chat'>('chat');
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('deskpet_tts_enabled') !== 'false';
    } catch {
      return true;
    }
  });

  const {
    messages,
    isLoading,
    isStreaming,
    gatewayReady,
    sendMessage,
    interruptResponse,
    newChat,
    setGatewayEnabled,
  } = useHermesGateway({ ttsEnabled });

  // 详情面板状态
  const [showDetails, setShowDetails] = useState(false);
  const [detailsWidth, setDetailsWidth] = useState<number>(320);
  const [detailsTab, setDetailsTab] = useState<'info' | 'context' | 'tasks' | 'tools'>('info');

  // Slash help overlay state
  const [showSlashHelp, setShowSlashHelp] = useState(false);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);

  // 会话管理状态（保留，用于侧边栏）
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSessionList, setShowSessionList] = useState(false);

  // 初始化 Slash 命令列表
  useEffect(() => {
    setSlashCommands([
      { name: 'new', description: '新建会话', category: '会话', argsHint: '[标题]', icon: '📄' },
      { name: 'clear', description: '清屏并新建会话', category: '会话', icon: '🧹' },
      { name: 'retry', description: '重发最后一条消息', category: '会话', icon: '🔄' },
      {
        name: 'undo',
        description: '回退 N 条用户消息',
        category: '会话',
        argsHint: '[N]',
        icon: '↩️',
      },
      { name: 'stop', description: '停止当前生成', category: '会话', icon: '⏹️' },
      {
        name: 'model',
        description: '查看或切换模型',
        category: '模型',
        argsHint: '[模型名]',
        icon: '🧠',
      },
      { name: 'usage', description: '查看余额/用量', category: '模型', icon: '📊' },
      { name: 'status', description: '查看 Gateway 连接状态', category: '系统', icon: '📡' },
      {
        name: 'voice',
        description: '切换语音输入/TTS',
        category: '设置',
        argsHint: '[on|off]',
        icon: '🎙️',
      },
      { name: 'help', description: '显示帮助', category: '系统', icon: '❓' },
    ]);
  }, []);

  const handleSlashHelpToggle = useCallback(() => {
    setShowSlashHelp((p) => !p);
  }, []);

  // 确保面板启动时启用 Gateway
  useEffect(() => {
    setGatewayEnabled(true);
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
        if (used) setContextUsed(Number(used));
        if (total) setContextTotal(Number(total));
      } catch {
        // ignore
      }
      try {
        const m = localStorage.getItem('deskpet_mode');
        if (m === 'work' || m === 'chat') setMode(m);
      } catch {
        // ignore
      }
    };
    updateInfo();
    const timer = setInterval(updateInfo, 2000);
    return () => clearInterval(timer);
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

  const handleSwitchSession = useCallback((sessionId: string) => {
    const session = switchSession(sessionId);
    if (session) {
      setActiveSessionId(sessionId);
      setShowSessionList(false);
    }
  }, []);

  const handleDeleteSession = useCallback((sessionId: string) => {
    deleteSession(sessionId);
    const all = listSessions();
    setSessions(all);
    const active = getActiveSession();
    if (active) {
      setActiveSessionId(active.id);
    } else {
      setActiveSessionId(null);
    }
  }, []);

  const recentSessions = sessions.slice(0, 20);

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
    const all = listSessions();
    setSessions(all);
    const active = getActiveSession();
    setActiveSessionId(active?.id ?? null);
  }, [newChat]);

  // 模式切换：写入 localStorage + 一次弹跳动画作为明确反馈
  const [modePop, setModePop] = useState(false);
  const handleToggleMode = useCallback(() => {
    setMode((prev) => {
      const next = prev === 'work' ? 'chat' : 'work';
      try {
        localStorage.setItem('deskpet_mode', next);
      } catch {
        /* ignore */
      }
      return next;
    });
    setModePop(true);
    setTimeout(() => setModePop(false), 280);
  }, []);

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
    document.body.style.opacity = '0';
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().close())
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
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
            {recentSessions.length === 0 ? (
              <div
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '12px',
                  textAlign: 'center',
                  padding: '20px',
                }}
              >
                {t('app.no_sessions')}
              </div>
            ) : (
              recentSessions.map((s) => {
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
                          handleDeleteSession(s.id);
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
        {/* 顶部上下文栏 */}
        <div
          onMouseDown={handleBarDrag}
          style={{
            height: '46px',
            padding: '0 8px 0 12px',
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
          <ChatAvatar role="assistant" src={appearance.aiAvatar} size={28} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: '13px',
                fontWeight: 600,
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {t('chat.title')}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '11px',
                color: 'var(--text-muted)',
                lineHeight: 1.3,
              }}
            >
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
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={`${contextUsed}/${contextTotal} tokens`}
              >
                {currentModel} · {contextUsed}/{contextTotal}
              </span>
            </div>
          </div>

          {/* 模式切换：文字胶囊，切换时弹跳一下作为反馈 */}
          <button
            type="button"
            onClick={handleToggleMode}
            className={`chat-chip ${mode === 'work' ? 'chat-chip--active' : ''}${
              modePop ? ' chat-chip--pop' : ''
            }`}
            title={mode === 'work' ? '点击切换到聊天模式' : '点击切换到工作模式'}
          >
            <Icon
              icon={mode === 'work' ? 'solar:case-minimalistic-bold' : 'solar:chat-round-bold'}
              width={12}
              height={12}
            />
            {mode === 'work' ? '工作模式' : '聊天模式'}
          </button>

          <BarButton
            icon={ttsEnabled ? 'solar:volume-loud-linear' : 'solar:volume-cross-linear'}
            title={ttsEnabled ? 'TTS 已开启' : 'TTS 已关闭'}
            active={ttsEnabled}
            onClick={handleToggleTts}
          />
          <BarButton
            icon="solar:slash-square-linear"
            title="命令帮助"
            active={showSlashHelp}
            onClick={handleSlashHelpToggle}
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
            icon="solar:info-circle-linear"
            title="详情面板"
            active={showDetails}
            onClick={() => setShowDetails((p) => !p)}
          />
          <BarButton
            icon="solar:close-circle-linear"
            title={t('app.close', { defaultValue: '关闭' })}
            onClick={handleCloseWindow}
          />

          {/* 上下文占用：贴在标题栏底边的细进度条 */}
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
              ttsEnabled={ttsEnabled}
              onToggleTts={handleToggleTts}
              gatewayReady={gatewayReady}
              currentModel={currentModel}
              contextUsed={contextUsed}
              contextTotal={contextTotal}
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
                  <div style={{ color: 'var(--text-muted)' }}>
                    任务视图后续接入 Gateway goal/queue/agents
                  </div>
                )}
                {detailsTab === 'tools' && (
                  <div style={{ color: 'var(--text-muted)' }}>
                    工具调用视图后续接入 Gateway tool calls
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
    </div>
  );
}

export default ChatPanelWindow;
