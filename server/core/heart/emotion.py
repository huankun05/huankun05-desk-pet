"""
core.heart.emotion — 兼容层，已迁入 hermes_core.emotion.emotion

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.heart.emotion import ..."
"""
try:
    from server.hermes_core.emotion.emotion import (
        PADValues,
        EmotionState,
        EMOTION_KEYWORDS,
        _event_to_pad,
    )
except ImportError:
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
