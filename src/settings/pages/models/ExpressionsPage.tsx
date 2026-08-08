import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, Switch, useToast } from '../../components';
import { emit } from '@tauri-apps/api/event';
import { isTauriEnv } from '../../../utils/tauriEnv';
import {
  MODEL_ASSETS,
  NAHIDA_EXTRA_EXPRESSIONS,
  EMOTION_TYPES,
  getEmotionBindings,
  setEmotionBinding,
  getVisualAliases,
  setVisualAlias,
  getDisabledVisuals,
  setVisualEnabled,
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

/** 从 localStorage 读取某模型下的三类用户覆盖（绑定 / 别名 / 停用） */
function loadModelState(mk: string) {
  const bindings: Record<string, string> = {};
  const allB = getEmotionBindings();
  for (const [k, v] of Object.entries(allB)) {
    if (k.startsWith(`${mk}:`)) bindings[k.slice(mk.length + 1)] = v;
  }
  const aliases: Record<string, string> = {};
  const allA = getVisualAliases();
  for (const [k, v] of Object.entries(allA)) {
    if (k.startsWith(`${mk}:`)) aliases[k.slice(mk.length + 1)] = v;
  }
  const disabled = new Set<string>();
  for (const key of getDisabledVisuals()) {
    const idx = key.indexOf(':');
    if (idx > 0 && key.slice(0, idx) === mk) disabled.add(key.slice(idx + 1));
  }
  return { bindings, aliases, disabled };
}

interface ModelEditorProps {
  modelKey: string;
  isNahida: boolean;
  previewEnabled: boolean;
  libOpen: boolean;
  setLibOpen: (v: boolean) => void;
}

/**
 * 单个模型的编辑区（绑定表 + 动作表情库）。
 * 由外层用 key={selectedModel} 驱动重挂载，切换角色即重新从 localStorage 初始化，
 * 保证「切换下拉后实时更新」。
 */
function ModelEditor({ modelKey, isNahida, previewEnabled, libOpen, setLibOpen }: ModelEditorProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const mk = modelKey as 'nahida' | 'hiyori';

  const [bindings, setBindings] = useState<Record<string, string>>(
    () => loadModelState(modelKey).bindings,
  );
  const [aliases, setAliases] = useState<Record<string, string>>(
    () => loadModelState(modelKey).aliases,
  );
  const [disabledSet, setDisabledSet] = useState<Set<string>>(
    () => loadModelState(modelKey).disabled,
  );

  const allItems = useMemo(() => {
    if (isNahida) {
      return [...MODEL_ASSETS.nahida.expressions, ...NAHIDA_EXTRA_EXPRESSIONS];
    }
    return Object.keys(MODEL_ASSETS.hiyori.motionGroups);
  }, [isNahida]);

  // 绑定下拉只列出「已启用」的项（被停用的不出现）
  const enabledItems = useMemo(
    () => allItems.filter((n) => !disabledSet.has(n)),
    [allItems, disabledSet],
  );

  const displayName = useCallback(
    (name: string) => aliases[name]?.trim() || name,
    [aliases],
  );

  const onBindChange = (emo: string, value: string) => {
    const next = value === '__inherit__' ? null : value;
    setBindings((prev) => {
      const copy = { ...prev };
      if (next === null) delete copy[emo];
      else copy[emo] = next;
      return copy;
    });
    setEmotionBinding(mk, emo, next);
  };

  const onRename = (name: string, value: string) => {
    setAliases((prev) => {
      const copy = { ...prev };
      if (value.trim()) copy[name] = value.trim();
      else delete copy[name];
      return copy;
    });
    setVisualAlias(mk, name, value);
  };

  const onToggleEnabled = (name: string, enabled: boolean) => {
    setDisabledSet((prev) => {
      const copy = new Set(prev);
      if (enabled) copy.delete(name);
      else copy.add(name);
      return copy;
    });
    setVisualEnabled(mk, name, enabled);
  };

  const previewVisual = async (name: string) => {
    if (!isTauriEnv()) {
      showToast(t('settings.expressions.preview_need_pet'), 'warning');
      return;
    }
    try {
      if (isNahida) {
        await emit('deskpet:preview-expression', { expression: name, modelKey: mk });
      } else {
        await emit('deskpet:preview-motion', { name, modelKey: mk, duration: 3000 });
      }
      showToast(t('settings.expressions.preview_sent'), 'success');
    } catch (err) {
      showToast(`emit 失败：${String(err)}`, 'error');
    }
  };

  const previewEmotion = async (emo: string) => {
    if (!isTauriEnv()) {
      showToast(t('settings.expressions.preview_need_pet'), 'warning');
      return;
    }
    const v = bindings[emo] ?? defaultVisualForEmotion(mk, emo);
    if (!v) {
      showToast(t('settings.expressions.preview_none'), 'warning');
      return;
    }
    try {
      if (isNahida) {
        await emit('deskpet:preview-expression', { expression: v, modelKey: mk });
      } else {
        await emit('deskpet:preview-motion', { name: v, modelKey: mk, duration: 3000 });
      }
      showToast(t('settings.expressions.preview_sent'), 'success');
    } catch (err) {
      showToast(`emit 失败：${String(err)}`, 'error');
    }
  };

  const enabledCount = allItems.filter((n) => !disabledSet.has(n)).length;

  return (
    <>
      {/* 情绪 → 动画 绑定（主体） */}
      <Section
        title={t('settings.expressions.emotion_binding')}
        description={t('settings.expressions.emotion_binding_desc')}
      >
        <div className="flex flex-col">
          {EMOTION_TYPES.map((emo, i) => {
            const value = bindings[emo] !== undefined ? bindings[emo] : '__inherit__';
            const defaultName = displayName(defaultVisualForEmotion(mk, emo) || '');
            // 若当前绑定项被停用而下拉里已过滤掉，则临时补回，避免 select 破绽
            const extra =
              value !== '__inherit__' && !enabledItems.includes(value) ? [value] : [];
            return (
              <div
                key={emo}
                className={`flex items-center gap-3 px-5 py-3 ${
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
                  className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 outline-none transition-colors focus:border-neutral-400"
                >
                  <option value="__inherit__">
                    {t('settings.expressions.bind_inherit', { v: defaultName || '—' })}
                  </option>
                  {[...enabledItems, ...extra].map((name) => (
                    <option key={name} value={name}>
                      {displayName(name)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => previewEmotion(emo)}
                  disabled={!previewEnabled}
                  title={
                    previewEnabled
                      ? t('settings.expressions.preview')
                      : t('settings.expressions.preview_locked')
                  }
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-neutral-200 text-neutral-500 transition-colors hover:border-neutral-300 hover:bg-white hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon icon="solar:play-circle-bold" className="text-lg" />
                </button>
              </div>
            );
          })}
        </div>
      </Section>

      {/* 动作表情库（默认收起） */}
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <button
          type="button"
          onClick={() => setLibOpen(!libOpen)}
          className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-neutral-50"
        >
          <div className="flex items-center gap-2">
            <Icon
              icon={libOpen ? 'solar:alt-arrow-up-bold' : 'solar:alt-arrow-down-bold'}
              className="text-base text-neutral-400"
            />
            <span className="text-sm font-semibold text-neutral-700">
              {t('settings.expressions.library_title')}
            </span>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
              {t('settings.expressions.library_count', {
                count: enabledCount,
                total: allItems.length,
              })}
            </span>
          </div>
          <span className="text-[11px] text-neutral-400">
            {t('settings.expressions.library_hint')}
          </span>
        </button>
        {libOpen && (
          <div className="border-t border-neutral-100">
            <p className="px-5 pt-3 text-xs leading-relaxed text-neutral-400">
              {t('settings.expressions.library_desc')}
            </p>
            <div className="flex flex-col pb-2">
              {allItems.map((name, i) => {
                const enabled = !disabledSet.has(name);
                const isBase = name === 'Default';
                return (
                  <div
                    key={name}
                    className={`flex items-center gap-3 px-5 py-3 ${
                      i !== 0 ? 'border-t border-neutral-100' : ''
                    } transition-colors hover:bg-neutral-50`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: enabled ? '#34d399' : '#cbd5e1' }}
                    />
                    <input
                      value={aliases[name] ?? ''}
                      placeholder={name}
                      onChange={(e) => onRename(name, e.target.value)}
                      className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 outline-none transition-colors focus:border-neutral-400"
                    />
                    {isBase ? (
                      <span className="w-14 shrink-0 text-right text-[11px] text-neutral-400">
                        {t('settings.expressions.base_state')}
                      </span>
                    ) : (
                      <div className="flex w-14 shrink-0 items-center justify-end">
                        <Switch
                          checked={enabled}
                          onChange={() => onToggleEnabled(name, !enabled)}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => previewVisual(name)}
                      disabled={!previewEnabled}
                      title={
                        previewEnabled
                          ? t('settings.expressions.preview')
                          : t('settings.expressions.preview_locked')
                      }
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-neutral-200 text-neutral-500 transition-colors hover:border-neutral-300 hover:bg-white hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Icon icon="solar:play-circle-bold" className="text-lg" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * 表情与动作管理页
 * - 顶部角色下拉选择栏（与其它设置页一致的白色卡片）。
 * - 主体：情绪 → 动画 绑定表（每种情绪选一个对应的表情/动作）。
 * - 可折叠「动作表情库」（默认收起）：列出该角色全部表情/动作，可改名、启用/停用、预览；
 *   被停用的不会出现在上方绑定下拉里。
 * - 切换角色下拉 → 通过 key 重挂载 ModelEditor，实时重载该模型的全部覆盖。
 */
export function ExpressionsPage() {
  const { t } = useTranslation();

  const [petModel, setPetModel] = useState<string>(() => {
    try {
      return localStorage.getItem(CURRENT_MODEL_KEY) || 'nahida';
    } catch {
      return 'nahida';
    }
  });
  const [selectedModel, setSelectedModel] = useState<string>(petModel);
  const [libOpen, setLibOpen] = useState(false);

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

  const previewEnabled = selectedModel === petModel;

  return (
    <div className="flex flex-col gap-5 pb-12 animate-[fade-in-up_0.3s_ease-out]">
      {/* 角色选择卡片（与其它页一致的白色卡片） */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-neutral-700">
              {t('settings.expressions.model_select')}
            </span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 outline-none transition-colors focus:border-neutral-400"
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
            className="flex shrink-0 items-center gap-1 rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 transition-colors hover:bg-neutral-50"
          >
            <Icon icon="solar:refresh-bold" className="text-sm" />
            {t('settings.expressions.refresh')}
          </button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-neutral-400">
          {t('settings.expressions.model_hint')}
        </p>
      </div>

      {/* 选中了未使用角色时的提示 */}
      {!previewEnabled && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-700">
          {t('settings.expressions.non_active_warning', {
            name: MODEL_LABELS[selectedModel] ?? selectedModel,
          })}
        </div>
      )}

      <ModelEditor
        key={selectedModel}
        modelKey={selectedModel}
        isNahida={selectedModel === 'nahida'}
        previewEnabled={previewEnabled}
        libOpen={libOpen}
        setLibOpen={setLibOpen}
      />
    </div>
  );
}

export default ExpressionsPage;
