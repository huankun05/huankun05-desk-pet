// @ts-nocheck
/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

export let canvas: HTMLCanvasElement = null;
export let gl: WebGLRenderingContext = null;
export let s_instance: LAppGlManager = null;

/**
 * Cubism SDK の WebGL を管理するクラス
 * React 統合用：コンストラクタで DOM を触らず、initFromCanvas() で外部注入する。
 */
export class LAppGlManager {
  /**
   * クラスのインスタンス（シングルトン）を返す。
   */
  public static getInstance(): LAppGlManager {
    if (s_instance == null) {
      s_instance = new LAppGlManager();
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
   * 外部から渡された canvas から WebGL2 コンテキストを初期化する。
   * React の useEffect 内で canvas ref が利用可能になった後に呼ぶ。
   *
   * @param canvasElement - WebGL 上下文的目标 canvas
   * @param externalContext - 可选的已创建 WebGL 上下文；若提供，则直接复用，避免重复创建
   */
  public static initFromCanvas(
    canvasElement: HTMLCanvasElement,
    externalContext?: WebGLRenderingContext | WebGL2RenderingContext | null,
  ): LAppGlManager {
    const instance = LAppGlManager.getInstance();

    canvas = canvasElement;
    // ★ 像素级点击穿透需要 preserveDrawingBuffer:true 才能 gl.readPixels 读到当前帧像素。
    // 优先级：本地带 preserveDrawingBuffer 的 context > 兜底预热 context。
    // 注意：externalContext（来自 useSplashInit 的 GPU 预热）创建时用了 alpha:false，
    // 且绑定的是 splash 自己的 canvas，不能直接复用于 Live2D 渲染 canvas，否则
    // ① alpha 通道无效（readPixels 全 255，无法区分角色/空白）；
    // ② gl 与 canvas 不匹配。因此这里优先为 Live2D 自己的 canvas 创建带
    //   preserveDrawingBuffer 的 context（透明桌宠本就 alpha:true，不改视觉效果）。
    //   预热 context 仍保留用于首帧 GPU 驱动预热，只是不再被 Live2D 复用。
    // @ts-ignore — WebGL2RenderingContext は WebGLRenderingContext の拡張
    gl =
      canvas.getContext('webgl2', { preserveDrawingBuffer: true }) ||
      canvas.getContext('webgl', { preserveDrawingBuffer: true }) ||
      externalContext ||
      null;

    return instance;
  }

  /**
   * コンストラクタ（no-op — DOM 操作は initFromCanvas で行う）。
   */
  constructor() {}

  /**
   * 解放する。モジュールレベルのグローバルもクリアする。
   */
  public release(): void {
    canvas = null;
    gl = null;
  }
}

/**
 * 读取 Live2D 渲染 canvas 在给定 **CSS 逻辑坐标**下的像素 alpha 值（0~255）。
 * 用于「像素级点击穿透」：alpha 接近 0 表示光标落在角色透明区（应穿透），
 * 否则落在角色实体上（应捕获点击）。
 *
 * @param cssX 相对 canvas 左上角的 CSS 逻辑 X（来自 getBoundingClientRect 体系）
 * @param cssY 相对 canvas 左上角的 CSS 逻辑 Y
 * @returns alpha（0~255）；canvas 未就绪或无上下文时返回 0
 *
 * 注意：依赖 context 创建时的 preserveDrawingBuffer:true，否则 present 后帧缓冲被清空、
 * readPixels 读到的是空白。WebGL 帧缓冲原点在左下角，故 Y 需翻转。
 */
export function readCanvasAlphaAt(cssX: number, cssY: number): number {
  if (!gl || !canvas) return -1; // -1 表示不可用（与"真透明=0"区分，避免误穿透）
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return 0;
  if (cssX < 0 || cssY < 0 || cssX >= rect.width || cssY >= rect.height) return 0;
  const px = Math.floor((cssX / rect.width) * canvas.width);
  const py = Math.floor((1 - cssY / rect.height) * canvas.height); // 翻转 Y
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return 0;
  const buf = new Uint8Array(4);
  try {
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  } catch {
    return 0;
  }
  return buf[3];
}
