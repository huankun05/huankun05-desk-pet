import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

export type DirSizeInfo = {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  fileCount: number;
  bytes: number;
  /** 可安全清理 */
  cleanable: boolean;
};

export type StorageReport = {
  userData: string;
  appData: string;
  programDir: string;
  redirectFile: string;
  redirectTarget: string | null;
  envOverride: string | null;
  dirs: DirSizeInfo[];
  totalBytes: number;
  cleanableBytes: number;
};

/** 数据根重定向：在 userData 之外保存目标路径，避免迁移时找不到文件 */
export function getRedirectFilePath(): string {
  // 存在「固定品牌名」旁，不随 userData 变化
  return path.join(app.getPath("appData"), "live2d-cyrene.redirect");
}

export function readUserDataRedirect(): string | null {
  try {
    const p = getRedirectFilePath();
    if (!fs.existsSync(p)) return null;
    const v = fs.readFileSync(p, "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}

export function writeUserDataRedirect(target: string | null): string {
  const p = getRedirectFilePath();
  if (!target) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch { /* ignore */ }
    return "";
  }
  const abs = path.resolve(target);
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(p, abs, "utf8");
  return abs;
}

function dirStats(dir: string, skipCacheNames = false): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  if (!fs.existsSync(dir)) return { files: 0, bytes: 0 };
  const walk = (p: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) {
        if (skipCacheNames && /^(Cache|Code Cache|GPUCache|Dawn.*Cache|blob_storage)$/i.test(e.name)) {
          continue;
        }
        walk(full);
      } else if (e.isFile()) {
        try {
          bytes += fs.statSync(full).size;
          files += 1;
        } catch { /* ignore */ }
      }
    }
  };
  walk(dir);
  return { files, bytes };
}

const DIR_SPECS: Array<{ key: string; label: string; rel: string; cleanable: boolean }> = [
  { key: "chats", label: "聊天会话", rel: "cyrene-chats", cleanable: false },
  { key: "runs", label: "运行记录", rel: "cyrene-runs", cleanable: true },
  { key: "checkpoints", label: "检查点", rel: "checkpoints", cleanable: true },
  { key: "skills", label: "技能", rel: "skills", cleanable: false },
  { key: "skills-backup", label: "技能策展备份", rel: "skills-curator-backups", cleanable: true },
  { key: "backups", label: "应用备份", rel: "backups", cleanable: false },
  { key: "rag", label: "RAG 数据", rel: "rag-data", cleanable: true },
  { key: "channels", label: "渠道数据", rel: "channels", cleanable: false },
  { key: "screenshots", label: "截图", rel: "screenshots", cleanable: true },
  { key: "tts-cache", label: "TTS 缓存", rel: "cyrene-tts-cache", cleanable: true },
  { key: "music", label: "音乐", rel: "music", cleanable: false },
  { key: "logs", label: "日志", rel: "logs", cleanable: true },
  { key: "cache", label: "Chromium 缓存", rel: "Cache", cleanable: true },
  { key: "code-cache", label: "Code Cache", rel: "Code Cache", cleanable: true },
  { key: "gpu-cache", label: "GPU 缓存", rel: "GPUCache", cleanable: true },
  { key: "network-cache", label: "网络缓存", rel: "Network", cleanable: true },
  { key: "embedding-cache", label: "向量缓存文件", rel: "scene-embedding-cache.json", cleanable: true },
  { key: "sticker-cache", label: "表情向量缓存", rel: "sticker-embedding-cache.json", cleanable: true },
  { key: "tessdata", label: "OCR 数据", rel: "tessdata", cleanable: false },
];

export function buildStorageReport(): StorageReport {
  const userData = app.getPath("userData");
  const appData = app.getPath("appData");
  const programDir = process.cwd();
  const envOverride = (process.env.CYRENE_USER_DATA_DIR ?? "").trim() || null;
  const redirectTarget = readUserDataRedirect();

  const dirs: DirSizeInfo[] = DIR_SPECS.map((spec) => {
    const full = path.join(userData, spec.rel);
    const exists = fs.existsSync(full);
    let fileCount = 0;
    let bytes = 0;
    if (exists) {
      const st = fs.statSync(full);
      if (st.isFile()) {
        fileCount = 1;
        bytes = st.size;
      } else {
        const s = dirStats(full);
        fileCount = s.files;
        bytes = s.bytes;
      }
    }
    return {
      key: spec.key,
      label: spec.label,
      path: full,
      exists,
      fileCount,
      bytes,
      cleanable: spec.cleanable,
    };
  });

  // 根目录散落 JSON 体量
  const rootJsonBytes = (() => {
    try {
      return fs
        .readdirSync(userData)
        .filter((n) => n.endsWith(".json") || n.endsWith(".jsonl"))
        .reduce((sum, n) => {
          try {
            return sum + fs.statSync(path.join(userData, n)).size;
          } catch {
            return sum;
          }
        }, 0);
    } catch {
      return 0;
    }
  })();

  dirs.push({
    key: "config-json",
    label: "配置 JSON（根目录）",
    path: userData,
    exists: true,
    fileCount: 0,
    bytes: rootJsonBytes,
    cleanable: false,
  });

  const totalBytes = dirs.reduce((s, d) => s + d.bytes, 0);
  const cleanableBytes = dirs.filter((d) => d.cleanable).reduce((s, d) => s + d.bytes, 0);
  return {
    userData,
    appData,
    programDir,
    redirectFile: getRedirectFilePath(),
    redirectTarget,
    envOverride,
    dirs,
    totalBytes,
    cleanableBytes,
  };
}

function rmrf(target: string): void {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

export type CleanResult = { ok: boolean; freedBytes: number; cleaned: string[]; error?: string };

/** 清理指定 cleanable 项；keys 为空则清理全部 cleanable */
export function cleanStorage(keys?: string[]): CleanResult {
  try {
    const report = buildStorageReport();
    const set = keys && keys.length ? new Set(keys) : null;
    const targets = report.dirs.filter((d) => d.cleanable && (!set || set.has(d.key)));
    const cleaned: string[] = [];
    let freedBytes = 0;
    for (const d of targets) {
      if (!d.exists || d.bytes <= 0) continue;
      rmrf(d.path);
      cleaned.push(d.label);
      freedBytes += d.bytes;
    }
    return { ok: true, freedBytes, cleaned };
  } catch (e) {
    return { ok: false, freedBytes: 0, cleaned: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export function openPathInExplorer(target: string): void {
  const { shell } = require("electron") as typeof import("electron");
  void shell.openPath(target);
}
