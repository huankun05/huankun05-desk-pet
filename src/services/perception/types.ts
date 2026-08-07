/**
 * Perception 感知服务类型定义
 * 手部检测 + 面部追踪 + 手势识别
 */

// ===== 手部数据 =====

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export interface HandData {
  handedness: string;
  fingertip: { x: number; y: number; z: number };
  center?: { x: number; y: number };
  bbox?: { w: number; h: number };
  depth_estimate: number;
  fingers_extended: boolean[];
  pinch_distance: number;
  landmarks?: HandLandmark[];
  gesture?: string;
  gesture_debug?: GestureDebug;
}

export interface GestureDebug {
  pinch_dist: number;
  fingers: boolean[];
  z_diff?: number;
  thumb_dy?: number;
  thumb_palm?: number;
  fingers_crossed?: boolean;
}

export interface HandDataMessage {
  type: 'hand_data';
  timestamp: number;
  hands: HandData[];
}

// ===== 面部数据 =====

export interface FaceLandmarkPoint {
  x: number;
  y: number;
}

export type ExpressionType = 'happy' | 'sad' | 'neutral' | 'surprised' | 'angry';

export interface FaceData {
  detected: boolean;
  expression: ExpressionType;
  expression_confidence: number;
  baseline_calibrated?: boolean;
  gaze: { x: number; y: number };
  head_pose: { pitch: number; yaw: number; roll: number };
  eye_openness: { left: number; right: number };
  mouth_open: number;
  mouth_smile: number;
  face_debug?: FaceDebug;
  landmarks?: {
    left_eye: FaceLandmarkPoint[];
    right_eye: FaceLandmarkPoint[];
    left_brow: FaceLandmarkPoint[];
    right_brow: FaceLandmarkPoint[];
    outer_lips: FaceLandmarkPoint[];
    nose: FaceLandmarkPoint[];
  };
}

export interface FaceDebug {
  eyebrow_raise: number;
  eye_open_left: number;
  eye_open_right: number;
  mouth_open: number;
  mouth_smile: number;
  mouth_aspect_ratio: number;
  mouth_corner_angle: number;
  nasolabial_depth: number;
  brow_eye_gap: number;
  brow_eye_gap_raw: number;
}

export interface FaceDataMessage {
  type: 'face_data';
  timestamp: number;
  face: FaceData | null;
}

// ===== 校准数据 =====

export interface CalibData {
  pinch_close: number;
  pinch_open: number;
  heart_ok_z_diff: number;
  thumb_up_threshold: number;
  finger_extended_threshold: number;
  face_smile_threshold: number;
  face_eye_open_threshold: number;
  face_mouth_aspect_threshold: number;
  face_brow_eye_gap_threshold: number;
  face_sad_smile_threshold: number;
  face_sad_eye_threshold: number;
  face_nasolabial_threshold: number;
}

export interface CalibMessage {
  type: 'calib_data';
  calib: CalibData;
}

// ===== 手势映射 =====

export interface GestureMappingEntry {
  gesture: string;
  expression: string | null;
  expressionFadeOut?: number;
  expressionFadeIn?: number;
  motion: string | null;
  motionPriority?: number;
  expressionDuration?: number;
  gazeTarget?: 'user' | 'hand' | 'idle';
  bodyAngle?: number;
  priority?: number;
}

export interface GestureMappingMessage {
  type: 'gesture_mapping_data';
  mapping: GestureMappingEntry[];
}

// ===== 手势样本 =====

export interface GestureSamplesMessage {
  type: 'gesture_samples_data';
  counts: Record<string, number>;
}

// ===== WebSocket 消息 =====

export type PerceptionWSMessage =
  | HandDataMessage
  | FaceDataMessage
  | CalibMessage
  | GestureMappingMessage
  | GestureSamplesMessage
  | { type: string; [key: string]: unknown };

// ===== 命令 =====

export interface CalibrateCommand {
  type: 'calibrate';
  key: string;
  value: number;
}

export interface SaveCalibCommand {
  type: 'save_calib';
}

export interface RecordGestureCommand {
  type: 'record_gesture';
  gesture: string;
}

export interface ClearGestureSamplesCommand {
  type: 'clear_gesture_samples';
  gesture?: string;
}

export interface ResetFaceBaselineCommand {
  type: 'reset_face_baseline';
}

export interface SaveGestureMappingCommand {
  type: 'save_gesture_mapping';
  mapping: GestureMappingEntry[];
}

export type PerceptionCommand =
  | CalibrateCommand
  | SaveCalibCommand
  | RecordGestureCommand
  | ClearGestureSamplesCommand
  | ResetFaceBaselineCommand
  | SaveGestureMappingCommand
  | { type: string; [key: string]: unknown };

// ===== 感知服务状态 =====

export interface PerceptionState {
  isConnected: boolean;
  isRunning: boolean;
  lastHandData: HandData[] | null;
  lastFaceData: FaceData | null;
  calib: CalibData | null;
  gestureMapping: GestureMappingEntry[];
  gestureSamples: Record<string, number>;
  error: string | null;
}
