"""情感系统（Heart）。

三层架构：
L1: 激素系统（HormonalSystem — dopamine/cortisol/oxytocin）
L2: 情绪状态（EmotionState — PAD三维）
L3: 表达策略（ExpressionStrategy — 情绪→语言风格）
"""

from .emotion import PADValues, EmotionState, EMOTION_KEYWORDS
from .hormones import HormonalSystem, HormonalEngine, HORMONE_CONFIG

__all__ = [
    "PADValues",
    "EmotionState",
    "EMOTION_KEYWORDS",
    "HormonalSystem",
    "HormonalEngine",
    "HORMONE_CONFIG",
]
