// 凭据迁移 UI：导出 / 导入 / 变更记录
// 绑定 API 面板的凭据迁移按钮（index.html 的 .credential-migrate-row）。
// 口令由用户在输入框内提供，密文只出现在主进程（IPC 不落明文日志）。

import { showInputModal } from "../shared/modal";
import type { CredentialsApi } from "../shared/types";

const exportBtn = document.getElementById("cred-export-btn") as HTMLButtonElement | null;
const importBtn = document.getElementById("cred-import-btn") as HTMLButtonElement | null;
const auditBtn = document.getElementById("cred-audit-btn") as HTMLButtonElement | null;
const statusEl = document.getElementById("cred-status") as HTMLElement | null;
const auditEl = document.getElementById("cred-audit") as HTMLElement | null;

function api(): CredentialsApi | undefined {
  return (window as { credentials?: CredentialsApi }).credentials;
}

function setStatus(message: string, isError = false): void {
  if (!statusEl) return;
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

async function promptPassphrase(title: string, message: string): Promise<string | null> {
  return showInputModal({ title, message, placeholder: "输入加密口令（至少 4 个字符）" });
}

async function handleExport(): Promise<void> {
  const passphrase = await promptPassphrase("导出凭据", "导出将包含全部 API Key 与 MCP 敏感环境变量，并加密保存。请设置口令，换机导入时需要输入同一口令。");
  if (passphrase === null) return;
  if (passphrase.length < 4) {
    setStatus("口令至少 4 个字符", true);
    return;
  }
  const result = await api()?.export(passphrase);
  if (!result) {
    setStatus("导出失败：API 不可用", true);
    return;
  }
  if (result.ok) {
    setStatus(`已导出 ${result.count ?? 0} 条凭据到 ${result.filePath ?? ""}`);
  } else {
    setStatus(result.error ?? "导出失败", true);
  }
}

async function handleImport(): Promise<void> {
  const passphrase = await promptPassphrase("导入凭据", "选择要导入的凭据文件，并输入导出时的口令。导入会覆盖本地同名凭据。");
  if (passphrase === null) return;
  if (passphrase.length < 4) {
    setStatus("口令至少 4 个字符", true);
    return;
  }
  const result = await api()?.import(passphrase);
  if (!result) {
    setStatus("导入失败：API 不可用", true);
    return;
  }
  if (result.ok) {
    const parts = [`模型 ${result.appliedModel ?? 0} 条`, `MCP ${result.appliedMcp ?? 0} 条`];
    if (result.skipped) parts.push(`跳过 ${result.skipped} 条`);
    setStatus(`导入完成：${parts.join(" / ")}`);
  } else {
    setStatus(result.error ?? "导入失败", true);
  }
}

const ACTION_LABELS: Record<string, string> = {
  "model-settings.save": "模型 API Key 变更",
  "mcp.add": "新增 MCP Server",
  "mcp.remove": "移除 MCP Server",
  "mcp.env.import": "MCP 环境变量导入",
  "credential.export": "导出凭据",
  "credential.import": "导入凭据",
};

function formatTime(time: number): string {
  const d = new Date(time);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function toggleAudit(): Promise<void> {
  if (!auditEl) return;
  if (!auditEl.hidden) {
    auditEl.hidden = true;
    auditEl.innerHTML = "";
    return;
  }
  const entries = await api()?.auditList(50);
  if (!entries) {
    setStatus("读取变更记录失败", true);
    return;
  }
  auditEl.hidden = false;
  auditEl.innerHTML = entries.length === 0
    ? "<div class='credential-migrate-row__audit-item'><span>暂无变更记录</span></div>"
    : entries.map((entry) => {
        const label = ACTION_LABELS[entry.action] ?? entry.action;
        const target = entry.target ? `（${entry.target}）` : "";
        const detail = entry.detail ? ` · ${entry.detail}` : "";
        return (
          "<div class='credential-migrate-row__audit-item'>" +
          `<span class='credential-migrate-row__audit-time'>${formatTime(entry.time)}</span>` +
          `<span class='credential-migrate-row__audit-text' title="${escapeHtml(`${label}${target}${detail}`)}">${escapeHtml(`${label}${target}${detail}`)}</span>` +
          "</div>"
        );
      }).join("");
  setStatus("");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

exportBtn?.addEventListener("click", () => void handleExport());
importBtn?.addEventListener("click", () => void handleImport());
auditBtn?.addEventListener("click", () => void toggleAudit());
