import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Section, SettingRow, Switch, useToast } from '../../components';
import { writeStorage } from '../../../hooks/useStorageEvent';
import { settingsStorage } from '../../../services/storage/settingsStorage';
import { isTauriEnv } from '../../../utils/tauriEnv';
import i18n from '../../../i18n';

const LANG_KEY = 'desk_pet_lang';

type Lang = 'zh-CN' | 'en-US';
type CloseBehavior = 'exit' | 'minimize_to_tray';
type TrayLeftClick = 'show_menu' | 'show_window';

/**
 * 系统 → 通用
 */
export function GeneralPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [lang, setLang] = useState<Lang>(() => settingsStorage.get().lang as Lang);
  const [autoLaunch, setAutoLaunch] = useState<boolean>(() => settingsStorage.get().autolaunch);
  const [closeBehavior, setCloseBehavior] = useState<CloseBehavior>(
    () => settingsStorage.get().closeBehavior as CloseBehavior,
  );
  const [alwaysOnTop, setAlwaysOnTop] = useState<boolean>(() => settingsStorage.get().alwaysOnTop);
  const [settingsAlwaysOnTop, setSettingsAlwaysOnTop] = useState<boolean>(
    () => settingsStorage.get().settingsAlwaysOnTop,
  );
  const [trayLeftClick, setTrayLeftClick] = useState<TrayLeftClick>(
    () => settingsStorage.get().trayLeftClick as TrayLeftClick,
  );
  const [watchdogEnabled, setWatchdogEnabled] = useState<boolean>(
    () => settingsStorage.get().watchdogEnabled,
  );
  const [offlineMode, setOfflineMode] = useState<boolean>(() => settingsStorage.get().offlineMode);

  // 应用启动时从 Rust 侧同步开机自启状态（启动文件夹快捷方式是否存在）
  useEffect(() => {
    if (!isTauriEnv()) return;
    invoke<boolean>('is_autolaunch_enabled')
      .then((enabled) => {
        setAutoLaunch(enabled);
        settingsStorage.set({ autolaunch: enabled });
      })
      .catch(() => {});
  }, []);

  // Sync close behavior to Rust side
  useEffect(() => {
    if (!isTauriEnv()) return;
    invoke('set_close_behavior', { behavior: closeBehavior }).catch(() => {});
  }, [closeBehavior]);

  // Sync tray left click behavior to Rust side
  useEffect(() => {
    if (!isTauriEnv()) return;
    invoke('set_tray_left_click', { behavior: trayLeftClick }).catch(() => {});
  }, [trayLeftClick]);

  // 初始化时从持久化存储恢复全部设置，并应用设置窗口自身置顶
  useEffect(() => {
    if (!isTauriEnv()) return;
    settingsStorage.init().then(() => {
      const s = settingsStorage.get();
      setLang(s.lang as Lang);
      setAutoLaunch(s.autolaunch);
      setCloseBehavior(s.closeBehavior as CloseBehavior);
      setTrayLeftClick(s.trayLeftClick as TrayLeftClick);
      setWatchdogEnabled(s.watchdogEnabled);
      setOfflineMode(s.offlineMode);
      setAlwaysOnTop(s.alwaysOnTop);
      setSettingsAlwaysOnTop(s.settingsAlwaysOnTop);
      i18n.changeLanguage(s.lang);
      getCurrentWindow()
        .setAlwaysOnTop(s.settingsAlwaysOnTop)
        .catch(() => {});
    });
  }, []);

  const LANG_OPTIONS: { value: Lang; label: string }[] = [
    { value: 'zh-CN', label: t('common.lang_zh_cn') },
    { value: 'en-US', label: t('common.lang_en_us') },
  ];

  const CLOSE_BEHAVIOR_OPTIONS: { value: CloseBehavior; label: string }[] = [
    { value: 'minimize_to_tray', label: t('settings.system.minimize_to_tray') },
    { value: 'exit', label: t('settings.system.exit_app') },
  ];

  const TRAY_LEFT_CLICK_OPTIONS: { value: TrayLeftClick; label: string }[] = [
    { value: 'show_menu', label: t('settings.system.show_menu') },
    { value: 'show_window', label: t('settings.system.show_window') },
  ];

  const handleLangChange = (next: Lang) => {
    setLang(next);
    settingsStorage.set({ lang: next });
    writeStorage(LANG_KEY, next); // 供 i18n 的 lookupLocalStorage 同步（同 webview）
    i18n.changeLanguage(next);
  };

  const toggleAutoLaunch = async () => {
    const next = !autoLaunch;
    if (!isTauriEnv()) {
      setAutoLaunch(next);
      settingsStorage.set({ autolaunch: next });
      showToast(t('settings.preferences.saved'), 'success');
      return;
    }
    try {
      await invoke('set_autolaunch', { enabled: next });
      setAutoLaunch(next);
      settingsStorage.set({ autolaunch: next });
      showToast(t('settings.preferences.saved'), 'success');
    } catch (err) {
      showToast(t('settings.save_failed', { error: String(err) }), 'error');
    }
  };

  // 角色模型置顶：只作用于主窗口（Live2D 模型），与设置窗口置顶完全独立
  const toggleAlwaysOnTop = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    settingsStorage.set({ alwaysOnTop: next });
    if (isTauriEnv()) {
      try {
        await invoke('set_always_on_top', { enabled: next });
      } catch (err) {
        showToast(t('settings.save_failed', { error: String(err) }), 'error');
      }
    }
    showToast(t('settings.preferences.saved'), 'success');
  };

  // 设置窗口置顶：只作用于当前设置窗口，与角色模型置顶完全独立
  const toggleSettingsAlwaysOnTop = async () => {
    const next = !settingsAlwaysOnTop;
    setSettingsAlwaysOnTop(next);
    settingsStorage.set({ settingsAlwaysOnTop: next });
    if (isTauriEnv()) {
      try {
        await getCurrentWindow().setAlwaysOnTop(next);
      } catch (err) {
        showToast(t('settings.save_failed', { error: String(err) }), 'error');
      }
    }
    showToast(t('settings.preferences.saved'), 'success');
  };

  const handleTrayLeftClickChange = (next: TrayLeftClick) => {
    setTrayLeftClick(next);
    settingsStorage.set({ trayLeftClick: next });
    if (isTauriEnv()) invoke('set_tray_left_click', { behavior: next }).catch(() => {});
    showToast(t('settings.preferences.saved'), 'success');
  };

  const handleCloseBehaviorChange = (next: CloseBehavior) => {
    setCloseBehavior(next);
    settingsStorage.set({ closeBehavior: next });
    if (isTauriEnv()) invoke('set_close_behavior', { behavior: next }).catch(() => {});
    showToast(t('settings.preferences.saved'), 'success');
  };

  return (
    <div className="animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.system.language')}
        description={t('settings.system.language_desc')}
      >
        <SettingRow
          title={t('settings.system.interface_lang')}
          description={t('settings.system.interface_lang_desc')}
        >
          <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
            {LANG_OPTIONS.map((opt) => {
              const active = lang === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleLangChange(opt.value)}
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

      <Section
        title={t('settings.system.startup_and_close')}
        description={t('settings.system.startup_and_close_desc')}
      >
        <SettingRow
          title={t('settings.system.autolaunch')}
          description={t('settings.system.autolaunch_desc')}
        >
          <Switch checked={autoLaunch} onChange={toggleAutoLaunch} />
        </SettingRow>
        <SettingRow
          title={t('settings.system.close_behavior')}
          description={t('settings.system.close_behavior_desc')}
        >
          <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
            {CLOSE_BEHAVIOR_OPTIONS.map((opt) => {
              const active = closeBehavior === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleCloseBehaviorChange(opt.value)}
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

      <Section
        title={t('settings.system.window_and_tray')}
        description={t('settings.system.window_and_tray_desc')}
      >
        <SettingRow
          title={t('settings.system.always_on_top')}
          description={t('settings.system.always_on_top_desc')}
        >
          <Switch checked={alwaysOnTop} onChange={toggleAlwaysOnTop} />
        </SettingRow>
        <SettingRow
          title={t('settings.system.settings_always_on_top')}
          description={t('settings.system.settings_always_on_top_desc')}
        >
          <Switch checked={settingsAlwaysOnTop} onChange={toggleSettingsAlwaysOnTop} />
        </SettingRow>
        <SettingRow
          title={t('settings.system.tray_left_click')}
          description={t('settings.system.tray_left_click_desc')}
        >
          <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
            {TRAY_LEFT_CLICK_OPTIONS.map((opt) => {
              const active = trayLeftClick === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleTrayLeftClickChange(opt.value)}
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

      <Section
        title={t('settings.system.watchdog')}
        description={t('settings.system.watchdog_desc')}
      >
        <SettingRow
          title={t('settings.system.watchdog_enabled')}
          description={t('settings.system.watchdog_desc')}
        >
          <Switch
            checked={watchdogEnabled}
            onChange={() => {
              const next = !watchdogEnabled;
              setWatchdogEnabled(next);
              settingsStorage.set({ watchdogEnabled: next });
              // 服务监控实例运行在主窗口，这里只广播事件让主窗真正启停
              if (isTauriEnv()) emit('watchdog-toggle', next).catch(() => {});
              showToast(t('settings.preferences.saved'), 'success');
            }}
          />
        </SettingRow>
        <SettingRow
          title={t('settings.system.offline_mode')}
          description={t('settings.system.offline_mode_desc')}
        >
          <Switch
            checked={offlineMode}
            onChange={() => {
              const next = !offlineMode;
              setOfflineMode(next);
              settingsStorage.set({ offlineMode: next });
              // 通知主窗口实例刷新离线模式（跨 webview 独立）
              if (isTauriEnv()) emit('offline-toggle', next).catch(() => {});
              showToast(t('settings.preferences.saved'), 'success');
            }}
          />
        </SettingRow>
      </Section>
    </div>
  );
}

export default GeneralPage;
