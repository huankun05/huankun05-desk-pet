import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from '@iconify/react';
import { Section, SettingRow, Switch, useToast, useConfirm } from '../../components';
import { backupConfigStorage } from '../../../services/backup/backupConfig';
import {
  listBackups,
  writeBackup,
  restoreBackup,
  resolveBackupDir,
} from '../../../services/backup/backupEngine';
import type { BackupConfig, BackupFrequency, BackupFile } from '../../../services/backup/types';
import { isTauriEnv } from '../../../utils/tauriEnv';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(ts: number): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return '';
  }
}

const FREQ_OPTIONS: { value: BackupFrequency; key: string }[] = [
  { value: 'startup', key: 'freq_startup' },
  { value: 'daily', key: 'freq_daily' },
  { value: 'weekly', key: 'freq_weekly' },
];

/**
 * 记忆体 → 备份与恢复：自动备份设置 + 手动备份 + 备份列表。
 */
export function BackupPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [cfg, setCfg] = useState<BackupConfig>(() => backupConfigStorage.get());
  const [resolvedDir, setResolvedDir] = useState<string>('');
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const update = useCallback(
    (patch: Partial<BackupConfig>) => {
      const next = { ...cfg, ...patch };
      setCfg(next);
      backupConfigStorage.set(next);
    },
    [cfg],
  );

  const loadBackups = useCallback(async () => {
    if (!isTauriEnv()) return;
    setLoading(true);
    try {
      const dir = await resolveBackupDir(cfg);
      setResolvedDir(dir);
      const list = await listBackups(dir);
      setBackups(list);
    } catch {
      setBackups([]);
    } finally {
      setLoading(false);
    }
  }, [cfg]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBackups();
  }, [loadBackups]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleBackupNow = async () => {
    if (!isTauriEnv()) {
      showMessage('error', t('settings.memory.backup.tauri_required'));
      return;
    }
    setBusy(true);
    try {
      const dir = await resolveBackupDir(cfg);
      await writeBackup(dir, cfg.keepCount);
      const updated = backupConfigStorage.get();
      backupConfigStorage.set({ ...updated, lastBackup: Date.now() });
      setCfg({ ...updated, lastBackup: Date.now() });
      showMessage('success', t('settings.memory.backup.success'));
      showToast(t('settings.memory.backup.success'), 'success');
      await loadBackups();
    } catch (e) {
      showMessage(
        'error',
        t('settings.memory.backup.failed', {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (file: BackupFile) => {
    const ok = await confirm({
      title: t('settings.memory.backup.restore'),
      message: t('settings.memory.backup.restore_confirm'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await restoreBackup(file.path);
      // 成功后页面会刷新
    } catch (e) {
      showMessage(
        'error',
        t('settings.memory.backup.restore_failed', {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  };

  const handleDelete = async (file: BackupFile) => {
    const ok = await confirm({
      title: t('settings.memory.backup.delete'),
      message: t('settings.memory.backup.delete_confirm'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await invoke('delete_file', { path: file.path });
      showMessage('success', t('settings.memory.backup.deleted'));
      await loadBackups();
    } catch (e) {
      showMessage(
        'error',
        t('settings.memory.backup.delete_failed', {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  };

  const handleOpenDir = async () => {
    try {
      const dir = resolvedDir || (await resolveBackupDir(cfg));
      await invoke('open_path', { path: dir }).catch(async () => {
        // 目录尚不存在时退而求其次打开项目数据目录
        const base = await invoke<string>('get_project_data_dir');
        await invoke('open_path', { path: base });
      });
    } catch (e) {
      showMessage(
        'error',
        t('settings.memory.backup.open_failed', {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 自动备份设置 */}
      <Section
        title={t('settings.memory.backup.auto_title')}
        description={t('settings.memory.backup.auto_desc')}
      >
        <div className="p-4 space-y-4">
          <SettingRow
            title={t('settings.memory.backup.auto_enable')}
            description={t('settings.memory.backup.auto_enable_desc')}
          >
            <Switch checked={cfg.enabled} onClick={() => update({ enabled: !cfg.enabled })} />
          </SettingRow>

          {cfg.enabled && (
            <>
              <SettingRow
                title={t('settings.memory.backup.frequency')}
                description={t('settings.memory.backup.frequency_desc')}
              >
                <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
                  {FREQ_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => update({ frequency: opt.value })}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        cfg.frequency === opt.value
                          ? 'bg-[var(--primary-500)] text-white'
                          : 'text-neutral-600 hover:bg-white'
                      }`}
                    >
                      {t(`settings.memory.backup.${opt.key}`)}
                    </button>
                  ))}
                </div>
              </SettingRow>

              <SettingRow
                title={t('settings.memory.backup.dir')}
                description={t('settings.memory.backup.dir_desc')}
              >
                <div className="flex items-center gap-2 w-full max-w-sm">
                  <input
                    type="text"
                    value={cfg.dir}
                    placeholder={t('settings.memory.backup.dir_placeholder')}
                    onChange={(e) => update({ dir: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-700"
                  />
                  <button
                    type="button"
                    onClick={handleOpenDir}
                    className="shrink-0 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50"
                  >
                    {t('settings.memory.backup.open_dir')}
                  </button>
                </div>
              </SettingRow>

              <SettingRow
                title={t('settings.memory.backup.keep')}
                description={t('settings.memory.backup.keep_desc')}
              >
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={cfg.keepCount}
                  onChange={(e) =>
                    update({ keepCount: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })
                  }
                  className="w-24 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-700"
                />
              </SettingRow>

              <p className="text-xs text-neutral-400">
                {t('settings.memory.backup.last_backup')}：
                {cfg.lastBackup
                  ? formatTimestamp(cfg.lastBackup)
                  : t('settings.memory.backup.last_never')}
              </p>
            </>
          )}
        </div>
      </Section>

      {/* 手动备份 */}
      <Section
        title={t('settings.memory.backup.manual_title')}
        description={t('settings.memory.backup.manual_desc')}
      >
        <div className="p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleBackupNow}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-600)] disabled:cursor-not-allowed disabled:bg-neutral-300"
            >
              {busy ? (
                <Icon icon="solar:restart-bold" className="text-base animate-spin" />
              ) : (
                <Icon icon="solar:add-square-bold-duotone" className="text-base" />
              )}
              {busy ? t('settings.memory.backup.backing_up') : t('settings.memory.backup.now')}
            </button>
            {resolvedDir && (
              <span className="text-xs text-neutral-400 break-all">{resolvedDir}</span>
            )}
          </div>

          {message && (
            <div
              className={`rounded-lg px-3 py-2 text-xs ${
                message.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
              }`}
            >
              {message.text}
            </div>
          )}
        </div>
      </Section>

      {/* 备份列表 */}
      <Section
        title={t('settings.memory.backup.list_title')}
        description={t('settings.memory.backup.list_desc')}
      >
        <div className="p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-neutral-700">
              {t('settings.memory.backup.list_count', { count: backups.length })}
            </div>
            <button
              type="button"
              onClick={() => void loadBackups()}
              disabled={loading}
              className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700"
            >
              <Icon
                icon="solar:refresh-bold-duotone"
                className={`text-base ${loading ? 'animate-spin' : ''}`}
              />
              {t('common.refresh')}
            </button>
          </div>

          {backups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-neutral-400">
              <Icon icon="solar:folder-bold-duotone" className="text-3xl mb-2" />
              <span className="text-xs">{t('settings.memory.backup.no_backups')}</span>
            </div>
          ) : (
            backups.map((file) => (
              <div
                key={file.name}
                className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-500 shrink-0">
                    <Icon icon="solar:archive-bold-duotone" className="text-lg" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-neutral-800">
                      {formatTimestamp(file.timestamp)}
                    </div>
                    <div className="text-xs text-neutral-500">{formatFileSize(file.size)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleRestore(file)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                    title={t('settings.memory.backup.restore')}
                  >
                    <Icon icon="solar:upload-square-bold-duotone" className="text-base" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(file)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-500"
                    title={t('common.delete')}
                  >
                    <Icon icon="solar:trash-bin-trash-bold-duotone" className="text-base" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Section>
    </div>
  );
}

export default BackupPage;
