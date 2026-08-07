import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { loadFavorites, saveFavorites, toggleFavorite } from './MessageItem';
import { showToast } from '../../utils/toast';

interface FavoritesDrawerProps {
  open: boolean;
  onClose: () => void;
  /** 限定只显示某个会话的收藏；不传则显示全部 */
  sessionId?: string;
}

interface FavItem {
  messageId: string;
  sessionId: string;
  content: string;
  timestamp: string;
  role: 'user' | 'assistant';
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString([], {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/** 收藏查看抽屉：从聊天面板头部星标按钮打开，列出已收藏消息并支持复制/取消/清空 */
export function FavoritesDrawer({ open, onClose, sessionId }: FavoritesDrawerProps) {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);

  const favorites = useMemo<FavItem[]>(() => {
    void tick;
    const all = loadFavorites();
    const list = sessionId ? all.filter((f) => f.sessionId === sessionId) : all;
    return [...list].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId, tick]);

  if (!open) return null;

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('chat.copied', { defaultValue: '已复制' }), 'success');
    } catch {
      showToast('复制失败', 'error');
    }
  };

  const handleUnfavorite = (item: FavItem) => {
    toggleFavorite(
      {
        id: item.messageId,
        role: item.role,
        content: item.content,
        timestamp: new Date(item.timestamp),
      },
      item.sessionId,
    );
    setTick((n) => n + 1);
  };

  const handleClear = () => {
    const ok = window.confirm(t('chat.clear_favorites_confirm'));
    if (!ok) return;
    const all = loadFavorites();
    const remaining = sessionId ? all.filter((f) => f.sessionId !== sessionId) : [];
    saveFavorites(remaining);
    setTick((n) => n + 1);
    showToast(t('chat.cleared'), 'info');
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 50,
        display: 'flex',
        justifyContent: 'flex-end',
        animation: 'fadeIn 150ms ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '320px',
          maxWidth: '86%',
          height: '100%',
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--glass-border)',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 头部 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderBottom: '1px solid var(--glass-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <Icon icon="solar:star-bold" width={16} height={16} style={{ color: '#f5a623' }} />
            {t('chat.favorites_title')}
          </div>
          <button
            onClick={onClose}
            title={t('app.close', { defaultValue: '关闭' })}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              padding: 4,
              borderRadius: 6,
            }}
          >
            <Icon icon="solar:close-circle-linear" width={18} height={18} />
          </button>
        </div>

        {/* 列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
          {favorites.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '13px',
                marginTop: '40px',
              }}
            >
              {t('chat.no_favorites')}
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
                  marginBottom: '10px',
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
                      color: item.role === 'user' ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    {item.role === 'user' ? '你' : 'AI'}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {formatTs(item.timestamp)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: '13px',
                    lineHeight: 1.5,
                    color: 'var(--text-primary)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '180px',
                    overflowY: 'auto',
                  }}
                >
                  {item.content}
                </div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
                  <button
                    onClick={() => handleCopy(item.content)}
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

        {/* 底部：清空 */}
        {favorites.length > 0 && (
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--glass-border)' }}>
            <button
              onClick={handleClear}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid var(--glass-border)',
                borderRadius: '8px',
                background: 'transparent',
                color: 'var(--color-danger)',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              {t('chat.clear_favorites')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

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
