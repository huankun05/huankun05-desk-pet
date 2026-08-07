/**
 * 跨窗口设置页跳转
 * =================
 * 主窗口（角色模型）与设置窗口是独立的 Tauri WebView。
 * 两者 localStorage 共享，但 storage 事件不跨 WebView 传播，
 * 因此用「写入待跳转路径 + 打开设置窗口」的方式实现深链：
 *   1. 主窗口把目标路由写入 localStorage 的待跳转键
 *   2. show_settings_window 把设置窗口带到前台
 *   3. 设置窗口挂载时读取该键并 navigate，然后清空
 * 这样既能从任意位置一键跳到具体设置页，又规避了事件竞态。
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauriEnv } from './tauriEnv';

const PENDING_PATH_KEY = 'deskpet_pendingSettingsPath';

/**
 * 打开设置窗口并跳转到指定路由（基于 createHashRouter 的 path，如 '/settings/services/llm'）。
 * 非 Tauri 环境下静默返回，不抛错。
 */
export async function openSettingsAt(path: string): Promise<void> {
  if (!isTauriEnv()) return;
  try {
    localStorage.setItem(PENDING_PATH_KEY, path);
  } catch {
    /* localStorage 不可用时忽略，仅打开设置窗口 */
  }
  try {
    await invoke('show_settings_window');
  } catch {
    /* 窗口打开失败时忽略 */
  }
}

/** 设置窗口挂载时调用：若存在待跳转路径则返回并清掉 */
export function consumePendingSettingsPath(): string | null {
  try {
    const pending = localStorage.getItem(PENDING_PATH_KEY);
    if (pending) {
      localStorage.removeItem(PENDING_PATH_KEY);
      return pending;
    }
  } catch {
    /* ignore */
  }
  return null;
}
