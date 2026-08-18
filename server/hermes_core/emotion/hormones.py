"""激素系统。

三种激素:
- Dopamine  (多巴胺): 愉悦/动力驱动，半衰期 ~5 min
- Cortisol  (皮质醇): 压力/警觉驱动，半衰期 ~3 min
- Oxytocin  (催产素): 依恋/信任驱动，半衰期 ~10 min

设计规则：
- HormonalSystem 是不可变值对象（frozen dataclass）
- HormonalEngine 负责分泌/衰减/相互影响/PAD 影响映射
- 所有返回新对象，不修改原对象（immutability）
"""

from __future__ import annotations

from dataclasses import dataclass

from .emotion import PADValues


# ============================================================
# 激素配置
# ============================================================

HORMONE_CONFIG: dict[str, dict] = {
    "dopamine": {
        "name": "dopamine",
        "cn_name": "多巴胺",
        "range": (0.0, 1.0),
        "default": 0.5,
        "decay": 5.0,
        "decay_minutes": 5.0,
        "influence": {
            "pleasure": 0.8,
            "arousal": 0.3,
            "dominance": 0.1,
        },
        "trigger_events": {
            "positive_feedback": 0.15,
            "interesting_topic": 0.10,
            "goal_achievement": 0.20,
            "reward": 0.15,
        },
        "suppresses": ["cortisol"],
    },
    "cortisol": {
        "name": "cortisol",
        "cn_name": "皮质醇",
        "range": (0.0, 1.0),
        "default": 0.3,
        "decay": 3.0,
        "decay_minutes": 3.0,
        "influence": {
            "pleasure": -0.5,
            "arousal": 0.6,
            "dominance": -0.1,
        },
        "trigger_events": {
            "negative_emotion": 0.20,
            "conflict": 0.25,
            "urgent_request": 0.15,
            "pressure": 0.18,
        },
        "suppresses": [],
    },
    "oxytocin": {
        "name": "oxytocin",
        "cn_name": "催产素",
        "range": (0.0, 1.0),
        "default": 0.5,
        "decay": 10.0,
        "decay_minutes": 10.0,
        "influence": {
            "pleasure": 0.4,
            "arousal": -0.2,
            "dominance": 0.0,
        },
        "trigger_events": {
            "intimate_conversation": 0.15,
            "long_companionship": 0.08,
            "share_secret": 0.20,
            "trust": 0.15,
        },
        "suppresses": ["cortisol"],
    },
}


# ============================================================
# HormonalSystem — 不可变激素状态
# ============================================================


@dataclass(frozen=True)
class HormonalSystem:
    """激素水平状态（不可变值对象）。"""

    dopamine: float = 0.5
    cortisol: float = 0.3
    oxytocin: float = 0.5

    def __post_init__(self) -> None:
        object.__setattr__(self, "dopamine", max(0.0, min(1.0, float(self.dopamine))))
        object.__setattr__(self, "cortisol", max(0.0, min(1.0, float(self.cortisol))))
        object.__setattr__(self, "oxytocin", max(0.0, min(1.0, float(self.oxytocin))))

    def to_dict(self) -> dict:
        return {
            "dopamine": self.dopamine,
            "cortisol": self.cortisol,
            "oxytocin": self.oxytocin,
            "dopamine_cn": HORMONE_CONFIG["dopamine"]["cn_name"],
            "cortisol_cn": HORMONE_CONFIG["cortisol"]["cn_name"],
            "oxytocin_cn": HORMONE_CONFIG["oxytocin"]["cn_name"],
        }

    @classmethod
    def from_dict(cls, data: dict) -> HormonalSystem:
        return cls(
            dopamine=data.get("dopamine", 0.5),
            cortisol=data.get("cortisol", 0.3),
            oxytocin=data.get("oxytocin", 0.5),
        )

    def blend_with(self, other: HormonalSystem, weight: float = 0.5) -> HormonalSystem:
        w = max(0.0, min(1.0, weight))
        return HormonalSystem(
            dopamine=self.dopamine * w + other.dopamine * (1 - w),
            cortisol=self.cortisol * w + other.cortisol * (1 - w),
            oxytocin=self.oxytocin * w + other.oxytocin * (1 - w),
        )


# ============================================================
# HormonalEngine — 激素行为引擎
# ============================================================


class HormonalEngine:
    """激素行为引擎。

    所有方法返回新对象，不修改原对象。
    分泌/衰减/相互影响/PAD 影响映射。
    """

    # ----------------------------------------------------------
    # 分泌（无状态工厂方法）
    # ----------------------------------------------------------

    def secrete(self, hormone: str, intensity: float = 0.5) -> HormonalSystem:
        """分泌某激素，基于默认值构建新状态。

        Args:
            hormone: 激素名称（dopamine/cortisol/oxytocin）
            intensity: 分泌强度 (0~1)，提升幅度 0.01~0.20

        Returns:
            分泌后的新 HormonalSystem
        """
        if hormone not in HORMONE_CONFIG:
            raise ValueError(f"Unknown hormone: {hormone}")

        cfg = HORMONE_CONFIG[hormone]
        i = max(0.0, min(1.0, intensity))
        delta = 0.01 + i * 0.19
        default_val = cfg["default"]
        new_val = min(cfg["range"][1], default_val + delta)

        return HormonalSystem(
            dopamine=new_val if hormone == "dopamine" else default_val,
            cortisol=new_val if hormone == "cortisol" else default_val,
            oxytocin=new_val if hormone == "oxytocin" else default_val,
        )

    # ----------------------------------------------------------
    # 衰减
    # ----------------------------------------------------------

    def decay(
        self,
        current: HormonalSystem,
        hormone: str,
        minutes: float = 1.0,
    ) -> HormonalSystem:
        """激素自然衰减。

        Args:
            current: 当前激素状态
            hormone: 激素名称
            minutes: 经过的分钟数

        Returns:
            衰减后的新 HormonalSystem
        """
        if hormone not in HORMONE_CONFIG:
            raise ValueError(f"Unknown hormone: {hormone}")

        cfg = HORMONE_CONFIG[hormone]
        half_life = cfg["decay_minutes"]
        current_val = getattr(current, hormone)
        default_val = cfg["default"]

        excess = max(0.0, current_val - default_val)
        decayed = excess * (0.5 ** (minutes / half_life))
        new_val = default_val + decayed

        if current_val < default_val:
            new_val = current_val

        updates = {hormone: new_val}
        return HormonalSystem(
            dopamine=updates.get("dopamine", current.dopamine),
            cortisol=updates.get("cortisol", current.cortisol),
            oxytocin=updates.get("oxytocin", current.oxytocin),
        )

    def decay_all(self, current: HormonalSystem, minutes: float = 1.0) -> HormonalSystem:
        """同时衰减所有激素。

        Args:
            current: 当前激素状态
            minutes: 经过的分钟数

        Returns:
            衰减后的新 HormonalSystem
        """
        state = current
        for h in ("dopamine", "cortisol", "oxytocin"):
            state = self.decay(state, h, minutes)
        return state

    # ----------------------------------------------------------
    # PAD 影响映射
    # ----------------------------------------------------------

    def pad_influence(self, current: HormonalSystem) -> PADValues:
        """激素 → PAD 影响映射。

        Args:
            current: 当前激素状态

        Returns:
            激素对 PAD 的影响值
        """
        pleasure = 0.0
        arousal = 0.0
        dominance = 0.0

        for h_name in ("dopamine", "cortisol", "oxytocin"):
            cfg = HORMONE_CONFIG[h_name]
            level = getattr(current, h_name)
            inf = cfg["influence"]

            default = cfg["default"]
            normalized = (level - default) / (1.0 - default) if level > default else 0.0
            normalized = max(-0.5, min(0.5, normalized))

            pleasure += inf["pleasure"] * normalized * 2.0
            arousal += inf["arousal"] * normalized * 2.0
            dominance += inf["dominance"] * normalized * 2.0

        return PADValues(
            pleasure=max(-1.0, min(1.0, pleasure)),
            arousal=max(-1.0, min(1.0, arousal)),
            dominance=max(-1.0, min(1.0, dominance)),
        )

    # ----------------------------------------------------------
    # 激素相互影响
    # ----------------------------------------------------------

    def apply_interaction(self, current: HormonalSystem) -> HormonalSystem:
        """应用激素相互影响。

        - 高多巴胺 (≥0.7) → 降低皮质醇
        - 高催产素 (≥0.7) → 降低皮质醇
        - 高皮质醇 (≥0.7) → 轻微降低多巴胺

        Args:
            current: 当前激素状态

        Returns:
            应用相互影响后的新 HormonalSystem
        """
        d = current.dopamine
        c = current.cortisol
        o = current.oxytocin

        new_cortisol = c
        if d >= 0.7:
            new_cortisol = max(0.0, c - (d - 0.7) * 0.5)

        if o >= 0.7:
            new_cortisol = max(0.0, new_cortisol - (o - 0.7) * 0.4)

        new_dopamine = d
        if c >= 0.7:
            new_dopamine = max(0.0, d - (c - 0.7) * 0.3)

        return HormonalSystem(
            dopamine=new_dopamine,
            cortisol=new_cortisol,
            oxytocin=current.oxytocin,
        )

    # ----------------------------------------------------------
    # 事件处理
    # ----------------------------------------------------------

    def process_event(self, event: str, current: HormonalSystem) -> HormonalSystem:
        """根据事件类型处理激素分泌。

        Args:
            event: 事件描述（支持中文关键词）
            current: 当前激素状态

        Returns:
            分泌后的新 HormonalSystem
        """
        e = event.lower()

        # 中文触发关键词映射（覆盖英文 trigger_events 命名）
        CN_KEYWORDS: dict[str, dict[str, list[str]]] = {
            "dopamine": {
                "positive_feedback": ["表扬", "夸奖", "赞", "感谢", "喜欢"],
                "interesting_topic": ["有趣", "好奇", "有意思", "好玩"],
                "goal_achievement": ["达成", "完成", "成功"],
                "reward": ["奖励", "礼物", "惊喜"],
            },
            "cortisol": {
                "negative_emotion": ["不满", "难过", "伤心", "讨厌", "烦"],
                "conflict": ["冲突", "吵架", "争论"],
                "urgent_request": ["紧急", "马上", "立刻"],
                "pressure": ["压力", "焦虑", "担心", "紧张"],
            },
            "oxytocin": {
                "intimate_conversation": ["亲密", "悄悄话", "私密"],
                "long_companionship": ["陪伴", "在一起", "一直"],
                "share_secret": ["秘密", "分享", "告诉你"],
                "trust": ["信任", "相信", "依赖"],
            },
        }

        triggered: list[tuple[str, float]] = []

        for h_name, cfg in HORMONE_CONFIG.items():
            cn_map = CN_KEYWORDS.get(h_name, {})
            for trigger_key, trigger_intensity in cfg.get("trigger_events", {}).items():
                keywords = cn_map.get(trigger_key, [])
                if any(kw in e for kw in keywords):
                    triggered.append((h_name, trigger_intensity))
                    break

        if not triggered:
            triggered.append(("dopamine", 0.05))

        new_state = current
        for h, intensity in triggered:
            new_state = self.secrete(h, intensity)

        new_state = self.apply_interaction(new_state)
        return new_state

    # ----------------------------------------------------------
    # 分泌 + PAD 影响联合
    # ----------------------------------------------------------

    def secrete_with_pad(
        self,
        current: HormonalSystem,
        hormone: str,
        intensity: float = 0.5,
    ) -> tuple[HormonalSystem, PADValues]:
        """分泌激素并同时返回 PAD 影响。

        Args:
            current: 当前激素状态
            hormone: 激素名称
            intensity: 强度

        Returns:
            (新的激素状态, PAD 影响值)
        """
        new_state = HormonalSystem(
            dopamine=current.dopamine,
            cortisol=current.cortisol,
            oxytocin=current.oxytocin,
        )
        # 分泌到新状态
        secreted = self.secrete(hormone, intensity)
        pad_impact = self.pad_influence(secreted)
        return secreted, pad_impact
