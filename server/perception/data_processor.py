"""数据后处理：平滑、坐标映射、深度估算"""

import json
import math
import os
from collections import deque
from pathlib import Path
from .config import CALIBRATION_PATH, GESTURE_SAMPLES_PATH

_DEFAULT_CALIB = {
    "pinch_close": 0.15,
    "pinch_open": 0.08,
    "heart_ok_z_diff": 0.02,
    "thumb_up_threshold": -0.05,
    "finger_extended_threshold": 1.2,
    "face_smile_threshold": 0.35,
    "face_eye_open_threshold": 0.3,
    "face_mouth_aspect_threshold": 0.75,
    "face_brow_eye_gap_threshold": 0.05,
    "face_sad_smile_threshold": 0.02,
    "face_sad_eye_threshold": 0.4,
    "face_nasolabial_threshold": 0.10,
}


class CalibConfig:
    def __init__(self, path: str = CALIBRATION_PATH):
        self.path = path
        self.values = dict(_DEFAULT_CALIB)
        self._load()

    def _load(self):
        if os.path.exists(self.path):
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for k in _DEFAULT_CALIB:
                    if k in data and isinstance(data[k], (int, float)):
                        self.values[k] = float(data[k])
            except Exception:
                pass

    def save(self):
        out = dict(self.values)
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2, ensure_ascii=False)

    def get(self, key: str) -> float:
        return self.values.get(key, _DEFAULT_CALIB.get(key, 0.0))

    def set(self, key: str, value: float):
        if key in _DEFAULT_CALIB:
            self.values[key] = float(value)

    def to_dict(self) -> dict:
        return dict(self.values)


class DataSmoother:
    def __init__(self, alpha: float = 0.4):
        self.alpha = alpha
        self.smooth_x = 0.0
        self.smooth_y = 0.0
        self.smooth_z = 0.0
        self.initialized = False

    def update(self, x: float, y: float, z: float = 0.0) -> tuple[float, float, float]:
        if not self.initialized:
            self.smooth_x, self.smooth_y, self.smooth_z = x, y, z
            self.initialized = True
            return (x, y, z)

        self.smooth_x = self.alpha * x + (1 - self.alpha) * self.smooth_x
        self.smooth_y = self.alpha * y + (1 - self.alpha) * self.smooth_y
        self.smooth_z = self.alpha * z + (1 - self.alpha) * self.smooth_z
        return (self.smooth_x, self.smooth_y, self.smooth_z)

    def reset(self):
        self.initialized = False


class DeadZoneFilter:
    def __init__(self, threshold: float = 0.01):
        self.threshold = threshold
        self.last_x = 0.0
        self.last_y = 0.0
        self.initialized = False

    def filter(self, x: float, y: float) -> tuple[float, float]:
        if not self.initialized:
            self.last_x, self.last_y = x, y
            self.initialized = True
            return (x, y)

        dx = abs(x - self.last_x)
        dy = abs(y - self.last_y)
        if dx < self.threshold and dy < self.threshold:
            return (self.last_x, self.last_y)

        self.last_x, self.last_y = x, y
        return (x, y)

    def reset(self):
        self.initialized = False


class HandMotionTracker:
    def __init__(self, window_size: int = 10):
        self.window_size = window_size
        self.x_history: deque[float] = deque(maxlen=window_size)
        self.y_history: deque[float] = deque(maxlen=window_size)

    def update(self, x: float, y: float) -> dict:
        self.x_history.append(x)
        self.y_history.append(y)

        if len(self.x_history) < 3:
            return {"wave_score": 0.0, "motion_x": 0.0, "motion_y": 0.0}

        direction_changes = 0
        last_direction = 0
        for i in range(1, len(self.x_history)):
            dx = self.x_history[i] - self.x_history[i - 1]
            current_direction = 1 if dx > 0.005 else (-1 if dx < -0.005 else 0)
            if current_direction != 0 and last_direction != 0 and current_direction != last_direction:
                direction_changes += 1
            if current_direction != 0:
                last_direction = current_direction

        motion_x = max(self.x_history) - min(self.x_history) if len(self.x_history) >= 2 else 0.0
        motion_y = max(self.y_history) - min(self.y_history) if len(self.y_history) >= 2 else 0.0

        wave_score = direction_changes * motion_x

        return {
            "wave_score": round(wave_score, 4),
            "motion_x": round(motion_x, 4),
            "motion_y": round(motion_y, 4),
            "direction_changes": direction_changes,
        }

    def reset(self):
        self.x_history.clear()
        self.y_history.clear()


def estimate_palm_orientation(landmarks: list[dict]) -> float:
    if len(landmarks) < 21:
        return 0.5

    wrist_z = landmarks[0]["z"]
    fingertip_indices = [8, 12, 16, 20]
    fingertip_z_values = [landmarks[i]["z"] for i in fingertip_indices]

    avg_z_diff = sum(wrist_z - z for z in fingertip_z_values) / len(fingertip_z_values)

    orientation = 0.5 + avg_z_diff * 5
    return max(0.0, min(1.0, orientation))


def estimate_depth(bbox_w: float, bbox_h: float) -> float:
    area = bbox_w * bbox_h
    if area <= 0:
        return 0.5
    depth = 1.0 - min(area / 0.25, 1.0)
    return max(0.0, min(1.0, depth))


def fingertip_position(landmarks: list[dict]) -> tuple[float, float, float]:
    if len(landmarks) < 9:
        return (0.5, 0.5, 0.0)
    tip = landmarks[8]
    return (tip["x"], tip["y"], tip["z"])


def map_to_screen_coords(
    x_norm: float, y_norm: float,
    screen_w: int = 1920, screen_h: int = 1080,
    margin: float = 0.1,
) -> tuple[int, int]:
    x_range = 1.0 - 2 * margin
    y_range = 1.0 - 2 * margin
    px = int(((x_norm - margin) / x_range) * screen_w)
    py = int(((y_norm - margin) / y_range) * screen_h)
    px = max(0, min(screen_w, px))
    py = max(0, min(screen_h, py))
    return (px, py)


def _dist(a: dict, b: dict) -> float:
    dx = a["x"] - b["x"]
    dy = a["y"] - b["y"]
    dz = a.get("z", 0) - b.get("z", 0)
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def fingers_extended(landmarks: list[dict], calib: dict | None = None) -> list[bool]:
    if len(landmarks) < 21:
        return [False] * 5

    if calib is None:
        calib = _DEFAULT_CALIB

    ratio_thr = calib.get("finger_extended_threshold", 1.2)
    wrist = landmarks[0]

    def finger_ratio(tip_idx: int, mcp_idx: int) -> float:
        d_tip = _dist(landmarks[tip_idx], wrist)
        d_mcp = _dist(landmarks[mcp_idx], wrist)
        if d_mcp < 0.001:
            return 0.0
        return d_tip / d_mcp

    index_ext = finger_ratio(8, 5) > ratio_thr
    middle_ext = finger_ratio(12, 9) > ratio_thr
    ring_ext = finger_ratio(16, 13) > ratio_thr
    pinky_ext = finger_ratio(20, 17) > ratio_thr

    d_thumb_tip = _dist(landmarks[4], wrist)
    d_index_mcp = _dist(landmarks[5], wrist)
    thumb_ratio = d_thumb_tip / d_index_mcp if d_index_mcp > 0.001 else 0.0
    thumb_ext = thumb_ratio > (ratio_thr * 0.75)

    return [thumb_ext, index_ext, middle_ext, ring_ext, pinky_ext]


def pinch_distance(landmarks: list[dict]) -> float:
    if len(landmarks) < 9:
        return 0.0
    dx = landmarks[4]["x"] - landmarks[8]["x"]
    dy = landmarks[4]["y"] - landmarks[8]["y"]
    return math.sqrt(dx * dx + dy * dy)


def _segments_intersect(
    p1: dict, p2: dict, p3: dict, p4: dict
) -> bool:
    def cross(o: dict, a: dict, b: dict) -> float:
        return (a["x"] - o["x"]) * (b["y"] - o["y"]) - (a["y"] - o["y"]) * (b["x"] - o["x"])

    d1 = cross(p3, p4, p1)
    d2 = cross(p3, p4, p2)
    d3 = cross(p1, p2, p3)
    d4 = cross(p1, p2, p4)

    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True

    if abs(d1) < 1e-10 and _on_segment(p3, p4, p1): return True
    if abs(d2) < 1e-10 and _on_segment(p3, p4, p2): return True
    if abs(d3) < 1e-10 and _on_segment(p1, p2, p3): return True
    if abs(d4) < 1e-10 and _on_segment(p1, p2, p4): return True

    return False


def _on_segment(p: dict, q: dict, r: dict) -> bool:
    if (min(p["x"], q["x"]) <= r["x"] + 1e-10 <= max(p["x"], q["x"]) and
        min(p["y"], q["y"]) <= r["y"] + 1e-10 <= max(p["y"], q["y"])):
        return True
    return False


def classify_gesture(
    landmarks: list[dict],
    fingers: list[bool],
    pinch_dist: float,
    calib: dict | None = None,
    motion_data: dict | None = None,
    palm_orientation: float = 0.5,
) -> tuple[str, dict]:
    if calib is None:
        calib = _DEFAULT_CALIB

    debug = {
        "pinch_dist": round(pinch_dist, 4),
        "fingers": fingers,
    }

    if len(landmarks) < 21:
        return "None", debug

    thumb, index, middle, ring, pinky = fingers
    thumb_up_thr = calib.get("thumb_up_threshold", -0.05)
    pinch_close = calib.get("pinch_close", 0.15)
    pinch_open = calib.get("pinch_open", 0.08)

    thumb_seg_p1 = landmarks[4]
    thumb_seg_p2 = landmarks[2]
    index_seg_p1 = landmarks[8]
    index_seg_p2 = landmarks[5]

    fingers_crossed = _segments_intersect(
        thumb_seg_p1, thumb_seg_p2, index_seg_p1, index_seg_p2
    )
    debug["fingers_crossed"] = fingers_crossed

    palm_center = landmarks[9]
    hand_size = _dist(landmarks[0], landmarks[9])
    d_thumb_palm = _dist(landmarks[4], palm_center)
    thumb_palm_ratio = d_thumb_palm / hand_size if hand_size > 0.001 else 0.0
    debug["thumb_palm"] = round(thumb_palm_ratio, 4)

    if fingers_crossed and thumb and thumb_palm_ratio >= 0.65:
        return "Heart", debug

    z_diff = landmarks[0]["z"] - landmarks[9]["z"]
    debug["z_diff"] = round(z_diff, 4)

    if pinch_dist < pinch_close:
        palm_center = landmarks[9]
        hand_size = _dist(landmarks[0], landmarks[9])

        d_thumb_palm = _dist(landmarks[4], palm_center)
        thumb_palm_ratio = d_thumb_palm / hand_size if hand_size > 0.001 else 0.0
        debug["thumb_palm"] = round(thumb_palm_ratio, 4)

        if thumb_palm_ratio < 0.65:
            return "Closed_Fist", debug

        if middle and ring and pinky:
            return "OK", debug
        return "Pinch", debug

    if pinch_dist < pinch_open and not middle:
        palm_center = landmarks[9]
        d_thumb_palm = _dist(landmarks[4], palm_center)
        hand_size = _dist(landmarks[0], landmarks[9])
        thumb_palm_ratio = d_thumb_palm / hand_size if hand_size > 0.001 else 0.0
        debug["thumb_palm"] = round(thumb_palm_ratio, 4)
        if thumb_palm_ratio < 0.65:
            return "Closed_Fist", debug
        return "Pinch", debug

    if thumb and not index and not middle and not ring and not pinky:
        thumb_tip = landmarks[4]
        thumb_ip = landmarks[3]
        thumb_dy = thumb_tip["y"] - thumb_ip["y"]
        debug["thumb_dy"] = round(thumb_dy, 4)
        if thumb_dy < thumb_up_thr:
            return "Thumb_Up", debug
        else:
            return "Thumb_Down", debug

    if motion_data:
        debug["wave_score"] = motion_data.get("wave_score", 0.0)
        debug["palm_orientation"] = round(palm_orientation, 4)

        if (motion_data.get("direction_changes", 0) >= 2
                and motion_data.get("motion_x", 0.0) > 0.1
                and thumb and index and middle):
            return "Wave", debug

    if thumb and index and middle and ring and pinky:
        return "Open_Palm", debug

    if index and middle and not ring and not pinky:
        return "Victory", debug

    if index and not middle and not ring and not pinky:
        return "Pointing_Up", debug

    if middle and not index and not ring and not pinky:
        return "Pointing_Up", debug

    if thumb and pinky and not index and not middle and not ring:
        return "Call_Me", debug

    if index and pinky and not middle and not ring:
        return "Rock", debug

    if not index and not middle and not ring and not pinky:
        return "Closed_Fist", debug

    return "None", debug
