"""
Hermes Gateway — 自学习记忆（成长能力）

仿 Hermes 的 <memory-context> 协议：从对话中由 LLM 抽取持久化记忆
（用户偏好 / 个人事实 / 反馈纠正 / 长期约定），存入本地 SQLite，
后续对话按相关性召回并注入 system prompt，使桌宠随交互「成长」。

存储独立于 hermes_state.db，避免触碰 SessionDB 的高耦合代码。
召回采用「逐字/词 LIKE 的 AND 匹配」：对中文友好（顺序无关），
且不需要 FTS5 的中文分词器（本机 SQLite 构建默认不索引 CJK）。
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

log = __import__("logging").getLogger("hermes-gateway.memory")

_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "memories.db"
_lock = threading.Lock()

# ASCII 词整体作为一个词；CJK 逐字。用于把查询拆成「都要出现」的片段。
_CJK_RANGE = "[" + "\u4e00" + "-" + "\u9fff" + "]"
_TERM_RE = re.compile("[A-Za-z0-9_]+|" + _CJK_RANGE)


def _split_terms(text: str) -> list[str]:
    return [m.group(0) for m in _TERM_RE.finditer(text or "")]


def _connect() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH))
    conn.execute(
        """CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'fact',
            source TEXT NOT NULL DEFAULT 'chat',
            created_at REAL NOT NULL
        )"""
    )
    conn.commit()
    return conn


class MemoryStore:
    """成长记忆的持久化与召回。"""

    def add(self, text: str, category: str = "fact", source: str = "chat") -> int:
        text = (text or "").strip()
        if not text:
            return -1
        with _lock, _connect() as conn:
            cur = conn.execute(
                "INSERT INTO memories(text, category, source, created_at) VALUES (?,?,?,?)",
                (text, category, source, time.time()),
            )
            conn.commit()
            return cur.lastrowid

    def recall(self, query: str, limit: int = 8) -> list[dict[str, Any]]:
        """召回与查询相关的记忆。

        把查询拆成词/字片段，要求全部出现在某条记忆中（AND，顺序无关），
        对中文记忆检索稳健。
        """
        query = (query or "").strip()
        if not query:
            return []
        terms = _split_terms(query)
        if not terms:
            return []
        clauses = " AND ".join(["m.text LIKE ?"] * len(terms))
        params: list[Any] = [f"%{t}%" for t in terms]
        params.append(limit)
        with _lock, _connect() as conn:
            rows = conn.execute(
                f"SELECT m.id, m.text, m.category, m.source FROM memories m "
                f"WHERE {clauses} ORDER BY id DESC LIMIT ?",
                params,
            ).fetchall()
            return [
                {"id": r[0], "text": r[1], "category": r[2], "source": r[3]} for r in rows
            ]

    def list_all(self, limit: int = 300) -> list[dict[str, Any]]:
        with _lock, _connect() as conn:
            rows = conn.execute(
                "SELECT id, text, category, source, created_at FROM memories "
                "ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [
                {
                    "id": r[0],
                    "text": r[1],
                    "category": r[2],
                    "source": r[3],
                    "created_at": r[4],
                }
                for r in rows
            ]

    def delete(self, mid: int) -> bool:
        with _lock, _connect() as conn:
            conn.execute("DELETE FROM memories WHERE id=?", (mid,))
            conn.commit()
            return True

    def count(self) -> int:
        with _lock, _connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]

    def clear(self) -> None:
        with _lock, _connect() as conn:
            conn.execute("DELETE FROM memories")
            conn.commit()


memory_store = MemoryStore()


EXTRACTION_PROMPT = """你是一个记忆抽取器。从下面的对话片段中提取值得长期记住的「用户相关信息」。
只抽取：用户明确表达的偏好、个人事实、对某事的纠正/反馈、长期有效的约定。
不要抽取临时闲聊、一次性问答、或可从上下文直接推得的常识。
输出严格的 JSON 数组，每个元素为 {"text": "记忆内容", "category": "preference|fact|feedback|rule"}。
如果没有值得记住的内容，输出空数组 []。
只输出 JSON，不要任何其他文字。

对话片段：
{conversation}
"""


async def extract_memories_async(
    conversation: str, llm_stream_fn: Any
) -> list[dict[str, Any]]:
    """用 LLM 从对话片段抽取记忆。

    llm_stream_fn(messages) 需返回一个 async iterator，yield str（或与 _llm_stream 同契约）。
    """
    messages = [
        {"role": "system", "content": "你是记忆抽取器，只输出 JSON 数组。"},
        {"role": "user", "content": EXTRACTION_PROMPT.replace("{conversation}", conversation)},
    ]
    raw = ""
    try:
        async for chunk in llm_stream_fn(messages):
            if isinstance(chunk, str):
                raw += chunk
    except Exception as exc:  # noqa: BLE001
        log.warning("记忆抽取 LLM 调用失败: %s", exc)
        return []

    raw = raw.strip()
    start = raw.find("[")
    end = raw.rfind("]")
    if start == -1 or end == -1:
        return []
    try:
        items = json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return []

    result: list[dict[str, Any]] = []
    for it in items:
        if isinstance(it, dict) and it.get("text"):
            result.append(
                {"text": str(it["text"]).strip(), "category": it.get("category", "fact")}
            )
    return result
