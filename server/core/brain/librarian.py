"""
core.brain.librarian — 兼容层，已迁入 hermes_core.memory.librarian

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.brain.librarian import ..."
"""
try:
    from server.hermes_core.memory.librarian import Librarian, SearchResult
except ImportError:
    from hermes_core.memory.librarian import Librarian, SearchResult

__all__ = [
    "Librarian",
    "SearchResult",
]
