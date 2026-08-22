import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { invoke } from '@tauri-apps/api/core';
import { Section, SettingRow, Switch, useToast } from '../../components';
import { useStorageEvent, readStorage } from '../../../hooks/useStorageEvent';
import {
  readWakeWordConfig,
  writeWakeWordConfig,
  type WakeWordConfig,
} from '../../../hooks/useWakeWord';
import { isTauriEnv } from '../../../utils/tauriEnv';
import { VoskEngine } from '../../../services/wakeWord/voskEngine';

type ModelState = 'checking' | 'not-downloaded' | 'downloading' | 'downloaded' | 'error';

export function WakeWordPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [config, setConfig] = useState<WakeWordConfig>(() => readWakeWordConfig());
  const [modelState, setModelState] = useState<ModelState>('checking');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [modelSize, setModelSize] = useState(0);
  const [wakeState, setWakeState] = useState<string>(() =>
    readStorage<string>('deskpet_wakeWord', 'idle'),
  );

  // 监听唤醒词运行状态（由主窗口写入 localStorage）
  useStorageEvent(
    'deskpet_wakeWord',
    (newValue) => {
      setWakeState(newValue ?? 'idle');
    },
    [],
  );

  /** 检查模型状态 */
  const checkModel = useCallback(async () => {
    if (!isTauriEnv()) {
      setModelState('not-downloaded');
      return;
    }
    try {
      setModelState('checking');
      const exists = await VoskEngine.checkModel();
      if (exists) {
        const size = await invoke<number>('get_vosk_model_size');
        setModelSize(size);
        setModelState('downloaded');
      } else {
        setModelState('not-downloaded');
      }
    } catch {
      setModelState('error');
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await checkModel();
    })();
  }, [checkModel]);

  /** 更新配置并通知主窗口 */
  const updateConfig = (patch: Partial<WakeWordConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    writeWakeWordConfig(next);
  };

  /** 下载模型 */
  const handleDownload = async () => {
    setModelState('downloading');
    setDownloadProgress(0);
    try {
      await VoskEngine.downloadModel((downloaded, total) => {
        if (total > 0) {
          setDownloadProgress(Math.round((downloaded / total) * 100));
        }
      });
      setModelState('downloaded');
      const size = await invoke<number>('get_vosk_model_size');
      setModelSize(size);
      showToast(t('settings.wake_word.download_success'), 'success');
    } catch (err) {
      setModelState('error');
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`${t('settings.wake_word.download_failed')}: ${msg}`, 'error');
    }
  };

  /** 删除模型 */
  const handleDelete = async () => {
    try {
      await invoke('delete_vosk_model');
      setModelState('not-downloaded');
      setModelSize(0);
      // 如果当前已启用，自动关闭（模型没了无法监听）
      if (config.enabled) {
        updateConfig({ enabled: false });
      }
      showToast(t('settings.wake_word.delete_success'), 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`${t('settings.wake_word.delete_failed')}: ${msg}`, 'error');
    }
  };

  /** 切换启用开关 */
  const handleToggleEnabled = () => {
    if (!config.enabled && modelState !== 'downloaded') {
      showToast(t('settings.wake_word.enable_no_model'), 'warning');
      return;
    }
    updateConfig({ enabled: !config.enabled });
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
  };

  const stateLabel = (s: string): string => {
    switch (s) {
      case 'listening':
        return t('settings.wake_word.state_listening');
      case 'loading-model':
        return t('settings.wake_word.state_loading');
      case 'error':
        return t('settings.wake_word.state_error');
      default:
        return t('settings.wake_word.state_idle');
    }
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 基础配置 */}
      <Section
        title={t('settings.wake_word.basic_title')}
        description={t('settings.wake_word.basic_desc')}
      >
        <div className="p-4">
          <SettingRow
            title={t('settings.wake_word.enable_label')}
            description={t('settings.wake_word.enable_desc')}
          >
            <Switch checked={config.enabled} onChange={handleToggleEnabled} />
          </SettingRow>

          <SettingRow
            title={t('settings.wake_word.keyword_label')}
            description={t('settings.wake_word.keyword_desc')}
          >
            <input
              type="text"
              value={config.keyword}
              onChange={(e) => updateConfig({ keyword: e.target.value })}
              maxLength={10}
              className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-700 focus:outline-none focus:border-[var(--primary-500)] w-28 text-center"
              placeholder={t('settings.wake_word.keyword_placeholder')}
            />
          </SettingRow>
        </div>
      </Section>

      {/* 唤醒进阶配置 */}
      <Section
        title={t('settings.wake_word.advanced_title')}
        description={t('settings.wake_word.advanced_desc')}
      >
        <div className="p-4 flex flex-col gap-4">
          {/* 灵敏度三档 */}
          <SettingRow
            title={t('settings.wake_word.sensitivity_label')}
            description={t('settings.wake_word.sensitivity_desc')}
          >
            <div className="flex gap-1.5">
              {(['strict', 'standard', 'loose'] as const).map((lv) => (
                <button
                  key={lv}
                  onClick={() => updateConfig({ sensitivity: lv })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    config.sensitivity === lv
                      ? 'bg-[var(--primary-500)] text-white border-[var(--primary-500)]'
                      : 'bg-white text-neutral-500 border-neutral-200 hover:bg-neutral-50'
                  }`}
                >
                  {t(`settings.wake_word.sensitivity_${lv}`)}
                </button>
              ))}
            </div>
          </SettingRow>

          {/* 近音候选词 */}
          <SettingRow
            title={t('settings.wake_word.variants_label')}
            description={t('settings.wake_word.variants_desc')}
          >
            <div className="flex flex-col gap-2 w-64">
              <div className="flex flex-wrap gap-1.5">
                {config.variants.map((v, i) => (
                  <span
                    key={`${v}-${i}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-neutral-100 text-xs text-neutral-600"
                  >
                    {v}
                    <button
                      onClick={() =>
                        updateConfig({ variants: config.variants.filter((_, idx) => idx !== i) })
                      }
                      className="text-neutral-400 hover:text-red-500"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {config.variants.length === 0 && (
                  <span className="text-xs text-neutral-300">（无，严格模式仅认主词）</span>
                )}
              </div>
              <input
                type="text"
                placeholder={t('settings.wake_word.variants_placeholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val && !config.variants.includes(val)) {
                      updateConfig({ variants: [...config.variants, val] });
                    }
                    (e.target as HTMLInputElement).value = '';
                  }
                }}
                className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-700 focus:outline-none focus:border-[var(--primary-500)]"
              />
            </div>
          </SettingRow>

          {/* 唤醒回应语 */}
          <SettingRow
            title={t('settings.wake_word.responses_label')}
            description={t('settings.wake_word.responses_desc')}
          >
            <div className="flex flex-col gap-2 w-64">
              <div className="flex flex-wrap gap-1.5">
                {config.responses.map((r, i) => (
                  <span
                    key={`${r}-${i}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-neutral-100 text-xs text-neutral-600"
                  >
                    {r}
                    <button
                      onClick={() =>
                        updateConfig({ responses: config.responses.filter((_, idx) => idx !== i) })
                      }
                      className="text-neutral-400 hover:text-red-500"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                placeholder={t('settings.wake_word.responses_placeholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val && !config.responses.includes(val)) {
                      updateConfig({ responses: [...config.responses, val] });
                    }
                    (e.target as HTMLInputElement).value = '';
                  }
                }}
                className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-700 focus:outline-none focus:border-[var(--primary-500)]"
              />
            </div>
          </SettingRow>
        </div>
      </Section>

      {/* 运行状态 */}
      <Section
        title={t('settings.wake_word.status_title')}
        description={t('settings.wake_word.status_desc')}
      >
        <div className="p-4">
          <div className="flex items-center justify-between p-3 rounded-xl bg-neutral-50 border border-neutral-100">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  wakeState === 'listening'
                    ? 'bg-green-500 animate-pulse'
                    : wakeState === 'error'
                      ? 'bg-red-400'
                      : 'bg-neutral-300'
                }`}
              />
              <span className="text-sm font-medium text-neutral-700">{stateLabel(wakeState)}</span>
            </div>
            {config.enabled && wakeState === 'listening' && (
              <span className="text-xs text-neutral-400">
                {t('settings.wake_word.call_me_hint', { keyword: config.keyword })}
              </span>
            )}
          </div>
        </div>
      </Section>

      {/* 语音模型 */}
      <Section
        title={t('settings.wake_word.model_title')}
        description={t('settings.wake_word.model_desc')}
      >
        <div className="p-4">
          {modelState === 'checking' && (
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <Icon icon="solar:restart-bold" className="animate-spin text-base" />
              {t('common.loading')}
            </div>
          )}

          {modelState === 'not-downloaded' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2">
                <Icon
                  icon="solar:download-bold-duotone"
                  className="text-base text-[var(--primary-500)] shrink-0 mt-0.5"
                />
                <div className="text-xs text-neutral-500 leading-relaxed">
                  {t('settings.wake_word.model_not_downloaded')}
                </div>
              </div>
              <button
                onClick={handleDownload}
                className="px-4 py-2 rounded-lg bg-[var(--primary-500)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
              >
                {t('settings.wake_word.download_btn')}
              </button>
            </div>
          )}

          {modelState === 'downloading' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm text-neutral-600">
                <span className="flex items-center gap-2">
                  <Icon icon="solar:restart-bold" className="animate-spin text-base" />
                  {t('settings.wake_word.downloading')}
                </span>
                <span className="text-xs text-neutral-400">{downloadProgress}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-neutral-100 overflow-hidden">
                <div
                  className="h-full bg-[var(--primary-500)] transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </div>
          )}

          {modelState === 'downloaded' && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-neutral-600">
                <Icon icon="solar:check-circle-bold-duotone" className="text-base text-green-500" />
                <span>
                  {t('settings.wake_word.model_ready')} ({formatSize(modelSize)})
                </span>
              </div>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-500 hover:bg-neutral-50 hover:text-red-500 hover:border-red-200 transition-colors"
              >
                {t('settings.wake_word.delete_btn')}
              </button>
            </div>
          )}

          {modelState === 'error' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2">
                <Icon
                  icon="solar:danger-triangle-bold-duotone"
                  className="text-base text-red-400 shrink-0 mt-0.5"
                />
                <div className="text-xs text-red-500 leading-relaxed">
                  {t('settings.wake_word.model_error')}
                </div>
              </div>
              <button
                onClick={checkModel}
                className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors w-fit"
              >
                {t('settings.wake_word.retry_btn')}
              </button>
            </div>
          )}
        </div>
      </Section>

      {/* 使用说明 */}
      <div className="mt-4 p-3 rounded-lg bg-neutral-50 border border-neutral-100">
        <div className="flex items-start gap-2">
          <Icon
            icon="solar:info-circle-bold-duotone"
            className="text-base text-neutral-400 shrink-0 mt-0.5"
          />
          <div className="text-xs text-neutral-500 leading-relaxed">
            {t('settings.wake_word.tip', { keyword: config.keyword })}
            <div className="mt-1.5 pt-1.5 border-t border-neutral-100">
              {t('settings.wake_word.shortcut_hint', { keys: 'Ctrl+Space' })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WakeWordPage;
