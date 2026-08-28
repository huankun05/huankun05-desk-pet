import { useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import { isTauriEnv } from '../utils/tauriEnv';
import { loadOrbPos, computeOrbDefaultPos, getMainRect } from '../utils/orbPosition';
import { createLogger } from '../utils/logger';

const log = createLogger('PanelWindows');

export interface PanelWindowsState {
  toggleStatusPanel: () => Promise<void>;
  toggleChatPanel: () => Promise<void>;
  openSettingsPanel: () => Promise<void>;
  openControlsOrb: () => Promise<void>;
}

export function usePanelWindows(): PanelWindowsState {
  const { t } = useTranslation();
  const statusWinRef = useRef<WebviewWindow | null>(null);
  const chatWinRef = useRef<WebviewWindow | null>(null);
  const settingsWinRef = useRef<WebviewWindow | null>(null);
  const controlsWinRef = useRef<WebviewWindow | null>(null);

  // 创建聊天面板窗口。visible=false 用于预加载；backgroundColor 消除 WebView 创建瞬间的白闪。
  const createChatWindow = useCallback(
    async (visible: boolean): Promise<WebviewWindow | null> => {
      try {
        const mainWin = getCurrentWindow();
        const mainPos = await mainWin.outerPosition();
        await mainWin.outerSize();
        let panelW = 820,
          panelH = 460,
          panelX: number | undefined,
          panelY: number | undefined;
        try {
          let raw = localStorage.getItem('deskpet_chat_geometry');
          if (!raw) raw = await invoke<string>('load_data', { key: 'chat_panel_size' });
          if (raw) {
            const s = JSON.parse(raw);
            panelW = s.w || 850;
            // 旧默认 620/540 过高导致底部空白，读取时若超过 520 则重置为 460
            panelH = s.h && s.h <= 520 ? s.h : 460;
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
          visible,
          backgroundColor: '#f2f3f5',
        });
        chatWinRef.current = win;

        win.once('tauri://destroyed', () => {
          if (chatWinRef.current === win) {
            chatWinRef.current = null;
          }
        });
        return win;
      } catch (err) {
        log.error('Failed to create chat panel:', err);
        return null;
      }
    },
    [t],
  );

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

    // 预加载聊天面板：隐藏创建，点击时秒开（避免每次重建 + 白闪）
    const preloadChat = async () => {
      try {
        const existing = await WebviewWindow.getByLabel('chat-panel');
        if (existing) {
          chatWinRef.current = existing;
          return;
        }
        const win = await createChatWindow(false);
        if (disposed && win) {
          win.close().catch(() => {});
        }
      } catch (err) {
        log.warn('Chat window preload failed (will create on demand):', err);
      }
    };

    // 延迟一点启动，避免和主窗口初始化竞争
    const timer = setTimeout(() => {
      preload();
      preloadChat();
    }, 800);

    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [createChatWindow]);

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
    // 优先走 Rust 命令 show_chat_window：用同一套 Rust 窗口 API 强制置顶，
    // 可靠地从「最小化 / 隐藏」态唤回（纯 JS 的 unminimize 在最小化态还原不可靠）。
    // 注意：Rust 命令只在窗口已存在时成功；不存在（预加载未就绪）时回退到 JS 创建。
    try {
      await invoke('show_chat_window');
      return;
    } catch {
      /* 窗口尚未创建 → 走 JS 兜底 */
    }
    // 兜底：预加载尚未就绪时按需创建并立即可见
    try {
      await createChatWindow(true);
    } catch (err) {
      log.error('Failed to create chat panel:', err);
    }
  }, [createChatWindow]);

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

  // 同步创建锁：在 await 之前即设为 true，彻底封死 StrictMode 双调用竞态
  // （StrictMode 在 dev 下会 mount→cleanup→mount，两次 mount 之间若第一次卡在 await，
  //   ref 仍为 null → 第二次也通过守卫 → 创建两个窗口。此锁在进入函数瞬间即设。）
  const creatingRef = useRef(false);

  const openControlsOrb = useCallback(async () => {
    if (!isTauriEnv()) return;
    try {
      // ── 同步守卫（三层）防止重复创建 ──
      // ① 已有窗口引用
      if (controlsWinRef.current) {
        try {
          await controlsWinRef.current.show();
        } catch {
          /* ignore */
        }
        return;
      }
      // ② 正在创建中（StrictMode 第二次 mount 或快速重复点击）
      if (creatingRef.current) return;
      creatingRef.current = true;

      // 异步守卫：防止多个并发调用绕过同步守卫（如热更新后残留旧窗）
      const existing = await WebviewWindow.getByLabel('controls');
      if (existing) {
        controlsWinRef.current = existing;
        creatingRef.current = false;
        try {
          await existing.show();
        } catch {
          /* ignore */
        }
        return;
      }

      // 优先恢复上次保存的位置（deskpet_orb_pos，逻辑像素屏幕坐标），
      // 与 ControlsOrb 的 restorePos / onMoved 写入保持一致。
      // 若保存值越界（例如早期调试残留的无效坐标）→ 回退到「贴角色」默认位，
      // 避免悬浮球被开到可视区域之外而永远看不见。
      let dftX: number;
      let dftY: number;
      const saved = await loadOrbPos();
      if (saved) {
        dftX = saved.x;
        dftY = saved.y;
      } else {
        const main = await getMainRect();
        const d = await computeOrbDefaultPos(main);
        dftX = d.x;
        dftY = d.y;
      }

      const win = new WebviewWindow('controls', {
        url: '?panel=controls',
        title: '控制',
        // 窗口尺寸 = 收起态（仅小圆）。展开面板时由 ControlsOrb 用 setSize 动态放大，
        // 绝不再开 300×420 大窗口——否则透明区会整片捕获点击、视觉上像一圈窗框阴影。
        width: 60,
        height: 60,
        x: dftX,
        y: dftY,
        transparent: true,
        decorations: false,
        shadow: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        visible: true,
        focus: false,
      });

      // 诊断：窗口创建若失败，Tauri 会以异步事件抛出，try/catch 抓不到，必须监听
      win.once('tauri://error', (e) => {
        log.error('[controls] window creation failed:', e);
      });
      win.once('tauri://created', () => {
        log.info('[controls] orb window created & visible');
      });

      win.once('tauri://destroyed', () => {
        controlsWinRef.current = null;
        creatingRef.current = false;
      });
      controlsWinRef.current = win;
      creatingRef.current = false;
    } catch (err) {
      creatingRef.current = false;
      log.warn('Failed to create controls orb window:', err);
    }
  }, []);

  return {
    toggleStatusPanel,
    toggleChatPanel,
    openSettingsPanel,
    openControlsOrb,
  };
}
