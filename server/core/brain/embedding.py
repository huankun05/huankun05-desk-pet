"""
core.brain.embedding — 兼容层，已迁入 hermes_core.memory.embedding

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.brain.embedding import ..."
"""
try:
    from server.hermes_core.memory.embedding import Embedder, LocalHashEmbedder, cosine_similarity, get_default_embedder
except ImportError:
    from hermes_core.memory.embedding import Embedder, LocalHashEmbedder, cosine_similarity, get_default_embedder

__all__ = [
    "Embedder",
    "LocalHashEmbedder",
    "cosine_similarity",
    "get_default_embedder",
]
