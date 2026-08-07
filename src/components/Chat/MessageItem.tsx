import { useState, useRef } from 'react';
import { Icon } from '@iconify/react';
import { parseThinkTags } from '../../utils/thinkTagParser';
import MarkdownContent from './MarkdownContent';
import { ChatAvatar } from './ChatAvatar';
import { ToolCallBlock } from './ToolCallBlock';
import { showToast } from '../../utils/toast';

export interface ToolCallEntry {
  name: string;
  input: unknown;
  output: unknown;
  status?: 'running' | 'success' | 'error';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolCalls?: ToolCallEntry[];
  attachments?: Array<{
    type: 'image' | 'file';
    url: string;
    name?: string;
    size?: number;
    mimeType?: string;
  }>;
  quoted?: {
    messageId: string;
    content: string;
    role: 'user' | 'assistant';
  };
  favorite?: boolean;
}

/** 消息项需要的外观参数（由 ChatWindow 统一下发，避免每条消息各自订阅配置） */
export interface MessageAppearance {
  bubbleRadius: number;
  bubbleTail: boolean;
  showAvatar: boolean;
  userAvatar: string;
  aiAvatar: string;
}

const DEFAULT_APPEARANCE: MessageAppearance = {
  bubbleRadius: 12,
  bubbleTail: true,
  showAvatar: true,
  userAvatar: '',
  aiAvatar: '',
};

const iconBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  border: 'none',
  borderRadius: '6px',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s, color 0.15s',
};

// 收藏存储 key
const FAVORITES_KEY = 'deskpet_favorites';

// 收藏管理
export function loadFavorites(): Array<{
  messageId: string;
  sessionId: string;
  content: string;
  timestamp: string;
  role: 'user' | 'assistant';
}> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

export function saveFavorites(
  favorites: Array<{
    messageId: string;
    sessionId: string;
    content: string;
    timestamp: string;
    role: 'user' | 'assistant';
  }>,
): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch {
    // ignore
  }
}

export function toggleFavorite(message: ChatMessage, sessionId: string): boolean {
  const favorites = loadFavorites();
  const idx = favorites.findIndex((f) => f.messageId === message.id && f.sessionId === sessionId);
  if (idx >= 0) {
    favorites.splice(idx, 1);
    saveFavorites(favorites);
    return false;
  } else {
    favorites.push({
      messageId: message.id,
      sessionId,
      content: message.content,
      timestamp:
        message.timestamp instanceof Date
          ? message.timestamp.toISOString()
          : String(message.timestamp),
      role: message.role as 'user' | 'assistant',
    });
    saveFavorites(favorites);
    return true;
  }
}

export function isFavorite(messageId: string, sessionId: string): boolean {
  const favorites = loadFavorites();
  return favorites.some((f) => f.messageId === messageId && f.sessionId === sessionId);
}

interface MessageItemProps {
  message: ChatMessage;
  onRetry?: () => void;
  onDelete?: () => void;
  onQuote?: (message: ChatMessage) => void;
  sessionId?: string;
  appearance?: MessageAppearance;
  /** 消息搜索命中高亮 */
  highlighted?: boolean;
}

/** 渲染消息内容：流式中用纯文本（避免每 token 重解析 markdown 卡顿），完成后渲染 Markdown */
function MessageContent({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  if (!content) return <span className="typing-cursor">▎</span>;
  if (isStreaming) {
    const segments = parseThinkTags(content);
    return (
      <>
        {segments.map((seg, i) =>
          seg.type === 'think' ? (
            <em key={i} style={{ opacity: 0.6, fontStyle: 'italic', fontSize: '0.9em' }}>
              （{seg.content}）
            </em>
          ) : (
            <span key={i}>{seg.content}</span>
          ),
        )}
      </>
    );
  }
  return <MarkdownContent content={content} />;
}

/** 附件渲染 */
function Attachments({ attachments }: { attachments: ChatMessage['attachments'] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
      {attachments.map((att, i) => (
        <div
          key={i}
          style={{
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid var(--glass-border)',
            background: 'var(--bg-glass)',
            maxWidth: '240px',
          }}
        >
          {att.type === 'image' ? (
            <img
              src={att.url}
              alt={att.name || 'image'}
              style={{
                width: '100%',
                maxHeight: '180px',
                objectFit: 'cover',
                display: 'block',
                cursor: 'pointer',
              }}
              onClick={() => {
                const overlay = document.createElement('div');
                overlay.style.cssText =
                  'position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:pointer;';
                const img = document.createElement('img');
                img.src = att.url;
                img.style.cssText =
                  'max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;';
                overlay.appendChild(img);
                overlay.onclick = () => document.body.removeChild(overlay);
                document.body.appendChild(overlay);
              }}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 12px',
                cursor: 'pointer',
              }}
              onClick={() => {
                const a = document.createElement('a');
                a.href = att.url;
                a.download = att.name || 'file';
                a.click();
              }}
            >
              <Icon
                icon="solar:file-text-bold"
                width={20}
                height={20}
                style={{ color: 'var(--text-secondary)' }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '13px',
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {att.name || 'file'}
                </div>
                {att.size && (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {(att.size / 1024).toFixed(1)} KB
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatTime(ts: Date): string {
  try {
    return ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * 单条消息：QQ 风格。
 * 用户消息靠右（主色气泡 + 右侧头像），AI 消息靠左（白色气泡 + 左侧头像）。
 * hover 时在气泡上方浮出操作栏，绝对定位，不撑开布局。
 */
export function MessageItem({
  message,
  onRetry,
  onDelete,
  onQuote,
  sessionId,
  appearance = DEFAULT_APPEARANCE,
  highlighted = false,
}: MessageItemProps) {
  const isUser = message.role === 'user';
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const isTouchRef = useRef(false);
  const [fav, setFav] = useState(() => (sessionId ? isFavorite(message.id, sessionId) : false));

  const ts =
    typeof message.timestamp === 'string' || typeof message.timestamp === 'number'
      ? new Date(message.timestamp)
      : message.timestamp;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      showToast('已复制', 'success');
    } catch {
      showToast('复制失败', 'error');
    }
  };

  const handleFavorite = () => {
    if (!sessionId) return;
    setFav(toggleFavorite(message, sessionId));
  };

  const radius = appearance.bubbleRadius;
  const tailClass = appearance.bubbleTail ? '' : ' chat-bubble--flat';
  // 操作栏水平锚点：让开头像占的宽度
  const actionInset = appearance.showAvatar ? 54 : 14;

  const hoverBtn = (extra?: React.CSSProperties): React.CSSProperties => ({
    ...iconBtnStyle,
    ...extra,
  });

  return (
    <div
      data-msg-id={message.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onTouchStart={() => {
        isTouchRef.current = true;
      }}
      onClick={() => {
        // 触屏设备无 hover：点按消息切换操作栏显隐
        if (isTouchRef.current) setPinned((p) => !p);
      }}
      style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '6px 14px',
        position: 'relative',
        animation: 'message-enter 250ms cubic-bezier(0.32, 0.72, 0, 1)',
        ...(highlighted
          ? {
              background: 'rgba(245,166,35,0.16)',
              borderRadius: '10px',
              outline: '1px solid rgba(245,166,35,0.5)',
            }
          : {}),
      }}
    >
      {appearance.showAvatar && (
        <ChatAvatar
          role={isUser ? 'user' : 'assistant'}
          src={isUser ? appearance.userAvatar : appearance.aiAvatar}
        />
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: isUser ? 'flex-end' : 'flex-start',
          maxWidth: '78%',
          minWidth: 0,
        }}
      >
        {/* 引用预览：QQ 里引用挂在气泡上方 */}
        {message.quoted && (
          <div
            style={{
              marginBottom: '4px',
              padding: '5px 9px',
              borderRadius: '8px',
              background: 'var(--bg-hover)',
              borderLeft: '2px solid var(--accent)',
              fontSize: '11px',
              color: 'var(--text-muted)',
              maxWidth: '100%',
            }}
          >
            <span style={{ opacity: 0.8 }}>{message.quoted.role === 'user' ? '你' : 'AI'}：</span>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {message.quoted.content}
            </span>
          </div>
        )}

        <div
          className={`chat-bubble ${isUser ? 'chat-bubble--user' : 'chat-bubble--ai'}${tailClass}`}
          style={{
            padding: '8px 12px',
            borderRadius: `${radius}px`,
            background: isUser ? 'var(--bubble-user-bg)' : 'var(--bubble-ai-bg)',
            color: isUser ? 'var(--bubble-user-text)' : 'var(--bubble-ai-text)',
            border: isUser ? '1px solid transparent' : '1px solid var(--glass-border)',
            boxShadow: 'var(--shadow-sm)',
            lineHeight: 1.55,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
          }}
        >
          <MessageContent content={message.content} isStreaming={message.isStreaming} />
          {message.isStreaming && (
            <span style={{ opacity: 0.5, animation: 'blink 1s infinite' }}>▋</span>
          )}
          <Attachments attachments={message.attachments} />
        </div>

        {/* 工具调用：内联到所属消息，可折叠 */}
        {message.toolCalls?.map((call, i) => (
          <ToolCallBlock
            key={`tc-${message.id}-${i}`}
            name={call.name}
            input={call.input}
            output={call.output}
            status={call.status ?? 'success'}
          />
        ))}

        {/* 时间：固定高度占位，hover/触屏钉选才显示，避免抖动 */}
        <div
          style={{
            height: '14px',
            marginTop: '2px',
            padding: '0 2px',
            fontSize: '10px',
            lineHeight: '14px',
            color: 'var(--text-muted)',
            opacity: hovered || pinned ? 1 : 0,
            transition: 'opacity 0.15s',
          }}
        >
          {formatTime(ts)}
        </div>
      </div>

      {/* 操作栏：绝对定位浮在气泡上方；鼠标 hover 或触屏点按钉选时显示 */}
      {(hovered || pinned) && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '-2px',
            ...(isUser ? { right: `${actionInset}px` } : { left: `${actionInset}px` }),
            display: 'flex',
            alignItems: 'center',
            gap: '1px',
            padding: '2px',
            borderRadius: '8px',
            background: 'var(--toolbar-bg)',
            border: '1px solid var(--toolbar-border)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 5,
          }}
        >
          {onQuote && (
            <button
              onClick={() => onQuote(message)}
              title="引用"
              style={hoverBtn()}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Icon icon="solar:chat-square-quote-linear" width={15} height={15} />
            </button>
          )}
          <button
            onClick={handleCopy}
            title="复制"
            style={hoverBtn()}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Icon icon="solar:copy-linear" width={15} height={15} />
          </button>
          <button
            onClick={handleFavorite}
            title={fav ? '取消收藏' : '收藏'}
            style={hoverBtn(fav ? { color: '#f5a623' } : undefined)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Icon icon={fav ? 'solar:star-bold' : 'solar:star-linear'} width={15} height={15} />
          </button>
          {pinned && (
            <button
              onClick={() => setPinned(false)}
              title="收起"
              style={hoverBtn()}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Icon icon="solar:close-circle-linear" width={15} height={15} />
            </button>
          )}
          {isUser && onRetry && (
            <button
              onClick={onRetry}
              title="重试"
              style={hoverBtn()}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Icon icon="solar:refresh-linear" width={15} height={15} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              title="删除"
              style={hoverBtn()}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239,68,68,0.14)';
                e.currentTarget.style.color = 'var(--color-danger)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <Icon icon="solar:trash-bin-trash-linear" width={15} height={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
