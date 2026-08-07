import { useEffect } from 'react';
import { backupConfigStorage } from '../services/backup/backupConfig';
import { isBackupDue, performAutoBackup, resolveBackupDir } from '../services/backup/backupEngine';
import { isTauriEnv } from '../utils/tauriEnv';
import { createLogger } from '../utils/logger';

const log = createLogger('AutoBackup');

/**
 * 应用启动时挂载一次：若已开启自动备份且到达触发条件（启动/每日/每周），
 * 则静默执行一次备份并更新 lastBackup。失败仅告警，不影响主流程。
 */
export function useAutoBackup(): void {
  useEffect(() => {
    if (!isTauriEnv()) return;
    (async () => {
      const cfg = backupConfigStorage.get();
      if (!isBackupDue(cfg)) return;
      try {
        const dir = await resolveBackupDir(cfg);
        await performAutoBackup(cfg);
        const updated = backupConfigStorage.get();
        backupConfigStorage.set({ ...updated, lastBackup: Date.now() });
        log.info('自动备份完成', { dir });
      } catch (e) {
        log.warn('自动备份失败', { err: String(e) });
      }
    })();
  }, []);
}
