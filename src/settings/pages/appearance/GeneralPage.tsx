import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, SettingRow } from '../../components';
import { SettingsJumpButton } from '../../components/SettingsJumpButton';
import {
  THEME_PRESETS,
  type ThemePreset,
  type ThemeMode,
  type CustomPreset,
  loadCustomPresets,
  addCustomPreset,
  deleteCustomPreset,
} from '../../../theme';
import { useTheme } from '../../../hooks/useTheme';

function presetColor(hue: number, sat: number): string {
  return `oklch(0.7542 ${sat} ${hue})`;
}

/**
 * 外观 → 通用：主题预设 + 明暗模式。
 */
export function GeneralPage() {
  const { t } = useTranslation();
  const { theme, setPreset, setMode, setAccentHue, setAccentSaturation, resetTheme } = useTheme();

  const [customPresets, setCustomPresets] = useState<CustomPreset[]>(() => loadCustomPresets());
  const [saveName, setSaveName] = useState('');

  const MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
    { value: 'light', label: t('settings.light') },
    { value: 'dark', label: t('settings.dark') },
    { value: 'system', label: t('settings.follow_system') },
  ];

  const isCustom = theme.preset === 'custom';

  const handleSaveCustom = () => {
    const name = saveName.trim();
    if (!name) return;
    const newPreset = addCustomPreset(name, theme.accentHue, theme.accentSaturation);
    setCustomPresets(loadCustomPresets());
    setSaveName('');
    // 切换到新保存的预设
    setAccentHue(newPreset.hue);
    setAccentSaturation(newPreset.saturation);
  };

  const handleDeleteCustom = (id: string) => {
    deleteCustomPreset(id);
    setCustomPresets(loadCustomPresets());
  };

  const handleApplyCustom = (cp: CustomPreset) => {
    setPreset('custom');
    // 需要先设 preset 再设 hue/sat，但 setPreset 会用 custom 的默认值
    // 所以用 setTimeout 确保 preset 先更新
    setTimeout(() => {
      setAccentHue(cp.hue);
      setAccentSaturation(cp.saturation);
    }, 0);
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 主题预设 */}
      <Section title={t('settings.theme')} description={t('settings.theme_desc')}>
        <div className="flex flex-wrap gap-2 p-4">
          {/* 内置预设 */}
          {(Object.keys(THEME_PRESETS) as ThemePreset[])
            .filter((p) => p !== 'custom')
            .map((preset) => {
              const active = theme.preset === preset && !isCustomActive(theme, customPresets);
              const p = THEME_PRESETS[preset];
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setPreset(preset)}
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-all ${
                    active
                      ? 'border-neutral-800 bg-neutral-50 text-neutral-900 shadow-sm'
                      : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50'
                  }`}
                >
                  <span
                    className="inline-block h-4 w-4 rounded-full border border-neutral-200"
                    style={{ backgroundColor: presetColor(p.hue, p.saturation) }}
                  />
                  <span>{p.name}</span>
                </button>
              );
            })}
        </div>

        {/* 用户保存的自定义预设 */}
        {customPresets.length > 0 && (
          <div className="px-4 pt-2 pb-4">
            <div className="mb-2 text-xs font-medium text-neutral-500">
              {t('settings.my_presets')}
            </div>
            <div className="flex flex-wrap gap-2">
              {customPresets.map((cp) => {
                const active =
                  isCustom &&
                  Math.abs(theme.accentHue - cp.hue) < 1 &&
                  Math.abs(theme.accentSaturation - cp.saturation) < 0.01;
                return (
                  <div
                    key={cp.id}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all ${
                      active
                        ? 'border-neutral-800 bg-neutral-50 text-neutral-900 shadow-sm'
                        : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleApplyCustom(cp)}
                      className="flex items-center gap-2"
                    >
                      <span
                        className="inline-block h-4 w-4 rounded-full border border-neutral-200"
                        style={{ backgroundColor: presetColor(cp.hue, cp.saturation) }}
                      />
                      <span>{cp.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCustom(cp.id)}
                      className="ml-1 text-neutral-400 hover:text-red-500"
                      title={t('common.delete')}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Section>

      {isCustom && (
        <Section title={t('settings.custom_color')} description={t('settings.custom_color_desc')}>
          <div className="space-y-4 p-4">
            <SettingRow
              title={t('settings.hue')}
              description={t('settings.current_value', {
                value: `${Math.round(theme.accentHue)}°`,
              })}
            >
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={theme.accentHue}
                onChange={(e) => setAccentHue(Number(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-full"
                style={{
                  background:
                    'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
                }}
              />
            </SettingRow>
            <SettingRow
              title={t('settings.saturation')}
              description={t('settings.current_value', {
                value: `${Math.round(theme.accentSaturation * 100)}%`,
              })}
            >
              <input
                type="range"
                min={0.02}
                max={0.5}
                step={0.01}
                value={theme.accentSaturation}
                onChange={(e) => setAccentSaturation(Number(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-neutral-200"
              />
            </SettingRow>
            <SettingRow title={t('settings.preview')} description={t('settings.preview_desc')}>
              <div className="flex items-center gap-3">
                <span
                  className="inline-block h-8 w-8 rounded-full border border-neutral-200"
                  style={{
                    backgroundColor: presetColor(theme.accentHue, theme.accentSaturation),
                  }}
                />
                <button
                  type="button"
                  onClick={resetTheme}
                  className="rounded-md border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
                >
                  {t('settings.reset')}
                </button>
              </div>
            </SettingRow>
            {/* 保存命名 */}
            <div className="flex items-center gap-2 pt-2">
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={t('settings.preset_name_placeholder')}
                maxLength={12}
                className="w-36 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveCustom();
                }}
              />
              <button
                type="button"
                onClick={handleSaveCustom}
                disabled={!saveName.trim()}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-40"
                style={{ backgroundColor: 'var(--primary-500)' }}
              >
                {t('settings.save')}
              </button>
            </div>
          </div>
        </Section>
      )}

      <Section
        title={t('settings.light_dark_mode')}
        description={t('settings.light_dark_mode_desc')}
      >
        <SettingRow title={t('settings.mode')} description={t('settings.mode_desc')}>
          <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
            {MODE_OPTIONS.map((opt) => {
              const active = theme.mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-white text-neutral-800 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-800'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </SettingRow>
      </Section>

      {/* 相关设置：气泡与字体样式在独立页面 */}
      <Section title={t('settings.related_settings')}>
        <div className="space-y-2 p-4">
          <SettingsJumpButton
            to="/settings/appearance/bubble"
            label={t('settings.appearance_section.bubble')}
            icon="solar:document-text-bold-duotone"
            hint={t('settings.related_bubble_hint')}
          />
          <SettingsJumpButton
            to="/settings/chat/appearance"
            label={t('settings.appearance_section.chat')}
            icon="solar:widget-4-bold-duotone"
            hint={t('settings.related_chat_hint', {
              defaultValue: '聊天窗口的头像、气泡、背景与字号',
            })}
          />
        </div>
      </Section>
    </div>
  );
}

/** 检查当前是否激活了某个自定义预设 */
function isCustomActive(
  theme: { preset: ThemePreset; accentHue: number; accentSaturation: number },
  customPresets: CustomPreset[],
): boolean {
  if (theme.preset !== 'custom') return false;
  return customPresets.some(
    (cp) =>
      Math.abs(theme.accentHue - cp.hue) < 1 &&
      Math.abs(theme.accentSaturation - cp.saturation) < 0.01,
  );
}

export default GeneralPage;
