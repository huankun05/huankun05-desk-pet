"""人格系统（Soul）。

模块结构:
- personality.py — HEXACO 六维人格模型
- soul_file.py — .soul 角色配置文件
- drift.py — 人格动态漂移
"""

from .personality import HEXACOPersonality, HEXACO_DIMENSIONS
from .soul_file import SoulFile
from .drift import PersonalityDrifter, MAX_DRIFT_DELTA

__all__ = [
    "HEXACOPersonality",
    "HEXACO_DIMENSIONS",
    "SoulFile",
    "PersonalityDrifter",
    "MAX_DRIFT_DELTA",
]
