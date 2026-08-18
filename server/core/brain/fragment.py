"""
core.brain.fragment — 兼容层，已迁入 hermes_core.memory.fragment

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.brain.fragment import ..."
"""
try:
    from server.hermes_core.memory.fragment import (
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
except ImportError:
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
