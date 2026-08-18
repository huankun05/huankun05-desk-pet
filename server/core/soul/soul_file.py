"""
core.soul.soul_file — 兼容层，已迁入 hermes_core.soul.soul_file

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.soul.soul_file import ..."
"""
try:
    from server.hermes_core.soul.soul_file import SoulFile
except ImportError:
    from hermes_core.soul.soul_file import SoulFile

__all__ = [
    "SoulFile",
]
