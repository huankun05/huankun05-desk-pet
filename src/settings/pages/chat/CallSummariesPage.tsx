import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showToast } from '../../../utils/toast';
import {
  listCallSummaries,
  getCallSummary,
  renameCallSummary,
  deleteCallSummary,
  type CallSummaryListItem,
  type CallSummaryDetail,
} from '../../../services/callSummaries';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  // created_at 形如 2026-08-21 14:03:22；call_date 为 YYYY-MM-DD
  return iso.replace('T', ' ').slice(0, 19);
}

export function CallSummariesPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<CallSummaryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<CallSummaryDetail | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (q?: string) => {
      setLoading(true);
      try {
        const data = await listCallSummaries(q && q.trim() ? q.trim() : undefined);
        setItems(data);
      } catch (e) {
        showToast(
          t('settings.chat.call_load_fail', {
            defaultValue: '加载通话记录失败，请确认后端 Core 服务已启动',
          }),
          'error',
        );
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const onSearchChange = (v: string) => {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void load(v), 300);
  };

  const openDetail = async (id: number) => {
    try {
      const d = await getCallSummary(id);
      setDetail(d);
      setEditingTitle(d.title);
    } catch {
      showToast(t('settings.chat.call_open_fail', { defaultValue: '打开通话记录失败' }), 'error');
    }
  };

  const closeDetail = () => {
    setDetail(null);
    setEditingTitle('');
  };

  const doRename = async () => {
    if (!detail) return;
    const title = editingTitle.trim();
    if (!title) return;
    try {
      await renameCallSummary(detail.id, title);
      showToast(t('settings.chat.call_renamed', { defaultValue: '已重命名' }), 'success');
      setDetail({ ...detail, title });
      await load(search);
    } catch {
      showToast(t('settings.chat.call_rename_fail', { defaultValue: '重命名失败' }), 'error');
    }
  };

  const doDelete = async (id: number) => {
    if (
      !window.confirm(
        t('settings.chat.call_delete_confirm', { defaultValue: '确定删除这条通话记录？' }),
      )
    )
      return;
    try {
      await deleteCallSummary(id);
      showToast(t('settings.chat.call_deleted', { defaultValue: '已删除' }), 'success');
      if (detail?.id === id) closeDetail();
      await load(search);
    } catch {
      showToast(t('settings.chat.call_delete_fail', { defaultValue: '删除失败' }), 'error');
    }
  };

  const doExport = (d: CallSummaryDetail) => {
    let turns: Turn[];
    try {
      turns = JSON.parse(d.transcript_json || '[]');
    } catch {
      turns = [];
    }
    const lines: string[] = [];
    lines.push(`# ${d.title}`);
    lines.push(`日期：${d.call_date} · 时长：${formatDuration(d.duration_seconds)}`);
    lines.push('');
    lines.push('## 总结');
    lines.push(d.summary_text || '');
    lines.push('');
    lines.push('## 对话原文');
    for (const turn of turns) {
      lines.push(`${turn.role === 'user' ? '我' : '我（助手）'}：${turn.text}`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${d.title || '通话记录'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <div className="mb-4 flex items-center gap-3">
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('settings.chat.call_search', { defaultValue: '搜索标题或日期…' })}
          className="max-w-[280px] flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 outline-none transition-colors focus:border-[var(--primary-500)]"
        />
        <button
          type="button"
          onClick={() => void load(search)}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 transition-colors hover:bg-neutral-50"
        >
          {t('settings.chat.call_refresh', { defaultValue: '刷新' })}
        </button>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-neutral-400">
          {t('settings.chat.call_loading', { defaultValue: '加载中…' })}
        </div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-sm text-neutral-400">
          {t('settings.chat.call_empty', {
            defaultValue: '暂无通话记录。开启「通话总结」后，语音通话挂断会自动生成复盘。',
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it) => (
            <div
              key={it.id}
              className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3 transition-colors hover:border-[var(--primary-500)]"
            >
              <button
                type="button"
                onClick={() => void openDetail(it.id)}
                className="flex min-w-0 flex-1 flex-col items-start text-left"
              >
                <span className="truncate text-sm font-medium text-neutral-800">{it.title}</span>
                <span className="mt-0.5 text-xs text-neutral-400">
                  {it.call_date} · {formatDuration(it.duration_seconds)} ·{' '}
                  {formatDate(it.created_at)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void doDelete(it.id)}
                className="ml-3 shrink-0 rounded-lg px-2.5 py-1 text-xs text-red-500 transition-colors hover:bg-red-50"
              >
                {t('settings.chat.call_delete', { defaultValue: '删除' })}
              </button>
            </div>
          ))}
        </div>
      )}

      {detail && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
          onClick={closeDetail}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <input
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm font-medium text-neutral-800 outline-none focus:border-[var(--primary-500)]"
              />
              <button
                type="button"
                onClick={doRename}
                className="shrink-0 rounded-lg bg-[var(--primary-500)] px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-90"
              >
                {t('settings.chat.call_save', { defaultValue: '保存' })}
              </button>
            </div>

            <div className="mb-3 text-xs text-neutral-400">
              {detail.call_date} · {formatDuration(detail.duration_seconds)} ·{' '}
              {formatDate(detail.created_at)}
            </div>

            <h3 className="mb-1 text-sm font-semibold text-neutral-700">
              {t('settings.chat.call_summary_label', { defaultValue: '总结' })}
            </h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">
              {detail.summary_text ||
                t('settings.chat.call_no_summary', { defaultValue: '（无总结内容）' })}
            </p>

            <h3 className="mb-1 mt-4 text-sm font-semibold text-neutral-700">
              {t('settings.chat.call_transcript_label', { defaultValue: '对话原文' })}
            </h3>
            <div className="flex flex-col gap-1.5">
              {(() => {
                let turns: Turn[];
                try {
                  turns = JSON.parse(detail.transcript_json || '[]');
                } catch {
                  turns = [];
                }
                if (turns.length === 0) {
                  return (
                    <p className="text-xs text-neutral-400">
                      {t('settings.chat.call_no_transcript', { defaultValue: '（无原文记录）' })}
                    </p>
                  );
                }
                return turns.map((turn, i) => (
                  <div key={i} className="text-sm">
                    <span
                      className={
                        turn.role === 'user' ? 'text-neutral-500' : 'text-[var(--primary-600)]'
                      }
                    >
                      {turn.role === 'user' ? '我' : '助手'}：
                    </span>
                    <span className="text-neutral-700">{turn.text}</span>
                  </div>
                ));
              })()}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => doExport(detail)}
                className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 transition-colors hover:bg-neutral-50"
              >
                {t('settings.chat.call_export', { defaultValue: '导出' })}
              </button>
              <button
                type="button"
                onClick={closeDetail}
                className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm text-neutral-600 transition-colors hover:bg-neutral-200"
              >
                {t('settings.chat.call_close', { defaultValue: '关闭' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CallSummariesPage;
