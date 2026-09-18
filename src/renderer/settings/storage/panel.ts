/**
 * 存储与备份：数据目录、占用、缓存清理、备份创建/恢复/删除
 * API：window.settings.storage（preload contextBridge）
 */
import { tOr } from "../i18n";

type DirInfo = {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  fileCount: number;
  bytes: number;
  cleanable: boolean;
};

type BackupMeta = {
  backupId: string;
  type: string;
  category: string;
  timestamp: string;
  items: string[];
  dirPath?: string;
};

type StorageReport = {
  userData: string;
  programDir: string;
  redirectFile: string;
  redirectTarget: string | null;
  envOverride: string | null;
  dirs: DirInfo[];
  totalBytes: number;
  cleanableBytes: number;
};

function api() {
  const w = window as unknown as {
    settings?: any;
    settingsApi?: any;
  };
  // preload 暴露的是 window.settings
  return w.settings?.storage ?? w.settingsApi?.storage ?? null;
}

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setStatus(text: string, ok?: boolean): void {
  const n = el("storage-status");
  if (!n) return;
  n.hidden = !text;
  n.textContent = text;
  n.style.color = ok === false ? "#a63a49" : ok ? "#0b6b5c" : "";
}

const CATEGORY_LABEL: Record<string, string> = {
  all: "全部",
  soul: "人设",
  styles: "风格",
  characters: "角色配置",
  settings: "应用设置",
  skills: "技能",
  chats: "聊天与检查点",
  data: "关键配置",
};

let inited = false;
let lastReport: StorageReport | null = null;

async function refreshReport(): Promise<void> {
  const s = api();
  if (!s) {
    setStatus(tOr("storage.apiUnavailable", "存储 API 不可用（请重启应用）"), false);
    const list = el("storage-dir-list");
    if (list) {
      list.innerHTML = `<div class="form-hint" style="color:#a63a49">未连接到主进程存储服务。请关闭设置窗口后重新打开，或重启应用。</div>`;
    }
    return;
  }
  try {
    const report = (await s.getReport()) as StorageReport;
    lastReport = report;
    const userData = el("storage-user-data");
    if (userData) userData.textContent = report.userData || "—";
    const program = el("storage-program-dir");
    if (program) program.textContent = report.programDir || "—";
    const loc = el("storage-location-note");
    if (loc) {
      if (report.envOverride) loc.textContent = `环境变量 CYRENE_USER_DATA_DIR：${report.envOverride}`;
      else if (report.redirectTarget) loc.textContent = `自定义目录：${report.redirectTarget}（重启生效）`;
      else loc.textContent = `默认：${report.userData || "%APPDATA%\\live2d-cyrene"}`;
    }
    const total = el("storage-total");
    if (total) total.textContent = fmtBytes(report.totalBytes);
    const cleanable = el("storage-cleanable");
    if (cleanable) cleanable.textContent = fmtBytes(report.cleanableBytes);

    const list = el("storage-dir-list");
    if (list) {
      if (!report.dirs?.length) {
        list.innerHTML = `<div class="form-hint">暂无目录统计</div>`;
      } else {
        list.innerHTML = report.dirs
          .map((d) => {
            const badge = d.cleanable
              ? `<span style="color:#9c6a13;margin-left:6px;font-size:12px">可清理</span>`
              : "";
            return `<div class="storage-row" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--ui-border,rgba(0,0,0,.06));font-size:13px;">
              <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.label}${badge}</span>
              <span style="color:var(--ui-text-muted);font-size:12px;white-space:nowrap;">${d.exists ? `${fmtBytes(d.bytes)} · ${d.fileCount} 文件` : "不存在"}</span>
              <span style="display:flex;gap:6px;">
                <button type="button" class="btn-secondary storage-open" data-path="${d.path}" style="min-height:28px;padding:0 10px;">打开</button>
                ${d.cleanable && d.exists && d.bytes > 0 ? `<button type="button" class="btn-secondary storage-clean-one" data-key="${d.key}" style="min-height:28px;padding:0 10px;">清理</button>` : ""}
              </span>
            </div>`;
          })
          .join("");
        list.querySelectorAll<HTMLButtonElement>(".storage-open").forEach((btn) => {
          btn.addEventListener("click", () => {
            void s.openPath(btn.dataset.path || "");
          });
        });
        list.querySelectorAll<HTMLButtonElement>(".storage-clean-one").forEach((btn) => {
          btn.addEventListener("click", () => {
            void (async () => {
              const key = btn.dataset.key;
              if (!key) return;
              if (!window.confirm(`清理「${key}」缓存？（不影响聊天记录与配置）`)) return;
              const r = await s.clean([key]);
              setStatus(r.ok ? `已清理，释放 ${fmtBytes(r.freedBytes)}` : String(r.error), r.ok !== false);
              await refreshReport();
            })();
          });
        });
      }
    }
  } catch (e) {
    setStatus(String(e), false);
  }
  await refreshBackups();
}

async function refreshBackups(): Promise<void> {
  const s = api();
  const backups = el("storage-backup-list");
  if (!backups) return;
  if (!s?.listBackups) {
    backups.innerHTML = `<div class="form-hint">备份 API 不可用</div>`;
    return;
  }
  try {
    const list = ((await s.listBackups()) || []) as BackupMeta[];
    if (!list.length) {
      backups.innerHTML = `<div class="form-hint">暂无备份。可点击上方按钮创建。</div>`;
      return;
    }
    backups.innerHTML = list
      .slice(0, 20)
      .map((b) => {
        const cat = CATEGORY_LABEL[b.category] ?? b.category;
        const when = (b.timestamp || "").slice(0, 19).replace("T", " ");
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--ui-border,rgba(0,0,0,.06));font-size:13px;">
          <span style="flex:1;min-width:0;">
            <strong>${cat}</strong>
            <span style="color:var(--ui-text-muted);margin-left:8px;font-size:12px;">${b.type || "manual"} · ${when}</span>
            <div style="font-size:12px;color:var(--ui-text-muted);">${(b.items || []).join("、") || "—"}</div>
            <div style="font-size:11px;color:var(--ui-text-faint);">${b.backupId}</div>
          </span>
          <span style="display:flex;gap:6px;">
            <button type="button" class="btn-secondary storage-restore" data-id="${b.backupId}" style="min-height:28px;padding:0 10px;">恢复</button>
            <button type="button" class="btn-secondary storage-del-backup" data-id="${b.backupId}" style="min-height:28px;padding:0 10px;">删除</button>
          </span>
        </div>`;
      })
      .join("");

    const settingsApi = (window as unknown as { settings?: any }).settings;
    backups.querySelectorAll<HTMLButtonElement>(".storage-restore").forEach((btn) => {
      btn.addEventListener("click", () => {
        void (async () => {
          const id = btn.dataset.id!;
          if (!window.confirm(`恢复备份 ${id}？将覆盖当前对应配置。`)) return;
          const r = await settingsApi?.backupRestore?.(id);
          setStatus(r?.ok ? "恢复成功，请重启应用" : "恢复失败", !!r?.ok);
        })();
      });
    });
    backups.querySelectorAll<HTMLButtonElement>(".storage-del-backup").forEach((btn) => {
      btn.addEventListener("click", () => {
        void (async () => {
          const id = btn.dataset.id!;
          if (!window.confirm(`删除备份 ${id}？`)) return;
          const r = await settingsApi?.backupDelete?.(id);
          if (r?.ok) {
            setStatus("已删除备份", true);
            await refreshBackups();
          } else setStatus("删除失败", false);
        })();
      });
    });
  } catch (e) {
    backups.innerHTML = `<div class="form-hint" style="color:#a63a49">${String(e)}</div>`;
  }
}

async function createBackup(category: string): Promise<void> {
  const s = api();
  setStatus(`备份中（${CATEGORY_LABEL[category] ?? category}）…`);
  try {
    const r = await s?.createBackup?.(category);
    if (r?.ok) {
      setStatus(`备份完成：${r.backupId || ""}`, true);
      await refreshBackups();
      await refreshReport();
    } else {
      setStatus("备份失败", false);
    }
  } catch (e) {
    setStatus(String(e), false);
  }
}

export async function initStoragePanel(): Promise<void> {
  if (inited) {
    await refreshReport();
    return;
  }
  inited = true;

  el("storage-refresh-btn")?.addEventListener("click", () => {
    void refreshReport().then(() => setStatus("已刷新占用", true));
  });

  el("storage-clean-all-btn")?.addEventListener("click", () => {
    void (async () => {
      if (!window.confirm("清理全部可清理缓存？（不含聊天会话、配置与备份）")) return;
      const s = api();
      try {
        const r = await s.clean();
        setStatus(r.ok ? `已清理，释放 ${fmtBytes(r.freedBytes)}` : String(r.error), r.ok !== false);
      } catch (e) {
        setStatus(String(e), false);
      }
      await refreshReport();
    })();
  });

  el("storage-open-user-data-btn")?.addEventListener("click", () => {
    const s = api();
    if (lastReport) void s?.openPath(lastReport.userData);
  });

  el("storage-save-location-btn")?.addEventListener("click", () => {
    void (async () => {
      const input = el<HTMLInputElement>("storage-location-input");
      const v = input?.value.trim() || null;
      const s = api();
      try {
        const r = await s.setLocation(v);
        setStatus(`${r.note ?? ""} ${r.path || "已恢复默认目录"}`.trim(), true);
      } catch (e) {
        setStatus(String(e), false);
      }
      await refreshReport();
    })();
  });

  // 备份按钮
  const bindBackup = (id: string, category: string) => {
    el(id)?.addEventListener("click", () => void createBackup(category));
  };
  bindBackup("storage-backup-all-btn", "all");
  bindBackup("storage-backup-chats-btn", "chats");
  bindBackup("storage-backup-data-btn", "data");
  bindBackup("storage-backup-skills-btn", "skills");
  bindBackup("storage-backup-settings-btn", "settings");

  el("storage-backup-refresh-btn")?.addEventListener("click", () => {
    void refreshBackups().then(() => setStatus("已刷新备份列表", true));
  });

  await refreshReport();
}
