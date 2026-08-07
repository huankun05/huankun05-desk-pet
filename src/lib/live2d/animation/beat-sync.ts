// src/lib/live2d/animation/beat-sync.ts
/**
 * 节拍同步系统（移植自 AIRI）
 * 通过音乐节拍触发 scheduleBeat()，生成 V 形/swing/sway 摆头轨迹
 * 弹簧物理将目标角度应用到 ParamAngleX/Y/Z
 *
 * 使用方式：
 * 1. createBeatSyncController() 创建控制器
 * 2. 音乐节拍触发时调用 scheduleBeat()
 * 3. 每帧 update() 中调用 applyBeatSync() 应用到模型
 */

export interface BeatBaseAngles {
  x: number;
  y: number;
  z: number;
}

type BeatStylePattern = 'v' | 'swing' | 'sway';

export type BeatSyncStyleName = 'punchy-v' | 'balanced-v' | 'swing-lr' | 'sway-sine';

interface BeatStyleConfig {
  topYaw: number;
  topRoll: number;
  bottomDip: number;
  pattern: BeatStylePattern;
  swingLift?: number;
}

interface BeatSegment {
  start: number;
  duration: number;
  fromY: number;
  fromZ: number;
  toY: number;
  toZ: number;
}

const defaultStyles: Record<BeatSyncStyleName, BeatStyleConfig> = {
  'punchy-v': { topYaw: 10, topRoll: 8, bottomDip: 4, pattern: 'v' },
  'balanced-v': { topYaw: 6, topRoll: 0, bottomDip: 6, pattern: 'v' },
  'swing-lr': { topYaw: 8, topRoll: 0, bottomDip: 6, swingLift: 8, pattern: 'swing' },
  'sway-sine': { topYaw: 10, topRoll: 0, bottomDip: 0, swingLift: 10, pattern: 'sway' },
};

export interface BeatSyncController {
  targetX: number;
  targetY: number;
  targetZ: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  updateTargets: (now: number) => void;
  scheduleBeat: (timestamp?: number | null) => void;
  setStyle: (style: BeatSyncStyleName) => void;
  getStyle: () => BeatSyncStyleName;
  setAutoStyleShift: (enabled: boolean) => void;
  isActive: () => boolean;
}

interface CreateBeatSyncControllerOptions {
  baseAngles: () => BeatBaseAngles;
  releaseDelayMs?: number;
  defaultIntervalMs?: number;
  styles?: Partial<Record<BeatSyncStyleName, BeatStyleConfig>>;
  initialStyle?: BeatSyncStyleName;
  autoStyleShift?: boolean;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function easeOutCubic(t: number): number {
  return 1 - ((1 - t) ** 3);
}

export function createBeatSyncController(options: CreateBeatSyncControllerOptions): BeatSyncController {
  const {
    baseAngles: baseAnglesGetter,
    releaseDelayMs = 1800,
    defaultIntervalMs = 600,
    styles = {},
    initialStyle = 'punchy-v',
    autoStyleShift = false,
  } = options;

  const styleMap = { ...defaultStyles, ...styles };

  // 纯 TS 状态（去掉 Vue ref）
  let targetX = 0;
  let targetY = 0;
  let targetZ = 0;
  let velocityX = 0;
  let velocityY = 0;
  let velocityZ = 0;
  let segments: BeatSegment[] = [];
  let currentTopSide: 'left' | 'right' = 'left';
  let primed = false;
  let patternStarted = false;
  let lastBeatTimestamp: number | null = null;
  let lastInterval: number | null = null;
  let avgInterval: number | null = null;
  let style: BeatSyncStyleName = initialStyle;
  let autoShift = autoStyleShift;

  function getStyleConfig(): BeatStyleConfig {
    return styleMap[style] || defaultStyles['punchy-v'];
  }

  function getBaseAngles(): BeatBaseAngles {
    return baseAnglesGetter();
  }

  function getTopPose(side: 'left' | 'right') {
    const { topYaw, topRoll, swingLift, pattern } = getStyleConfig();
    const direction = side === 'left' ? -1 : 1;
    const zOffset = (pattern === 'swing' || pattern === 'sway') ? (swingLift ?? topRoll) : topRoll;
    const z = getBaseAngles().z + (pattern === 'swing' || pattern === 'sway' ? zOffset : direction * zOffset);
    return {
      y: getBaseAngles().y + (direction * topYaw),
      z,
    };
  }

  function getBottomPose() {
    const { bottomDip } = getStyleConfig();
    return {
      y: getBaseAngles().y,
      z: getBaseAngles().z - bottomDip,
    };
  }

  function updateTargets(now: number) {
    let currentY: number | undefined = targetY;
    let currentZ: number | undefined = targetZ;

    if (!primed && !segments.length) {
      currentY = getBaseAngles().y;
      currentZ = getBaseAngles().z;
    }

    currentY ??= getBaseAngles().y;
    currentZ ??= getBaseAngles().z;

    while (segments.length) {
      const segment = segments[0];

      if (now < segment.start) {
        currentY = segment.fromY;
        currentZ = segment.fromZ;
        break;
      }

      const progress = Math.min(1, (now - segment.start) / Math.max(segment.duration, 1));
      const eased = easeOutCubic(progress);
      currentY = lerp(segment.fromY, segment.toY, eased);
      currentZ = lerp(segment.fromZ, segment.toZ, eased);

      if (progress >= 1) {
        segments.shift();
        continue;
      }

      break;
    }

    const lastBeat = lastBeatTimestamp;
    const timeSinceBeat = primed && lastBeat != null ? (now - lastBeat) : Infinity;
    const shouldRelease = primed && !segments.length && timeSinceBeat > releaseDelayMs;

    if (shouldRelease) {
      primed = false;
      patternStarted = false;
      currentTopSide = 'left';
      segments = [];
      lastBeatTimestamp = null;
      currentY = getBaseAngles().y;
      currentZ = getBaseAngles().z;
      velocityY *= 0.5;
      velocityZ *= 0.5;
    }

    targetY = currentY;
    targetZ = currentZ;
  }

  function scheduleBeat(timestamp?: number | null) {
    const now = timestamp != null && isFinite(timestamp as number)
      ? Number(timestamp)
      : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    updateTargets(now);

    if (!primed) {
      primed = true;
      lastBeatTimestamp = now;
      return;
    }

    const interval = Math.min(2000, Math.max(220, lastBeatTimestamp != null ? (now - lastBeatTimestamp) : defaultIntervalMs));
    lastBeatTimestamp = now;
    lastInterval = interval;
    avgInterval = avgInterval == null ? interval : (avgInterval * 0.7 + interval * 0.3);
    if (autoShift && avgInterval) {
      const bpm = 60000 / avgInterval;
      const targetStyle: BeatSyncStyleName = bpm < 120 ? 'swing-lr' : bpm < 180 ? 'balanced-v' : 'punchy-v';
      if (targetStyle !== style) style = targetStyle;
    }
    const halfDuration = Math.max(80, interval / 2);
    const startPose = { y: targetY, z: targetZ };

    segments = [];

    const styleConfig = getStyleConfig();
    const nextSide = currentTopSide === 'left' ? 'right' : 'left';

    if (styleConfig.pattern === 'v') {
      if (!patternStarted) {
        const topPose = getTopPose('left');
        segments.push({
          start: now,
          duration: halfDuration,
          fromY: startPose.y,
          fromZ: startPose.z,
          toY: topPose.y,
          toZ: topPose.z,
        });
        patternStarted = true;
        currentTopSide = 'left';
        return;
      }

      const bottomPose = getBottomPose();
      const nextTopPose = getTopPose(nextSide);

      segments.push({
        start: now,
        duration: halfDuration,
        fromY: startPose.y,
        fromZ: startPose.z,
        toY: bottomPose.y,
        toZ: bottomPose.z,
      });
      segments.push({
        start: now + halfDuration,
        duration: halfDuration,
        fromY: bottomPose.y,
        fromZ: bottomPose.z,
        toY: nextTopPose.y,
        toZ: nextTopPose.z,
      });

      currentTopSide = nextSide;
    } else if (styleConfig.pattern === 'swing') {
      const currentSide = currentTopSide;
      const sidePose = getTopPose(currentSide);
      const oppositePose = getTopPose(nextSide);
      const sidePortion = 0.35;
      const sideDuration = Math.max(60, interval * sidePortion);
      const crossDuration = Math.max(60, interval - sideDuration);

      segments.push({
        start: now,
        duration: sideDuration,
        fromY: startPose.y,
        fromZ: startPose.z,
        toY: sidePose.y,
        toZ: sidePose.z,
      });
      segments.push({
        start: now + sideDuration,
        duration: crossDuration,
        fromY: sidePose.y,
        fromZ: sidePose.z,
        toY: oppositePose.y,
        toZ: oppositePose.z,
      });

      patternStarted = true;
      currentTopSide = nextSide;
    } else if (styleConfig.pattern === 'sway') {
      const currentSide = currentTopSide;
      const sidePose = getTopPose(currentSide);
      const oppositePose = getTopPose(nextSide);
      const centerPose = { y: getBaseAngles().y, z: getBaseAngles().z };
      const lift = styleConfig.swingLift ?? 10;

      if (!patternStarted) {
        segments.push({
          start: now,
          duration: halfDuration,
          fromY: startPose.y,
          fromZ: startPose.z,
          toY: sidePose.y,
          toZ: sidePose.z,
        });
        patternStarted = true;
        currentTopSide = currentSide;
        return;
      }

      const apexPose = {
        y: 0,
        z: centerPose.z + lift,
      };

      const leg1 = Math.max(60, interval * 0.5);
      const leg2 = Math.max(60, interval - leg1);

      segments.push({
        start: now,
        duration: leg1,
        fromY: startPose.y,
        fromZ: startPose.z,
        toY: apexPose.y,
        toZ: apexPose.z,
      });
      segments.push({
        start: now + leg1,
        duration: leg2,
        fromY: apexPose.y,
        fromZ: apexPose.z,
        toY: oppositePose.y,
        toZ: oppositePose.z,
      });

      patternStarted = true;
      currentTopSide = nextSide;
    }
  }

  return {
    get targetX() { return targetX; },
    get targetY() { return targetY; },
    get targetZ() { return targetZ; },
    get velocityX() { return velocityX; },
    get velocityY() { return velocityY; },
    get velocityZ() { return velocityZ; },
    set velocityX(v: number) { velocityX = v; },
    set velocityY(v: number) { velocityY = v; },
    set velocityZ(v: number) { velocityZ = v; },
    updateTargets,
    scheduleBeat,
    setStyle: (s: BeatSyncStyleName) => { style = s; },
    getStyle: () => style,
    setAutoStyleShift: (enabled: boolean) => { autoShift = enabled; },
    isActive: () => primed,
  };
}

/**
 * 将 Beat-Sync 目标通过弹簧物理应用到模型参数
 * 移植自 AIRI motion-manager.ts 的 useMotionUpdatePluginBeatSync
 */
export function applyBeatSyncToSprings(
  controller: BeatSyncController,
  springX: { position: number; velocity: number },
  springY: { position: number; velocity: number },
  springZ: { position: number; velocity: number },
  deltaTime: number,
  config: { stiffness: number; damping: number; mass: number; snapThreshold: number },
): { angleX: number; angleY: number; angleZ: number } {
  // Semi-implicit Euler approach（与 AIRI 完全一致）
  const { stiffness, damping, mass, snapThreshold } = config;

  // Y
  {
    const target = controller.targetY;
    const pos = springY.position;
    const vel = controller.velocityY;
    const accel = (stiffness * (target - pos) - damping * vel) / mass;
    controller.velocityY = vel + accel * deltaTime;
    springY.position = pos + controller.velocityY * deltaTime;

    if (Math.abs(target - springY.position) < snapThreshold && Math.abs(controller.velocityY) < snapThreshold) {
      springY.position = target;
      controller.velocityY = 0;
    }
  }

  // Z
  {
    const target = controller.targetZ;
    const pos = springZ.position;
    const vel = controller.velocityZ;
    const accel = (stiffness * (target - pos) - damping * vel) / mass;
    controller.velocityZ = vel + accel * deltaTime;
    springZ.position = pos + controller.velocityZ * deltaTime;

    if (Math.abs(target - springZ.position) < snapThreshold && Math.abs(controller.velocityZ) < snapThreshold) {
      springZ.position = target;
      controller.velocityZ = 0;
    }
  }

  // X 保持 0（beat-sync 主要控制 Y/Z，X 由鼠标驱动）
  return {
    angleX: 0,
    angleY: springY.position,
    angleZ: springZ.position,
  };
}