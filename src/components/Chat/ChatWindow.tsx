import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useLayoutEffect,
  memo,
  useCallback,
  forwardRef,
  useImperativeHandle,
  Fragment,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { MessageItem } from './MessageItem';
import { aiService } from '../../services/ai';
import { eventBus } from '../../services/eventBus';
import { openSettingsAt } from '../../utils/openSettings';
import { useSlashCommands, SLASH_COMMANDS_CHANGED } from '../../hooks/useSlashCommands';
import { useChatAppearance } from './useChatAppearance';
import { APPEARANCE_KEYS, CHAT_APPEARANCE_EVENT } from '../../settings/appearanceConfig';
import { writeStorage } from '../../hooks/useStorageEvent';
import { isTauriEnv } from '../../utils/tauriEnv';
import './chat-theme.css';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  emotion?: string;
  /** 工具调用（assistant 消息可附带） */
  toolCalls?: Array<{
    name: string;
    input: unknown;
    output: unknown;
    status?: 'running' | 'success' | 'error';
  }>;
  quoted?: {
    messageId: string;
    content: string;
    role: 'user' | 'assistant';
  };
  /** 消息附件（图片/文件） */
  attachments?: Array<{
    type: 'image' | 'file';
    url: string;
    name?: string;
    size?: number;
    mimeType?: string;
  }>;
}

/** 命令式句柄：供父组件（如面板窗 STT）向输入框回填草稿文本 */
export interface ChatWindowHandle {
  setDraft: (text: string) => void;
  /** 跳转到指定消息并高亮（详情面板的查找/收藏结果调用） */
  jumpToMessage: (messageId: string) => void;
}

/** 日期分隔：今天 / 昨天 / 年月日 */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDateLabel(d: Date): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, now)) return '今天';
  if (isSameDay(d, yesterday)) return '昨天';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 时间分隔标签：QQ 风格 — 两条消息间隔超过阈值时在中间显示时间 */
const TIME_SEPARATOR_MINUTES = 5;

function needsTimeSeparator(prev: Message | null | undefined, curr: Message): boolean {
  if (!prev) return false;
  // 不同角色总是需要间隔（用户/AI 切换）
  if (prev.role !== curr.role) {
    const prevTs = prev.timestamp instanceof Date ? prev.timestamp : new Date(prev.timestamp);
    const currTs = curr.timestamp instanceof Date ? curr.timestamp : new Date(curr.timestamp);
    const gapMinutes = (currTs.getTime() - prevTs.getTime()) / 60000;
    return gapMinutes >= TIME_SEPARATOR_MINUTES;
  }
  // 同角色：间隔超过阈值才显示
  const prevTs = prev.timestamp instanceof Date ? prev.timestamp : new Date(prev.timestamp);
  const currTs = curr.timestamp instanceof Date ? curr.timestamp : new Date(curr.timestamp);
  const gapMinutes = (currTs.getTime() - prevTs.getTime()) / 60000;
  return gapMinutes >= TIME_SEPARATOR_MINUTES;
}

function formatTimeLabel(d: Date): string {
  try {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

interface ChatWindowProps {
  messages: Message[];
  onSendMessage: (
    message:
      | string
      | {
          text: string;
          quoted?: { messageId: string; content: string; role: 'user' | 'assistant' };
          attachments?: Message['attachments'];
        },
  ) => void;
  isLoading?: boolean;
  isStreaming?: boolean;
  onCancelStream?: () => void;
  onNewChat?: () => void;
  /** 录音开始回调 */
  onRecordStart?: () => void;
  /** 录音结束回调 */
  onRecordStop?: () => void;
  /** 是否正在录音 */
  isRecording?: boolean;
  /** STT 服务是否可用（控制录音按钮显示） */
  sttAvailable?: boolean;
  /** 语音通话状态（QQ 式语音通话） */
  callState?: string;
  /** 通话秒数 */
  callSeconds?: number;
  /** 切换语音通话（开/关） */
  onToggleCall?: () => void;
  /** 当前会话 ID（用于收藏等） */
  sessionId?: string;
  // TTS 按钮已移至头部栏（ChatPanelWindow），以下保留接口兼容性但不再使用
  // ttsEnabled?: boolean;
  // onToggleTts?: () => void;
  onClose?: () => void;
  /** Gateway 连接状态（供 /status 命令反馈） */
  gatewayReady?: boolean;
  /** 当前模型名（供 /status、/model 命令反馈） */
  currentModel?: string;
  /** 已用上下文 token 数（供 /status、/usage 命令反馈） */
  contextUsed?: number;
  /** 上下文 token 上限（供 /status、/usage 命令反馈） */
  contextTotal?: number;
  /** /rename 命令：重命名当前会话（由父窗口落地到存储并刷新侧栏） */
  onRenameSession?: (title: string) => void;
  /** /clearctx 命令：清空当前会话上下文（由父窗口清存储并 reload） */
  onClearContext?: () => void;
}

/** 消息搜索导航按钮样式 */
const searchNavBtnStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  border: 'none',
  borderRadius: '6px',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

/** 输入区工具按钮 */
function ToolButton({
  icon,
  title,
  active,
  danger,
  onClick,
  onMouseDown,
  onMouseUp,
  onTouchStart,
  onTouchEnd,
}: {
  icon: string;
  title: string;
  active?: boolean;
  danger?: boolean;
  onClick?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseUp?: () => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchEnd?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        width: 28,
        height: 28,
        border: 'none',
        borderRadius: '6px',
        background: danger ? 'var(--color-danger)' : 'transparent',
        color: danger ? '#fff' : active ? 'var(--accent)' : 'var(--text-secondary)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.15s, color 0.15s',
        animation: danger ? 'pulse-recording 1s infinite' : 'none',
      }}
      onMouseEnter={(e) => {
        if (!danger) e.currentTarget.style.background = 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        if (!danger) e.currentTarget.style.background = 'transparent';
      }}
    >
      <Icon icon={icon} width={17} height={17} />
    </button>
  );
}

export const ChatWindow = memo(
  forwardRef<ChatWindowHandle, ChatWindowProps>(function ChatWindow(
    {
      messages,
      onSendMessage,
      isLoading = false,
      isStreaming = false,
      onCancelStream,
      onNewChat,
      onRecordStart,
      onRecordStop,
      isRecording = false,
      sttAvailable = false,
      callState = 'idle',
      callSeconds = 0,
      onToggleCall,
      sessionId,
      gatewayReady = false,
      currentModel,
      contextUsed = 0,
      contextTotal = 0,
      onRenameSession,
      onClearContext,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const appearance = useChatAppearance();
    const [input, setInput] = useState('');
    // textarea 高度由 state 驱动，避免直接改写 ref.current.style（触发 react-hooks/immutability）
    const [textareaHeight, setTextareaHeight] = useState<string>('auto');

    // 命令式句柄：允许父组件（如面板窗的 STT 结果）回填草稿文本到输入框
    const [quotedMessage, setQuotedMessage] = useState<Message | null>(null);
    const [quotedReply, setQuotedReply] = useState<
      { messageId: string; content: string; role: 'user' | 'assistant' } | undefined
    >(undefined);
    const [pendingAttachments, setPendingAttachments] = useState<
      NonNullable<Message['attachments']>
    >([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // 追踪附件创建的 blob URL，组件卸载时统一释放
    const blobUrlsRef = useRef<string[]>([]);

    /** 把一组文件（来自文件选择或剪贴板粘贴）作为待发送附件 */
    const appendFiles = useCallback((files: FileList | File[]) => {
      const arr = Array.from(files);
      if (!arr.length) return;
      const newAttachments: NonNullable<Message['attachments']> = [];
      const newBlobUrls: string[] = [];
      arr.forEach((file) => {
        const isImage = file.type.startsWith('image/');
        const url = isImage ? URL.createObjectURL(file) : '';
        if (url) newBlobUrls.push(url);
        newAttachments.push({
          type: isImage ? 'image' : 'file',
          url,
          name: file.name,
          size: file.size,
          mimeType: file.type,
        });
      });
      setPendingAttachments((prev) => {
        prev.forEach((a) => {
          if (a.url && a.url.startsWith('blob:')) URL.revokeObjectURL(a.url);
        });
        return [...prev, ...newAttachments];
      });
      blobUrlsRef.current.push(...newBlobUrls);
    }, []);
    // 是否已配置 LLM：未配置时在空状态给出引导横幅（配置来自独立 webview，监听聚焦时复检）
    const [llmConfigured, setLlmConfigured] = useState<boolean>(() => {
      try {
        return !!aiService.getChatProvider();
      } catch {
        return false;
      }
    });

    // Slash 命令结果反馈（/status、/model、/usage、/retry 的可见出口）
    const [notice, setNotice] = useState<{
      kind: 'info' | 'success' | 'error';
      text: string;
    } | null>(null);
    const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const showNotice = useCallback((kind: 'info' | 'success' | 'error', text: string) => {
      setNotice({ kind, text });
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = setTimeout(() => setNotice(null), 4500);
    }, []);
    useEffect(() => {
      return () => {
        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      };
    }, []);

    // ===== 消息搜索 =====
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchHit, setSearchHit] = useState(0);
    const [highlightedId, setHighlightedId] = useState<string | null>(null);

    // AI 响应状态（思考 / 回复 / 调用工具），驱动聊天窗口顶部状态条
    const [aiPhase, setAiPhase] = useState<'idle' | 'thinking' | 'replying' | 'tool'>('idle');
    const [toolLabel, setToolLabel] = useState('');
    const toolFriendlyName = useCallback((name: string): string => {
      const map: Record<string, string> = {
        web_search: '联网搜索',
        get_current_time: '获取时间',
        save_to_desktop: '保存文件',
        system_info: '系统信息',
      };
      return map[name] ?? name;
    }, []);

    const searchResults = useMemo(() => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return [] as number[];
      const hits: number[] = [];
      messages.forEach((m, i) => {
        if (m.content.toLowerCase().includes(q)) hits.push(i);
      });
      return hits;
    }, [messages, searchQuery]);

    // 跳到上一条/下一条命中：扩大渲染窗口保证目标可见，再滚动定位 + 高亮
    const jumpToSearch = (dir: 1 | -1) => {
      if (searchResults.length === 0) return;
      const idx = (searchHit + dir + searchResults.length) % searchResults.length;
      setSearchHit(idx);
      const target = searchResults[idx];
      setHighlightedId(messages[target].id);
      setVisibleCount((c) => Math.max(c, messages.length - target));
    };

    // 高亮消息滚动定位（等渲染完成后执行）
    useEffect(() => {
      if (!highlightedId) return;
      const el = messagesContainerRef.current?.querySelector(`[data-msg-id="${highlightedId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const timer = setTimeout(() => setHighlightedId(null), 1800);
      return () => clearTimeout(timer);
    }, [highlightedId]);

    // ===== 无限滚动（渲染窗口 + 顶部加载更早）=====
    const INITIAL_VISIBLE = 50;
    const STEP_VISIBLE = 50;
    const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
    const prevScrollHeightRef = useRef(0);

    // 命令式句柄：供父组件（面板窗 STT 回填 / 详情面板查找·收藏跳转）调用。
    // 必须置于 setVisibleCount / setHighlightedId 声明之后，满足 react-hooks/immutability。
    useImperativeHandle(
      ref,
      () => ({
        setDraft: (text: string) => {
          setInput(text);
          requestAnimationFrame(() => textareaRef.current?.focus());
        },
        jumpToMessage: (messageId: string) => {
          const idx = messages.findIndex((m) => m.id === messageId);
          if (idx < 0) return;
          // 扩大渲染窗口，确保目标消息已渲染（更早的消息可能还在窗口外）
          setVisibleCount((c) => Math.max(c, messages.length - idx));
          setHighlightedId(messageId);
        },
      }),
      [setInput, messages],
    );

    // isStreaming 翻转时重置 / 清除顶部状态条
    useEffect(() => {
      void (async () => {
        if (isStreaming) {
          setAiPhase((p) => (p === 'idle' ? 'thinking' : p));
        } else {
          setAiPhase('idle');
          setToolLabel('');
        }
      })();
    }, [isStreaming]);

    // 订阅 Gateway 事件，细化状态条：思考 → 回复 → 调用工具 → 回复
    useEffect(() => {
      const offToken = eventBus.on('hermes:token', () => {
        setAiPhase((p) => (p === 'thinking' || p === 'tool' ? 'replying' : p));
      });
      const offCall = eventBus.on('tool:call', (p) => {
        setAiPhase('tool');
        setToolLabel(toolFriendlyName(p.name));
      });
      const offResult = eventBus.on('tool:result', (p) => {
        setToolLabel(`${toolFriendlyName(p.name)} 完成`);
        window.setTimeout(() => {
          setAiPhase((cur) => (cur === 'tool' ? 'replying' : cur));
        }, 700);
      });
      const offDone = eventBus.on('hermes:done', () => {
        setAiPhase('idle');
        setToolLabel('');
      });
      return () => {
        offToken();
        offCall();
        offResult();
        offDone();
      };
    }, [toolFriendlyName, t]);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
      // 流式中不加载更早：与强制滚底的 RAF 循环冲突，避免滚动位置被拉回
      if (isStreaming) return;
      const el = e.currentTarget;
      if (el.scrollTop < 60 && visibleCount < messages.length) {
        prevScrollHeightRef.current = el.scrollHeight;
        setVisibleCount((c) => Math.min(messages.length, c + STEP_VISIBLE));
      }
    };

    // 顶部加载更早后补偿滚动位置，避免内容跳动
    useLayoutEffect(() => {
      const el = messagesContainerRef.current;
      if (el && prevScrollHeightRef.current > 0) {
        el.scrollTop += el.scrollHeight - prevScrollHeightRef.current;
        prevScrollHeightRef.current = 0;
      }
    }, [visibleCount]);

    const loadEarlier = () => {
      if (isStreaming) return;
      const el = messagesContainerRef.current;
      if (el) prevScrollHeightRef.current = el.scrollHeight;
      setVisibleCount((c) => Math.min(messages.length, c + STEP_VISIBLE));
    };

    const displayedMessages = messages.slice(-visibleCount);
    const hiddenCount = messages.length - displayedMessages.length;

    const {
      input: slashInput,
      setInput: setSlashInput,
      slashActive,
      handleKeyDown: handleSlashKeyDown,
      handleSubmit: handleSlashSubmit,
      reset: resetSlash,
      reloadCustomCommands,
    } = useSlashCommands({
      onNewChat: () => onNewChat?.(),
      onRetry: () => {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        if (!lastUser) {
          showNotice('error', '当前没有可重试的用户消息');
          return;
        }
        onSendMessage(lastUser.content);
        showNotice('info', '已重发上一条用户消息');
      },
      onStop: () => onCancelStream?.(),
      onModelChange: (model?: string) => {
        const current = aiService.getConfig().model || '未知';
        if (!model) {
          showNotice('info', `当前模型：${current}`);
          return;
        }
        try {
          aiService.saveConfig({ model });
          showNotice('success', `已切换模型 → ${model}`);
        } catch (e) {
          showNotice('error', `切换模型失败：${(e as Error)?.message ?? String(e)}`);
        }
      },
      onStatus: () => {
        const status = gatewayReady ? '已连接' : '未连接';
        const model = currentModel || aiService.getConfig().model || '未知';
        showNotice(
          'info',
          `Gateway：${status} · 模型：${model} · 上下文：${contextUsed}/${contextTotal}`,
        );
      },
      onUsage: () => {
        const total = contextTotal || 0;
        const used = contextUsed || 0;
        const pct = total > 0 ? Math.round((used / total) * 100) : 0;
        showNotice('info', `上下文用量：${used}/${total} tokens（${pct}%）`);
      },
      onExport: () => {
        try {
          const lines = messages.map((m) => {
            const role = m.role === 'user' ? '## 用户' : '## 助手';
            const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            return `${role}\n\n${text}\n`;
          });
          const md = `# 会话导出 ${new Date().toLocaleString()}\n\n${lines.join('\n')}`;
          const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `session-${sessionId || 'chat'}-${Date.now()}.md`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showNotice('success', '已导出当前会话');
        } catch (e) {
          showNotice('error', `导出失败：${(e as Error)?.message ?? String(e)}`);
        }
      },
      onRename: (title: string) => {
        onRenameSession?.(title);
        showNotice('success', `会话已重命名为「${title}」`);
      },
      onTheme: (theme?: 'light' | 'dark') => {
        const next = theme ?? (appearance.theme === 'dark' ? 'light' : 'dark');
        writeStorage(APPEARANCE_KEYS.chatTheme, next);
        if (isTauriEnv()) {
          void import('@tauri-apps/api/event')
            .then(({ emit }) => emit(CHAT_APPEARANCE_EVENT))
            .catch(() => {
              /* 广播失败不影响本地写入 */
            });
        }
        showNotice('success', `已切换主题 → ${next === 'dark' ? '深色' : '浅色'}`);
      },
      onClearCtx: () => {
        onClearContext?.();
        showNotice('success', '已清空当前会话的上下文历史');
      },
    });

    useEffect(() => {
      const recheck = () => {
        try {
          setLlmConfigured(!!aiService.getChatProvider());
        } catch {
          /* ignore */
        }
      };
      // 从设置窗返回时复检配置状态
      window.addEventListener('focus', recheck);
      return () => window.removeEventListener('focus', recheck);
    }, []);

    // 设置页增删改自定义命令后，跨 webview 实时重载自动补全与执行路由
    useEffect(() => {
      if (!isTauriEnv()) {
        window.addEventListener('focus', reloadCustomCommands);
        return () => window.removeEventListener('focus', reloadCustomCommands);
      }
      let unlisten: (() => void) | undefined;
      void import('@tauri-apps/api/event')
        .then(({ listen }) => listen<unknown>(SLASH_COMMANDS_CHANGED, () => reloadCustomCommands()))
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {
          /* 事件系统不可用时忽略，下次聚焦仍会重载 */
        });
      return () => unlisten?.();
    }, [reloadCustomCommands]);

    // 消息搜索键盘快捷键：Ctrl/Cmd+F 打开，Esc 关闭
    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          setSearchOpen(true);
          return;
        }
        if (e.key === 'Escape' && searchOpen) {
          setSearchOpen(false);
          setSearchQuery('');
          setSearchHit(0);
          setHighlightedId(null);
        }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [searchOpen]);

    // 自动滚动到底部（新增消息 / 流式输出时）。
    // 关键：用 behavior:'auto'（瞬时、无动画），与 QQ 一致——打开会话直接停在最新消息，
    // 而不是从顶部「平滑滚动」到底部。加载/切换会话的瞬时定位由下方 useLayoutEffect 负责。
    useEffect(() => {
      const container = messagesContainerRef.current;
      if (!container) return;
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      if (isNearBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }
    }, [messages]);

    // 打开/切换会话时定位到最新消息：挂载、会话切换、以及当前会话从空变有（初始加载）都强制滚到底部。
    // 注意：仅在「加载时刻」触发一次，不与流式 RAF 滚动冲突（流式期间 pending 始终为 false）。
    const pendingScrollBottomRef = useRef(true);
    const lastSessionRef = useRef<string | undefined>(undefined);
    const prevMsgLenRef = useRef(0);
    useLayoutEffect(() => {
      if (lastSessionRef.current !== sessionId) {
        lastSessionRef.current = sessionId;
        setVisibleCount(INITIAL_VISIBLE);
        pendingScrollBottomRef.current = true;
      }
      // 当前会话首次加载（空 → 有）也要滚到底
      if (prevMsgLenRef.current === 0 && messages.length > 0) {
        pendingScrollBottomRef.current = true;
      }
      prevMsgLenRef.current = messages.length;
      if (pendingScrollBottomRef.current) {
        const el = messagesContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        pendingScrollBottomRef.current = false;
      }
    }, [messages, sessionId]);

    // 流式输出时持续滚动（RAF 代替 100ms setInterval，按帧节流）
    useEffect(() => {
      if (!isStreaming) return;
      const container = messagesContainerRef.current;
      if (!container) return;
      let rafId: number;
      let lastScroll = 0;
      const scroll = () => {
        const now = performance.now();
        if (now - lastScroll >= 100) {
          lastScroll = now;
          messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
        }
        rafId = requestAnimationFrame(scroll);
      };
      rafId = requestAnimationFrame(scroll);
      return () => cancelAnimationFrame(rafId);
    }, [isStreaming]);

    // 组件卸载时释放所有附件 blob URL，防止内存泄漏
    useEffect(() => {
      return () => {
        blobUrlsRef.current.forEach((url) => {
          try {
            URL.revokeObjectURL(url);
          } catch {
            /* ignore */
          }
        });
        blobUrlsRef.current = [];
      };
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = (slashInput || input).trim();
      if (!trimmed || isLoading) return;

      const slashResult = handleSlashSubmit(trimmed);
      if (slashResult.handled) {
        if (slashResult.macro !== undefined) {
          // 宏命令：把预设文本填入输入框，用户确认后再发送
          setInput(slashResult.macro);
          setSlashInput(slashResult.macro);
        } else {
          setInput('');
          setSlashInput('');
          resetSlash();
        }
        return;
      }

      const payload: {
        text: string;
        quoted?: { messageId: string; content: string; role: 'user' | 'assistant' };
        attachments?: Message['attachments'];
      } = {
        text: trimmed,
        quoted: quotedReply,
      };
      if (pendingAttachments.length > 0) {
        payload.attachments = pendingAttachments;
      }
      onSendMessage(payload);
      setInput('');
      setSlashInput('');
      setQuotedMessage(null);
      setQuotedReply(undefined);
      setPendingAttachments([]);
      resetSlash();
      setTextareaHeight('auto');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (slashActive) {
        handleSlashKeyDown(e);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    };

    // textarea 自动伸缩：高度跟随内容，上限 6 行（测量用 e.target，最终由 state 控制）
    const handleAutoResize = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const el = e.target;
      el.style.height = 'auto';
      const next = Math.min(el.scrollHeight, 132) + 'px';
      // 高度没变时返回原值，React 会跳过这次重渲染。
      // 否则每敲一个字符都会额外触发一轮整个 ChatWindow 的渲染。
      setTextareaHeight((prev) => (prev === next ? prev : next));
    }, []);

    const handleQuote = (message: Message) => {
      setQuotedMessage(message);
      setQuotedReply({
        messageId: message.id,
        content: message.content,
        role: message.role as 'user' | 'assistant',
      });
      textareaRef.current?.focus();
    };

    const cancelQuote = () => {
      setQuotedMessage(null);
      setQuotedReply(undefined);
    };

    const canSend = !isLoading && (slashInput || input).trim().length > 0;

    const messageAppearance = {
      bubbleRadius: appearance.bubbleRadius,
      bubbleTail: appearance.bubbleTail,
      showAvatar: appearance.showAvatar,
      userAvatar: appearance.userAvatar,
      aiAvatar: appearance.aiAvatar,
    };

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          background: 'var(--chat-bg)',
          fontSize: `${appearance.fontSize}px`,
          color: 'var(--text-primary)',
        }}
      >
        {/* AI 响应状态条（聊天窗口顶部） */}
        {aiPhase !== 'idle' && (
          <div
            className={`ai-status-bar${aiPhase === 'tool' ? ' ai-status-bar--tool' : ''}`}
            role="status"
            aria-live="polite"
          >
            <span className="ai-status-bar__dot" />
            <span className="ai-status-bar__text">
              {aiPhase === 'tool'
                ? t('chat.ai_status_tool', {
                    name: toolLabel || '…',
                    defaultValue: '正在调用工具…',
                  })
                : aiPhase === 'replying'
                  ? t('chat.ai_status_replying', { defaultValue: '正在回复…' })
                  : t('chat.ai_status_thinking', { defaultValue: '正在思考…' })}
            </span>
          </div>
        )}
        {/* 消息列表 */}
        <div
          style={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* 消息搜索条 */}
          {searchOpen ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-surface)',
                flexShrink: 0,
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
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchHit(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    jumpToSearch(e.shiftKey ? -1 : 1);
                  }
                }}
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
              {searchQuery.trim() && (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>
                  {searchResults.length > 0 ? `${searchHit + 1}/${searchResults.length}` : '0/0'}
                </span>
              )}
              <button
                type="button"
                onClick={() => jumpToSearch(-1)}
                disabled={searchResults.length === 0}
                title={t('chat.search_prev', { defaultValue: '上一条（Shift+Enter）' })}
                style={searchNavBtnStyle}
              >
                <Icon icon="solar:alt-arrow-up-linear" width={14} height={14} />
              </button>
              <button
                type="button"
                onClick={() => jumpToSearch(1)}
                disabled={searchResults.length === 0}
                title={t('chat.search_next', { defaultValue: '下一条（Enter）' })}
                style={searchNavBtnStyle}
              >
                <Icon icon="solar:alt-arrow-down-linear" width={14} height={14} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchOpen(false);
                  setSearchQuery('');
                  setSearchHit(0);
                  setHighlightedId(null);
                }}
                title={t('chat.search_close', { defaultValue: '关闭搜索' })}
                style={searchNavBtnStyle}
              >
                <Icon icon="solar:close-circle-linear" width={14} height={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              title={t('chat.search_messages', { defaultValue: '搜索消息' })}
              style={{
                position: 'absolute',
                top: 8,
                right: 10,
                zIndex: 3,
                width: 26,
                height: 26,
                border: 'none',
                borderRadius: '6px',
                background: 'rgba(0,0,0,0.25)',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backdropFilter: 'blur(4px)',
              }}
            >
              <Icon icon="solar:magnifer-linear" width={14} height={14} />
            </button>
          )}
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '12px 0 6px',
              display: 'flex',
              flexDirection: 'column',
              backgroundImage: appearance.backgroundImage
                ? `url(${appearance.backgroundImage})`
                : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundAttachment: 'local',
            }}
          >
            {hiddenCount > 0 && (
              <div style={{ textAlign: 'center', padding: '2px 0 6px' }}>
                <button
                  type="button"
                  onClick={loadEarlier}
                  style={{
                    border: 'none',
                    borderRadius: '12px',
                    padding: '3px 12px',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    background: 'var(--bg-glass)',
                    cursor: 'pointer',
                  }}
                >
                  {t('chat.load_earlier', { defaultValue: '加载更早消息' })}（{hiddenCount}）
                </button>
              </div>
            )}
            {messages.length === 0 && (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  padding: '12px 16px 6px',
                }}
              >
                <div
                  style={{
                    width: '100%',
                    maxWidth: '360px',
                    padding: '20px',
                    borderRadius: '16px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    boxShadow: 'var(--shadow-sm)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: '16px',
                      background: 'var(--accent-soft)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--accent)',
                    }}
                  >
                    <Icon icon="solar:stars-minimalistic-bold-duotone" width={28} height={28} />
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: '1.15em',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                      }}
                    >
                      {t('chat.welcome_title', { defaultValue: '有什么可以帮你的？' })}
                    </div>
                    <div
                      style={{
                        marginTop: '4px',
                        fontSize: '0.9em',
                        color: 'var(--text-secondary)',
                        lineHeight: 1.5,
                      }}
                    >
                      {t('chat.welcome_subtitle', {
                        defaultValue: '随时聊天、查资料、写代码、管理文件——我都在。',
                      })}
                    </div>
                  </div>

                  {!llmConfigured ? (
                    <div
                      style={{
                        width: '100%',
                        marginTop: '4px',
                        padding: '12px 16px',
                        borderRadius: '12px',
                        background: 'var(--warning-bg)',
                        border: '1px solid var(--warning-border)',
                        color: 'var(--warning-text)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '10px',
                      }}
                    >
                      <div style={{ fontSize: '0.9em', lineHeight: 1.5 }}>
                        {t('chat.llm_not_configured')}
                      </div>
                      <button
                        type="button"
                        onClick={() => void openSettingsAt('/settings/services/llm')}
                        style={{
                          border: 'none',
                          borderRadius: '8px',
                          padding: '6px 14px',
                          fontSize: '0.9em',
                          fontWeight: 600,
                          cursor: 'pointer',
                          color: '#fff',
                          background: 'var(--accent)',
                        }}
                      >
                        {t('chat.go_configure')}
                      </button>
                    </div>
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        marginTop: '2px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      <div style={{ fontSize: '0.8em', color: 'var(--text-muted)' }}>
                        {t('chat.welcome_hint', { defaultValue: '试试这样问我' })}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          justifyContent: 'center',
                          gap: '8px',
                        }}
                      >
                        {[
                          t('chat.welcome_suggestion_1', { defaultValue: '今天天气怎么样' }),
                          t('chat.welcome_suggestion_2', { defaultValue: '帮我写一段 Python' }),
                          t('chat.welcome_suggestion_3', {
                            defaultValue: '总结一下桌面上的文档',
                          }),
                        ].map((text) => (
                          <button
                            key={text}
                            type="button"
                            onClick={() => onSendMessage(text)}
                            style={{
                              padding: '6px 12px',
                              borderRadius: '999px',
                              border: '1px solid var(--border)',
                              background: 'var(--bg-glass)',
                              color: 'var(--text-secondary)',
                              fontSize: '0.85em',
                              cursor: 'pointer',
                              transition: 'background 0.15s, border-color 0.15s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'var(--bg-hover)';
                              e.currentTarget.style.borderColor = 'var(--accent)';
                              e.currentTarget.style.color = 'var(--accent)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'var(--bg-glass)';
                              e.currentTarget.style.borderColor = 'var(--border)';
                              e.currentTarget.style.color = 'var(--text-secondary)';
                            }}
                          >
                            {text}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {displayedMessages.map((message, idx) => {
              const prev = idx > 0 ? displayedMessages[idx - 1] : null;
              // 日期分隔（跨天）
              const showDateSep = !prev || !isSameDay(prev.timestamp, message.timestamp);
              // 时间分隔（QQ 风格：间隔 >= 5 分钟或角色切换时）
              const showTimeSep = !showDateSep && needsTimeSeparator(prev, message);
              return (
                <Fragment key={message.id}>
                  {/* 日期分隔标签 */}
                  {showDateSep && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'center',
                        margin: '8px 0 4px',
                        pointerEvents: 'none',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          background: 'var(--bg-glass, rgba(0,0,0,0.04))',
                          padding: '2px 10px',
                          borderRadius: '10px',
                          letterSpacing: '0.5px',
                        }}
                      >
                        {formatDateLabel(message.timestamp)}
                      </span>
                    </div>
                  )}
                  {/* 时间分隔标签（QQ 风格） */}
                  {showTimeSep && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'center',
                        margin: '6px 0 4px',
                        pointerEvents: 'none',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '10px',
                          color: 'var(--text-muted)',
                          background: 'transparent',
                          padding: '1px 8px',
                          borderRadius: '6px',
                        }}
                      >
                        {formatTimeLabel(
                          message.timestamp instanceof Date
                            ? message.timestamp
                            : new Date(message.timestamp),
                        )}
                      </span>
                    </div>
                  )}
                  <MessageItem
                    message={{
                      ...message,
                      role: message.role as 'user' | 'assistant' | 'system',
                      isStreaming: isStreaming && message === messages[messages.length - 1],
                    }}
                    onRetry={() => onSendMessage(message.content)}
                    onQuote={handleQuote}
                    sessionId={sessionId}
                    appearance={messageAppearance}
                    highlighted={message.id === highlightedId}
                  />
                </Fragment>
              );
            })}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 输入区（底栏：和顶部标题栏一样横向拓展满窗口） */}
        <form
          onSubmit={handleSubmit}
          style={{
            margin: 0,
            padding: '8px 12px',
            background: 'var(--bg-surface)',
            borderTop: '1px solid var(--border)',
            borderRadius: 0,
            boxShadow: 'none',
            flexShrink: 0,
          }}
        >
          {/* Slash 命令结果反馈横幅 */}
          {notice && (
            <div
              style={{
                marginBottom: '8px',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background:
                  notice.kind === 'success'
                    ? 'rgba(34,197,94,0.15)'
                    : notice.kind === 'error'
                      ? 'rgba(239,68,68,0.15)'
                      : 'var(--accent-soft)',
                color:
                  notice.kind === 'success'
                    ? '#16a34a'
                    : notice.kind === 'error'
                      ? '#dc2626'
                      : 'var(--accent)',
                border: '1px solid',
                borderColor:
                  notice.kind === 'success'
                    ? '#16a34a'
                    : notice.kind === 'error'
                      ? '#dc2626'
                      : 'var(--accent)',
              }}
            >
              <Icon
                icon={
                  notice.kind === 'success'
                    ? 'solar:check-circle-linear'
                    : notice.kind === 'error'
                      ? 'solar:close-circle-linear'
                      : 'solar:info-circle-linear'
                }
                width={14}
                height={14}
              />
              <span style={{ flex: 1, minWidth: 0 }}>{notice.text}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: '13px',
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
          )}

          {/* 引用预览 */}
          {quotedMessage && (
            <div
              style={{
                marginBottom: '8px',
                padding: '6px 10px',
                borderRadius: '8px',
                background: 'var(--accent-soft)',
                borderLeft: '2px solid var(--accent)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.75em', color: 'var(--text-muted)' }}>
                  {quotedMessage.role === 'user' ? t('chat.quote_you') : t('chat.quote_ai')}
                </div>
                <div
                  style={{
                    fontSize: '0.85em',
                    color: 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {quotedMessage.content}
                </div>
              </div>
              <button
                type="button"
                onClick={cancelQuote}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: '15px',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          )}

          {/* 附件预览 */}
          {pendingAttachments.length > 0 && (
            <div
              style={{
                marginBottom: '8px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              {pendingAttachments.map((file, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 8px',
                    borderRadius: '8px',
                    background: 'var(--bg-glass)',
                    border: '1px solid var(--border)',
                    fontSize: '0.8em',
                    color: 'var(--text-secondary)',
                    maxWidth: '180px',
                  }}
                >
                  {file.type === 'image' && file.url ? (
                    <img
                      src={file.url}
                      alt={file.name || 'image'}
                      style={{ width: 26, height: 26, borderRadius: 4, objectFit: 'cover' }}
                    />
                  ) : (
                    <Icon icon="solar:file-text-linear" width={16} height={16} />
                  )}
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}
                  >
                    {file.name || 'file'}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))
                    }
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: '13px',
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 语音通话条（QQ 式语音通话状态） */}
          {callState && callState !== 'idle' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                background: 'var(--bg-secondary, #f3f4f6)',
                borderTop: '1px solid var(--border, #e5e7eb)',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    callState === 'speaking'
                      ? '#2f9e44'
                      : callState === 'listening'
                        ? '#1971c2'
                        : callState === 'error'
                          ? '#e03131'
                          : '#f08c00',
                }}
              />
              <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                {callState === 'connecting'
                  ? t('chat.voice_connecting', { defaultValue: '连接中…' })
                  : callState === 'incall'
                    ? t('chat.voice_incall', { defaultValue: '通话中' })
                    : callState === 'listening'
                      ? t('chat.voice_listening', { defaultValue: '聆听中…' })
                      : callState === 'speaking'
                        ? t('chat.voice_speaking', { defaultValue: '说话中…' })
                        : t('chat.voice_error', { defaultValue: '语音出错了' })}
              </span>
              <span
                style={{
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {`${Math.floor(callSeconds / 60)
                  .toString()
                  .padStart(2, '0')}:${(callSeconds % 60).toString().padStart(2, '0')}`}
              </span>
              <button
                type="button"
                onClick={onToggleCall}
                style={{
                  marginLeft: 'auto',
                  border: 'none',
                  borderRadius: 6,
                  padding: '4px 12px',
                  background: 'var(--color-danger, #e03131)',
                  color: '#fff',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {t('chat.voice_hangup', { defaultValue: '挂断' })}
              </button>
            </div>
          )}

          {/* 工具条 + 输入框 + 发送按钮（单行 QQ 风格） */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
            {/* 左侧工具按钮组 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1px',
                flexShrink: 0,
                paddingBottom: '1px',
              }}
            >
              <ToolButton
                icon="solar:paperclip-linear"
                title={t('chat.attachment', { defaultValue: '附件' })}
                onClick={() => fileInputRef.current?.click()}
              />
              <ToolButton
                icon={callState && callState !== 'idle' ? 'solar:phone-bold' : 'solar:phone-linear'}
                title={t('chat.voice_call', { defaultValue: '语音通话' })}
                active={
                  callState === 'incall' || callState === 'listening' || callState === 'speaking'
                }
                onClick={() => onToggleCall?.()}
              />
              {sttAvailable && (
                <ToolButton
                  icon={isRecording ? 'solar:microphone-bold' : 'solar:microphone-linear'}
                  title={isRecording ? t('chat.click_to_stop') : t('chat.click_to_speak')}
                  danger={isRecording}
                  onClick={() => {
                    if (isRecording) onRecordStop?.();
                    else onRecordStart?.();
                  }}
                />
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.doc,.docx,.txt,.zip,.rar,.7z"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length) appendFiles(files);
                e.target.value = '';
              }}
            />

            <textarea
              ref={textareaRef}
              value={slashInput || input}
              onChange={(e) => {
                setInput(e.target.value);
                setSlashInput(e.target.value);
                handleAutoResize(e);
              }}
              onKeyDown={handleKeyDown}
              onPaste={(e) => {
                const dt = e.clipboardData;
                if (!dt) return;
                let files: File[] = [];
                if (dt.files && dt.files.length) {
                  files = Array.from(dt.files);
                } else if (dt.items && dt.items.length) {
                  files = Array.from(dt.items)
                    .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
                    .map((it) => it.getAsFile())
                    .filter((f): f is File => !!f);
                }
                if (files.length) {
                  e.preventDefault();
                  appendFiles(files);
                }
              }}
              placeholder={t('chat.placeholder')}
              disabled={isLoading}
              rows={1}
              className="chat-input"
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '10px',
                border: '1px solid var(--border)',
                background: 'var(--bg-glass)',
                color: 'var(--text-primary)',
                outline: 'none',
                fontSize: '1em',
                lineHeight: 1.45,
                resize: 'none',
                height: textareaHeight,
                minHeight: '34px',
                maxHeight: '120px',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                overflow: 'auto',
              }}
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={onCancelStream}
                title={t('chat.stop') || '停止'}
                style={{
                  height: 34,
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'var(--color-danger)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.85em',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <Icon icon="solar:stop-bold" width={14} height={14} />
                {t('chat.stop', { defaultValue: '停止' })}
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                style={{
                  height: 34,
                  padding: '0 14px',
                  borderRadius: '8px',
                  border: 'none',
                  background: canSend ? 'var(--accent)' : 'var(--bg-hover)',
                  color: canSend ? '#fff' : 'var(--text-muted)',
                  cursor: canSend ? 'pointer' : 'not-allowed',
                  fontSize: '0.85em',
                  fontWeight: 500,
                  transition: 'background 0.15s, color 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <Icon icon="solar:plain-linear" width={14} height={14} />
                {t('chat.send')}
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }),
);
