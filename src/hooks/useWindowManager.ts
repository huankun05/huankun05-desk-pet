import { useState, useEffect, useRef, useCallback } from 'react';
import { getCurrentWindow, LogicalSize, LogicalPosition } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { settingsStorage } from '../services/storage/settingsStorage';
import { isTauriEnv } from '../utils/tauriEnv';
import { createLogger } from '../utils/logger';
import { useStorageEvent } from './useStorageEvent';
import type { ControlsIslandHandle } from '../components/Pet/ControlsIsland';

const log = createLogger('WindowManager');

/** 窗口贴近屏幕边缘时触发吸附/对齐的距离阈值（逻辑像素） */
const EDGE_THRESHOLD = 40;

function _isPositionOnScreen(x: number, y: number, winW: number, winH: number): boolean {
  const s = window.screen as Screen & { availLeft?: number; availTop?: number };
  const minVisible = 80;
  const left = x + winW - minVisible;
  const top = y + winH - minVisible;
  const right = x + minVisible;
  const bottom = y + minVisible;
  if (
    left >= (s.availLeft ?? 0) &&
    right <= (s.availLeft ?? 0) + (s.availWidth ?? 1920) &&
    top >= (s.availTop ?? 0) &&
    bottom <= (s.availTop ?? 0) + (s.availHeight ?? 1080)
  ) {
    return true;
  }
  return false;
}

export interface ModelConfigShape {
  windowWidth: number;
  windowHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  chatExtraHeight: number;
  feetOffset: number;
  headYRatio: number;
  bubbleHeight: number;
  modelWidthRatio: number;
}

export interface WindowManagerState {
  petScale: number;
  setPetScale: React.Dispatch<React.SetStateAction<number>>;
  edgeSnap: boolean;
  setEdgeSnap: (snap: boolean) => void;
  controlsEdge: 'left' | 'right' | 'none';
  isLocked: boolean;
  toggleLock: () => void;
  isTransforming: boolean;
  toggleTransform: () => void;
  fadeOnHover: boolean;
  toggleFadeOnHover: () => void;
  isHovering: boolean;
  setIsHovering: (hovering: boolean) => void;
  isTop: boolean;
  toggleTop: () => void;
  zoomFactor: number;
}

export interface UseWindowManagerOptions {
  modelConfig: ModelConfigShape;
  modelInfo: { canvasWidth: number; canvasHeight: number } | null;
  controlsIslandRef: React.RefObject<ControlsIslandHandle | null>;
}

export function useWindowManager({
  modelConfig,
  modelInfo,
  controlsIslandRef: _controlsIslandRef,
}: UseWindowManagerOptions): WindowManagerState {
  const [petScale, setPetScale] = useState(() => settingsStorage.get().petScale);
  const [edgeSnap, setEdgeSnap] = useState(() => settingsStorage.get().edgeSnap);
  const [controlsEdge, setControlsEdge] = useState<'left' | 'right' | 'none'>('none');
  const [isLocked, setIsLocked] = useState(true);
  const [isTransforming, setIsTransforming] = useState(false);
  const [fadeOnHover, setFadeOnHover] = useState(true);
  const [isHovering, setIsHovering] = useState(false);
  const [isTop, setIsTop] = useState(false);
  const [zoomFactor, setZoomFactor] = useState(1.0);
  const [windowPosMemory, setWindowPosMemory] = useState(
    () => localStorage.getItem('deskpet_window_pos_memory') !== 'false',
  );
  const windowPosMemoryRef = useRef(windowPosMemory);

  const winMetricsRef = useRef<{
    pos: { x: number; y: number };
    width: number;
    height: number;
  } | null>(null);
  const initialPosRestoredRef = useRef(false);
  const fadeOnHoverRef = useRef(fadeOnHover);

  useEffect(() => {
    fadeOnHoverRef.current = fadeOnHover;
  }, [fadeOnHover]);

  // 窗口位置记忆开关：跨窗口（设置页）实时同步
  useStorageEvent(
    'deskpet_window_pos_memory',
    (newValue) => {
      setWindowPosMemory(newValue !== 'false');
    },
    [],
  );

  useEffect(() => {
    windowPosMemoryRef.current = windowPosMemory;
  }, [windowPosMemory]);

  const clampWindowPosition = useCallback(async (x: number, y: number, w: number, h: number) => {
    try {
      const result = await invoke<[number, number]>('clamp_window_position', { x, y, w, h });
      if (result && result.length === 2) {
        return { x: result[0], y: result[1] };
      }
    } catch {
      const s = window.screen as Screen & { availLeft?: number; availTop?: number };
      const screenLeft = s.availLeft ?? 0;
      const screenTop = s.availTop ?? 0;
      const screenW = s.availWidth ?? 1920;
      const screenH = s.availHeight ?? 1080;
      const clampedX = Math.max(screenLeft, Math.min(screenLeft + screenW - w, x));
      const clampedY = Math.max(screenTop, Math.min(screenTop + screenH - h, y));
      if (isTauriEnv()) {
        try {
          const win = getCurrentWindow();
          if (Math.abs(clampedX - x) > 0.5 || Math.abs(clampedY - y) > 0.5) {
            win
              .setPosition(new LogicalPosition(clampedX, clampedY))
              .catch((err) => console.warn('[WindowManager] setPosition failed:', err));
          }
        } catch {
          /* ignore */
        }
      }
      return { x: clampedX, y: clampedY };
    }
    return { x, y };
  }, []);

  useEffect(() => {
    if (!isTauriEnv()) return;
    let unlistenMoved: (() => void) | undefined;
    try {
      const win = getCurrentWindow();
      const dpr = window.devicePixelRatio || 1;

      Promise.all([win.outerPosition(), win.outerSize()]).then(([pos, size]) => {
        winMetricsRef.current = {
          pos: { x: pos.x / dpr, y: pos.y / dpr },
          width: size.width / dpr,
          height: size.height / dpr,
        };
        updatePlacement();
      });

      let saveTimer: ReturnType<typeof setTimeout> | null = null;
      let placementTimer: ReturnType<typeof setTimeout> | null = null;
      const isSnappingRef = { current: false };

      const updatePlacement = () => {
        if (isSnappingRef.current) return;
        const currentEdgeSnap = settingsStorage.get().edgeSnap;
        if (currentEdgeSnap === false) {
          setControlsEdge('none');
          return;
        }
        const m = winMetricsRef.current;
        if (!m) return;
        const s = window.screen as Screen & { availLeft?: number; availTop?: number };
        const screenW = s.availWidth ?? 1920;
        const screenLeft = s.availLeft ?? 0;

        const distLeft = m.pos.x - screenLeft;
        const distRight = screenLeft + screenW - (m.pos.x + m.width);

        let newEdge: 'left' | 'right' | 'none';
        if (distLeft <= EDGE_THRESHOLD && distLeft <= distRight) {
          newEdge = 'left';
        } else if (distRight <= EDGE_THRESHOLD) {
          newEdge = 'right';
        } else {
          newEdge = 'none';
        }

        if (newEdge !== 'none' && newEdge !== controlsEdge) {
          const targetX = newEdge === 'left' ? screenLeft : screenLeft + screenW - m.width;
          smoothSnapToEdge(targetX, m.pos.y);
        }
        setControlsEdge((prev) => (prev === newEdge ? prev : newEdge));
      };

      const smoothSnapToEdge = (targetX: number, targetY: number) => {
        if (!winMetricsRef.current) return;
        isSnappingRef.current = true;
        const startX = winMetricsRef.current.pos.x;
        const startY = winMetricsRef.current.pos.y;
        const duration = 250;
        const startTime = performance.now();

        const animate = (currentTime: number) => {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const easeProgress = 1 - Math.pow(1 - progress, 3);

          const currentX = startX + (targetX - startX) * easeProgress;
          const currentY = startY + (targetY - startY) * easeProgress;

          win
            .setPosition(new LogicalPosition(currentX, currentY))
            .catch((err) => console.warn('[WindowManager] setPosition failed:', err));

          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            if (winMetricsRef.current) {
              winMetricsRef.current.pos = { x: targetX, y: targetY };
            }
            isSnappingRef.current = false;
          }
        };

        requestAnimationFrame(animate);
      };

      win
        .onMoved((e) => {
          if (isSnappingRef.current) return;
          if (!winMetricsRef.current) {
            win.outerSize().then((size) => {
              winMetricsRef.current = {
                pos: { x: e.payload.x / dpr, y: e.payload.y / dpr },
                width: size.width / dpr,
                height: size.height / dpr,
              };
            });
            return;
          }
          const newX = e.payload.x / dpr;
          const newY = e.payload.y / dpr;
          winMetricsRef.current.pos = { x: newX, y: newY };

          if (placementTimer) clearTimeout(placementTimer);
          placementTimer = setTimeout(updatePlacement, 300);

          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            if (!windowPosMemoryRef.current) return;
            const m = winMetricsRef.current;
            if (m)
              invoke('save_data', { key: 'main_window_pos', data: JSON.stringify(m.pos) }).catch(
                () => {},
              );
          }, 500);
        })
        .then((fn) => {
          unlistenMoved = fn;
        });
    } catch (err) {
      log.warn('Window position tracking failed:', err);
    }
    return () => {
      unlistenMoved?.();
    };
  }, [controlsEdge]);

  useEffect(() => {
    if (!isTauriEnv()) return;
    if (!modelConfig.windowWidth) return;
    if (!modelInfo) return;
    if (initialPosRestoredRef.current) return;

    const win = getCurrentWindow();

    // Hide window during position restoration to avoid visible jump
    win.hide().catch(() => {});

    const baseW = modelConfig.windowWidth;
    const actualCanvasW = modelInfo.canvasWidth;
    const actualCanvasH = modelInfo.canvasHeight;
    const modelAspect = actualCanvasH / actualCanvasW;
    const TOOLBAR_H = 56;
    const BUBBLE_H = modelConfig.bubbleHeight ?? 30;
    const desiredW = Math.round(baseW * petScale);
    const actualW = Math.max(256, desiredW);
    const actualH = BUBBLE_H + Math.round(actualW * modelAspect) + TOOLBAR_H;

    initialPosRestoredRef.current = true;

    invoke<string>('load_data', { key: 'main_window_pos' })
      .then(async (raw) => {
        let posX: number;
        let posY: number;

        if (raw && windowPosMemory) {
          const savedPos = JSON.parse(raw);
          posX = savedPos.x;
          posY = savedPos.y;
        } else {
          const s = window.screen as Screen & { availLeft?: number; availTop?: number };
          const screenW = s.availWidth ?? 1920;
          const screenH = s.availHeight ?? 1080;
          posX = (s.availLeft ?? 0) + screenW - actualW - 100;
          posY = (s.availTop ?? 0) + screenH - actualH;
        }

        const clamped = await clampWindowPosition(posX, posY, actualW, actualH);

        win
          .setSize(new LogicalSize(actualW, actualH))
          .catch((err) => console.warn('[WindowManager] setSize failed:', err));
        win
          .setPosition(new LogicalPosition(clamped.x, clamped.y))
          .catch((err) => console.warn('[WindowManager] setPosition failed:', err))
          .then(() => win.show().catch(() => {}));

        winMetricsRef.current = {
          pos: { x: clamped.x, y: clamped.y },
          width: actualW,
          height: actualH,
        };

        if (edgeSnap === false) {
          setControlsEdge('none');
        } else {
          const s = window.screen as Screen & { availLeft?: number; availTop?: number };
          const screenW = s.availWidth ?? 1920;
          const screenLeft = s.availLeft ?? 0;
          const distLeft = clamped.x - screenLeft;
          const distRight = screenLeft + screenW - (clamped.x + actualW);
          let initialEdge: typeof controlsEdge;
          if (distLeft <= EDGE_THRESHOLD && distLeft <= distRight) {
            initialEdge = 'left';
          } else if (distRight <= EDGE_THRESHOLD) {
            initialEdge = 'right';
          } else {
            initialEdge = 'none';
          }
          setControlsEdge(initialEdge);
        }
      })
      .catch(() => {});
  }, [modelConfig, modelInfo, petScale, clampWindowPosition, edgeSnap, windowPosMemory]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTransforming) setIsTransforming(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isTransforming]);

  useEffect(() => {
    if (!isTauriEnv()) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('edge_snap_changed', (event) => {
        const newValue = event.payload as boolean;
        setEdgeSnap(newValue);
        settingsStorage.set({ ...settingsStorage.get(), edgeSnap: newValue });
      }).then((u) => {
        unlisten = u;
      });
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriEnv()) return;
    if (!initialPosRestoredRef.current) return;
    try {
      const appWindow = getCurrentWindow();
      const baseW = modelConfig.windowWidth;
      const actualCanvasW = modelInfo?.canvasWidth ?? modelConfig.canvasWidth;
      const actualCanvasH = modelInfo?.canvasHeight ?? modelConfig.canvasHeight;
      const modelAspect = actualCanvasH / actualCanvasW;
      const TOOLBAR_H = 56;
      const BUBBLE_H = modelConfig.bubbleHeight ?? 30;
      const MIN_W = 256;

      const desiredW = Math.round(baseW * petScale);

      let actualW: number;
      let actualH: number;
      let zoomFactorVal: number;

      if (desiredW >= MIN_W) {
        actualW = desiredW;
        actualH = BUBBLE_H + Math.round(desiredW * modelAspect) + TOOLBAR_H;
        zoomFactorVal = 1.0;
      } else {
        actualW = MIN_W;
        zoomFactorVal = desiredW / MIN_W;
        const petH = Math.round(MIN_W * modelAspect * zoomFactorVal);
        actualH = BUBBLE_H + petH + TOOLBAR_H;
      }

      // eslint-disable-next-line react-hooks/set-state-in-effect
      setZoomFactor(zoomFactorVal);

      const metrics = winMetricsRef.current;
      if (metrics) {
        const newY = metrics.pos.y + metrics.height - actualH;
        metrics.width = actualW;
        metrics.height = actualH;
        appWindow
          .setSize(new LogicalSize(actualW, actualH))
          .catch((err) => console.warn('[WindowManager] setSize failed:', err));
        appWindow
          .setPosition(new LogicalPosition(metrics.pos.x, newY))
          .then(() => {
            clampWindowPosition(metrics.pos.x, newY, actualW, actualH).then((clamped) => {
              if (winMetricsRef.current) {
                winMetricsRef.current.pos = clamped;
                winMetricsRef.current.width = actualW;
                winMetricsRef.current.height = actualH;
              }
            });
          })
          .catch(() => {});
      } else {
        appWindow.setSize(new LogicalSize(actualW, actualH)).catch(() => {});
      }
    } catch (err) {
      log.warn('Window sizing failed:', err);
    }
  }, [petScale, modelConfig, modelInfo, clampWindowPosition]);

  useEffect(() => {
    settingsStorage.set({ petScale });
  }, [petScale]);

  useEffect(() => {
    if (!isTauriEnv()) return;
    const appWindow = getCurrentWindow();
    if (!isLocked) {
      appWindow.setIgnoreCursorEvents(false).catch(() => {});
      return;
    }
    appWindow.setIgnoreCursorEvents(true).catch(() => {});

    const MARGIN = 20;
    let lastInteractive = false;
    let lastHovering = false;
    let timerId: ReturnType<typeof setInterval>;

    const check = async () => {
      // 窗口不可见时跳过：该检测每 100ms 触发一次 IPC，后台空转对常驻应用是显著的
      // 电量与 CPU 开销，而此时既无鼠标穿透需求、也无悬停淡出需求。
      if (document.hidden) return;
      try {
        // 获取实际控制面板的 DOM 边界（比硬编码常量更可靠）
        const island = document.querySelector('.controls-island') as HTMLElement | null;
        let xMin = 0,
          xMax = 0,
          yMin = 0,
          yMax = 0;
        if (island) {
          const rect = island.getBoundingClientRect();
          xMin = rect.left - MARGIN;
          xMax = rect.right + MARGIN;
          yMin = rect.top - MARGIN;
          yMax = rect.bottom + MARGIN;
        }

        const info = await invoke<{
          cursor_x: number;
          cursor_y: number;
          window_x: number;
          window_y: number;
          window_w: number;
          window_h: number;
        }>('get_cursor_window_info');
        const dpr = window.devicePixelRatio || 1;
        const localX = (info.cursor_x - info.window_x) / dpr;
        const localY = (info.cursor_y - info.window_y) / dpr;
        const winW = info.window_w / dpr;
        const winH = info.window_h / dpr;

        const overControlsIsland =
          localX >= xMin && localX <= xMax && localY >= yMin && localY <= yMax;
        const interactive = overControlsIsland;
        if (interactive !== lastInteractive) {
          lastInteractive = interactive;
          appWindow
            .setIgnoreCursorEvents(!interactive)
            .catch((err) => console.warn('[WindowManager] window operation failed:', err));
        }
        if (fadeOnHoverRef.current) {
          const inWindow = localX >= 0 && localX <= winW && localY >= 0 && localY <= winH;
          const hovering = inWindow && !overControlsIsland;
          if (hovering !== lastHovering) {
            lastHovering = hovering;
            setIsHovering(hovering);
          }
        } else if (lastHovering) {
          lastHovering = false;
          setIsHovering(false);
        }
      } catch (err) {
        log.warn('Lock check failed:', err);
      }
    };

    timerId = setInterval(check, 100);
    return () => {
      clearInterval(timerId);
      appWindow.setIgnoreCursorEvents(false).catch(() => {});
    };
  }, [isLocked]);

  useEffect(() => {
    if (!isTauriEnv()) return;
    let unlistenToggleLock: (() => void) | undefined;
    listen<boolean>('toggle-lock', (event) => {
      const newLocked = event.payload;
      log.info('toggle-lock event received, locked:', newLocked);
      setIsLocked(newLocked);
      if (!newLocked) {
        setIsTransforming(false);
      }
    })
      .then((fn) => {
        unlistenToggleLock = fn;
      })
      .catch((err) => log.warn('toggle-lock listen failed:', err));
    return () => {
      unlistenToggleLock?.();
    };
  }, []);

  // 启动时把默认锁定状态同步到 Rust 侧，保证托盘菜单文字与前端一致
  useEffect(() => {
    if (!isTauriEnv()) return;
    invoke('set_lock_state', { locked: isLocked }).catch(() => {});
    // 仅同步初始值一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleTop = useCallback(async () => {
    if (!isTauriEnv()) {
      setIsTop((p) => !p);
      return;
    }
    try {
      const win = getCurrentWindow();
      const next = !isTop;
      await win.setAlwaysOnTop(next);
      setIsTop(next);
    } catch {
      /* ignore */
    }
  }, [isTop]);

  const handleToggleTransform = useCallback(() => {
    setIsTransforming((p) => {
      if (!p) setIsLocked(false);
      return !p;
    });
  }, []);

  const handleToggleLock = useCallback(() => {
    setIsLocked((p) => {
      const newLocked = !p;
      if (newLocked) {
        setIsTransforming(false);
      }
      // 同步状态到 Rust 侧
      if (isTauriEnv()) {
        invoke('set_lock_state', { locked: newLocked }).catch(() => {});
      }
      return newLocked;
    });
  }, []);

  const handleToggleFadeOnHover = useCallback(() => {
    setFadeOnHover((p) => !p);
  }, []);

  const _handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!isTransforming) return;
      e.preventDefault();
      setPetScale((p) => Math.min(2, Math.max(0.2, p + (e.deltaY > 0 ? -0.05 : 0.05))));
    },
    [isTransforming],
  );

  return {
    petScale,
    setPetScale,
    edgeSnap,
    setEdgeSnap,
    controlsEdge,
    isLocked,
    toggleLock: handleToggleLock,
    isTransforming,
    toggleTransform: handleToggleTransform,
    fadeOnHover,
    toggleFadeOnHover: handleToggleFadeOnHover,
    isHovering,
    setIsHovering,
    isTop,
    toggleTop: handleToggleTop,
    zoomFactor,
  };
}
