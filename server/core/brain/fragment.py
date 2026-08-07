"""记忆碎片核心数据模型。

代表从对话中提取的一条事实性记忆，≤200 字符，第三人称表述。
不依赖数据库或存储层，纯领域模型。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class MemoryFragment:
    """记忆碎片。

    代表从对话中提取的一条事实性记忆，≤200 字符，第三人称表述。

    Attributes:
        id: 数据库 ID（持久化后填充）
        character_id: 关联角色 ID
        user_id: 关联使用者 ID
        content: 记忆内容（≤500 字符）
        source_message_ids: 来源消息 ID 列表
        importance: 重要性 0.0-1.0
        embedding: 向量嵌入（list[float]，当前 JSON 存储）
        access_count: 被召回次数
        last_accessed: 最后召回时间
        is_permanent: 永久记忆标志（跳过遗忘曲线，永不删除）
        created_at: 创建时间
        updated_at: 更新时间
    """

    id: int | None = None
    character_id: int = 0
    user_id: str = ""
    content: str = ""
    source_message_ids: list[int] = field(default_factory=list)
    importance: float = 0.5
    embedding: list[float] = field(default_factory=list)
    access_count: int = 0
    last_accessed: datetime = field(default_factory=datetime.utcnow)
    is_permanent: bool = False
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)

    # ---- 领域方法 ----

    def touch(self) -> None:
        """记录一次访问（增加计数 + 更新时间）。"""
        self.access_count += 1
        self.last_accessed = datetime.utcnow()

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
            "source_message_ids": self.source_message_ids,
            "importance": self.importance,
            "embedding": self.embedding,
            "access_count": self.access_count,
            "last_accessed": self.last_accessed.isoformat(),
            "created_at": self.created_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MemoryFragment:
        """从字典创建。"""
        return cls(
            id=data.get("id"),
            character_id=data.get("character_id", 0),
            user_id=data.get("user_id", ""),
            content=data.get("content", ""),
            source_message_ids=data.get("source_message_ids", []),
            importance=data.get("importance", 0.5),
            embedding=data.get("embedding", []),
            access_count=data.get("access_count", 0),
            is_permanent=data.get("is_permanent", False),
        )
