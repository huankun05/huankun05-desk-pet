import { useMemo, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, Switch, useToast } from '../../components';
import { emit, listen } from '@tauri-apps/api/event';
import { isTauriEnv } from '../../../utils/tauriEnv';
import {
  MODEL_ASSETS,
  NAHIDA_EXTRA_EXPRESSIONS,
  EMOTION_TYPES,
  getDisabledVisuals,
  isVisualEnabled,
  setVisualEnabled,
  getBoundEmotion,
  setEmotionOverride,
  getVisualDisplayName,
  setVisualAlias,
} from '../../../services/live2d/visualMapping';
import type { EmotionType } from '../../../hooks/useEmotion';

type VisualRow = {
  name: string;
  synthetic: boolean;
  files?: string[];
};

const MODEL_LABELS: Record<string, string> = {
  nahida: '纳西妲',
  hiyori: '希奥莉',
};

const CURRENT_MODEL_KEY = 'desk-pet-current-model';

function visualKey(modelKey: string, name: string): string {
  return `${modelKey}:${name}`;
}

/**
 * 表情与动作管理页（角色 → 表情与动作）
 * - nahida：16 个烘焙表情（12 真实 + 4 合成），无身体动作
 * - hiyori：6 组身体动作，无表情
 * 复用 visualMapping.ts 的 MODEL_ASSETS 作为唯一真相源。
 *
 * 关键约束（用户要求）：只编辑「当前桌宠正在使用的模型」，避免误改另一模型的资产。
 * 活动模型从 localStorage['desk-pet-current-model'] 读取（跨 webview 共享）；
 * 另一模型整段置灰、仅可查看，不可编辑/预览。
 *
 * 每个视觉项都可在本页：
 *   - 改「显示名」（仅 UI 别名，底层资产名不变，零风险）
 *   - 改「绑定情绪」（持久化到 override，覆盖默认的 情绪→视觉 映射）
 *   - 启用/停用、跨窗预览
 * 预览通过 Tauri 跨窗事件把指令发到正在运行的桌宠主窗。
 */
export function ExpressionsPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();

  // 活动模型（= 当前桌宠所用模型）。localStorage 跨 webview 共享。
  const [activeModel, setActiveModel] = useState<string>(() => {
    try {
      return localStorage.getItem(CURRENT_MODEL_KEY) || 'nahida';
    } catch {
      return 'nahida';
    }
  });

  // 重新读取活动模型（桌宠侧切换后，回到本页/聚焦时同步）
  const refreshActiveModel = useCallback(() => {
    try {
      const id = localStorage.getItem(CURRENT_MODEL_KEY) || 'nahida';
      setActiveModel(id);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onFocus = () => refreshActiveModel();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshActiveModel]);

  // 停用状态（localStorage 持久化），用于驱动重新渲染
  const [disabled, setDisabled] = useState<Set<string>>(() => getDisabledVisuals());

  const refreshDisabled = () => setDisabled(getDisabledVisuals());

  // 预览链路状态：发送后等主窗 ack 回执；超时未到说明跨窗事件未送达
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

  const nahidaRows: VisualRow[] = useMemo(
    () =>
      [
        ...MODEL_ASSETS.nahida.expressions,
        ...NAHIDA_EXTRA_EXPRESSIONS.filter(
          (n) => !MODEL_ASSETS.nahida.expressions.includes(n),
        ),
      ].map((name) => ({
        name,
        synthetic: NAHIDA_EXTRA_EXPRESSIONS.includes(name),
      })),
    [],
  );

  const hiyoriRows: VisualRow[] = useMemo(
    () =>
      Object.entries(MODEL_ASSETS.hiyori.motionGroups).map(([group, files]) => ({
        name: group,
        synthetic: false,
        files,
      })),
    [],
  );

  // ===== 跨窗预览（modelKey 即行所属模型，必等于活动模型才启用） =====
  const previewExpression = async (name: string, modelKey: string) => {
    if (!isTauriEnv()) {
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
      await emit('deskpet:preview-expression', { expression: name, modelKey });
      showToast(t('settings.expressions.preview_sent'), 'success');
    } catch (err) {
      setPreviewStatus({ kind: 'timeout', text: `emit 抛异常：${String(err)}` });
    } finally {
      window.clearTimeout(timer);
    }
  };

  const previewMotion = async (groupName: string, modelKey: string) => {
    if (!isTauriEnv()) {
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
      await emit('deskpet:preview-motion', {
        name: groupName,
        modelKey,
        duration: 3000,
      });
      showToast(t('settings.expressions.preview_sent'), 'success');
    } catch (err) {
      setPreviewStatus({ kind: 'timeout', text: `emit 抛异常：${String(err)}` });
    } finally {
      window.clearTimeout(timer);
    }
  };

  const renderRow = (modelKey: 'nahida' | 'hiyori', row: VisualRow) => {
    const key = visualKey(modelKey, row.name);
    const enabled = !disabled.has(key);
    const isActive = modelKey === activeModel;
    const displayName = getVisualDisplayName(modelKey, row.name);
    const bound = getBoundEmotion(modelKey, row.name);

    const onPreview = () =>
      modelKey === 'nahida'
        ? previewExpression(row.name, modelKey)
        : previewMotion(row.name, modelKey);

    return (
      <div
        key={key}
        className={`flex flex-col gap-2 rounded-xl border p-3 transition-colors ${
          enabled ? 'border-neutral-200 bg-white' : 'border-neutral-200 bg-neutral-50'
        } ${!isActive ? 'opacity-50' : ''}`}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {/* 显示名（可编辑别名） */}
              <input
                type="text"
                value={displayName}
                disabled={!isActive}
                onChange={(e) => setVisualAlias(modelKey, row.name, e.target.value)}
                onBlur={(e) => {
                  // 清空则恢复原名
                  if (!e.target.value.trim()) setVisualAlias(modelKey, row.name, null);
                }}
                title={t('settings.expressions.alias_label')}
                className="min-w-0 max-w-[160px] truncate rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm font-medium text-neutral-800 outline-none focus:border-neutral-400 disabled:cursor-not-allowed disabled:bg-neutral-100"
              />
              {modelKey === 'nahida' && (
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    row.synthetic
                      ? 'bg-indigo-50 text-indigo-600'
                      : 'bg-neutral-100 text-neutral-500'
                  }`}
                >
                  {row.synthetic
                    ? t('settings.expressions.type_synthetic')
                    : t('settings.expressions.type_real')}
                </span>
              )}
              {displayName !== row.name && isActive && (
                <span className="shrink-0 truncate text-[10px] text-neutral-400">
                  ({row.name})
                </span>
              )}
            </div>
            {row.files && (
              <div className="mt-1 truncate text-[11px] text-neutral-400">
                {t('settings.expressions.files_count', { count: row.files.length })} ·{' '}
                {row.files.join(', ')}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onPreview}
            disabled={!isActive}
            title={t('settings.expressions.preview')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon icon="solar:play-circle-bold" className="text-lg" />
          </button>

          <Switch
            checked={enabled}
            disabled={!isActive}
            onChange={() => toggle(modelKey, row.name)}
            onClick={() => toggle(modelKey, row.name)}
          />
        </div>

        {/* 绑定情绪（可编辑） */}
        <div className="flex items-center gap-2 pl-0.5">
          <span className="shrink-0 text-[11px] text-neutral-400">
            {t('settings.expressions.bound_emotion_label')}:
          </span>
          <select
            value={bound ?? ''}
            disabled={!isActive}
            onChange={(e) =>
              setEmotionOverride(
                modelKey,
                row.name,
                (e.target.value || null) as EmotionType | null,
              )
            }
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] text-neutral-600 outline-none focus:border-neutral-400 disabled:cursor-not-allowed disabled:bg-neutral-100"
          >
            <option value="">{t('settings.expressions.bound_none')}</option>
            {EMOTION_TYPES.map((emo) => (
              <option key={emo} value={emo}>
                {emo}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 pb-12 animate-[fade-in-up_0.3s_ease-out]">
      {/* 活动模型提示条 */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
        <div className="flex items-center justify-between gap-2">
          <span>
            <span className="font-medium">
              {t('settings.expressions.active_model', {
                name: MODEL_LABELS[activeModel] ?? activeModel,
                model: activeModel,
              })}
            </span>
            <span className="ml-1 opacity-70">
              {t('settings.expressions.active_model_hint')}
            </span>
          </span>
          <button
            type="button"
            onClick={refreshActiveModel}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-blue-200 bg-white px-2 py-1 text-[11px] text-blue-600 transition-colors hover:bg-blue-50"
          >
            <Icon icon="solar:refresh-bold" className="text-sm" />
            {t('settings.expressions.refresh')}
          </button>
        </div>
      </div>

      {/* 预览链路状态 */}
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
        </div>
      )}

      <Section
        title={t('settings.expressions.nahida_title')}
        description={
          activeModel === 'nahida'
            ? t('settings.expressions.nahida_note')
            : t('settings.expressions.other_model_locked', { name: MODEL_LABELS.nahida })
        }
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
        description={
          activeModel === 'hiyori'
            ? t('settings.expressions.hiyori_note')
            : t('settings.expressions.other_model_locked', { name: MODEL_LABELS.hiyori })
        }
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
