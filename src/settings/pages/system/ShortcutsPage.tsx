import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { invoke } from '@tauri-apps/api/core';
import { Section, Switch, useToast, useConfirm } from '../../components';
import { isTauriEnv } from '../../../utils/tauriEnv';

/** 快捷键配置（与 Rust 侧 ShortcutConfig 对应） */
interface ShortcutConfig {
  id: string;
  label: string;
  action: string;
  keys: string;
  enabled: boolean;
}

/** 将 KeyboardEvent 转换为快捷键字符串 */
function eventToShortcut(e: KeyboardEvent): string | null {
  // 忽略单独的修饰键按下
  const modifierKeys = ['Control', 'Shift', 'Alt', 'Meta'];
  if (modifierKeys.includes(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('Super');

  // 至少需要一个修饰键（避免单键冲突）
  if (parts.length === 0) return null;

  // 转换键名
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key === 'Enter') key = 'Enter';
  else if (key === 'Escape') key = 'Escape';
  else if (key === 'Tab') key = 'Tab';
  else if (key === 'Backspace') key = 'Backspace';
  else if (key === 'Delete') key = 'Delete';
  else if (key === 'ArrowUp') key = 'Up';
  else if (key === 'ArrowDown') key = 'Down';
  else if (key === 'ArrowLeft') key = 'Left';
  else if (key === 'ArrowRight') key = 'Right';
  else if (key.startsWith('F') && key.length <= 3) {
    // F1-F12 保持原样，无需转换
  } else if (key.length === 1) key = key.toUpperCase();
  else return null;

  parts.push(key);
  return parts.join('+');
}

export function ShortcutsPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [configs, setConfigs] = useState<ShortcutConfig[]>([]);
  const [loading, setLoading] = useState(() => !isTauriEnv());
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const recordingIdRef = useRef<string | null>(null);

  // 在 effect 中更新 ref，避免在 render 中修改 ref
  useEffect(() => {
    recordingIdRef.current = recordingId;
  }, [recordingId]);

  // 加载快捷键配置
  const loadConfigs = useCallback(async () => {
    try {
      const result = await invoke<ShortcutConfig[]>('get_shortcuts_config');
      setConfigs(result);
    } catch (err) {
      showToast(t('settings.shortcuts.load_failed') + ': ' + err, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    void (async () => {
      await loadConfigs();
    })();
  }, [loadConfigs]);

  // 按键录制：监听全局键盘事件
  useEffect(() => {
    if (!recordingId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Esc 取消录制
      if (e.key === 'Escape') {
        setRecordingId(null);
        return;
      }

      const shortcut = eventToShortcut(e);
      if (!shortcut) return;

      // 检测冲突（排除当前正在编辑的项）
      const conflict = configs.some(
        (c) =>
          c.id !== recordingIdRef.current &&
          c.enabled &&
          c.keys.toLowerCase() === shortcut.toLowerCase(),
      );
      if (conflict) {
        showToast(t('settings.shortcuts.conflict', { keys: shortcut }), 'warning');
        return;
      }

      // 更新配置
      setConfigs((prev) =>
        prev.map((c) => (c.id === recordingIdRef.current ? { ...c, keys: shortcut } : c)),
      );
      setRecordingId(null);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recordingId, configs, showToast, t]);

  const handleToggleEnabled = (id: string) => {
    setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke('save_shortcuts_config', { configs });
      showToast(t('settings.shortcuts.saved'), 'success');
    } catch (err) {
      showToast(t('settings.shortcuts.save_failed') + ': ' + err, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!(await confirm(t('settings.shortcuts.confirm_reset')))) return;
    setSaving(true);
    try {
      const defaults = await invoke<ShortcutConfig[]>('reset_shortcuts_config');
      setConfigs(defaults);
      showToast(t('settings.shortcuts.reset_done'), 'success');
    } catch (err) {
      showToast(t('settings.shortcuts.reset_failed') + ': ' + err, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center py-12 text-neutral-400 text-sm">
        <Icon icon="solar:restart-bold" className="animate-spin mr-2 text-base" />
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.shortcuts.section_title')}
        description={t('settings.shortcuts.section_desc')}
      >
        <div className="p-4">
          <div className="grid gap-2">
            {configs.map((config) => (
              <div
                key={config.id}
                className={`relative p-3 rounded-xl border transition-all ${
                  recordingId === config.id
                    ? 'border-[var(--primary-500)] bg-[var(--primary-50)]/50 ring-2 ring-[var(--primary-100)]'
                    : 'border-neutral-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        config.enabled
                          ? 'bg-[var(--primary-100)] text-[var(--primary-600)]'
                          : 'bg-neutral-100 text-neutral-400'
                      }`}
                    >
                      <Icon
                        icon={
                          config.id === 'lock'
                            ? 'solar:lock-keyhole-bold-duotone'
                            : config.id === 'voice'
                              ? 'solar:microphone-bold-duotone'
                              : 'solar:camera-bold-duotone'
                        }
                        className="text-lg"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-neutral-800 truncate">
                        {config.label}
                      </div>
                      <div className="text-xs text-neutral-400 mt-0.5">
                        {t('settings.shortcuts.action')}: {config.action}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* 快捷键显示/录制按钮 */}
                    <button
                      type="button"
                      onClick={() => setRecordingId(recordingId === config.id ? null : config.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all min-w-[100px] text-center ${
                        recordingId === config.id
                          ? 'bg-[var(--primary-500)] text-white animate-pulse'
                          : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                      }`}
                    >
                      {recordingId === config.id ? t('settings.shortcuts.recording') : config.keys}
                    </button>

                    {/* 启用开关 */}
                    <Switch
                      checked={config.enabled}
                      onChange={() => handleToggleEnabled(config.id)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* 操作按钮 */}
      <div className="flex gap-2 mt-4 px-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || recordingId !== null}
          className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-[var(--primary-500)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-600)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving && <Icon icon="solar:restart-bold" className="animate-spin text-base" />}
          {t('settings.shortcuts.save')}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon icon="solar:refresh-bold" className="text-base" />
          {t('settings.shortcuts.reset')}
        </button>
      </div>

      {/* 提示信息 */}
      <div className="mt-4 p-3 rounded-lg bg-neutral-50 border border-neutral-100">
        <div className="flex items-start gap-2">
          <Icon
            icon="solar:info-circle-bold-duotone"
            className="text-base text-neutral-400 shrink-0 mt-0.5"
          />
          <div className="text-xs text-neutral-500 leading-relaxed">
            {t('settings.shortcuts.tips')}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShortcutsPage;
