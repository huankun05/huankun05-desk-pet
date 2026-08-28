/**
 * ChatDetailsPanel — 对话面板右侧详情面板
 *
 * 从 ChatPanelWindow.tsx 拆分（2026-08-28）：
 * - 详情面板状态（tab / 搜索筛选 / 收藏 / 宽度拖拽）全部内聚于此
 * - 父组件只传核心数据与跳转回调
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { type Message } from './ChatWindow';
import { loadFavorites, toggleFavorite, isFavorite } from './favorites';
import { showToast } from '../../utils/toast';

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

export interface ChatDetailsPanelProps {
  messages: Message[];
  gatewayReady: boolean;
  isStreaming: boolean;
  activeSessionId: string | null;
  contextUsed: number;
  contextTotal: number;
  contextRatio: number;
  /** 跳转到某条消息（由父组件经 ChatWindow ref 实现） */
  onJumpToMessage: (messageId: string) => void;
}

export function ChatDetailsPanel({
  messages,
  gatewayReady,
  isStreaming,
  activeSessionId,
  contextUsed,
  contextTotal,
  contextRatio,
  onJumpToMessage,
}: ChatDetailsPanelProps) {
  const { t } = useTranslation();

  // 详情面板状态
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

  // 详情面板拖拽调整宽度
  const [dragging, setDragging] = useState(false);
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

  return (
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
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginRight: '2px' }}>
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
                      onClick={() => onJumpToMessage(r.id)}
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
                            color: r.role === 'user' ? 'var(--accent)' : 'var(--text-secondary)',
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
                        color: item.role === 'user' ? 'var(--accent)' : 'var(--text-secondary)',
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
                    onClick={() => onJumpToMessage(item.messageId)}
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
                          showToast(t('chat.copied', { defaultValue: '已复制' }), 'success');
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
  );
}

export default ChatDetailsPanel;
