"""PAD 情绪模型值对象。

PAD 三维情绪模型：
- Pleasure (愉悦度): -1 (悲伤/愤怒) ~ +1 (开心/满足)
- Arousal (唤醒度): -1 (困倦/平静) ~ +1 (兴奋/警觉)
- Dominance (支配度): -1 (顺从/不安) ~ +1 (自信/主导)

设计规则：
- PADValues 是不可变值对象（frozen dataclass）
- 构造时自动 clamp 到 [-1, 1]
- EmotionState 包含 PAD + 激素 + 基线
- 所有方法返回新对象（immutability）
"""

from __future__ import annotations

from dataclasses import dataclass, field


# ============================================================
# 情绪关键词（用于描述情绪状态）
# ============================================================

EMOTION_KEYWORDS: dict[str, list[str]] = {
    "happy": [
        "开心", "愉悦", "高兴", "快乐", "兴奋", "愉快",
        "充满活力", "满足", "幸福", "欣喜",
    ],
    "sad": [
        "难过", "悲伤", "沮丧", "失落", "消沉", "低落",
        "忧伤", "痛苦", "委屈", "惆怅",
    ],
    "anxious": [
        "焦虑", "紧张", "不安", "担心", "恐慌", "忧虑",
        "烦躁", "慌", "压力大", "悬着",
    ],
    "calm": [
        "平静", "放松", "安宁", "舒适", "安逸", "安稳",
        "宁静", "恬淡", "心平气和", "悠然",
    ],
    "excited": [
        "兴奋", "激动", "热情", "热血", "沸腾",
        "亢奋", "斗志昂扬", "跃跃欲试", "摩拳擦掌",
    ],
    "angry": [
        "生气", "愤怒", "恼火", "烦躁", "恼", "火",
        "恼羞成怒", "气愤", "暴怒", "恼恨",
    ],
}


# ============================================================
# PADValues — 不可变值对象
# ============================================================


@dataclass(frozen=True)
class PADValues:
    """PAD 三维情绪值。

    不可变对象，构造时自动 clamp 到 [-1, 1]。
    """

    pleasure: float = 0.0
    arousal: float = 0.0
    dominance: float = 0.0

    def __post_init__(self) -> None:
        """构造后自动 clamp。"""
        object.__setattr__(
            self, "pleasure",
            max(-1.0, min(1.0, float(self.pleasure))),
        )
        object.__setattr__(
            self, "arousal",
            max(-1.0, min(1.0, float(self.arousal))),
        )
        object.__setattr__(
            self, "dominance",
            max(-1.0, min(1.0, float(self.dominance))),
        )

    def to_dict(self) -> dict[str, float]:
        """转为字典。"""
        return {
            "pleasure": self.pleasure,
            "arousal": self.arousal,
            "dominance": self.dominance,
        }

    def distance_to(self, other: PADValues) -> float:
        """计算与另一个 PAD 值的欧氏距离。"""
        return (
            (self.pleasure - other.pleasure) ** 2
            + (self.arousal - other.arousal) ** 2
            + (self.dominance - other.dominance) ** 2
        ) ** 0.5

    def blend_with(self, other: PADValues, weight: float = 0.5) -> PADValues:
        """线性混合两个 PAD 值。

        Args:
            other: 另一个 PAD 值
            weight: 自身权重 (0~1)，other 权重为 1-weight

        Returns:
            新的 PADValues 实例（不修改原对象）
        """
        w = max(0.0, min(1.0, weight))
        return PADValues(
            pleasure=self.pleasure * w + other.pleasure * (1 - w),
            arousal=self.arousal * w + other.arousal * (1 - w),
            dominance=self.dominance * w + other.dominance * (1 - w),
        )


# ============================================================
# EmotionState — 情绪状态
# ============================================================


@dataclass
class EmotionState:
    """完整情绪状态。

    包含 PAD 三维值、激素水平、情绪基线、情绪标签。
    注意：此对象是 mutable 的（情绪需要随时间变化），
    但 PADValues 本身是不可变的（immutability 原则）。
    """

    pad: PADValues = field(default_factory=PADValues)
    hormones: dict[str, float] = field(default_factory=dict)
    baseline: PADValues | None = None
    mood_label: str | None = None
    drift_rate: float = 0.02

    def __post_init__(self) -> None:
        """初始化默认激素水平。"""
        defaults = {"dopamine": 0.5, "cortisol": 0.5, "oxytocin": 0.5}
        for k, v in defaults.items():
            if k not in self.hormones:
                self.hormones[k] = v

    # ------------------------------------------------------------
    # 情绪描述
    # ------------------------------------------------------------

    def get_mood_label(self) -> str:
        """根据 PAD 值生成情绪标签。

        优先级：
        1. 焦虑：高唤醒 + 低愉悦度
        2. 兴奋：高唤醒 + 高愉悦度
        3. 平静：低唤醒 + 中性
        4. 开心：高愉悦度
        5. 悲伤：低愉悦度
        6. 愤怒：低愉悦 + 高支配度
        7. 温和：低支配度 + 中性
        """
        p = self.pad.pleasure
        a = self.pad.arousal
        d = self.pad.dominance

        # 1. 焦虑：高唤醒 + 负向
        if a > 0.3 and p < -0.1:
            return "焦虑"

        # 2. 兴奋：高唤醒 + 正向
        if a > 0.3 and p > 0.1:
            return "兴奋"

        # 3. 平静：低唤醒 + 中性
        if a < -0.2 and abs(p) < 0.3:
            return "平静"

        # 4. 开心：正向愉悦
        if p > 0.3:
            return "开心"

        # 5. 悲伤：负向愉悦
        if p < -0.3:
            return "悲伤"

        # 6. 愤怒：负向 + 高支配 + 正唤醒
        if p < -0.1 and d > 0.3 and a > 0.0:
            return "愤怒"

        # 7. 温和：低支配度
        if d < -0.3 and abs(p) < 0.3:
            return "温和"

        return "平静"

    def describe(self) -> str:
        """生成自然语言情绪描述。

        Returns:
            情绪描述字符串
        """
        label = self.get_mood_label()
        p = self.pad.pleasure
        a = self.pad.arousal

        pleasure_desc = (
            "心情愉悦" if p > 0.3 else
            "心情低落" if p < -0.3 else
            "心情平静"
        )
        arousal_desc = (
            "精力充沛" if a > 0.3 else
            "有些疲惫" if a < -0.3 else
            "状态稳定"
        )

        return f"{pleasure_desc}，{arousal_desc}，当前情绪为「{label}」。"

    # ------------------------------------------------------------
    # 漂移（drift — 向基线回归）
    # ------------------------------------------------------------

    def drift(self, rate: float | None = None) -> None:
        """情绪向基线自然漂移（模拟情绪随时间回归平静）。

        Args:
            rate: 漂移速率（默认 self.drift_rate）
        """
        if self.baseline is None:
            return

        r = rate if rate is not None else self.drift_rate

        new_pleasure = self.pad.pleasure + (self.baseline.pleasure - self.pad.pleasure) * r
        new_arousal = self.pad.arousal + (self.baseline.arousal - self.pad.arousal) * r
        new_dominance = self.pad.dominance + (self.baseline.dominance - self.pad.dominance) * r

        object.__setattr__(self, "pad", PADValues(
            pleasure=new_pleasure,
            arousal=new_arousal,
            dominance=new_dominance,
        ))

    # ------------------------------------------------------------
    # 事件响应
    # ------------------------------------------------------------

    def apply_event(self, event: str, intensity: float = 0.5) -> None:
        """根据事件类型调整情绪。

        Args:
            event: 事件描述（关键词触发情绪变化）
            intensity: 事件强度 (0~1)
        """
        i = max(0.0, min(1.0, intensity))
        delta_p, delta_a, delta_d = _event_to_pad(event, i)

        object.__setattr__(self, "pad", PADValues(
            pleasure=self.pad.pleasure + delta_p,
            arousal=self.pad.arousal + delta_a,
            dominance=self.pad.dominance + delta_d,
        ))

    # ------------------------------------------------------------
    # 激素注入
    # ------------------------------------------------------------

    def inject_hormone(self, hormone: str, delta: float) -> None:
        """注入/调整某激素水平。

        Args:
            hormone: 激素名（dopamine / cortisol / oxytocin）
            delta: 变化量（+/-），最终值 clamp 到 [0, 1]
        """
        current = self.hormones.get(hormone, 0.5)
        new_val = max(0.0, min(1.0, current + delta))
        self.hormones[hormone] = new_val

    # ------------------------------------------------------------
    # 序列化
    # ------------------------------------------------------------

    def to_dict(self) -> dict:
        """序列化为字典（用于 API 响应和数据库存储）。"""
        return {
            "pad": self.pad.to_dict(),
            "hormones": dict(self.hormones),
            "mood_label": self.get_mood_label(),
            "drift_rate": self.drift_rate,
        }

    @classmethod
    def from_dict(cls, data: dict) -> EmotionState:
        """从字典恢复。"""
        pad_data = data.get("pad", {})
        pad = PADValues(
            pleasure=pad_data.get("pleasure", 0.0),
            arousal=pad_data.get("arousal", 0.0),
            dominance=pad_data.get("dominance", 0.0),
        )
        return cls(
            pad=pad,
            hormones=dict(data.get("hormones", {})),
            mood_label=data.get("mood_label"),
            drift_rate=data.get("drift_rate", 0.02),
        )


# ============================================================
# 事件 → PAD 变化映射
# ============================================================


def _event_to_pad(event: str, intensity: float) -> tuple[float, float, float]:
    """将事件关键词映射到 PAD 变化量。

    Args:
        event: 事件描述
        intensity: 强度 (0~1)

    Returns:
        (delta_pleasure, delta_arousal, delta_dominance)
    """
    e = event.lower()
    i = intensity

    # 正向事件
    if any(kw in e for kw in ["表扬", "夸奖", "赞", "感谢", "开心", "喜欢"]):
        return (0.3 * i, 0.2 * i, 0.1 * i)

    # 负向事件
    if any(kw in e for kw in ["不满", "生气", "难过", "伤心", "讨厌"]):
        return (-0.3 * i, 0.3 * i, -0.2 * i)

    # 令人兴奋
    if any(kw in e for kw in ["兴奋", "激动", "惊喜", "有趣"]):
        return (0.2 * i, 0.4 * i, 0.2 * i)

    # 害怕/担忧
    if any(kw in e for kw in ["怕", "担心", "恐惧", "害怕"]):
        return (-0.2 * i, 0.3 * i, -0.3 * i)

    # 亲密/信任
    if any(kw in e for kw in ["信任", "亲密", "依赖", "告白"]):
        return (0.4 * i, 0.1 * i, 0.0)

    # 失败/挫折
    if any(kw in e for kw in ["失败", "出错", "搞砸", "挫折"]):
        return (-0.4 * i, 0.1 * i, -0.1 * i)

    # 默认：轻微愉悦 + 轻微唤醒
    return (0.05 * i, 0.1 * i, 0.0)
