// @ts-nocheck
/**
 * Live2D Cubism SDK 桥接层
 *
 * Live2D SDK 的 TypeScript 移植版，含大量 null 赋值和非空类型不匹配，
 * 与 strictNullChecks 不兼容。通过 barrel export 隔离 SDK 内部类型问题。
 * 业务代码应通过此模块导入，而非直接引用内部 .ts 文件。
 *
 * @see https://www.live2d.com/en/download/cubism-sdk/
 */

export {
  LAppDelegate,
  initLive2D,
  destroyLive2D,
  loadModelFromPath,
  setExpression,
  triggerTapMotion,
  triggerAnimation,
  setParameterOverride,
  setFocusFromCss,
  setFocusNormalized,
  setZoomFactor,
  setMouseSensitivity,
  setFeetOffset,
  setModelWidthRatio,
  setModelCanvasSize,
  setBaseViewportAspect,
  getModelInfo,
  getCharacterNdcBounds,
  isPointOverCharacter,
  setModelLoadCallbacks,
  setMouthOpenY,
  setIdleState,
  setMaxFps,
  getRenderStats,
  scheduleBeat,
  setBeatSyncStyle,
  isBeatSyncActive,
  frameBuffer,
  s_instance as live2dDelegate,
} from './lappdelegate';

export {
  LAppLive2DManager,
  s_instance as live2dManager,
} from './lapplive2dmanager';

export type { LAppModel } from './lappmodel';
export { LAppPal } from './lapppal';
export type { LAppPalUpdateInfo } from './lapppal';
export { LAppView } from './lappview';
export { LAppTextureManager } from './lapptexturemanager';
export { TouchManager } from './touchmanager';
