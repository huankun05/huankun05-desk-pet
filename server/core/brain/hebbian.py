"""
core.brain.hebbian — 兼容层，已迁入 hermes_core.memory.hebbian

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.brain.hebbian import ..."
"""
try:
    from server.hermes_core.memory.hebbian import HebbianNetwork, get_hebbian_db, init_hebbian_tables
except ImportError:
    from hermes_core.memory.hebbian import HebbianNetwork, get_hebbian_db, init_hebbian_tables

__all__ = [
    "HebbianNetwork",
    "get_hebbian_db",
    "init_hebbian_tables",
]
