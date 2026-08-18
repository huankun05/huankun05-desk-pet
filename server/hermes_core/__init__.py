"""
hermes_core — Hermes 核心引擎 + desk-pet 桌面伴侣能力

Hermes 原版模块：
  - hermes_state.py              SessionDB（state.db 读写）
  - hermes_state_schema.py       数据库 Schema 管理
  - hermes_state_search.py       FTS5 全文检索
  - hermes_state_common.py       共享类型/常量/SQL
  - hermes_state_portability.py  导入导出/备份
  - hermes_constants.py          路径解析/平台常量
  - hermes_bootstrap.py          启动流程
  - hermes_logging.py            异步日志系统
  - stubs.py                     memory_manager/skill_commands 最小桩

desk-pet 新增模块：
  - emotion/                     情绪/表情/激素系统
  - soul/                        人格/漂移
  - time/                        昼夜/纪念日
  - memory/                      记忆碎片系统
  - voice_services.py            语音服务启动器
"""

from hermes_core.hermes_state import SessionDB  # noqa: F401
from hermes_core.hermes_state_common import (  # noqa: F401
    SCHEMA_VERSION,
    FTS_SQL,
    DEFERRED_INDEX_SQL,
    _FTS_TRIGGERS,
    _FTS_CJK_TRIGGERS,
)
from hermes_core.hermes_constants import (  # noqa: F401
    get_hermes_home,
    get_hermes_dir,
)
from hermes_core import sqlite_safe_read  # noqa: F401
from hermes_core.stubs import (  # noqa: F401
    sanitize_context,
    describe_skill_invocation,
    SKILL_EXCERPT_JOINT,
    SKILL_SCAFFOLD_SQL_LIKE,
    _SKILL_INVOCATION_PREFIX,
)

# desk-pet 新增：情绪系统
from hermes_core.emotion.emotion import EmotionState  # noqa: F401
from hermes_core.emotion.expression import ExpressionEngine  # noqa: F401
from hermes_core.emotion.hormones import HormonalSystem, HormonalEngine  # noqa: F401

# desk-pet 新增：人格系统
from hermes_core.soul.personality import HEXACOPersonality  # noqa: F401
from hermes_core.soul.drift import PersonalityDrifter  # noqa: F401
from hermes_core.soul.soul_file import SoulFile  # noqa: F401

# desk-pet 新增：时间感知
from hermes_core.time.circadian import CircadianRhythm  # noqa: F401
from hermes_core.time.anniversaries import AnniversaryManager  # noqa: F401
from hermes_core.time.reunion import ReunionEngine  # noqa: F401

# desk-pet 新增：记忆碎片
from hermes_core.memory.store import MemoryStore  # noqa: F401
from hermes_core.memory.fragment import MemoryFragment, CATEGORY_FACT, SOURCE_CHAT  # noqa: F401
from hermes_core.memory.librarian import Librarian  # noqa: F401
from hermes_core.memory.scribe import Scribe, ExtractionConfig  # noqa: F401
from hermes_core.memory.memory_service import get_memory_service  # noqa: F401

# desk-pet 新增：语音服务
from hermes_core.voice_services import (  # noqa: F401
    ensure_voice_services,
    stop_voice_services,
)

__all__ = [
    # Hermes 原版
    "SessionDB",
    "SCHEMA_VERSION",
    "FTS_SQL",
    "DEFERRED_INDEX_SQL",
    "get_hermes_home",
    "get_hermes_dir",
    "sanitize_context",
    "SKILL_EXCERPT_JOINT",
    "SKILL_SCAFFOLD_SQL_LIKE",
    # 情绪系统
    "EmotionState",
    "ExpressionEngine",
    "HormonalSystem",
    "HormonalEngine",
    # 人格系统
    "HEXACOPersonality",
    "PersonalityDrifter",
    "SoulFile",
    # 时间感知
    "CircadianRhythm",
    "AnniversaryManager",
    "ReunionEngine",
    # 记忆碎片
    "MemoryStore",
    "MemoryFragment",
    "CATEGORY_FACT",
    "SOURCE_CHAT",
    "Librarian",
    "Scribe",
    "ExtractionConfig",
    "get_memory_service",
    # 语音服务
    "ensure_voice_services",
    "stop_voice_services",
]
