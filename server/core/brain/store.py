"""core.brain.store — 兼容层，已迁入 hermes_core.memory.store"""
from hermes_core.memory.store import MemoryStore, get_db_path, init_tables

__all__ = [
    "MemoryStore",
    "get_db_path",
    "init_tables",
]
