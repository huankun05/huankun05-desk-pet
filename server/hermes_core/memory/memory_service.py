"""统一记忆服务（core.brain 门面）。

这是整个记忆系统的「唯一真相来源」入口，所有读写都收口于此：
- 前端（设置页/记忆页）通过 Hermes Gateway WebSocket 调用本服务；
- Gateway 在对话时调用 build_injection_prompt 注入 LLM，调用 extract_and_store 沉淀记忆；

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
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Callable

from .embedding import Embedder, get_default_embedder
from .fragment import (
    CATEGORY_FACT,
    CATEGORY_FEEDBACK,
    CATEGORY_EVENT,
    CATEGORY_PERSONA,
    CATEGORY_PREFERENCE,
    CATEGORY_RAW,
    CATEGORY_RULE,
    CATEGORY_SCENE,
    LAYER_L0,
    LAYER_L1,
    LAYER_L2,
    LAYER_L3,
    SOURCE_CHAT,
    SOURCE_MIGRATION,
    SOURCE_UI,
    MemoryFragment,
)
from .librarian import Librarian
from .scribe import ExtractionConfig, Scribe
from .store import MemoryStore, get_db_path

logger = logging.getLogger("core.brain.memory_service")

# ----- 分层记忆自动化阈值（借鉴 TencentDB Agent Memory 的 L0-L3 金字塔）-----
# 注入总字符预算（对齐前端 UnifiedMemoryStage 的 LONG_TERM_BUDGET）
INJECTION_BUDGET = 1800
# 空闲自学习累计多少条新 L1 记忆后触发一次场景/画像自动生成
SCENE_EVERY = 8
PERSONA_EVERY = 25
# 单次场景聚合最少需要的未归类 L1 数量
SCENE_MIN_MEMBERS = 2
# 场景聚类时视为「无信息量」的通用令牌（会被排除在话题标签之外）
GENERIC_TOKENS = {
    "用户", "我", "的", "是", "喜欢", "讨厌", "不爱", "不吃", "也", "每天",
    "明天", "计划", "名字", "记", "好", "让", "能", "会", "想", "要", "对",
    "在", "有", "不", "就", "都", "还", "和", "与", "及",
}
# 离线画像/场景的字符上限（白盒文件 + 注入用）
PERSONA_MAX_CHARS = 1200
SCENE_MAX_CHARS = 300
# 自动生成元信息持久化文件
AUTOGEN_META_FILE = "memory_autogen.json"
# L0 回退阈值：L1 相关记忆不足该数量时，回退检索 L0 原始对话（可观测、可调）
L0_FALLBACK_MIN_L1 = 2

# L3 用户画像生成提示（白盒、四章、≤1200 字，借鉴 TencentDB persona.md）
PERSONA_PROMPT = """你正在为一位桌面 AI 伴侣（桌宠）生成「用户长期画像」，用于让角色快速进入用户上下文。
请基于提供的记忆点，输出一份简洁的 Markdown 用户画像，控制在 1200 字以内，严格包含四章：

## 基础锚点
用户稳定的身份/角色/所处阶段（如学生、职业、常住地等，仅在记忆明确提及时写）。

## 兴趣图谱
用户的长期偏好、爱好、口味、常用工具/技术。

## 交互协议
用户明确表达过的回复风格/语言/约定（如：用简体中文、回答要简短）。

## 认知内核
用户对事物的价值观、强观点、反复出现的关注点。

规则：
- 只写记忆中明确支撑的内容，不要编造。
- 用第三人称、客观、条目化。
- 若某章无信息，写「（暂无足够记忆）」。
- 只输出 Markdown 正文，不要外层代码块。

记忆点如下：
{memory_points}
"""


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
        self.last_injection: dict | None = None

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

    def build_injection_prompt(self, query: str = "", top_k: int | None = None, budget: int = INJECTION_BUDGET) -> str:
        """构造注入 LLM 的记忆文本块（借鉴 TencentDB Agent Memory 的分层召回）。

        分层召回策略（始终注入 → 相关召回 → 必要时回退）：
        1. 【用户画像 L3】长期稳定的用户画像（始终注入，最高优先）
        2. 【当前场景 L2】最近活跃的场景块（始终注入，提供话题上下文）
        3. 【约定规则】启用中的规则（始终注入，跨对话恒定生效）
        4. 【用户偏好】启用中的偏好（始终注入）
        5. 【用户反馈】启用中的反馈（始终注入）
        6. 【相关记忆 L1】基于 query 的语义召回（按预算注入）
        7. 【原始对话片段 L0】仅当 L1 证据不足且用户追问时回退检索

        L3/L2/规则/偏好/反馈始终注入（它们体量小且价值高）；L1 与 L0 受
        budget 约束，避免撑爆 prompt。执行后把本次选中记忆 id 写入
        self.last_injection 并 append 到 data/memory_injections.jsonl。
        """
        blocks: list[str] = []
        selected_ids: list[int] = []
        used = 0

        def _emit(lines: list[str]) -> None:
            nonlocal used
            text = "\n".join(lines)
            blocks.append(text)
            used += len(text) + 2

        def _fits(text: str) -> bool:
            return used + len(text) + 2 <= budget

        # 1. L3 用户画像（始终）
        persona = self._get_active_persona()
        if persona is not None:
            _emit(["【用户画像 L3】", persona.content])
            selected_ids.append(persona.id)

        # 2. L2 当前场景（始终，最近活跃的前 2 个）
        scenes = self._get_active_scenes(limit=2)
        if scenes:
            lines = ["【当前场景 L2】"]
            for s in scenes:
                lines.append(f"- {s.content}")
            _emit(lines)
            selected_ids.extend(s.id for s in scenes)

        # 3. 约定规则（始终）
        rules = self.store.list_enabled_rules()
        if rules:
            lines = ["【约定规则】"]
            for i, r in enumerate(rules, 1):
                lines.append(f"{i}. {r.content}")
            _emit(lines)
            selected_ids.extend(r.id for r in rules)

        # 4. 用户偏好（始终）
        prefs = self.store.list_by_filter(category=CATEGORY_PREFERENCE, enabled=True)
        if prefs:
            lines = ["【用户偏好】"]
            for i, p in enumerate(prefs, 1):
                lines.append(f"{i}. {p.content}")
            _emit(lines)
            selected_ids.extend(p.id for p in prefs)

        # 5. 用户反馈（始终）
        feedbacks = self.store.list_by_filter(category=CATEGORY_FEEDBACK, enabled=True)
        if feedbacks:
            lines = ["【用户反馈】"]
            for i, f in enumerate(feedbacks, 1):
                lines.append(f"{i}. {f.content}")
            _emit(lines)
            selected_ids.extend(f.id for f in feedbacks)

        # 6/7. 按 query 召回 L1；不足则回退 L0（受预算约束）
        if query and query.strip():
            tk = top_k or self.librarian.top_k
            try:
                results = self.librarian.search(query.strip(), top_k=tk, layer=LAYER_L1)
            except Exception as exc:  # noqa: BLE001
                logger.warning("记忆语义召回失败: %s", exc)
                results = []
            related = [
                r
                for r in results
                if r.fragment.category
                not in (
                    CATEGORY_RULE,
                    CATEGORY_PREFERENCE,
                    CATEGORY_FEEDBACK,
                    CATEGORY_PERSONA,
                    CATEGORY_SCENE,
                    CATEGORY_EVENT,  # 事件为瞬时活动，不跨对话稳定召回，避免噪声
                )
            ]
            if len(related) >= L0_FALLBACK_MIN_L1:
                lines = ["【相关记忆 L1】"]
                for r in related:
                    marker = "（永久）" if r.fragment.is_permanent else ""
                    lines.append(f"- {r.fragment.content}{marker}")
                if _fits("\n".join(lines)):
                    _emit(lines)
                    selected_ids.extend(r.fragment.id for r in related)
            else:
                # L1 证据不足：回退检索 L0 原始对话（始终可观测）
                if related:
                    logger.debug(
                        "L1 相关记忆不足（%d<%d），回退检索 L0 原始对话",
                        len(related),
                        L0_FALLBACK_MIN_L1,
                    )
                l0 = self._recall_l0(query, limit=3)
                if l0:
                    lines = ["【原始对话片段 L0】"]
                    for frag in l0:
                        lines.append(f"- {frag.content[:200]}")
                    if _fits("\n".join(lines)):
                        _emit(lines)
                        selected_ids.extend(f.id for f in l0)

        prompt = "\n\n".join(blocks)

        # 记录溯源（可审计）
        self.last_injection = {
            "ts": int(time.time() * 1000),
            "query": query,
            "selected_ids": selected_ids,
            "block_count": len(blocks),
        }
        self._append_injection_log(self.last_injection)

        return prompt

    # ----------------------------------------------------------------
    # 分层检索辅助
    # ----------------------------------------------------------------

    def _get_active_persona(self) -> MemoryFragment | None:
        """取当前作用域下最新的 L3 用户画像（应仅有一条）。"""
        try:
            personas = self.store.list_by_filter(category=CATEGORY_PERSONA, limit=5)
        except Exception:  # noqa: BLE001
            return None
        if not personas:
            return None
        return max(personas, key=lambda f: f.updated_at)

    def _get_active_scenes(self, limit: int = 2) -> list[MemoryFragment]:
        """取当前作用域下最近活跃的场景块（L2）。"""
        try:
            scenes = self.store.list_by_filter(category=CATEGORY_SCENE, limit=limit)
        except Exception:  # noqa: BLE001
            return []
        return scenes

    def _recall_l0(self, query: str, limit: int = 3) -> list[MemoryFragment]:
        """按 query 回退检索 L0 原始对话片段。"""
        try:
            results = self.librarian.search(query.strip(), top_k=limit, layer=LAYER_L0)
        except Exception as exc:  # noqa: BLE001
            logger.debug("L0 回退检索失败（忽略）: %s", exc)
            return []
        return [r.fragment for r in results]

    def get_last_injection(self) -> dict | None:
        """返回最近一次 build_injection_prompt 的溯源信息（选中记忆 id 等）。"""
        return getattr(self, "last_injection", None)

    def _append_injection_log(self, record: dict) -> None:
        """把注入溯源 append 到 data/memory_injections.jsonl（only-append，best-effort）。"""
        try:
            db_dir = Path(get_db_path()).parent
            db_dir.mkdir(parents=True, exist_ok=True)
            log_path = db_dir / "memory_injections.jsonl"
            with log_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        except Exception as exc:  # noqa: BLE001
            logger.debug("记忆注入溯源落盘失败（忽略）: %s", exc)

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
            已保存的 L1 原子记忆的 API 字典列表（L0 原始对话落盘为副作用，不返回）
        """
        # L0：先把本轮原始对话落盘（分层金字塔底座，供必要时回退检索）
        if user_text and assistant_text:
            self._store_raw_exchange(user_text, assistant_text)

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
                        "mem_type": getattr(f, "mem_type", ""),
                        "layer": getattr(f, "layer", LAYER_L1),
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
                mem_type=str(it.get("mem_type", "")),
                layer=str(it.get("layer", LAYER_L1)),
                character_id=self.character_id,
                user_id=self.user_id,
            )
            frag.embedding = self.embedder.embed(content)
            saved.append(self.store.add(frag).to_api_dict())
        return saved

    def _store_raw_exchange(self, user_text: str, assistant_text: str) -> None:
        """把一轮原始对话作为 L0 记忆落盘（去重 + 保留上限，防止无限增长）。"""
        raw = f"用户：{user_text}\n助手：{assistant_text}".strip()
        if len(raw) > 2000:
            raw = raw[:2000] + "…"
        if self.store.has_identical_content(raw, self.character_id, self.user_id):
            return
        frag = MemoryFragment(
            content=raw,
            category=CATEGORY_RAW,
            source=SOURCE_CHAT,
            importance=0.2,
            layer=LAYER_L0,
            character_id=self.character_id,
            user_id=self.user_id,
        )
        frag.embedding = self.embedder.embed(raw)
        self.store.add(frag)
        try:
            self.store.prune_old_l0(keep=self._scribe.config.l0_keep)
        except Exception as exc:  # noqa: BLE001
            logger.debug("L0 裁剪失败（可忽略）: %s", exc)

    # ----------------------------------------------------------------
    # 自动分层生成（L2 场景 / L3 画像）—— 由空闲自学习调度器节流触发
    # ----------------------------------------------------------------

    def maybe_autogenerate(self, new_count: int = 0, llm_fn=None, use_llm: bool = False) -> None:
        """累计新 L1 记忆达阈值后，自动聚合 L2 场景与 L3 画像。

        场景与画像使用独立计数器，互不影响触发节奏。全部离线可用：
        无 LLM 时走离线聚合；有 LLM 时优先用 LLM 提升摘要质量。
        """
        meta = self._autogen_meta()
        meta["pending_scene"] = int(meta.get("pending_scene", 0)) + int(new_count or 0)
        meta["pending_persona"] = int(meta.get("pending_persona", 0)) + int(new_count or 0)
        fired = False
        if meta["pending_scene"] >= SCENE_EVERY:
            try:
                self.generate_scene(llm_fn=llm_fn, use_llm=use_llm)
                fired = True
            except Exception as exc:  # noqa: BLE001
                logger.warning("L2 场景自动生成失败: %s", exc)
            meta["pending_scene"] = 0
        if meta["pending_persona"] >= PERSONA_EVERY:
            try:
                self.generate_persona(llm_fn=llm_fn, use_llm=use_llm)
                fired = True
            except Exception as exc:  # noqa: BLE001
                logger.warning("L3 画像自动生成失败: %s", exc)
            meta["pending_persona"] = 0
        if fired or new_count:
            self._autogen_meta_save(meta)

    def _collect_l1_for_autogen(self) -> list[MemoryFragment]:
        """收集可供聚合的 L1 原子记忆（fact/preference/feedback/event，非永久）。"""
        try:
            l1 = self.store.list_by_layer(LAYER_L1)
        except Exception:  # noqa: BLE001
            return []
        return [
            f
            for f in l1
            if f.category
            in (CATEGORY_FACT, CATEGORY_PREFERENCE, CATEGORY_FEEDBACK, CATEGORY_EVENT)
            and not f.is_permanent
        ]

    def generate_scene(self, llm_fn=None, use_llm: bool = False) -> dict[str, Any] | None:
        """把未归类的 L1 记忆按共享话题聚合成 L2 场景块（离线优先，可选 LLM 摘要）。"""
        l1 = self._collect_l1_for_autogen()
        unassigned = [f for f in l1 if not f.meta.get("scene_id")]
        if len(unassigned) < SCENE_MIN_MEMBERS:
            return None

        # 轻量聚类：按「共享令牌」把 L1 聚到同一话题。排除通用令牌
        # （如「用户/我/经常」），否则模板化事实会因共有前缀被错误并为一簇。
        token_map: dict[str, list[MemoryFragment]] = {}
        for f in unassigned:
            for tok in {
                t
                for t in self.librarian._tokenize(f.content)
                if len(t) >= 2 and t not in GENERIC_TOKENS
            }:
                token_map.setdefault(tok, []).append(f)

        created: list[MemoryFragment] = []
        assigned: set[int] = set()
        for tok in sorted(token_map, key=lambda k: -len(token_map[k])):
            members = [f for f in token_map[tok] if f.id not in assigned]
            if len(members) < SCENE_MIN_MEMBERS:
                continue
            members = members[:6]
            topic = self._pick_topic(members, tok)
            summary = self._summarize_scene(members, topic, llm_fn, use_llm)
            frag = MemoryFragment(
                content=summary[:SCENE_MAX_CHARS],
                category=CATEGORY_SCENE,
                layer=LAYER_L2,
                importance=0.6,
                source=SOURCE_CHAT,
                meta={
                    "topic": topic,
                    "member_ids": [m.id for m in members],
                    "generated_at": int(time.time() * 1000),
                },
                character_id=self.character_id,
                user_id=self.user_id,
            )
            frag.embedding = self.embedder.embed(summary)
            saved = self.store.add(frag)
            for m in members:
                m.meta = dict(m.meta)
                m.meta["scene_id"] = saved.id
                try:
                    self.store.update(m.id, meta=m.meta)
                except Exception:  # noqa: BLE001
                    pass
                assigned.add(m.id)
            created.append(saved)

        if created:
            self._write_scenes_file()
        return created[0].to_api_dict() if created else None

    def _pick_topic(self, members: list[MemoryFragment], fallback: str) -> str:
        """从一组 L1 记忆中挑选最有信息量的话题词（跳过通用前缀令牌）。

        优先取所有成员共有、且非通用的令牌；否则取全体成员中
        最长且非通用的令牌；都失败则回退到聚类驱动令牌。
        """
        toksets = [set(self.librarian._tokenize(m.content)) for m in members]
        if not toksets:
            return fallback
        common = set.intersection(*toksets)
        candidates = [t for t in common if len(t) >= 2 and t not in GENERIC_TOKENS]
        if candidates:
            return max(candidates, key=len)
        all_t = set().union(*toksets)
        cand2 = [t for t in all_t if len(t) >= 2 and t not in GENERIC_TOKENS]
        if cand2:
            return max(cand2, key=len)
        return fallback

    def _summarize_scene(
        self, members: list[MemoryFragment], topic: str, llm_fn=None, use_llm: bool = False
    ) -> str:
        """生成单个场景的摘要文本（LLM 优先，离线兜底）。"""
        if use_llm and llm_fn is not None:
            try:
                prompt = (
                    f"把以下关于「{topic}」的记忆点概括为一条话题摘要（≤80 字，客观、第三人称）：\n"
                    + "\n".join(f"- {m.content}" for m in members)
                )
                out = llm_fn([{"role": "user", "content": prompt}])
                out = (out or "").strip().strip('"').strip()
                if out:
                    return out
            except Exception:  # noqa: BLE001
                pass
        head = members[0].content
        return f"关于「{topic}」：{head}" + (f" 等 {len(members)} 条" if len(members) > 1 else "")

    def generate_persona(self, llm_fn=None, use_llm: bool = False) -> dict[str, Any] | None:
        """基于 L1/L2 生成一份长期用户画像 L3（白盒落盘 persona.md）。"""
        l1 = self._collect_l1_for_autogen()
        scenes = self.store.list_by_filter(category=CATEGORY_SCENE)
        prefs = [f.content for f in l1 if f.category == CATEGORY_PREFERENCE][:12]
        facts = [f.content for f in l1 if f.category in (CATEGORY_FACT, CATEGORY_EVENT)][:12]
        feedbacks = [f.content for f in l1 if f.category == CATEGORY_FEEDBACK][:8]
        scene_lines = [f.content for f in scenes][:6]

        content = self._build_persona(prefs, facts, feedbacks, scene_lines, llm_fn, use_llm)
        if not content.strip():
            return None

        # 仅保留一条最新画像：删除旧 persona
        for old in self.store.list_by_filter(category=CATEGORY_PERSONA):
            try:
                self.store.delete(old.id)
            except Exception:  # noqa: BLE001
                pass

        frag = MemoryFragment(
            content=content[:PERSONA_MAX_CHARS],
            category=CATEGORY_PERSONA,
            layer=LAYER_L3,
            is_permanent=True,
            importance=0.95,
            source=SOURCE_CHAT,
            meta={
                "generated_at": int(time.time() * 1000),
                "source": "llm" if (use_llm and llm_fn is not None) else "offline",
                "member_count": len(l1),
            },
            character_id=self.character_id,
            user_id=self.user_id,
        )
        frag.embedding = self.embedder.embed(content)
        saved = self.store.add(frag)
        self._write_persona_file(content[:PERSONA_MAX_CHARS])
        return saved.to_api_dict()

    def _build_persona(
        self,
        prefs: list[str],
        facts: list[str],
        feedbacks: list[str],
        scene_lines: list[str],
        llm_fn=None,
        use_llm: bool = False,
    ) -> str:
        """构造用户画像文本（LLM 优先，离线按四章拼装）。"""
        if use_llm and llm_fn is not None:
            try:
                points = []
                if prefs:
                    points += [f"[偏好] {p}" for p in prefs]
                if facts:
                    points += [f"[事实] {f}" for f in facts]
                if feedbacks:
                    points += [f"[反馈] {fb}" for fb in feedbacks]
                if scene_lines:
                    points += [f"[话题] {s}" for s in scene_lines]
                if points:
                    raw = llm_fn(
                        [
                            {"role": "system", "content": "你是用户画像生成器，只输出 Markdown。"},
                            {"role": "user", "content": PERSONA_PROMPT.replace("{memory_points}", "\n".join(points))},
                        ]
                    )
                    cleaned = self._clean_persona(raw)
                    if cleaned:
                        return cleaned
            except Exception:  # noqa: BLE001
                pass
        # 离线拼装
        lines = ["# 用户画像"]
        if prefs:
            lines += ["", "## 兴趣图谱"] + [f"- {p}" for p in prefs]
        if facts:
            lines += ["", "## 基础锚点 / 已知事实"] + [f"- {f}" for f in facts]
        if feedbacks:
            lines += ["", "## 交互协议 / 反馈"] + [f"- {fb}" for fb in feedbacks]
        if scene_lines:
            lines += ["", "## 常聊话题"] + [f"- {s}" for s in scene_lines]
        return "\n".join(lines) if len(lines) > 1 else "# 用户画像\n（暂无足够记忆）"

    @staticmethod
    def _clean_persona(raw: str) -> str:
        """清理 LLM 返回的画像文本（去掉代码块围栏、截断）。"""
        if not raw:
            return ""
        text = raw.strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
            text = re.sub(r"\n?```$", "", text)
        text = text.strip()
        return text[:PERSONA_MAX_CHARS]

    # ---- 白盒落盘（人可检查/修正）----
    def _write_persona_file(self, content: str) -> None:
        try:
            db_dir = Path(get_db_path()).parent
            db_dir.mkdir(parents=True, exist_ok=True)
            (db_dir / "memory_persona.md").write_text(content, encoding="utf-8")
        except Exception as exc:  # noqa: BLE001
            logger.debug("画像白盒文件写入失败（忽略）: %s", exc)

    def _write_scenes_file(self) -> None:
        try:
            scenes = self.store.list_by_filter(category=CATEGORY_SCENE)
            lines = ["# 场景记忆（L2）", "", "自动聚合的话题簇，可手动检查或修正。", ""]
            for s in scenes:
                topic = s.meta.get("topic", "") if isinstance(s.meta, dict) else ""
                lines.append(f"- {s.content}  _(topic: {topic})_")
            db_dir = Path(get_db_path()).parent
            db_dir.mkdir(parents=True, exist_ok=True)
            (db_dir / "memory_scenes.md").write_text("\n".join(lines), encoding="utf-8")
        except Exception as exc:  # noqa: BLE001
            logger.debug("场景白盒文件写入失败（忽略）: %s", exc)

    # ---- 自动生成元信息持久化 ----
    def _autogen_meta_path(self) -> Path:
        return Path(get_db_path()).parent / AUTOGEN_META_FILE

    def _autogen_meta(self) -> dict:
        try:
            p = self._autogen_meta_path()
            data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
        except Exception:  # noqa: BLE001
            data = {}
        return data.get(f"{self.character_id}:{self.user_id}", {"pending_scene": 0, "pending_persona": 0})

    def _autogen_meta_save(self, meta: dict) -> None:
        try:
            p = self._autogen_meta_path()
            data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
            data[f"{self.character_id}:{self.user_id}"] = meta
            p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        except Exception as exc:  # noqa: BLE001
            logger.debug("自动生成元信息保存失败（忽略）: %s", exc)

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
                        "mem_type": str(it.get("mem_type", "")),
                        "layer": str(it.get("layer", LAYER_L1)),
                    }
                )
            elif isinstance(it, dict) and it.get("content"):
                # 兼容较新格式的 content 字段
                result.append(
                    {
                        "content": str(it["content"]).strip(),
                        "category": str(it.get("category", CATEGORY_FACT)),
                        "importance": float(it.get("priority", it.get("importance", 0.5))),
                        "is_permanent": bool(it.get("is_permanent", False)),
                        "mem_type": str(it.get("mem_type", "")),
                        "layer": str(it.get("layer", LAYER_L1)),
                    }
                )
        return result

