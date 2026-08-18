"""
core.brain.learning_scheduler — 兼容层，已迁入 hermes_core.memory.learning_scheduler

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.brain.learning_scheduler import ..."
"""
try:
    from server.hermes_core.memory.learning_scheduler import LearningScheduler
except ImportError:
    from hermes_core.memory.learning_scheduler import LearningScheduler

__all__ = [
    "LearningScheduler",
]
