"""Brain 记忆 SQLite 存储层。

提供 memory_fragments 的 CRUD、FTS 检索、向量字段读写。
与 `server.core.api_server` 共用同一份 `data/core.db`，避免循环导入。
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Generator

from .fragment import MemoryFragment


_DEFAULT_DB_PATH = Path(__file__).parent.parent.parent / "data" / "core.db"


def get_db_path() -> Path:
    """获取 Brain 数据库路径。"""
    return _DEFAULT_DB_PATH


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """获取数据库连接上下文。"""
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_tables() -> None:
    """初始化记忆相关表（幂等）。"""
    with get_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS memory_fragments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id TEXT DEFAULT 'default',
                user_id TEXT DEFAULT 'default',
                content TEXT NOT NULL,
                importance REAL NOT NULL DEFAULT 0.5,
                access_count INTEGER NOT NULL DEFAULT 0,
                last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
                is_permanent INTEGER NOT NULL DEFAULT 0,
                embedding TEXT DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_memory_character_id ON memory_fragments(character_id);
            CREATE INDEX IF NOT EXISTS idx_memory_user_id ON memory_fragments(user_id);
            CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory_fragments(importance DESC);
            CREATE INDEX IF NOT EXISTS idx_memory_content ON memory_fragments(content);
            CREATE INDEX IF NOT EXISTS idx_memory_permanent ON memory_fragments(is_permanent);
            CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory_fragments(created_at);
            """
        )


def _row_to_fragment(row: sqlite3.Row) -> MemoryFragment:
    """将数据库行转换为 MemoryFragment。"""
    embedding_raw = row["embedding"]
    try:
        embedding = json.loads(embedding_raw) if embedding_raw else []
    except json.JSONDecodeError:
        embedding = []

    return MemoryFragment(
        id=row["id"],
        character_id=int(row["character_id"]) if str(row["character_id"]).isdigit() else 0,
        user_id=row["user_id"] or "",
        content=row["content"],
        importance=row["importance"],
        embedding=embedding,
        access_count=row["access_count"],
        last_accessed=datetime.fromisoformat(row["last_accessed"]),
        is_permanent=bool(row["is_permanent"]),
        created_at=datetime.fromisoformat(row["created_at"]),
    )


class MemoryStore:
    """记忆碎片仓库。

    所有方法均支持 character_id / user_id 过滤，默认使用 'default'。
    """

    def __init__(self, character_id: str = "default", user_id: str = "default"):
        self.character_id = character_id
        self.user_id = user_id
        init_tables()

    def add(self, fragment: MemoryFragment) -> MemoryFragment:
        """插入一条记忆碎片，返回填充 id 后的对象。"""
        with get_db() as db:
            cursor = db.execute(
                """
                INSERT INTO memory_fragments
                (character_id, user_id, content, importance, is_permanent, embedding)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    fragment.character_id or self.character_id,
                    fragment.user_id or self.user_id,
                    fragment.content,
                    max(0.0, min(1.0, fragment.importance)),
                    1 if fragment.is_permanent else 0,
                    json.dumps(fragment.embedding or []),
                ),
            )
            fragment.id = cursor.lastrowid
        return fragment

    def get(self, frag_id: int) -> MemoryFragment | None:
        """按 id 读取记忆碎片。"""
        with get_db() as db:
            row = db.execute(
                "SELECT * FROM memory_fragments WHERE id = ?",
                (frag_id,),
            ).fetchone()
        return _row_to_fragment(row) if row else None

    def list_all(self, limit: int = 1000) -> list[MemoryFragment]:
        """列出当前角色/用户的记忆碎片（按重要性降序）。"""
        with get_db() as db:
            rows = db.execute(
                """
                SELECT * FROM memory_fragments
                WHERE character_id = ? AND user_id = ?
                ORDER BY importance DESC, created_at DESC
                LIMIT ?
                """,
                (self.character_id, self.user_id, limit),
            ).fetchall()
        return [_row_to_fragment(r) for r in rows]

    def search_like(
        self,
        query: str,
        limit: int = 50,
    ) -> list[MemoryFragment]:
        """使用 SQLite LIKE 做基础全文过滤。

        实现策略：
        1. 先尝试完整 query 的 LIKE 匹配
        2. 如果结果太少，拆分为单字/token 做 OR 匹配
        """
        query = query.strip()
        if not query:
            return self.list_all(limit=limit)

        with get_db() as db:
            # 策略 1：完整 query 匹配
            rows = db.execute(
                """
                SELECT * FROM memory_fragments
                WHERE character_id = ? AND user_id = ? AND content LIKE ?
                ORDER BY importance DESC, created_at DESC
                LIMIT ?
                """,
                (self.character_id, self.user_id, f"%{query}%", limit),
            ).fetchall()
            results = [_row_to_fragment(r) for r in rows]

            # 策略 2：如果结果不足，使用单字 OR 匹配扩大召回
            if len(results) < limit // 2 and len(query) > 1:
                tokens = self._extract_search_tokens(query)
                if tokens:
                    placeholders = " OR ".join(["content LIKE ?"] * len(tokens))
                    params = [self.character_id, self.user_id] + [f"%{t}%" for t in tokens] + [limit]
                    rows = db.execute(
                        f"""
                        SELECT * FROM memory_fragments
                        WHERE character_id = ? AND user_id = ? AND ({placeholders})
                        ORDER BY importance DESC, created_at DESC
                        LIMIT ?
                        """,
                        tuple(params),
                    ).fetchall()
                    token_results = [_row_to_fragment(r) for r in rows]
                    # 合并去重（保持顺序）
                    seen = {r.id for r in results}
                    for r in token_results:
                        if r.id not in seen:
                            results.append(r)
                            seen.add(r.id)

        return results[:limit]

    @staticmethod
    def _extract_search_tokens(query: str) -> list[str]:
        """从查询中提取用于 OR LIKE 的 token。

        过滤掉纯标点、纯空白和过短的英文字符串。
        """
        import re

        tokens: list[str] = []
        # 中文字符和英文/数字词
        for token in re.findall(r"[\u4e00-\u9fff]|[a-zA-Z0-9]{2,}", query):
            if token.strip():
                tokens.append(token)
        # 去重保序
        seen: set[str] = set()
        unique: list[str] = []
        for t in tokens:
            if t not in seen:
                seen.add(t)
                unique.append(t)
        return unique

    def touch(self, frag_id: int) -> None:
        """记录一次访问。"""
        with get_db() as db:
            db.execute(
                """
                UPDATE memory_fragments
                SET access_count = access_count + 1,
                    last_accessed = datetime('now')
                WHERE id = ?
                """,
                (frag_id,),
            )

    def update_embedding(self, frag_id: int, embedding: list[float]) -> None:
        """更新记忆碎片的向量字段。"""
        with get_db() as db:
            db.execute(
                "UPDATE memory_fragments SET embedding = ? WHERE id = ?",
                (json.dumps(embedding or []), frag_id),
            )

    def set_permanent(self, frag_id: int, is_permanent: bool) -> MemoryFragment | None:
        """设置永久记忆标志。"""
        with get_db() as db:
            db.execute(
                "UPDATE memory_fragments SET is_permanent = ? WHERE id = ?",
                (1 if is_permanent else 0, frag_id),
            )
        return self.get(frag_id)

    def delete(self, frag_id: int) -> bool:
        """删除记忆碎片。"""
        with get_db() as db:
            cursor = db.execute(
                "DELETE FROM memory_fragments WHERE id = ?",
                (frag_id,),
            )
        return cursor.rowcount > 0
