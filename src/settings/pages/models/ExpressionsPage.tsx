import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, Switch, useToast } from '../../components';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriEnv } from '../../../utils/tauriEnv';
import {
  MODEL_ASSETS,
  NAHIDA_EXTRA_EXPRESSIONS,
  NAHIDA_EMOTION_EXPRESSION,
  HIYORI_EMOTION_MOTION,
  getDisabledVisuals,
  isVisualEnabled,
  setVisualEnabled,
} from '../../../services/live2d/visualMapping';

type VisualRow = {
  name: string;
  synthetic: boolean;
  emotions: string[];
  files?: string[];
};

function visualKey(modelKey: string, name: string): string {
  return `${modelKey}:${name}`;
}

/**
 * 表情与动作管理页（角色 → 表情与动作）
 * - nahida：16 个烘焙表情（12 真实 + 4 合成），无身体动作
 * - hiyori：6 组身体动作，无表情
 * 复用 visualMapping.ts 的 MODEL_ASSETS / 情绪映射作为唯一真相源。
 * 预览通过 Tauri 跨窗事件把指令发到正在运行的桌宠主窗。
 */
export function ExpressionsPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();

  // 停用状态（localStorage 持久化），用于驱动重新渲染
  const [disabled, setDisabled] = useState<Set<string>>(() => getDisabledVisuals());

  const refreshDisabled = () => setDisabled(getDisabledVisuals());

  const toggle = (modelKey: string, name: string) => {
    const enabled = isVisualEnabled(modelKey, name);
    setVisualEnabled(modelKey, name, !enabled);
    refreshDisabled();
  };

  // ===== 反向映射：表情/动作名 → 关联情绪 =====
  const nahidaEmotionByExpr = useMemo(() => {
    const map: Record<string, string[]> = {};
    (Object.entries(NAHIDA_EMOTION_EXPRESSION) as [string, string | null][]).forEach(
      ([emo, expr]) => {
        if (expr && expr !== '') {
          if (!map[expr]) map[expr] = [];
          map[expr].push(emo);
        }
      },
    );
    return map;
  }, []);

  const hiyoriEmotionByGroup = useMemo(() => {
    const map: Record<string, string[]> = {};
    (Object.entries(HIYORI_EMOTION_MOTION) as [string, string | null][]).forEach(
      ([emo, group]) => {
        if (group) {
          if (!map[group]) map[group] = [];
          map[group].push(emo);
        }
      },
    );
    return map;
  }, []);

  const nahidaRows: VisualRow[] = useMemo(() => {
    const names = [
      ...MODEL_ASSETS.nahida.expressions,
      ...NAHIDA_EXTRA_EXPRESSIONS.filter((n) => !MODEL_ASSETS.nahida.expressions.includes(n)),
    ];
    return names.map((name) => ({
      name,
      synthetic: NAHIDA_EXTRA_EXPRESSIONS.includes(name),
      emotions: nahidaEmotionByExpr[name] ?? [],
    }));
  }, [nahidaEmotionByExpr]);

  const hiyoriRows: VisualRow[] = useMemo(
    () =>
      Object.entries(MODEL_ASSETS.hiyori.motionGroups).map(([group, files]) => ({
        name: group,
        synthetic: false,
        emotions: hiyoriEmotionByGroup[group] ?? [],
        files,
      })),
    [hiyoriEmotionByGroup],
  );

  // ===== 跨窗预览 =====
  const previewExpression = async (name: string) => {
    if (!isTauriEnv()) {
      showToast(t('settings.expressions.preview_need_pet'), 'warning');
      return;
    }
    try {
      await getCurrentWindow().emit('deskpet:preview-expression', {
        expression: name,
        modelKey: 'nahida',
      });
      showToast(t('settings.expressions.preview_sent'), 'success');
    } catch {
      showToast(t('settings.expressions.preview_failed'), 'error');
    }
  };

  const previewMotion = async (groupName: string) => {
    if (!isTauriEnv()) {
      showToast(t('settings.expressions.preview_need_pet'), 'warning');
      return;
    }
    try {
      await getCurrentWindow().emit('deskpet:preview-motion', {
        name: groupName,
        modelKey: 'hiyori',
        duration: 3000,
      });
      showToast(t('settings.expressions.preview_sent'), 'success');
    } catch {
      showToast(t('settings.expressions.preview_failed'), 'error');
    }
  };

  const renderRow = (modelKey: 'nahida' | 'hiyori', row: VisualRow) => {
    const key = visualKey(modelKey, row.name);
    const enabled = !disabled.has(key);
    const onPreview = modelKey === 'nahida'
      ? () => previewExpression(row.name)
      : () => previewMotion(row.name);
    return (
      <div
        key={key}
        className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
          enabled ? 'border-neutral-200 bg-white' : 'border-neutral-200 bg-neutral-50 opacity-60'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-neutral-800">{row.name}</span>
            {modelKey === 'nahida' && (
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  row.synthetic
                    ? 'bg-indigo-50 text-indigo-600'
                    : 'bg-neutral-100 text-neutral-500'
                }`}
              >
                {row.synthetic ? t('settings.expressions.type_synthetic') : t('settings.expressions.type_real')}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-neutral-400">
              {t('settings.expressions.mapped_emotions')}:
            </span>
            {row.emotions.length === 0 ? (
              <span className="text-[11px] text-neutral-300">{t('settings.expressions.none')}</span>
            ) : (
              row.emotions.map((emo) => (
                <span
                  key={emo}
                  className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500"
                >
                  {emo}
                </span>
              ))
            )}
          </div>
          {row.files && (
            <div className="mt-1 truncate text-[11px] text-neutral-400">
              {t('settings.expressions.files_count', { count: row.files.length })} · {row.files.join(', ')}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onPreview}
          title={t('settings.expressions.preview')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-800"
        >
          <Icon icon="solar:play-circle-bold" className="text-lg" />
        </button>

        <Switch
          checked={enabled}
          onChange={() => toggle(modelKey, row.name)}
          onClick={() => toggle(modelKey, row.name)}
        />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 pb-12 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.expressions.nahida_title')}
        description={t('settings.expressions.nahida_note')}
      >
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="text-xs text-neutral-400">
            {t('settings.expressions.total_expressions', { count: nahidaRows.length })}
          </span>
          <span className="text-[11px] text-neutral-400">
            {t('settings.expressions.preview_hint')}
          </span>
        </div>
        <div className="flex flex-col gap-2 p-4 pt-0">
          {nahidaRows.map((row) => renderRow('nahida', row))}
        </div>
      </Section>

      <Section
        title={t('settings.expressions.hiyori_title')}
        description={t('settings.expressions.hiyori_note')}
      >
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="text-xs text-neutral-400">
            {t('settings.expressions.total_motions', { count: hiyoriRows.length })}
          </span>
          <span className="text-[11px] text-neutral-400">
            {t('settings.expressions.preview_hint')}
          </span>
        </div>
        <div className="flex flex-col gap-2 p-4 pt-0">
          {hiyoriRows.map((row) => renderRow('hiyori', row))}
        </div>
      </Section>
    </div>
  );
}

export default ExpressionsPage;
