"""Ebbinghaus 遗忘曲线。

参考 Bitterbot 的遗忘机制：
    new_importance = old_importance * (1 - decay_rate / (1 + access_count * reinforcement))

遗忘阶段：
    Active    → 0-14 天（正常使用）
    Cooling   → 14-30 天（降温，向量保留）
    Frozen    → 30-90 天（冻结，删除向量）
    Tombstone → 90+  天（墓碑，内容清除）

永久记忆（is_permanent=True）：
    - 跳过遗忘曲线，永远保持 active 状态
    - 不会被 Archivist 清理
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .fragment import MemoryFragment


# ============================================================
# 配置常量
# ============================================================

DECAY_RATE: float = 0.1          # 基础遗忘率
MIN_STRENGTH: float = 0.01       # 最低保留强度
REINFORCEMENT_FACTOR: float = 0.1  # 访问强化因子
PERMANENT_IMPORTANCE_FLOOR: float = 0.5  # 永久记忆最低重要性

# 阶段阈值（天数）
THRESHOLD_COOLING: int = 14      # 降温阈值
THRESHOLD_FROZEN: int = 30       # 冻结阈值
THRESHOLD_TOMBSTONE: int = 90    # 墓碑阈值


@dataclass
class DecayResult:
    """遗忘计算结果。"""

    new_importance: float
    stage: str          # active / cooling / frozen / tombstone
    days_since_access: int
    should_keep: bool   # 是否保留（tombstone 时 False）


def compute_importance(
    fragment: MemoryFragment,
    decay_rate: float = DECAY_RATE,
    reinforcement: float = REINFORCEMENT_FACTOR,
    min_strength: float = MIN_STRENGTH,
) -> float:
    """计算遗忘后的重要性。

    永久记忆不衰减，至少保持 0.5 的基础重要性。

    公式：
        new_imp = old_imp * (1 - decay / (1 + access_count * reinforcement))

    Args:
        fragment: 记忆碎片
        decay_rate: 遗忘率
        reinforcement: 访问强化因子
        min_strength: 最低保留强度

    Returns:
        新的重要性值（0.0-1.0）
    """
    if fragment.is_permanent:
        return max(fragment.importance, PERMANENT_IMPORTANCE_FLOOR)

    denominator = 1 + fragment.access_count * reinforcement
    decay = decay_rate / denominator
    new_imp = fragment.importance * (1 - decay)
    return max(min_strength, new_imp)


def classify_stage(fragment: MemoryFragment) -> str:
    """分类记忆的生命周期阶段。

    永久记忆永远是 active 状态。

    Args:
        fragment: 记忆碎片

    Returns:
        阶段名称: active / cooling / frozen / tombstone
    """
    if fragment.is_permanent:
        return "active"

    days = (datetime.utcnow() - fragment.last_accessed).total_seconds() / 86400

    if days >= THRESHOLD_TOMBSTONE:
        return "tombstone"
    if days >= THRESHOLD_FROZEN:
        return "frozen"
    if days >= THRESHOLD_COOLING:
        return "cooling"
    return "active"


def apply_decay(fragment: MemoryFragment) -> DecayResult:
    """对记忆碎片应用遗忘曲线。

    永久记忆跳过遗忘计算，直接返回 active 状态。

    Args:
        fragment: 记忆碎片

    Returns:
        DecayResult 包含新的重要性、阶段、是否保留
    """
    if fragment.is_permanent:
        return DecayResult(
            new_importance=fragment.importance,
            stage="active",
            days_since_access=0,
            should_keep=True,
        )

    stage = classify_stage(fragment)
    days = (datetime.utcnow() - fragment.last_accessed).total_seconds() / 86400
    days_int = int(days)

    if stage == "tombstone":
        return DecayResult(
            new_importance=0.0,
            stage=stage,
            days_since_access=days_int,
            should_keep=False,
        )

    new_imp = compute_importance(fragment)
    return DecayResult(
        new_importance=new_imp,
        stage=stage,
        days_since_access=days_int,
        should_keep=True,
    )


def should_reinforce(fragment: MemoryFragment) -> bool:
    """判断是否应该强化。

    永久记忆不需要额外强化（它始终活跃）。
    """
    if fragment.is_permanent:
        return False
    stage = classify_stage(fragment)
    return stage in ("cooling", "frozen")
