"""Session 服务 — hermes_core.SessionDB 接入层。

将 Hermes 的 state.db 会话引擎（FTS5 + WAL）暴露为 HTTP API，
使 desk-pet 前端可以读写 Hermes 大脑的会话历史与全文检索。

数据文件: <desk-pet>/data/hermes_state.db
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger("core-api.session")


def _ensure_server_path() -> None:
    """确保 server/ 在 sys.path 中，使 hermes_core 的绝对导入可解析。"""
    server_dir = Path(__file__).resolve().parent.parent
    if str(server_dir) not in sys.path:
        sys.path.insert(0, str(server_dir))


_ensure_server_path()

from hermes_core import SessionDB  # noqa: E402


_db: Optional[SessionDB] = None


def get_session_db_path() -> Path:
    """state.db 存放位置：<desk-pet 根>/data/hermes_state.db"""
    root = Path(__file__).resolve().parents[2]
    return root / "data" / "hermes_state.db"


def get_db() -> SessionDB:
    """单例 SessionDB（进程内复用连接）。"""
    global _db
    if _db is None:
        path = get_session_db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        _db = SessionDB(path)
    return _db


# ============================================================
# 会话操作
# ============================================================

def list_sessions(
    source: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
) -> dict:
    """列出会话（含预览与最后活跃时间）。source 为空则列出全部来源。"""
    rows = get_db().list_sessions_rich(
        source=source,
        limit=limit,
        offset=offset,
        order_by_last_active=True,
        compact_rows=True,
    )
    return {"items": rows, "total": len(rows)}


def get_session(session_id: str) -> dict:
    """读取单个会话及其消息。"""
    db = get_db()
    meta = db.get_session(session_id)
    if meta is None:
        return {"session": None, "messages": []}
    messages = db.get_messages(session_id, limit=500)
    return {"session": meta, "messages": messages}


def create_session(session_id: str, source: str = "desk-pet") -> dict:
    """创建会话（已存在则直接返回）。"""
    db = get_db()
    if db.get_session(session_id) is None:
        db.create_session(session_id, source=source)
    meta = db.get_session(session_id)
    return {"session": meta}


def append_message(
    session_id: str,
    role: str,
    content: str,
    token_count: Optional[int] = None,
) -> dict:
    """向会话追加一条消息。"""
    db = get_db()
    if db.get_session(session_id) is None:
        db.create_session(session_id, source="desk-pet")
    db.append_message(
        session_id,
        role=role,
        content=content,
        token_count=token_count,
    )
    messages = db.get_messages(session_id, limit=500)
    return {"session_id": session_id, "messages": messages}


def search_sessions(query: str, limit: int = 10) -> dict:
    """FTS5 全文检索会话消息。"""
    hits = get_db().search_messages(query, limit=limit)
    return {"query": query, "hits": hits}


def delete_session(session_id: str) -> dict:
    """删除会话（含消息）。"""
    db = get_db()
    existed = db.get_session(session_id) is not None
    if existed:
        db.delete_session(session_id)
    return {"deleted": existed, "session_id": session_id}


def get_stats() -> dict:
    """会话统计：总数 / 消息总数 / FTS5 可用性。"""
    db = get_db()
    sessions = db.list_sessions_rich(limit=10000, compact_rows=True)
    total_messages = 0
    for s in sessions:
        total_messages += int(s.get("message_count") or 0)
    # FTS5 可用性探测
    fts5_ok = False
    try:
        db.search_messages("__probe__", limit=1)
        fts5_ok = True
    except Exception as exc:  # noqa: BLE001
        log.warning("FTS5 probe failed: %s", exc)
    return {
        "session_count": len(sessions),
        "message_count": total_messages,
        "fts5_available": fts5_ok,
        "db_path": str(get_session_db_path()),
    }
