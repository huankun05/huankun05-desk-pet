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
import { openSettingsAt } from '../../utils/openSettings';
import { useSlashCommands } from '../../hooks/useSlashCommands';
import { useChatAppearance } from './useChatAppearance';
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
  /** 当前会话 ID（用于收藏等） */
  sessionId?: string;
  /** TTS 开关状态（输入区快捷开关） */
  ttsEnabled?: boolean;
  onToggleTts?: () => void;
  onClose?: () => void;
  /** Gateway 连接状态（供 /status 命令反馈） */
  gatewayReady?: boolean;
  /** 当前模型名（供 /status、/model 命令反馈） */
  currentModel?: string;
  /** 已用上下文 token 数（供 /status、/usage 命令反馈） */
  contextUsed?: number;
  /** 上下文 token 上限（供 /status、/usage 命令反馈） */
  contextTotal?: number;
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
      sessionId,
      ttsEnabled = true,
      onToggleTts,
      gatewayReady = false,
      currentModel,
      contextUsed = 0,
      contextTotal = 0,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const appearance = useChatAppearance();
    const [input, setInput] = useState('');
    // textarea 高度由 state 驱动，避免直接改写 ref.current.style（触发 react-hooks/immutability）
    const [textareaHeight, setTextareaHeight] = useState<string>('auto');

    // 命令式句柄：允许父组件（如面板窗的 STT 结果）回填草稿文本到输入框
    useImperativeHandle(
      ref,
      () => ({
        setDraft: (text: string) => {
          setInput(text);
          requestAnimationFrame(() => textareaRef.current?.focus());
        },
      }),
      [setInput],
    );
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

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
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

    // 自动滚动到底部（流式输出时持续滚动）
    useEffect(() => {
      const container = messagesContainerRef.current;
      if (!container) return;
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      if (isNearBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }, [messages]);

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

      const slashHandled = handleSlashSubmit(trimmed);
      if (slashHandled) {
        setInput('');
        setSlashInput('');
        resetSlash();
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
      setTextareaHeight(Math.min(el.scrollHeight, 132) + 'px');
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
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  marginTop: '48px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '0 16px',
                }}
              >
                <Icon icon="solar:chat-round-dots-linear" width={44} height={44} />
                <div style={{ color: 'var(--text-secondary)' }}>{t('chat.welcome_hi')}</div>
                <div style={{ fontSize: '0.9em' }}>{t('chat.welcome_start')}</div>

                {!llmConfigured && (
                  <div
                    style={{
                      marginTop: '4px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '12px 16px',
                      borderRadius: '12px',
                      background: 'var(--warning-bg)',
                      border: '1px solid var(--warning-border)',
                      color: 'var(--warning-text)',
                      maxWidth: '260px',
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
                )}
              </div>
            )}

            {displayedMessages.map((message, idx) => {
              const prev = idx > 0 ? displayedMessages[idx - 1] : null;
              const showSep = !prev || !isSameDay(prev.timestamp, message.timestamp);
              return (
                <Fragment key={message.id}>
                  {showSep && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'center',
                        margin: '10px 0 4px',
                        pointerEvents: 'none',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          background: 'var(--bg-glass)',
                          padding: '2px 10px',
                          borderRadius: '10px',
                        }}
                      >
                        {formatDateLabel(message.timestamp)}
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

            {isLoading && !isStreaming && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--text-muted)',
                  padding: '4px 16px',
                }}
              >
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <span style={{ fontSize: '0.85em' }}>{t('chat.thinking')}</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 输入区 */}
        <form
          onSubmit={handleSubmit}
          style={{
            padding: '8px 12px 10px',
            background: 'var(--bg-surface)',
            borderTop: '1px solid var(--border)',
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

          {/* 工具条：附件 / 语音 / TTS */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginBottom: '4px' }}>
            <ToolButton
              icon="solar:paperclip-linear"
              title={t('chat.attachment', { defaultValue: '附件' })}
              onClick={() => fileInputRef.current?.click()}
            />
            {sttAvailable && (
              <ToolButton
                icon={isRecording ? 'solar:microphone-bold' : 'solar:microphone-linear'}
                title={isRecording ? t('chat.release_to_stop') : t('chat.hold_to_speak')}
                danger={isRecording}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (!isRecording) onRecordStart?.();
                }}
                onMouseUp={() => {
                  if (isRecording) onRecordStop?.();
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  if (!isRecording) onRecordStart?.();
                }}
                onTouchEnd={() => {
                  if (isRecording) onRecordStop?.();
                }}
              />
            )}
            {onToggleTts && (
              <ToolButton
                icon={ttsEnabled ? 'solar:volume-loud-linear' : 'solar:volume-cross-linear'}
                title={ttsEnabled ? 'TTS 已开启' : 'TTS 已关闭'}
                active={ttsEnabled}
                onClick={onToggleTts}
              />
            )}
            <div style={{ flex: 1 }} />
            {isRecording && (
              <span style={{ fontSize: '0.75em', color: 'var(--color-danger)' }}>
                {t('chat.release_to_stop')}
              </span>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.txt,.zip,.rar,.7z"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              const newAttachments: Message['attachments'] = [];
              const newBlobUrls: string[] = [];
              files.forEach((file) => {
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
              // 清理即将被替换的旧 blob URL
              setPendingAttachments((prev) => {
                prev.forEach((a) => {
                  if (a.url && a.url.startsWith('blob:')) URL.revokeObjectURL(a.url);
                });
                return [...prev, ...newAttachments];
              });
              // 记录本次创建的 blob URL（供组件卸载时统一清理）
              blobUrlsRef.current.push(...newBlobUrls);
              e.target.value = '';
            }}
          />

          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <textarea
              ref={textareaRef}
              value={slashInput || input}
              onChange={(e) => {
                setInput(e.target.value);
                setSlashInput(e.target.value);
                handleAutoResize(e);
              }}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.placeholder')}
              disabled={isLoading}
              rows={1}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '10px',
                border: '1px solid var(--border)',
                background: 'var(--bg-glass)',
                color: 'var(--text-primary)',
                outline: 'none',
                fontSize: '1em',
                lineHeight: 1.5,
                resize: 'none',
                height: textareaHeight,
                minHeight: '36px',
                maxHeight: '132px',
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
                  height: 36,
                  padding: '0 14px',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'var(--color-danger)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.9em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Icon icon="solar:stop-bold" width={15} height={15} />
                {t('chat.stop', { defaultValue: '停止' })}
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                style={{
                  height: 36,
                  padding: '0 16px',
                  borderRadius: '10px',
                  border: 'none',
                  background: canSend ? 'var(--accent)' : 'var(--bg-hover)',
                  color: canSend ? '#fff' : 'var(--text-muted)',
                  cursor: canSend ? 'pointer' : 'not-allowed',
                  fontSize: '0.9em',
                  fontWeight: 500,
                  transition: 'background 0.15s, color 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Icon icon="solar:plain-linear" width={15} height={15} />
                {t('chat.send')}
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }),
);
