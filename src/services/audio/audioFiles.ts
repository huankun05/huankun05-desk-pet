/**
 * audioFiles.ts — 预制台词音频的磁盘文件存取（规范落盘）
 *
 * 规范（见 docs/data-management.md）：
 * - 音频统一存到 <dataDir>/audio/interact/（dataDir = get_project_data_dir()）
 * - 文件名：<hash8>-<label>.wav（hash 为文本的稳定散列；label 为清洗后的文本前缀，便于人工识别）
 * - 写入/读取/删除全部经 Rust 命令（write_audio_file/read_audio_file/list_directory/delete_file），
 *   Rust 侧强制限制在项目数据目录内，杜绝路径穿越。
 */
import { isTauriEnv } from '../../utils/tauriEnv';
import { invoke } from '@tauri-apps/api/core';

/** 交互台词音频子目录（相对 dataDir） */
export const INTERACT_AUDIO_DIR = 'audio/interact';

export interface AudioFileEntry {
  name: string;
  size: number;
}

// ===== base64 <-> ArrayBuffer（分块避免调用栈溢出）=====

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** 从 WAV 头解析采样率（fmt 块第 24 字节 u32 LE）；解析失败回退 24000 */
export function parseWavSampleRate(buf: ArrayBuffer): number {
  try {
    const dv = new DataView(buf);
    if (dv.byteLength < 44 || dv.getUint32(0, false) !== 0x52494646) return 24000; // 'RIFF'
    return dv.getUint32(24, true);
  } catch {
    return 24000;
  }
}

/** 稳定散列（FNV-1a 变体，输出无符号 32 位） */
function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 清洗文件名标签：仅保留中英文/数字/下划线/连字符，路径分隔与非法字符一律剔除 */
function sanitizeLabel(s: string): string {
  return s.replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/[^\u4e00-\u9fa5A-Za-z0-9_-]/g, '');
}

/** 稳定、可读的音频文件名：<hash8>-<label10>.wav（同一文本永远同名，天然去重） */
export function audioFileNameOf(text: string): string {
  const hash = stableHash(text).toString(16).padStart(8, '0');
  const label = sanitizeLabel(text).slice(0, 10) || 'x';
  return `${hash}-${label}.wav`;
}

// ===== Tauri invoke 封装（isTauriEnv 守卫）=====

async function requireDataDir(): Promise<string> {
  if (!isTauriEnv()) throw new Error('not in tauri env');
  const dir = await invoke<string>('get_project_data_dir');
  return dir.replace(/\\/g, '/');
}

/** 写音频文件（相对 dataDir），返回相对路径（audio/interact/<name>.wav） */
export async function writeAudioFile(relPath: string, buf: ArrayBuffer): Promise<string> {
  const dir = await requireDataDir();
  await invoke('write_audio_file', {
    path: `${dir}/${relPath}`,
    base64Content: arrayBufferToBase64(buf),
  });
  return relPath;
}

/** 读音频文件，不存在/失败返回 null */
export async function readAudioFile(relPath: string): Promise<ArrayBuffer | null> {
  if (!isTauriEnv()) return null;
  try {
    const dir = await requireDataDir();
    const b64 = await invoke<string>('read_audio_file', { path: `${dir}/${relPath}` });
    return base64ToArrayBuffer(b64);
  } catch {
    return null;
  }
}

/** 列出子目录下的 wav 文件（仅文件名与大小） */
export async function listAudioFiles(subdir: string): Promise<AudioFileEntry[]> {
  if (!isTauriEnv()) return [];
  try {
    const dir = await requireDataDir();
    const entries = await invoke<{ name: string; is_dir: boolean; size: number }[]>(
      'list_directory',
      { path: `${dir}/${subdir}` },
    );
    return entries
      .filter((e) => !e.is_dir && e.name.toLowerCase().endsWith('.wav'))
      .map((e) => ({ name: e.name, size: e.size }));
  } catch {
    return [];
  }
}

/** 删除文件（相对 dataDir），成功返回 true */
export async function deleteAudioFile(relPath: string): Promise<boolean> {
  if (!isTauriEnv()) return false;
  try {
    const dir = await requireDataDir();
    await invoke('delete_file', { path: `${dir}/${relPath}` });
    return true;
  } catch {
    return false;
  }
}

/** 用系统文件管理器打开目录（Windows 资源管理器） */
export async function openAudioDir(subdir: string): Promise<void> {
  if (!isTauriEnv()) return;
  try {
    const dir = await requireDataDir();
    await invoke('open_path', { path: `${dir}/${subdir}` });
  } catch {
    /* ignore */
  }
}

/** 当前数据目录绝对路径（展示用），非 Tauri 环境返回 null */
export async function getDataDir(): Promise<string | null> {
  if (!isTauriEnv()) return null;
  try {
    return await requireDataDir();
  } catch {
    return null;
  }
}
