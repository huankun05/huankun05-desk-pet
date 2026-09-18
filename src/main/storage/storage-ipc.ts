import { IPC } from "../../shared/ipc-channels";
import { createIpcScope, type IpcScope } from "../application/ipc-scope";
import { app } from "electron";
import {
  buildStorageReport,
  cleanStorage,
  openPathInExplorer,
  readUserDataRedirect,
  writeUserDataRedirect,
} from "./storage-service";
import { autoBackup, createBackup, listBackups } from "../backup/backup-manager";

export function registerStorageIpc(deps: { ipc?: IpcScope } = {}): void {
  const ipc = deps.ipc ?? createIpcScope();

  ipc.handle(IPC.STORAGE_GET_REPORT, async () => buildStorageReport());

  ipc.handle(IPC.STORAGE_CLEAN, async (_e, keys?: string[]) => cleanStorage(Array.isArray(keys) ? keys : undefined));

  ipc.handle(IPC.STORAGE_OPEN_PATH, async (_e, target: string) => {
    openPathInExplorer(String(target ?? ""));
    return { ok: true };
  });

  ipc.handle(IPC.STORAGE_SET_USER_DATA_DIR, async (_e, target: string | null) => {
    const v = target == null || String(target).trim() === "" ? null : String(target).trim();
    const written = writeUserDataRedirect(v);
    return { ok: true, path: written || null, note: "需重启应用后生效" };
  });

  ipc.handle(IPC.STORAGE_GET_LOCATION, async () => ({
    userData: app.getPath("userData"),
    envOverride: (process.env.CYRENE_USER_DATA_DIR ?? "").trim() || null,
    redirectTarget: readUserDataRedirect(),
  }));

  ipc.handle(IPC.STORAGE_LIST_BACKUPS, async () => listBackups());

  ipc.handle(IPC.STORAGE_CREATE_BACKUP, async (_e, category?: string) => {
    const cat = (category as "all" | "settings" | "skills" | "chats" | "data") || "all";
    const result = createBackup(cat, "manual", "存储页手动备份");
    return result ? { ok: true, backupId: result.metadata.backupId } : { ok: false };
  });

  ipc.handle(IPC.STORAGE_AUTO_BACKUP, async (_e, category?: string) => {
    const cat = (category as "settings" | "chats" | "data" | "all") || "all";
    autoBackup(cat as never);
    return { ok: true };
  });
}
