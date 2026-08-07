import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, SettingRow, Modal, useConfirm, useToast } from '../../components';
import {
  deleteSession,
  initChatStorage,
  listSessions,
  renameSession,
  type ChatSession,
} from '../../../services/chatStorage';
import { loadFavorites, saveFavorites } from '../../../components/Chat/MessageItem';

type Favorite = ReturnType<typeof loadFavorites>[number];

function formatDate(ts: number | string): string {
  try {
    const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
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

/**
 * 会话与数据。
 *
 * 聊天记录由 `services/chatStorage`（localStorage + Tauri 文件双备份）持久化，
 * 收藏消息存在 `deskpet_favorites`。这里提供统一的查看 / 重命名 / 删除 / 清空入口。
 */
export function ChatSessionPage() {
  const { t } = useTranslation();
  const { confirm } = useConfirm();
  const { showToast } = useToast();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [loading, setLoading] = useState(true);
  /** 查看会话详情的弹窗状态 */
  const [viewingSession, setViewingSession] = useState<ChatSession | null>(null);
  /** 清空范围选择：'sessions' = 仅删除会话 | 'all' = 同时删除备份 */
  const [clearScope, setClearScope] = useState<'sessions' | 'all'>('sessions');

  const refresh = useCallback(() => {
    setSessions(listSessions());
    setFavorites(loadFavorites());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void initChatStorage().then(() => {
      if (cancelled) return;
      refresh();
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const totalMessages = sessions.reduce((sum, s) => sum + s.messages.length, 0);

  const handleDeleteSession = async (session: ChatSession) => {
    const ok = await confirm({
      title: t('settings.chat.delete_session', { defaultValue: '删除会话' }),
      message: t('settings.chat.delete_session_confirm', {
        defaultValue: '确定删除「{{name}}」吗？该会话的所有消息将一并删除，且无法恢复。',
        name: session.title,
      }),
      danger: true,
    });
    if (!ok) return;
    deleteSession(session.id);
    refresh();
    showToast(t('settings.chat.deleted', { defaultValue: '已删除' }), 'success');
  };

  const handleClearSessions = async () => {
    const isAll = clearScope === 'all';
    const ok = await confirm({
      title: t('settings.chat.clear_all', { defaultValue: '清空全部会话' }),
      message: isAll
        ? t('settings.chat.clear_all_confirm_with_backup', {
            defaultValue: '将删除全部聊天记录**以及所有本地备份文件**，且无法恢复。确定继续吗？',
          })
        : t('settings.chat.clear_all_confirm', {
            defaultValue: '将删除全部聊天记录，且无法恢复。确定继续吗？',
          }),
      danger: true,
    });
    if (!ok) return;
    for (const s of listSessions()) deleteSession(s.id);
    if (isAll) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('delete_backup_files');
      } catch {
        /* 备份删除失败不阻断主流程 */
      }
    }
    refresh();
    showToast(t('settings.chat.cleared', { defaultValue: '已清空' }), 'success');
  };

  const commitRename = (id: string) => {
    const title = renameValue.trim();
    if (title) renameSession(id, title);
    setRenamingId(null);
    refresh();
  };

  const handleRemoveFavorite = (fav: Favorite) => {
    const next = loadFavorites().filter(
      (f) => !(f.messageId === fav.messageId && f.sessionId === fav.sessionId),
    );
    saveFavorites(next);
    setFavorites(next);
  };

  const handleClearFavorites = async () => {
    const ok = await confirm({
      title: t('settings.chat.clear_favorites', { defaultValue: '清空收藏' }),
      message: t('settings.chat.clear_favorites_confirm', {
        defaultValue: '将移除全部收藏的消息（不会删除原始聊天记录）。确定继续吗？',
      }),
      danger: true,
    });
    if (!ok) return;
    saveFavorites([]);
    setFavorites([]);
    showToast(t('settings.chat.cleared', { defaultValue: '已清空' }), 'success');
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 概览 */}
      <Section
        title={t('settings.chat.overview_title', { defaultValue: '数据概览' })}
        description={t('settings.chat.overview_desc', {
          defaultValue: '聊天记录同时保存在本地文件与浏览器存储中',
        })}
      >
        <div className="grid grid-cols-3 divide-x divide-neutral-100">
          {[
            {
              label: t('settings.chat.stat_sessions', { defaultValue: '会话' }),
              value: sessions.length,
            },
            {
              label: t('settings.chat.stat_messages', { defaultValue: '消息' }),
              value: totalMessages,
            },
            {
              label: t('settings.chat.stat_favorites', { defaultValue: '收藏' }),
              value: favorites.length,
            },
          ].map((item) => (
            <div key={item.label} className="px-4 py-4 text-center">
              <div className="text-xl font-semibold tabular-nums text-neutral-800">
                {item.value}
              </div>
              <div className="mt-0.5 text-xs text-neutral-400">{item.label}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* 历史会话 */}
      <Section
        title={t('settings.chat.history_title', { defaultValue: '历史会话' })}
        description={t('settings.chat.history_desc', {
          defaultValue: '最多保留最近 50 个会话，可重命名或删除',
        })}
      >
        {loading ? (
          <div className="px-4 py-6 text-center text-xs text-neutral-400">
            {t('common.loading', { defaultValue: '加载中…' })}
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Icon
              icon="solar:chat-round-line-duotone"
              className="mx-auto mb-2 text-3xl text-neutral-300"
            />
            <p className="text-xs text-neutral-400">
              {t('settings.chat.no_sessions', { defaultValue: '还没有聊天记录' })}
            </p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-xl border border-neutral-200">
            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => setViewingSession(session)}
                className="group flex cursor-pointer items-center gap-3 border-b border-neutral-100 px-4 py-3.5 last:border-b-0 hover:bg-neutral-50 active:bg-neutral-100"
              >
                <Icon
                  icon="solar:chat-round-dots-bold-duotone"
                  className="shrink-0 text-xl text-neutral-300 group-hover:text-neutral-400 transition-colors"
                />
                <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
                  {renamingId === session.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(session.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(session.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      className="w-full rounded border border-[var(--primary-300)] px-2 py-1 text-sm outline-none"
                    />
                  ) : (
                    <>
                      <div className="truncate text-sm font-medium text-neutral-800 group-hover:text-neutral-900">
                        {session.title}
                      </div>
                      <div className="mt-0.5 text-xs text-neutral-400">
                        {t('settings.chat.session_meta', {
                          defaultValue: '{{msgCount}} 条消息 · {{time}}',
                          msgCount: session.messages.length,
                          time: formatDate(session.updatedAt),
                        })}
                      </div>
                    </>
                  )}
                </div>
                {/* 查看按钮 */}
                <button
                  type="button"
                  title={t('settings.chat.view_detail', { defaultValue: '查看对话' })}
                  onClick={() => setViewingSession(session)}
                  className="shrink-0 rounded p-1.5 text-neutral-400 opacity-0 transition-all hover:bg-blue-50 hover:text-blue-500 group-hover:opacity-100"
                >
                  <Icon icon="solar:eye-bold-duotone" className="text-base" />
                </button>
                <div
                  className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    title={t('settings.chat.rename', { defaultValue: '重命名' })}
                    onClick={() => {
                      setRenamingId(session.id);
                      setRenameValue(session.title);
                    }}
                    className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  >
                    <Icon icon="solar:pen-linear" className="text-base" />
                  </button>
                  <button
                    type="button"
                    title={t('settings.chat.delete', { defaultValue: '删除' })}
                    onClick={() => void handleDeleteSession(session)}
                    className="rounded p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <Icon icon="solar:trash-bin-trash-linear" className="text-base" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 收藏消息 */}
      <Section
        title={t('settings.chat.favorites_title', { defaultValue: '收藏消息' })}
        description={t('settings.chat.favorites_desc', {
          defaultValue: '在聊天窗口中悬停消息、点击星标即可收藏',
        })}
      >
        {favorites.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Icon
              icon="solar:star-line-duotone"
              className="mx-auto mb-2 text-3xl text-neutral-300"
            />
            <p className="text-xs text-neutral-400">
              {t('settings.chat.no_favorites', { defaultValue: '还没有收藏的消息' })}
            </p>
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {favorites.map((fav) => (
              <div
                key={`${fav.sessionId}-${fav.messageId}`}
                className="group flex items-start gap-3 border-b border-neutral-100 px-4 py-3 last:border-b-0 hover:bg-neutral-50"
              >
                <Icon icon="solar:star-bold" className="mt-0.5 shrink-0 text-base text-amber-400" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm leading-relaxed text-neutral-700">
                    {fav.content}
                  </p>
                  <div className="mt-1 text-xs text-neutral-400">
                    {(fav.role === 'user'
                      ? t('settings.chat.role_user', { defaultValue: '我' })
                      : t('settings.chat.role_ai', { defaultValue: 'AI' })) +
                      ' · ' +
                      formatDate(fav.timestamp)}
                  </div>
                </div>
                <button
                  type="button"
                  title={t('settings.chat.unfavorite', { defaultValue: '取消收藏' })}
                  onClick={() => handleRemoveFavorite(fav)}
                  className="shrink-0 rounded p-1.5 text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-neutral-700 group-hover:opacity-100"
                >
                  <Icon icon="solar:close-circle-linear" className="text-base" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 数据清理 */}
      <Section
        title={t('settings.chat.danger_title', { defaultValue: '数据清理' })}
        description={t('settings.chat.danger_desc', {
          defaultValue: '以下操作不可撤销，建议先在「记忆体 → 备份与恢复」中做一次备份',
        })}
      >
        <SettingRow
          title={t('settings.chat.clear_favorites', { defaultValue: '清空收藏' })}
          description={t('settings.chat.clear_favorites_row_desc', {
            defaultValue: '仅移除收藏标记，不影响聊天记录',
          })}
        >
          <button
            type="button"
            onClick={() => void handleClearFavorites()}
            disabled={favorites.length === 0}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('settings.chat.clear', { defaultValue: '清空' })}
          </button>
        </SettingRow>
        <SettingRow
          title={t('settings.chat.clear_all', { defaultValue: '清空全部会话' })}
          description={t('settings.chat.clear_all_row_desc', {
            defaultValue: '删除所有聊天记录，可选择是否同时删除备份文件',
          })}
        >
          <div className="flex items-center gap-2">
            <select
              value={clearScope}
              onChange={(e) => setClearScope(e.target.value as 'sessions' | 'all')}
              className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-600 outline-none focus:border-[var(--primary-400)]"
            >
              <option value="sessions">
                {t('settings.chat.scope_sessions', { defaultValue: '仅删除会话' })}
              </option>
              <option value="all">
                {t('settings.chat.scope_all', { defaultValue: '同时删除备份' })}
              </option>
            </select>
            <button
              type="button"
              onClick={() => void handleClearSessions()}
              disabled={sessions.length === 0}
              className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('settings.chat.clear', { defaultValue: '清空' })}
            </button>
          </div>
        </SettingRow>
      </Section>

      {/* ===== 会话详情查看器 ===== */}
      <Modal
        isOpen={viewingSession !== null}
        onClose={() => setViewingSession(null)}
        title={viewingSession?.title ?? ''}
        maxWidth="max-w-2xl"
      >
        {viewingSession && (
          <div className="flex flex-col" style={{ maxHeight: '60vh' }}>
            {/* 会话信息栏 */}
            <div className="flex items-center justify-between border-b border-neutral-100 px-1 pb-2.5 mb-1">
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <Icon icon="solar:chat-round-dots-bold-duotone" className="text-base" />
                <span>
                  {t('settings.chat.session_detail_footer', {
                    defaultValue: '{{count}} 条消息',
                    count: viewingSession.messages.length,
                  })}
                </span>
                <span>·</span>
                <span>{formatDate(viewingSession.updatedAt)}</span>
              </div>
            </div>

            {/* 消息流 */}
            <div className="flex-1 space-y-3 overflow-y-auto px-1 pb-2">
              {viewingSession.messages.map((msg, idx) => {
                const isUser = msg.role === 'user';
                const isAssistant = msg.role === 'assistant';
                const isSystem = msg.role === 'system';
                return (
                  <div
                    key={idx}
                    className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {/* 头像 */}
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        isUser
                          ? 'bg-[var(--primary-500)]'
                          : isAssistant
                            ? 'bg-neutral-200'
                            : 'bg-neutral-100'
                      }`}
                    >
                      <Icon
                        icon={
                          isUser
                            ? 'solar:user-bold-duotone'
                            : isAssistant
                              ? 'solar:cpu-bolt-bold-duotone'
                              : 'solar:settings-bold-duotone'
                        }
                        className={`text-sm ${isUser ? 'text-white' : 'text-neutral-500'}`}
                      />
                    </div>

                    {/* 消息气泡 */}
                    <div className={`max-w-[75%] ${isUser ? 'flex flex-col items-end' : ''}`}>
                      {/* 角色标签 + 时间 */}
                      {!isSystem && (
                        <div
                          className={`mb-1 flex items-center gap-1.5 text-[10px] text-neutral-400 ${isUser ? 'flex-row-reverse' : ''}`}
                        >
                          <span className="font-medium">
                            {isUser
                              ? t('settings.chat.role_user', { defaultValue: '我' })
                              : t('settings.chat.role_ai', { defaultValue: 'AI' })}
                          </span>
                          {msg.timestamp && <span>{formatDate(msg.timestamp.getTime())}</span>}
                        </div>
                      )}

                      <div
                        className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                          isUser
                            ? 'bg-[var(--primary-500)] text-white rounded-br-md'
                            : isAssistant
                              ? 'bg-neutral-100 text-neutral-800 rounded-bl-md'
                              : 'bg-neutral-50 text-neutral-500 italic text-xs border border-neutral-200'
                        }`}
                      >
                        {isSystem ? (
                          <span className="text-xs text-neutral-400">[系统消息]</span>
                        ) : (
                          <>
                            {typeof msg.content === 'string' ? (
                              <pre className="whitespace-pre-wrap break-words font-sans text-[13px]">
                                {msg.content}
                              </pre>
                            ) : (
                              <div className="space-y-1">
                                {Array.isArray(msg.content)
                                  ? (msg.content as unknown[]).map((c, i) => (
                                      <div key={i}>{String(c)}</div>
                                    ))
                                  : String(msg.content)}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default ChatSessionPage;
