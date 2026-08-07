"""MediaPipe Face Mesh 面部追踪模块

检测面部 468 个关键点，识别表情、注视方向、头部姿态。
"""

import cv2
import dataclasses
import math
from typing import Optional
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision as mp_vision
from .config import FACE_LANDMARKER_MODEL, FACE_DETECTION_RESOLUTION


@dataclasses.dataclass
class FaceFeatures:
    eyebrow_raise: float = 0.0
    eye_open_left: float = 1.0
    eye_open_right: float = 1.0
    mouth_open: float = 0.0

    mouth_smile: float = 0.0
    mouth_aspect_ratio: float = 0.0
    mouth_corner_angle: float = 0.0
    nasolabial_depth: float = 0.0

    brow_eye_gap: float = 0.0
    brow_eye_gap_raw: float = 0.0

    head_pitch: float = 0.0
    head_yaw: float = 0.0
    head_roll: float = 0.0

    gaze_x: float = 0.0
    gaze_y: float = 0.0


class FaceTracker:
    KEY_LANDMARKS = {
        "left_eye": [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
        "right_eye": [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
        "left_brow": [70, 63, 105, 66, 107],
        "right_brow": [336, 296, 334, 293, 300],
        "outer_lips": [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146],
        "nose": [1, 2, 98, 327],
    }

    def __init__(self, auto_recalibrate_interval: int = 0,
                 detection_resolution: float = FACE_DETECTION_RESOLUTION):
        self.detector: Optional[mp_vision.FaceLandmarker] = None
        self._prev_features = FaceFeatures()
        self._baseline_samples: list[dict] = []
        self._neutral_corner_angle: float = 0.0
        self._neutral_nasolabial: float = 0.0
        self._neutral_brow_eye_gap: float = 0.0
        self._baseline_calibrated: bool = False
        self._auto_recalibrate_interval = auto_recalibrate_interval
        self._frame_count = 0
        self._detection_resolution = max(0.1, min(1.0, detection_resolution))

    def reset_baseline(self):
        self._baseline_samples.clear()
        self._baseline_calibrated = False
        self._neutral_corner_angle = 0.0
        self._neutral_nasolabial = 0.0
        self._neutral_brow_eye_gap = 0.0
        self._frame_count = 0

    def start(self):
        options = mp_vision.FaceLandmarkerOptions(
            base_options=mp_tasks.BaseOptions(
                model_asset_path=FACE_LANDMARKER_MODEL,
            ),
            running_mode=mp_vision.RunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
            min_tracking_confidence=0.5,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=False,
        )
        self.detector = mp_vision.FaceLandmarker.create_from_options(options)

    def process_frame(self, frame, calib: dict | None = None) -> dict:
        if self.detector is None:
            return {"detected": False}

        self._frame_count += 1
        if (self._auto_recalibrate_interval > 0
                and self._baseline_calibrated
                and self._frame_count % self._auto_recalibrate_interval == 0):
            self.reset_baseline()

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        if self._detection_resolution < 1.0:
            h, w = rgb.shape[:2]
            new_w = int(w * self._detection_resolution)
            new_h = int(h * self._detection_resolution)
            rgb = cv2.resize(rgb, (new_w, new_h), interpolation=cv2.INTER_AREA)

        mp_image = mp.Image(
            image_format=mp.ImageFormat.SRGB,
            data=rgb,
        )
        result = self.detector.detect(mp_image)

        if not result.face_landmarks or len(result.face_landmarks) == 0:
            return {"detected": False}

        landmarks = result.face_landmarks[0]
        features = self._extract_features(landmarks, result)
        result_dict = self._classify_expression(features, calib)
        result_dict["landmarks"] = self._extract_key_landmarks(landmarks)
        return result_dict

    def _extract_features(self, landmarks, result) -> FaceFeatures:
        h_lm = lambda i: landmarks[i]

        face_width = abs(h_lm(234).x - h_lm(454).x)
        if face_width < 0.001:
            face_width = 0.3

        left_brow_top = h_lm(66).y
        right_brow_top = h_lm(296).y
        left_eye_top = h_lm(159).y
        right_eye_top = h_lm(386).y
        eyebrow_raise = max(
            (left_eye_top - left_brow_top) / max(face_width, 0.001) * 3,
            (right_eye_top - right_brow_top) / max(face_width, 0.001) * 3,
        )
        eyebrow_raise = max(0.0, min(1.0, eyebrow_raise))

        left_eye_h = abs(h_lm(159).y - h_lm(145).y)
        right_eye_h = abs(h_lm(386).y - h_lm(374).y)
        eye_open_left = min(1.0, (left_eye_h / max(face_width, 0.001)) * 8)
        eye_open_right = min(1.0, (right_eye_h / max(face_width, 0.001)) * 8)

        upper_lip = h_lm(0)
        lower_lip = h_lm(17)
        mouth_open_raw = abs(upper_lip.y - lower_lip.y) / max(face_width, 0.001)
        mouth_open = min(1.0, mouth_open_raw * 5)

        mouth_left = h_lm(61)
        mouth_right = h_lm(291)
        mouth_width = math.sqrt(
            (mouth_right.x - mouth_left.x) ** 2 +
            (mouth_right.y - mouth_left.y) ** 2
        )
        mouth_height = abs(upper_lip.y - lower_lip.y)
        mouth_aspect_ratio = mouth_height / max(mouth_width, 0.001)

        mouth_center_y = (mouth_left.y + mouth_right.y) / 2
        lip_center_y = h_lm(13).y
        corner_angle_raw = (lip_center_y - mouth_center_y) / max(face_width, 0.001)

        nose_left = h_lm(98)
        nose_right = h_lm(327)
        nl_left = math.sqrt(
            (mouth_left.x - nose_left.x) ** 2 +
            (mouth_left.y - nose_left.y) ** 2
        )
        nl_right = math.sqrt(
            (mouth_right.x - nose_right.x) ** 2 +
            (mouth_right.y - nose_right.y) ** 2
        )
        nasolabial_raw = (nl_left + nl_right) / 2 / max(face_width, 0.001)

        left_brow_center_y = (h_lm(66).y + h_lm(105).y) / 2
        right_brow_center_y = (h_lm(296).y + h_lm(334).y) / 2
        left_eye_center_y = (h_lm(159).y + h_lm(145).y) / 2
        right_eye_center_y = (h_lm(386).y + h_lm(374).y) / 2
        brow_eye_gap_raw = (
            (left_eye_center_y - left_brow_center_y) +
            (right_eye_center_y - right_brow_center_y)
        ) / 2 / max(face_width, 0.001)

        if not self._baseline_calibrated:
            self._baseline_samples.append({
                "corner": corner_angle_raw,
                "nasolabial": nasolabial_raw,
                "brow_eye": brow_eye_gap_raw,
            })
            if len(self._baseline_samples) >= 30:
                self._neutral_corner_angle = sum(
                    s["corner"] for s in self._baseline_samples
                ) / len(self._baseline_samples)
                self._neutral_nasolabial = sum(
                    s["nasolabial"] for s in self._baseline_samples
                ) / len(self._baseline_samples)
                self._neutral_brow_eye_gap = sum(
                    s["brow_eye"] for s in self._baseline_samples
                ) / len(self._baseline_samples)
                self._baseline_calibrated = True
                self._baseline_samples.clear()

        mouth_smile = (corner_angle_raw - self._neutral_corner_angle) * 10
        mouth_smile = max(-1.0, min(1.0, mouth_smile))

        nasolabial_depth = (nasolabial_raw - self._neutral_nasolabial) * 10
        nasolabial_depth = max(0.0, min(1.0, nasolabial_depth))

        brow_eye_gap = (brow_eye_gap_raw - self._neutral_brow_eye_gap) * 5
        brow_eye_gap = max(0.0, min(1.0, brow_eye_gap))

        nose = h_lm(1)
        left_ear = h_lm(234)
        right_ear = h_lm(454)
        ear_mid_y = (left_ear.y + right_ear.y) / 2
        ear_mid_x = (left_ear.x + right_ear.x) / 2

        head_yaw = (nose.x - ear_mid_x) * 5
        head_yaw = max(-1.0, min(1.0, head_yaw))

        head_pitch = (nose.y - ear_mid_y) * 3
        head_pitch = max(-1.0, min(1.0, head_pitch))

        dx = right_ear.x - left_ear.x
        dy = right_ear.y - left_ear.y
        head_roll = math.atan2(dy, dx)

        left_iris = h_lm(468) if len(landmarks) > 468 else h_lm(159)
        right_iris = h_lm(473) if len(landmarks) > 473 else h_lm(386)

        left_eye_cx = (h_lm(33).x + h_lm(133).x) / 2
        left_eye_cy = (h_lm(159).y + h_lm(145).y) / 2
        gaze_x = (left_iris.x - left_eye_cx) * 20
        gaze_y = (left_iris.y - left_eye_cy) * 20
        gaze_x = max(-1.0, min(1.0, gaze_x))
        gaze_y = max(-1.0, min(1.0, gaze_y))

        return FaceFeatures(
            eyebrow_raise=eyebrow_raise,
            eye_open_left=eye_open_left,
            eye_open_right=eye_open_right,
            mouth_open=mouth_open,
            mouth_smile=mouth_smile,
            mouth_aspect_ratio=round(mouth_aspect_ratio, 4),
            mouth_corner_angle=round(corner_angle_raw, 4),
            nasolabial_depth=nasolabial_depth,
            brow_eye_gap=brow_eye_gap,
            brow_eye_gap_raw=round(brow_eye_gap_raw, 4),
            head_pitch=head_pitch,
            head_yaw=head_yaw,
            head_roll=head_roll,
            gaze_x=gaze_x,
            gaze_y=gaze_y,
        )

    def _extract_key_landmarks(self, landmarks) -> dict:
        def _pts(indices: list[int]) -> list[dict]:
            return [
                {"x": round(landmarks[i].x, 4), "y": round(landmarks[i].y, 4)}
                for i in indices
            ]

        result = {}
        for name, indices in self.KEY_LANDMARKS.items():
            result[name] = _pts(indices)
        return result

    def _classify_expression(self, f: FaceFeatures, calib: dict | None = None) -> dict:
        if calib is None:
            calib = {}

        def _result(expression: str, confidence: float) -> dict:
            return {
                "detected": True,
                "expression": expression,
                "expression_confidence": confidence,
                "baseline_calibrated": self._baseline_calibrated,
                "gaze": {"x": f.gaze_x, "y": f.gaze_y},
                "head_pose": {
                    "pitch": f.head_pitch,
                    "yaw": f.head_yaw,
                    "roll": f.head_roll,
                },
                "eye_openness": {"left": f.eye_open_left, "right": f.eye_open_right},
                "mouth_open": f.mouth_open,
                "mouth_smile": f.mouth_smile,
                "face_debug": {
                    "eyebrow_raise": round(f.eyebrow_raise, 4),
                    "eye_open_left": round(f.eye_open_left, 4),
                    "eye_open_right": round(f.eye_open_right, 4),
                    "mouth_open": round(f.mouth_open, 4),
                    "mouth_smile": round(f.mouth_smile, 4),
                    "mouth_aspect_ratio": f.mouth_aspect_ratio,
                    "mouth_corner_angle": f.mouth_corner_angle,
                    "nasolabial_depth": round(f.nasolabial_depth, 4),
                    "brow_eye_gap": round(f.brow_eye_gap, 4),
                    "brow_eye_gap_raw": f.brow_eye_gap_raw,
                },
            }

        if not self._baseline_calibrated:
            return _result("neutral", 0.0)
        smile_thr = calib.get("face_smile_threshold", 0.35)
        eye_thr = calib.get("face_eye_open_threshold", 0.3)
        aspect_thr = calib.get("face_mouth_aspect_threshold", 0.75)
        brow_gap_thr = calib.get("face_brow_eye_gap_threshold", 0.05)
        sad_smile_thr = calib.get("face_sad_smile_threshold", 0.02)
        sad_eye_thr = calib.get("face_sad_eye_threshold", 0.4)
        nl_thr = calib.get("face_nasolabial_threshold", 0.10)

        if f.mouth_aspect_ratio > aspect_thr:
            confidence = min(1.0, f.mouth_aspect_ratio / 1.0)
            if f.brow_eye_gap > brow_gap_thr:
                confidence = min(1.0, confidence + 0.2)
            return _result("surprised", confidence)

        is_strong_smile = f.mouth_smile > smile_thr
        is_moderate_smile_with_nl = (
            f.mouth_smile > smile_thr * 0.6
            and f.nasolabial_depth > nl_thr
        )
        if is_strong_smile or is_moderate_smile_with_nl:
            confidence = min(1.0, f.mouth_smile + 0.3)
            if f.nasolabial_depth > nl_thr:
                confidence = min(1.0, confidence + 0.1)
            return _result("happy", confidence)

        is_strong_sad = f.mouth_smile < -sad_smile_thr
        is_moderate_sad_with_eye = (
            f.mouth_smile < -sad_smile_thr * 0.3
            and f.eye_open_left < sad_eye_thr
        )
        if is_strong_sad or is_moderate_sad_with_eye:
            confidence = 0.7 if is_strong_sad else 0.5
            return _result("sad", confidence)

        return _result("neutral", 0.5)

    def close(self):
        if self.detector:
            self.detector.close()
