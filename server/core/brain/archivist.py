"""
core.brain.archivist — 兼容层，已迁入 hermes_core.memory.archivist

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.brain.archivist import ..."
"""
try:
    from server.hermes_core.memory.archivist import Archivist
except ImportError:
    from hermes_core.memory.archivist import Archivist

__all__ = [
    "Archivist",
]
