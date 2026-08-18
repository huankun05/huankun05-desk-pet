"""
core — 向后兼容层

所有功能已迁入 hermes_core/，此包仅用于重定向旧 import 路径。
新代码请直接使用 from hermes_core import ...
"""
from hermes_core import *  # noqa: F401,F403
from hermes_core import (
    SessionDB,
    EmotionState,
    ExpressionEngine,
    HormonalSystem,
    HormonalEngine,
    HEXACOPersonality,
    PersonalityDrifter,
    CircadianRhythm,
    AnniversaryManager,
    ReunionEngine,
    MemoryStore,
    MemoryFragment,
    Librarian,
    Scribe,
    ExtractionConfig,
    get_memory_service,
    ensure_voice_services,
    stop_voice_services,
)
