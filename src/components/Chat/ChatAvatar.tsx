import { Icon } from '@iconify/react';

interface ChatAvatarProps {
  role: 'user' | 'assistant' | 'system';
  /** 自定义头像（data URL）。AI 为空时使用桌宠形象，用户为空时使用默认占位 */
  src?: string;
  size?: number;
}

/**
 * 聊天头像。
 *
 * - AI：默认使用桌宠形象（渐变底 + 宠物图标），可在「聊天设置 → 外观」上传替换；
 * - 用户：默认占位人像，可上传替换。
 */
export function ChatAvatar({ role, src, size = 34 }: ChatAvatarProps) {
  const isUser = role === 'user';

  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
  };

  if (src) {
    return (
      <div style={{ ...base, border: '1px solid var(--glass-border)' }}>
        <img
          src={src}
          alt={isUser ? 'user' : 'assistant'}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        ...base,
        background: isUser
          ? 'linear-gradient(135deg, #94a3b8, #64748b)'
          : 'linear-gradient(135deg, #7dd3fc, #12b7f5)',
        color: '#fff',
      }}
      title={isUser ? '我' : '桌宠'}
    >
      <Icon
        icon={isUser ? 'solar:user-bold' : 'solar:cat-bold'}
        width={size * 0.55}
        height={size * 0.55}
      />
    </div>
  );
}

export default ChatAvatar;
