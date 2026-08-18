"""core.heart.emotion — 兼容层，已迁入 hermes_core.emotion.emotion"""
from hermes_core.emotion.emotion import (
    PADValues,
    EmotionState,
    EMOTION_KEYWORDS,
    _event_to_pad,
)

__all__ = [
    "PADValues",
    "EmotionState",
    "EMOTION_KEYWORDS",
    "_event_to_pad",
]
