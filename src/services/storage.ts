/**
 * 双备份持久化服务：localStorage + Tauri 本地文件
 *
 * 读取优先级：localStorage → 文件 → 默认值
 * 写入策略：localStorage 立即写，文件防抖 1 秒写入
 *
 * 存储位置：
 * - `appdata`（默认）：C 盘 %APPDATA%\desk-pet\，用于敏感配置（含 API Key）
 * - `project`：项目目录 data/，用于非敏感持久化数据（sessions、memory 等）
 */

import { invoke } from '@tauri-apps/api/core';

/** 存储位置选项 */
export type StorageLocation = 'appdata' | 'project';

/** createStorage 配置选项 */
export interface StorageOptions {
  /** 存储位置：appdata=C 盘加密目录（默认），project=项目目录 */
  location?: StorageLocation;
  /** 项目目录下的子目录名（仅 location='project' 时生效，默认 'config'） */
  subdir?: string;
}

/**
 * 从 localStorage 读取
 */
function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`deskpet_${key}`);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // 忽略解析错误
  }
  return fallback;
}

/**
 * 写入 localStorage（同步，立即生效）
 */
function writeLocal<T>(key: string, data: T): void {
  try {
    localStorage.setItem(`deskpet_${key}`, JSON.stringify(data));
  } catch {
    // 忽略写入错误
  }
}

/**
 * 立即写入本地文件（异步，通过 Tauri Rust 命令，fire-and-forget）。
 *
 * 不使用防抖：原先的 1 秒防抖会在应用退出 / 设置窗销毁时丢失未落盘的写入，
 * 导致配置（如 LLM/TTS/STT provider、多模态）重启后丢失。改为每次 set/reset
 * 立即写文件，保证文件始终是跨窗口、跨重启的权威数据源（localStorage 仅作
 * 同会话缓存，且各 webview 的 localStorage 相互隔离）。
 */
function writeFileNow(key: string, data: unknown, options?: StorageOptions): void {
  const location = options?.location ?? 'appdata';
  if (location === 'project') {
    invoke('save_project_data', {
      key,
      data: JSON.stringify(data),
      subdir: options?.subdir ?? 'config',
    }).catch((err) => console.warn('[Storage] Tauri write failed:', err));
  } else {
    invoke('save_data', { key, data: JSON.stringify(data) }).catch((err) =>
      console.warn('[Storage] Tauri write failed:', err),
    );
  }
}

/**
 * 从本地文件读取（异步，启动时调用）
 */
async function readFile<T>(key: string, options?: StorageOptions): Promise<T | null> {
  try {
    const location = options?.location ?? 'appdata';
    const raw =
      location === 'project'
        ? await invoke<string>('load_project_data', {
            key,
            subdir: options?.subdir ?? 'config',
          })
        : await invoke<string>('load_data', { key });
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // 忽略错误
  }
  return null;
}

/**
 * 通用持久化存储
 *
 * @example
 * // 默认存到 C 盘（敏感配置）
 * const store = createStorage('settings', { apiKey: '' });
 *
 * // 存到项目目录（非敏感数据）
 * const store = createStorage('chat_sessions', { sessions: [] }, {
 *   location: 'project',
 *   subdir: 'sessions',
 * });
 */
export function createStorage<T>(key: string, defaultValue: T, options?: StorageOptions) {
  let currentData: T = readLocal(key, defaultValue);
  let initialized = false;

  return {
    /**
     * 初始化：从文件恢复（如果 localStorage 为空）
     */
    async init(): Promise<void> {
      if (initialized) return;
      initialized = true;

      // 检查 localStorage 是否有数据
      const localRaw = localStorage.getItem(`deskpet_${key}`);
      if (localRaw) return; // localStorage 有数据，不覆盖

      // localStorage 为空，尝试从文件恢复
      const fileData = await readFile<T>(key, options);
      if (fileData) {
        currentData = fileData;
        writeLocal(key, currentData);
      }
    },

    /**
     * 读取当前数据
     */
    get(): T {
      return currentData;
    },

    /**
     * 更新数据（合并或替换）
     */
    set(data: T | Partial<T>): void {
      if (
        typeof data === 'object' &&
        !Array.isArray(data) &&
        typeof currentData === 'object' &&
        !Array.isArray(currentData)
      ) {
        currentData = { ...currentData, ...data } as T;
      } else {
        currentData = data as T;
      }
      writeLocal(key, currentData);
      writeFileNow(key, currentData, options);
    },

    /**
     * 立即刷新文件（不防抖）
     */
    async flush(): Promise<void> {
      const location = options?.location ?? 'appdata';
      if (location === 'project') {
        await invoke('save_project_data', {
          key,
          data: JSON.stringify(currentData),
          subdir: options?.subdir ?? 'config',
        }).catch((err) => console.warn('[Storage] Tauri write failed:', err));
      } else {
        await invoke('save_data', { key, data: JSON.stringify(currentData) }).catch((err) =>
          console.warn('[Storage] Tauri write failed:', err),
        );
      }
    },

    /**
     * 重置为默认值
     */
    reset(): void {
      currentData = defaultValue;
      writeLocal(key, currentData);
      writeFileNow(key, currentData, options);
    },
  };
}
