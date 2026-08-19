import type { ChatMessage } from './MessageItem';

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
