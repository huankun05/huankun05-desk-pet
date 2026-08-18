"""
core.time.anniversaries — 兼容层，已迁入 hermes_core.time.anniversaries

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.time.anniversaries import ..."
"""
try:
    from server.hermes_core.time.anniversaries import AnniversaryManager
except ImportError:
    from hermes_core.time.anniversaries import AnniversaryManager

__all__ = [
    "AnniversaryManager",
]
