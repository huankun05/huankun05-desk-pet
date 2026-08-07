"""
hermes_core.stubs — 最小化 Hermes 内部依赖桩

只提供 hermes_state.py 实际 import 的 3 个接口：
  1. sanitize_context()          — 文本清洗
  2. SKILL_EXCERPT_JOINT         — 技能分隔符常量
  3. SKILL_SCAFFOLD_SQL_LIKE     — 技能 SQL 模式

不需要整个 memory_manager.py / skill_commands.py / tools.*
"""

import re

# ============================================================
# 1. sanitize_context (来自 agent/memory_manager.py)
# ============================================================

_INTERNAL_CONTEXT_RE = re.compile(
    r'<\s*memory-context\s*>[\s\S]*?</\s*memory-context\s*>', re.IGNORECASE
)
_INTERNAL_NOTE_RE = re.compile(
    r'\[System note:\s*The following is recalled',
    re.IGNORECASE,
)
_FENCE_TAG_RE = re.compile(r'</?\s*memory-context\s*>', re.IGNORECASE)


def sanitize_context(text: str) -> str:
    """Strip fence tags, injected context blocks, and system notes from provider output."""
    text = _INTERNAL_CONTEXT_RE.sub('', text)
    text = _INTERNAL_NOTE_RE.sub('', text)
    text = _FENCE_TAG_RE.sub('', text)
    return text.strip()


# ============================================================
# 2. 技能常量 (来自 agent/skill_commands.py)
# ============================================================

SKILL_EXCERPT_JOINT = "\x1e"
_SKILL_INVOCATION_PREFIX = "[IMPORTANT: The user has invoked the "
SKILL_SCAFFOLD_SQL_LIKE = _SKILL_INVOCATION_PREFIX + "%"


def describe_skill_invocation(content, separator: str = " — ") -> str | None:
    """Render a slash-skill-expanded turn the way the user typed it.

    Minimal stub for hermes_state import compatibility.
    Full implementation lives in agent/skill_commands.py (not needed for state.db).
    """
    if isinstance(content, str) and content.startswith("/"):
        return content[:80]
    return None
