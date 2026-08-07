"""核心引擎（Core）。

四大系统:
- Brain — 记忆系统
- Heart — 情感系统
- Soul — 人格系统
- Time — 时间系统
"""

from . import brain
from . import heart
from . import soul
from . import time

__all__ = ["brain", "heart", "soul", "time"]
