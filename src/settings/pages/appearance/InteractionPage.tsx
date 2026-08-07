import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, SettingRow, Switch } from '../../components';
import { readAppearance, writeAppearanceConfig } from '../../appearanceConfig';

function readEdgeSnap(): boolean {
  try {
    const saved = localStorage.getItem('deskpet_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed.edgeSnap ?? true;
    }
  } catch {
    /* ignore */
  }
  return true;
}

export function InteractionPage() {
  const { t } = useTranslation();
  const [edgeSnap, setEdgeSnap] = useState<boolean>(() => readEdgeSnap());
  const [cfg, setCfg] = useState(() => readAppearance());
  const opacity = cfg.fadeOpacity;

  const update = (patch: Parameters<typeof writeAppearanceConfig>[0]) => {
    setCfg((prev) => ({ ...prev, ...patch }));
    writeAppearanceConfig(patch);
  };

  // 通过外观配置写入，主窗监听 storage 事件后实时应用 --fade-opacity
  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (Number.isNaN(val)) return;
    update({ fadeOpacity: val });
  };

  const handleEdgeSnapChange = () => {
    const newValue = !edgeSnap;
    setEdgeSnap(newValue);
    try {
      const saved = localStorage.getItem('deskpet_settings');
      const parsed = saved ? JSON.parse(saved) : {};
      parsed.edgeSnap = newValue;
      localStorage.setItem('deskpet_settings', JSON.stringify(parsed));
    } catch {
      /* ignore */
    }
    try {
      import('@tauri-apps/api/event').then(({ emit }) => {
        emit('edge_snap_changed', newValue);
      });
    } catch {
      /* ignore */
    }
  };

  const percent = Math.round(opacity * 100);

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.interaction.edge_snap')}
        description={t('settings.interaction.edge_snap_desc')}
      >
        <SettingRow
          title={t('settings.interaction.edge_snap')}
          description={t('settings.interaction.edge_snap_desc')}
        >
          <Switch checked={edgeSnap} onChange={handleEdgeSnapChange} />
        </SettingRow>
      </Section>

      <Section
        title={t('settings.interaction.hover_fade')}
        description={t('settings.interaction.hover_fade_desc')}
      >
        <div className="px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
            <span>{t('settings.interaction.transparent')}</span>
            <span className="text-sm font-semibold text-neutral-800">{percent}%</span>
            <span>{t('settings.interaction.opaque')}</span>
          </div>

          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={opacity}
            onChange={handleOpacityChange}
            className="w-full h-2 cursor-pointer appearance-none rounded-full"
            style={{
              background: `linear-gradient(to right, #737373 ${percent}%, #e5e7eb ${percent}%)`,
            }}
          />

          <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500">
            <code className="text-neutral-700">--fade-opacity: {opacity.toFixed(2)}</code>
            <p className="mt-1">{t('settings.interaction.realtime_effect')}</p>
          </div>
        </div>
      </Section>

      <Section
        title={t('settings.interaction.feedback')}
        description={t('settings.interaction.feedback_desc')}
      >
        <SettingRow
          title={t('settings.interaction.click_feedback')}
          description={t('settings.interaction.click_feedback_desc')}
        >
          <Switch
            checked={cfg.clickFeedback}
            onChange={() => update({ clickFeedback: !cfg.clickFeedback })}
          />
        </SettingRow>
        <SettingRow
          title={t('settings.interaction.drag_enabled')}
          description={t('settings.interaction.drag_enabled_desc')}
        >
          <Switch
            checked={cfg.dragEnabled}
            onChange={() => update({ dragEnabled: !cfg.dragEnabled })}
          />
        </SettingRow>
      </Section>
    </div>
  );
}

export default InteractionPage;
