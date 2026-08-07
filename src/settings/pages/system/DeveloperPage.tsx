import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Section, SettingRow, Switch, useToast } from '../../components';
import { readStorage, writeStorage } from '../../../hooks/useStorageEvent';
import { readAppearance, writeAppearanceConfig } from '../../appearanceConfig';
import { setLogLevel as setGlobalLogLevel } from '../../../utils/logger';

const DEBUG_KEY = 'desk-pet-debug-mode';
const LOG_LEVEL_KEY = 'desk-pet-log-level';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

/**
 * 系统 → 开发者
 */
export function DeveloperPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [debugMode, setDebugMode] = useState<boolean>(
    () => readStorage<string>(DEBUG_KEY, 'false') === 'true',
  );
  const [logLevel, setLogLevel] = useState<LogLevel>(() =>
    readStorage<LogLevel>(LOG_LEVEL_KEY, 'info'),
  );
  // FPS 开关与「外观 → 性能」页共用同一份外观配置，避免两处状态分裂
  const [showFps, setShowFps] = useState<boolean>(() => readAppearance().showFps);

  const toggleDebug = () => {
    const next = !debugMode;
    setDebugMode(next);
    writeStorage(DEBUG_KEY, String(next));
    // debug 模式开启时自动切换日志级别为 debug
    if (next) {
      setLogLevel('debug');
      writeStorage(LOG_LEVEL_KEY, 'debug');
      setGlobalLogLevel('debug');
    } else {
      setGlobalLogLevel(logLevel);
    }
    showToast(t('settings.preferences.saved'), 'success');
  };

  const handleLogLevelChange = (next: LogLevel) => {
    setLogLevel(next);
    writeStorage(LOG_LEVEL_KEY, next);
    setGlobalLogLevel(next);
    showToast(t('settings.preferences.saved'), 'success');
  };

  const toggleShowFps = () => {
    const next = !showFps;
    setShowFps(next);
    writeAppearanceConfig({ showFps: next });
    showToast(t('settings.preferences.saved'), 'success');
  };

  const handleOpenDevTools = async () => {
    try {
      await invoke('open_devtools');
    } catch {
      /* 非 Tauri 环境忽略 */
    }
  };

  return (
    <div className="animate-[fade-in-up_0.3s_ease-out]">
      <Section title={t('settings.dev.debug')} description={t('settings.dev.debug_desc')}>
        <SettingRow
          title={t('settings.dev.debug_mode')}
          description={t('settings.dev.debug_mode_desc')}
        >
          <Switch checked={debugMode} onChange={toggleDebug} />
        </SettingRow>
        <SettingRow
          title={t('settings.dev.log_level')}
          description={t('settings.dev.log_level_desc')}
        >
          <select
            value={logLevel}
            onChange={(e) => handleLogLevelChange(e.target.value as LogLevel)}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 transition-colors focus:border-[var(--primary-500)] focus:outline-none focus:ring-2 focus:ring-[color:var(--primary-500)]/20"
          >
            {LOG_LEVEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </SettingRow>
      </Section>

      <Section title={t('settings.dev.devtools')} description={t('settings.dev.devtools_desc')}>
        <SettingRow
          title={t('settings.dev.devtools')}
          description={t('settings.dev.devtools_desc')}
        >
          <button
            type="button"
            onClick={handleOpenDevTools}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            {t('settings.dev.open_devtools')}
          </button>
        </SettingRow>
        <SettingRow
          title={t('settings.dev.performance')}
          description={t('settings.dev.performance_desc')}
        >
          <Switch checked={showFps} onChange={toggleShowFps} />
        </SettingRow>
      </Section>
    </div>
  );
}

export default DeveloperPage;
