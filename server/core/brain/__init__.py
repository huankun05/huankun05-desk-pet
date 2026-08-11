"""记忆系统（Brain）。

模块结构:
- fragment.py — 记忆碎片数据模型
- decay.py — Ebbinghaus 遗忘曲线
- store.py — SQLite 存储层
- embedding.py — 向量嵌入（local_hash）
- librarian.py — 记忆检索器
- scribe.py — 记忆提取器
"""

from .fragment import MemoryFragment
from .decay import (
    compute_importance,
    classify_stage,
    apply_decay,
    should_reinforce,
    DecayResult,
    DECAY_RATE,
    REINFORCEMENT_FACTOR,
    THRESHOLD_COOLING,
    THRESHOLD_FROZEN,
    THRESHOLD_TOMBSTONE,
)
from .store import MemoryStore, get_db_path, init_tables
from .embedding import (
    Embedder,
    LocalHashEmbedder,
    cosine_similarity,
    resize_vector,
    get_embedder,
    get_default_embedder,
)
from .librarian import Librarian, SearchResult
from .scribe import Scribe, ExtractionConfig
from .memory_service import MemoryService, get_memory_service, reset_memory_service_cache

__all__ = [
    "MemoryFragment",
    "compute_importance",
    "classify_stage",
    "apply_decay",
    "should_reinforce",
    "DecayResult",
    "DECAY_RATE",
    "REINFORCEMENT_FACTOR",
    "THRESHOLD_COOLING",
    "THRESHOLD_FROZEN",
    "THRESHOLD_TOMBSTONE",
    "MemoryStore",
    "get_db_path",
    "init_tables",
    "Embedder",
    "LocalHashEmbedder",
    "cosine_similarity",
    "resize_vector",
    "get_embedder",
    "get_default_embedder",
    "Librarian",
    "SearchResult",
    "Scribe",
    "ExtractionConfig",
    "MemoryService",
    "get_memory_service",
    "reset_memory_service_cache",
]
