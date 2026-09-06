/**
 * 凭据变更审计日志
 *
 * 记录"谁在什么时候改了什么凭据"，只写目标标识（provider 名 / server id / 键名），
 * 绝不写入凭据明文或密文本身——审计的目的是追溯变更来源，不是复制凭据。
 *
 * 存储：`userData/credential-audit.jsonl`（JSON Lines，追加写）。
 * 容量控制：文件超过 512KB 时裁剪为最近 MAX_ENTRIES 条，避免无限膨胀。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";

export type CredentialAction =
  | "model-settings.save"   // 模型 API Key 变更
  | "mcp.add"               // 新增 MCP server（含敏感 env）
  | "mcp.remove"            // 移除 MCP server
  | "mcp.env.import"        // 导入时写入 MCP 敏感 env
  | "credential.export"     // 导出凭据包
  | "credential.import";    // 导入凭据包

export interface CredentialAuditEntry {
  /** 时间戳（ms） */
  time: number;
  action: CredentialAction;
  /** 变更对象标识（如 "model:DeepSeek（深度求索）" / "mcp:github"） */
  target: string;
  /** 补充说明（不含明文值） */
  detail?: string;
}

const MAX_ENTRIES = 1000;
const TRIM_THRESHOLD_BYTES = 512 * 1024;

export function getCredentialAuditPath(): string {
  return path.join(app.getPath("userData"), "credential-audit.jsonl");
}

/** 追加一条审计记录（失败静默，不影响业务路径）。 */
export function logCredentialChange(entry: Omit<CredentialAuditEntry, "time">): void {
  try {
    const filePath = getCredentialAuditPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify({ time: Date.now(), ...entry }) + "\n", "utf-8");
    trimIfNeeded(filePath);
  } catch (err) {
    console.error("[CredentialAudit] 写入失败:", err instanceof Error ? err.message : err);
  }
}

/** 读取最近 N 条审计记录（按时间倒序返回）。 */
export function listCredentialAudit(limit = 50): CredentialAuditEntry[] {
  try {
    const filePath = getCredentialAuditPath();
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    const entries: CredentialAuditEntry[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as CredentialAuditEntry;
        if (parsed && typeof parsed.time === "number" && typeof parsed.action === "string") {
          entries.push(parsed);
        }
      } catch {
        // 跳过损坏行
      }
    }
    const n = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(limit) || 1));
    return entries.slice(-n).reverse();
  } catch {
    return [];
  }
}

/** 超长时裁剪：只保留最后 MAX_ENTRIES 条。 */
function trimIfNeeded(filePath: string): void {
  try {
    if (fs.statSync(filePath).size <= TRIM_THRESHOLD_BYTES) return;
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    if (lines.length <= MAX_ENTRIES) return;
    fs.writeFileSync(filePath, lines.slice(-MAX_ENTRIES).join("\n") + "\n", "utf-8");
  } catch {
    // 忽略裁剪失败
  }
}
