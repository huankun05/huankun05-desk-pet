// src/lib/live2d/animation/blink.ts
/**
 * 三阶段眨眼状态机（借鉴 AIRI）
 * idle → closing → opening → idle
 * 闭眼用 easeOutQuad（先快后慢），睁眼用 easeInQuad（先慢后快）
 */

export type BlinkPhase = 'idle' | 'closing' | 'opening';

interface BlinkState {
  phase: BlinkPhase;
  progress: number;        // 0..1
  startValue: number;      // 进入 closing 时捕获的基准值
  delayMs: number;         // idle 阶段剩余倒计时
  openDurationMs: number;  // opening 阶段时长
}

const CLOSE_DURATION_MS = 75;
const MIN_OPEN_DURATION_MS = 150;
const MAX_OPEN_DURATION_MS = 300;
const MIN_DELAY_MS = 3000;
const MAX_DELAY_MS = 8000;

function easeOutQuad(t: number): number { return 1 - (1 - t) * (1 - t); }
function easeInQuad(t: number): number { return t * t; }
function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

function randomDelay(): number {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

function randomOpenDuration(): number {
  return MIN_OPEN_DURATION_MS + Math.random() * (MAX_OPEN_DURATION_MS - MIN_OPEN_DURATION_MS);
}

export function createBlinkState(): BlinkState {
  return {
    phase: 'idle',
    progress: 0,
    startValue: 1,
    delayMs: randomDelay(),
    openDurationMs: MAX_OPEN_DURATION_MS,
  };
}

/**
 * 更新眨眼状态，返回当前帧的眼睛开合度（0=闭眼，1=睁眼）
 * @param state 眨眼状态
 * @param dtMs 距上一帧毫秒
 * @param baseValue 模型默认眼睛开合度（通常为 1）
 * @param suppress 是否抑制眨眼（如表情已闭眼）
 */
export function updateBlink(state: BlinkState, dtMs: number, baseValue: number, suppress: boolean): number {
  if (suppress) {
    // 表情已闭眼，跳过眨眼，重置到 idle
    state.phase = 'idle';
    state.progress = 0;
    state.delayMs = randomDelay();
    return 0;
  }

  if (state.phase === 'idle') {
    state.delayMs -= dtMs;
    if (state.delayMs <= 0) {
      state.phase = 'closing';
      state.progress = 0;
      state.startValue = baseValue;
    }
    return baseValue;
  }

  if (state.phase === 'closing') {
    state.progress = Math.min(1, state.progress + dtMs / CLOSE_DURATION_MS);
    const eased = easeOutQuad(state.progress);
    const value = clamp01(state.startValue * (1 - eased));
    if (state.progress >= 1) {
      state.phase = 'opening';
      state.progress = 0;
      state.openDurationMs = randomOpenDuration();
    }
    return value;
  }

  // opening
  state.progress = Math.min(1, state.progress + dtMs / state.openDurationMs);
  const eased = easeInQuad(state.progress);
  const value = clamp01(state.startValue * eased);
  if (state.progress >= 1) {
    state.phase = 'idle';
    state.delayMs = randomDelay();
  }
  return value;
}
