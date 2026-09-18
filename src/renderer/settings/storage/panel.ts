/**
 * 存储与备份：目录占用分析、缓存清理、数据目录、备份
 */

type DirInfo = {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  fileCount: number;
  bytes: number;
  cleanable: boolean;
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
  return (
    window as unknown as {
      settingsApi?: {
        storage?: {
          getReport: () => Promise<StorageReport>;
          clean: (keys?: string[]) => Promise<{ ok: boolean; freedBytes: number; cleaned: string[]; error?: string }>;
          openPath: (target: string) => Promise<unknown>;
          setLocation: (t: string | null) => Promise<{ ok: boolean; path: string | null; note?: string }>;
          getLocation: () => Promise<{ userData: string; envOverride: string | null; redirectTarget: string | null }>;
          listBackups: () => Promise<Array<{ metadata: { backupId: string; type: string; category: string; timestamp: string; items: string[] } }>>;
          createBackup: (category?: string) => Promise<{ ok: boolean; backupId?: string }>;
        };
      };
    }
  ).settingsApi?.storage;
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
  n.style.color = ok === false ? "#a63a49" : "";
}

let inited = false;
let lastReport: StorageReport | null = null;

async function refreshReport(): Promise<void> {
  const s = api();
  if (!s) {
    setStatus("存储 API 不可用", false);
    return;
  }
  const report = await s.getReport();
  lastReport = report;
  const userData = el("storage-user-data");
  if (userData) userData.textContent = report.userData;
  const program = el("storage-program-dir");
  if (program) program.textContent = report.programDir;
  const loc = el("storage-location-note");
  if (loc) {
    if (report.envOverride) loc.textContent = `环境变量 CYRENE_USER_DATA_DIR：${report.envOverride}`;
    else if (report.redirectTarget) loc.textContent = `已自定义目录：${report.redirectTarget}`;
    else loc.textContent = `默认目录：%APPDATA%\\live2d-cyrene（重启后生效）`;
  }
  const total = el("storage-total");
  if (total) total.textContent = fmtBytes(report.totalBytes);
  const cleanable = el("storage-cleanable");
  if (cleanable) cleanable.textContent = fmtBytes(report.cleanableBytes);

  const list = el("storage-dir-list");
  if (list) {
    list.innerHTML = "";
    for (const d of report.dirs) {
      const row = document.createElement("div");
      row.className = "storage-row";
      row.innerHTML = `
        <span class="storage-row__label">${d.label}</span>
        <span class="storage-row__meta">${d.exists ? `${fmtBytes(d.bytes)} · ${d.fileCount} 文件` : "不存在"}</span>
        <span class="storage-row__actions">
          <button type="button" class="btn-secondary storage-open" data-path="${d.path}">打开</button>
          ${d.cleanable && d.exists && d.bytes > 0 ? `<button type="button" class="btn-secondary storage-clean-one" data-key="${d.key}">清理</button>` : ""}
        </span>`;
      list.appendChild(row);
    }
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
          if (!window.confirm(`清理「${key}」？不可恢复。`)) return;
          const r = await s.clean([key]);
          setStatus(r.ok ? `已清理 ${r.cleaned.join("、")}，释放 ${fmtBytes(r.freedBytes)}` : String(r.error), r.ok);
          await refreshReport();
        })();
      });
    });
  }

  const backups = el("storage-backup-list");
  if (backups) {
    backups.innerHTML = "";
    const listB = await s.listBackups();
    if (!listB.length) {
      backups.innerHTML = `<div class="form-hint">暂无备份</div>`;
    } else {
      for (const b of listB.slice(0, 12)) {
        const row = document.createElement("div");
        row.className = "storage-row";
        row.innerHTML = `
          <span class="storage-row__label">${b.metadata.backupId}</span>
          <span class="storage-row__meta">${b.metadata.category} · ${b.metadata.items.length} 项 · ${b.metadata.timestamp.slice(0, 19).replace("T", " ")}</span>
          <span class="storage-row__actions">
            <button type="button" class="btn-secondary storage-open" data-path="${(b as { dirPath?: string }).dirPath || ""}">位置</button>
          </span>`;
        backups.appendChild(row);
      }
      backups.querySelectorAll<HTMLButtonElement>(".storage-open").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (btn.dataset.path) void s.openPath(btn.dataset.path);
        });
      });
    }
  }
}

export async function initStoragePanel(): Promise<void> {
  if (inited) return;
  inited = true;
  const s = api();
  if (!s) {
    setStatus("存储 API 不可用", false);
    return;
  }

  el("storage-refresh-btn")?.addEventListener("click", () => {
    void refreshReport().then(() => setStatus("已刷新"));
  });

  el("storage-clean-all-btn")?.addEventListener("click", () => {
    void (async () => {
      if (!window.confirm("清理全部可清理缓存？（不含聊天会话与备份）")) return;
      const r = await s.clean();
      setStatus(r.ok ? `已清理 ${r.cleaned.join("、")}，释放 ${fmtBytes(r.freedBytes)}` : String(r.error), r.ok);
      await refreshReport();
    })();
  });

  el("storage-open-user-data-btn")?.addEventListener("click", () => {
    if (lastReport) void s.openPath(lastReport.userData);
  });

  el("storage-save-location-btn")?.addEventListener("click", () => {
    void (async () => {
      const input = el<HTMLInputElement>("storage-location-input");
      const v = input?.value.trim() || null;
      const r = await s.setLocation(v);
      setStatus(`${r.note ?? ""} ${r.path || "已恢复默认目录"}`.trim(), true);
      await refreshReport();
    })();
  });

  el("storage-backup-all-btn")?.addEventListener("click", () => {
    void (async () => {
      setStatus("备份中…");
      const r = await s.createBackup("all");
      setStatus(r.ok ? `备份完成：${r.backupId}` : "备份失败", r.ok);
      await refreshReport();
    })();
  });

  el("storage-backup-chats-btn")?.addEventListener("click", () => {
    void (async () => {
      setStatus("备份会话中…");
      const r = await s.createBackup("chats");
      setStatus(r.ok ? `会话备份：${r.backupId}` : "会话备份失败", r.ok);
      await refreshReport();
    })();
  });

  el("storage-backup-data-btn")?.addEventListener("click", () => {
    void (async () => {
      setStatus("备份配置中…");
      const r = await s.createBackup("data");
      setStatus(r.ok ? `配置备份：${r.backupId}` : "配置备份失败", r.ok);
      await refreshReport();
    })();
  });

  await refreshReport();
  setStatus("");
}
