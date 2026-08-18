"""core.soul — 兼容层，已迁入 hermes_core.soul"""
from hermes_core.soul.personality import HEXACOPersonality
from hermes_core.soul.drift import PersonalityDrifter
from hermes_core.soul.soul_file import SoulFile

__all__ = [
    "HEXACOPersonality",
    "PersonalityDrifter",
    "SoulFile",
]
