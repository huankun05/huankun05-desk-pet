// src/lib/live2d/animation/lipsync-smoother.ts
/**
 * 口型平滑释放（借鉴 AIRI）
 * 说话时立即写入（实时性优先），停止说话后 smoothstep 平滑回到 0
 * handoff hold 防止 idle motion 立即张嘴
 */

const RELEASE_DURATION_MS = 200;
const HANDOFF_HOLD_MS = 500;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export interface LipSyncSmootherState {
  isSpeaking: boolean;
  lastForcedValue: number;
  releaseRemainingMs: number;
  handoffRemainingMs: number;
}

export function createLipSyncState(): LipSyncSmootherState {
  return {
    isSpeaking: false,
    lastForcedValue: 0,
    releaseRemainingMs: 0,
    handoffRemainingMs: 0,
  };
}

/**
 * 更新口型值
 * @param state 平滑器状态
 * @param dtMs 距上一帧毫秒
 * @param externalValue 外部传入的振幅值（0~1），或 -1 表示无输入
 * @param motionValue motion 系统当前给的口型值（释放结束后回退到此值）
 * @returns 最终写入模型的口型值（0~1）
 */
export function updateLipSync(
  state: LipSyncSmootherState,
  dtMs: number,
  externalValue: number,
  motionValue: number,
): number {
  // 攻击：有外部值时立即写入
  if (externalValue >= 0) {
    state.isSpeaking = true;
    state.lastForcedValue = externalValue;
    state.releaseRemainingMs = RELEASE_DURATION_MS;
    state.handoffRemainingMs = HANDOFF_HOLD_MS;
    return externalValue;
  }

  // 释放尾段：smoothstep 从 lastForcedValue 过渡到 motionValue
  if (state.releaseRemainingMs > 0) {
    state.releaseRemainingMs = Math.max(0, state.releaseRemainingMs - dtMs);
    const blend = smoothstep(1 - state.releaseRemainingMs / RELEASE_DURATION_MS);
    const blended = state.lastForcedValue * (1 - blend) + motionValue * blend;
    return blended;
  }

  // Handoff hold：强制闭嘴，防止 idle motion 立即张嘴
  if (state.handoffRemainingMs > 0) {
    state.handoffRemainingMs = Math.max(0, state.handoffRemainingMs - dtMs);
    return 0;
  }

  state.isSpeaking = false;
  return motionValue;
}
