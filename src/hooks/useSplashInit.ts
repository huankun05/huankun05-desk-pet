import { useEffect, useRef } from 'react';

let warmedContext: WebGLRenderingContext | WebGL2RenderingContext | null = null;
let warmedCanvas: HTMLCanvasElement | null = null;

export function getWarmedContext() {
  return warmedContext;
}
export function getWarmedCanvas() {
  return warmedCanvas;
}

export function useSplashInit(externalCanvas?: HTMLCanvasElement | null) {
  const internalRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = externalCanvas ?? internalRef.current;
    if (!canvas) return;

    // 先尝试创建 WebGL2，失败则回退 WebGL1
    const ctx =
      canvas.getContext('webgl2', { antialias: false, alpha: false }) ||
      canvas.getContext('webgl', { antialias: false, alpha: false });

    if (!ctx) return;

    warmedContext = ctx;
    warmedCanvas = canvas;

    // 编译一个最小着色器，预热 GPU 驱动/着色器编译器
    // 这一步通常占 Live2D 首帧卡顿的一小部分，提前做完可降低首帧延迟
    try {
      const vs = `
        attribute vec2 a_position;
        void main() {
          gl_Position = vec4(a_position, 0.0, 1.0);
        }
      `;
      const fs = `
        precision mediump float;
        void main() {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
      `;
      const vShader = ctx.createShader(ctx.VERTEX_SHADER);
      const fShader = ctx.createShader(ctx.FRAGMENT_SHADER);
      if (vShader) {
        ctx.shaderSource(vShader, vs);
        ctx.compileShader(vShader);
      }
      if (fShader) {
        ctx.shaderSource(fShader, fs);
        ctx.compileShader(fShader);
      }
      if (vShader && fShader) {
        const program = ctx.createProgram();
        if (program) {
          ctx.attachShader(program, vShader);
          ctx.attachShader(program, fShader);
          ctx.linkProgram(program);
          ctx.useProgram(program);
        }
      }
      // 清理临时着色器对象
      if (vShader) ctx.deleteShader(vShader);
      if (fShader) ctx.deleteShader(fShader);
    } catch {
      // 预热失败不影响主流程
    }
  }, [externalCanvas]);

  return internalRef;
}
