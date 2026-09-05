/**
 * 备份管理面板逻辑
 */

interface BackupMetadata {
  backupId: string;
  type: "manual" | "auto";
  category: string;
  timestamp: string;
  description: string;
  items: string[];
}

interface BackupInfo {
  metadata: BackupMetadata;
  dirPath: string;
}

const CATEGORY_NAMES: Record<string, string> = {
  all: "全部",
  soul: "人设",
  styles: "风格",
  characters: "角色配置",
  settings: "应用设置",
};

const TYPE_NAMES: Record<string, string> = {
  manual: "手动",
  auto: "自动",
};

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function getSettingsApi(): any {
  return (window as unknown as { settings?: any }).settings;
}

function setStatus(text: string, type?: string): void {
  const statusEl = document.getElementById("backup-status");
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = "save-status" + (type ? " " + type : "");
}

async function loadBackups(): Promise<void> {
  const listEl = document.getElementById("backup-list");
  if (!listEl) return;

  try {
    const api = getSettingsApi();
    const result = await api?.backupList?.();
    if (result?.ok && Array.isArray(result.backups)) {
      renderBackups(result.backups);
    } else {
      listEl.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">加载备份列表失败</p>';
    }
  } catch (error) {
    listEl.innerHTML = `<p style="color:var(--error-color);font-size:13px;">加载失败: ${error instanceof Error ? error.message : String(error)}</p>`;
  }
}

function renderBackups(backups: BackupInfo[]): void {
  const listEl = document.getElementById("backup-list");
  if (!listEl) return;

  if (backups.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">暂无备份，点击"立即备份"创建第一个备份。</p>';
    return;
  }

  let html = '<div style="display:flex;flex-direction:column;gap:8px;">';
  for (const backup of backups) {
    const m = backup.metadata;
    const typeColor = m.type === "auto" ? "#8b5cf6" : "#f472b6";
    html += `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;color:#fff;background:${typeColor};">${TYPE_NAMES[m.type] || m.type}</span>
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;color:var(--text-primary);background:var(--bg-tertiary);">${CATEGORY_NAMES[m.category] || m.category}</span>
            <span style="font-size:13px;color:var(--text-primary);font-weight:500;">${formatTimestamp(m.timestamp)}</span>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);">${m.description || "无描述"}</div>
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">包含 ${m.items.length} 个文件: ${m.items.slice(0, 3).join(", ")}${m.items.length > 3 ? "..." : ""}</div>
        </div>
        <div style="display:flex;gap:8px;margin-left:12px;flex-shrink:0;">
          <button type="button" class="save-btn save-btn--ghost" data-action="restore" data-id="${m.backupId}" style="padding:6px 12px;font-size:12px;">恢复</button>
          <button type="button" data-action="delete" data-id="${m.backupId}" style="padding:6px 12px;font-size:12px;background:#ef4444;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:500;transition:background 0.2s;">删除</button>
        </div>
      </div>
    `;
  }
  html += "</div>";

  listEl.innerHTML = html;

  // 绑定事件
  listEl.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-action");
      const id = btn.getAttribute("data-id");
      if (action === "restore" && id) {
        void restoreBackup(id);
      } else if (action === "delete" && id) {
        void deleteBackup(id);
      }
    });
  });
}

async function createBackup(): Promise<void> {
  try {
    const categorySelect = document.getElementById("backup-category-select") as HTMLSelectElement | null;
    const category = categorySelect?.value || "all";
    setStatus("正在创建备份...");
    const api = getSettingsApi();
    const result = await api?.backupCreate?.(category, "manual", "手动备份");
    if (result?.ok) {
      setStatus("备份创建成功", "success");
      await loadBackups();
    } else {
      setStatus("备份创建失败", "error");
    }
  } catch (error) {
    setStatus("备份创建失败: " + (error instanceof Error ? error.message : String(error)), "error");
  }
}

async function restoreBackup(backupId: string): Promise<void> {
  if (!confirm(`确定要恢复备份 "${backupId}" 吗？\n恢复前会自动备份当前状态。`)) {
    return;
  }
  try {
    setStatus("正在恢复备份...");
    const api = getSettingsApi();
    const result = await api?.backupRestore?.(backupId);
    if (result?.ok) {
      setStatus("备份恢复成功，建议重启应用使配置生效", "success");
      await loadBackups();
    } else {
      setStatus("备份恢复失败", "error");
    }
  } catch (error) {
    setStatus("备份恢复失败: " + (error instanceof Error ? error.message : String(error)), "error");
  }
}

async function deleteBackup(backupId: string): Promise<void> {
  if (!confirm(`确定要删除备份 "${backupId}" 吗？此操作不可撤销。`)) {
    return;
  }
  try {
    setStatus("正在删除备份...");
    const api = getSettingsApi();
    const result = await api?.backupDelete?.(backupId);
    if (result?.ok) {
      setStatus("备份删除成功", "success");
      await loadBackups();
    } else {
      setStatus("备份删除失败", "error");
    }
  } catch (error) {
    setStatus("备份删除失败: " + (error instanceof Error ? error.message : String(error)), "error");
  }
}

export function initBackupPanel(): void {
  const createBtn = document.getElementById("backup-create-btn");
  if (createBtn) {
    createBtn.addEventListener("click", () => {
      void createBackup();
    });
  }

  // 初始加载备份列表
  void loadBackups();
}
