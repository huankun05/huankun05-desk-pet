"""Scribe 记忆提取器。

从用户输入与助手回复中提取事实性记忆，生成 MemoryFragment。

设计原则：
- 默认使用轻量级规则提取，保证无网络、无模型也能工作
- 可选注入 LLM 客户端，启用更高质量的 AI 提取
- 只提取“值得长期保留”的事实：用户偏好、身份、重要约定、情感关系
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Callable

from .fragment import (
    LAYER_L1,
    MEM_TYPE_EPISODIC,
    MEM_TYPE_INSTRUCTION,
    MEM_TYPE_PERSONA,
    CATEGORY_EVENT,
    CATEGORY_FACT,
    CATEGORY_PREFERENCE,
    CATEGORY_RULE,
    MemoryFragment,
)
from .store import MemoryStore


@dataclass
class ExtractionConfig:
    """提取器配置。"""

    # 规则提取开关
    enable_rule_based: bool = True
    # LLM 提取开关
    enable_llm: bool = False
    # 单条记忆最大长度
    max_content_length: int = 200
    # 每次提取上限
    max_fragments_per_turn: int = 3
    # 最低重要性阈值
    min_importance: float = 0.3
    # L0 原始对话保留条数（每角色/用户）
    l0_keep: int = 200


class Scribe:
    """记忆抄写员：从对话中提炼事实性记忆。"""

    # 常见事实模式（中文）。
    # 每项：(正则, 模板, 重要性, 类别, 原子记忆子类型)。
    # 类别/子类型用于把抽取结果映射到 L1 原子记忆（借鉴 TencentDB 的
    # persona/episodic/instruction 三分法）。
    RULE_PATTERNS: list[tuple[re.Pattern, str, float, str, str]] = [
        # 用户身份（稳定属性 → persona）
        (re.compile(r"我(?:叫|是)\s*([^，。！？\n]{1,20})"), "用户的名字/身份是{}", 0.75, CATEGORY_FACT, MEM_TYPE_PERSONA),
        (re.compile(r"我的名字是\s*([^，。！？\n]{1,20})"), "用户的名字是{}", 0.8, CATEGORY_FACT, MEM_TYPE_PERSONA),
        # 喜好（偏好 → persona）
        (re.compile(r"我喜欢\s*([^，。！？\n]{1,30})"), "用户喜欢{}", 0.7, CATEGORY_PREFERENCE, MEM_TYPE_PERSONA),
        (re.compile(r"我喜欢吃\s*([^，。！？\n]{1,30})"), "用户喜欢吃{}", 0.72, CATEGORY_PREFERENCE, MEM_TYPE_PERSONA),
        (re.compile(r"我喜欢喝\s*([^，。！？\n]{1,30})"), "用户喜欢喝{}", 0.72, CATEGORY_PREFERENCE, MEM_TYPE_PERSONA),
        (re.compile(r"我爱\s*([^，。！？\n]{1,30})"), "用户喜欢/热爱{}", 0.7, CATEGORY_PREFERENCE, MEM_TYPE_PERSONA),
        (re.compile(r"我钟爱\s*([^，。！？\n]{1,30})"), "用户钟爱{}", 0.75, CATEGORY_PREFERENCE, MEM_TYPE_PERSONA),
        # 厌恶（偏好 → persona）
        (re.compile(r"我讨厌\s*([^，。！？\n]{1,30})"), "用户讨厌{}", 0.7, CATEGORY_PREFERENCE, MEM_TYPE_PERSONA),
        (re.compile(r"我不喜欢\s*([^，。！？\n]{1,30})"), "用户不喜欢{}", 0.68, CATEGORY_PREFERENCE, MEM_TYPE_PERSONA),
        (re.compile(r"我害怕\s*([^，。！？\n]{1,30})"), "用户害怕{}", 0.7, CATEGORY_PREFERENCE, MEM_TYPE_PERSONA),
        # 隐性习惯（无「喜欢/讨厌」动词，靠频率副词表达 → 偏好）
        (re.compile(r"我(?:每天|经常|平时|习惯|一般|通常)\s*([喝吃做去玩看听买][^，。！？\n]{1,15})"),
         "用户经常{}", 0.62, CATEGORY_PREFERENCE, MEM_TYPE_PERSONA),
        # 状态/计划（事件 → episodic）
        (re.compile(r"我今天\s*([^，。！？\n]{1,40})"), "用户今天{}", 0.6, CATEGORY_EVENT, MEM_TYPE_EPISODIC),
        (re.compile(r"我明天\s*([^，。！？\n]{1,40})"), "用户明天{}", 0.6, CATEGORY_EVENT, MEM_TYPE_EPISODIC),
        (re.compile(r"我计划\s*([^，。！？\n]{1,40})"), "用户计划{}", 0.65, CATEGORY_EVENT, MEM_TYPE_EPISODIC),
        (re.compile(r"我要\s*([^，。！？\n]{1,40})"), "用户打算{}", 0.6, CATEGORY_EVENT, MEM_TYPE_EPISODIC),
        # 关系/约定（规则 → instruction）
        (re.compile(r"(?:记住|别忘了)\s*([^，。！？\n]{1,40})"), "用户希望记住：{}", 0.78, CATEGORY_RULE, MEM_TYPE_INSTRUCTION),
        (re.compile(r"(?:答应我|约定)\s*([^，。□]{1,40})"), "用户约定的内容是：{}", 0.75, CATEGORY_RULE, MEM_TYPE_INSTRUCTION),
    ]

    def __init__(
        self,
        store: MemoryStore | None = None,
        llm_client: Any | None = None,
        config: ExtractionConfig | None = None,
    ):
        self.store = store or MemoryStore()
        self.llm_client = llm_client
        self.config = config or ExtractionConfig()

    def extract_from_exchange(
        self,
        user_text: str,
        assistant_text: str,
        context: str = "",
        emotion_snapshot: dict[str, float] | None = None,
    ) -> list[MemoryFragment]:
        """从一轮对话中提取记忆碎片。

        Args:
            user_text: 用户输入
            assistant_text: 助手回复
            context: 额外上下文（可选）
            emotion_snapshot: 提取时的情绪快照（可选）

        Returns:
            MemoryFragment 列表（未持久化）
        """
        fragments: list[MemoryFragment] = []

        if self.config.enable_llm and self.llm_client is not None:
            try:
                llm_frags = self._extract_with_llm(user_text, assistant_text, context)
                fragments.extend(llm_frags)
            except Exception as exc:
                import logging

                logging.getLogger("scribe").warning(f"LLM 提取失败，回退到规则提取: {exc}")

        if self.config.enable_rule_based and len(fragments) < self.config.max_fragments_per_turn:
            remaining = self.config.max_fragments_per_turn - len(fragments)
            rule_frags = self._extract_with_rules(user_text, remaining)
            fragments.extend(rule_frags)

        if emotion_snapshot:
            for frag in fragments:
                frag.emotion_snapshot = emotion_snapshot

        # 去重 + 截断
        return self._deduplicate_and_truncate(fragments)

    def save_fragments(self, fragments: list[MemoryFragment]) -> list[MemoryFragment]:
        """将提取到的碎片持久化到数据库。"""
        saved: list[MemoryFragment] = []
        for frag in fragments:
            saved.append(self.store.add(frag))
        return saved

    def reflect_and_save(
        self,
        user_text: str,
        assistant_text: str,
        context: str = "",
    ) -> list[MemoryFragment]:
        """提取并保存记忆（Pipeline 中调用）。"""
        fragments = self.extract_from_exchange(user_text, assistant_text, context)
        if not fragments:
            return []
        return self.save_fragments(fragments)

    def _extract_with_rules(self, text: str, max_count: int) -> list[MemoryFragment]:
        """基于正则模式提取记忆。"""
        fragments: list[MemoryFragment] = []
        for pattern, template, importance, category, mem_type in self.RULE_PATTERNS:
            for match in pattern.finditer(text):
                if len(fragments) >= max_count:
                    return fragments
                capture = match.group(1).strip()
                if not capture:
                    continue
                content = template.format(capture)
                content = self._truncate(content)
                fragments.append(
                    MemoryFragment(
                        content=content,
                        category=category,
                        importance=min(importance, 0.9),
                        layer=LAYER_L1,
                        mem_type=mem_type,
                    )
                )
        return fragments

    def _extract_with_llm(
        self,
        user_text: str,
        assistant_text: str,
        context: str = "",
    ) -> list[MemoryFragment]:
        """调用 LLM 提取事实性记忆。

        要求 LLM 返回 JSON 数组：
        [
          {"content": "...", "importance": 0.8},
          ...
        ]
        """
        if self.llm_client is None:
            return []

        prompt = self._build_llm_prompt(user_text, assistant_text, context)

        # 兼容常见 LLM 调用方式
        raw_response: str = ""
        if hasattr(self.llm_client, "chat") and callable(self.llm_client.chat):
            raw_response = self.llm_client.chat([{"role": "user", "content": prompt}])
        elif callable(self.llm_client):
            raw_response = self.llm_client(prompt)
        else:
            raise ValueError("llm_client 必须实现 chat(messages) 方法或为可调用对象")

        return self._parse_llm_response(raw_response)

    def _build_llm_prompt(self, user_text: str, assistant_text: str, context: str) -> str:
        ctx_part = f"\n额外上下文：{context}\n" if context else ""
        return (
            "你是一个长期记忆抽取器。请从下面的对话中提取值得长期记住的用户相关信息。\n\n"
            "【抽取原则】\n"
            "1. 情境切分：如果对话切换了话题，请分别按情境独立提取，不要混为一谈。\n"
            "2. 三类原子记忆（mem_type）：\n"
            "   - persona：用户的稳定属性/身份/长期偏好（如『用户是大学生』『用户爱喝咖啡』）\n"
            "   - episodic：客观发生的具体事件/经历/计划（如『用户明天要去北京』）\n"
            "   - instruction：用户给出的全局指令或约定（如『回答用简体中文』）\n"
            "3. 宁缺毋滥：只提取真正长期有用的信息。过滤一次性问答、临时闲聊、可从上下文直接推得的常识。\n"
            "4. 独立完整：每条记忆必须脱离上下文也能看懂，用第三人称、客观表述。\n"
            "5. priority：0.0-1.0 的重要性打分（身份/强偏好/约定 ≥ 0.7；一般事实 0.4-0.6；易变计划 ≤ 0.5）。\n"
            "6. 每条不超过 200 字。没有值得提取的内容时返回空数组 []。\n\n"
            "【输出格式】严格返回 JSON 数组，元素字段：\n"
            '{"content": "记忆内容", "category": "fact|preference|rule|feedback|event", '
            '"mem_type": "persona|episodic|instruction", "priority": 0.7, "is_permanent": false}\n\n'
            f"用户：{user_text}\n"
            f"助手：{assistant_text}{ctx_part}"
        )

    def _parse_llm_response(self, raw: str) -> list[MemoryFragment]:
        """解析 LLM 返回的 JSON（兼容 mem_type / priority / layer 字段）。"""
        raw = raw.strip()
        # 尝试提取 JSON 代码块
        if "```" in raw:
            match = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
            if match:
                raw = match.group(1).strip()

        try:
            items = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"LLM 返回非 JSON: {exc}") from exc

        if not isinstance(items, list):
            return []

        fragments: list[MemoryFragment] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            content = str(item.get("content", "")).strip()
            if not content:
                continue
            importance = float(item.get("priority", item.get("importance", 0.5)))
            is_permanent = bool(item.get("is_permanent", False))
            mem_type = str(item.get("mem_type", ""))
            layer = str(item.get("layer", LAYER_L1))
            category = str(item.get("category", CATEGORY_FACT))
            fragments.append(
                MemoryFragment(
                    content=self._truncate(content),
                    category=category,
                    importance=max(0.0, min(1.0, importance)),
                    is_permanent=is_permanent,
                    mem_type=mem_type,
                    layer=layer or LAYER_L1,
                )
            )
        return fragments

    def _deduplicate_and_truncate(self, fragments: list[MemoryFragment]) -> list[MemoryFragment]:
        """去重、过滤低重要性、截断长度。"""
        seen: set[str] = set()
        result: list[MemoryFragment] = []
        for frag in fragments:
            if frag.importance < self.config.min_importance:
                continue
            content = self._truncate(frag.content)
            if content in seen:
                continue
            seen.add(content)
            frag.content = content
            result.append(frag)
            if len(result) >= self.config.max_fragments_per_turn:
                break
        return result

    def _truncate(self, text: str) -> str:
        """按字符截断文本。"""
        if len(text) <= self.config.max_content_length:
            return text
        return text[: self.config.max_content_length - 1] + "…"
