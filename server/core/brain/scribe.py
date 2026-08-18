"""
core.brain.scribe — 兼容层，已迁入 hermes_core.memory.scribe

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.brain.scribe import ..."
"""
try:
    from server.hermes_core.memory.scribe import Scribe, ExtractionConfig
except ImportError:
    from hermes_core.memory.scribe import Scribe, ExtractionConfig

__all__ = [
    "Scribe",
    "ExtractionConfig",
]
