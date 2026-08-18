"""
core.time.reunion — 兼容层，已迁入 hermes_core.time.reunion

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.time.reunion import ..."
"""
try:
    from server.hermes_core.time.reunion import ReunionEngine
except ImportError:
    from hermes_core.time.reunion import ReunionEngine

__all__ = [
    "ReunionEngine",
]
