"""纪念日管理模块。

记录和管理重要日期：生日、纪念日、节日等。
到日期时主动提及，增强情感连接。

实现策略：
- SQLite 存储纪念日数据
- 支持每年重复和单次事件
- 计算距离下次日期的天数
- 临近提醒（提前 1/3/7/30 天）
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, date
from typing import Dict, List, Optional

ANNIVERSARY_TYPES = ["birthday", "anniversary", "holiday", "custom"]


@contextmanager
def get_db():
    """获取纪念日数据库连接。"""
    try:
        from ..api_server import get_db as get_core_db
        with get_core_db() as conn:
            yield conn
        return
    except ImportError:
        pass

    import tempfile
    import os
    db_path = os.path.join(tempfile.gettempdir(), "desk_pet_test.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_tables():
    """初始化纪念日表（幂等）。"""
    with get_db() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS anniversaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id TEXT DEFAULT 'default',
                user_id TEXT DEFAULT 'default',
                name TEXT NOT NULL,
                date TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'custom',
                repeat_yearly INTEGER NOT NULL DEFAULT 1,
                reminder_days TEXT DEFAULT '[7, 3, 1]',
                last_notified TEXT DEFAULT '',
                importance REAL NOT NULL DEFAULT 0.5,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )


class Anniversary:
    """纪念日事件。"""

    def __init__(
        self,
        id: int,
        name: str,
        date: str,
        type: str = "custom",
        repeat_yearly: bool = True,
        reminder_days: List[int] = None,
        last_notified: str = "",
        importance: float = 0.5,
    ):
        self.id = id
        self.name = name
        self.date = date
        self.type = type
        self.repeat_yearly = repeat_yearly
        self.reminder_days = reminder_days or [7, 3, 1]
        self.last_notified = last_notified
        self.importance = importance

    def to_dict(self) -> Dict:
        """转换为字典。"""
        return {
            "id": self.id,
            "name": self.name,
            "date": self.date,
            "type": self.type,
            "repeat_yearly": self.repeat_yearly,
            "reminder_days": self.reminder_days,
            "last_notified": self.last_notified,
            "importance": self.importance,
        }


class AnniversaryManager:
    """纪念日管理器。"""

    def __init__(self, character_id: str = "default", user_id: str = "default"):
        self.character_id = character_id
        self.user_id = user_id
        init_tables()

    def add(
        self,
        name: str,
        date: str,
        type: str = "custom",
        repeat_yearly: bool = True,
        reminder_days: List[int] = None,
        importance: float = 0.5,
    ) -> Anniversary:
        """添加纪念日。"""
        with get_db() as db:
            cursor = db.execute(
                """
                INSERT INTO anniversaries
                (character_id, user_id, name, date, type, repeat_yearly, reminder_days, importance)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    self.character_id,
                    self.user_id,
                    name,
                    date,
                    type,
                    1 if repeat_yearly else 0,
                    json.dumps(reminder_days or [7, 3, 1]),
                    importance,
                ),
            )
            return self.get(cursor.lastrowid)

    def get(self, anniv_id: int) -> Optional[Anniversary]:
        """获取单个纪念日。"""
        with get_db() as db:
            row = db.execute(
                "SELECT * FROM anniversaries WHERE id = ?", (anniv_id,)
            ).fetchone()
            if row is None:
                return None
            return self._row_to_anniversary(row)

    def list_all(self) -> List[Anniversary]:
        """列出所有纪念日。"""
        with get_db() as db:
            rows = db.execute(
                """
                SELECT * FROM anniversaries
                WHERE character_id = ? AND user_id = ?
                ORDER BY date ASC
                """,
                (self.character_id, self.user_id),
            ).fetchall()
            return [self._row_to_anniversary(row) for row in rows]

    def delete(self, anniv_id: int) -> bool:
        """删除纪念日。"""
        with get_db() as db:
            db.execute("DELETE FROM anniversaries WHERE id = ?", (anniv_id,))
        return True

    def update(
        self,
        anniv_id: int,
        name: str = None,
        date: str = None,
        type: str = None,
        repeat_yearly: bool = None,
        reminder_days: List[int] = None,
        importance: float = None,
    ) -> Optional[Anniversary]:
        """更新纪念日信息。"""
        updates = []
        params = []
        if name is not None:
            updates.append("name = ?")
            params.append(name)
        if date is not None:
            updates.append("date = ?")
            params.append(date)
        if type is not None:
            updates.append("type = ?")
            params.append(type)
        if repeat_yearly is not None:
            updates.append("repeat_yearly = ?")
            params.append(1 if repeat_yearly else 0)
        if reminder_days is not None:
            updates.append("reminder_days = ?")
            params.append(json.dumps(reminder_days))
        if importance is not None:
            updates.append("importance = ?")
            params.append(importance)
        if not updates:
            return self.get(anniv_id)
        params.append(anniv_id)
        with get_db() as db:
            db.execute(
                f"UPDATE anniversaries SET {', '.join(updates)} WHERE id = ?",
                params,
            )
        return self.get(anniv_id)

    def _row_to_anniversary(self, row) -> Anniversary:
        """将数据库行转换为 Anniversary 对象。"""
        return Anniversary(
            id=row["id"],
            name=row["name"],
            date=row["date"],
            type=row["type"],
            repeat_yearly=bool(row["repeat_yearly"]),
            reminder_days=json.loads(row["reminder_days"]) if row["reminder_days"] else [7, 3, 1],
            last_notified=row["last_notified"],
            importance=row["importance"],
        )

    def _parse_date(self, date_str: str) -> date:
        """解析日期字符串。"""
        for fmt in ["%Y-%m-%d", "%Y/%m/%d", "%m-%d", "%m/%d"]:
            try:
                if len(date_str) <= 5:
                    d = datetime.strptime(date_str, fmt).date()
                    return date(date.today().year, d.month, d.day)
                return datetime.strptime(date_str, fmt).date()
            except ValueError:
                continue
        raise ValueError(f"无法解析日期: {date_str}")

    def _get_next_date(self, anniv: Anniversary) -> Optional[date]:
        """计算下一个纪念日日期。"""
        target = self._parse_date(anniv.date)
        today = date.today()
        if anniv.repeat_yearly:
            if len(anniv.date) <= 5:
                target = date(today.year, target.month, target.day)
                if target < today:
                    target = date(today.year + 1, target.month, target.day)
            else:
                if target < today:
                    target = date(today.year + 1, target.month, target.day)
            return target
        else:
            return target if target >= today else None

    def get_days_until(self, anniv_id: int) -> Optional[int]:
        """获取距离下次纪念日的天数。"""
        anniv = self.get(anniv_id)
        if anniv is None:
            return None
        next_date = self._get_next_date(anniv)
        if next_date is None:
            return None
        return (next_date - date.today()).days

    def check_reminders(self) -> List[Dict]:
        """检查是否需要发送提醒。"""
        today = date.today()
        reminders = []
        for anniv in self.list_all():
            next_date = self._get_next_date(anniv)
            if next_date is None:
                continue
            days_until = (next_date - today).days
            if days_until in anniv.reminder_days:
                if anniv.last_notified:
                    last_date = datetime.strptime(anniv.last_notified, "%Y-%m-%d").date()
                    if (today - last_date).days < 7:
                        continue
                reminders.append(
                    {
                        "anniversary": anniv.to_dict(),
                        "days_until": days_until,
                        "type": "reminder",
                    }
                )
                self._mark_notified(anniv.id)
        return reminders

    def _mark_notified(self, anniv_id: int):
        """标记已通知。"""
        with get_db() as db:
            db.execute(
                "UPDATE anniversaries SET last_notified = ? WHERE id = ?",
                (date.today().isoformat(), anniv_id),
            )

    def get_upcoming(self, days: int = 30) -> List[Dict]:
        """获取即将到来的纪念日（N天内）。"""
        today = date.today()
        upcoming = []
        for anniv in self.list_all():
            next_date = self._get_next_date(anniv)
            if next_date is None:
                continue
            days_until = (next_date - today).days
            if 0 <= days_until <= days:
                upcoming.append(
                    {
                        "anniversary": anniv.to_dict(),
                        "days_until": days_until,
                    }
                )
        return sorted(upcoming, key=lambda x: x["days_until"])