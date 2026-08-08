import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, useToast } from '../../components';
import { emit } from '@tauri-apps/api/event';
import { isTauriEnv } from '../../../utils/tauriEnv';
import {
  MODEL_ASSETS,
  NAHIDA_EXTRA_EXPRESSIONS,
  EMOTION_TYPES,
  getEmotionBinding,
  setEmotionBinding,
  defaultVisualForEmotion,
} from '../../../services/live2d/visualMapping';

const MODEL_LABELS: Record<string, string> = {
  nahida: '纳西妲',
  hiyori: '希奥莉',
};
const CURRENT_MODEL_KEY = 'desk-pet-current-model';
const ALL_MODELS = ['nahida', 'hiyori'] as const;

/** 每种情绪一个柔和点色，仅作 UI 质感 */
const EMOTION_COLORS: Record<string, string> = {
  idle: '#94a3b8',
  happy: '#fbbf24',
  sad: '#60a5fa',
  thinking: '#a78bfa',
  surprised: '#fb923c',
  talking: '#34d399',
  angry: '#f87171',
  shy: '#f472b6',
  excited: '#a3e635',
  curious: '#22d3ee',
  sleepy: '#818cf8',
};

/**
 * 表情与动作管理页
 * - 顶部下拉栏选择角色；正在桌宠中使用的角色高亮（●），其它灰显（○ 未使用）。
 * - 主体只有一件事：情绪 → 动画 绑定表（每种情绪选一个对应的表情/动作）。
 * - 每行右侧小按钮可预览「该情绪当前绑定的动画」，仅对正在使用的角色生效。
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

  const isNahida = selectedModel === 'nahida';
  const previewEnabled = selectedModel === petModel; // 仅正在使用的角色可预览

  // 该模型可用视觉项（用于下拉）
  const visualOptions = useMemo(() => {
    if (isNahida) {
      return [...MODEL_ASSETS.nahida.expressions, ...NAHIDA_EXTRA_EXPRESSIONS];
    }
    return Object.keys(MODEL_ASSETS.hiyori.motionGroups);
  }, [isNahida]);

  const onBindChange = (emo: string, value: string) => {
    const mk = selectedModel as 'nahida' | 'hiyori';
    // 选回「默认」即清除自定义绑定，回退静态表
    setEmotionBinding(mk, emo, value === '__inherit__' ? null : value);
  };

  const preview = async (emo: string) => {
    if (!isTauriEnv()) {
      showToast(t('settings.expressions.preview_need_pet'), 'warning');
      return;
    }
    const mk = selectedModel as 'nahida' | 'hiyori';
    const b = getEmotionBinding(mk, emo);
    const v = b !== undefined ? b : defaultVisualForEmotion(mk, emo);
    if (!v) {
      showToast(t('settings.expressions.preview_none'), 'warning');
      return;
    }
    try {
      if (mk === 'nahida') {
        await emit('deskpet:preview-expression', { expression: v, modelKey: mk });
      } else {
        await emit('deskpet:preview-motion', { name: v, modelKey: mk, duration: 3000 });
      }
      showToast(t('settings.expressions.preview_sent'), 'success');
    } catch (err) {
      showToast(`emit 失败：${String(err)}`, 'error');
    }
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

      {/* 情绪 → 动画 绑定（唯一主体，无重复列表区） */}
      <Section
        title={t('settings.expressions.emotion_binding')}
        description={t('settings.expressions.emotion_binding_desc')}
      >
        <div className="flex flex-col">
          {EMOTION_TYPES.map((emo, i) => {
            const mk = selectedModel as 'nahida' | 'hiyori';
            const b = getEmotionBinding(mk, emo);
            const value = b !== undefined ? b : '__inherit__';
            const defaultName = defaultVisualForEmotion(mk, emo) || '—';
            return (
              <div
                key={emo}
                className={`flex items-center gap-3 px-4 py-2.5 ${
                  i !== 0 ? 'border-t border-neutral-100' : ''
                } transition-colors hover:bg-neutral-50`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: EMOTION_COLORS[emo] ?? '#cbd5e1' }}
                />
                <div className="w-20 shrink-0">
                  <div className="text-sm font-medium text-neutral-800">
                    {t(`settings.expressions.emotions.${emo}`)}
                  </div>
                  <div className="text-[10px] text-neutral-400">{emo}</div>
                </div>
                <select
                  value={value}
                  onChange={(e) => onBindChange(emo, e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700 outline-none focus:border-neutral-400"
                >
                  <option value="__inherit__">
                    {t('settings.expressions.bind_inherit', { v: defaultName })}
                  </option>
                  {visualOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => preview(emo)}
                  disabled={!previewEnabled}
                  title={
                    previewEnabled
                      ? t('settings.expressions.preview')
                      : t('settings.expressions.preview_locked')
                  }
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 transition-colors hover:border-neutral-300 hover:bg-white hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon icon="solar:play-circle-bold" className="text-lg" />
                </button>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

export default ExpressionsPage;
