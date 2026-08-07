"""
hermes_core — Hermes 核心引擎移植到 desk-pet（裁剪版）

移植范围：
  - hermes_state.py              SessionDB（state.db 读写，约 8500 行）
  - hermes_state_schema.py       数据库 Schema 管理
  - hermes_state_search.py       FTS5 全文检索
  - hermes_state_common.py       共享类型/常量/SQL
  - hermes_state_portability.py  导入导出/备份
  - hermes_constants.py          路径解析/平台常量
  - hermes_bootstrap.py          启动流程
  - hermes_logging.py            异步日志系统
  - stubs.py                     memory_manager/skill_commands 最小桩

去掉：CLI/多平台/代理/OAuth/UI-tui/tools/agent 引擎（desk-pet 已有对应模块）
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

__all__ = [
    "SessionDB",
    "SCHEMA_VERSION",
    "FTS_SQL",
    "DEFERRED_INDEX_SQL",
    "get_hermes_home",
    "get_hermes_dir",
    "sanitize_context",
    "SKILL_EXCERPT_JOINT",
    "SKILL_SCAFFOLD_SQL_LIKE",
]
