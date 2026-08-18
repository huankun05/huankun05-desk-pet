"""
core.time.circadian — 兼容层，已迁入 hermes_core.time.circadian

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.time.circadian import ..."
"""
try:
    from server.hermes_core.time.circadian import CircadianRhythm
except ImportError:
    from hermes_core.time.circadian import CircadianRhythm

__all__ = [
    "CircadianRhythm",
]
