"""
core.brain.knowledge — 兼容层，已迁入 hermes_core.memory.knowledge

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.brain.knowledge import ..."
"""
try:
    from server.hermes_core.memory.knowledge import KnowledgeBase, KnowledgeDocument, get_knowledge_db, init_knowledge_tables
except ImportError:
    from hermes_core.memory.knowledge import KnowledgeBase, KnowledgeDocument, get_knowledge_db, init_knowledge_tables

__all__ = [
    "KnowledgeBase",
    "KnowledgeDocument",
    "get_knowledge_db",
    "init_knowledge_tables",
]
