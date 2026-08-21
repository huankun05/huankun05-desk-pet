import { useState, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauriEnv } from '../utils/tauriEnv';

const MODE_STORAGE_KEY = 'deskpet_mode';
export const MODE_CHANGED_EVENT = 'mode-changed';

/** 'auto' = 由后端意图分类器按消息动态决定工具（默认）；'chat'/'work' 为显式固定模式兜底。 */
export type AppMode = 'auto' | 'chat' | 'work';

/** 从 localStorage 读取模式，带默认值和校验。 */
function readMode(): AppMode {
  try {
    const m = localStorage.getItem(MODE_STORAGE_KEY);
    return m === 'work' || m === 'chat' || m === 'auto' ? m : 'auto';
  } catch {
    return 'auto';
  }
}

/** 写入 localStorage 并广播变更事件（跨 webview 同步）。 */
function writeMode(mode: AppMode): void {
  localStorage.setItem(MODE_STORAGE_KEY, mode);
  if (isTauriEnv()) {
    // 用 Tauri 事件广播，其他窗口的 useMode 监听器会自动更新
    type TauriGlobal = {
      __TAURI__?: {
        emit: (event: string, payload?: unknown) => Promise<unknown>;
      };
    };
    (window as unknown as TauriGlobal).__TAURI__
      ?.emit(MODE_CHANGED_EVENT, { mode })
      .catch(() => {});
  }
}

/**
 * 共享的模式状态 hook。
 *
 * - 读/写 localStorage('deskpet_mode')
 * - 切换时通过 Tauri emit 广播 mode-changed 事件（替代轮询）
 * - 自动监听来自其他窗口的 mode-changed 事件
 * - 返回 { mode, setMode, isWorkMode, toggleMode }
 */
export function useMode() {
  const [mode, setModeState] = useState<AppMode>(readMode);

  // 监听跨窗广播
  useEffect(() => {
    if (!isTauriEnv()) return;
    let unlisten: (() => void) | undefined;
    listen<{ mode: AppMode }>(MODE_CHANGED_EVENT, (e) => {
      if (e.payload?.mode === 'work' || e.payload?.mode === 'chat') {
        setModeState(e.payload.mode);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const setMode = useCallback(
    (next: AppMode) => {
      if (next === mode) return;
      setModeState(next);
      writeMode(next);
    },
    [mode],
  );

  const toggleMode = useCallback(() => {
    setMode(mode === 'chat' ? 'work' : 'chat');
  }, [mode, setMode]);

  return {
    mode,
    setMode,
    isWorkMode: mode === 'work',
    toggleMode,
  } as const;
}
