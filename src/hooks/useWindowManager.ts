import { useState, useEffect, useRef, useCallback } from 'react';
import { getCurrentWindow, LogicalSize, LogicalPosition } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { settingsStorage } from '../services/storage/settingsStorage';
import { isTauriEnv } from '../utils/tauriEnv';
import { createLogger } from '../utils/logger';
import { useStorageEvent } from './useStorageEvent';

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
}

export function useWindowManager({
  modelConfig,
  modelInfo,
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
  const windowShownRef = useRef(false);
  const fadeOnHoverRef = useRef(fadeOnHover);
  // 吸附动画进行中的标志（顶层，供 onMoved / updatePlacement / snapToEdge 共用）
  const isSnappingRef = useRef(false);

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

  /** 边缘吸附动画（顶层复用）：把窗口平滑移动到 (targetX,targetY) 并吸附到边线，
   *  动画结束后保存最终位置——确保下次启动恢复到「吸附后」的坐标，而非吸附前的释放点。 */
  const snapToEdge = useCallback((targetX: number, targetY: number) => {
    if (!isTauriEnv()) return;
    if (!winMetricsRef.current) return;
    const win = getCurrentWindow();
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
        // ★ 保存吸附后的最终位置
        if (windowPosMemoryRef.current) {
          invoke('save_data', {
            key: 'main_window_pos',
            data: JSON.stringify({ x: targetX, y: targetY }),
          }).catch(() => {});
        }
      }
    };
    requestAnimationFrame(animate);
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
          snapToEdge(targetX, m.pos.y);
        }
        setControlsEdge((prev) => (prev === newEdge ? prev : newEdge));
      };

      // 边缘吸附动画已抽到顶层 snapToEdge（useCallback），onMoved 与恢复时共用。

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
  }, [controlsEdge, snapToEdge]);

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
          .then(() => {
            if (!windowShownRef.current) {
              windowShownRef.current = true;
              return win.show().catch(() => {});
            }
          });

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
          // ★ 恢复的位置若贴边，重新吸附到边线（与运行时一致），避免「差一截」的错位
          if (edgeSnap && initialEdge !== 'none') {
            snapToEdge(clamped.x, clamped.y);
          }
        }
      })
      .catch(() => {});
  }, [modelConfig, modelInfo, petScale, clampWindowPosition, edgeSnap, windowPosMemory, snapToEdge]);

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

    // ── 点击穿透策略（2026-08-11 重写，fail-safe 版）──────────────────────
    // 锁定态：整窗穿透（角色仅展示，点击透传下方窗口/桌面）。
    // 变换态：整窗「捕获」——保证角色一定可点击、可拖动。
    // 解锁且非变换：整窗「捕获」——保证角色一定能点、能拖（止血关键）。
    //   点击是否「触发角色反应 / 拖动角色」由 DOM 层 isPointOverCharacter 判定
    //   （几何排除画布外缘 + 画布内像素判定，fail-safe：判定失败也只是多触发
    //   一次角色反应，绝不会让整窗穿透导致「点不了」）。
    // ⚠️ 历史教训：曾用 isPointOverCharacter 动态切换 setIgnoreCursorEvents 实现
    //   「空白穿透桌面」，但 readPixels 在透明 webview 读不到可靠 alpha → 整窗被
    //   设穿透 → 解锁后完全点不了。故解锁态一律捕获，「空白穿透桌面」已移除。
    appWindow.setIgnoreCursorEvents(isLocked).catch(() => {});

    // hover 淡出：仅 fadeOnHover 时检测鼠标是否在窗口内
    let lastHovering = false;
    let lastIgnore = isLocked; // 记录上一次实际设置的穿透状态，避免每帧重复调用
    const check = async () => {
      if (document.hidden) return;
      try {
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
        const inWindow = localX >= 0 && localX <= winW && localY >= 0 && localY <= winH;

        // ── 透明边距点击穿透 ──
        let desiredIgnore: boolean;
        if (isTransforming) {
          desiredIgnore = false; // 变换/拖窗：整窗捕获
        } else if (isLocked) {
          desiredIgnore = true; // 锁定：整窗穿透
        } else {
          // 解锁非变换：整窗「捕获」——保证角色一定可点击、可拖动（止血）。
          // ⚠️ 历史教训（2026-08-11）：曾用 isPointOverCharacter 动态切换
          // setIgnoreCursorEvents 实现「空白穿透桌面」，但 readPixels 在透明
          // webview 下读不到可靠 alpha，命中判定误判 → 整窗被设为穿透 →
          // 「解锁后一点都点不了」。故解锁态一律捕获；点击是否「触发角色反应」
          // 交由 DOM 层几何+像素命中（fail-safe：判定失败也只是多触发一次反应，
          // 绝不会让整窗穿透点不了）。「空白穿透桌面」因依赖不可靠的像素穿透，
          // 已移除，后续如需可单独攻坚 readPixels 在透明 webview 的可靠读取。
          desiredIgnore = false;
        }
        if (desiredIgnore !== lastIgnore) {
          lastIgnore = desiredIgnore;
          appWindow.setIgnoreCursorEvents(desiredIgnore).catch(() => {});
        }

        if (fadeOnHoverRef.current) {
          const shouldHover = inWindow;
          if (shouldHover !== lastHovering) {
            lastHovering = shouldHover;
            setIsHovering(shouldHover);
          }
        } else if (lastHovering) {
          lastHovering = false;
          setIsHovering(false);
        }
      } catch (err) {
        log.warn('Lock hover check failed:', err);
      }
    };

    const intervalId = setInterval(check, 200);

    return () => {
      clearInterval(intervalId);
      // 卸载/回到锁定：恢复整窗捕获，避免残留穿透状态
      appWindow.setIgnoreCursorEvents(false).catch(() => {});
    };
  }, [isLocked, isTransforming]);

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
