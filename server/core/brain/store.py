"""
core.brain.store — 兼容层，已迁入 hermes_core.memory.store

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.brain.store import ..."
"""
try:
    from server.hermes_core.memory.store import MemoryStore, get_db_path, init_tables
except ImportError:
    from hermes_core.memory.store import MemoryStore, get_db_path, init_tables

__all__ = [
    "MemoryStore",
    "get_db_path",
    "init_tables",
]
