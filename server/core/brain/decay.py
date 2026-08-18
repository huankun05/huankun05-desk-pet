"""core.brain.decay — 兼容层，已迁入 hermes_core.memory.decay"""
from hermes_core.memory.decay import apply_decay, THRESHOLD_TOMBSTONE

__all__ = [
    "apply_decay",
    "THRESHOLD_TOMBSTONE",
]
