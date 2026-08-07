import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SlashCommand } from '../../hooks/useSlashCommands';

export interface SlashHelpOverlayProps {
  commands: SlashCommand[];
  visible: boolean;
  onClose: () => void;
  onSelect: (command: SlashCommand) => void;
}

export function SlashHelpOverlay({ commands, visible, onClose, onSelect }: SlashHelpOverlayProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? commands.filter(
          (cmd) =>
            cmd.name.toLowerCase().includes(q) ||
            cmd.description.toLowerCase().includes(q) ||
            (cmd.aliases ?? []).some((a) => a.toLowerCase().includes(q)),
        )
      : commands;

    const map = new Map<string, SlashCommand[]>();
    for (const cmd of filtered) {
      const list = map.get(cmd.category) || [];
      list.push(cmd);
      map.set(cmd.category, list);
    }
    return map;
  }, [commands, query]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '420px',
          maxHeight: '60vh',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: '12px 14px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('chat.slash_help_search', '搜索命令...')}
            style={{
              flex: 1,
              padding: '8px 10px',
              borderRadius: '999px',
              border: '1px solid var(--border)',
              background: 'var(--bg-glass)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '18px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 10px' }}>
          {Array.from(grouped.entries()).map(([category, items]) => (
            <div key={category} style={{ marginBottom: '10px' }}>
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '4px',
                }}
              >
                {category}
              </div>
              {items.map((cmd) => (
                <button
                  key={cmd.name}
                  onClick={() => onSelect(cmd)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-md)',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span style={{ width: '22px', textAlign: 'center' }}>{cmd.icon || '•'}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                    /{cmd.name}
                    {cmd.argsHint ? ` ${cmd.argsHint}` : ''}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '12px', flex: 1 }}>
                    {cmd.description}
                  </span>
                </button>
              ))}
            </div>
          ))}
          {grouped.size === 0 && (
            <div style={{ padding: '18px', color: 'var(--text-muted)', fontSize: '13px' }}>
              {t('chat.slash_help_empty', '没有匹配命令')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
