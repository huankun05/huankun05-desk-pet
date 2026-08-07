/**
 * 手势 → Live2D 表情 / 动作映射配置
 */

export interface GestureMappingEntry {
  gesture: string;
  expression: string | null;
  expressionFadeIn?: number;
  expressionFadeOut?: number;
  expressionDuration?: number;
  motion: string | null;
  motionPriority?: number;
  priority?: number;
  gazeTarget?: 'user' | 'hand' | 'idle';
  bodyAngle?: number;
}

export const GESTURE_MAPPING: readonly GestureMappingEntry[] = [
  {
    gesture: 'Heart',
    expression: 'Shy',
    expressionFadeIn: 0.3,
    expressionDuration: 3.0,
    motion: null,
    priority: 100,
    gazeTarget: 'user',
    bodyAngle: 0,
  },
  {
    gesture: 'Thumb_Up',
    expression: 'Happy1',
    expressionFadeIn: 0.3,
    expressionDuration: 2.0,
    motion: null,
    priority: 80,
    gazeTarget: 'user',
  },
  {
    gesture: 'Victory',
    expression: 'Happy1',
    expressionFadeIn: 0.3,
    expressionDuration: 1.5,
    motion: null,
    priority: 80,
    gazeTarget: 'user',
  },
  {
    gesture: 'Cross_Fingers',
    expression: 'StarEye',
    expressionFadeIn: 0.5,
    expressionDuration: 2.0,
    motion: null,
    priority: 80,
    gazeTarget: 'user',
  },
  {
    gesture: 'Open_Palm',
    expression: null,
    expressionDuration: 0,
    motion: 'Wave',
    motionPriority: 2,
    priority: 60,
    gazeTarget: 'hand',
  },
  {
    gesture: 'Wave',
    expression: 'Happy1',
    expressionFadeIn: 0.3,
    expressionDuration: 1.0,
    motion: 'Wave',
    motionPriority: 3,
    priority: 70,
    gazeTarget: 'user',
  },
  {
    gesture: 'OK',
    expression: 'Happy1',
    expressionFadeIn: 0.2,
    expressionDuration: 1.0,
    motion: 'Nod',
    motionPriority: 2,
    priority: 60,
    gazeTarget: 'user',
  },
  {
    gesture: 'Pointing_Up',
    expression: 'StarEye',
    expressionFadeIn: 0.3,
    expressionDuration: 1.5,
    motion: null,
    priority: 60,
    gazeTarget: 'hand',
    bodyAngle: -5,
  },
  {
    gesture: 'Pointing_Down',
    expression: null,
    expressionDuration: 0,
    motion: null,
    priority: 60,
    gazeTarget: 'hand',
    bodyAngle: 10,
  },
  {
    gesture: 'Pointing_Left',
    expression: null,
    expressionDuration: 0,
    motion: null,
    priority: 60,
    gazeTarget: 'hand',
    bodyAngle: -15,
  },
  {
    gesture: 'Pointing_Right',
    expression: null,
    expressionDuration: 0,
    motion: null,
    priority: 60,
    gazeTarget: 'hand',
    bodyAngle: 15,
  },
  {
    gesture: 'Closed_Fist',
    expression: 'Angry',
    expressionFadeIn: 0.3,
    expressionDuration: 1.5,
    motion: null,
    priority: 50,
  },
  {
    gesture: 'Pinch',
    expression: 'Halfeyes',
    expressionFadeIn: 0.5,
    expressionDuration: 2.0,
    motion: null,
    priority: 70,
    gazeTarget: 'hand',
    bodyAngle: 5,
  },
  {
    gesture: 'Stop',
    expression: 'Halfeyes',
    expressionFadeIn: 0.5,
    expressionDuration: 1.0,
    motion: null,
    priority: 60,
  },
  {
    gesture: 'Call_Me',
    expression: 'Shy',
    expressionFadeIn: 0.3,
    expressionDuration: 2.0,
    motion: 'Wave',
    motionPriority: 2,
    priority: 60,
    gazeTarget: 'user',
  },
  {
    gesture: 'Rock',
    expression: 'Happy1',
    expressionFadeIn: 0.3,
    expressionDuration: 1.5,
    motion: null,
    priority: 60,
  },
];

export const DEFAULT_IDLE_EXPRESSION: string | null = null;

export function findMapping(
  gesture: string,
  mapping?: GestureMappingEntry[],
): GestureMappingEntry | undefined {
  const source = mapping ?? GESTURE_MAPPING;
  return source.find((entry) => entry.gesture === gesture);
}

export function getAllGestures(): string[] {
  const gestures = new Set<string>();
  for (const entry of GESTURE_MAPPING) {
    gestures.add(entry.gesture);
  }
  return Array.from(gestures);
}
