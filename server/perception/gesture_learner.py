"""手势学习分类器

基于模板匹配 + KNN 的手势识别。
用户录制手势样本 → 存储为归一化特征向量 → KNN 分类。
规则分类器作为兜底（置信度低或样本不足时回退）。
"""

import json
import math
from pathlib import Path
from .config import GESTURE_SAMPLES_PATH

K_NEIGHBORS = 5
CONFIDENCE_THRESHOLD = 0.55
MIN_SAMPLES_PER_GESTURE = 3

NUM_LANDMARKS = 21


def _dist(a: dict, b: dict) -> float:
    dx = a["x"] - b["x"]
    dy = a["y"] - b["y"]
    return math.sqrt(dx * dx + dy * dy)


def extract_features(landmarks: list[dict]) -> list[float] | None:
    if len(landmarks) < NUM_LANDMARKS:
        return None

    wrist = landmarks[0]
    middle_mcp = landmarks[9]

    scale = _dist(wrist, middle_mcp)
    if scale < 0.001:
        return None

    features = []
    for lm in landmarks[:NUM_LANDMARKS]:
        nx = (lm["x"] - wrist["x"]) / scale
        ny = (lm["y"] - wrist["y"]) / scale
        features.append(nx)
        features.append(ny)

    return features


def _euclidean_distance(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return float("inf")
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


class GestureLearner:
    def __init__(self, samples_path: str = GESTURE_SAMPLES_PATH):
        self.samples_path = Path(samples_path)
        self.samples: dict[str, list[list[float]]] = {}
        self.load()

    def load(self):
        if self.samples_path.exists():
            try:
                with open(self.samples_path, "r", encoding="utf-8") as f:
                    self.samples = json.load(f)
                total = sum(len(v) for v in self.samples.values())
                print(f"[+] 手势样本库已加载: {len(self.samples)} 种手势, {total} 个样本")
            except (json.JSONDecodeError, Exception) as e:
                print(f"[!] 手势样本库加载失败: {e}")
                self.samples = {}
        else:
            self.samples = {}

    def save(self):
        with open(self.samples_path, "w", encoding="utf-8") as f:
            json.dump(self.samples, f, ensure_ascii=False, indent=2)
        total = sum(len(v) for v in self.samples.values())
        print(f"[+] 手势样本库已保存: {len(self.samples)} 种手势, {total} 个样本")

    def add_sample(self, gesture_name: str, features: list[float]):
        if gesture_name not in self.samples:
            self.samples[gesture_name] = []
        self.samples[gesture_name].append(features)
        self.save()

    def remove_gesture_samples(self, gesture_name: str):
        if gesture_name in self.samples:
            del self.samples[gesture_name]
            self.save()

    def clear_all(self):
        self.samples = {}
        self.save()

    def get_sample_counts(self) -> dict[str, int]:
        return {name: len(samples) for name, samples in self.samples.items()}

    def classify(
        self,
        features: list[float],
        rule_based_gesture: str,
    ) -> tuple[str, float]:
        if not features or not self.samples:
            return rule_based_gesture, 0.0

        all_distances: list[tuple[float, str]] = []
        for gesture_name, gesture_samples in self.samples.items():
            if len(gesture_samples) < MIN_SAMPLES_PER_GESTURE:
                continue
            for sample in gesture_samples:
                dist = _euclidean_distance(features, sample)
                all_distances.append((dist, gesture_name))

        if not all_distances:
            return rule_based_gesture, 0.0

        all_distances.sort(key=lambda x: x[0])
        k = min(K_NEIGHBORS, len(all_distances))
        nearest = all_distances[:k]

        vote_counts: dict[str, int] = {}
        total_dist = 0.0
        for dist, gesture in nearest:
            vote_counts[gesture] = vote_counts.get(gesture, 0) + 1
            total_dist += dist

        best_gesture = max(vote_counts, key=vote_counts.get)
        best_votes = vote_counts[best_gesture]

        avg_dist = total_dist / k
        distance_factor = max(0.0, 1.0 - avg_dist * 2)
        confidence = (best_votes / k) * distance_factor

        if confidence >= CONFIDENCE_THRESHOLD:
            return best_gesture, round(confidence, 3)
        else:
            return rule_based_gesture, round(confidence, 3)
