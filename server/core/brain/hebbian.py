"""Hebbian 共激活模块。

基于 Hebbian 学习理论："一起激活的神经元会连接得更强"。

在记忆系统中的应用：
1. 当多个记忆碎片被同时检索到时，它们之间的连接会增强
2. 连接强度影响记忆的相互激活概率
3. 长期来看，相关的记忆会形成知识网络

实现策略：
- 使用连接矩阵存储碎片间的关联强度
- 检索时更新连接强度
- 连接强度随时间衰减
- 支持从连接推断关联记忆
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from .store import get_db, get_db_path, init_tables
from .fragment import MemoryFragment

HEBBIAN_STRENGTH_DECAY = 0.95
HEBBIAN_LEARNING_RATE = 0.1
HEBBIAN_MAX_STRENGTH = 1.0


@contextmanager
def get_hebbian_db():
    """获取 Hebbian 连接数据库连接。"""
    db_path = get_db_path()
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_hebbian_tables():
    """初始化 Hebbian 连接表（幂等）。"""
    with get_hebbian_db() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS hebbian_connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fragment_a_id INTEGER NOT NULL,
                fragment_b_id INTEGER NOT NULL,
                strength REAL NOT NULL DEFAULT 0.0,
                last_activated TEXT NOT NULL DEFAULT (datetime('now')),
                activation_count INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (fragment_a_id) REFERENCES memory_fragments(id) ON DELETE CASCADE,
                FOREIGN KEY (fragment_b_id) REFERENCES memory_fragments(id) ON DELETE CASCADE
            )
            """
        )
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_hebbian_pair ON hebbian_connections(fragment_a_id, fragment_b_id)"
        )
        db.execute("CREATE INDEX IF NOT EXISTS idx_hebbian_a ON hebbian_connections(fragment_a_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_hebbian_b ON hebbian_connections(fragment_b_id)")


class HebbianNetwork:
    """Hebbian 记忆连接网络。

    管理记忆碎片之间的关联强度，实现共激活强化。
    """

    def __init__(self, character_id: str = "default", user_id: str = "default"):
        self.character_id = character_id
        self.user_id = user_id
        init_hebbian_tables()

    def update_coactivation(self, fragment_ids: List[int]):
        """当多个碎片被同时激活时，更新它们之间的连接强度。

        Args:
            fragment_ids: 同时被检索到的碎片 ID 列表
        """
        if len(fragment_ids) < 2:
            return

        n = len(fragment_ids)
        for i in range(n):
            for j in range(i + 1, n):
                a_id = fragment_ids[i]
                b_id = fragment_ids[j]
                self._strengthen_connection(a_id, b_id)

    def _strengthen_connection(self, a_id: int, b_id: int):
        """增强两个碎片之间的连接。"""
        with get_hebbian_db() as db:
            row = db.execute(
                """
                SELECT strength, activation_count FROM hebbian_connections
                WHERE fragment_a_id = ? AND fragment_b_id = ?
                """,
                (a_id, b_id),
            ).fetchone()

            now = datetime.now().isoformat()
            if row:
                new_strength = min(
                    HEBBIAN_MAX_STRENGTH,
                    row["strength"] + HEBBIAN_LEARNING_RATE,
                )
                db.execute(
                    """
                    UPDATE hebbian_connections
                    SET strength = ?, last_activated = ?, activation_count = ?
                    WHERE fragment_a_id = ? AND fragment_b_id = ?
                    """,
                    (new_strength, now, row["activation_count"] + 1, a_id, b_id),
                )
            else:
                db.execute(
                    """
                    INSERT INTO hebbian_connections
                    (fragment_a_id, fragment_b_id, strength, last_activated, activation_count)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (a_id, b_id, HEBBIAN_LEARNING_RATE, now, 1),
                )

    def get_related_fragments(
        self, fragment_id: int, threshold: float = 0.2, limit: int = 10
    ) -> List[Tuple[int, float]]:
        """获取与指定碎片相关的其他碎片（按连接强度排序）。

        Args:
            fragment_id: 目标碎片 ID
            threshold: 连接强度阈值
            limit: 返回数量限制

        Returns:
            列表：[(related_id, strength), ...]
        """
        with get_hebbian_db() as db:
            rows = db.execute(
                """
                SELECT fragment_b_id, strength FROM hebbian_connections
                WHERE fragment_a_id = ? AND strength >= ?
                UNION ALL
                SELECT fragment_a_id, strength FROM hebbian_connections
                WHERE fragment_b_id = ? AND strength >= ?
                ORDER BY strength DESC
                LIMIT ?
                """,
                (fragment_id, threshold, fragment_id, threshold, limit),
            ).fetchall()

        return [(row["fragment_b_id"], row["strength"]) for row in rows]

    def decay_connections(self):
        """衰减所有连接强度（模拟遗忘）。"""
        with get_hebbian_db() as db:
            db.execute(
                """
                UPDATE hebbian_connections
                SET strength = strength * ?
                WHERE strength > 0.01
                """,
                (HEBBIAN_STRENGTH_DECAY,),
            )

            db.execute(
                """
                DELETE FROM hebbian_connections
                WHERE strength <= 0.01
                """
            )

    def get_connection_strength(self, a_id: int, b_id: int) -> float:
        """获取两个碎片之间的连接强度。"""
        with get_hebbian_db() as db:
            row = db.execute(
                """
                SELECT strength FROM hebbian_connections
                WHERE (fragment_a_id = ? AND fragment_b_id = ?)
                   OR (fragment_a_id = ? AND fragment_b_id = ?)
                """,
                (a_id, b_id, b_id, a_id),
            ).fetchone()

        return row["strength"] if row else 0.0

    def reinforce_related(self, fragment_id: int, boost_factor: float = 0.1):
        """强化与指定碎片相关的所有记忆。

        当一个记忆被激活时，其相关记忆也会得到强化。

        Args:
            fragment_id: 激活的碎片 ID
            boost_factor: 强化幅度
        """
        related = self.get_related_fragments(fragment_id, threshold=0.1)
        if not related:
            return

        from .store import MemoryStore

        store = MemoryStore(character_id=self.character_id, user_id=self.user_id)
        for related_id, strength in related:
            fragment = store.get(related_id)
            if fragment:
                new_importance = min(1.0, fragment.importance + boost_factor * strength)
                store.update(related_id, importance=new_importance)

    def get_network_summary(self) -> Dict:
        """获取网络统计摘要。"""
        with get_hebbian_db() as db:
            total_connections = db.execute(
                "SELECT COUNT(*) FROM hebbian_connections"
            ).fetchone()[0]

            avg_strength = db.execute(
                "SELECT AVG(strength) FROM hebbian_connections"
            ).fetchone()[0]

            max_strength = db.execute(
                "SELECT MAX(strength) FROM hebbian_connections"
            ).fetchone()[0]

        return {
            "total_connections": total_connections or 0,
            "avg_strength": round(avg_strength or 0, 4),
            "max_strength": round(max_strength or 0, 4),
        }