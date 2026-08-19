"""记忆碎片核心数据模型。

代表从对话中提取 / 用户手动添加的一条记忆，≤500 字符，第三人称表述。
不依赖数据库或存储层，纯领域模型。

字段说明（统一记忆系统的唯一真相来源）：
- category: 记忆类别。fact(事实) / preference(偏好) / rule(约定规则) /
  feedback(反馈) / event(事件) 等。用于注入优先级与 UI 分组。
- source: 来源。ui(用户在设置页手动添加) / chat(对话自动抽取) /
  migration(从旧 hermes_gateway_memory 迁移)。
- enabled: 是否启用。主要用于 rule，禁用则不注入 LLM。其余类别恒为 True。
- meta: 自由元数据（JSON 字典）。例如抽取置信度、重要性理由、UI 标签等。
- client_ref: 前端稳定引用 ID。UI 编辑/同步时以此去重，避免重复创建。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

# 合法的记忆类别
CATEGORY_FACT = "fact"
CATEGORY_PREFERENCE = "preference"
CATEGORY_RULE = "rule"
CATEGORY_FEEDBACK = "feedback"
CATEGORY_EVENT = "event"

VALID_CATEGORIES = (
    CATEGORY_FACT,
    CATEGORY_PREFERENCE,
    CATEGORY_RULE,
    CATEGORY_FEEDBACK,
    CATEGORY_EVENT,
)

# 合法的来源
SOURCE_UI = "ui"
SOURCE_CHAT = "chat"
SOURCE_MIGRATION = "migration"


@dataclass
class MemoryFragment:
    """记忆碎片。

    Attributes:
        id: 数据库 ID（持久化后填充）
        character_id: 关联角色 ID（字符串，如 persona id）
        user_id: 关联使用者 ID
        content: 记忆内容（≤500 字符）
        category: 记忆类别（见上方常量）
        source: 来源（见上方常量）
        enabled: 是否启用（rule 禁用则不注入）
        meta: 自由元数据字典
        client_ref: 前端稳定引用 ID（用于去重 upsert）
        source_message_ids: 来源消息 ID 列表
        importance: 重要性 0.0-1.0
        embedding: 向量嵌入（list[float]，JSON 存储）
        access_count: 被召回次数
        last_accessed: 最后召回时间
        is_permanent: 永久记忆标志（跳过遗忘曲线，永不删除）
        created_at: 创建时间
        updated_at: 更新时间
        emotion_snapshot: 记忆创建时的整轮对话平均 PAD（情绪快照）
    """

    id: int | None = None
    character_id: str = ""
    user_id: str = ""
    content: str = ""
    category: str = CATEGORY_FACT
    source: str = SOURCE_CHAT
    enabled: bool = True
    meta: dict[str, Any] = field(default_factory=dict)
    client_ref: str = ""
    source_message_ids: list[int] = field(default_factory=list)
    importance: float = 0.5
    embedding: list[float] = field(default_factory=list)
    access_count: int = 0
    last_accessed: datetime = field(default_factory=datetime.utcnow)
    is_permanent: bool = False
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    emotion_snapshot: dict[str, float] = field(default_factory=dict)

    # ---- 领域方法 ----

    def touch(self) -> None:
        """记录一次访问（增加计数 + 更新时间）。"""
        self.access_count += 1
        self.last_accessed = datetime.utcnow()
        self.updated_at = datetime.utcnow()

    def is_stale(self, days: int = 14) -> bool:
        """检查是否长时间未访问。

        永久记忆永远不会变 stale。
        """
        if self.is_permanent:
            return False
        elapsed = (datetime.utcnow() - self.last_accessed).total_seconds()
        return elapsed > days * 86400

    def to_dict(self) -> dict[str, Any]:
        """转为字典（用于 JSON 序列化）。"""
        return {
            "id": self.id,
            "character_id": self.character_id,
            "user_id": self.user_id,
            "content": self.content,
            "category": self.category,
            "source": self.source,
            "enabled": self.enabled,
            "meta": self.meta,
            "client_ref": self.client_ref,
            "source_message_ids": self.source_message_ids,
            "importance": self.importance,
            "embedding": self.embedding,
            "access_count": self.access_count,
            "last_accessed": self.last_accessed.isoformat(),
            "is_permanent": self.is_permanent,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "emotion_snapshot": self.emotion_snapshot,
        }

    def to_api_dict(self) -> dict[str, Any]:
        """转为对前端友好的字典（不含内部向量，含全部展示字段）。"""
        return {
            "id": self.id,
            "character_id": self.character_id,
            "user_id": self.user_id,
            "content": self.content,
            "category": self.category,
            "source": self.source,
            "enabled": self.enabled,
            "meta": self.meta,
            "client_ref": self.client_ref,
            "importance": self.importance,
            "is_permanent": self.is_permanent,
            "access_count": self.access_count,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "emotion_snapshot": self.emotion_snapshot,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MemoryFragment:
        """从字典创建。"""
        return cls(
            id=data.get("id"),
            character_id=data.get("character_id", ""),
            user_id=data.get("user_id", ""),
            content=data.get("content", ""),
            category=data.get("category", CATEGORY_FACT),
            source=data.get("source", SOURCE_CHAT),
            enabled=data.get("enabled", True),
            meta=data.get("meta", {}) or {},
            client_ref=data.get("client_ref", ""),
            source_message_ids=data.get("source_message_ids", []),
            importance=data.get("importance", 0.5),
            embedding=data.get("embedding", []),
            access_count=data.get("access_count", 0),
            is_permanent=data.get("is_permanent", False),
            emotion_snapshot=data.get("emotion_snapshot", {}) or {},
        )
