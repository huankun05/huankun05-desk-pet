"""重逢机制。

长时间未见 → 特殊问候 + 情绪突跃（久别重逢的喜悦）

间隔等级:
- < 1h: 刚见过，正常问候
- 1-4h: 分开一会儿了，轻微喜悦
- 4-24h: 一天没见了，明显喜悦
- 1-3天: 好久不见，强烈喜悦 + 好奇
- > 3天: 非常想念，情绪爆发 + 主动分享
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from ..emotion.emotion import PADValues


@dataclass
class ReunionResult:
    """重逢计算结果。"""

    level: str            # just_now / short / medium / long / very_long
    hours_away: float
    greeting: str
    pad_surge: PADValues  # 情绪突跃量
    should_trigger_event: bool  # 是否触发特殊事件


class ReunionEngine:
    """重逢机制引擎。"""

    # 间隔阈值（小时）
    THRESHOLD_SHORT = 1.0
    THRESHOLD_MEDIUM = 4.0
    THRESHOLD_LONG = 24.0
    THRESHOLD_VERY_LONG = 72.0

    def classify_separation(self, hours: float) -> str:
        """分类分离时长。"""
        if hours < self.THRESHOLD_SHORT:
            return "just_now"
        if hours < self.THRESHOLD_MEDIUM:
            return "short"
        if hours < self.THRESHOLD_LONG:
            return "medium"
        if hours < self.THRESHOLD_VERY_LONG:
            return "long"
        return "very_long"

    def compute_reunion(
        self,
        last_seen: datetime,
        now: datetime | None = None,
    ) -> ReunionResult:
        """计算重逢状态。

        Args:
            last_seen: 上次见面时间
            now: 当前时间（默认 now）

        Returns:
            ReunionResult 包含问候语和情绪突跃
        """
        if now is None:
            now = datetime.now()

        delta = now - last_seen
        hours = delta.total_seconds() / 3600.0
        level = self.classify_separation(hours)

        greetings = {
            "just_now": "咦？你回来啦～",
            "short": "嗨～又见面了",
            "medium": "你回来啦～今天过得怎么样？",
            "long": "好久不见！我都想你了，最近还好吗？",
            "very_long": "哇！你终于回来了！我好想你啊！这段时间你都在忙什么呀？",
        }

        # 情绪突跃：愉悦度 + 唤醒度上升
        pad_surges = {
            "just_now": PADValues(pleasure=0.05, arousal=0.05, dominance=0.0),
            "short": PADValues(pleasure=0.1, arousal=0.1, dominance=0.02),
            "medium": PADValues(pleasure=0.2, arousal=0.15, dominance=0.05),
            "long": PADValues(pleasure=0.3, arousal=0.25, dominance=0.1),
            "very_long": PADValues(pleasure=0.4, arousal=0.35, dominance=0.15),
        }

        should_trigger = level in ("long", "very_long")

        return ReunionResult(
            level=level,
            hours_away=hours,
            greeting=greetings.get(level, "你好呀～"),
            pad_surge=pad_surges.get(level, PADValues()),
            should_trigger_event=should_trigger,
        )

    def hours_since(self, last_seen: datetime, now: datetime | None = None) -> float:
        """计算距上次见面多少小时。"""
        if now is None:
            now = datetime.now()
        return (now - last_seen).total_seconds() / 3600.0
