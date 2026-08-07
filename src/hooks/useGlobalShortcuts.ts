/**
 * 全局快捷键管理 Hook
 *
 * 监听 Rust 侧全局快捷键事件，分发到对应动作。
 * 快捷键在 Rust 侧注册（tauri-plugin-global-shortcut），
 * 前端通过 listen() 接收事件。
 */

import { useEffect, useCallback, useRef } from 'react';
import { isTauriEnv } from '../utils/tauriEnv';
import { createLogger } from '../utils/logger';

const log = createLogger('GlobalShortcuts');

export interface ShortcutActions {
  onVoiceWake: () => void;
  onScreenshotAnalyze: () => void;
}

export function useGlobalShortcuts(actions: ShortcutActions) {
  const actionsRef = useRef(actions);

  // 在 effect 中更新 ref，避免在 render 中访问/修改 ref
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  const handleVoiceWake = useCallback(() => {
    log.info('Voice wake shortcut triggered');
    actionsRef.current.onVoiceWake();
  }, []);

  const handleScreenshot = useCallback(() => {
    log.info('Screenshot shortcut triggered');
    actionsRef.current.onScreenshotAnalyze();
  }, []);

  useEffect(() => {
    if (!isTauriEnv()) return;

    let unlisteners: Array<() => void> = [];

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');

      const u1 = await listen('shortcut-voice', () => {
        handleVoiceWake();
      });
      const u2 = await listen('shortcut-screenshot', () => {
        handleScreenshot();
      });

      unlisteners = [u1, u2];
      log.info('Global shortcut listeners registered');
    })().catch((err) => {
      log.error('Failed to register shortcut listeners:', err);
    });

    return () => {
      unlisteners.forEach((u) => u());
    };
  }, [handleVoiceWake, handleScreenshot]);
}
