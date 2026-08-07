"""个人知识库模块。

在记忆碎片基础上，提供更高级的知识管理功能：
- 文档级知识存储（支持 Markdown、文本）
- 智能分块（固定大小 + 语义边界感知）
- 向量检索 + RRF 混合排序
- 知识图谱关联

实现策略：
- 文档 → 多个记忆碎片（分块）
- 检索时聚合同一文档的碎片
- 支持知识晶体（高频验证的永久性事实）
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from .store import get_db, get_db_path, init_tables
from .fragment import MemoryFragment
from .embedding import Embedder, cosine_similarity, get_default_embedder

CHUNK_SIZE = 500
CHUNK_OVERLAP = 50


@contextmanager
def get_knowledge_db():
    """获取知识库数据库连接。"""
    db_path = get_db_path()
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_knowledge_tables():
    """初始化知识库表（幂等）。"""
    with get_knowledge_db() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS knowledge_documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id TEXT DEFAULT 'default',
                user_id TEXT DEFAULT 'default',
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                source_type TEXT DEFAULT 'manual',
                source_url TEXT DEFAULT '',
                chunk_count INTEGER NOT NULL DEFAULT 0,
                is_crystal INTEGER NOT NULL DEFAULT 0,
                importance REAL NOT NULL DEFAULT 0.5,
                access_count INTEGER NOT NULL DEFAULT 0,
                last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS knowledge_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                chunk_index INTEGER NOT NULL DEFAULT 0,
                embedding TEXT DEFAULT '[]',
                importance REAL NOT NULL DEFAULT 0.5,
                FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_knowledge_doc_character ON knowledge_documents(character_id);
            CREATE INDEX IF NOT EXISTS idx_knowledge_doc_user ON knowledge_documents(user_id);
            CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_doc ON knowledge_chunks(document_id);
            """
        )


class KnowledgeDocument:
    """知识库文档数据模型。"""

    def __init__(
        self,
        id: Optional[int] = None,
        title: str = "",
        content: str = "",
        source_type: str = "manual",
        source_url: str = "",
        chunk_count: int = 0,
        is_crystal: bool = False,
        importance: float = 0.5,
        access_count: int = 0,
        last_accessed: str = "",
        created_at: str = "",
    ):
        self.id = id
        self.title = title
        self.content = content
        self.source_type = source_type
        self.source_url = source_url
        self.chunk_count = chunk_count
        self.is_crystal = is_crystal
        self.importance = importance
        self.access_count = access_count
        self.last_accessed = last_accessed
        self.created_at = created_at

    def to_dict(self) -> Dict:
        """转换为字典。"""
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content,
            "source_type": self.source_type,
            "source_url": self.source_url,
            "chunk_count": self.chunk_count,
            "is_crystal": self.is_crystal,
            "importance": self.importance,
            "access_count": self.access_count,
            "last_accessed": self.last_accessed,
            "created_at": self.created_at,
        }


class KnowledgeBase:
    """个人知识库管理器。"""

    def __init__(
        self,
        character_id: str = "default",
        user_id: str = "default",
        embedder: Embedder | None = None,
    ):
        self.character_id = character_id
        self.user_id = user_id
        self.embedder = embedder or get_default_embedder()
        init_knowledge_tables()

    def add_document(self, document: KnowledgeDocument) -> KnowledgeDocument:
        """添加文档并自动分块。"""
        with get_knowledge_db() as db:
            cursor = db.execute(
                """
                INSERT INTO knowledge_documents
                (character_id, user_id, title, content, source_type, source_url, importance)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    self.character_id,
                    self.user_id,
                    document.title,
                    document.content,
                    document.source_type,
                    document.source_url,
                    document.importance,
                ),
            )
            document.id = cursor.lastrowid

            chunks = self._split_into_chunks(document.content)
            for idx, chunk_content in enumerate(chunks):
                embedding = self.embedder.embed(chunk_content)
                db.execute(
                    """
                    INSERT INTO knowledge_chunks
                    (document_id, content, chunk_index, embedding)
                    VALUES (?, ?, ?, ?)
                    """,
                    (document.id, chunk_content, idx, json.dumps(embedding)),
                )

            db.execute(
                """
                UPDATE knowledge_documents
                SET chunk_count = ?
                WHERE id = ?
                """,
                (len(chunks), document.id),
            )

        return document

    def _split_into_chunks(self, content: str) -> List[str]:
        """智能分块：优先按段落分割，其次按标点分割。"""
        chunks = []
        current_chunk = ""

        paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]

        for para in paragraphs:
            if len(current_chunk) + len(para) + 2 <= CHUNK_SIZE:
                if current_chunk:
                    current_chunk += "\n\n"
                current_chunk += para
            else:
                if current_chunk:
                    chunks.append(current_chunk)
                    if len(para) > CHUNK_SIZE:
                        sub_chunks = self._split_by_length(para)
                        chunks.extend(sub_chunks)
                        current_chunk = ""
                    else:
                        current_chunk = para
                else:
                    if len(para) > CHUNK_SIZE:
                        sub_chunks = self._split_by_length(para)
                        chunks.extend(sub_chunks)
                    else:
                        current_chunk = para

        if current_chunk:
            chunks.append(current_chunk)

        return chunks

    def _split_by_length(self, text: str) -> List[str]:
        """按固定长度分割，尽量在标点处断开。"""
        chunks = []
        start = 0

        while start < len(text):
            end = min(start + CHUNK_SIZE, len(text))

            if end < len(text):
                for i in range(min(CHUNK_OVERLAP, end - start)):
                    pos = end - i - 1
                    if text[pos] in ["。", "！", "？", "；", "\n", ".", "!", "?", ";"]:
                        end = pos + 1
                        break

            chunk = text[start:end]
            if chunk.strip():
                chunks.append(chunk.strip())

            start = end - CHUNK_OVERLAP if CHUNK_OVERLAP > 0 else end

        return chunks

    def get_document(self, document_id: int) -> Optional[KnowledgeDocument]:
        """获取单个文档。"""
        with get_knowledge_db() as db:
            row = db.execute(
                """
                SELECT * FROM knowledge_documents
                WHERE id = ? AND character_id = ? AND user_id = ?
                """,
                (document_id, self.character_id, self.user_id),
            ).fetchone()

        if not row:
            return None

        return KnowledgeDocument(
            id=row["id"],
            title=row["title"],
            content=row["content"],
            source_type=row["source_type"],
            source_url=row["source_url"],
            chunk_count=row["chunk_count"],
            is_crystal=bool(row["is_crystal"]),
            importance=row["importance"],
            access_count=row["access_count"],
            last_accessed=row["last_accessed"],
            created_at=row["created_at"],
        )

    def list_documents(self, limit: int = 100) -> List[KnowledgeDocument]:
        """列出所有文档。"""
        with get_knowledge_db() as db:
            rows = db.execute(
                """
                SELECT * FROM knowledge_documents
                WHERE character_id = ? AND user_id = ?
                ORDER BY importance DESC, created_at DESC
                LIMIT ?
                """,
                (self.character_id, self.user_id, limit),
            ).fetchall()

        return [
            KnowledgeDocument(
                id=row["id"],
                title=row["title"],
                content=row["content"],
                source_type=row["source_type"],
                source_url=row["source_url"],
                chunk_count=row["chunk_count"],
                is_crystal=bool(row["is_crystal"]),
                importance=row["importance"],
                access_count=row["access_count"],
                last_accessed=row["last_accessed"],
                created_at=row["created_at"],
            )
            for row in rows
        ]

    def update_document(self, document_id: int, **kwargs):
        """更新文档。"""
        with get_knowledge_db() as db:
            update_fields = []
            params = []
            for key, value in kwargs.items():
                if key == "is_crystal":
                    update_fields.append(f"{key} = ?")
                    params.append(1 if value else 0)
                else:
                    update_fields.append(f"{key} = ?")
                    params.append(value)
            params.extend([self.character_id, self.user_id, document_id])

            if update_fields:
                db.execute(
                    f"""
                    UPDATE knowledge_documents
                    SET {", ".join(update_fields)}
                    WHERE character_id = ? AND user_id = ? AND id = ?
                    """,
                    tuple(params),
                )

    def delete_document(self, document_id: int):
        """删除文档（级联删除分块）。"""
        with get_knowledge_db() as db:
            db.execute(
                """
                DELETE FROM knowledge_documents
                WHERE id = ? AND character_id = ? AND user_id = ?
                """,
                (document_id, self.character_id, self.user_id),
            )

    def search(
        self, query: str, top_k: int = 5
    ) -> List[Dict]:
        """搜索知识库。

        Returns:
            列表：[{"document": KnowledgeDocument, "chunks": [...], "score": float}, ...]
        """
        query_vec = self.embedder.embed(query)
        query_tokens = set(self._tokenize(query))

        with get_knowledge_db() as db:
            rows = db.execute(
                """
                SELECT kc.*, kd.title, kd.content as doc_content, kd.is_crystal, kd.importance as doc_importance
                FROM knowledge_chunks kc
                JOIN knowledge_documents kd ON kc.document_id = kd.id
                WHERE kd.character_id = ? AND kd.user_id = ?
                """,
                (self.character_id, self.user_id),
            ).fetchall()

        if not rows:
            return []

        results: Dict[int, Dict] = {}

        for row in rows:
            doc_id = row["document_id"]

            chunk_content = row["content"]
            chunk_embedding = json.loads(row["embedding"] or "[]")

            vector_score = cosine_similarity(query_vec, chunk_embedding) if chunk_embedding else 0.0

            chunk_tokens = set(self._tokenize(chunk_content))
            overlap = len(query_tokens & chunk_tokens)
            union = len(query_tokens | chunk_tokens)
            keyword_score = overlap / union if union > 0 else 0.0

            importance_score = row["doc_importance"]

            score = 0.4 * vector_score + 0.4 * keyword_score + 0.2 * importance_score

            if row["is_crystal"]:
                score *= 1.3

            if doc_id not in results:
                results[doc_id] = {
                    "document": KnowledgeDocument(
                        id=row["document_id"],
                        title=row["title"],
                        content=row["doc_content"],
                        is_crystal=bool(row["is_crystal"]),
                        importance=row["doc_importance"],
                    ),
                    "chunks": [],
                    "max_score": 0.0,
                    "avg_score": 0.0,
                }

            results[doc_id]["chunks"].append({
                "content": chunk_content,
                "score": score,
                "vector_score": vector_score,
            })
            results[doc_id]["max_score"] = max(results[doc_id]["max_score"], score)

        for doc_id in results:
            chunks = results[doc_id]["chunks"]
            results[doc_id]["avg_score"] = sum(c["score"] for c in chunks) / len(chunks)
            results[doc_id]["score"] = (results[doc_id]["max_score"] + results[doc_id]["avg_score"]) / 2
            chunks.sort(key=lambda c: c["score"], reverse=True)
            results[doc_id]["chunks"] = chunks[:3]

        sorted_results = sorted(results.values(), key=lambda r: r["score"], reverse=True)

        for r in sorted_results[:top_k]:
            if r["document"].id is not None:
                self._touch_document(r["document"].id)

        return sorted_results[:top_k]

    def _touch_document(self, document_id: int):
        """更新文档访问时间和计数。"""
        with get_knowledge_db() as db:
            db.execute(
                """
                UPDATE knowledge_documents
                SET access_count = access_count + 1, last_accessed = datetime('now')
                WHERE id = ?
                """,
                (document_id,),
            )

    def _tokenize(self, text: str) -> List[str]:
        """简单分词：提取中文单字和英文单词。"""
        import re

        cleaned = re.sub(r"[^\w\u4e00-\u9fff]", " ", text).lower()
        tokens = [t for t in cleaned.split() if len(t) > 0]
        for char in text:
            if "\u4e00" <= char <= "\u9fff":
                tokens.append(char)
        return tokens

    def mark_as_crystal(self, document_id: int):
        """标记为知识晶体（永久性事实）。"""
        self.update_document(document_id, is_crystal=True, importance=1.0)

    def get_summary(self) -> Dict:
        """获取统计摘要。"""
        docs = self.list_documents()
        crystals = [d for d in docs if d.is_crystal]

        return {
            "total_documents": len(docs),
            "total_chunks": sum(d.chunk_count for d in docs),
            "crystal_count": len(crystals),
        }