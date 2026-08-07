"""Perception 感知服务入口

启动摄像头 → 实时手部检测 + 面部追踪 → WebSocket 推送到前端
"""

import asyncio
import json
import math
import time
import cv2
import websockets
from websockets.asyncio.server import ServerConnection

from .hand_tracker import HandTracker
from .face_tracker import FaceTracker
from .data_processor import (
    DataSmoother, DeadZoneFilter, HandMotionTracker, estimate_depth,
    estimate_palm_orientation, fingertip_position, fingers_extended,
    pinch_distance, classify_gesture, CalibConfig,
)
from .gesture_learner import GestureLearner, extract_features
from .config import (
    WS_HOST, WS_PORT, CAMERA_ID,
    FRAME_WIDTH, FRAME_HEIGHT, MAX_FPS,
    SMOOTH_ALPHA, DEAD_ZONE_THRESHOLD,
    SCREEN_WIDTH, SCREEN_HEIGHT,
    GESTURE_MAPPING_PATH,
    MAX_HANDS,
    MIN_DETECTION_CONFIDENCE,
    MIN_TRACKING_CONFIDENCE,
)


class PerceptionServer:
    """感知服务 WebSocket 服务器"""

    def __init__(self):
        self.tracker = HandTracker(camera_id=CAMERA_ID, max_num_hands=MAX_HANDS)
        self.face_tracker = FaceTracker()
        self.clients: set[ServerConnection] = set()
        self.running = False
        self.smoothers: dict[str, DataSmoother] = {}
        self.motion_trackers: dict[str, HandMotionTracker] = {}
        self._last_face_data: dict = {"detected": False}
        self._face_frame_counter: int = 0
        self.calib = CalibConfig()
        print(f"[+] 校准参数加载: {self.calib.to_dict()}")

        self._gesture_locks: dict[str, dict] = {}
        self._gesture_lock_duration = 1.0

        self._gesture_stability: dict[str, dict] = {}
        self._gesture_stability_frames = 3

        self.gesture_learner = GestureLearner()
        self._last_hand_landmarks: list[dict] | None = None

        self.gesture_mapping = self._load_gesture_mapping()

    def _get_motion_tracker(self, hand_key: str) -> HandMotionTracker:
        if hand_key not in self.motion_trackers:
            self.motion_trackers[hand_key] = HandMotionTracker()
        return self.motion_trackers[hand_key]

    def _get_smoother(self, hand_key: str) -> DataSmoother:
        if hand_key not in self.smoothers:
            self.smoothers[hand_key] = DataSmoother(alpha=SMOOTH_ALPHA)
        return self.smoothers[hand_key]

    _DEFAULT_GESTURE_MAPPING = [
        {"gesture": "Heart", "expression": "Shy", "expressionFadeIn": 0.3, "expressionDuration": 3.0, "motion": None, "priority": 100, "gazeTarget": "user", "bodyAngle": 0},
        {"gesture": "Thumb_Up", "expression": "Happy1", "expressionFadeIn": 0.3, "expressionDuration": 2.0, "motion": None, "priority": 80, "gazeTarget": "user"},
        {"gesture": "Victory", "expression": "Happy1", "expressionFadeIn": 0.3, "expressionDuration": 1.5, "motion": None, "priority": 80, "gazeTarget": "user"},
        {"gesture": "Open_Palm", "expression": None, "expressionDuration": 0, "motion": "Wave", "motionPriority": 2, "priority": 60, "gazeTarget": "hand"},
        {"gesture": "Wave", "expression": "Happy1", "expressionFadeIn": 0.3, "expressionDuration": 1.0, "motion": "Wave", "motionPriority": 3, "priority": 70, "gazeTarget": "user"},
        {"gesture": "OK", "expression": "Happy1", "expressionFadeIn": 0.2, "expressionDuration": 1.0, "motion": "Nod", "motionPriority": 2, "priority": 60, "gazeTarget": "user"},
        {"gesture": "Pointing_Up", "expression": "StarEye", "expressionFadeIn": 0.3, "expressionDuration": 1.5, "motion": None, "priority": 60, "gazeTarget": "hand", "bodyAngle": -5},
        {"gesture": "Closed_Fist", "expression": "Angry", "expressionFadeIn": 0.3, "expressionDuration": 1.5, "motion": None, "priority": 50},
        {"gesture": "Pinch", "expression": "Halfeyes", "expressionFadeIn": 0.5, "expressionDuration": 2.0, "motion": None, "priority": 70, "gazeTarget": "hand", "bodyAngle": 5},
        {"gesture": "Stop", "expression": "Halfeyes", "expressionFadeIn": 0.5, "expressionDuration": 1.0, "motion": None, "priority": 60},
        {"gesture": "Call_Me", "expression": "Shy", "expressionFadeIn": 0.3, "expressionDuration": 2.0, "motion": "Wave", "motionPriority": 2, "priority": 60, "gazeTarget": "user"},
        {"gesture": "Rock", "expression": "Happy1", "expressionFadeIn": 0.3, "expressionDuration": 1.5, "motion": None, "priority": 60},
    ]

    def _load_gesture_mapping(self) -> list[dict]:
        import os
        if os.path.exists(GESTURE_MAPPING_PATH):
            try:
                with open(GESTURE_MAPPING_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, list):
                    print(f"[+] 手势映射表已加载: {len(data)} 条")
                    return data
            except Exception as e:
                print(f"[!] 加载手势映射表失败: {e}")
        self._save_gesture_mapping(self._DEFAULT_GESTURE_MAPPING)
        print(f"[+] 手势映射表已初始化默认值: {len(self._DEFAULT_GESTURE_MAPPING)} 条")
        return list(self._DEFAULT_GESTURE_MAPPING)

    def _save_gesture_mapping(self, mapping: list[dict]):
        try:
            with open(GESTURE_MAPPING_PATH, "w", encoding="utf-8") as f:
                json.dump(mapping, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[!] 保存手势映射表失败: {e}")

    def _process_hands(self, hands_data: list[dict]) -> list[dict]:
        now = time.time()
        processed = []
        hand_features = []

        for i, hand in enumerate(hands_data):
            hand_key = f"hand_{i}"
            smoother = self._get_smoother(hand_key)
            motion_tracker = self._get_motion_tracker(hand_key)

            landmarks = hand.get("landmarks", [])
            if not landmarks:
                self._gesture_locks.pop(hand_key, None)
                self._gesture_stability.pop(hand_key, None)
                continue

            if i == 0:
                self._last_hand_landmarks = landmarks

            fx, fy, fz = fingertip_position(landmarks)
            sx, sy, sz = smoother.update(fx, fy, fz)

            bbox = hand.get("bbox", {"w": 0.1, "h": 0.15})
            depth = estimate_depth(bbox["w"], bbox["h"])

            fingers = fingers_extended(landmarks, self.calib.values)
            pinch_dist = pinch_distance(landmarks)

            motion_data = motion_tracker.update(sx, sy)

            palm_orientation = estimate_palm_orientation(landmarks)

            gesture, gesture_debug = classify_gesture(
                landmarks, fingers, pinch_dist, self.calib.values,
                motion_data=motion_data, palm_orientation=palm_orientation,
            )

            hand_features.append({
                "hand_key": hand_key,
                "fingers": fingers,
                "palm_orientation": palm_orientation,
                "landmarks": landmarks,
            })

            lock = self._gesture_locks.get(hand_key)
            if lock and now < lock["until"]:
                gesture = lock["gesture"]
                gesture_debug["locked"] = True
            elif gesture in ("Wave", "Stop"):
                self._gesture_locks[hand_key] = {
                    "gesture": gesture,
                    "until": now + self._gesture_lock_duration,
                }
                gesture_debug["locked"] = True
            else:
                self._gesture_locks.pop(hand_key, None)

            is_locked = gesture_debug.get("locked", False)
            if not is_locked:
                stab = self._gesture_stability.setdefault(
                    hand_key, {"stable": "None", "candidate": "None", "count": 0}
                )
                if gesture == stab["candidate"]:
                    stab["count"] += 1
                else:
                    stab["candidate"] = gesture
                    stab["count"] = 1

                if stab["count"] >= self._gesture_stability_frames:
                    stab["stable"] = gesture
                gesture = stab["stable"]
                gesture_debug["stab_frames"] = stab["count"]
            else:
                self._gesture_stability[hand_key] = {
                    "stable": gesture, "candidate": gesture, "count": self._gesture_stability_frames
                }

            features = extract_features(landmarks)
            if features:
                learned_gesture, confidence = self.gesture_learner.classify(
                    features, rule_based_gesture=gesture
                )
                gesture_debug["learned"] = learned_gesture
                gesture_debug["learned_conf"] = confidence
                if confidence >= 0.55 and learned_gesture != gesture:
                    gesture = learned_gesture
                    gesture_debug["learned_override"] = True

            processed.append({
                "handedness": hand.get("handedness", "Unknown"),
                "fingertip": {"x": sx, "y": sy, "z": sz},
                "center": hand.get("center"),
                "bbox": hand.get("bbox"),
                "depth_estimate": depth,
                "fingers_extended": fingers,
                "pinch_distance": pinch_dist,
                "landmarks": landmarks,
                "gesture": gesture,
                "gesture_debug": gesture_debug,
            })

        if len(hand_features) >= 2:
            for a, b in [(0, 1), (1, 0)]:
                hf_wall = hand_features[a]
                hf_push = hand_features[b]

                wall_fingers = hf_wall["fingers"]
                push_fingers = hf_push["fingers"]

                wall_ok = sum(wall_fingers) >= 3
                push_ok = (push_fingers[1]
                           and not push_fingers[2]
                           and not push_fingers[3]
                           and not push_fingers[4])

                if wall_ok and push_ok:
                    push_landmarks = hf_push["landmarks"]
                    wall_landmarks = hf_wall["landmarks"]
                    if len(push_landmarks) >= 9 and len(wall_landmarks) >= 10:
                        idx_tip = push_landmarks[8]
                        wall_palm = wall_landmarks[9]
                        dist = math.sqrt(
                            (idx_tip["x"] - wall_palm["x"]) ** 2 +
                            (idx_tip["y"] - wall_palm["y"]) ** 2
                        )
                        if dist < 0.15:
                            for j, hf in enumerate(hand_features):
                                if j < len(processed):
                                    processed[j]["gesture"] = "Stop"
                                    processed[j]["gesture_debug"]["two_hand_stop"] = True
                                    processed[j]["gesture_debug"]["locked"] = True
                                    processed[j]["gesture_debug"]["finger_palm_dist"] = round(dist, 4)
                            for hf in hand_features:
                                self._gesture_locks[hf["hand_key"]] = {
                                    "gesture": "Stop",
                                    "until": now + self._gesture_lock_duration,
                                }
                            break

        return processed

    def _process_face(self, frame) -> dict:
        self._face_frame_counter += 1
        if self._face_frame_counter % 2 != 0:
            return self._last_face_data

        result = self.face_tracker.process_frame(frame, self.calib.values)
        self._last_face_data = result
        return result

    async def handler(self, websocket: ServerConnection):
        self.clients.add(websocket)
        print(f"[+] 客户端连接, 当前: {len(self.clients)}")
        try:
            calib_msg = json.dumps({"type": "calib_data", "calib": self.calib.to_dict()})
            await websocket.send(calib_msg)

            sample_counts = self.gesture_learner.get_sample_counts()
            await websocket.send(json.dumps({
                "type": "gesture_samples_data",
                "counts": sample_counts,
            }))

            await websocket.send(json.dumps({
                "type": "gesture_mapping_data",
                "mapping": self.gesture_mapping,
            }))

            async for message in websocket:
                try:
                    if isinstance(message, bytes):
                        continue

                    cmd = json.loads(message)
                    if cmd.get("type") == "command":
                        print(f"[cmd] {cmd}")

                    elif cmd.get("type") == "calibrate":
                        key = cmd.get("key")
                        value = cmd.get("value")
                        if key and value is not None:
                            self.calib.set(key, float(value))
                            print(f"[calib] {key} = {value}")
                            calib_msg = json.dumps({
                                "type": "calib_data",
                                "calib": self.calib.to_dict(),
                            })
                            await asyncio.gather(
                                *[c.send(calib_msg) for c in self.clients],
                                return_exceptions=True,
                            )

                    elif cmd.get("type") == "save_calib":
                        self.calib.save()
                        print(f"[calib] 已保存到 {self.calib.path}")

                    elif cmd.get("type") == "record_gesture":
                        gesture_name = cmd.get("gesture", "").strip()
                        if gesture_name and self._last_hand_landmarks:
                            features = extract_features(self._last_hand_landmarks)
                            if features:
                                self.gesture_learner.add_sample(gesture_name, features)
                                counts = self.gesture_learner.get_sample_counts()
                                await websocket.send(json.dumps({
                                    "type": "gesture_samples_updated",
                                    "counts": counts,
                                }))
                                print(f"[gesture] 录制样本: {gesture_name} (当前 {counts.get(gesture_name, 0)} 个)")
                            else:
                                await websocket.send(json.dumps({
                                    "type": "gesture_record_error",
                                    "message": "特征提取失败，请确保手部完整可见",
                                }))
                        else:
                            await websocket.send(json.dumps({
                                "type": "gesture_record_error",
                                "message": "未检测到手部或手势名称为空",
                            }))

                    elif cmd.get("type") == "get_gesture_samples":
                        counts = self.gesture_learner.get_sample_counts()
                        await websocket.send(json.dumps({
                            "type": "gesture_samples_data",
                            "counts": counts,
                        }))

                    elif cmd.get("type") == "clear_gesture_samples":
                        gesture_name = cmd.get("gesture", "")
                        if gesture_name:
                            self.gesture_learner.remove_gesture_samples(gesture_name)
                        else:
                            self.gesture_learner.clear_all()
                        counts = self.gesture_learner.get_sample_counts()
                        await websocket.send(json.dumps({
                            "type": "gesture_samples_updated",
                            "counts": counts,
                        }))
                        print(f"[gesture] 清除样本: {gesture_name or '全部'}")

                    elif cmd.get("type") == "reset_face_baseline":
                        self.face_tracker.reset_baseline()
                        print("[face] 基线已重置，将重新采集中性表情")

                    elif cmd.get("type") == "get_gesture_mapping":
                        await websocket.send(json.dumps({
                            "type": "gesture_mapping_data",
                            "mapping": self.gesture_mapping,
                        }))

                    elif cmd.get("type") == "save_gesture_mapping":
                        new_mapping = cmd.get("mapping", [])
                        if isinstance(new_mapping, list):
                            self.gesture_mapping = new_mapping
                            self._save_gesture_mapping(new_mapping)
                            await websocket.send(json.dumps({
                                "type": "gesture_mapping_saved",
                                "count": len(new_mapping),
                            }))
                            print(f"[gesture_mapping] 已保存 {len(new_mapping)} 条映射")
                        else:
                            await websocket.send(json.dumps({
                                "type": "gesture_mapping_error",
                                "message": "映射表格式无效",
                            }))

                except json.JSONDecodeError:
                    pass
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            print(f"[-] 客户端断开, 当前: {len(self.clients)}")

    async def _broadcast(self, message: str):
        if self.clients:
            await asyncio.gather(
                *[client.send(message) for client in self.clients],
                return_exceptions=True,
            )

    def _capture_and_process(self, cap, frame) -> tuple[bool, any, list[dict], dict]:
        ret, frame = cap.read()
        if not ret:
            return False, None, [], {"detected": False}

        frame = cv2.resize(frame, (FRAME_WIDTH, FRAME_HEIGHT))

        hands_data = self.tracker.process_frame(frame)
        processed = self._process_hands(hands_data)

        face_data = self._process_face(frame)

        return True, frame, processed, face_data

    async def camera_loop(self):
        if not self.tracker.start():
            print("无法启动摄像头")
            return

        cap = self.tracker.cap
        frame_time = 1.0 / MAX_FPS

        while self.running:
            start_time = time.time()

            ret, frame, processed, face_data = await asyncio.to_thread(
                self._capture_and_process, cap, None
            )

            if not ret:
                await asyncio.sleep(0.01)
                continue

            if self.clients and processed:
                hand_payload = {
                    "type": "hand_data",
                    "timestamp": time.time(),
                    "hands": processed,
                }
                msg = json.dumps(hand_payload)
                await asyncio.gather(
                    *[client.send(msg) for client in self.clients],
                    return_exceptions=True,
                )

            if self.clients and face_data.get("detected"):
                face_payload = {
                    "type": "face_data",
                    "timestamp": time.time(),
                    "face": face_data,
                }
                face_msg = json.dumps(face_payload)
                await asyncio.gather(
                    *[client.send(face_msg) for client in self.clients],
                    return_exceptions=True,
                )

            elapsed = time.time() - start_time
            sleep_time = frame_time - elapsed
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)

        self.tracker.release()
        self.face_tracker.close()

    async def start(self):
        self.running = True

        try:
            self.face_tracker.start()
            print("[+] FaceTracker 初始化成功")
        except Exception as e:
            print(f"[!] FaceTracker 初始化失败: {e}")

        print(f"Perception WebSocket 服务器启动: ws://{WS_HOST}:{WS_PORT}")

        async with websockets.serve(
            self.handler, WS_HOST, WS_PORT,
            open_timeout=10,
        ):
            await self.camera_loop()

    def stop(self):
        self.running = False
        self.face_tracker.close()


def main():
    server = PerceptionServer()
    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        print("\n正在停止服务器...")
        server.stop()


if __name__ == "__main__":
    main()
