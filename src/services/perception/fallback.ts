/**
 * 感知服务降级模块（Perception Fallback）
 *
 * 当 Python 感知后端（MediaPipe + WebSocket）不可用时，提供前端降级方案，
 * 让「宠物看着你」的基础体验在无后端环境下依然可用：
 *
 * - mouse：监听全局鼠标方向，宠物视线跟随鼠标（零依赖，所有环境可用）
 * - camera：浏览器端摄像头人脸追踪（待接入，当前回退到 mouse）
 * - off：关闭降级（通常由 Python 感知后端接管）
 *
 * 设计要点：
 * 1. 桌面宠物窗口很小，鼠标大部分时间在窗口外，因此 Tauri 环境下使用后端
 *    `get_cursor_window_info` 命令（一次性返回全局光标 + 窗口几何）计算方向。
 * 2. 仅用「方向向量」驱动（固定 50px 偏移），绕开 GetCursorPos（物理像素）
 *    与 window.outer_position（逻辑像素）之间的 DPI 缩放不一致问题。
 */

import { invoke } from '@tauri-apps/api/core';
import { setFocusNormalized } from '../../lib/live2d';
import { isTauriEnv } from '../../utils/tauriEnv';
import { createLogger } from '../../utils/logger';

const log = createLogger('PerceptionFallback');

export type FallbackMode = 'off' | 'mouse' | 'camera';

interface CursorWindowInfo {
  cursor_x: number;
  cursor_y: number;
  window_x: number;
  window_y: number;
  window_w: number;
  window_h: number;
}

const FALLBACK_LOCAL_KEY = 'deskpet_perception_fallback';

/** 把 v 钳制到 [lo, hi] */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class PerceptionFallback {
  private mode: FallbackMode = 'off';
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private mouseHandler: ((e: MouseEvent) => void) | null = null;

  get current(): FallbackMode {
    return this.mode;
  }

  /** 读取用户配置的降级模式（localStorage 覆盖，默认 mouse 让所有用户都有体验） */
  static readConfiguredMode(): FallbackMode {
    try {
      const v = localStorage.getItem(FALLBACK_LOCAL_KEY) as FallbackMode | null;
      if (v === 'off' || v === 'mouse' || v === 'camera') return v;
    } catch {
      /* ignore */
    }
    return 'mouse';
  }

  static saveConfiguredMode(mode: FallbackMode): void {
    try {
      localStorage.setItem(FALLBACK_LOCAL_KEY, mode);
    } catch {
      /* ignore */
    }
  }

  setMode(mode: FallbackMode): void {
    if (mode === this.mode) return;
    this.stop();
    this.mode = mode;
    if (mode === 'mouse') {
      this.startMouse();
    } else if (mode === 'camera') {
      this.startCamera();
    }
    log.info(`Fallback mode -> ${mode}`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.mouseHandler) {
      window.removeEventListener('mousemove', this.mouseHandler);
      this.mouseHandler = null;
    }
    this.stopCamera();
    // 重置运行模式：确保下一次 setMode 能重新启动轮询（effect 重跑场景）
    this.mode = 'off';
  }

  /**
   * 把归一化视线向量（nx, ny ∈ 任意实数，右/下为正）直接写入 DragManager。
   * 归一化坐标与 dpr/画布尺寸无关，左右完全对称，绕开 setFocusFromCss 在竖屏
   * 窄窗口下的非线性 transformView 映射（那会导致"向右跟手、向左不跟"）。
   * 光标在窗口中心 → (0,0)；在窗口边缘 → ±1；在窗口外更远 → 超界持续看向该方向。
   */
  private applyGaze(gx: number, gy: number): void {
    setFocusNormalized(gx, gy);
  }

  private startMouse(): void {
    if (isTauriEnv()) {
      // Tauri：用全局光标 + 窗口几何算归一化视线（鼠标常在窗口外，按窗口半宽高归一化）。
      // Rust 返回的 cursor_x/y 与 window_x/y/w/h 同为物理像素，分子分母同单位自动抵消 dpr，
      // 归一化结果不依赖设备像素比，左右天然对称。
      this.intervalId = setInterval(() => {
        // 窗口不可见时跳过：视线追踪每 50ms 触发一次 IPC（20 次/秒），
        // 角色看不见时这些计算与跨进程调用没有任何意义。
        if (document.hidden) return;
        invoke<CursorWindowInfo>('get_cursor_window_info')
          .then((info) => {
            const dx = info.cursor_x - (info.window_x + info.window_w / 2);
            const dy = info.cursor_y - (info.window_y + info.window_h / 2);
            const halfW = info.window_w / 2 || 1;
            const halfH = info.window_h / 2 || 1;
            const gx = clamp(dx / halfW, -1, 1);
            const gy = clamp(dy / halfH, -1, 1);
            this.applyGaze(gx, gy);
          })
          .catch(() => {
            /* 命令不可用（非 Windows 等）时静默 */
          });
      }, 50);
    } else {
      // 浏览器调试环境：用视口坐标归一化（视口即窗口）
      this.mouseHandler = (e: MouseEvent) => {
        const halfW = window.innerWidth / 2 || 1;
        const halfH = window.innerHeight / 2 || 1;
        const gx = clamp((e.clientX - window.innerWidth / 2) / halfW, -1, 1);
        const gy = clamp((e.clientY - window.innerHeight / 2) / halfH, -1, 1);
        this.applyGaze(gx, gy);
      };
      window.addEventListener('mousemove', this.mouseHandler);
    }
    log.info('Mouse fallback started');
  }

  private startCamera(): void {
    // 摄像头降级（浏览器端人脸追踪）待接入：当前回退到鼠标，保证「宠物看着你」
    log.warn('Camera fallback not available yet, falling back to mouse tracking');
    this.startMouse();
  }

  private stopCamera(): void {
    /* 预留：停止摄像头流 */
  }
}

export const perceptionFallback = new PerceptionFallback();
