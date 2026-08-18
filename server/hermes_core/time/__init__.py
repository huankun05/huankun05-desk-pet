"""时间系统（Time）。

模块结构:
- circadian.py — 昼夜节律
- reunion.py — 重逢机制
"""

from .circadian import CircadianRhythm
from .reunion import ReunionEngine, ReunionResult

__all__ = [
    "CircadianRhythm",
    "ReunionEngine",
    "ReunionResult",
]
