/**
 * 备份引擎（v2）
 *
 * 设计要点：
 * - 备份落到「真实目录」（默认 <项目数据目录>/backups），而非浏览器存储，
 *   因此是一份独立于运行介质的、可恢复的用户数据副本。
 * - 从真实的 localStorage 键收集数据（聊天/人设/设置/Provider/RAG 记忆/
 *   各记忆开关/按角色隔离的角色记忆），还原时写回原键后刷新页面，
 *   由 createStorage 重新落盘到文件，保证浏览器存储与文件双写一致。
 * - 原子写 + 滚动保留最近 N 份（超出用 delete_file 删除最旧）。
 * - 支持自动备份（启动/每日/每周）与手动备份/还原。
 *
 * 依赖的 Tauri 命令（src-tauri/src/lib.rs）：
 *   get_project_data_dir / write_file / read_file_content / list_directory / delete_file
 * 以上命令均限制在项目数据目录内，天然安全。
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauriEnv } from '../../utils/tauriEnv';
import type { BackupConfig, BackupEntry, BackupFile, BackupManifest } from './types';

/** 数据源定义：logical=备份内逻辑名，lsKey=真实的 localStorage 键 */
interface SourceDef {
  logical: string;
  lsKey: string;
  label: string;
}

const SOURCES: SourceDef[] = [
  { logical: 'chat_sessions', lsKey: 'deskpet_chat_sessions', label: '聊天记录' },
  { logical: 'settings', lsKey: 'deskpet_settings', label: '应用设置' },
  { logical: 'persona_store', lsKey: 'deskpet_persona_store', label: '角色人设' },
  { logical: 'providers', lsKey: 'deskpet_providers', label: 'Provider 配置' },
  { logical: 'rag_docs', lsKey: 'deskpet_rag_docs_v1', label: 'RAG 记忆' },
  { logical: 'context_config', lsKey: 'deskpet_contextConfig', label: '上下文配置' },
  { logical: 'rag_enabled', lsKey: 'deskpet_ragEnabled', label: '长期记忆开关' },
  { logical: 'hybrid_rag', lsKey: 'deskpet_hybrid_rag', label: '混合检索配置' },
  { logical: 'memory_extract', lsKey: 'deskpet_memory_extract', label: 'LLM 增强抽取开关' },
];

/** 按角色隔离的记忆键前缀 */
const MEMORY_PREFIX = 'desk_pet_memory_';

const BACKUP_PREFIX = 'desk-pet-backup-';
const BACKUP_SUFFIX = '.json';

interface FileEntry {
  name: string;
  is_dir: boolean;
  size: number;
}

export interface CollectedBackup {
  data: Record<string, unknown>;
  entries: BackupEntry[];
  totalSize: number;
}

// ============================================================
// 工具
// ============================================================

function byteLength(s: string): number {
  try {
    return new Blob([s]).size;
  } catch {
    return s.length;
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function sha256(text: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return '';
  }
}

// ============================================================
// 收集数据
// ============================================================

export async function collectBackupData(): Promise<CollectedBackup> {
  const data: Record<string, unknown> = {};
  const entries: BackupEntry[] = [];
  let totalSize = 0;

  for (const s of SOURCES) {
    const raw = localStorage.getItem(s.lsKey);
    if (raw == null) continue;
    data[s.logical] = safeParse(raw);
    const size = byteLength(raw);
    totalSize += size;
    entries.push({ id: s.logical, name: s.label, type: s.logical, size, path: s.logical });
  }

  // 按角色隔离的记忆（desk_pet_memory_<personaId>）
  const memories: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(MEMORY_PREFIX)) {
      const raw = localStorage.getItem(key);
      if (raw != null) {
        memories[key] = safeParse(raw);
        totalSize += byteLength(raw);
      }
    }
  }
  if (Object.keys(memories).length > 0) {
    data.memories = memories;
    entries.push({ id: 'memories', name: '角色记忆', type: 'memory', size: 0, path: 'memories' });
  }

  return { data, entries, totalSize };
}

// ============================================================
// 写备份
// ============================================================

export async function writeBackup(dir: string, keepCount: number): Promise<string> {
  if (!isTauriEnv()) {
    throw new Error('备份需要桌面运行环境（Tauri）');
  }
  const { data, entries, totalSize } = await collectBackupData();
  const timestamp = new Date().toISOString();
  const checksum = await sha256(JSON.stringify(data));
  const manifest: BackupManifest = {
    version: '2.0.0',
    timestamp,
    checksum,
    entries,
    totalSize,
  };
  const payload = JSON.stringify({ manifest, data });
  const fileName = `${BACKUP_PREFIX}${Date.now()}${BACKUP_SUFFIX}`;
  const filePath = `${dir}/${fileName}`;
  await invoke('write_file', { path: filePath, content: payload });
  await pruneBackups(dir, keepCount);
  return filePath;
}

/** 滚动保留最近 keepCount 份，删除最旧 */
async function pruneBackups(dir: string, keepCount: number): Promise<void> {
  const files = await listBackups(dir);
  const excess = files.slice(keepCount);
  for (const f of excess) {
    await invoke('delete_file', { path: f.path }).catch(() => {
      /* 忽略单文件删除失败 */
    });
  }
}

// ============================================================
// 列举 / 还原
// ============================================================

export async function listBackups(dir: string): Promise<BackupFile[]> {
  if (!isTauriEnv()) return [];
  let entries: FileEntry[];
  try {
    entries = await invoke<FileEntry[]>('list_directory', { path: dir });
  } catch {
    // 目录尚未创建（首次备份前）时视为无备份
    return [];
  }
  return entries
    .filter((e) => !e.is_dir && e.name.startsWith(BACKUP_PREFIX) && e.name.endsWith(BACKUP_SUFFIX))
    .map((e) => ({
      name: e.name,
      path: `${dir}/${e.name}`,
      size: e.size,
      timestamp: extractTimestamp(e.name),
    }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

function extractTimestamp(name: string): number {
  const m = name.match(/desk-pet-backup-(\d+)\.json/);
  return m ? Number(m[1]) : 0;
}

export async function restoreBackup(filePath: string): Promise<void> {
  if (!isTauriEnv()) {
    throw new Error('还原需要桌面运行环境（Tauri）');
  }
  const raw = await invoke<string>('read_file_content', { path: filePath });
  const backup = JSON.parse(raw);
  if (!backup?.manifest || !backup?.data) {
    throw new Error('无效的备份文件');
  }
  const checksum = await sha256(JSON.stringify(backup.data));
  if (checksum && backup.manifest.checksum && checksum !== backup.manifest.checksum) {
    throw new Error('备份文件校验失败（可能已损坏）');
  }
  applyData(backup.data);
  // 刷新后 createStorage 会依据 localStorage 重新落盘到文件，保证双写一致
  window.location.reload();
}

/** 将备份数据写回 localStorage（导出以便独立测试/复用） */
export function applyData(data: Record<string, unknown>): void {
  for (const s of SOURCES) {
    if (data[s.logical] !== undefined) {
      localStorage.setItem(s.lsKey, JSON.stringify(data[s.logical]));
    }
  }
  const memories = data.memories as Record<string, unknown> | undefined;
  if (memories) {
    for (const [k, v] of Object.entries(memories)) {
      localStorage.setItem(k, JSON.stringify(v));
    }
  }
}

// ============================================================
// 自动备份
// ============================================================

/** 解析备份目录：自定义优先，否则默认 <项目数据目录>/backups */
export async function resolveBackupDir(cfg: BackupConfig): Promise<string> {
  if (cfg.dir && cfg.dir.trim()) return cfg.dir.trim().replace(/\\/g, '/');
  const base = (await invoke<string>('get_project_data_dir')).replace(/\\/g, '/');
  return `${base}/backups`;
}

/** 是否到达自动备份触发条件 */
export function isBackupDue(cfg: BackupConfig): boolean {
  if (!cfg.enabled) return false;
  if (cfg.frequency === 'startup') return true;
  const elapsed = Date.now() - (cfg.lastBackup || 0);
  if (cfg.frequency === 'daily') return elapsed >= 24 * 3600 * 1000;
  if (cfg.frequency === 'weekly') return elapsed >= 7 * 24 * 3600 * 1000;
  return false;
}

/** 执行一次自动备份（写文件 + 滚动清理） */
export async function performAutoBackup(cfg: BackupConfig): Promise<string> {
  const dir = await resolveBackupDir(cfg);
  return writeBackup(dir, cfg.keepCount);
}
