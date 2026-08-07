"""HEXACO 六维人格模型。

六维度:
- Honesty-Humility  (诚实-谦逊): 真诚/公平 vs 贪婪/傲慢
- Emotionality     (情绪性): 多愁善感/依赖 vs 冷静/独立
- eXtraversion     (外向性): 社交/自信 vs 内向/沉默
- Agreeableness    (宜人性): 宽容/合作 vs 易怒/好斗
- Conscientiousness(尽责性): 严谨/自律 vs 随意/马虎
- Openness         (开放性): 好奇/创新 vs 保守/传统

人格 → PAD 情绪基线映射:
- 外向性高 → 愉悦度基线偏高
- 情绪性高 → 唤醒度波动更大
- 尽责性高 → 支配度基线偏高
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..heart.emotion import PADValues


HEXACO_DIMENSIONS: list[tuple[str, str, str]] = [
    ("honesty_humility", "诚实-谦逊", "真诚、公平、忠诚 vs 贪婪、傲慢、狡诈"),
    ("emotionality", "情绪性", "多愁善感、依赖 vs 冷静、独立、无畏"),
    ("extraversion", "外向性", "社交、活跃、自信 vs 内向、沉默、被动"),
    ("agreeableness", "宜人性", "宽容、合作、温和 vs 易怒、好斗、挑剔"),
    ("conscientiousness", "尽责性", "严谨、自律、可靠 vs 随意、马虎、冲动"),
    ("openness", "开放性", "好奇、创新、想象 vs 保守、传统、务实"),
]


@dataclass(frozen=True)
class HEXACOPersonality:
    """HEXACO 六维人格参数（不可变值对象）。

    每个维度取值 0.0-1.0，0.5 为平均水平。
    """

    honesty_humility: float = 0.5
    emotionality: float = 0.5
    extraversion: float = 0.5
    agreeableness: float = 0.5
    conscientiousness: float = 0.5
    openness: float = 0.5

    def __post_init__(self) -> None:
        for dim, _, _ in HEXACO_DIMENSIONS:
            val = getattr(self, dim)
            object.__setattr__(self, dim, max(0.0, min(1.0, float(val))))

    # ---- 转换 ----

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for dim, cn_name, desc in HEXACO_DIMENSIONS:
            val = getattr(self, dim)
            result[dim] = {
                "value": val,
                "cn_name": cn_name,
                "description": desc,
            }
        return result

    def to_simple_dict(self) -> dict[str, float]:
        return {dim: getattr(self, dim) for dim, _, _ in HEXACO_DIMENSIONS}

    @classmethod
    def from_dict(cls, data: dict[str, float]) -> HEXACOPersonality:
        return cls(
            honesty_humility=data.get("honesty_humility", 0.5),
            emotionality=data.get("emotionality", 0.5),
            extraversion=data.get("extraversion", 0.5),
            agreeableness=data.get("agreeableness", 0.5),
            conscientiousness=data.get("conscientiousness", 0.5),
            openness=data.get("openness", 0.5),
        )

    # ---- 计算方法 ----

    def pad_baseline_influence(self) -> PADValues:
        """人格 → PAD 情绪基线影响。

        映射规则（小幅影响，±0.3 范围内）:
        - 外向性 → Pleasure (+): 外向的人更常处于愉悦状态
        - 情绪性 → Arousal (±): 高情绪性的人唤醒度波动更大
        - 尽责性 → Dominance (+): 高尽责性的人更有掌控感
        - 宜人性 → Pleasure (+): 宜人的人更少负面情绪
        - 开放性 → Arousal (+): 开放的人更容易被新奇事物唤醒
        """
        pleasure = 0.0
        arousal = 0.0
        dominance = 0.0

        # 外向性 → 愉悦度
        pleasure += (self.extraversion - 0.5) * 0.6
        # 宜人性 → 愉悦度
        pleasure += (self.agreeableness - 0.5) * 0.3

        # 情绪性 → 唤醒度（波动更大，但基线不显著偏移）
        arousal += (self.emotionality - 0.5) * 0.2
        # 开放性 → 唤醒度
        arousal += (self.openness - 0.5) * 0.3

        # 尽责性 → 支配度
        dominance += (self.conscientiousness - 0.5) * 0.5
        # 外向性 → 支配度（自信）
        dominance += (self.extraversion - 0.5) * 0.2

        return PADValues(
            pleasure=max(-0.3, min(0.3, pleasure)),
            arousal=max(-0.3, min(0.3, arousal)),
            dominance=max(-0.3, min(0.3, dominance)),
        )

    def describe(self) -> str:
        """生成人格文字描述。"""
        parts: list[str] = []

        # 找出最高和最低的维度
        dims = [(dim, cn, getattr(self, dim)) for dim, cn, _ in HEXACO_DIMENSIONS]
        dims.sort(key=lambda x: x[2], reverse=True)

        top = dims[0]
        bottom = dims[-1]

        if top[2] > 0.7:
            parts.append(f"你在「{top[1]}」上很突出（{top[2]:.0%}）")
        if bottom[2] < 0.3:
            parts.append(f"在「{bottom[1]}」上相对较弱（{bottom[2]:.0%}）")

        if not parts:
            parts.append("各维度较为均衡，属于典型的中间型人格")

        return "；".join(parts) + "。"

    def blend_with(self, other: HEXACOPersonality, weight: float = 0.5) -> HEXACOPersonality:
        """与另一个人格混合。"""
        w = max(0.0, min(1.0, weight))
        return HEXACOPersonality(
            honesty_humility=self.honesty_humility * w + other.honesty_humility * (1 - w),
            emotionality=self.emotionality * w + other.emotionality * (1 - w),
            extraversion=self.extraversion * w + other.extraversion * (1 - w),
            agreeableness=self.agreeableness * w + other.agreeableness * (1 - w),
            conscientiousness=self.conscientiousness * w + other.conscientiousness * (1 - w),
            openness=self.openness * w + other.openness * (1 - w),
        )
