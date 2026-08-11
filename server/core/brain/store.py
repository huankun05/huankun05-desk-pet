"""Brain 记忆 SQLite 存储层。

提供 memory_fragments 的 CRUD、FTS 检索、向量字段读写。
与 `server.core.api_server` 共用同一份 `data/core.db`，避免循环导入。

本模块是统一记忆系统的唯一存储真相来源（core.brain）。
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Generator

from .fragment import (
    CATEGORY_FACT,
    SOURCE_CHAT,
    MemoryFragment,
)


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


# 期望的列（name -> sqlite 类型与默认定义片段），用于增量迁移。
# 注意：ALTER ADD COLUMN 不允许非恒定默认值（如 datetime('now')），
# 因此 updated_at 用常量默认 ''，并在迁移中回填。
_EXPECTED_COLUMNS: dict[str, str] = {
    "category": "TEXT DEFAULT 'fact'",
    "source": "TEXT DEFAULT 'chat'",
    "enabled": "INTEGER DEFAULT 1",
    "meta": "TEXT DEFAULT '{}'",
    "client_ref": "TEXT DEFAULT ''",
    "updated_at": "TEXT DEFAULT ''",
}


def init_tables() -> None:
    """初始化记忆相关表（幂等，含增量迁移）。

    先以「仅原始列」创建表（兼容已存在的旧表），再迁移补齐新列，
    最后统一创建索引——避免 CREATE INDEX 引用尚未新增的列而报错。
    """
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
            """
        )
        _migrate_schema(db)
        db.executescript(
            """
            CREATE INDEX IF NOT EXISTS idx_memory_character_id ON memory_fragments(character_id);
            CREATE INDEX IF NOT EXISTS idx_memory_user_id ON memory_fragments(user_id);
            CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory_fragments(importance DESC);
            CREATE INDEX IF NOT EXISTS idx_memory_content ON memory_fragments(content);
            CREATE INDEX IF NOT EXISTS idx_memory_permanent ON memory_fragments(is_permanent);
            CREATE INDEX IF NOT EXISTS idx_memory_category ON memory_fragments(category);
            CREATE INDEX IF NOT EXISTS idx_memory_source ON memory_fragments(source);
            CREATE INDEX IF NOT EXISTS idx_memory_enabled ON memory_fragments(enabled);
            CREATE INDEX IF NOT EXISTS idx_memory_client_ref ON memory_fragments(client_ref);
            CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory_fragments(created_at);
            """
        )


def _migrate_schema(db: sqlite3.Connection) -> None:
    """为已存在的旧表新增缺失列（SQLite 不支持 CREATE TABLE 的 ALTER）。"""
    existing = {row["name"] for row in db.execute("PRAGMA table_info(memory_fragments)").fetchall()}
    for col, definition in _EXPECTED_COLUMNS.items():
        if col not in existing:
            try:
                db.execute(f"ALTER TABLE memory_fragments ADD COLUMN {col} {definition}")
                logger_migrate(f"memory_fragments 已新增列: {col}")
            except sqlite3.OperationalError as e:
                # 极少数情况下列已存在，忽略
                if "duplicate column" not in str(e).lower():
                    raise
    # 回填 updated_at（ALTER 不允许非恒定默认，故用 '' 后回填 created_at）
    try:
        db.execute(
            "UPDATE memory_fragments SET updated_at = COALESCE(created_at, datetime('now')) "
            "WHERE updated_at IS NULL OR updated_at = ''"
        )
    except sqlite3.OperationalError:
        pass


def logger_migrate(msg: str) -> None:
    """轻量迁移日志（避免在此模块直接引入 logging 造成循环）。"""
    try:
        import logging
        logging.getLogger("core.brain.store").info(msg)
    except Exception:
        pass


def _row_to_fragment(row: sqlite3.Row) -> MemoryFragment:
    """将数据库行转换为 MemoryFragment。"""
    keys = set(row.keys())
    embedding_raw = row["embedding"]
    try:
        embedding = json.loads(embedding_raw) if embedding_raw else []
    except json.JSONDecodeError:
        embedding = []

    meta_raw = row["meta"] if "meta" in keys else "{}"
    try:
        meta = json.loads(meta_raw) if meta_raw else {}
    except json.JSONDecodeError:
        meta = {}

    return MemoryFragment(
        id=row["id"],
        character_id=row["character_id"] or "default",
        user_id=row["user_id"] or "",
        content=row["content"],
        category=row["category"] if "category" in keys else CATEGORY_FACT,
        source=row["source"] if "source" in keys else SOURCE_CHAT,
        enabled=bool(row["enabled"]) if "enabled" in keys else True,
        meta=meta,
        client_ref=row["client_ref"] if "client_ref" in keys else "",
        importance=row["importance"],
        embedding=embedding,
        access_count=row["access_count"],
        last_accessed=datetime.fromisoformat(row["last_accessed"]),
        is_permanent=bool(row["is_permanent"]),
        created_at=datetime.fromisoformat(row["created_at"]),
        updated_at=datetime.fromisoformat(row["updated_at"]) if "updated_at" in keys else datetime.fromisoformat(row["created_at"]),
    )


class MemoryStore:
    """记忆碎片仓库。

    所有方法均支持 character_id / user_id 过滤，默认使用 'default'。
    """

    def __init__(self, character_id: str = "default", user_id: str = "default"):
        self.character_id = character_id or "default"
        self.user_id = user_id or "default"
        init_tables()

    def add(self, fragment: MemoryFragment) -> MemoryFragment:
        """插入一条记忆碎片，返回填充 id 后的对象。"""
        with get_db() as db:
            cursor = db.execute(
                """
                INSERT INTO memory_fragments
                (character_id, user_id, content, category, source, enabled, meta,
                 client_ref, importance, is_permanent, embedding, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                """,
                (
                    fragment.character_id or self.character_id,
                    fragment.user_id or self.user_id,
                    fragment.content,
                    fragment.category or CATEGORY_FACT,
                    fragment.source or SOURCE_CHAT,
                    1 if fragment.enabled else 0,
                    json.dumps(fragment.meta or {}),
                    fragment.client_ref or "",
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

    def get_by_client_ref(self, client_ref: str) -> MemoryFragment | None:
        """按前端 client_ref 查找（用于去重 upsert）。"""
        if not client_ref:
            return None
        with get_db() as db:
            row = db.execute(
                """
                SELECT * FROM memory_fragments
                WHERE character_id = ? AND user_id = ? AND client_ref = ?
                LIMIT 1
                """,
                (self.character_id, self.user_id, client_ref),
            ).fetchone()
        return _row_to_fragment(row) if row else None

    def upsert_by_client_ref(self, fragment: MemoryFragment) -> MemoryFragment:
        """按 client_ref 更新；不存在则插入。返回最终对象。"""
        if fragment.client_ref:
            existing = self.get_by_client_ref(fragment.client_ref)
            if existing is not None:
                fragment.id = existing.id
                return self.update(
                    existing.id,
                    content=fragment.content,
                    category=fragment.category,
                    source=fragment.source,
                    enabled=fragment.enabled,
                    meta=fragment.meta,
                    importance=fragment.importance,
                    is_permanent=fragment.is_permanent,
                    client_ref=fragment.client_ref,
                )
        return self.add(fragment)

    def update(self, frag_id: int, **fields) -> MemoryFragment | None:
        """按字段更新记忆碎片。支持 content/category/source/enabled/meta/
        importance/is_permanent/client_ref/embedding。"""
        allowed = {
            "content", "category", "source", "enabled", "meta",
            "importance", "is_permanent", "client_ref", "embedding",
        }
        set_clauses: list[str] = []
        params: list[Any] = []
        for key, value in fields.items():
            if key not in allowed:
                continue
            if key == "meta":
                value = json.dumps(value or {})
            elif key == "embedding":
                value = json.dumps(value or [])
            elif key == "enabled" or key == "is_permanent":
                value = 1 if value else 0
            set_clauses.append(f"{key} = ?")
            params.append(value)

        if not set_clauses:
            return self.get(frag_id)

        set_clauses.append("updated_at = datetime('now')")
        params.append(frag_id)
        with get_db() as db:
            db.execute(
                f"UPDATE memory_fragments SET {', '.join(set_clauses)} WHERE id = ?",
                tuple(params),
            )
        return self.get(frag_id)

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

    def list_by_filter(
        self,
        category: str | None = None,
        source: str | None = None,
        enabled: bool | None = None,
        is_permanent: bool | None = None,
        limit: int = 1000,
    ) -> list[MemoryFragment]:
        """按多条件过滤记忆碎片。"""
        clauses = ["character_id = ?", "user_id = ?"]
        params: list[Any] = [self.character_id, self.user_id]
        if category is not None:
            clauses.append("category = ?")
            params.append(category)
        if source is not None:
            clauses.append("source = ?")
            params.append(source)
        if enabled is not None:
            clauses.append("enabled = ?")
            params.append(1 if enabled else 0)
        if is_permanent is not None:
            clauses.append("is_permanent = ?")
            params.append(1 if is_permanent else 0)
        params.append(limit)
        with get_db() as db:
            rows = db.execute(
                f"""
                SELECT * FROM memory_fragments
                WHERE {' AND '.join(clauses)}
                ORDER BY importance DESC, created_at DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        return [_row_to_fragment(r) for r in rows]

    def list_by_category(self, category: str, limit: int = 1000) -> list[MemoryFragment]:
        """按类别列出（最常用 UI 分组查询）。"""
        return self.list_by_filter(category=category, limit=limit)

    def list_enabled_rules(self) -> list[MemoryFragment]:
        """列出启用中的约定规则（注入用）。"""
        return self.list_by_filter(category="rule", enabled=True, limit=1000)

    def list_permanent(self, limit: int = 1000) -> list[MemoryFragment]:
        """列出所有永久记忆。"""
        return self.list_by_filter(is_permanent=True, limit=limit)

    def search_like(
        self,
        query: str,
        limit: int = 50,
    ) -> list[MemoryFragment]:
        """使用 SQLite LIKE 做基础全文过滤。

        实现策略：
        1. 先尝试完整 query 的 LIKE 匹配
        2. 如果结果太少，拆分为单字/token 做 OR 匹配

        注意：检索应优先排除 disabled 规则（规则由注入阶段单独处理），
        但 search_like 作为通用召回仍保留全部，由调用方决定。
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

    @staticmethod
    def _normalize_content(content: str) -> str:
        """归一化记忆内容用于去重比较（去空白 + 转小写）。"""
        import re

        return re.sub(r"\s+", "", (content or "").strip().lower())

    def has_identical_content(
        self, content: str, character_id: str | None = None, user_id: str | None = None
    ) -> bool:
        """判断指定角色/用户下是否已存在「内容相同」的记忆（归一化后比较）。

        用于抽取入库前去重，避免空闲自学习重跑或重复对话轮次产生重复记忆。
        """
        cid = character_id or self.character_id
        uid = user_id or self.user_id
        norm = self._normalize_content(content)
        if not norm:
            return False
        with get_db() as db:
            rows = db.execute(
                "SELECT content FROM memory_fragments WHERE character_id = ? AND user_id = ?",
                (cid, uid),
            ).fetchall()
        return any(self._normalize_content(r["content"]) == norm for r in rows)

    def touch(self, frag_id: int) -> None:
        """记录一次访问。"""
        with get_db() as db:
            db.execute(
                """
                UPDATE memory_fragments
                SET access_count = access_count + 1,
                    last_accessed = datetime('now'),
                    updated_at = datetime('now')
                WHERE id = ?
                """,
                (frag_id,),
            )

    def update_embedding(self, frag_id: int, embedding: list[float]) -> None:
        """更新记忆碎片的向量字段。"""
        with get_db() as db:
            db.execute(
                "UPDATE memory_fragments SET embedding = ?, updated_at = datetime('now') WHERE id = ?",
                (json.dumps(embedding or []), frag_id),
            )

    def set_permanent(self, frag_id: int, is_permanent: bool) -> MemoryFragment | None:
        """设置永久记忆标志。"""
        return self.update(frag_id, is_permanent=is_permanent)

    def delete(self, frag_id: int) -> bool:
        """删除记忆碎片。"""
        with get_db() as db:
            cursor = db.execute(
                "DELETE FROM memory_fragments WHERE id = ?",
                (frag_id,),
            )
        return cursor.rowcount > 0

    def delete_by_client_ref(self, client_ref: str) -> bool:
        """按 client_ref 删除（UI 删除条目时同步）。"""
        if not client_ref:
            return False
        with get_db() as db:
            cursor = db.execute(
                """
                DELETE FROM memory_fragments
                WHERE character_id = ? AND user_id = ? AND client_ref = ?
                """,
                (self.character_id, self.user_id, client_ref),
            )
        return cursor.rowcount > 0
