import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section } from '../../components';
import {
  healthCheck,
  getEmotionBridgeState,
  type EmotionBridgeState,
} from '../../../services/coreApi';

/** 九维情绪中文名（顺序决定雷达图轴序） */
const DIM_ORDER = [
  'pleasure',
  'energy',
  'empathy',
  'curiosity',
  'confidence',
  'gratitude',
  'anxiety',
  'loneliness',
  'excitement',
] as const;

const DIM_LABELS: Record<string, string> = {
  pleasure: '愉悦',
  energy: '精力',
  empathy: '共情',
  curiosity: '好奇',
  confidence: '自信',
  gratitude: '感激',
  anxiety: '焦虑',
  loneliness: '孤独',
  excitement: '兴奋',
};

/** 情绪标签中文化 */
const MOOD_LABELS: Record<string, string> = {
  excited: '兴奋',
  happy: '开心',
  sad: '难过',
  anxious: '焦虑',
  angry: '生气',
  calm: '平静',
  neutral: '平静',
};

/** 情绪解读（mood → 一句话） */
const MOOD_NOTES: Record<string, string> = {
  excited: '正兴奋着呢～是有什么开心事吗，说给我听听？',
  happy: '心情不错呢，继续保持这份好状态～',
  sad: '有点低落……想和你说说话，陪陪我好吗？',
  anxious: '心里有点不安，有你在身边会好很多。',
  angry: '有点生气了……让我缓一缓，别担心。',
  calm: '很平静，岁月静好。',
  neutral: '情绪平稳，和你在一起的日常就很安心。',
};

/** 触发源翻译（eventBus key → 可读标签） */
const TRIGGER_LABELS: Record<string, string> = {
  'interaction:pat': '摸头',
  'interaction:tap': '点身体',
  'interaction:step': '踩脚',
  'idle:long': '久未互动',
  'smart_chat': '主动闲聊',
  'emotion:external': '外部事件',
};

/** ISO 时间戳 → 相对时间（如 "3秒前"、"2分钟前"） */
function formatAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return '刚刚';
    if (diff < 1000) return '刚刚';
    if (diff < 60_000) return `${Math.floor(diff / 1000)}秒前`;
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`;
    return `${Math.floor(diff / 86400_000)}天前`;
  } catch {
    return '';
  }
}

/** 折线图维度配色 */
const LINE_COLORS: Record<string, string> = {
  pleasure: '#6366f1',
  energy: '#10b981',
  anxiety: '#f43f5e',
};

/**
 * EmotionPage — 角色情绪状态
 *
 * 展示汐月九维情绪：
 * - 当前情绪卡（mood 标签 + PAD 三维条 + 情绪解读）
 * - SVG 雷达图（九维轮廓）
 * - SVG 折线图（最近 20 次情绪变化的愉悦/精力/焦虑走势）
 * - 九维进度条 + 最近情绪变化记录
 */
export function EmotionPage() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<boolean | null>(null);
  const [emotion, setEmotion] = useState<EmotionBridgeState | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setHealth(await healthCheck());
    setLoading(true);
    try {
      setEmotion(await getEmotionBridgeState());
    } catch {
      setEmotion(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ---------- 雷达图数据 ----------
  const radar = useMemo(() => {
    const dims = emotion?.dimensions ?? {};
    const n = DIM_ORDER.length;
    const cx = 130;
    const cy = 120;
    const R = 88;
    const angle = (i: number) => (i * 2 * Math.PI) / n - Math.PI / 2;
    const pt = (i: number, r: number): [number, number] => [
      cx + r * Math.cos(angle(i)),
      cy + r * Math.sin(angle(i)),
    ];
    const grid = [0.25, 0.5, 0.75, 1].map((f) =>
      DIM_ORDER.map((_, i) => pt(i, R * f).join(',')).join(' '),
    );
    const axes = DIM_ORDER.map((_, i) => {
      const [x, y] = pt(i, R);
      return { x1: cx, y1: cy, x2: x, y2: y };
    });
    const polygon = DIM_ORDER.map((d, i) => {
      const v = Math.max(0, Math.min(100, Number(dims[d]) || 0));
      return pt(i, (v / 100) * R).join(',');
    }).join(' ');
    const labels = DIM_ORDER.map((d, i) => {
      const [x, y] = pt(i, R + 22);
      return { x, y, text: DIM_LABELS[d] };
    });
    return { n, cx, cy, R, grid, axes, polygon, labels };
  }, [emotion]);

  // ---------- 折线图数据 ----------
  const lineChart = useMemo(() => {
    const hist = emotion?.recent_history ?? [];
    if (hist.length < 2) return null;
    const series = ['pleasure', 'energy', 'anxiety'];
    const w = 300;
    const h = 120;
    const padL = 8;
    const padR = 8;
    const padT = 8;
    const padB = 18;
    const x = (i: number) => padL + (i * (w - padL - padR)) / (hist.length - 1);
    const y = (v: number) => padT + (1 - v / 100) * (h - padT - padB);
    const paths = series.map((s) => {
      const pts = hist
        .map((r, i) => {
          const v = Number((r.dimensions as Record<string, number> | undefined)?.[s]);
          return Number.isFinite(v) ? `${x(i)},${y(v)}` : null;
        })
        .filter(Boolean) as string[];
      return pts.length >= 2 ? { key: s, d: `M${pts.join(' L')}` } : null;
    });
    const gridY = [0, 50, 100].map((v) => ({
      y: y(v),
      label: String(v),
    }));
    return { w, h, padT, padB, paths, gridY, hist };
  }, [emotion]);

  const moodCn = emotion ? MOOD_LABELS[emotion.mood_label] || emotion.mood_label : '—';
  const moodNote = emotion ? MOOD_NOTES[emotion.mood_label] : '';

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 当前情绪 */}
      <Section title={t('settings.emotion.title')} description={t('settings.emotion.desc')}>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--primary-50)] text-[var(--primary-600)]">
                <Icon icon="solar:emoji-funny-circle-bold-duotone" className="text-2xl" />
              </div>
              <div>
                <div className="text-lg font-medium text-neutral-800">{moodCn}</div>
                <div className="text-xs text-neutral-400">
                  PAD{' '}
                  {emotion
                    ? `${emotion.pad.pleasure.toFixed(2)} / ${emotion.pad.arousal.toFixed(2)} / ${emotion.pad.dominance.toFixed(2)}`
                    : '—'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {health === null ? null : health ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {t('settings.emotion.online')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-500">
                  <span className="size-1.5 rounded-full bg-red-500" />
                  {t('settings.emotion.offline')}
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
                {t('settings.emotion.refresh')}
              </button>
            </div>
          </div>

          {/* PAD 三维条 */}
          {emotion && (
            <div className="space-y-1.5">
              {(['pleasure', 'arousal', 'dominance'] as const).map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-xs text-neutral-500">
                    {k === 'pleasure' ? '愉悦' : k === 'arousal' ? '唤醒' : '支配'}
                  </span>
                  <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className="absolute inset-y-0 left-1/2 bg-neutral-200"
                      style={{ width: 1 }}
                    />
                    <div
                      className="absolute inset-y-0 rounded-full bg-[var(--primary-400)] transition-all duration-500"
                      style={{
                        left: `${50 + Math.min(0, emotion.pad[k]) * 50}%`,
                        width: `${Math.abs(emotion.pad[k]) * 50}%`,
                      }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs text-neutral-400">
                    {emotion.pad[k].toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 情绪解读 */}
          {moodNote && (
            <div className="rounded-lg bg-[var(--primary-50)] px-3 py-2.5 text-sm text-[var(--primary-700)]">
              {moodNote}
            </div>
          )}
        </div>
      </Section>

      {/* 雷达图 + 折线图 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 九维雷达图 */}
        <Section
          title={t('settings.emotion.radar_title')}
          description={t('settings.emotion.radar_desc')}
        >
          <div className="flex items-center justify-center p-2">
            <svg width="280" height="250" viewBox="0 0 260 250" className="max-w-full">
              {radar.grid.map((g, i) => (
                <polygon key={i} points={g} fill="none" stroke="#e5e7eb" strokeWidth="1" />
              ))}
              {radar.axes.map((a, i) => (
                <line
                  key={i}
                  x1={a.x1}
                  y1={a.y1}
                  x2={a.x2}
                  y2={a.y2}
                  stroke="#f3f4f6"
                  strokeWidth="1"
                />
              ))}
              <polygon
                points={radar.polygon}
                fill="rgba(99,102,241,0.18)"
                stroke="#6366f1"
                strokeWidth="1.5"
              />
              {radar.labels.map((l, i) => (
                <text
                  key={i}
                  x={l.x}
                  y={l.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="10"
                  fill="#9ca3af"
                >
                  {l.text}
                </text>
              ))}
            </svg>
          </div>
        </Section>

        {/* 情绪走势折线 */}
        <Section
          title={t('settings.emotion.trend_title')}
          description={t('settings.emotion.trend_desc')}
        >
          {lineChart ? (
            <div className="p-2">
              <svg
                width="320"
                height="150"
                viewBox={`0 0 ${lineChart.w} ${lineChart.h}`}
                className="max-w-full"
              >
                {lineChart.gridY.map((g, i) => (
                  <g key={i}>
                    <line
                      x1={lineChart.padT - 4}
                      y1={g.y}
                      x2={lineChart.w - lineChart.padT}
                      y2={g.y}
                      stroke="#f3f4f6"
                      strokeWidth="1"
                    />
                    <text
                      x={lineChart.w - 4}
                      y={g.y + 3}
                      fontSize="8"
                      fill="#d1d5db"
                      textAnchor="end"
                    >
                      {g.label}
                    </text>
                  </g>
                ))}
                {lineChart.paths.map(
                  (p) =>
                    p && (
                      <path
                        key={p.key}
                        d={p.d}
                        fill="none"
                        stroke={LINE_COLORS[p.key]}
                        strokeWidth="1.5"
                      />
                    ),
                )}
              </svg>
              <div className="flex items-center justify-center gap-4 text-xs text-neutral-500">
                {(['pleasure', 'energy', 'anxiety'] as const).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: LINE_COLORS[s] }}
                    />
                    {DIM_LABELS[s]}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-neutral-400">
              {t('settings.emotion.no_trend')}
            </div>
          )}
        </Section>
      </div>

      {/* 九维进度条 */}
      <Section
        title={t('settings.emotion.dims_title')}
        description={t('settings.emotion.dims_desc')}
      >
        <div className="grid grid-cols-1 gap-x-8 gap-y-2.5 p-4 sm:grid-cols-2">
          {DIM_ORDER.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-xs text-neutral-500">{DIM_LABELS[key]}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-[var(--primary-400)] transition-all duration-500"
                  style={{ width: `${emotion?.dimensions[key] ?? 0}%` }}
                />
              </div>
              <span className="w-9 shrink-0 text-right text-xs text-neutral-400">
                {emotion ? Math.round(emotion.dimensions[key] ?? 0) : '—'}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* 最近情绪变化 */}
      <Section title={t('settings.emotion.recent')} description={t('settings.emotion.recent_desc')}>
        {emotion?.recent_history && emotion.recent_history.length > 0 ? (
          <ul className="divide-y divide-neutral-100">
            {emotion.recent_history.map((h, i) => {
              // 去掉 [desk-pet] 前缀，翻译剩余部分
              const rawTrigger = (h.trigger ?? '').replace(/^\[desk-pet\]\s*/, '');
              const triggerLabel = TRIGGER_LABELS[rawTrigger] ?? rawTrigger;
              // 相对时间
              const ago = h.timestamp ? formatAgo(h.timestamp) : '';
              return (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-neutral-700">{triggerLabel}</div>
                  {h.dimensions && Object.keys(h.dimensions).length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {Object.entries(h.dimensions).map(([d, v]) => (
                        <span
                          key={d}
                          className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500"
                        >
                          {DIM_LABELS[d] ?? d} {Math.round(Number(v))}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="shrink-0 text-xs text-neutral-300" title={h.timestamp?.slice(5, 16).replace('T', ' ') ?? ''}>
                  {ago}
                </span>
              </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-neutral-400">
            {t('settings.emotion.no_history')}
          </div>
        )}
      </Section>
    </div>
  );
}

export default EmotionPage;
