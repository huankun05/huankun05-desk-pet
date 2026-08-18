"""
core.brain.decay — 兼容层，已迁入 hermes_core.memory.decay

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.brain.decay import ..."
"""
try:
    from server.hermes_core.memory.decay import apply_decay, THRESHOLD_TOMBSTONE
except ImportError:
    from hermes_core.memory.decay import apply_decay, THRESHOLD_TOMBSTONE

__all__ = [
    "apply_decay",
    "THRESHOLD_TOMBSTONE",
]
