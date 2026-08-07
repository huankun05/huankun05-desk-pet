import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, SettingRow, Switch } from '../../components';
import { readAppearance, writeAppearanceConfig } from '../../appearanceConfig';

export function DisplayPage() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState(() => readAppearance());

  const update = (patch: Parameters<typeof writeAppearanceConfig>[0]) => {
    setCfg((prev) => ({ ...prev, ...patch }));
    writeAppearanceConfig(patch);
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.display.character')}
        description={t('settings.display.character_desc')}
      >
        <SettingRow
          title={t('settings.display.mirror')}
          description={t('settings.display.mirror_desc')}
        >
          <Switch checked={cfg.mirror} onChange={() => update({ mirror: !cfg.mirror })} />
        </SettingRow>
        <SettingRow
          title={t('settings.display.visible')}
          description={t('settings.display.visible_desc')}
        >
          <Switch
            checked={cfg.petVisible}
            onChange={() => update({ petVisible: !cfg.petVisible })}
          />
        </SettingRow>
      </Section>
    </div>
  );
}

export default DisplayPage;
