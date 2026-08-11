"""统一记忆服务（core.brain 门面）。

这是整个记忆系统的「唯一真相来源」入口，所有读写都收口于此：
- 前端（设置页/记忆页）通过 Hermes Gateway WebSocket 调用本服务；
- Gateway 在对话时调用 build_injection_prompt 注入 LLM，调用 extract_and_store 沉淀记忆；
- 旧的 hermes_gateway_memory（memories.db）通过 migrate_legacy_memories 一次性并入。

设计要点：
- 存储 = core.brain.store.MemoryStore（SQLite + 向量列）；
- 检索 = core.brain.librarian.Librarian（向量 + 关键词 + 重要性融合）；
- 抽取 = core.brain.scribe.Scribe（离线规则，无需网络/模型）；
- 向量 = core.brain.embedding.LocalHashEmbedder（纯 Python，离线）；
- 本模块不再引入任何重型依赖。
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
from pathlib import Path
from typing import Any, Callable

from .embedding import Embedder, get_default_embedder
from .fragment import (
    CATEGORY_FACT,
    CATEGORY_FEEDBACK,
    CATEGORY_PREFERENCE,
    CATEGORY_RULE,
    SOURCE_CHAT,
    SOURCE_MIGRATION,
    SOURCE_UI,
    MemoryFragment,
)
from .librarian import Librarian
from .scribe import ExtractionConfig, Scribe
from .store import MemoryStore, get_db_path

logger = logging.getLogger("core.brain.memory_service")


# 旧 hermes_gateway_memory 的抽取提示（保留以兼容历史抽取质量）
EXTRACTION_PROMPT = """你是一个记忆抽取器。从下面的对话片段中提取值得长期记住的「用户相关信息」。
只抽取：用户明确表达的偏好、个人事实、对某事的纠正/反馈、长期有效的约定。
不要抽取临时闲聊、一次性问答、或可从上下文直接推得的常识。
输出严格的 JSON 数组，每个元素为 {"text": "记忆内容", "category": "preference|fact|feedback|rule"}。
如果没有值得记住的内容，输出空数组 []。
只输出 JSON，不要任何其他文字。

对话片段：
{conversation}
"""


# 模块级服务缓存：key=(character_id, user_id) -> MemoryService
_service_cache: dict[tuple[str, str], "MemoryService"] = {}
_service_cache_lock = threading.Lock()


def get_memory_service(character_id: str = "default", user_id: str = "default") -> "MemoryService":
    """获取（并缓存）指定角色/用户的记忆服务实例。"""
    key = (character_id or "default", user_id or "default")
    with _service_cache_lock:
        svc = _service_cache.get(key)
        if svc is None:
            svc = MemoryService(character_id=key[0], user_id=key[1])
            _service_cache[key] = svc
        return svc


def reset_memory_service_cache() -> None:
    """清空服务缓存（测试 / 角色切换时可选调用）。"""
    with _service_cache_lock:
        _service_cache.clear()


class MemoryService:
    """统一记忆服务门面。"""

    def __init__(
        self,
        character_id: str = "default",
        user_id: str = "default",
        embedder: Embedder | None = None,
        top_k: int = 5,
    ):
        self.character_id = character_id or "default"
        self.user_id = user_id or "default"
        self.store = MemoryStore(character_id=self.character_id, user_id=self.user_id)
        self.embedder = embedder or get_default_embedder()
        self.librarian = Librarian(store=self.store, embedder=self.embedder, top_k=top_k)
        self._scribe = Scribe(store=self.store, config=ExtractionConfig())

    # ============================================================
    # CRUD
    # ============================================================

    def add_memory(
        self,
        content: str,
        *,
        category: str = CATEGORY_FACT,
        source: str = SOURCE_UI,
        enabled: bool = True,
        importance: float = 0.5,
        is_permanent: bool = False,
        client_ref: str = "",
        meta: dict | None = None,
    ) -> dict[str, Any]:
        """新增（或按 client_ref 幂等更新）一条记忆，返回 API 字典。

        当提供 client_ref 时改为 upsert：内容相同引用只会产生一条记忆，
        重连/重试不会重复入库。
        """
        if client_ref:
            return self.upsert_memory(
                content,
                client_ref=client_ref,
                category=category,
                source=source,
                enabled=enabled,
                importance=importance,
                is_permanent=is_permanent,
                meta=meta,
            )
        content = (content or "").strip()
        if not content:
            raise ValueError("content 不能为空")
        frag = MemoryFragment(
            content=content,
            category=category,
            source=source,
            enabled=enabled,
            importance=max(0.0, min(1.0, importance)),
            is_permanent=is_permanent,
            client_ref=client_ref or "",
            meta=meta or {},
            character_id=self.character_id,
            user_id=self.user_id,
        )
        frag.embedding = self.embedder.embed(content)
        saved = self.store.add(frag)
        return saved.to_api_dict()

    def upsert_memory(
        self,
        content: str,
        *,
        client_ref: str,
        category: str = CATEGORY_FACT,
        source: str = SOURCE_UI,
        enabled: bool = True,
        importance: float = 0.5,
        is_permanent: bool = False,
        meta: dict | None = None,
    ) -> dict[str, Any]:
        """按 client_ref 更新；不存在则新增。返回最终 API 字典。"""
        if not client_ref:
            raise ValueError("upsert 必须提供 client_ref")
        content = (content or "").strip()
        if not content:
            raise ValueError("content 不能为空")
        frag = MemoryFragment(
            content=content,
            category=category,
            source=source,
            enabled=enabled,
            importance=max(0.0, min(1.0, importance)),
            is_permanent=is_permanent,
            client_ref=client_ref,
            meta=meta or {},
            character_id=self.character_id,
            user_id=self.user_id,
        )
        frag.embedding = self.embedder.embed(content)
        saved = self.store.upsert_by_client_ref(frag)
        return saved.to_api_dict()

    def list_memories(
        self,
        *,
        category: str | None = None,
        source: str | None = None,
        enabled: bool | None = None,
        is_permanent: bool | None = None,
    ) -> list[dict[str, Any]]:
        """列出记忆（按过滤条件）。返回 API 字典列表。"""
        frags = self.store.list_by_filter(
            category=category, source=source, enabled=enabled, is_permanent=is_permanent
        )
        return [f.to_api_dict() for f in frags]

    def update_memory(self, frag_id: int, **fields) -> dict[str, Any] | None:
        """按字段更新记忆。若更新了 content，同步重算向量。"""
        if "content" in fields and fields["content"] is not None:
            fields["content"] = str(fields["content"]).strip()
        updated = self.store.update(frag_id, **fields)
        if updated is None:
            return None
        if "content" in fields and fields["content"]:
            emb = self.embedder.embed(updated.content)
            self.store.update_embedding(updated.id, emb)
        return updated.to_api_dict()

    def set_enabled(self, frag_id: int, enabled: bool) -> dict[str, Any] | None:
        """切换启用状态（主要用于规则）。"""
        return self.update_memory(frag_id, enabled=enabled)

    def set_permanent(self, frag_id: int, is_permanent: bool) -> dict[str, Any] | None:
        """切换永久标志。"""
        return self.update_memory(frag_id, is_permanent=is_permanent)

    def delete_memory(self, frag_id: int) -> bool:
        """按 id 删除。"""
        return self.store.delete(frag_id)

    def delete_by_client_ref(self, client_ref: str) -> bool:
        """按 client_ref 删除（前端删除条目时同步）。"""
        return self.store.delete_by_client_ref(client_ref)

    # ============================================================
    # 注入（LLM system prompt 构造）
    # ============================================================

    def build_injection_prompt(self, query: str = "", top_k: int | None = None) -> str:
        """构造注入 LLM 的记忆文本块。

        优先级（始终注入 → 相关召回）：
        1. 【约定规则】启用中的规则（最高优先，跨对话恒定生效）
        2. 【用户偏好】启用中的偏好
        3. 【用户反馈】启用中的反馈
        4. 【相关记忆】基于 query 的语义召回（排除上述已注入类别，避免重复）
        """
        blocks: list[str] = []

        rules = self.store.list_enabled_rules()
        if rules:
            lines = ["【约定规则】"]
            for i, r in enumerate(rules, 1):
                lines.append(f"{i}. {r.content}")
            blocks.append("\n".join(lines))

        prefs = self.store.list_by_filter(category=CATEGORY_PREFERENCE, enabled=True)
        if prefs:
            lines = ["【用户偏好】"]
            for i, p in enumerate(prefs, 1):
                lines.append(f"{i}. {p.content}")
            blocks.append("\n".join(lines))

        feedbacks = self.store.list_by_filter(category=CATEGORY_FEEDBACK, enabled=True)
        if feedbacks:
            lines = ["【用户反馈】"]
            for i, f in enumerate(feedbacks, 1):
                lines.append(f"{i}. {f.content}")
            blocks.append("\n".join(lines))

        if query and query.strip():
            tk = top_k or self.librarian.top_k
            try:
                results = self.librarian.search(query.strip(), top_k=tk)
            except Exception as exc:  # noqa: BLE001
                logger.warning("记忆语义召回失败: %s", exc)
                results = []
            related = [
                r
                for r in results
                if r.fragment.category not in (CATEGORY_RULE, CATEGORY_PREFERENCE, CATEGORY_FEEDBACK)
            ]
            if related:
                lines = ["【相关记忆】"]
                for i, r in enumerate(related, 1):
                    marker = "（永久）" if r.fragment.is_permanent else ""
                    lines.append(f"{i}. {r.fragment.content}{marker}")
                blocks.append("\n".join(lines))

        return "\n\n".join(blocks)

    # ============================================================
    # 抽取（对话 → 记忆）
    # ============================================================

    def extract_and_store(
        self,
        user_text: str,
        assistant_text: str = "",
        *,
        llm_fn: Callable[[list[dict[str, str]],], str] | None = None,
        use_llm: bool = False,
    ) -> list[dict[str, Any]]:
        """从一轮对话中抽取并保存记忆（离线优先）。

        Args:
            user_text: 用户输入
            assistant_text: 助手回复（可选，提升抽取质量）
            llm_fn: 可选同步 LLM 调用 (messages) -> str；提供时且 use_llm=True 启用 LLM 抽取
            use_llm: 是否启用 LLM 抽取（默认 False，使用离线规则抽取）

        Returns:
            已保存记忆的 API 字典列表
        """
        items: list[dict[str, Any]] = []
        if use_llm and llm_fn is not None:
            try:
                items = self._extract_with_llm(user_text, assistant_text, llm_fn)
            except Exception as exc:  # noqa: BLE001
                logger.warning("LLM 抽取失败，回退规则抽取: %s", exc)
                items = []

        if not items:
            # 离线规则抽取（无网络/模型依赖，稳定可用）
            try:
                frags = self._scribe.extract_from_exchange(user_text, assistant_text)
                items = [
                    {
                        "content": f.content,
                        "category": f.category or CATEGORY_FACT,
                        "importance": f.importance,
                        "is_permanent": f.is_permanent,
                    }
                    for f in frags
                ]
            except Exception as exc:  # noqa: BLE001
                logger.warning("规则抽取失败: %s", exc)
                return []

        saved: list[dict[str, Any]] = []
        for it in items:
            content = str(it.get("content") or "").strip()
            if not content:
                continue
            # 内容去重：避免空闲自学习重跑或重复对话轮次产生重复记忆
            if self.store.has_identical_content(content, self.character_id, self.user_id):
                continue
            frag = MemoryFragment(
                content=content,
                category=str(it.get("category", CATEGORY_FACT)),
                source=SOURCE_CHAT,
                importance=max(0.0, min(1.0, float(it.get("importance", 0.5)))),
                is_permanent=bool(it.get("is_permanent", False)),
                character_id=self.character_id,
                user_id=self.user_id,
            )
            frag.embedding = self.embedder.embed(content)
            saved.append(self.store.add(frag).to_api_dict())
        return saved

    def _extract_with_llm(
        self,
        user_text: str,
        assistant_text: str,
        llm_fn: Callable[[list[dict[str, str]]], str],
    ) -> list[dict[str, Any]]:
        conversation = f"用户：{user_text}\n助手：{assistant_text}" if assistant_text else f"用户：{user_text}"
        prompt = EXTRACTION_PROMPT.replace("{conversation}", conversation)
        raw = llm_fn(
            [
                {"role": "system", "content": "你是记忆抽取器，只输出 JSON 数组。"},
                {"role": "user", "content": prompt},
            ]
        )
        return self._parse_llm_items(raw)

    @staticmethod
    def _parse_llm_items(raw: str) -> list[dict[str, Any]]:
        raw = (raw or "").strip()
        if not raw:
            return []
        start = raw.find("[")
        end = raw.rfind("]")
        if start == -1 or end == -1:
            return []
        try:
            items = json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            return []
        if not isinstance(items, list):
            return []
        result: list[dict[str, Any]] = []
        for it in items:
            if isinstance(it, dict) and it.get("text"):
                result.append(
                    {
                        "content": str(it["text"]).strip(),
                        "category": str(it.get("category", CATEGORY_FACT)),
                        "importance": float(it.get("importance", 0.5)),
                        "is_permanent": bool(it.get("is_permanent", False)),
                    }
                )
        return result

    # ============================================================
    # 迁移（旧 hermes_gateway_memory → brain）
    # ============================================================

    def migrate_legacy_memories(self, legacy_db_path: str | Path | None = None) -> int:
        """将旧 hermes_gateway_memory（memories.db）一次性并入 brain。

        按内容去重，避免重复。返回迁移条数。
        """
        legacy_db_path = Path(legacy_db_path) if legacy_db_path else (get_db_path().parent / "memories.db")
        if not legacy_db_path.exists():
            logger.info("未找到旧记忆库 %s，跳过迁移", legacy_db_path)
            return 0

        existing_contents = {f.content for f in self.store.list_all(limit=10000)}
        migrated = 0
        try:
            conn = sqlite3.connect(str(legacy_db_path))
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT text, category, source FROM memories ORDER BY id ASC"
            ).fetchall()
            conn.close()
        except sqlite3.Error as exc:
            logger.warning("读取旧记忆库失败: %s", exc)
            return 0

        permanent_cats = {CATEGORY_PREFERENCE, CATEGORY_RULE}
        for row in rows:
            text = (row["text"] or "").strip()
            if not text or text in existing_contents:
                continue
            category = str(row["category"] or CATEGORY_FACT)
            try:
                self.add_memory(
                    text,
                    category=category,
                    source=SOURCE_MIGRATION,
                    is_permanent=category in permanent_cats,
                    enabled=True,
                )
                existing_contents.add(text)
                migrated += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning("迁移单条记忆失败: %s", exc)
        logger.info("旧记忆迁移完成：%d 条", migrated)
        return migrated
