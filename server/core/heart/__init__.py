"""core.heart — 兼容层，已迁入 hermes_core.emotion"""
from hermes_core.emotion.emotion import EmotionState, PADValues
from hermes_core.emotion.expression import ExpressionEngine
from hermes_core.emotion.hormones import HormonalSystem, HormonalEngine

__all__ = [
    "PADValues",
    "EmotionState",
    "ExpressionEngine",
    "HormonalSystem",
    "HormonalEngine",
]
