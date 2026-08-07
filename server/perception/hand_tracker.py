"""MediaPipe 手部检测封装模块"""

import cv2
import dataclasses
from typing import Optional
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision as mp_vision
from .config import HAND_LANDMARKER_MODEL


@dataclasses.dataclass
class HandLandmark:
    x: float
    y: float
    z: float

    def to_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "z": self.z}


@dataclasses.dataclass
class HandData:
    handedness: str
    landmarks: list[HandLandmark]
    center: tuple[float, float]
    bbox: tuple[float, float]

    def to_dict(self) -> dict:
        return {
            "handedness": self.handedness,
            "landmarks": [lm.to_dict() for lm in self.landmarks],
            "center": {"x": self.center[0], "y": self.center[1]},
            "bbox": {"w": self.bbox[0], "h": self.bbox[1]},
        }


class HandTracker:
    def __init__(self, camera_id: int = 0, max_num_hands: int = 2):
        self.camera_id = camera_id
        self.max_num_hands = max_num_hands
        self.cap: Optional[cv2.VideoCapture] = None
        self.detector: Optional[mp_vision.HandLandmarker] = None

    def start(self) -> bool:
        self.cap = cv2.VideoCapture(self.camera_id)
        if not self.cap.isOpened():
            print(f"错误: 无法打开摄像头 {self.camera_id}")
            return False

        model_path = HAND_LANDMARKER_MODEL
        options = mp_vision.HandLandmarkerOptions(
            base_options=mp_tasks.BaseOptions(
                model_asset_path=model_path,
            ),
            running_mode=mp_vision.RunningMode.IMAGE,
            num_hands=self.max_num_hands,
            min_hand_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.detector = mp_vision.HandLandmarker.create_from_options(options)
        return True

    def process_frame(self, frame) -> list[dict]:
        if self.detector is None:
            return []

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(
            image_format=mp.ImageFormat.SRGB,
            data=rgb,
        )

        result = self.detector.detect(mp_image)

        return self._parse_result(result)

    def _parse_result(self, result) -> list[dict]:
        hands_data = []
        if not result or not result.hand_landmarks:
            return hands_data

        for idx, landmarks in enumerate(result.hand_landmarks):
            points = []
            xs, ys = [], []
            for lm in landmarks:
                points.append(HandLandmark(x=lm.x, y=lm.y, z=lm.z))
                xs.append(lm.x)
                ys.append(lm.y)

            cx = sum(xs) / len(xs)
            cy = sum(ys) / len(ys)
            w = max(xs) - min(xs)
            h = max(ys) - min(ys)

            handedness = "Unknown"
            if result.handedness and idx < len(result.handedness):
                handedness = result.handedness[idx][0].category_name

            hand = HandData(
                handedness=handedness,
                landmarks=points,
                center=(cx, cy),
                bbox=(w, h),
            )
            hands_data.append(hand.to_dict())

        return hands_data

    def release(self):
        if self.cap:
            self.cap.release()
        if self.detector:
            self.detector.close()
