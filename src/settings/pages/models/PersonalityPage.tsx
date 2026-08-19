import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section } from '../../components';
import {
  healthCheck,
  getPersonality,
  updatePersonality,
  type PersonalityState,
} from '../../../services/coreApi';

const DIMS = [
  { key: 'honesty_humility', cn: '诚实-谦逊', en: 'Honesty-Humility', desc: '' },
  { key: 'emotionality', cn: '情绪性', en: 'Emotionality', desc: '' },
  { key: 'extraversion', cn: '外向性', en: 'Extraversion', desc: '' },
  { key: 'agreeableness', cn: '宜人性', en: 'Agreeableness', desc: '' },
  { key: 'conscientiousness', cn: '尽责性', en: 'Conscientiousness', desc: '' },
  { key: 'openness', cn: '开放性', en: 'Openness', desc: '' },
] as const;

const PAD_KEYS = [
  { key: 'pleasure', cn: '愉悦', en: 'Pleasure' },
  { key: 'arousal', cn: '唤醒', en: 'Arousal' },
  { key: 'dominance', cn: '支配', en: 'Dominance' },
] as const;

export function PersonalityPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language ?? 'zh-CN';
  const isZh = lang.startsWith('zh');

  const [data, setData] = useState<PersonalityState | null>(null);
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ok, res] = await Promise.all([
        healthCheck().catch(() => false),
        getPersonality().catch(() => null),
      ]);
      setHealth(ok);
      setData(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  // 编辑模式：把当前六维载入草稿
  const startEdit = useCallback(() => {
    if (!data) return;
    const d: Record<string, number> = {};
    for (const dim of DIMS) {
      d[dim.key] = Number(data[dim.key as keyof PersonalityState] ?? 0.5);
    }
    setDraft(d);
    setEditing(true);
  }, [data]);

  // 保存手动设定的人格（用户调整/设定初始状态）
  const saveEdit = useCallback(async () => {
    if (!data) return;
    setSaving(true);
    try {
      const updated = await updatePersonality(draft);
      setData(updated);
      setEditing(false);
    } catch {
      /* 保存失败：保持编辑态，用户可重试 */
    } finally {
      setSaving(false);
    }
  }, [data, draft]);

  // 恢复初始人格（重置为默认 0.5）
  const resetPersonality = useCallback(async () => {
    setSaving(true);
    try {
      const updated = await updatePersonality({ reset: true });
      setData(updated);
      setEditing(false);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }, []);

  const pad = useMemo(() => {
    if (!data) return null;
    // 优先用后端 PAD 基线；后端未提供时按规则映射（避免类型锁死前端）
    if (data.pad_baseline) {
      return {
        pleasure: Math.max(-1, Math.min(1, data.pad_baseline.pleasure)),
        arousal: Math.max(-1, Math.min(1, data.pad_baseline.arousal)),
        dominance: Math.max(-1, Math.min(1, data.pad_baseline.dominance)),
      };
    }
    const pleasure =
      ((data.extraversion ?? 0.5) - 0.5) * 0.6 + ((data.agreeableness ?? 0.5) - 0.5) * 0.3;
    const arousal = ((data.emotionality ?? 0.5) - 0.5) * 0.2 + ((data.openness ?? 0.5) - 0.5) * 0.3;
    const dominance =
      ((data.conscientiousness ?? 0.5) - 0.5) * 0.5 + ((data.extraversion ?? 0.5) - 0.5) * 0.2;
    return {
      pleasure: Math.max(-0.3, Math.min(0.3, pleasure)),
      arousal: Math.max(-0.3, Math.min(0.3, arousal)),
      dominance: Math.max(-0.3, Math.min(0.3, dominance)),
    };
  }, [data]);

  const description = useMemo(() => {
    if (!data) return '';
    // 后端已生成人格描述则直接采用
    if (data.description) return data.description;
    const dims = DIMS.map((d) => ({
      name: isZh ? d.cn : d.en,
      // 后端可能缺字段，缺省按 0 处理，避免 toFixed/sort 崩
      value: Number(data[d.key as keyof PersonalityState] ?? 0),
    }));
    dims.sort((a, b) => b.value - a.value);
    const top = dims[0];
    const bottom = dims[dims.length - 1];
    const parts: string[] = [];
    if (top.value > 0.7) {
      parts.push(
        t('settings.personality.desc_top', {
          name: top.name,
          value: `${Math.round(top.value * 100)}%`,
        }),
      );
    }
    if (bottom.value < 0.3) {
      parts.push(
        t('settings.personality.desc_bottom', {
          name: bottom.name,
          value: `${Math.round(bottom.value * 100)}%`,
        }),
      );
    }
    if (parts.length === 0) {
      parts.push(t('settings.personality.balanced'));
    }
    return parts.join('；');
  }, [data, t, isZh]);

  const updatedAt = useMemo(() => {
    if (!data?.updated_at) return '';
    try {
      const d = new Date(data.updated_at);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleString();
    } catch {
      return '';
    }
  }, [data]);

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section title={t('settings.personality.title')} description={t('settings.personality.desc')}>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--primary-50)] text-[var(--primary-600)]">
                <Icon icon="solar:user-circle-bold-duotone" className="text-2xl" />
              </div>
              <div>
                <div className="text-lg font-medium text-neutral-800">
                  {t('settings.personality.title')}
                </div>
                <div className="text-xs text-neutral-400">
                  {t('settings.personality.updated_at')}: {updatedAt || '—'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {health === null ? null : health ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {t('settings.personality.online')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-500">
                  <span className="size-1.5 rounded-full bg-red-500" />
                  {t('settings.personality.offline')}
                </span>
              )}
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-50"
              >
                <Icon
                  icon="solar:refresh-bold"
                  className={`text-sm ${loading ? 'animate-spin' : ''}`}
                />
                {t('settings.personality.refresh')}
              </button>
              {editing ? (
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  disabled={saving || !data}
                  className="inline-flex items-center gap-1 rounded-md bg-[var(--primary-500)] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[var(--primary-600)] disabled:opacity-50"
                >
                  <Icon icon="solar:check-circle-bold" className="text-sm" />
                  {t('settings.personality.save')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startEdit}
                  disabled={!data}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-50"
                >
                  <Icon icon="solar:pen-new-square-bold" className="text-sm" />
                  {t('settings.personality.edit')}
                </button>
              )}
              <button
                type="button"
                onClick={() => void resetPersonality()}
                disabled={saving || !data}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-50"
              >
                <Icon icon="solar:refresh-square-bold" className="text-sm" />
                {t('settings.personality.reset')}
              </button>
            </div>
          </div>

          {description && (
            <div className="rounded-lg bg-[var(--primary-50)] px-3 py-2.5 text-sm text-[var(--primary-700)]">
              {description}
            </div>
          )}
        </div>
      </Section>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section
          title={t('settings.personality.hexaco_title')}
          description={t('settings.personality.hexaco_desc')}
        >
          <div className="space-y-2.5 p-2">
            {DIMS.map((d) => {
              // 后端可能缺字段，缺省按 0 处理，避免 toFixed 崩
              const value = data ? Number(data[d.key as keyof PersonalityState] ?? 0) : 0;
              return (
                <div key={d.key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="w-20 shrink-0 text-xs text-neutral-600">
                      {isZh ? d.cn : d.en}
                    </span>
                    <span className="w-10 shrink-0 text-right text-xs text-neutral-400">
                      {(editing ? (draft[d.key] ?? 0.5) : value).toFixed(2)}
                    </span>
                  </div>
                  {editing ? (
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={draft[d.key] ?? 0.5}
                      onChange={(e) => setDraft((p) => ({ ...p, [d.key]: Number(e.target.value) }))}
                      className="w-full accent-[var(--primary-500)]"
                    />
                  ) : (
                    <div className="relative h-1.5 overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className="h-full rounded-full bg-[var(--primary-400)] transition-all duration-500"
                        style={{ width: `${value * 100}%` }}
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="w-20 shrink-0 text-[10px] text-neutral-400">
                      {t('settings.personality.low')}
                    </span>
                    <span className="text-[10px] text-neutral-400">0.5</span>
                    <span className="w-10 shrink-0 text-right text-[10px] text-neutral-400">
                      {t('settings.personality.high')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Section
          title={t('settings.personality.pad_title')}
          description={t('settings.personality.pad_desc')}
        >
          {pad ? (
            <div className="space-y-1.5 p-2">
              {PAD_KEYS.map((k) => {
                const v = Number(pad[k.key as keyof typeof pad] ?? 0);
                const abs = Math.abs(v);
                const left = v >= 0 ? 50 : 50 - abs * 50;
                const width = abs * 50;
                return (
                  <div key={k.key} className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-xs text-neutral-500">
                      {isZh ? k.cn : k.en}
                    </span>
                    <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className="absolute inset-y-0 left-1/2 bg-neutral-200"
                        style={{ width: 1 }}
                      />
                      <div
                        className="absolute inset-y-0 rounded-full bg-[var(--primary-400)] transition-all duration-500"
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs text-neutral-400">
                      {v.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-neutral-400">
              {t('settings.personality.no_data')}
            </div>
          )}
        </Section>
      </div>

      {description && (
        <div className="mt-4">
          <Section
            title={t('settings.personality.desc_title')}
            description={t('settings.personality.desc_desc')}
          >
            <div className="px-4 py-3 text-sm text-neutral-700 leading-relaxed">{description}</div>
          </Section>
        </div>
      )}
    </div>
  );
}

export default PersonalityPage;
