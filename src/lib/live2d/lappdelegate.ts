// @ts-nocheck
/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { CubismFramework, Option } from '@framework/live2dcubismframework';
import { InvalidMotionQueueEntryHandleValue } from '@framework/motion/cubismmotionqueuemanager';

import * as LAppDefine from './lappdefine';
import { LAppLive2DManager } from './lapplive2dmanager';
import { LAppPal } from './lapppal';
import { LAppTextureManager } from './lapptexturemanager';
import { LAppView } from './lappview';
import { LAppGlManager, canvas, gl } from './lappglmanager';

export let s_instance: LAppDelegate = null;
export let frameBuffer: WebGLFramebuffer = null;

/**
 * アプリケーションクラス。
 * Cubism SDK の管理を行う。
 */
export class LAppDelegate {
  /**
   * クラスのインスタンス（シングルトン）を返す。
   */
  public static getInstance(): LAppDelegate {
    if (s_instance == null) {
      s_instance = new LAppDelegate();
    }
    return s_instance;
  }

  /**
   * クラスのインスタンス（シングルトン）を解放する。
   */
  public static releaseInstance(): void {
    if (s_instance != null) {
      s_instance.release();
    }
    s_instance = null;
  }

  /**
   * APP に必要な物を初期化する。
   */
  public initialize(): boolean {
    if (LAppDefine.CanvasSize === 'auto') {
      this._resizeCanvas();
    } else {
      canvas.width = LAppDefine.CanvasSize.width;
      canvas.height = LAppDefine.CanvasSize.height;
    }

    if (!frameBuffer) {
      frameBuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    }

    // 透過設定
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const supportTouch: boolean = 'ontouchend' in canvas;

    if (supportTouch) {
      canvas.addEventListener('touchstart', onTouchBegan, { passive: true });
      canvas.addEventListener('touchmove', onTouchMoved, { passive: true });
      canvas.addEventListener('touchend', onTouchEnded, { passive: true });
      canvas.addEventListener('touchcancel', onTouchCancel, { passive: true });
    } else {
      // マウス追跡は useLive2D hook の Tauri API ポーリングで処理
      canvas.addEventListener('mouseup', onClickEnded, { passive: true });
    }

    // AppView の初期化
    this._view.initialize();

    // Canvas CSS 尺寸变化时自动同步像素缓冲和视口
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        if (LAppDefine.CanvasSize === 'auto') {
          this._resizeCanvas();
          this._view.initialize();
        }
      });
      this._resizeObserver.observe(canvas);
    }

    // Cubism SDK の初期化
    this.initializeCubism();

    return true;
  }

  /**
   * Resize canvas and re-initialize view.
   */
  public onResize(): void {
    this._resizeCanvas();
    this._view.initialize();
    this._view.initializeSprite();
  }

  /**
   * 解放する。
   */
  public release(): void {
    // レンダーループを停止
    this.stop();

    // ResizeObserver を解除
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    // イベントリスナーを解除
    this._removeEventListeners();

    if (this._textureManager) {
      this._textureManager.release();
      this._textureManager = null;
    }

    if (this._view) {
      this._view.release();
      this._view = null;
    }

    // リソースを解放
    LAppLive2DManager.releaseInstance();

    // Cubism SDK の解放
    CubismFramework.dispose();
  }

  /**
   * メインループを開始する。
   */
  public setMaxFps(fps: number): void {
    this._maxFps = Math.max(0, fps);
    // 减 1ms 容差：rAF 回调间隔本身有抖动，若阈值恰好等于目标间隔（如 60fps 的 16.67ms），
    // 极小的负偏差就会导致整帧被跳过，实际帧率腰斩为一半。
    this._minFrameIntervalMs = this._maxFps > 0 ? Math.max(0, 1000 / this._maxFps - 1) : 0;
  }

  /**
   * 渲染统计：实测帧率与单帧渲染耗时。
   *
   * - `fps`：最近 1 秒内实际完成的绘制帧数（受帧率上限约束）。
   * - `renderCostMs`：单帧绘制耗时的指数滑动平均，反映设备真实负载，
   *   不受帧率上限影响，因此可作为性能自适应的判据。
   */
  public getRenderStats(): { fps: number; renderCostMs: number } {
    return { fps: this._renderFps, renderCostMs: this._renderCostMs };
  }

  public run(): void {
    let lastFrameTime = 0;
    const loop = (): void => {
      if (s_instance == null) {
        return;
      }

      // 帧率限制：未到最小间隔则跳过本帧
      const now = performance.now();
      if (this._minFrameIntervalMs > 0 && now - lastFrameTime < this._minFrameIntervalMs) {
        this._rafId = requestAnimationFrame(loop);
        return;
      }
      lastFrameTime = now;

      // 实测帧率：统计 1 秒窗口内真正完成绘制的帧数
      this._frameCounter++;
      if (this._fpsWindowStart === 0) {
        this._fpsWindowStart = now;
      } else if (now - this._fpsWindowStart >= 1000) {
        this._renderFps = Math.round((this._frameCounter * 1000) / (now - this._fpsWindowStart));
        this._frameCounter = 0;
        this._fpsWindowStart = now;
      }

      LAppPal.updateTime();

      // 每帧同步 canvas 尺寸到 CSS 布局，避免 projection 用旧尺寸渲染
      if (LAppDefine.CanvasSize === 'auto') {
        this._resizeCanvas();
      }

      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.clearDepth(1.0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      const renderStart = performance.now();
      try {
        this._view.render();
      } catch {
        /* 渲染错误静默恢复 */
      }
      // 单帧绘制耗时（模型参数更新 + 物理演算 + WebGL 命令提交，Live2D 的瓶颈主要在此 CPU 侧）。
      // 用指数滑动平均抹平抖动，供性能自适应判断设备是否吃紧。
      const cost = performance.now() - renderStart;
      this._renderCostMs = this._renderCostMs === 0 ? cost : this._renderCostMs * 0.9 + cost * 0.1;

      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  /**
   * メインループを停止する。
   */
  public stop(): void {
    if (this._rafId !== 0) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
  }

  /**
   * シェーダーを登録する。
   */
  public createShader(): WebGLProgram {
    const vertexShaderId = gl.createShader(gl.VERTEX_SHADER);
    if (vertexShaderId == null) {
      LAppPal.printMessage('failed to create vertexShader');
      return null;
    }

    const vertexShader: string =
      'precision mediump float;' +
      'attribute vec3 position;' +
      'attribute vec2 uv;' +
      'varying vec2 vuv;' +
      'void main(void)' +
      '{' +
      '   gl_Position = vec4(position, 1.0);' +
      '   vuv = uv;' +
      '}';

    gl.shaderSource(vertexShaderId, vertexShader);
    gl.compileShader(vertexShaderId);

    const fragmentShaderId = gl.createShader(gl.FRAGMENT_SHADER);
    if (fragmentShaderId == null) {
      LAppPal.printMessage('failed to create fragmentShader');
      return null;
    }

    const fragmentShader: string =
      'precision mediump float;' +
      'varying vec2 vuv;' +
      'uniform sampler2D texture;' +
      'void main(void)' +
      '{' +
      '   gl_FragColor = texture2D(texture, vuv);' +
      '}';

    gl.shaderSource(fragmentShaderId, fragmentShader);
    gl.compileShader(fragmentShaderId);

    const programId = gl.createProgram();
    gl.attachShader(programId, vertexShaderId);
    gl.attachShader(programId, fragmentShaderId);

    gl.deleteShader(vertexShaderId);
    gl.deleteShader(fragmentShaderId);

    gl.linkProgram(programId);
    gl.useProgram(programId);

    return programId;
  }

  /**
   * View 情報を取得する。
   */
  public getView(): LAppView {
    return this._view;
  }

  public getTextureManager(): LAppTextureManager {
    return this._textureManager;
  }

  /**
   * 获取 canvas 的 blob 数据
   */
  public getCanvasBlob(): Promise<Blob> {
    this._view.render();
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(
          blob => {
            resolve(blob);
          },
          'image/png',
          1.0
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * コンストラクタ
   */
  constructor() {
    this._captured = false;
    this._mouseX = 0.0;
    this._mouseY = 0.0;
    this._isEnd = false;
    this._rafId = 0;

    this._cubismOption = new Option();
    this._view = new LAppView();
    this._textureManager = new LAppTextureManager();
  }

  /**
   * Cubism SDK の初期化
   */
  public initializeCubism(): void {
    this._cubismOption.logFunction = LAppPal.printMessage;
    this._cubismOption.loggingLevel = LAppDefine.CubismLoggingLevel;
    CubismFramework.startUp(this._cubismOption);
    CubismFramework.initialize();

    LAppLive2DManager.getInstance();

    LAppPal.updateTime();

    this._view.initializeSprite();
  }

  /**
   * イベントリスナーを解除する。
   */
  private _removeEventListeners(): void {
    if (canvas) {
      canvas.removeEventListener('touchstart', onTouchBegan);
      canvas.removeEventListener('touchmove', onTouchMoved);
      canvas.removeEventListener('touchend', onTouchEnded);
      canvas.removeEventListener('touchcancel', onTouchCancel);
      canvas.removeEventListener('mouseup', onClickEnded);
    }
  }

  /**
   * Resize the canvas to fill the screen.
   */
  private _resizeCanvas(): void {
    const newW = canvas.clientWidth * window.devicePixelRatio;
    const newH = canvas.clientHeight * window.devicePixelRatio;
    if (canvas.width !== newW || canvas.height !== newH) {
      canvas.width = newW;
      canvas.height = newH;
    }
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  _cubismOption: Option;
  _view: LAppView;
  _captured: boolean;
  _mouseX: number;
  _mouseY: number;
  _isEnd: boolean;
  _textureManager: LAppTextureManager;
  _maxFps: number = 0;             // 帧率上限（0 = 不限制）
  _minFrameIntervalMs: number = 0; // 最小帧间隔（ms）
  _renderFps: number = 0;          // 实测帧率（最近 1 秒实际绘制帧数）
  _renderCostMs: number = 0;       // 单帧绘制耗时的指数滑动平均（ms）
  _frameCounter: number = 0;       // 当前统计窗口内的帧计数
  _fpsWindowStart: number = 0;     // 当前统计窗口起始时间戳
  _resizeObserver: ResizeObserver | null = null;
  _rafId: number;
}

function onClickEnded(e: MouseEvent): void {
  LAppDelegate.getInstance()._captured = false;
  if (!LAppDelegate.getInstance()._view) {
    return;
  }
  const rect = (e.target as Element).getBoundingClientRect();
  const posX: number = e.clientX - rect.left;
  const posY: number = e.clientY - rect.top;
  LAppDelegate.getInstance()._view.onTouchesEnded(posX, posY);
}

function onTouchBegan(e: TouchEvent): void {
  if (!LAppDelegate.getInstance()._view) {
    return;
  }
  LAppDelegate.getInstance()._captured = true;
  const posX = e.changedTouches[0].pageX;
  const posY = e.changedTouches[0].pageY;
  LAppDelegate.getInstance()._view.onTouchesBegan(posX, posY);
}

function onTouchMoved(e: TouchEvent): void {
  if (!LAppDelegate.getInstance()._view) {
    return;
  }
  const rect = (e.target as Element).getBoundingClientRect();
  const posX = e.changedTouches[0].clientX - rect.left;
  const posY = e.changedTouches[0].clientY - rect.top;
  LAppDelegate.getInstance()._view.onTouchesMoved(posX, posY);
}

function onTouchEnded(e: TouchEvent): void {
  LAppDelegate.getInstance()._captured = false;
  if (!LAppDelegate.getInstance()._view) {
    return;
  }
  const rect = (e.target as Element).getBoundingClientRect();
  const posX = e.changedTouches[0].clientX - rect.left;
  const posY = e.changedTouches[0].clientY - rect.top;
  LAppDelegate.getInstance()._view.onTouchesEnded(posX, posY);
}

function onTouchCancel(e: TouchEvent): void {
  LAppDelegate.getInstance()._captured = false;
  if (!LAppDelegate.getInstance()._view) {
    return;
  }
  const rect = (e.target as Element).getBoundingClientRect();
  const posX = e.changedTouches[0].clientX - rect.left;
  const posY = e.changedTouches[0].clientY - rect.top;
  LAppDelegate.getInstance()._view.onTouchesEnded(posX, posY);
}

// ═══════════════════════════════════════════════════════════════
// React 桥接函数 — 连接 Live2D 引擎和 React UI 层
// ═══════════════════════════════════════════════════════════════

/**
 * 初始化 Live2D：从 Canvas 创建 WebGL 上下文，启动引擎和渲染循环。
 * @param canvasElement - Live2D 渲染目标 canvas
 * @param externalContext - 可选的预热 WebGL 上下文；若提供，则直接复用，避免重复创建上下文
 * @returns true 表示成功，false 表示 WebGL2 不可用
 */
export function initLive2D(
  canvasElement: HTMLCanvasElement,
  externalContext?: WebGLRenderingContext | WebGL2RenderingContext | null,
): boolean {
  // 先销毁旧实例
  if (s_instance) {
    destroyLive2D();
  }

  // 初始化 WebGL；优先复用预热上下文
  LAppGlManager.initFromCanvas(canvasElement, externalContext);

  if (!gl) {
    return false;
  }

  // 初始化应用
  const app = LAppDelegate.getInstance();
  app.initialize();

  // 启动渲染循环
  app.run();

  return true;
}

/**
 * 加载指定路径的 Live2D 模型
 */
export function loadModelFromPath(modelPath: string): void {
  const manager = LAppLive2DManager.getInstance();
  manager.loadModelFromJson(modelPath);
}

/**
 * 销毁 Live2D 引擎，释放所有资源
 */
export function destroyLive2D(): void {
  if (s_instance) {
    LAppDelegate.releaseInstance();
  }
  LAppGlManager.releaseInstance();
}

/**
 * 设置当前模型的表情
 */
export function setExpression(name: string): void {
  const manager = LAppLive2DManager.getInstance();
  const modelCount = manager.getModelCount ? manager.getModelCount() : -1;
  const model = manager.getModel(0);
  if (model) {
    model.setExpression(name);
  }
}

/**
 * 触发点击动作
 */
export function triggerTapMotion(): void {
  const manager = LAppLive2DManager.getInstance();
  const model = manager.getModel(0);
  if (model) {
    model.startRandomMotion(
      LAppDefine.MotionGroupTapBody,
      LAppDefine.PriorityNormal,
    );
  }
}

/**
 * 触发指定动画（通过 motion group 名称）
 * 常见名称：laugh / wave / jump / cry / surprise
 * 如果模型没有对应的 motion group，回退到 TapBody
 */
export function triggerAnimation(name: string, _durationMs: number = 3000): void {
  const manager = LAppLive2DManager.getInstance();
  const model = manager.getModel(0);
  if (!model) return;

  // 尝试用动画名作为 motion group 播放
  const ok = model.startRandomMotion(name, LAppDefine.PriorityNormal);
  if (ok === InvalidMotionQueueEntryHandleValue) {
    // 回退到点击动作
    model.startRandomMotion(LAppDefine.MotionGroupTapBody, LAppDefine.PriorityNormal);
  }
}

/**
 * 设置瞬态模型参数（如 ParamCheek、ParamAngry）
 * 持续 durationMs 后自动过期
 */
export function setParameterOverride(key: string, value: number, durationMs: number = 3000): void {
  const manager = LAppLive2DManager.getInstance();
  const model = manager.getModel(0);
  if (model) {
    model.setTransientParam(key, value, durationMs);
  }
}

/**
 * 设置眼球追踪焦点（CSS 坐标）
 */
export function setFocusFromCss(x: number, y: number): void {
  const app = LAppDelegate.getInstance();
  if (app._view) {
    app._view.setFocusFromCss(x, y);
  }
}

/**
 * 设置眼球/头部追踪焦点（已归一化坐标，[-1,1]，右正、下正）。
 * 直接驱动 DragManager，不走 setFocusFromCss 的 transformView 管线——
 * 后者依赖 canvas 设备像素与竖屏矩阵，在窄高窗口下会把 X 映射成非线性、
 * 左右不对称（表现为"向右跟手、向左不跟"）。归一化坐标与 dpr/画布尺寸无关，
 * 左右完全对称。
 * @param nx 归一化 X（右正，范围不限，窗外会超界看向窗外）
 * @param ny 归一化 Y（下正，与屏幕坐标同向）
 */
export function setFocusNormalized(nx: number, ny: number): void {
  LAppLive2DManager.getInstance().onDrag(nx, ny);
}

/**
 * 设置缩放因子
 */
export function setZoomFactor(factor: number): void {
  const manager = LAppLive2DManager.getInstance();
  manager.zoomFactor = factor;
}

/**
 * 设置鼠标跟随灵敏度
 */
export function setMouseSensitivity(sensitivity: number): void {
  const manager = LAppLive2DManager.getInstance();
  const model = manager.getModel(0);
  if (model) {
    model._mouseSensitivity = sensitivity;
  }
}

/**
 * 设置脚部偏移（补偿模型底部留白）
 */
export function setFeetOffset(offset: number): void {
  const manager = LAppLive2DManager.getInstance();
  manager.feetOffset = offset;
}

/**
 * 设置模型横向拉伸比例
 */
export function setModelWidthRatio(ratio: number): void {
  const manager = LAppLive2DManager.getInstance();
  manager.modelWidthRatio = ratio;
}

/**
 * 设置模型的 canvas 尺寸（从 model3.json/moc3 解析得出）
 */
export function setModelCanvasSize(w: number, h: number): void {
  const manager = LAppLive2DManager.getInstance();
  manager._externalModelW = w;
  manager._externalModelH = h;
}

/**
 * 设置基准视口宽高比（用于缩放比例补偿）
 */
export function setBaseViewportAspect(aspect: number): void {
  const manager = LAppLive2DManager.getInstance();
  manager.baseViewportAspect = aspect;
}

/**
 * 获取模型 canvas 信息
 */
export function getModelInfo(): { canvasWidth: number; canvasHeight: number } | null {
  const manager = LAppLive2DManager.getInstance();
  const size = manager.getModelCanvasSize();
  if (!size) return null;
  return { canvasWidth: size.width, canvasHeight: size.height };
}

/**
 * 设置模型加载回调
 */
export function setModelLoadCallbacks(
  onReady: (() => void) | null,
  onError: ((err: string) => void) | null,
): void {
  const manager = LAppLive2DManager.getInstance();
  manager.setModelLoadCallbacks(onReady, onError);
}

/**
 * 设置当前模型的口型开合度（0~1），用于 TTS 唇形同步。
 */
export function setMouthOpenY(value: number): void {
  const manager = LAppLive2DManager.getInstance();
  const model = manager.getModel(0);
  if (model) {
    model.setMouthOpenY(value);
  }
}

export function setIdleState(isIdle: boolean): void {
  const manager = LAppLive2DManager.getInstance();
  const model = manager.getModel(0);
  if (model) {
    model.setIdleState(isIdle);
  }
}

export function scheduleBeat(timestamp?: number | null): void {
  const manager = LAppLive2DManager.getInstance();
  const model = manager.getModel(0);
  if (model) {
    model.scheduleBeat(timestamp);
  }
}

export function setBeatSyncStyle(style: 'punchy-v' | 'balanced-v' | 'swing-lr' | 'sway-sine'): void {
  const manager = LAppLive2DManager.getInstance();
  const model = manager.getModel(0);
  if (model) {
    model.setBeatSyncStyle(style);
  }
}

export function isBeatSyncActive(): boolean {
  const manager = LAppLive2DManager.getInstance();
  const model = manager.getModel(0);
  if (model) {
    return model.isBeatSyncActive();
  }
  return false;
}

export function setMaxFps(fps: number): void {
  LAppDelegate.getInstance().setMaxFps(fps);
}

/** 获取实测渲染帧率与单帧绘制耗时（供 FPS 浮层与性能自适应使用）。 */
export function getRenderStats(): { fps: number; renderCostMs: number } {
  if (s_instance == null) return { fps: 0, renderCostMs: 0 };
  return s_instance.getRenderStats();
}
