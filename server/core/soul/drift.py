"""
core.soul.drift — 兼容层，已迁入 hermes_core.soul.drift

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.soul.drift import ..."
"""
try:
    from server.hermes_core.soul.drift import PersonalityDrifter
except ImportError:
    from hermes_core.soul.drift import PersonalityDrifter

__all__ = [
    "PersonalityDrifter",
]
