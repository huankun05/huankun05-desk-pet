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
    // @ts-ignore — WebGL2RenderingContext は WebGLRenderingContext の拡張
    gl = externalContext || canvas.getContext('webgl2') || canvas.getContext('webgl');

    if (!gl) {
      gl = null;
    }

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
