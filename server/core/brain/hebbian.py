"""core.brain.hebbian — 兼容层，已迁入 hermes_core.memory.hebbian"""
from hermes_core.memory.hebbian import HebbianNetwork, get_hebbian_db, init_hebbian_tables

__all__ = [
    "HebbianNetwork",
    "get_hebbian_db",
    "init_hebbian_tables",
]
