/**
 * 用户数据目录统计 / 缓存清理
 * 根目录固定为 app.getPath("userData")（%APPDATA%\live2d-cyrene）。
 */
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

export type DirUsage = {
  name: string;
  path: string;
  kind: "dir" | "file";
  bytes: number;
  fileCount: number;
  /** 可安全清理（缓存类） */
  cleanable: boolean;
  category: "config" | "session" | "skills" | "media" | "cache" | "backup" | "other";
};

const CACHE_DIRS = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Network",
  "blob_storage",
  "Shared Dictionary",
]);

const SESSION_DIRS = new Set(["cyrene-chats", "cyrene-runs", "cyrene-tasks", "checkpoints", "channels"]);
const SKILL_DIRS = new Set(["skills", "skills-curator-backups"]);
const MEDIA_DIRS = new Set(["screenshots", "cyrene-tts-cache", "music", "tessdata", "rag-data"]);
const BACKUP_DIRS = new Set(["backups"]);

function dirSize(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      try {
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) {
          bytes += fs.statSync(p).size;
          files += 1;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return { bytes, files };
}

function categoryOf(name: string): DirUsage["category"] {
  if (CACHE_DIRS.has(name)) return "cache";
  if (SESSION_DIRS.has(name)) return "session";
  if (SKILL_DIRS.has(name)) return "skills";
  if (MEDIA_DIRS.has(name)) return "media";
  if (BACKUP_DIRS.has(name)) return "backup";
  return name.endsWith(".json") || name.endsWith(".jsonl") ? "config" : "other";
}

export function getDataRoot(): string {
  return app.getPath("userData");
}

export function scanDataUsage(): { root: string; entries: DirUsage[]; totalBytes: number; cleanableBytes: number } {
  const root = getDataRoot();
  const entries: DirUsage[] = [];
  let list: fs.Dirent[] = [];
  try {
    list = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { root, entries, totalBytes: 0, cleanableBytes: 0 };
  }
  for (const e of list) {
    if (e.name === "." || e.name === "..") continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      const { bytes, files } = dirSize(full);
      const cleanable = CACHE_DIRS.has(e.name);
      entries.push({
        name: e.name,
        path: full,
        kind: "dir",
        bytes,
        fileCount: files,
        cleanable,
        category: categoryOf(e.name),
      });
    } else if (e.isFile()) {
      try {
        const st = fs.statSync(full);
        entries.push({
          name: e.name,
          path: full,
          kind: "file",
          bytes: st.size,
          fileCount: 1,
          cleanable: false,
          category: categoryOf(e.name),
        });
      } catch {
        /* ignore */
      }
    }
  }
  entries.sort((a, b) => b.bytes - a.bytes);
  const totalBytes = entries.reduce((s, e) => s + e.bytes, 0);
  const cleanableBytes = entries.filter((e) => e.cleanable).reduce((s, e) => s + e.bytes, 0);
  return { root, entries, totalBytes, cleanableBytes };
}

/** 清理缓存目录（只删 CACHE_DIRS，不动会话/配置/技能/备份） */
export function cleanCaches(): { ok: boolean; freedBytes: number; cleaned: string[]; error?: string } {
  const root = getDataRoot();
  const cleaned: string[] = [];
  let freedBytes = 0;
  try {
    for (const name of CACHE_DIRS) {
      const p = path.join(root, name);
      if (!fs.existsSync(p)) continue;
      const { bytes } = dirSize(p);
      fs.rmSync(p, { recursive: true, force: true });
      cleaned.push(name);
      freedBytes += bytes;
    }
    return { ok: true, freedBytes, cleaned };
  } catch (e) {
    return { ok: false, freedBytes, cleaned, error: e instanceof Error ? e.message : String(e) };
  }
}

export function listImportantPaths(): Array<{ key: string; label: string; path: string; exists: boolean }> {
  const root = getDataRoot();
  const rel: Array<[string, string]> = [
    ["userData", "数据根目录"],
    ["model-settings.json", "模型配置"],
    ["app-settings.json", "应用设置"],
    ["cyrene-chats", "聊天会话"],
    ["cyrene-runs", "运行记录"],
    ["skills", "技能"],
    ["backups", "备份目录"],
    ["logs", "日志"],
  ];
  return rel.map(([name, label]) => {
    const p = name === "userData" ? root : path.join(root, name);
    return { key: name, label, path: p, exists: fs.existsSync(p) };
  });
}
