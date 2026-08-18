"""
core.heart.hormones — 兼容层，已迁入 hermes_core.emotion.hormones

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.heart.hormones import ..."
"""
try:
    from server.hermes_core.emotion.hormones import HormonalSystem, HormonalEngine
except ImportError:
    from hermes_core.emotion.hormones import HormonalSystem, HormonalEngine

__all__ = [
    "HormonalSystem",
    "HormonalEngine",
]
