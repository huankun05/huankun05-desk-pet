export interface IdleSwayState {
  startTime: number;
  baseAngleX: number;
  baseAngleY: number;
  baseAngleZ: number;
  baseBodyAngleX: number;
  baseBodyAngleY: number;
  phase: number;
}

export function createIdleSwayState(): IdleSwayState {
  return {
    startTime: performance.now(),
    baseAngleX: 0,
    baseAngleY: 0,
    baseAngleZ: 0,
    baseBodyAngleX: 0,
    baseBodyAngleY: 0,
    phase: Math.random() * Math.PI * 2,
  };
}

const SWAY_CONFIG = {
  angleXAmplitude: 6.0,
  angleXFrequency: 0.06,
  angleYAmplitude: 3.0,
  angleYFrequency: 0.045,
  angleZAmplitude: 2.5,
  angleZFreqency: 0.08,
  bodyAngleXAmplitude: 4.0,
  bodyAngleXFrequency: 0.035,
  bodyAngleYAmplitude: 1.5,
  bodyAngleYFrequency: 0.025,
  breathAmplitude: 0.8,
  breathFrequency: 0.12,
  microSwayAmplitude: 0.6,
  microSwayFrequency: 0.18,
};

export function updateIdleSway(
  state: IdleSwayState,
  nowMs: number,
  intensity: number = 1.0,
): {
  angleX: number;
  angleY: number;
  angleZ: number;
  bodyAngleX: number;
  bodyAngleY: number;
} {
  const t = (nowMs - state.startTime) / 1000;
  const {
    angleXAmplitude,
    angleXFrequency,
    angleYAmplitude,
    angleYFrequency,
    angleZAmplitude,
    angleZFreqency,
    bodyAngleXAmplitude,
    bodyAngleXFrequency,
    bodyAngleYAmplitude,
    bodyAngleYFrequency,
    breathAmplitude,
    breathFrequency,
    microSwayAmplitude,
    microSwayFrequency,
  } = SWAY_CONFIG;

  const phase = state.phase;

  const swayX =
    Math.sin(t * angleXFrequency * Math.PI * 2 + phase) * angleXAmplitude +
    Math.sin(t * microSwayFrequency * Math.PI * 2 + phase * 1.3) * microSwayAmplitude;

  const swayY =
    Math.sin(t * angleYFrequency * Math.PI * 2 + phase * 0.7) * angleYAmplitude +
    Math.sin(t * breathFrequency * Math.PI * 2 + phase) * breathAmplitude;

  const swayZ =
    Math.sin(t * angleZFreqency * Math.PI * 2 + phase * 1.1) * angleZAmplitude;

  const bodySwayX =
    Math.sin(t * bodyAngleXFrequency * Math.PI * 2 + phase * 0.5) * bodyAngleXAmplitude;

  const bodySwayY =
    Math.sin(t * bodyAngleYFrequency * Math.PI * 2 + phase * 0.9) * bodyAngleYAmplitude;

  return {
    angleX: swayX * intensity,
    angleY: swayY * intensity,
    angleZ: swayZ * intensity,
    bodyAngleX: bodySwayX * intensity,
    bodyAngleY: bodySwayY * intensity,
  };
}
