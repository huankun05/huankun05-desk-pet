/**
 * 备份管理 IPC 处理
 */

import { ipcMain, shell } from "electron";
import * as fs from "fs";
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
import { cleanCaches, getDataRoot, listImportantPaths, scanDataUsage } from "./data-usage";

export function registerBackupIpc(): void {
  ipcMain.handle(
    IPC.BACKUP_CREATE,
    async (_event, category: BackupCategory = "all", type: BackupType = "manual", description: string = "") => {
      const result = createBackup(category, type, description);
      return { ok: !!result, backup: result };
    },
  );

  ipcMain.handle(IPC.BACKUP_LIST, async () => {
    const backups = listBackups();
    return { ok: true, backups };
  });

  ipcMain.handle(IPC.BACKUP_RESTORE, async (_event, backupId: string) => {
    const success = restoreBackup(backupId);
    return { ok: success };
  });

  ipcMain.handle(IPC.BACKUP_DELETE, async (_event, backupId: string) => {
    const success = deleteBackup(backupId);
    return { ok: success };
  });

  ipcMain.handle(IPC.BACKUP_CLEANUP, async (_event, keepCount: number = 10, category?: BackupCategory) => {
    cleanupOldBackups(keepCount, category);
    return { ok: true };
  });

  ipcMain.handle(IPC.DATA_USAGE_SCAN, async () => {
    const usage = scanDataUsage();
    return { ok: true, ...usage };
  });

  ipcMain.handle(IPC.DATA_USAGE_CLEAN, async () => {
    return cleanCaches();
  });

  ipcMain.handle(IPC.DATA_USAGE_PATHS, async () => {
    return { ok: true, root: getDataRoot(), paths: listImportantPaths() };
  });

  ipcMain.handle(IPC.DATA_USAGE_OPEN_PATH, async (_event, target: string) => {
    const root = getDataRoot();
    const resolved = target === "userData" || target === root ? root : target;
    // 仅允许打开数据根或其直接子路径，防止任意路径
    const abs = fs.existsSync(resolved) ? resolved : root;
    const ok = await shell.openPath(abs);
    return { ok: !ok, error: ok || undefined, path: abs };
  });
}
