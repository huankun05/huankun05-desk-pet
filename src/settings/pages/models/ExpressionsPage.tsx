import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, Switch, useToast } from '../../components';
import { emit, listen } from '@tauri-apps/api/event';
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

  // 预览链路状态（调试用）：发送后等主窗 ack 回执；超时未到说明跨窗事件未送达
  const [previewStatus, setPreviewStatus] = useState<{
    kind: 'idle' | 'sending' | 'ok' | 'filtered' | 'timeout';
    text?: string;
  }>({ kind: 'idle' });

  useEffect(() => {
    if (!isTauriEnv()) return;
    const off = listen<{
      ok: boolean;
      reason?: string;
      applied?: string;
      payloadModelKey?: string;
      myModelKey?: string;
    }>('deskpet:preview-ack', (e) => {
      console.log('[Preview] 收到主窗回执 ack：', e.payload);
      if (e.payload.ok) {
        setPreviewStatus({ kind: 'ok', text: `主窗已应用：${e.payload.applied}` });
      } else {
        setPreviewStatus({
          kind: 'filtered',
          text: `被主窗忽略（${e.payload.reason}）：payload.modelKey=${e.payload.payloadModelKey}，主窗=${e.payload.myModelKey}`,
        });
      }
    });
    return () => {
      off.then((fn) => fn());
    };
  }, []);

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
    console.log('[Preview] 点击预览表情：', name, 'modelKey=nahida');
    if (!isTauriEnv()) {
      console.warn('[Preview] 非 Tauri 环境，不发送');
      showToast(t('settings.expressions.preview_need_pet'), 'warning');
      return;
    }
    setPreviewStatus({ kind: 'sending' });
    const timer = window.setTimeout(() => {
      setPreviewStatus((prev) =>
        prev.kind === 'sending'
          ? { kind: 'timeout', text: '1.5s 内未收到主窗回执，跨窗事件链路可能未通' }
          : prev,
      );
    }, 1500);
    try {
      // 用全局 emit（而非 window.emit），事件才能跨 webview 送达主窗桌宠
      await emit('deskpet:preview-expression', {
        expression: name,
        modelKey: 'nahida',
      });
      console.log('[Preview] 已 emit deskpet:preview-expression：', { expression: name, modelKey: 'nahida' });
      showToast(t('settings.expressions.preview_sent'), 'success');
    } catch (err) {
      console.error('[Preview] emit 失败：', err);
      setPreviewStatus({ kind: 'timeout', text: `emit 抛异常：${String(err)}` });
    } finally {
      window.clearTimeout(timer);
    }
  };

  const previewMotion = async (groupName: string) => {
    console.log('[Preview] 点击预览动作：', groupName, 'modelKey=hiyori');
    if (!isTauriEnv()) {
      console.warn('[Preview] 非 Tauri 环境，不发送');
      showToast(t('settings.expressions.preview_need_pet'), 'warning');
      return;
    }
    setPreviewStatus({ kind: 'sending' });
    const timer = window.setTimeout(() => {
      setPreviewStatus((prev) =>
        prev.kind === 'sending'
          ? { kind: 'timeout', text: '1.5s 内未收到主窗回执，跨窗事件链路可能未通' }
          : prev,
      );
    }, 1500);
    try {
      // 用全局 emit（而非 window.emit），事件才能跨 webview 送达主窗桌宠
      await emit('deskpet:preview-motion', {
        name: groupName,
        modelKey: 'hiyori',
        duration: 3000,
      });
      console.log('[Preview] 已 emit deskpet:preview-motion：', { name: groupName, modelKey: 'hiyori' });
      showToast(t('settings.expressions.preview_sent'), 'success');
    } catch (err) {
      console.error('[Preview] emit 失败：', err);
      setPreviewStatus({ kind: 'timeout', text: `emit 抛异常：${String(err)}` });
    } finally {
      window.clearTimeout(timer);
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
      {/* 调试：预览链路状态（发送 → 主窗回执）。问题定位一目了然。 */}
      {previewStatus.kind !== 'idle' && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            previewStatus.kind === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : previewStatus.kind === 'sending'
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
          }`}
        >
          <span className="font-medium">预览链路：</span>
          {previewStatus.kind === 'sending' && '发送中…'}
          {previewStatus.kind === 'ok' && (previewStatus.text ?? '主窗已应用')}
          {previewStatus.kind === 'filtered' && (previewStatus.text ?? '被主窗忽略')}
          {previewStatus.kind === 'timeout' && (previewStatus.text ?? '超时未收到回执')}
          <span className="ml-2 text-[11px] opacity-60">（详见控制台日志）</span>
        </div>
      )}

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
