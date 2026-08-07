"""Perception 模块配置"""
import os

_SERVER_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(_SERVER_ROOT, "models", "perception")
os.makedirs(MODELS_DIR, exist_ok=True)

HAND_LANDMARKER_MODEL = os.path.join(MODELS_DIR, "hand_landmarker.task")
FACE_LANDMARKER_MODEL = os.path.join(MODELS_DIR, "face_landmarker.task")

CALIBRATION_PATH = os.path.join(MODELS_DIR, "calibration.json")
USER_CONFIG_PATH = os.path.join(MODELS_DIR, "user_config.json")
GESTURE_MAPPING_PATH = os.path.join(MODELS_DIR, "gesture_mapping.json")
GESTURE_SAMPLES_PATH = os.path.join(MODELS_DIR, "gesture_samples.json")

WS_HOST = "127.0.0.1"
WS_PORT = 8765

CAMERA_ID = 0
FRAME_WIDTH = 640
FRAME_HEIGHT = 480
MAX_FPS = 30

MAX_HANDS = 2
MIN_DETECTION_CONFIDENCE = 0.5
MIN_TRACKING_CONFIDENCE = 0.5

SMOOTH_ALPHA = 0.4
DEAD_ZONE_THRESHOLD = 0.005

SCREEN_WIDTH = 1920
SCREEN_HEIGHT = 1080

FACE_DETECTION_RESOLUTION = 0.5
ENABLE_GPU_ACCELERATION = False
