import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from '@iconify/react';
import { ChatWindow, type ChatWindowHandle, type Message } from './ChatWindow';
import ConsentGate from '../../components/ConsentGate';
import { ChatAvatar } from './ChatAvatar';
import { useChatAppearance } from './useChatAppearance';
import { SlashHelpOverlay } from './SlashHelpOverlay';
import { loadFavorites, toggleFavorite, isFavorite } from './favorites';
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
import { useHermesGateway } from '../../hooks/useHermesGateway';
import { useVoiceCall } from '../../hooks/useVoiceCall';
import { useRagPersistence } from '../../hooks/useRagPersistence';
import { useMode } from '../../hooks/useMode';
import { BUILTIN_COMMANDS } from '../../hooks/useSlashCommands';
import { registerGatewayToolExecutor } from '../../services/tools/executor';
import { registerBuiltinTools } from '../../services/tools/builtins';
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

// 收藏结果操作按钮
const favBtnStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '4px',
  padding: '6px',
  border: '1px solid var(--glass-border)',
  borderRadius: '8px',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: '12px',
};

/** 查找结果片段：长文本按关键词窗口化并在匹配处高亮（仿 QQ 搜索结果） */
function HighlightSnippet({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  let display = text;
  if (q) {
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + q.length + 80);
      display = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    } else if (text.length > 140) {
      display = text.slice(0, 140) + '…';
    }
  } else if (text.length > 120) {
    display = text.slice(0, 120) + '…';
  }
  if (!q) return <>{display}</>;
  const lower = display.toLowerCase();
  const ql = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < display.length) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) {
      parts.push(display.slice(i));
      break;
    }
    if (idx > i) parts.push(display.slice(i, idx));
    parts.push(
      <mark
        key={key++}
        style={{
          background: 'rgba(245,166,35,0.35)',
          color: 'inherit',
          borderRadius: '3px',
          padding: '0 1px',
        }}
      >
        {display.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  return <>{parts}</>;
}

/** 月份天数 + 某月首日星期（周日=0） */
function getMonthMatrix(year: number, month: number): { blanks: number; days: number } {
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  return { blanks: firstDay, days };
}

/**
 * 消息日历（仿 QQ 聊天记录日历）：
 * - 有消息的日期下方带圆点标记
 * - 可切换上/下月
 * - 点击某天即筛选当天消息（selected 高亮）
 */
function MessageCalendar({
  dayMap,
  selected,
  onSelect,
}: {
  dayMap: Map<string, number>;
  selected: Date | null;
  onSelect: (d: Date) => void;
}) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(() => now.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => now.getMonth());
  const { t } = useTranslation();

  const { blanks, days } = getMonthMatrix(viewYear, viewMonth);
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

  const shiftMonth = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
  };

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < blanks; i++) {
    cells.push(<div key={`blank-${i}`} />);
  }
  for (let d = 1; d <= days; d++) {
    const key = `${viewYear}-${viewMonth}-${d}`;
    const hasMsg = dayMap.has(key);
    const count = dayMap.get(key) || 0;
    const isSelected =
      !!selected &&
      selected.getFullYear() === viewYear &&
      selected.getMonth() === viewMonth &&
      selected.getDate() === d;
    const isToday =
      now.getFullYear() === viewYear && now.getMonth() === viewMonth && now.getDate() === d;
    cells.push(
      <button
        key={`day-${d}`}
        type="button"
        title={hasMsg ? `${t('chat.calendar_day_count', { count })}` : undefined}
        onClick={() => onSelect(new Date(viewYear, viewMonth, d))}
        style={{
          position: 'relative',
          height: '30px',
          border: 'none',
          borderRadius: '8px',
          background: isSelected ? 'var(--accent)' : 'transparent',
          color: isSelected ? '#fff' : isToday ? 'var(--accent)' : 'var(--text-primary)',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: isToday || isSelected ? 600 : 400,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)';
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'transparent';
        }}
      >
        {d}
        {hasMsg && !isSelected && (
          <span
            style={{
              position: 'absolute',
              bottom: '3px',
              width: '4px',
              height: '4px',
              borderRadius: '50%',
              background: 'var(--accent)',
            }}
          />
        )}
      </button>,
    );
  }

  return (
    <div
      style={{
        border: '1px solid var(--glass-border)',
        borderRadius: '10px',
        background: 'var(--bg-glass)',
        padding: '8px',
      }}
    >
      {/* 月份导航 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '6px',
        }}
      >
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          title={t('app.prev', { defaultValue: '上个月' })}
          style={favBtnStyle}
        >
          <Icon icon="solar:alt-arrow-left-linear" width={14} height={14} />
        </button>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
          {viewYear} 年 {viewMonth + 1} 月
        </span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          title={t('app.next', { defaultValue: '下个月' })}
          style={favBtnStyle}
        >
          <Icon icon="solar:alt-arrow-right-linear" width={14} height={14} />
        </button>
      </div>
      {/* 星期表头 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: '2px',
          marginBottom: '2px',
        }}
      >
        {weekDays.map((w) => (
          <div
            key={w}
            style={{
              textAlign: 'center',
              fontSize: '10px',
              color: 'var(--text-muted)',
              padding: '2px 0',
            }}
          >
            {w}
          </div>
        ))}
      </div>
      {/* 日期网格 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
        {cells}
      </div>
    </div>
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
  // 语音通话是否激活（用于通话期间临时关闭聊天管线 TTS，避免与通话自身 playTts 双播）
  const [callActive, setCallActive] = useState(false);

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
    // 通话激活时临时关闭聊天 TTS，避免同一回复被聊天 onDone 与通话 playTts 各播一次
    ttsEnabled: ttsEnabled && !callActive,
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

  // 语音通话（QQ 式）：用到时由网关按需拉起本地 STT/TTS 服务
  const voiceCall = useVoiceCall({
    sendMessage,
    mode,
    showError: (m) => showToast(m, 'error'),
  });

  // 通话激活期间，把聊天管线的 TTS 临时置 false，朗读完全交给通话自身的 playTts（消除双播）
  useEffect(() => {
    setCallActive(voiceCall.active);
  }, [voiceCall.active]);

  // 详情面板状态
  const [showDetails, setShowDetails] = useState(false);
  const [detailsWidth, setDetailsWidth] = useState<number>(320);
  const [detailsTab, setDetailsTab] = useState<
    'info' | 'context' | 'tasks' | 'tools' | 'search' | 'favorites'
  >('info');

  // 详情面板「查找」筛选状态
  const [searchTabQuery, setSearchTabQuery] = useState('');
  const [searchType, setSearchType] = useState<'all' | 'user' | 'assistant'>('all');
  // 日期筛选：all = 不过滤；calendar = 选中某一天（searchCalendarDate）
  const [searchDate, setSearchDate] = useState<'all' | 'calendar'>('all');
  const [searchCalendarDate, setSearchCalendarDate] = useState<Date | null>(null);
  const [searchCalendarOpen, setSearchCalendarOpen] = useState(false);
  const searchCalendarRef = useRef<HTMLDivElement>(null);
  // 收藏列表刷新计数（消息收藏状态变更后重渲染）
  const [favTick, setFavTick] = useState(0);

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

  // ===== 详情面板「查找消息」：全量检索 + 类型/日历日期筛选 =====
  const searchTabResults = useMemo(() => {
    const q = searchTabQuery.trim().toLowerCase();
    // 选中某一天 → 当天 00:00 ~ 次日 00:00 区间
    let dayStart: Date | null = null;
    let dayEnd: Date | null = null;
    if (searchDate === 'calendar' && searchCalendarDate) {
      dayStart = new Date(
        searchCalendarDate.getFullYear(),
        searchCalendarDate.getMonth(),
        searchCalendarDate.getDate(),
      );
      dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);
    }
    return messages
      .filter((m) => {
        if (m.role === 'system') return false;
        if (searchType !== 'all' && m.role !== searchType) return false;
        if (dayStart && dayEnd) {
          const ts = m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp);
          if (ts < dayStart || ts >= dayEnd) return false;
        }
        if (q && !m.content.toLowerCase().includes(q)) return false;
        return true;
      })
      .map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp),
      }));
  }, [messages, searchTabQuery, searchType, searchDate, searchCalendarDate]);

  // 有消息的日期集合（用于日历标记点）：key = 'Y-M-D'
  const messageDayMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of messages) {
      if (m.role === 'system') continue;
      const d = m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [messages]);

  // 点击浮层外部（含其它 Tab 内容）自动收起日历，且不改变下方布局
  useEffect(() => {
    if (!searchCalendarOpen) return;
    const onDown = (e: MouseEvent) => {
      if (searchCalendarRef.current && !searchCalendarRef.current.contains(e.target as Node)) {
        setSearchCalendarOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [searchCalendarOpen]);

  // ===== 详情面板「收藏」：读取 localStorage 收藏夹（默认当前会话）=====
  const favorites = useMemo(() => {
    void favTick;
    const all = loadFavorites();
    const list = activeSessionId ? all.filter((f) => f.sessionId === activeSessionId) : all;
    return [...list].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }, [favTick, activeSessionId]);

  /** 跳转到某条消息（详情面板查找/收藏结果调用） */
  const handleJumpToMessage = useCallback((messageId: string) => {
    chatWindowRef.current?.jumpToMessage(messageId);
  }, []);

  const handleUnfavorite = useCallback(
    (item: {
      messageId: string;
      sessionId: string;
      content: string;
      role: 'user' | 'assistant';
      timestamp: string;
    }) => {
      toggleFavorite(
        {
          id: item.messageId,
          role: item.role,
          content: item.content,
          timestamp: new Date(item.timestamp),
        },
        item.sessionId,
      );
      setFavTick((n) => n + 1);
    },
    [],
  );

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
                  flexWrap: 'wrap',
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  background: 'var(--bg-surface)',
                }}
              >
                {(
                  [
                    { key: 'info', label: '信息' },
                    { key: 'context', label: '上下文' },
                    { key: 'tasks', label: '任务' },
                    { key: 'tools', label: '工具' },
                    { key: 'search', label: t('chat.tab_search', { defaultValue: '查找' }) },
                    { key: 'favorites', label: t('chat.tab_favorites', { defaultValue: '收藏' }) },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setDetailsTab(tab.key)}
                    className={`chat-chip ${detailsTab === tab.key ? 'chat-chip--active' : ''}`}
                  >
                    {tab.label}
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
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        fontSize: '12px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '4px 0',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <span style={{ color: 'var(--text-secondary)' }}>用户消息</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {messages.filter((m) => m.role === 'user').length}
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '4px 0',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <span style={{ color: 'var(--text-secondary)' }}>AI 回复</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {messages.filter((m) => m.role === 'assistant').length}
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '4px 0',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <span style={{ color: 'var(--text-secondary)' }}>工具调用</span>
                        <span style={{ fontWeight: 600, color: 'var(--accent)' }}>
                          {messages.reduce((sum, m) => sum + (m.toolCalls?.length || 0), 0)}
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '4px 0',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <span style={{ color: 'var(--text-secondary)' }}>流式中</span>
                        <span
                          style={{
                            fontWeight: 600,
                            color: isStreaming ? 'var(--accent)' : 'var(--text-muted)',
                          }}
                        >
                          {isStreaming ? '是' : '否'}
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '4px 0',
                        }}
                      >
                        <span style={{ color: 'var(--text-secondary)' }}>总消息数</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {messages.length}
                        </span>
                      </div>
                    </div>
                    {messages.length === 0 && (
                      <div
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: '11px',
                          textAlign: 'center',
                          paddingTop: '20px',
                        }}
                      >
                        暂无消息数据
                      </div>
                    )}
                  </div>
                )}
                {detailsTab === 'tools' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {messages.length === 0 ? (
                      <div
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: '11px',
                          textAlign: 'center',
                          paddingTop: '20px',
                        }}
                      >
                        暂无工具调用记录
                      </div>
                    ) : (
                      messages
                        .filter((m) => m.toolCalls && m.toolCalls.length > 0)
                        .flatMap((m) =>
                          (m.toolCalls || []).map((tc, i) => ({ ...tc, msgId: m.id, idx: i })),
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
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                marginBottom: '4px',
                              }}
                            >
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
                              <span
                                style={{
                                  fontWeight: 600,
                                  color: 'var(--text-primary)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {tc.name}
                              </span>
                              <span
                                style={{
                                  color: 'var(--text-muted)',
                                  marginLeft: 'auto',
                                  flexShrink: 0,
                                  fontSize: '10px',
                                }}
                              >
                                {tc.status === 'running'
                                  ? '运行中'
                                  : tc.status === 'success'
                                    ? '成功'
                                    : '失败'}
                              </span>
                            </div>
                            {tc.input != null && (
                              <div
                                style={{
                                  color: 'var(--text-secondary)',
                                  fontSize: '10px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  opacity: 0.8,
                                }}
                              >
                                输入:{' '}
                                {typeof tc.input === 'string'
                                  ? tc.input
                                  : String(JSON.stringify(tc.input)).slice(0, 80)}
                              </div>
                            )}
                            {tc.output != null && (
                              <div
                                style={{
                                  color: 'var(--text-muted)',
                                  fontSize: '10px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  opacity: 0.7,
                                }}
                              >
                                输出:{' '}
                                {typeof tc.output === 'string'
                                  ? tc.output
                                  : String(JSON.stringify(tc.output)).slice(0, 80)}
                              </div>
                            )}
                          </div>
                        ))
                    )}
                    {messages.filter((m) => m.toolCalls && m.toolCalls.length > 0).length === 0 &&
                      messages.length > 0 && (
                        <div
                          style={{
                            color: 'var(--text-muted)',
                            fontSize: '11px',
                            textAlign: 'center',
                            paddingTop: '10px',
                          }}
                        >
                          当前会话无工具调用
                        </div>
                      )}
                  </div>
                )}
                {detailsTab === 'search' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {/* 搜索框 */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 8px',
                        background: 'var(--bg-glass)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: '8px',
                      }}
                    >
                      <Icon
                        icon="solar:magnifer-linear"
                        width={14}
                        height={14}
                        style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                      />
                      <input
                        autoFocus
                        value={searchTabQuery}
                        onChange={(e) => setSearchTabQuery(e.target.value)}
                        placeholder={t('chat.search_placeholder', { defaultValue: '搜索消息…' })}
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
                      {searchTabQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchTabQuery('')}
                          title={t('app.close', { defaultValue: '清除' })}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '12px',
                            padding: '0 2px',
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* 类型筛选 */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{ fontSize: '11px', color: 'var(--text-muted)', marginRight: '2px' }}
                      >
                        {t('chat.search_type', { defaultValue: '类型' })}
                      </span>
                      {(
                        [
                          ['all', t('chat.search_type_all', { defaultValue: '全部' })],
                          ['user', t('chat.search_type_user', { defaultValue: '我' })],
                          ['assistant', t('chat.search_type_assistant', { defaultValue: 'AI' })],
                        ] as const
                      ).map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setSearchType(val)}
                          className={`chat-chip ${searchType === val ? 'chat-chip--active' : ''}`}
                          style={{ fontSize: '11px', padding: '2px 8px' }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* 日期筛选：仿 QQ 聊天记录日历（浮层弹出，不挤占下方消息） */}
                    <div
                      ref={searchCalendarRef}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        position: 'relative',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => setSearchCalendarOpen((o) => !o)}
                          className={`chat-chip ${searchCalendarOpen || searchDate === 'calendar' ? 'chat-chip--active' : ''}`}
                          style={{ fontSize: '11px', padding: '2px 8px' }}
                        >
                          {t('chat.calendar', { defaultValue: '日历' })}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSearchDate('all');
                            setSearchCalendarDate(null);
                            setSearchCalendarOpen(false);
                          }}
                          className={`chat-chip ${searchDate === 'all' ? 'chat-chip--active' : ''}`}
                          style={{ fontSize: '11px', padding: '2px 8px', marginLeft: 'auto' }}
                        >
                          {t('chat.calendar_reset', { defaultValue: '全部时间' })}
                        </button>
                      </div>

                      {/* 浮层日历：绝对定位覆盖在消息上方，开关不改变下方布局 */}
                      {searchCalendarOpen && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            position: 'absolute',
                            zIndex: 20,
                            top: '100%',
                            left: 0,
                            right: 0,
                            marginTop: '4px',
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border)',
                            borderRadius: '10px',
                            boxShadow: 'var(--shadow-md)',
                            padding: '8px',
                          }}
                        >
                          <MessageCalendar
                            dayMap={messageDayMap}
                            selected={searchCalendarDate}
                            onSelect={(d) => {
                              setSearchCalendarDate(d);
                              setSearchDate('calendar');
                              setSearchCalendarOpen(false);
                            }}
                          />
                        </div>
                      )}

                      {searchDate === 'calendar' && searchCalendarDate && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {`${searchCalendarDate.getFullYear()}-${searchCalendarDate.getMonth() + 1}-${searchCalendarDate.getDate()} · `}
                          {t('chat.calendar_day_count', {
                            defaultValue: '{{count}} 条',
                            count: searchTabResults.length,
                          })}
                        </div>
                      )}
                    </div>

                    {/* 结果计数 / 提示 */}
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {searchTabQuery.trim() || searchType !== 'all' || searchDate !== 'all'
                        ? t('chat.search_result_count', {
                            defaultValue: '找到 {{count}} 条',
                            count: searchTabResults.length,
                          })
                        : t('chat.search_no_result_hint', {
                            defaultValue: '输入关键词，或选择类型/时间筛选消息',
                          })}
                    </div>

                    {/* 结果列表 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {searchTabResults.length === 0 ? (
                        <div
                          style={{
                            color: 'var(--text-muted)',
                            fontSize: '11px',
                            textAlign: 'center',
                            paddingTop: '16px',
                          }}
                        >
                          {t('chat.search_no_result', { defaultValue: '无匹配消息' })}
                        </div>
                      ) : (
                        searchTabResults.slice(0, 300).map((r) => {
                          const fav = activeSessionId ? isFavorite(r.id, activeSessionId) : false;
                          return (
                            <div
                              key={r.id}
                              onClick={() => handleJumpToMessage(r.id)}
                              style={{
                                padding: '8px 10px',
                                borderRadius: '8px',
                                background: 'var(--bg-glass)',
                                border: '1px solid var(--glass-border)',
                                cursor: 'pointer',
                                fontSize: '12px',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  marginBottom: '4px',
                                  gap: '6px',
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    color:
                                      r.role === 'user' ? 'var(--accent)' : 'var(--text-secondary)',
                                  }}
                                >
                                  {r.role === 'user' ? '你' : 'AI'}
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                    {r.timestamp.toLocaleString([], {
                                      month: '2-digit',
                                      day: '2-digit',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                  <button
                                    type="button"
                                    title={t('chat.favorites_title')}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!activeSessionId) return;
                                      const added = toggleFavorite(
                                        {
                                          id: r.id,
                                          role: r.role,
                                          content: r.content,
                                          timestamp: r.timestamp,
                                        },
                                        activeSessionId,
                                      );
                                      setFavTick((n) => n + 1);
                                      showToast(
                                        added
                                          ? t('chat.favorited', { defaultValue: '已收藏' })
                                          : t('chat.unfavorited', { defaultValue: '已取消收藏' }),
                                        'success',
                                      );
                                    }}
                                    style={{
                                      border: 'none',
                                      background: 'transparent',
                                      color: fav ? '#f5a623' : 'var(--text-muted)',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      padding: '2px',
                                    }}
                                  >
                                    <Icon
                                      icon={fav ? 'solar:star-bold' : 'solar:star-linear'}
                                      width={13}
                                      height={13}
                                    />
                                  </button>
                                </div>
                              </div>
                              <div
                                style={{
                                  color: 'var(--text-primary)',
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  maxHeight: '120px',
                                  overflow: 'hidden',
                                }}
                              >
                                <HighlightSnippet text={r.content} query={searchTabQuery} />
                              </div>
                            </div>
                          );
                        })
                      )}
                      {searchTabResults.length > 300 && (
                        <div
                          style={{
                            fontSize: '10px',
                            color: 'var(--text-muted)',
                            textAlign: 'center',
                          }}
                        >
                          {t('chat.search_more_hint', { defaultValue: '仅显示前 300 条' })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {detailsTab === 'favorites' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {favorites.length === 0 ? (
                      <div
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: '12px',
                          textAlign: 'center',
                          paddingTop: '40px',
                        }}
                      >
                        {t('chat.no_favorites', { defaultValue: '还没有收藏的消息' })}
                      </div>
                    ) : (
                      favorites.map((item) => (
                        <div
                          key={`${item.sessionId}-${item.messageId}`}
                          style={{
                            border: '1px solid var(--glass-border)',
                            borderRadius: '10px',
                            background: 'var(--bg-glass)',
                            padding: '10px 12px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: '6px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 600,
                                color:
                                  item.role === 'user' ? 'var(--accent)' : 'var(--text-secondary)',
                              }}
                            >
                              {item.role === 'user' ? '你' : 'AI'}
                            </span>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                              {new Date(item.timestamp).toLocaleString([], {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div
                            onClick={() => handleJumpToMessage(item.messageId)}
                            style={{
                              fontSize: '13px',
                              lineHeight: 1.5,
                              color: 'var(--text-primary)',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              maxHeight: '160px',
                              overflowY: 'auto',
                              cursor: 'pointer',
                            }}
                          >
                            {item.content}
                          </div>
                          <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
                            <button
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(item.content);
                                  showToast(
                                    t('chat.copied', { defaultValue: '已复制' }),
                                    'success',
                                  );
                                } catch {
                                  showToast('复制失败', 'error');
                                }
                              }}
                              title={t('chat.copy', { defaultValue: '复制' })}
                              style={favBtnStyle}
                            >
                              <Icon icon="solar:copy-linear" width={14} height={14} />
                            </button>
                            <button
                              onClick={() => handleUnfavorite(item)}
                              title={t('chat.unfavorite')}
                              style={favBtnStyle}
                            >
                              <Icon
                                icon="solar:star-bold"
                                width={14}
                                height={14}
                                style={{ color: '#f5a623' }}
                              />
                            </button>
                          </div>
                        </div>
                      ))
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
    </div>
  );
}

export default ChatPanelWindow;
