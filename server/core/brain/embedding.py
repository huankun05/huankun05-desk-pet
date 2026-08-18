"""core.brain.embedding — 兼容层，已迁入 hermes_core.memory.embedding"""
from hermes_core.memory.embedding import Embedder, LocalHashEmbedder, cosine_similarity, get_default_embedder

__all__ = [
    "Embedder",
    "LocalHashEmbedder",
    "cosine_similarity",
    "get_default_embedder",
]
