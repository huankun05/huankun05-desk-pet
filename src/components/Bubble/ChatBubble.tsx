import { useEffect, useState, memo } from 'react';

export interface BubbleMessage {
  id: number;
  text: string;
  duration?: number; // ms，默认 4000
}

interface ChatBubbleProps {
  message: BubbleMessage | null;
  onComplete: (id: number) => void;
  style?: React.CSSProperties;
}

/**
 * 角色头顶气泡组件
 * 显示消息后自动淡出
 */
export const ChatBubble = memo(function ChatBubble({
  message,
  onComplete,
  style,
}: ChatBubbleProps) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<BubbleMessage | null>(null);

  useEffect(() => {
    if (!message) {
      setVisible(false);
      return;
    }

    setCurrent(message);
    setVisible(true);

    const duration = message.duration || 4000;
    const fadeTimer = setTimeout(() => {
      setVisible(false);
    }, duration - 500); // 提前 500ms 开始淡出

    const removeTimer = setTimeout(() => {
      onComplete(message.id);
    }, duration);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id]);

  if (!current) return null;

  return (
    <div
      className={`chat-bubble ${visible ? 'chat-bubble-visible' : ''}`}
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="chat-bubble-content">{current.text}</div>
      <div className="chat-bubble-arrow" />
    </div>
  );
});
