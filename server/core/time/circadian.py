"""昼夜节律。

根据时间调整 PAD 情绪基线和主动行为频率：
- 早晨 (6-9): 唤醒度逐渐升高
- 白天 (9-18): 唤醒度正常，活跃
- 傍晚 (18-22): 唤醒度逐渐下降，愉悦度微升
- 深夜 (22-6): 唤醒度低，主动行为减少

影响:
- PAD 基线偏移（arousal 随时间变化最大）
- 主动聊天频率（白天高，深夜低）
- 说话风格（深夜更安静温柔）
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time

from ..heart.emotion import PADValues


@dataclass
class CircadianRhythm:
    """昼夜节律调制器。"""

    # 各时段的 PAD 基线调整
    morning_arousal_bonus: float = 0.2      # 早晨唤醒度加成
    day_arousal_bonus: float = 0.1          # 白天唤醒度加成
    evening_pleasure_bonus: float = 0.1     # 傍晚愉悦度加成
    night_arousal_penalty: float = -0.3     # 深夜唤醒度惩罚
    night_pleasure_penalty: float = -0.1    # 深夜愉悦度微降

    # 主动行为系数（0-1，乘在基础频率上）
    morning_initiative: float = 0.8
    day_initiative: float = 1.0
    evening_initiative: float = 0.9
    night_initiative: float = 0.3

    # ---- 时段判断 ----

    @staticmethod
    def get_time_of_day(now: datetime | None = None) -> str:
        """判断当前时段。

        Returns:
            "morning" (6-9) | "day" (9-18) | "evening" (18-22) | "night" (22-6)
        """
        if now is None:
            now = datetime.now()
        h = now.hour

        if 6 <= h < 9:
            return "morning"
        if 9 <= h < 18:
            return "day"
        if 18 <= h < 22:
            return "evening"
        return "night"

    @staticmethod
    def get_time_label(time_of_day: str) -> str:
        """时段中文名。"""
        return {
            "morning": "早晨",
            "day": "白天",
            "evening": "傍晚",
            "night": "深夜",
        }.get(time_of_day, "白天")

    # ---- PAD 影响 ----

    def pad_influence(self, now: datetime | None = None) -> PADValues:
        """计算当前时间对 PAD 基线的影响。"""
        tod = self.get_time_of_day(now)

        pleasure = 0.0
        arousal = 0.0
        dominance = 0.0

        if tod == "morning":
            arousal += self.morning_arousal_bonus
        elif tod == "day":
            arousal += self.day_arousal_bonus
        elif tod == "evening":
            pleasure += self.evening_pleasure_bonus
            arousal -= 0.1
        else:  # night
            arousal += self.night_arousal_penalty
            pleasure += self.night_pleasure_penalty

        return PADValues(
            pleasure=max(-0.3, min(0.3, pleasure)),
            arousal=max(-0.3, min(0.3, arousal)),
            dominance=max(-0.3, min(0.3, dominance)),
        )

    # ---- 主动行为系数 ----

    def initiative_multiplier(self, now: datetime | None = None) -> float:
        """主动行为系数。

        Returns:
            0.0-1.0 的系数，乘在基础主动频率上
        """
        tod = self.get_time_of_day(now)
        return {
            "morning": self.morning_initiative,
            "day": self.day_initiative,
            "evening": self.evening_initiative,
            "night": self.night_initiative,
        }.get(tod, 1.0)

    # ---- 问候语 ----

    def get_greeting(self, now: datetime | None = None) -> str:
        """获取对应时段的问候语。"""
        tod = self.get_time_of_day(now)
        return {
            "morning": "早上好呀～新的一天开始了",
            "day": "今天过得怎么样呀？",
            "evening": "晚上好～今天辛苦了",
            "night": "这么晚还没睡吗？要注意休息哦",
        }.get(tod, "你好呀～")

    # ---- 说话风格调整 ----

    def style_modifier(self, now: datetime | None = None) -> dict:
        """说话风格调整系数。"""
        tod = self.get_time_of_day(now)

        if tod == "night":
            return {
                "tone": "安静温柔",
                "sentence_length_mult": 0.8,
                "initiative_mult": 0.5,
                "volume": "soft",
            }
        if tod == "morning":
            return {
                "tone": "清新活力",
                "sentence_length_mult": 1.1,
                "initiative_mult": 1.0,
                "volume": "normal",
            }
        if tod == "evening":
            return {
                "tone": "温馨放松",
                "sentence_length_mult": 1.0,
                "initiative_mult": 0.9,
                "volume": "normal",
            }
        return {
            "tone": "自然",
            "sentence_length_mult": 1.0,
            "initiative_mult": 1.0,
            "volume": "normal",
        }
