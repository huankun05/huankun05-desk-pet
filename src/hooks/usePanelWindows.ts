import { useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import { isTauriEnv } from '../utils/tauriEnv';
import { createLogger } from '../utils/logger';

const log = createLogger('PanelWindows');

export interface PanelWindowsState {
  toggleStatusPanel: () => Promise<void>;
  toggleChatPanel: () => Promise<void>;
  openSettingsPanel: () => Promise<void>;
}

export function usePanelWindows(): PanelWindowsState {
  const { t } = useTranslation();
  const statusWinRef = useRef<WebviewWindow | null>(null);
  const chatWinRef = useRef<WebviewWindow | null>(null);
  const settingsWinRef = useRef<WebviewWindow | null>(null);

  // 预加载设置窗口：应用启动时创建好隐藏，点击时秒开
  useEffect(() => {
    if (!isTauriEnv()) return;

    let disposed = false;

    const preload = async () => {
      try {
        // 检查是否已有同名窗口
        const existing = await WebviewWindow.getByLabel('settings');
        if (existing) {
          settingsWinRef.current = existing;
          return;
        }

        const settingsUrl = import.meta.env.DEV
          ? 'http://localhost:1420/settings.html'
          : '/settings.html';

        const win = new WebviewWindow('settings', {
          url: settingsUrl,
          title: '设置',
          width: 900,
          height: 680,
          minWidth: 600,
          minHeight: 400,
          decorations: true,
          transparent: false,
          alwaysOnTop: false,
          resizable: true,
          skipTaskbar: false,
          visible: false,
          focus: false,
        });

        if (disposed) {
          win.close().catch(() => {});
          return;
        }

        settingsWinRef.current = win;

        win.once('tauri://destroyed', () => {
          if (settingsWinRef.current === win) {
            settingsWinRef.current = null;
          }
        });
      } catch (err) {
        log.warn('Settings window preload failed (will create on demand):', err);
      }
    };

    // 延迟一点启动，避免和主窗口初始化竞争
    const timer = setTimeout(preload, 800);

    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);

  const toggleStatusPanel = useCallback(async () => {
    if (statusWinRef.current) {
      try {
        await statusWinRef.current.close();
        statusWinRef.current = null;
        return;
      } catch {
        statusWinRef.current = null;
      }
    }
    try {
      const mainWin = getCurrentWindow();
      const mainPos = await mainWin.outerPosition();
      const mainSize = await mainWin.outerSize();
      let panelW = 420,
        panelH = 700,
        panelX: number | undefined,
        panelY: number | undefined;
      try {
        let raw = localStorage.getItem('deskpet_status_geometry');
        if (!raw) raw = await invoke<string>('load_data', { key: 'status_panel_size' });
        if (raw) {
          const s = JSON.parse(raw);
          panelW = s.w || 420;
          panelH = s.h || 700;
          panelX = s.x;
          panelY = s.y;
        }
      } catch {
        /* ignore */
      }

      const win = new WebviewWindow('status-panel', {
        url: '?panel=status',
        title: t('window.status'),
        width: panelW,
        height: panelH,
        x: panelX ?? mainPos.x + mainSize.width + 5,
        y: panelY ?? Math.max(0, mainPos.y - 50),
        decorations: true,
        resizable: true,
      });
      statusWinRef.current = win;
    } catch (err) {
      log.error('Failed to create status panel:', err);
    }
  }, [t]);

  const toggleChatPanel = useCallback(async () => {
    if (chatWinRef.current) {
      try {
        await chatWinRef.current.close();
        chatWinRef.current = null;
        return;
      } catch {
        chatWinRef.current = null;
      }
    }
    try {
      const mainWin = getCurrentWindow();
      const mainPos = await mainWin.outerPosition();
      await mainWin.outerSize();
      let panelW = 400,
        panelH = 600,
        panelX: number | undefined,
        panelY: number | undefined;
      try {
        let raw = localStorage.getItem('deskpet_chat_geometry');
        if (!raw) raw = await invoke<string>('load_data', { key: 'chat_panel_size' });
        if (raw) {
          const s = JSON.parse(raw);
          panelW = s.w || 400;
          panelH = s.h || 600;
          panelX = s.x;
          panelY = s.y;
        }
      } catch {
        /* ignore */
      }

      const win = new WebviewWindow('chat-panel', {
        url: '?panel=chat',
        title: t('window.chat'),
        width: panelW,
        height: panelH,
        x: panelX ?? mainPos.x - panelW - 5,
        y: panelY ?? Math.max(0, mainPos.y),
        decorations: false,
        resizable: true,
      });
      chatWinRef.current = win;
    } catch (err) {
      log.error('Failed to create chat panel:', err);
    }
  }, [t]);

  const openSettingsPanel = useCallback(async () => {
    if (!isTauriEnv()) return;

    // 优先走 Rust 命令：无论窗口隐藏/最小化/被遮挡都强制带到前台
    try {
      await invoke('show_settings_window');
      return;
    } catch {
      /* fallback 到 JS 逻辑 */
    }

    let win = settingsWinRef.current;
    if (!win) {
      try {
        win = (await WebviewWindow.getByLabel('settings')) as WebviewWindow | null;
        if (win) settingsWinRef.current = win;
      } catch {
        /* ignore */
      }
    }

    if (win) {
      try {
        // 设置窗口现在走 Rust 命令 show_settings_window 统一管理置顶策略：
        // 临时取消主窗口置顶，让设置窗口以普通窗口 Z 序显示。
        // 这里仅做辅助的 show/focus（Rust 命令优先）。
        try {
          await win.unminimize();
        } catch {
          /* ignore */
        }
        await win.show();
        await win.setFocus();
        return;
      } catch {
        settingsWinRef.current = null;
      }
    }

    // fallback：预加载失败时按需创建
    try {
      const settingsUrl = import.meta.env.DEV
        ? 'http://localhost:1420/settings.html'
        : '/settings.html';

      const newWin = new WebviewWindow('settings', {
        url: settingsUrl,
        title: '设置',
        width: 900,
        height: 680,
        minWidth: 600,
        minHeight: 400,
        decorations: true,
        transparent: false,
        alwaysOnTop: false, // 设置窗口以普通窗口显示，Rust 侧会临时取消主窗口置顶
        resizable: true,
        skipTaskbar: false,
        visible: true,
      });

      settingsWinRef.current = newWin;

      newWin.once('tauri://destroyed', () => {
        if (settingsWinRef.current === newWin) {
          settingsWinRef.current = null;
        }
      });
    } catch (err) {
      log.error('Failed to create settings window:', err);
    }
  }, []);

  return {
    toggleStatusPanel,
    toggleChatPanel,
    openSettingsPanel,
  };
}
