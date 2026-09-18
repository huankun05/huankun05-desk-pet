/**
 * 备份与数据目录面板
 */
import { tOr } from "../i18n";

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

interface DirUsage {
  name: string;
  path: string;
  kind: string;
  bytes: number;
  fileCount: number;
  cleanable: boolean;
  category: string;
}

const CATEGORY_NAMES: Record<string, string> = {
  all: "全部",
  soul: "人设",
  styles: "风格",
  characters: "角色配置",
  settings: "应用设置/关键配置",
  skills: "技能",
  chats: "聊天与检查点",
  data: "关键配置 JSON",
};

const TYPE_NAMES: Record<string, string> = {
  manual: "手动",
  auto: "自动",
};

const CATEGORY_LABEL: Record<string, string> = {
  config: "配置",
  session: "会话/运行",
  skills: "技能",
  media: "媒体",
  cache: "缓存",
  backup: "备份",
  other: "其他",
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function formatTimestamp(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString("zh-CN");
  } catch {
    return isoString;
  }
}

function api() {
  return (window as unknown as { settings?: Record<string, (...args: never[]) => Promise<unknown>> }).settings;
}

function setStatus(text: string, type?: string): void {
  const el = document.getElementById("backup-status");
  if (!el) return;
  el.textContent = text;
  el.className = "save-status" + (type ? " " + type : "");
}

function setDataStatus(text: string): void {
  const el = document.getElementById("data-usage-summary");
  if (el) el.textContent = text;
}

async function loadPaths(): Promise<void> {
  const rootEl = document.getElementById("data-root-path");
  const listEl = document.getElementById("data-paths-list");
  const s = api();
  if (!s?.dataUsagePaths) return;
  try {
    const res = (await s.dataUsagePaths()) as {
      ok: boolean;
      root: string;
      paths: Array<{ key: string; label: string; path: string; exists: boolean }>;
    };
    if (rootEl) rootEl.textContent = `数据根：${res.root}`;
    if (listEl) {
      listEl.innerHTML = res.paths
        .map(
          (p) =>
            `<div><span style="display:inline-block;min-width:7em;color:var(--ui-text-muted);">${p.label}</span>` +
            `<code style="font-size:12px;">${p.path}</code>` +
            `<span style="color:${p.exists ? "#0b6b5c" : "#a63a49"};margin-left:8px;">${p.exists ? "存在" : "缺失"}</span></div>`,
        )
        .join("");
    }
  } catch (e) {
    if (rootEl) rootEl.textContent = String(e);
  }
}

async function loadUsage(): Promise<void> {
  const table = document.getElementById("data-usage-table");
  const s = api();
  if (!s?.dataUsageScan || !table) return;
  table.textContent = "统计中…";
  try {
    const res = (await s.dataUsageScan()) as {
      ok: boolean;
      root: string;
      entries: DirUsage[];
      totalBytes: number;
      cleanableBytes: number;
    };
    setDataStatus(
      `合计 ${formatBytes(res.totalBytes)} · 可清理缓存约 ${formatBytes(res.cleanableBytes)}`,
    );
    const rows = res.entries
      .slice(0, 40)
      .map((e) => {
        const tag = e.cleanable ? `<span style="color:#9c6a13">可清理</span>` : "";
        return `<tr>
          <td style="padding:4px 8px;">${e.name}</td>
          <td style="padding:4px 8px;">${CATEGORY_LABEL[e.category] ?? e.category}</td>
          <td style="padding:4px 8px;text-align:right;">${formatBytes(e.bytes)}</td>
          <td style="padding:4px 8px;text-align:right;">${e.fileCount}</td>
          <td style="padding:4px 8px;">${tag}</td>
        </tr>`;
      })
      .join("");
    table.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12.5px;">
      <thead><tr style="text-align:left;color:var(--ui-text-muted);">
        <th style="padding:4px 8px;">名称</th>
        <th style="padding:4px 8px;">类型</th>
        <th style="padding:4px 8px;text-align:right;">大小</th>
        <th style="padding:4px 8px;text-align:right;">文件数</th>
        <th style="padding:4px 8px;"></th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  } catch (e) {
    table.textContent = String(e);
  }
}

async function loadBackups(): Promise<void> {
  const listEl = document.getElementById("backup-list");
  if (!listEl) return;
  const s = api();
  try {
    const result = (await s?.backupList?.()) as { ok?: boolean; backups?: BackupInfo[] };
    if (result?.ok && Array.isArray(result.backups) && result.backups.length) {
      listEl.innerHTML = result.backups
        .map(
          (b) =>
            `<div style="border:1px solid var(--ui-border,#e5e5ea);border-radius:8px;padding:8px 10px;margin-bottom:6px;">
              <strong>${CATEGORY_NAMES[b.metadata.category] ?? b.metadata.category}</strong>
              <span style="color:var(--ui-text-muted);margin-left:8px;font-size:12px;">${TYPE_NAMES[b.metadata.type] ?? b.metadata.type}</span>
              <div style="font-size:12px;color:var(--ui-text-muted);">${formatTimestamp(b.metadata.timestamp)}</div>
              <div style="font-size:12px;">${(b.metadata.items ?? []).join("、")}</div>
              <div style="margin-top:6px;display:flex;gap:6px;">
                <button type="button" class="btn-secondary" data-restore="${b.metadata.backupId}">恢复</button>
                <button type="button" class="btn-secondary" data-delete="${b.metadata.backupId}">删除</button>
              </div>
            </div>`,
        )
        .join("");
      listEl.querySelectorAll<HTMLButtonElement>("[data-restore]").forEach((btn) => {
        btn.addEventListener("click", () => {
          void (async () => {
            const id = btn.dataset.restore!;
            const r = (await s?.backupRestore?.(id)) as { ok?: boolean };
            setStatus(r?.ok ? "恢复成功，请重启应用" : "恢复失败", r?.ok ? "is-ok" : "is-error");
          })();
        });
      });
      listEl.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((btn) => {
        btn.addEventListener("click", () => {
          void (async () => {
            const id = btn.dataset.delete!;
            const r = (await s?.backupDelete?.(id)) as { ok?: boolean };
            if (r?.ok) await loadBackups();
          })();
        });
      });
    } else {
      listEl.innerHTML = `<p style="color:var(--ui-text-muted);font-size:13px;">暂无备份</p>`;
    }
  } catch (error) {
    listEl.innerHTML = `<p style="color:var(--ui-danger,#a63a49);">${String(error)}</p>`;
  }
}

let inited = false;

export function initBackupPanel(): void {
  if (inited) {
    void loadPaths();
    void loadUsage();
    void loadBackups();
    return;
  }
  inited = true;

  const createBtn = document.getElementById("backup-create-btn");
  createBtn?.addEventListener("click", () => {
    void (async () => {
      const select = document.getElementById("backup-category-select") as HTMLSelectElement | null;
      const category = select?.value || "all";
      const descInput = document.getElementById("backup-desc-input") as HTMLInputElement | null;
      const s = api();
      setStatus(tOr("backup.creating", "备份中…"));
      const r = (await s?.backupCreate?.(category, "manual", descInput?.value ?? "")) as { ok?: boolean };
      setStatus(r?.ok ? tOr("backup.created", "备份完成") : tOr("backup.createFailed", "备份失败"), r?.ok ? "is-ok" : "is-error");
      if (r?.ok) await loadBackups();
    })();
  });

  document.getElementById("data-usage-scan-btn")?.addEventListener("click", () => {
    void loadUsage();
  });
  document.getElementById("data-usage-clean-btn")?.addEventListener("click", () => {
    void (async () => {
      const s = api();
      setDataStatus("清理中…");
      const r = (await s?.dataUsageClean?.()) as { ok?: boolean; freedBytes?: number; cleaned?: string[]; error?: string };
      if (r?.ok) {
        setDataStatus(`已清理 ${formatBytes(r.freedBytes ?? 0)}：${(r.cleaned ?? []).join("、") || "无"}`);
        await loadUsage();
      } else {
        setDataStatus(`清理失败：${r?.error ?? ""}`);
      }
    })();
  });
  document.getElementById("data-usage-open-root-btn")?.addEventListener("click", () => {
    void api()?.dataUsageOpenPath?.("userData");
  });

  void loadPaths();
  void loadUsage();
  void loadBackups();
}
