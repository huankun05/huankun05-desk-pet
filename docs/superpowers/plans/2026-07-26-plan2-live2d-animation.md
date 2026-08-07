# Plan 2: Live2D 动画系统改造

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 借鉴 AIRI 的动画系统，为 Desk Pet 自研 Cubism Live2D 添加眼跳(Saccade)、自定义眨眼状态机、口型平滑释放、页面不可见降帧，让桌宠"活"起来。

**Architecture:** 在 `lappmodel.ts` 的 `update()` 方法中插入自定义动画逻辑（不改 SDK 内部结构），新增 `src/lib/live2d/animation/` 目录存放动画算法。所有动画用 deltaTime 计算，保证不同帧率下表现一致。

**Tech Stack:** TypeScript, Cubism SDK v5（自研移植）, React

---

## 文件结构

**新增**：
- `src/lib/live2d/animation/blink.ts` — 三阶段眨眼状态机
- `src/lib/live2d/animation/saccade.ts` — 眼跳系统（CDF 随机间隔）
- `src/lib/live2d/animation/lipsync-smoother.ts` — 口型平滑释放
- `src/lib/live2d/animation/index.ts` — barrel export

**修改**：
- `src/lib/live2d/lappmodel.ts` — 在 `update()` 中调用新动画模块，添加 `setIdleState()` 方法
- `src/lib/live2d/lappdelegate.ts` — 添加 `setIdleState`、`setMaxFps` 桥接函数
- `src/lib/live2d/index.ts` — 导出新函数
- `src/hooks/useLive2D.ts` — 接入 idle 状态、visibilitychange 降帧

---

## Task 1: 眨眼状态机（blink.ts）

**Files:**
- Create: `src/lib/live2d/animation/blink.ts`

- [ ] **Step 1: 实现眨眼状态机**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/live2d/animation/blink.ts
git commit -m "feat(live2d): add three-phase blink state machine"
```

---

## Task 2: 眼跳系统（saccade.ts）

**Files:**
- Create: `src/lib/live2d/animation/saccade.ts`

- [ ] **Step 1: 实现 CDF 眼跳系统**

```typescript
// src/lib/live2d/animation/saccade.ts
/**
 * 眼跳系统（借鉴 AIRI）
 * CDF 离散查表 + 桶内均匀抖动，让无操作时眼球自然微动
 * Y 方向非对称 [-1, 0.7]，向下看概率更高
 */

// CDF 概率直方图：[累积概率, 时间间隔ms]
// 峰值在 800-1200ms（约 40%），长尾延伸到 4 秒+
const STEP_MS = 400;
const SACCADE_INTERVAL_CDF: Array<[number, number]> = [
  [0.075, 800],
  [0.185, 1200],
  [0.310, 1600],
  [0.450, 2000],
  [0.575, 2400],
  [0.625, 2800],
  [0.665, 3200],
  [0.695, 3600],
  [0.715, 4000],
  [1.000, 4400],
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
  // 低通滤波：lerp(current, target, 0.3) 平滑过渡
  state.currentX = lerp(state.currentX, state.targetX, 0.3);
  state.currentY = lerp(state.currentY, state.targetY, 0.3);
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/live2d/animation/saccade.ts
git commit -m "feat(live2d): add saccade system with CDF random interval"
```

---

## Task 3: 口型平滑释放（lipsync-smoother.ts）

**Files:**
- Create: `src/lib/live2d/animation/lipsync-smoother.ts`

- [ ] **Step 1: 实现攻击瞬时 + 释放 smoothstep**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/live2d/animation/lipsync-smoother.ts
git commit -m "feat(live2d): add lipsync smoother with smoothstep release"
```

---

## Task 4: animation/index.ts barrel export

**Files:**
- Create: `src/lib/live2d/animation/index.ts`

- [ ] **Step 1: 创建 barrel**

```typescript
// src/lib/live2d/animation/index.ts
export * from './blink';
export * from './saccade';
export * from './lipsync-smoother';
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/live2d/animation/index.ts
git commit -m "chore(live2d): add animation barrel export"
```

---

## Task 5: 在 LAppModel 中接入新动画

**Files:**
- Modify: `src/lib/live2d/lappmodel.ts`

- [ ] **Step 1: 添加动画状态字段和导入**

在 `lappmodel.ts` 顶部导入区添加：

```typescript
import {
  createBlinkState,
  updateBlink,
  createSaccadeState,
  updateSaccade,
  resetSaccade,
  createLipSyncState,
  updateLipSync,
  type BlinkState,
  type SaccadeState,
  type LipSyncSmootherState,
} from './animation';
```

在 LAppModel 类中（`_externalMouthValue` 字段附近）添加：

```typescript
// === 自定义动画状态 ===
private _blinkState: BlinkState = createBlinkState();
private _saccadeState: SaccadeState = createSaccadeState();
private _lipSyncState: LipSyncSmootherState = createLipSyncState();
private _useCustomBlink: boolean = true;       // 启用自定义眨眼
private _useSaccade: boolean = true;            // 启用眼跳
private _isIdle: boolean = false;               // 是否处于 idle 状态（无鼠标交互）
```

- [ ] **Step 2: 添加 idle 状态设置方法**

```typescript
/**
 * 设置 idle 状态（无鼠标交互时为 true，启用眼跳）
 */
public setIdleState(isIdle: boolean): void {
  if (this._isIdle !== isIdle) {
    this._isIdle = isIdle;
    if (!isIdle) {
      resetSaccade(this._saccadeState);
    }
  }
}
```

- [ ] **Step 3: 修改 update() 中的眨眼逻辑**

找到现有的眨眼代码（约第 572-578 行）：

```typescript
// 原代码：
// if (!motionUpdated) {
//   this._eyeBlink.updateParameters(this._model, deltaTimeSeconds);
// }
```

替换为：

```typescript
// 眨眼：自定义状态机或 SDK 默认
if (this._useCustomBlink) {
  // 读取当前眼睛开合度作为基准
  const baseEye = this._model.getParameterValueById(this._idParamEyeLOpen) ?? 1;
  const baseEyeR = this._model.getParameterValueById(this._idParamEyeROpen) ?? 1;
  // 检测是否表情已闭眼（抑制眨眼）
  const suppress = baseEye <= 0.15 && baseEyeR <= 0.15;
  const dtMs = deltaTimeSeconds * 1000;
  const eyeL = updateBlink(this._blinkState, dtMs, baseEye, suppress);
  const eyeR = updateBlink(this._blinkState, dtMs, baseEyeR, suppress);
  this._model.setParameterValueById(this._idParamEyeLOpen, eyeL);
  this._model.setParameterValueById(this._idParamEyeROpen, eyeR);
} else if (!motionUpdated) {
  this._eyeBlink.updateParameters(this._model, deltaTimeSeconds);
}
```

- [ ] **Step 4: 修改 update() 中的眼球追踪逻辑**

找到眼球追踪代码（约第 589-590 行）：

```typescript
// 原代码：
// this._model.addParameterValueById(this._idParamEyeBallX, this._dragX);
// this._model.addParameterValueById(this._idParamEyeBallY, this._dragY);
```

替换为：

```typescript
// 眼球追踪：idle 时用眼跳，非 idle 时跟随鼠标
if (this._useSaccade && this._isIdle) {
  const saccade = updateSaccade(this._saccadeState, performance.now());
  // 眼跳值已是 [-1, 1]，直接设值（覆盖 dragValue）
  this._model.setParameterValueById(this._idParamEyeBallX, saccade.x);
  this._model.setParameterValueById(this._idParamEyeBallY, saccade.y);
} else {
  this._model.addParameterValueById(this._idParamEyeBallX, this._dragX);
  this._model.addParameterValueById(this._idParamEyeBallY, this._dragY);
}
```

- [ ] **Step 5: 修改 update() 中的口型逻辑**

找到口型代码（约第 641-656 行），将现有的 `_externalMouthValue` 消费逻辑替换为：

```typescript
// 口型同步：通过平滑器处理
{
  const externalValue = this._externalMouthValue;
  // 消费后立即重置为 -1（保持原行为）
  this._externalMouthValue = -1;
  // 读取 motion 给的口型值（释放结束后回退用）
  const motionMouth = this._model.getParameterValueById(this._lipSyncIds.at(0)) ?? 0;
  const dtMs = deltaTimeSeconds * 1000;
  const finalValue = updateLipSync(this._lipSyncState, dtMs, externalValue, motionMouth);
  for (let i = 0; i < this._lipSyncIds.getSize(); i++) {
    this._model.setParameterValueById(this._lipSyncIds.at(i), finalValue);
  }
}
```

- [ ] **Step 6: typecheck + Commit**

```bash
pnpm typecheck 2>&1 | Select-String "lappmodel|error TS" | Select-Object -First 10
git add src/lib/live2d/lappmodel.ts
git commit -m "feat(live2d): integrate blink/saccade/lipsync into LAppModel.update()"
```

---

## Task 6: 桥接 setIdleState 到 React

**Files:**
- Modify: `src/lib/live2d/lappdelegate.ts`
- Modify: `src/lib/live2d/index.ts`
- Modify: `src/hooks/useLive2D.ts`

- [ ] **Step 1: 在 lappdelegate.ts 添加桥接函数**

在现有导出函数附近添加：

```typescript
export function setIdleState(isIdle: boolean): void {
  const manager = LAppLive2DManager.getInstance();
  const model = manager.getModel(0);
  if (model) {
    model.setIdleState(isIdle);
  }
}
```

- [ ] **Step 2: 在 index.ts 导出**

在 barrel 中添加：

```typescript
export { setIdleState } from './lappdelegate';
```

- [ ] **Step 3: 在 useLive2D.ts 的 idle 检测中调用**

修改 `useLive2D.ts` 中的 idle 检测逻辑（约第 332-337 行），在 `setIsIdle` 调用处同时通知 Live2D：

在文件顶部导入区添加：

```typescript
import { setIdleState } from '../lib/live2d';
```

修改 `markActive` 和 `checkIdle`：

```typescript
const markActive = () => {
  lastMoveTime = Date.now();
  if (idleState) {
    idleState = false;
    setIsIdle(false);
    setIdleState(false);
    setExpression(lastExpressionRef.current);
  }
};

const checkIdle = () => {
  if (!idleState && Date.now() - lastMoveTime > IDLE_TIMEOUT) {
    idleState = true;
    setIsIdle(true);
    setIdleState(true);
    setExpression('Default');
  }
};
```

- [ ] **Step 4: typecheck + Commit**

```bash
pnpm typecheck 2>&1 | Select-String "useLive2D|lappdelegate|error TS" | Select-Object -First 10
git add src/lib/live2d/lappdelegate.ts src/lib/live2d/index.ts src/hooks/useLive2D.ts
git commit -m "feat(live2d): bridge setIdleState to React for saccade activation"
```

---

## Task 7: 页面不可见降帧

**Files:**
- Modify: `src/lib/live2d/lappdelegate.ts`
- Modify: `src/hooks/useLive2D.ts`

- [ ] **Step 1: 在 lappdelegate.ts 添加帧率控制**

找到 `run()` 方法，修改为支持帧率限制：

```typescript
private _maxFps: number = 0; // 0 = 不限制
private _minFrameIntervalMs: number = 0;

public setMaxFps(fps: number): void {
  this._maxFps = Math.max(0, fps);
  this._minFrameIntervalMs = this._maxFps > 0 ? 1000 / this._maxFps : 0;
}

public run(): void {
  let lastFrameTime = 0;
  const loop = (): void => {
    if (s_instance == null) return;
    LAppPal.updateTime();

    // 帧率限制
    const now = performance.now();
    if (this._minFrameIntervalMs > 0 && now - lastFrameTime < this._minFrameIntervalMs) {
      this._rafId = requestAnimationFrame(loop);
      return;
    }
    lastFrameTime = now;

    if (LAppDefine.CanvasSize === 'auto') this._resizeCanvas();
    const gl = this._gl;
    if (gl) {
      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    try {
      this._view.render();
    } catch {
      // 静默恢复
    }
    this._rafId = requestAnimationFrame(loop);
  };
  this._rafId = requestAnimationFrame(loop);
}
```

添加桥接函数：

```typescript
export function setMaxFps(fps: number): void {
  LAppDelegate.getInstance().setMaxFps(fps);
}
```

- [ ] **Step 2: 在 index.ts 导出**

```typescript
export { setMaxFps } from './lappdelegate';
```

- [ ] **Step 3: 在 useLive2D.ts 添加 visibilitychange 监听**

在文件顶部导入区添加：

```typescript
import { setMaxFps } from '../lib/live2d';
```

在初始化 useEffect 中添加（在 isLoading 检查后）：

```typescript
// 页面可见性变化时降帧
useEffect(() => {
  if (isLoading) return;
  if (!isTauriEnv()) return;

  const onVisibilityChange = () => {
    if (document.hidden) {
      setMaxFps(5); // 后台时降到 5fps
    } else {
      setMaxFps(0); // 前台时不限制
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    setMaxFps(0); // 清理时恢复
  };
}, [isLoading]);
```

- [ ] **Step 4: typecheck + Commit**

```bash
pnpm typecheck 2>&1 | Select-String "useLive2D|lappdelegate|error TS" | Select-Object -First 10
git add src/lib/live2d/lappdelegate.ts src/lib/live2d/index.ts src/hooks/useLive2D.ts
git commit -m "perf(live2d): throttle FPS to 5 when page hidden"
```

---

## Task 8: 验证与最终提交

- [ ] **Step 1: 启动应用验证**

启动应用，观察：
1. 眨眼是否自然（3-8 秒间隔，闭眼快睁眼慢）
2. 鼠标静止 5 秒后，眼球是否会自然微动（眼跳）
3. 移动鼠标时，眼神立即跟随（眼跳让位）
4. TTS 说话时口型正常，停止后平滑闭嘴
5. 切换到其他窗口，CPU 占用下降

- [ ] **Step 2: 修复发现的问题**

如有问题，针对性修复并提交。

---

## 验收标准

- [ ] 眨眼动画三阶段状态机工作正常
- [ ] 眼跳系统自然随机
- [ ] 鼠标静止 5 秒后眼球开始微动
- [ ] 页面不可见时降帧到 5fps
- [ ] typecheck 无新增错误
- [ ] 主观感受：桌宠"活"起来，眼神自然
