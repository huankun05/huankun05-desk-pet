import {
  useState,
  useRef,
  useEffect,
  memo,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { MessageItem } from './MessageItem';
import { ToolCallBlock } from './ToolCallBlock';
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
}

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

    const {
      input: slashInput,
      setInput: setSlashInput,
      slashActive,
      handleKeyDown: handleSlashKeyDown,
      handleSubmit: handleSlashSubmit,
      reset: resetSlash,
    } = useSlashCommands({
      onNewChat: () => onNewChat?.(),
      onRetry: () => {},
      onStop: () => onCancelStream?.(),
      onModelChange: () => {},
      onStatus: () => {},
      onUsage: () => {},
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
          ref={messagesContainerRef}
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

          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={{
                ...message,
                role: message.role as 'user' | 'assistant' | 'system',
                isStreaming: isStreaming && message === messages[messages.length - 1],
              }}
              onRetry={() => onSendMessage(message.content)}
              onQuote={handleQuote}
              sessionId={sessionId}
              appearance={messageAppearance}
            />
          ))}

          {/* 工具调用展示（最近一条 assistant 消息的工具调用） */}
          {messages.length > 0 &&
            messages[messages.length - 1].toolCalls?.map((call, i) => (
              <ToolCallBlock
                key={`tool-${i}`}
                name={call.name}
                input={call.input}
                output={call.output}
                status={call.status ?? 'success'}
              />
            ))}

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
