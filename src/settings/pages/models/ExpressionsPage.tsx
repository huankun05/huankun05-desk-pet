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
  getEmotionBinding,
  setEmotionBinding,
  defaultVisualForEmotion,
  getVisualDisplayName,
  setVisualAlias,
} from '../../../services/live2d/visualMapping';

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

const ALL_MODELS = ['nahida', 'hiyori'] as const;

/**
 * 表情与动作管理页
 * - 顶部下拉栏选择要管理的角色；正在桌宠中使用的角色高亮（●），其它灰显（○ 未使用）。
 * - 情绪绑定方向为「情绪 → 表情/动作」：每种情绪配一个下拉，选它该播放的视觉项。
 * - 视觉列表：可改「显示名」（仅 UI 别名，零风险）、启用/停用、跨窗预览。
 * 预览通过 Tauri 跨窗事件发到正在运行的桌宠主窗，仅对「正在使用」的角色生效。
 */
export function ExpressionsPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();

  // 桌宠当前实际使用的模型（localStorage 跨 webview 共享）
  const [petModel, setPetModel] = useState<string>(() => {
    try {
      return localStorage.getItem(CURRENT_MODEL_KEY) || 'nahida';
    } catch {
      return 'nahida';
    }
  });
  // 本页下拉选中的、正在编辑的模型（可与 petModel 不同）
  const [selectedModel, setSelectedModel] = useState<string>(petModel);

  const refreshPet = useCallback(() => {
    try {
      setPetModel(localStorage.getItem(CURRENT_MODEL_KEY) || 'nahida');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onFocus = () => refreshPet();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshPet]);

  // 停用状态（localStorage 持久化），用于驱动重新渲染
  const [disabled, setDisabled] = useState<Set<string>>(() => getDisabledVisuals());
  const refreshDisabled = () => setDisabled(getDisabledVisuals());

  // 绑定/别名变更后强制重算派生数据
  const [rev, setRev] = useState(0);
  const bump = () => setRev((r) => r + 1);

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

  const isNahida = selectedModel === 'nahida';
  const previewEnabled = selectedModel === petModel; // 仅正在使用的角色可预览

  // 当前编辑模型的视觉项列表
  const visuals: VisualRow[] = useMemo(() => {
    if (isNahida) {
      return [
        ...MODEL_ASSETS.nahida.expressions,
        ...NAHIDA_EXTRA_EXPRESSIONS.filter(
          (n) => !MODEL_ASSETS.nahida.expressions.includes(n),
        ),
      ].map((name) => ({
        name,
        synthetic: NAHIDA_EXTRA_EXPRESSIONS.includes(name),
      }));
    }
    return Object.entries(MODEL_ASSETS.hiyori.motionGroups).map(([group, files]) => ({
      name: group,
      synthetic: false,
      files,
    }));
  }, [isNahida]);

  const availableVisuals = useMemo(() => visuals.map((v) => v.name), [visuals]);

  // 反向映射：某视觉项被哪些情绪使用（含默认与自定义绑定）——仅用于展示提示
  const visualToEmotions = useMemo(() => {
    const map: Record<string, string[]> = {};
    const mk = selectedModel as 'nahida' | 'hiyori';
    for (const emo of EMOTION_TYPES) {
      const b = getEmotionBinding(mk, emo);
      const v = b !== undefined ? b : defaultVisualForEmotion(mk, emo);
      if (!v) continue;
      (map[v] ||= []).push(emo);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel, rev]);

  const toggle = (modelKey: string, name: string) => {
    const enabled = isVisualEnabled(modelKey, name);
    setVisualEnabled(modelKey, name, !enabled);
    refreshDisabled();
  };

  // ===== 跨窗预览（modelKey 即选中的编辑模型） =====
  const previewExpression = async (name: string) => {
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
      await emit('deskpet:preview-expression', { expression: name, modelKey: selectedModel });
      showToast(t('settings.expressions.preview_sent'), 'success');
    } catch (err) {
      setPreviewStatus({ kind: 'timeout', text: `emit 抛异常：${String(err)}` });
    } finally {
      window.clearTimeout(timer);
    }
  };

  const previewMotion = async (groupName: string) => {
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
        modelKey: selectedModel,
        duration: 3000,
      });
      showToast(t('settings.expressions.preview_sent'), 'success');
    } catch (err) {
      setPreviewStatus({ kind: 'timeout', text: `emit 抛异常：${String(err)}` });
    } finally {
      window.clearTimeout(timer);
    }
  };

  // ===== 情绪 → 视觉 绑定 =====
  const onBindChange = (emo: string, value: string) => {
    const mk = selectedModel as 'nahida' | 'hiyori';
    const staticDefault = defaultVisualForEmotion(mk, emo);
    // 选回默认值即视为清除自定义绑定
    setEmotionBinding(mk, emo, value === staticDefault ? null : value);
    bump();
  };

  const renderVisualRow = (row: VisualRow) => {
    const key = `${selectedModel}:${row.name}`;
    const enabled = !disabled.has(key);
    const displayName = getVisualDisplayName(selectedModel, row.name);
    const usedBy = visualToEmotions[row.name] ?? [];

    const onPreview = () =>
      isNahida ? previewExpression(row.name) : previewMotion(row.name);

    return (
      <div
        key={key}
        className={`flex flex-col gap-2 rounded-xl border p-3 transition-colors ${
          enabled ? 'border-neutral-200 bg-white' : 'border-neutral-200 bg-neutral-50'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {/* 显示名（可编辑别名） */}
              <input
                type="text"
                value={displayName}
                onChange={(e) => {
                  setVisualAlias(selectedModel, row.name, e.target.value);
                  bump();
                }}
                onBlur={(e) => {
                  if (!e.target.value.trim()) setVisualAlias(selectedModel, row.name, null);
                }}
                title={t('settings.expressions.alias_label')}
                className="min-w-0 max-w-[160px] truncate rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm font-medium text-neutral-800 outline-none focus:border-neutral-400"
              />
              {isNahida && (
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
              {displayName !== row.name && (
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
            {usedBy.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <span className="shrink-0 text-[10px] text-neutral-400">
                  {t('settings.expressions.used_by')}:
                </span>
                {usedBy.map((emo) => (
                  <span
                    key={emo}
                    className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500"
                  >
                    {t(`settings.expressions.emotions.${emo}`)}
                  </span>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onPreview}
            disabled={!previewEnabled}
            title={
              previewEnabled
                ? t('settings.expressions.preview')
                : t('settings.expressions.preview_locked')
            }
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon icon="solar:play-circle-bold" className="text-lg" />
          </button>

          <Switch checked={enabled} onChange={() => toggle(selectedModel, row.name)} />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 pb-12 animate-[fade-in-up_0.3s_ease-out]">
      {/* 角色下拉选择栏 */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm font-medium text-blue-700">
              {t('settings.expressions.model_select')}:
            </span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none focus:border-blue-400"
            >
              {ALL_MODELS.map((id) => {
                const inUse = id === petModel;
                return (
                  <option
                    key={id}
                    value={id}
                    className={inUse ? 'font-medium text-blue-700' : 'text-neutral-400'}
                  >
                    {inUse ? '● ' : '○ '}
                    {MODEL_LABELS[id] ?? id}
                    {inUse
                      ? ` ${t('settings.expressions.model_in_use')}`
                      : ` ${t('settings.expressions.model_not_in_use')}`}
                  </option>
                );
              })}
            </select>
          </div>
          <button
            type="button"
            onClick={refreshPet}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-blue-200 bg-white px-2 py-1 text-[11px] text-blue-600 transition-colors hover:bg-blue-50"
          >
            <Icon icon="solar:refresh-bold" className="text-sm" />
            {t('settings.expressions.refresh')}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-blue-600/80">
          {t('settings.expressions.model_hint')}
        </p>
      </div>

      {/* 选中了未使用角色时的提示 */}
      {!previewEnabled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {t('settings.expressions.non_active_warning', {
            name: MODEL_LABELS[selectedModel] ?? selectedModel,
          })}
        </div>
      )}

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

      {/* 情绪 → 视觉 绑定（方向正确：情绪决定播放哪个动画） */}
      <Section
        title={t('settings.expressions.emotion_binding')}
        description={t('settings.expressions.emotion_binding_desc')}
      >
        <div className="flex flex-col gap-1.5 p-4">
          {EMOTION_TYPES.map((emo) => {
            const mk = selectedModel as 'nahida' | 'hiyori';
            const staticDefault = defaultVisualForEmotion(mk, emo);
            const b = getEmotionBinding(mk, emo);
            const value = b !== undefined ? b : staticDefault;
            return (
              <div key={emo} className="flex items-center gap-3 py-1">
                <span className="w-16 shrink-0 text-sm text-neutral-700">
                  {t(`settings.expressions.emotions.${emo}`)}
                </span>
                <span className="shrink-0 text-[11px] text-neutral-400">
                  {t('settings.expressions.bound_to')}:
                </span>
                <select
                  value={value}
                  onChange={(e) => onBindChange(emo, e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm text-neutral-700 outline-none focus:border-neutral-400"
                >
                  <option value="">
                    {isNahida
                      ? t('settings.expressions.visual_empty_nahida')
                      : t('settings.expressions.visual_empty_hiyori')}
                  </option>
                  {availableVisuals.map((name) => (
                    <option key={name} value={name}>
                      {getVisualDisplayName(selectedModel, name)}
                    </option>
                  ))}
                </select>
                {b !== undefined && (
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                    {t('settings.expressions.custom_badge')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* 视觉资产列表（重命名 / 启用 / 预览） */}
      <Section
        title={isNahida ? t('settings.expressions.nahida_title') : t('settings.expressions.hiyori_title')}
        description={
          isNahida
            ? t('settings.expressions.nahida_note')
            : t('settings.expressions.hiyori_note')
        }
      >
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="text-xs text-neutral-400">
            {isNahida
              ? t('settings.expressions.total_expressions', { count: visuals.length })
              : t('settings.expressions.total_motions', { count: visuals.length })}
          </span>
          <span className="text-[11px] text-neutral-400">
            {t('settings.expressions.preview_hint')}
          </span>
        </div>
        <div className="flex flex-col gap-2 p-4 pt-0">
          {visuals.map((row) => renderVisualRow(row))}
        </div>
      </Section>
    </div>
  );
}

export default ExpressionsPage;
