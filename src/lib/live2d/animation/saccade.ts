// src/lib/live2d/animation/saccade.ts
/**
 * 眼跳系统（借鉴 AIRI）
 * CDF 离散查表 + 桶内均匀抖动，让无操作时眼球自然微动
 * Y 方向非对称 [-1, 0.7]，向下看概率更高
 */

// CDF 概率直方图：[累积概率, 时间间隔ms]
// 峰值在 1500-2500ms，动作更从容
const STEP_MS = 400;
const SACCADE_INTERVAL_CDF: Array<[number, number]> = [
  [0.05, 800],
  [0.15, 1200],
  [0.32, 1600],
  [0.52, 2000],
  [0.68, 2400],
  [0.80, 2800],
  [0.89, 3200],
  [0.95, 3800],
  [1.00, 4500],
];

function randomSaccadeInterval(): number {
  const r = Math.random();
  for (const [cumP, t] of SACCADE_INTERVAL_CDF) {
    if (r <= cumP) {
      return t + Math.random() * STEP_MS;
    }
  }
  return SACCADE_INTERVAL_CDF[SACCADE_INTERVAL_CDF.length - 1][1] + Math.random() * STEP_MS;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface SaccadeState {
  targetX: number;
  targetY: number;
  lastSaccadeAt: number;   // ms timestamp
  nextSaccadeAfter: number; // ms timestamp
  currentX: number;
  currentY: number;
}

export function createSaccadeState(): SaccadeState {
  const now = performance.now();
  return {
    targetX: 0,
    targetY: 0,
    lastSaccadeAt: now,
    nextSaccadeAfter: now + randomSaccadeInterval(),
    currentX: 0,
    currentY: 0,
  };
}

/**
 * 更新眼跳，返回当前帧眼球目标坐标 [-1, 1]
 * 仅在 idle（无鼠标追踪）时调用
 */
export function updateSaccade(state: SaccadeState, nowMs: number): { x: number; y: number } {
  if (nowMs >= state.nextSaccadeAfter || nowMs < state.lastSaccadeAt) {
    // 触发新眼跳：X 全范围，Y 非对称（向下偏移）
    state.targetX = Math.random() * 2 - 1;
    state.targetY = Math.random() * 1.7 - 1; // [-1, 0.7]
    state.lastSaccadeAt = nowMs;
    state.nextSaccadeAfter = nowMs + randomSaccadeInterval();
  }
  // 低通滤波：lerp(current, target, 0.08) 平滑过渡，约 300ms 完成
  state.currentX = lerp(state.currentX, state.targetX, 0.08);
  state.currentY = lerp(state.currentY, state.targetY, 0.08);
  return { x: state.currentX, y: state.currentY };
}

/**
 * 重置眼跳状态（鼠标追踪恢复时调用，避免眼球跳回）
 */
export function resetSaccade(state: SaccadeState): void {
  const now = performance.now();
  state.targetX = 0;
  state.targetY = 0;
  state.currentX = 0;
  state.currentY = 0;
  state.lastSaccadeAt = now;
  state.nextSaccadeAfter = now + randomSaccadeInterval();
}
