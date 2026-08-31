import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Section } from '../../components';
import { getUsageEntries, type UsageEntry } from '../../../services/provider/usageLedger';

/**
 * 用量统计页：LLM / 视觉调用成本账本（借鉴 Miru 的 llm_usage_report）。
 *
 * 数据来自 usageLedger（localStorage 环形缓冲，上限 1000 条）：
 * - 头部：今日调用 / 今日字符估算 / 今日 token / 真实 token 覆盖率
 * - 按天汇总（近 14 天）
 * - 按模型、按调用类型汇总
 * - 最近调用明细
 *
 * token 优先展示（provider 回传 usage 时）；缺失时展示字符估算并标注。
 */

function fmtNum(n: number): string {
  return n.toLocaleString('zh-CN');
}

interface DayRow {
  day: string;
  calls: number;
  chars: number;
  tokens: number;
}

interface GroupRow {
  name: string;
  calls: number;
  chars: number;
  tokens: number;
}

function groupBy(entries: UsageEntry[], key: (e: UsageEntry) => string): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const e of entries) {
    const k = key(e);
    const row = map.get(k) ?? { name: k, calls: 0, chars: 0, tokens: 0 };
    row.calls += 1;
    row.chars += e.promptChars + e.completionChars;
    row.tokens += (e.promptTokens ?? 0) + (e.completionTokens ?? 0);
    map.set(k, row);
  }
  return [...map.values()].sort((a, b) => b.calls - a.calls);
}

export function UsagePage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<UsageEntry[]>(() => getUsageEntries());

  const refresh = useCallback(() => {
    setEntries(getUsageEntries());
  }, []);

  const stats = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const today = entries.filter((e) => e.ts.slice(0, 10) === todayKey);
    const withTokens = today.filter((e) => e.promptTokens !== undefined);
    return {
      todayCalls: today.length,
      todayChars: today.reduce((s, e) => s + e.promptChars + e.completionChars, 0),
      todayTokens: today.reduce((s, e) => s + (e.promptTokens ?? 0) + (e.completionTokens ?? 0), 0),
      coverage: today.length > 0 ? withTokens.length / today.length : 0,
    };
  }, [entries]);

  const byDay = useMemo<DayRow[]>(() => {
    const map = new Map<string, DayRow>();
    for (const e of entries) {
      const d = e.ts.slice(0, 10);
      const row = map.get(d) ?? { day: d, calls: 0, chars: 0, tokens: 0 };
      row.calls += 1;
      row.chars += e.promptChars + e.completionChars;
      row.tokens += (e.promptTokens ?? 0) + (e.completionTokens ?? 0);
      map.set(d, row);
    }
    return [...map.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 14);
  }, [entries]);

  const byModel = useMemo(() => groupBy(entries, (e) => e.model), [entries]);
  const byLabel = useMemo(() => groupBy(entries, (e) => e.callLabel), [entries]);

  const recent = useMemo(() => [...entries].reverse().slice(0, 20), [entries]);

  const empty = entries.length === 0;

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out] space-y-4">
      <Section
        title={t('settings.services.usage.title')}
        description={t('settings.services.usage.desc')}
      >
        <div className="p-4">
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-neutral-200 bg-white p-3">
              <p className="text-xs text-neutral-400">{t('settings.services.usage.today_calls')}</p>
              <p className="mt-1 text-lg font-semibold text-neutral-800">
                {fmtNum(stats.todayCalls)}
              </p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-white p-3">
              <p className="text-xs text-neutral-400">{t('settings.services.usage.today_chars')}</p>
              <p className="mt-1 text-lg font-semibold text-neutral-800">
                {fmtNum(stats.todayChars)}
              </p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-white p-3">
              <p className="text-xs text-neutral-400">
                {t('settings.services.usage.today_tokens')}
              </p>
              <p className="mt-1 text-lg font-semibold text-neutral-800">
                {fmtNum(stats.todayTokens)}
              </p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-white p-3">
              <p className="text-xs text-neutral-400">
                {t('settings.services.usage.token_coverage')}
              </p>
              <p className="mt-1 text-lg font-semibold text-neutral-800">
                {(stats.coverage * 100).toFixed(0)}%
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50"
          >
            {t('settings.services.usage.refresh')}
          </button>
        </div>
      </Section>

      {empty ? (
        <Section title={t('settings.services.usage.title')}>
          <div className="p-6 text-center text-sm text-neutral-400">
            {t('settings.services.usage.empty')}
          </div>
        </Section>
      ) : (
        <>
          {/* 按天汇总 */}
          <Section title={t('settings.services.usage.by_day')}>
            <div className="overflow-x-auto p-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-neutral-400">
                    <th className="pb-2 pr-4 font-normal">{t('settings.services.usage.day')}</th>
                    <th className="pb-2 pr-4 font-normal">{t('settings.services.usage.calls')}</th>
                    <th className="pb-2 pr-4 font-normal">{t('settings.services.usage.chars')}</th>
                    <th className="pb-2 font-normal">{t('settings.services.usage.tokens')}</th>
                  </tr>
                </thead>
                <tbody>
                  {byDay.map((row) => (
                    <tr key={row.day} className="border-t border-neutral-100 text-neutral-600">
                      <td className="py-1.5 pr-4">{row.day}</td>
                      <td className="py-1.5 pr-4">{row.calls}</td>
                      <td className="py-1.5 pr-4">{fmtNum(row.chars)}</td>
                      <td className="py-1.5">{row.tokens > 0 ? fmtNum(row.tokens) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 按模型 / 按调用类型 */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Section title={t('settings.services.usage.by_model')}>
              <div className="p-4">
                <UsageGroupTable rows={byModel} t={t} />
              </div>
            </Section>
            <Section title={t('settings.services.usage.by_label')}>
              <div className="p-4">
                <UsageGroupTable rows={byLabel} t={t} />
              </div>
            </Section>
          </div>

          {/* 最近调用 */}
          <Section title={t('settings.services.usage.recent')}>
            <div className="overflow-x-auto p-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-neutral-400">
                    <th className="pb-2 pr-4 font-normal">{t('settings.services.usage.time')}</th>
                    <th className="pb-2 pr-4 font-normal">{t('settings.services.usage.tier')}</th>
                    <th className="pb-2 pr-4 font-normal">{t('settings.services.usage.model')}</th>
                    <th className="pb-2 pr-4 font-normal">{t('settings.services.usage.label')}</th>
                    <th className="pb-2 pr-4 font-normal">{t('settings.services.usage.chars')}</th>
                    <th className="pb-2 font-normal">{t('settings.services.usage.tokens')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((e, i) => (
                    <tr
                      key={`${e.ts}-${i}`}
                      className="border-t border-neutral-100 text-neutral-600"
                    >
                      <td className="py-1.5 pr-4">
                        {new Date(e.ts).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-1.5 pr-4">{e.tier}</td>
                      <td className="py-1.5 pr-4 max-w-[160px] truncate" title={e.model}>
                        {e.model}
                      </td>
                      <td className="py-1.5 pr-4">{e.callLabel}</td>
                      <td className="py-1.5 pr-4">{fmtNum(e.promptChars + e.completionChars)}</td>
                      <td className="py-1.5">
                        {e.promptTokens !== undefined
                          ? fmtNum((e.promptTokens ?? 0) + (e.completionTokens ?? 0))
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {entries.length > 20 && (
                <p className="mt-2 text-[10px] text-neutral-400">
                  {t('settings.services.usage.recent_hint', { count: entries.length })}
                </p>
              )}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function UsageGroupTable({ rows, t }: { rows: GroupRow[]; t: (key: string) => string }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-neutral-400">
          <th className="pb-2 pr-4 font-normal">{t('settings.services.usage.model')}</th>
          <th className="pb-2 pr-4 font-normal">{t('settings.services.usage.calls')}</th>
          <th className="pb-2 pr-4 font-normal">{t('settings.services.usage.chars')}</th>
          <th className="pb-2 font-normal">{t('settings.services.usage.tokens')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name} className="border-t border-neutral-100 text-neutral-600">
            <td className="py-1.5 pr-4 max-w-[160px] truncate" title={row.name}>
              {row.name}
            </td>
            <td className="py-1.5 pr-4">{row.calls}</td>
            <td className="py-1.5 pr-4">{fmtNum(row.chars)}</td>
            <td className="py-1.5">{row.tokens > 0 ? fmtNum(row.tokens) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default UsagePage;
