"""
core.brain.memory_service — 兼容层，已迁入 hermes_core.memory.memory_service

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.brain.memory_service import ..."
"""
try:
    from server.hermes_core.memory.memory_service import get_memory_service
except ImportError:
    from hermes_core.memory.memory_service import get_memory_service

__all__ = [
    "get_memory_service",
]
