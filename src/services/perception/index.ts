/**
 * Perception 感知模块入口
 *
 * 集成手势识别、面部追踪等感知能力，
 * 通过 WebSocket 与 Python 后端通信。
 */

export { perceptionService, PerceptionService } from './service';
export {
  GESTURE_MAPPING,
  findMapping,
  getAllGestures,
  DEFAULT_IDLE_EXPRESSION,
} from './gestureMapping';
export type {
  PerceptionState,
  HandData,
  HandLandmark,
  GestureDebug,
  FaceData,
  FaceLandmarkPoint,
  FaceDebug,
  ExpressionType,
  CalibData,
  GestureMappingEntry,
  PerceptionWSMessage,
  PerceptionCommand,
} from './types';
