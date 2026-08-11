import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, SettingRow, Switch, Segmented } from '../../components';
import { readAppearance, writeAppearanceConfig, FPS_TIERS } from '../../appearanceConfig';

export function PerformancePage() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState(() => readAppearance());

  const update = (patch: Parameters<typeof writeAppearanceConfig>[0]) => {
    setCfg((prev) => ({ ...prev, ...patch }));
    writeAppearanceConfig(patch);
  };

  // 档位由高到低，末尾追加「不限制」（跟随屏幕刷新率，高刷屏可超过 60）
  const fpsOptions: { value: number; label: string }[] = [
    ...FPS_TIERS.map((f) => ({ value: f as number, label: String(f) })),
    { value: 0, label: t('settings.performance.fps_unlimited') },
  ];

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.performance.fps_title')}
        description={t('settings.performance.fps_desc')}
      >
        <SettingRow
          title={t('settings.performance.target_fps')}
          description={t('settings.performance.target_fps_desc')}
        >
          <Segmented
            options={fpsOptions}
            value={cfg.targetFps}
            onChange={(v) => update({ targetFps: v })}
          />
        </SettingRow>
        <SettingRow
          title={t('settings.performance.adaptive_fps')}
          description={t('settings.performance.adaptive_fps_desc')}
        >
          <Switch
            checked={cfg.adaptiveFps}
            onChange={() => update({ adaptiveFps: !cfg.adaptiveFps })}
          />
        </SettingRow>
        <SettingRow
          title={t('settings.performance.show_fps')}
          description={t('settings.performance.show_fps_desc')}
        >
          <Switch checked={cfg.showFps} onChange={() => update({ showFps: !cfg.showFps })} />
        </SettingRow>
      </Section>

      <Section
        title={t('settings.performance.window_title')}
        description={t('settings.performance.window_desc')}
      >
        <SettingRow
          title={t('settings.performance.window_pos_memory')}
          description={t('settings.performance.window_pos_memory_desc')}
        >
          <Switch
            checked={cfg.windowPosMemory}
            onChange={() => update({ windowPosMemory: !cfg.windowPosMemory })}
          />
        </SettingRow>
        <SettingRow
          title={t('settings.performance.orb_pos_memory')}
          description={t('settings.performance.orb_pos_memory_desc')}
        >
          <Switch
            checked={cfg.orbPosMemory}
            onChange={() => update({ orbPosMemory: !cfg.orbPosMemory })}
          />
        </SettingRow>
      </Section>
    </div>
  );
}

export default PerformancePage;
