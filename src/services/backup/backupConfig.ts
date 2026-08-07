import { createStorage } from '../storage';
import { DEFAULT_BACKUP_CONFIG, type BackupConfig } from './types';

/**
 * 备份配置存储（落盘到 AppData，跨重启保留）。
 * 存放自动备份开关、频率、目录、滚动保留份数与上次备份时间。
 */
export const backupConfigStorage = createStorage<BackupConfig>(
  'backup_config',
  DEFAULT_BACKUP_CONFIG,
  { location: 'appdata' },
);
