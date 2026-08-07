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

from .fragment import MemoryFragment
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


class Scribe:
    """记忆抄写员：从对话中提炼事实性记忆。"""

    # 常见事实模式（中文）
    RULE_PATTERNS: list[tuple[re.Pattern, str, float]] = [
        # 用户身份
        (re.compile(r"我(?:叫|是)\s*([^，。！？\n]{1,20})"), "用户的名字/身份是{}", 0.75),
        (re.compile(r"我的名字是\s*([^，。！？\n]{1,20})"), "用户的名字是{}", 0.8),
        # 喜好
        (re.compile(r"我喜欢\s*([^，。！？\n]{1,30})"), "用户喜欢{}", 0.7),
        (re.compile(r"我喜欢吃\s*([^，。！？\n]{1,30})"), "用户喜欢吃{}", 0.72),
        (re.compile(r"我喜欢喝\s*([^，。！？\n]{1,30})"), "用户喜欢喝{}", 0.72),
        (re.compile(r"我爱\s*([^，。！？\n]{1,30})"), "用户喜欢/热爱{}", 0.7),
        (re.compile(r"我钟爱\s*([^，。！？\n]{1,30})"), "用户钟爱{}", 0.75),
        # 厌恶
        (re.compile(r"我讨厌\s*([^，。！？\n]{1,30})"), "用户讨厌{}", 0.7),
        (re.compile(r"我不喜欢\s*([^，。！？\n]{1,30})"), "用户不喜欢{}", 0.68),
        (re.compile(r"我害怕\s*([^，。！？\n]{1,30})"), "用户害怕{}", 0.7),
        # 状态/计划
        (re.compile(r"我今天\s*([^，。！？\n]{1,40})"), "用户今天{}", 0.6),
        (re.compile(r"我明天\s*([^，。！？\n]{1,40})"), "用户明天{}", 0.6),
        (re.compile(r"我计划\s*([^，。！？\n]{1,40})"), "用户计划{}", 0.65),
        (re.compile(r"我要\s*([^，。！？\n]{1,40})"), "用户打算{}", 0.6),
        # 关系/约定
        (re.compile(r"(?:记住|别忘了)\s*([^，。！？\n]{1,40})"), "用户希望记住：{}", 0.78),
        (re.compile(r"(?:答应我|约定)\s*([^，。！？\n]{1,40})"), "用户约定的内容是：{}", 0.75),
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
    ) -> list[MemoryFragment]:
        """从一轮对话中提取记忆碎片。

        Args:
            user_text: 用户输入
            assistant_text: 助手回复
            context: 额外上下文（可选）

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
        for pattern, template, importance in self.RULE_PATTERNS:
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
                        importance=min(importance, 0.9),
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
            "请从以下对话中提取 1-3 条值得长期保留的事实性记忆。\n"
            "只提取重要信息，例如：用户偏好、身份、重要约定、情感关系、计划等。\n"
            "用第三人称表述，每条不超过 200 字。\n"
            "如果没有值得提取的记忆，返回空数组 []。\n"
            "必须返回 JSON 数组，格式如下：\n"
            '[{"content": "用户喜欢喝抹茶拿铁", "importance": 0.7}]\n\n'
            f"用户：{user_text}\n"
            f"助手：{assistant_text}{ctx_part}"
        )

    def _parse_llm_response(self, raw: str) -> list[MemoryFragment]:
        """解析 LLM 返回的 JSON。"""
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
            importance = float(item.get("importance", 0.5))
            is_permanent = bool(item.get("is_permanent", False))
            fragments.append(
                MemoryFragment(
                    content=self._truncate(content),
                    importance=max(0.0, min(1.0, importance)),
                    is_permanent=is_permanent,
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
