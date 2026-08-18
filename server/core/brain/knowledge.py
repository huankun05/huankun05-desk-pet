"""core.brain.knowledge — 兼容层，已迁入 hermes_core.memory.knowledge"""
from hermes_core.memory.knowledge import KnowledgeBase, KnowledgeDocument, get_knowledge_db, init_knowledge_tables

__all__ = [
    "KnowledgeBase",
    "KnowledgeDocument",
    "get_knowledge_db",
    "init_knowledge_tables",
]
