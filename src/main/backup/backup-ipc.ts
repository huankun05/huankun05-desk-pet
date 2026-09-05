/**
 * 备份管理 IPC 处理
 */

import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import {
  createBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  cleanupOldBackups,
  type BackupCategory,
  type BackupType,
} from "./backup-manager";

export function registerBackupIpc(): void {
  // 创建备份
  ipcMain.handle(
    IPC.BACKUP_CREATE,
    async (_event, category: BackupCategory = "all", type: BackupType = "manual", description: string = "") => {
      const result = createBackup(category, type, description);
      return { ok: !!result, backup: result };
    }
  );

  // 列出备份
  ipcMain.handle(IPC.BACKUP_LIST, async () => {
    const backups = listBackups();
    return { ok: true, backups };
  });

  // 恢复备份
  ipcMain.handle(IPC.BACKUP_RESTORE, async (_event, backupId: string) => {
    const success = restoreBackup(backupId);
    return { ok: success };
  });

  // 删除备份
  ipcMain.handle(IPC.BACKUP_DELETE, async (_event, backupId: string) => {
    const success = deleteBackup(backupId);
    return { ok: success };
  });

  // 清理旧备份
  ipcMain.handle(IPC.BACKUP_CLEANUP, async (_event, keepCount: number = 10, category?: BackupCategory) => {
    cleanupOldBackups(keepCount, category);
    return { ok: true };
  });
}
