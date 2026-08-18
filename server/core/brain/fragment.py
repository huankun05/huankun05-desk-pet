"""core.brain.fragment — 兼容层，已迁入 hermes_core.memory.fragment"""
from hermes_core.memory.fragment import (
    MemoryFragment,
    CATEGORY_FACT,
    CATEGORY_PREFERENCE,
    CATEGORY_RULE,
    CATEGORY_FEEDBACK,
    CATEGORY_EVENT,
    SOURCE_CHAT,
    SOURCE_UI,
    SOURCE_MIGRATION,
    VALID_CATEGORIES,
)

__all__ = [
    "MemoryFragment",
    "CATEGORY_FACT",
    "CATEGORY_PREFERENCE",
    "CATEGORY_RULE",
    "CATEGORY_FEEDBACK",
    "CATEGORY_EVENT",
    "SOURCE_CHAT",
    "SOURCE_UI",
    "SOURCE_MIGRATION",
    "VALID_CATEGORIES",
]
