"""人格动态漂移。

长期互动 → 人格微变化（经验塑造性格）
- 正向互动 → 诚实-谦逊、宜人性略微上升
- 高压力互动 → 情绪性略微上升
- 持续学习 → 开放性略微上升
- 共同完成任务 → 尽责性略微上升

漂移约束:
- 每次漂移幅度很小（±0.005 ~ ±0.02）
- 有基线约束（不偏离初始人格太远，±0.3 范围内）
- 漂移缓慢累积，需要数百次互动才会明显变化
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .personality import HEXACOPersonality


MAX_DRIFT_DELTA: float = 0.3     # 最大漂移幅度（偏离基线）
DEFAULT_DRIFT_RATE: float = 0.01  # 默认漂移速率


@dataclass
class PersonalityDrifter:
    """人格漂移引擎。"""

    baseline: HEXACOPersonality = field(default_factory=HEXACOPersonality)
    current: HEXACOPersonality = field(default_factory=HEXACOPersonality)
    drift_rate: float = DEFAULT_DRIFT_RATE
    history: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        # 如果 current 是默认值，用 baseline 初始化
        if self.current == HEXACOPersonality():
            object.__setattr__(self, "current", self.baseline)

    # ---- 漂移应用 ----

    def apply_drift(
        self,
        direction: dict[str, float],
        reason: str = "",
    ) -> HEXACOPersonality:
        """应用一次人格漂移。

        Args:
            direction: 各维度漂移方向和强度 {-0.02 ~ 0.02}
            reason: 漂移原因（记录到历史）

        Returns:
            漂移后的新人格
        """
        current_dict = self.current.to_simple_dict()
        baseline_dict = self.baseline.to_simple_dict()
        new_dict: dict[str, float] = {}

        for dim, current_val in current_dict.items():
            delta = direction.get(dim, 0.0)
            base_val = baseline_dict[dim]

            # 应用漂移
            new_val = current_val + delta * self.drift_rate

            # 基线约束：不偏离基线超过 MAX_DRIFT_DELTA
            min_val = max(0.0, base_val - MAX_DRIFT_DELTA)
            max_val = min(1.0, base_val + MAX_DRIFT_DELTA)
            new_val = max(min_val, min(max_val, new_val))

            new_dict[dim] = new_val

        new_personality = HEXACOPersonality.from_dict(new_dict)
        object.__setattr__(self, "current", new_personality)

        # 记录历史
        self.history.append({
            "timestamp": datetime.utcnow().isoformat(),
            "reason": reason,
            "direction": direction,
            "result": new_dict,
        })

        return new_personality

    # ---- 场景化漂移 ----

    def on_positive_interaction(self) -> HEXACOPersonality:
        """正向互动 → 诚实-谦逊↑、宜人性↑、外向性微↑"""
        return self.apply_drift(
            direction={
                "honesty_humility": 0.01,
                "agreeableness": 0.015,
                "extraversion": 0.005,
            },
            reason="positive_interaction",
        )

    def on_negative_interaction(self) -> HEXACOPersonality:
        """负面互动 → 情绪性↑、宜人性↓"""
        return self.apply_drift(
            direction={
                "emotionality": 0.01,
                "agreeableness": -0.01,
            },
            reason="negative_interaction",
        )

    def on_learning(self) -> HEXACOPersonality:
        """学习新东西 → 开放性↑"""
        return self.apply_drift(
            direction={
                "openness": 0.015,
            },
            reason="learning",
        )

    def on_shared_goal(self) -> HEXACOPersonality:
        """共同完成目标 → 尽责性↑、外向性↑"""
        return self.apply_drift(
            direction={
                "conscientiousness": 0.01,
                "extraversion": 0.008,
            },
            reason="shared_goal",
        )

    def on_emotional_support(self) -> HEXACOPersonality:
        """情感支持 → 情绪性↓、宜人性↑"""
        return self.apply_drift(
            direction={
                "emotionality": -0.008,
                "agreeableness": 0.01,
            },
            reason="emotional_support",
        )

    # ---- 重置 ----

    def reset(self) -> HEXACOPersonality:
        """重置回基线人格。"""
        object.__setattr__(self, "current", self.baseline)
        self.history.clear()
        return self.current
