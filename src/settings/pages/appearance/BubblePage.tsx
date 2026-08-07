import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, SettingRow, SliderRow, Segmented } from '../../components';
import {
  readAppearance,
  writeAppearanceConfig,
  type BubbleTheme,
  type BubblePosition,
} from '../../appearanceConfig';

export function BubblePage() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState(() => readAppearance());

  const update = (patch: Parameters<typeof writeAppearanceConfig>[0]) => {
    setCfg((prev) => ({ ...prev, ...patch }));
    writeAppearanceConfig(patch);
  };

  const themeOptions: { value: BubbleTheme; label: string }[] = [
    { value: 'follow', label: t('settings.bubble.theme_follow') },
    { value: 'light', label: t('settings.bubble.theme_light') },
    { value: 'dark', label: t('settings.bubble.theme_dark') },
  ];
  const posOptions: { value: BubblePosition; label: string }[] = [
    { value: 'top', label: t('settings.bubble.pos_top') },
    { value: 'bottom', label: t('settings.bubble.pos_bottom') },
  ];

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section title={t('settings.bubble.style')} description={t('settings.bubble.style_desc')}>
        <SliderRow
          label={t('settings.bubble.font_size')}
          desc={t('settings.bubble.font_size_desc')}
          min={10}
          max={22}
          step={1}
          unit="px"
          value={cfg.bubbleFontSize}
          onChange={(v) => update({ bubbleFontSize: v })}
        />
        <SliderRow
          label={t('settings.bubble.radius')}
          desc={t('settings.bubble.radius_desc')}
          min={0}
          max={28}
          step={1}
          unit="px"
          value={cfg.bubbleRadius}
          onChange={(v) => update({ bubbleRadius: v })}
        />
        <SliderRow
          label={t('settings.bubble.duration')}
          desc={t('settings.bubble.duration_desc')}
          min={1500}
          max={10000}
          step={500}
          unit="ms"
          value={cfg.bubbleDuration}
          onChange={(v) => update({ bubbleDuration: v })}
        />
      </Section>

      <Section
        title={t('settings.bubble.appearance')}
        description={t('settings.bubble.appearance_desc')}
      >
        <div className="px-4 py-3">
          <SettingRow
            title={t('settings.bubble.color_theme')}
            description={t('settings.bubble.color_theme_desc')}
          >
            <Segmented
              options={themeOptions}
              value={cfg.bubbleTheme}
              onChange={(v) => update({ bubbleTheme: v })}
            />
          </SettingRow>
        </div>
        <div className="px-4 py-3 border-t border-neutral-100">
          <SettingRow
            title={t('settings.bubble.position')}
            description={t('settings.bubble.position_desc')}
          >
            <Segmented
              options={posOptions}
              value={cfg.bubblePosition}
              onChange={(v) => update({ bubblePosition: v })}
            />
          </SettingRow>
        </div>
      </Section>
    </div>
  );
}

export default BubblePage;
