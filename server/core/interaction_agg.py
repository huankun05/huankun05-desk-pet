"""互动聚合沉淀（低频聚合）—— 物理互动 → 长期记忆。

设计动机（与用户确认的取舍）：
- 每次摸头/拍打/踩脚都写一条记忆会爆炸；但角色应该"知道有这事儿发生 + 频率"。
- 因此：每次互动只做**轻量计数**（total + 近 7 天窗口样本），
  当某类互动累计较上次沉淀新增 >= SETTLE_THRESHOLD 次时，才**沉淀一条**偏好记忆
  （client_ref 幂等，内容带累计次数，随频率增长而更新）。

对外接口：
- record(event, character_id)   —— 记录一次互动（interaction:pat 等）
- maybe_settle(character_id)    —— 检查并沉淀达到阈值的互动（返回新沉淀的列表）
- get_stats(character_id, days) —— 各互动类型累计 / 近 N 天次数（供 gateway 注入）
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta
from typing import Any

try:
    from server.hermes_core.memory.store import get_db
    from server.hermes_core.memory.fragment import CATEGORY_PREFERENCE
except ImportError:  # 从 server/ 目录启动
    from hermes_core.memory.store import get_db
    from hermes_core.memory.fragment import CATEGORY_PREFERENCE

log = logging.getLogger("core.interaction_agg")

#: 沉淀阈值：某类互动累计较上次沉淀新增多少条后写一条记忆
SETTLE_THRESHOLD = 5

#: 事件样本表保留的最大行数（防止无限增长）
MAX_EVENT_SAMPLES = 1000

#: 互动类型 → 记忆文案模板（{total} 为累计次数）
TYPE_TEMPLATES: dict[str, str] = {
    "pat": "用户喜欢摸我的头——已累计 {total} 次，这是他表达亲昵的习惯动作",
    "tap": "用户喜欢拍打与我玩闹——已累计 {total} 次，性格有点调皮",
    "step": "用户偶尔踩我的脚——已累计 {total} 次，像是在闹着玩",
}

#: 互动类型 → 中文标签（用于 gateway 注入展示）
TYPE_LABELS: dict[str, str] = {
    "pat": "摸头",
    "tap": "拍打",
    "step": "踩脚",
}


def _type_of(event: str) -> str:
    """interaction:pat → pat；未知事件返回原样。"""
    if event.startswith("interaction:"):
        return event.split(":", 1)[1].strip() or "interaction"
    return event


_initialized = False


def _ensure_tables() -> None:
    """惰性建表（幂等，首次调用执行一次）。"""
    global _initialized
    if _initialized:
        return
    init_tables()
    _initialized = True


def init_tables() -> None:
    """初始化互动统计表（幂等）。"""
    with get_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS interaction_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id TEXT NOT NULL DEFAULT 'default',
                interaction_type TEXT NOT NULL,
                total_count INTEGER NOT NULL DEFAULT 0,
                settled_total INTEGER NOT NULL DEFAULT 0,
                last_ts TEXT NOT NULL DEFAULT '',
                UNIQUE(character_id, interaction_type)
            );

            CREATE TABLE IF NOT EXISTS interaction_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id TEXT NOT NULL DEFAULT 'default',
                interaction_type TEXT NOT NULL,
                ts TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_interaction_events_char_ts
                ON interaction_events(character_id, ts);
            """
        )


def record(event: str, character_id: str = "default") -> bool:
    """记录一次互动事件（无论情绪节流与否都应计数）。

    返回 True 表示累计到阈值并触发了沉淀（可忽略返回值）。
    """
    character_id = character_id or "default"
    itype = _type_of(event)
    now = datetime.now().isoformat(timespec="seconds")
    _ensure_tables()
    try:
        with get_db() as db:
            db.execute(
                "INSERT INTO interaction_events (character_id, interaction_type, ts) VALUES (?, ?, ?)",
                (character_id, itype, now),
            )
            db.execute(
                """
                INSERT INTO interaction_stats (character_id, interaction_type, total_count, settled_total, last_ts)
                VALUES (?, ?, 1, 0, ?)
                ON CONFLICT(character_id, interaction_type)
                DO UPDATE SET total_count = total_count + 1, last_ts = excluded.last_ts
                """,
                (character_id, itype, now),
            )
            # 裁剪事件样本，防止无限增长（低频互动，成本可忽略）
            db.execute(
                """
                DELETE FROM interaction_events
                WHERE id NOT IN (
                    SELECT id FROM interaction_events ORDER BY id DESC LIMIT ?
                )
                """,
                (MAX_EVENT_SAMPLES,),
            )
        # 达到阈值则沉淀（独立事务，失败不影响计数）
        try:
            maybe_settle(character_id)
        except Exception as exc:  # noqa: BLE001
            log.warning("互动沉淀失败（可忽略）: %s", exc)
        return True
    except sqlite3.Error as exc:
        log.warning("互动计数失败: %s", exc)
        return False


def maybe_settle(character_id: str = "default") -> list[dict[str, Any]]:
    """把累计新增达到阈值的互动类型沉淀为偏好记忆（client_ref 幂等）。

    返回本次新沉淀（或更新）的记忆列表。
    """
    character_id = character_id or "default"
    try:
        from server.hermes_core.memory.memory_service import get_memory_service
    except ImportError:  # 从 server/ 目录启动
        from hermes_core.memory.memory_service import get_memory_service

    settled: list[dict[str, Any]] = []
    try:
        with get_db() as db:
            rows = db.execute(
                "SELECT interaction_type, total_count, settled_total FROM interaction_stats WHERE character_id = ?",
                (character_id,),
            ).fetchall()
    except sqlite3.Error as exc:
        log.warning("读取互动统计失败: %s", exc)
        return settled

    svc = get_memory_service(character_id=character_id)
    for row in rows:
        itype = row["interaction_type"]
        total = row["total_count"]
        if total - row["settled_total"] < SETTLE_THRESHOLD:
            continue
        template = TYPE_TEMPLATES.get(itype)
        content = (
            template.format(total=total)
            if template
            else f"用户经常与我互动（{itype}）——已累计 {total} 次"
        )
        importance = min(0.9, 0.45 + total * 0.01)
        try:
            saved = svc.add_memory(
                content,
                category=CATEGORY_PREFERENCE,
                source="interaction",
                importance=importance,
                client_ref=f"interact-settle:{itype}",
                meta={"interaction_type": itype, "total": total},
            )
            settled.append(saved)
            with get_db() as db:
                db.execute(
                    "UPDATE interaction_stats SET settled_total = ? WHERE character_id = ? AND interaction_type = ?",
                    (total, character_id, itype),
                )
            log.info("互动沉淀：%s/%s 累计 %d 次 → 记忆", character_id, itype, total)
        except Exception as exc:  # noqa: BLE001
            log.warning("互动沉淀写入失败（%s）: %s", itype, exc)
    return settled


def get_stats(character_id: str = "default", days: int = 7) -> dict[str, Any]:
    """返回各互动类型累计次数与近 N 天次数（供 gateway 注入 / 前端展示）。"""
    character_id = character_id or "default"
    cutoff = (datetime.now() - timedelta(days=max(1, days))).isoformat(timespec="seconds")
    _ensure_tables()
    try:
        with get_db() as db:
            stats_rows = db.execute(
                "SELECT interaction_type, total_count, last_ts FROM interaction_stats WHERE character_id = ?",
                (character_id,),
            ).fetchall()
            recent_rows = db.execute(
                """
                SELECT interaction_type, COUNT(*) AS c FROM interaction_events
                WHERE character_id = ? AND ts >= ? GROUP BY interaction_type
                """,
                (character_id, cutoff),
            ).fetchall()
    except sqlite3.Error as exc:
        log.warning("读取互动统计失败: %s", exc)
        return {"stats": {}, "recent_days": days}

    recent: dict[str, int] = {r["interaction_type"]: r["c"] for r in recent_rows}
    stats: dict[str, dict[str, Any]] = {}
    for row in stats_rows:
        itype = row["interaction_type"]
        stats[itype] = {
            "label": TYPE_LABELS.get(itype, itype),
            "total": row["total_count"],
            "recent": recent.get(itype, 0),
            "last_ts": row["last_ts"] or "",
        }
    return {"stats": stats, "recent_days": days}
