import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { invoke } from '@tauri-apps/api/core';
import { Section, SettingRow, useToast } from '../../components';

/** 格式化字节为可读字符串 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/** 自动清理周期选项（小时） */
const CLEANUP_OPTIONS: { value: number; labelKey: string }[] = [
  { value: 24, labelKey: 'settings.files.cleanup_24h' },
  { value: 168, labelKey: 'settings.files.cleanup_7d' },
  { value: 720, labelKey: 'settings.files.cleanup_30d' },
  { value: 0, labelKey: 'settings.files.cleanup_never' },
];

export function FileManagerPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [dataDir, setDataDir] = useState('');
  const [tempDir, setTempDir] = useState('');
  const [tempSize, setTempSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupPeriod, setCleanupPeriod] = useState(24);
  // 从 localStorage 同步清理周期配置
  useEffect(() => {
    const saved = localStorage.getItem('deskpet_temp_cleanup_period');
    if (saved) setCleanupPeriod(Number(saved));
  }, []); // 仅初始化读取一次

  const loadInfo = useCallback(async () => {
    try {
      const [dir, tmp, size] = await Promise.all([
        invoke<string>('get_project_data_dir'),
        invoke<string>('get_temp_dir_path'),
        invoke<number>('get_temp_size'),
      ]);
      setDataDir(dir);
      setTempDir(tmp);
      setTempSize(size);
    } catch (err) {
      showToast(t('settings.files.load_failed') + ': ' + err, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const deleted = await invoke<number>('cleanup_temp', { maxAgeHours: 0 });
      showToast(t('settings.files.cleanup_done', { count: deleted }), 'success');
      // 刷新大小
      const size = await invoke<number>('get_temp_size');
      setTempSize(size);
    } catch (err) {
      showToast(t('settings.files.cleanup_failed') + ': ' + err, 'error');
    } finally {
      setCleaning(false);
    }
  };

  const handlePeriodChange = (value: number) => {
    setCleanupPeriod(value);
    try {
      localStorage.setItem('deskpet_temp_cleanup_period', String(value));
    } catch {
      /* ignore */
    }
    showToast(t('settings.files.period_saved'), 'success');
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
      {/* 存储占用分析快捷入口（跨页跳转） */}
      <Section
        title={t('settings.files.storage_analysis')}
        description={t('settings.files.storage_analysis_desc')}
      >
        <div className="p-4">
          <button
            type="button"
            onClick={() => navigate('/settings/system/storage')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-50 border border-neutral-100 text-sm text-neutral-700 hover:bg-neutral-100 transition-colors"
          >
            <Icon icon="solar:box-bold-duotone" className="text-base text-[var(--primary-500)]" />
            {t('settings.files.storage_analysis')}
            <Icon icon="solar:alt-arrow-right-line-duotone" className="text-sm text-neutral-400" />
          </button>
        </div>
      </Section>

      {/* 数据目录 */}
      <Section
        title={t('settings.files.data_dir_title')}
        description={t('settings.files.data_dir_desc')}
      >
        <div className="p-4">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-neutral-50 border border-neutral-100">
            <Icon
              icon="solar:folder-bold-duotone"
              className="text-lg text-[var(--primary-500)] shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-neutral-400 mb-1">
                {t('settings.files.data_dir_label')}
              </div>
              <div className="text-sm font-mono text-neutral-700 truncate" title={dataDir}>
                {dataDir || t('settings.files.not_available')}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3 p-3 rounded-xl bg-neutral-50 border border-neutral-100">
            <Icon
              icon="solar:file-bold-duotone"
              className="text-lg text-[var(--primary-500)] shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-neutral-400 mb-1">
                {t('settings.files.temp_dir_label')}
              </div>
              <div className="text-sm font-mono text-neutral-700 truncate" title={tempDir}>
                {tempDir || t('settings.files.not_available')}
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* 临时文件管理 */}
      <Section title={t('settings.files.temp_title')} description={t('settings.files.temp_desc')}>
        <div className="p-4">
          <SettingRow
            title={t('settings.files.temp_size_label')}
            description={t('settings.files.temp_size_desc')}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-neutral-700 min-w-[80px] text-right">
                {formatBytes(tempSize)}
              </span>
              <button
                type="button"
                onClick={loadInfo}
                className="p-1.5 rounded-lg bg-neutral-100 text-neutral-500 hover:bg-neutral-200 transition-colors"
                title={t('settings.files.refresh')}
              >
                <Icon icon="solar:refresh-bold" className="text-sm" />
              </button>
            </div>
          </SettingRow>

          <SettingRow
            title={t('settings.files.cleanup_now_label')}
            description={t('settings.files.cleanup_now_desc')}
          >
            <button
              type="button"
              onClick={handleCleanup}
              disabled={cleaning || tempSize === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary-500)] text-white text-xs font-medium hover:bg-[var(--primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {cleaning && <Icon icon="solar:restart-bold" className="animate-spin text-sm" />}
              {t('settings.files.cleanup_button')}
            </button>
          </SettingRow>

          <SettingRow
            title={t('settings.files.cleanup_period_label')}
            description={t('settings.files.cleanup_period_desc')}
          >
            <select
              value={cleanupPeriod}
              onChange={(e) => handlePeriodChange(Number(e.target.value))}
              className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-700 focus:outline-none focus:border-[var(--primary-500)]"
            >
              {CLEANUP_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </SettingRow>
        </div>
      </Section>

      {/* 存储说明 */}
      <div className="mt-4 p-3 rounded-lg bg-neutral-50 border border-neutral-100">
        <div className="flex items-start gap-2">
          <Icon
            icon="solar:info-circle-bold-duotone"
            className="text-base text-neutral-400 shrink-0 mt-0.5"
          />
          <div className="text-xs text-neutral-500 leading-relaxed">
            {t('settings.files.storage_tip')}
          </div>
        </div>
      </div>
    </div>
  );
}

export default FileManagerPage;
