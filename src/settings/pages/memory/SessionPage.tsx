import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section } from '../../components';
import {
  getSessionStats,
  listSessions,
  getSession,
  deleteSession,
  unifiedSearch,
  type SessionMeta,
  type SessionMessage,
  type SessionStats,
} from '../../../services/coreApi';

/**
 * SessionPage — 大脑会话档案
 *
 * 展示 Hermes 大脑（hermes_state.db）中的历史会话：
 * - 会话统计（数量 / 消息数 / FTS5 可用性）
 * - 记忆统一查询（一次检索命中记忆碎片 + 会话全文）
 * - 会话列表（点击展开查看消息 / 删除）
 */
export function SessionPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedMsgs, setExpandedMsgs] = useState<SessionMessage[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<{
    fragments: unknown[];
    sessions: unknown[];
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([getSessionStats(), listSessions({ limit: 50 })]);
      setStats(s);
      setSessions(l.items);
    } catch {
      // Core API 未启动时静默降级
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSession = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setMsgsLoading(true);
    try {
      const detail = await getSession(id);
      setExpandedMsgs(detail.messages);
    } catch {
      setExpandedMsgs([]);
    } finally {
      setMsgsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteSession(id);
    setExpandedId(null);
    await load();
  };

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      setSearchResult(await unifiedSearch(q, 10));
    } catch {
      setSearchResult(null);
    } finally {
      setSearching(false);
    }
  };

  const fmtTime = (v?: string) =>
    v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—';

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 会话统计 */}
      <Section
        title={t('settings.sessions.stats_title')}
        description={t('settings.sessions.stats_desc')}
      >
        <div className="p-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-neutral-50 p-3 text-center">
              <div className="text-2xl font-medium text-neutral-800">
                {stats?.session_count ?? '—'}
              </div>
              <div className="mt-0.5 text-xs text-neutral-400">{t('settings.sessions.count')}</div>
            </div>
            <div className="rounded-lg bg-neutral-50 p-3 text-center">
              <div className="text-2xl font-medium text-neutral-800">
                {stats?.message_count ?? '—'}
              </div>
              <div className="mt-0.5 text-xs text-neutral-400">
                {t('settings.sessions.messages')}
              </div>
            </div>
            <div className="rounded-lg bg-neutral-50 p-3 text-center">
              <div className="text-2xl font-medium text-neutral-800">
                {stats?.fts5_available ? '✓' : '—'}
              </div>
              <div className="mt-0.5 text-xs text-neutral-400">FTS5</div>
            </div>
          </div>
          {stats?.db_path && (
            <div className="mt-3 truncate font-mono text-[11px] text-neutral-400">
              {stats.db_path}
            </div>
          )}
        </div>
      </Section>

      {/* 记忆统一查询 */}
      <Section
        title={t('settings.sessions.search_title')}
        description={t('settings.sessions.search_desc')}
      >
        <div className="p-4">
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 transition-colors focus-within:border-[var(--primary-300)] focus-within:bg-white">
              <Icon icon="solar:magnifer-bold" className="shrink-0 text-base text-neutral-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder={t('settings.sessions.search_placeholder')}
                className="w-full bg-transparent text-sm text-neutral-700 outline-none placeholder:text-neutral-400"
              />
            </div>
            <button
              type="button"
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              className="shrink-0 rounded-lg bg-[var(--primary-500)] px-4 py-2 text-sm text-white transition-colors hover:bg-[var(--primary-600)] disabled:opacity-40"
            >
              {searching ? '…' : t('settings.sessions.search_btn')}
            </button>
          </div>

          {searchResult && (
            <div className="mt-3 space-y-2">
              <div className="text-xs text-neutral-400">
                {t('settings.sessions.fragments')}：{searchResult.fragments.length} ·{' '}
                {t('settings.sessions.hits')}：{searchResult.sessions.length}
              </div>
              {searchResult.sessions.length === 0 && searchResult.fragments.length === 0 && (
                <div className="rounded-lg bg-neutral-50 px-3 py-4 text-center text-sm text-neutral-400">
                  {t('settings.sessions.no_result')}
                </div>
              )}
              {searchResult.fragments.map((f, i) => (
                <div
                  key={`f-${i}`}
                  className="rounded-lg border border-neutral-100 px-3 py-2 text-sm"
                >
                  {(f as { content?: string }).content}
                </div>
              ))}
              {searchResult.sessions.map((s, i) => (
                <div
                  key={`s-${i}`}
                  className="rounded-lg border border-neutral-100 px-3 py-2 text-sm text-neutral-700"
                >
                  <span className="mr-2 text-xs text-neutral-400">
                    {(s as { session_id?: string }).session_id}
                  </span>
                  {(s as { snippet?: string }).snippet}
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* 会话列表 */}
      <Section
        title={t('settings.sessions.list_title')}
        description={t('settings.sessions.list_desc')}
      >
        {sessions.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-neutral-400">
            {t('settings.sessions.empty')}
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => toggleSession(s.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-50"
                >
                  <Icon
                    icon="solar:document-text-bold-duotone"
                    className="shrink-0 text-lg text-neutral-300"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs text-neutral-600">
                      {s.id}
                    </span>
                    <span className="block truncate text-sm text-neutral-800">
                      {(s as { preview?: string }).preview || t('settings.sessions.no_preview')}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-neutral-400">
                    {(s as { message_count?: number }).message_count ?? 0} ·{' '}
                    {fmtTime((s as { last_active?: string }).last_active)}
                  </span>
                  <Icon
                    icon="solar:alt-arrow-down-bold"
                    className={`shrink-0 text-neutral-300 transition-transform ${
                      expandedId === s.id ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {expandedId === s.id && (
                  <div className="border-t border-neutral-50 bg-neutral-50/60 px-4 py-3">
                    {msgsLoading ? (
                      <div className="text-sm text-neutral-400">
                        {t('settings.sessions.loading')}
                      </div>
                    ) : expandedMsgs.length === 0 ? (
                      <div className="text-sm text-neutral-400">
                        {t('settings.sessions.no_messages')}
                      </div>
                    ) : (
                      <div className="max-h-72 space-y-1.5 overflow-y-auto">
                        {expandedMsgs.map((m) => (
                          <div key={m.id} className="text-sm">
                            <span className="mr-2 font-mono text-[11px] text-neutral-400">
                              {m.role}
                            </span>
                            <span className="text-neutral-700">{m.content}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleDelete(s.id)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50"
                      >
                        <Icon icon="solar:trash-bin-trash-bold-duotone" className="text-sm" />
                        {t('settings.sessions.delete')}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export default SessionPage;
