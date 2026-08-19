import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section } from '../../components';
import { healthCheck, getPersonality, type PersonalityState } from '../../../services/coreApi';

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

  const pad = useMemo(() => {
    if (!data) return null;
    // 后端返回的 pad_baseline 当前不在 PersonalityState 类型里，
    // 这里用规则重新映射，避免类型锁死前端。
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
      parts.push('各维度较为均衡，属于典型的中间型人格');
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
                      {value.toFixed(2)}
                    </span>
                  </div>
                  <div className="relative h-1.5 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className="h-full rounded-full bg-[var(--primary-400)] transition-all duration-500"
                      style={{ width: `${value * 100}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="w-20 shrink-0 text-[10px] text-neutral-400">
                      {isZh ? '低' : 'Low'}
                    </span>
                    <span className="text-[10px] text-neutral-400">0.5</span>
                    <span className="w-10 shrink-0 text-right text-[10px] text-neutral-400">
                      {isZh ? '高' : 'High'}
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
