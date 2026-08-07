"""Emotion Bridge — 身体事件 ↔ 汐月九维情绪 桥接服务（方案 A）。

desk-pet 的身体事件（交互/感知/对话情绪）通过此模块写入
`D:/hermes_env/shared/body/emotion.json` 的九维情绪；
反向将九维映射为 PAD 三维 + 情绪标签，供前端驱动 Live2D 表情。

所有参数（映射表/权重/节流/表情强度）集中在 `emotion_bridge_config.json`，
每次调用热加载 —— 修改配置无需重启服务。
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger("core-api.emotion-bridge")

CONFIG_PATH = Path(__file__).resolve().parent / "emotion_bridge_config.json"

# 节流状态：{(event, value): last_ts}
_throttle: dict[tuple[str, str], float] = {}


# ============================================================
# 配置
# ============================================================

def load_config() -> dict:
    """热加载配置（每次调用读文件，改 JSON 即生效）。"""
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:  # noqa: BLE001
        log.warning("load config failed: %s", exc)
        return {}


# ============================================================
# emotion.json 读写（原子）
# ============================================================

def _emotion_path(cfg: dict) -> Path:
    p = cfg.get("emotion_json_path") or "D:/hermes_env/shared/body/emotion.json"
    return Path(p)


def read_emotion(cfg: dict) -> dict:
    p = _emotion_path(cfg)
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {
            "last_updated": datetime.now().isoformat(),
            "current_mood": "",
            "emotional_dimensions": {},
            "emotional_history": [],
            "emotional_inertia": {"enabled": True, "smoothing_factor": 0.3},
            "evolution_log": [],
        }
    except Exception as exc:  # noqa: BLE001
        log.error("read emotion.json failed: %s", exc)
        raise


def write_emotion(cfg: dict, data: dict) -> None:
    """原子写入：先写临时文件再替换，避免并发读到半截。"""
    p = _emotion_path(cfg)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)


# ============================================================
# 核心：事件 → 九维
# ============================================================

def apply_event(event: str, value: Optional[str] = None, source: str = "desk-pet") -> dict:
    """应用一个身体事件到九维情绪。

    - event: interaction:pat / perception:gesture / perception:face_expr /
             dialogue_positive / dialogue_negative / idle
    - value: 子类型（手势符号、表情名），映射表为嵌套 dict 时必填
    """
    cfg = load_config()
    events = cfg.get("events", {})

    # 查映射
    mapping = events.get(event)
    if mapping is None:
        return {"applied": False, "reason": "unknown_event", "event": event}
    if isinstance(mapping, dict) and value is not None and value in mapping:
        mapping = mapping[value]
    if not isinstance(mapping, dict):
        return {"applied": False, "reason": "no_mapping", "event": event, "value": value}

    # 节流：同 (event, value) 在 throttle_ms 内只应用一次
    throttle_ms = int(cfg.get("throttle_ms", 5000))
    key = (event, value or "")
    now = time.time()
    if now - _throttle.get(key, 0) < throttle_ms / 1000:
        return {"applied": False, "reason": "throttled", "event": event, "value": value}
    _throttle[key] = now

    # 权重：交互类事件 × interaction，其余 × dialogue
    weights = cfg.get("weights", {})
    weight = weights.get("interaction", 0.3)
    if event.startswith(("dialogue", "idle")):
        weight = weights.get("dialogue", 0.7)

    # 读取当前情绪
    data = read_emotion(cfg)
    dims = data.setdefault("emotional_dimensions", {})
    dim_range = cfg.get("dimension_range", [0, 100])
    lo, hi = dim_range[0], dim_range[1]
    smoothing = float((data.get("emotional_inertia") or {}).get("smoothing_factor", 0.3))

    # 应用变化（smoothing：实际变化 = delta × (1 - smoothing) × weight）
    changed: dict[str, float] = {}
    for dim, delta in mapping.items():
        if dim not in dims:
            dims[dim] = 50.0
        effect = float(delta) * (1 - smoothing) * weight
        dims[dim] = max(lo, min(hi, float(dims[dim]) + effect))
        changed[dim] = round(dims[dim], 1)

    # 追加历史（保留最近 history_limit 条）
    history = data.setdefault("emotional_history", [])
    history.append(
        {
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "trigger": f"[{source}] {event}" + (f" {value}" if value else ""),
            "dimensions": changed,
            "intensity": weight,
            "decay_rate": 0,
        }
    )
    limit = int(cfg.get("history_limit", 20))
    if len(history) > limit:
        del history[: len(history) - limit]

    data["last_updated"] = datetime.now().isoformat()
    write_emotion(cfg, data)

    return {"applied": True, "event": event, "value": value, "dimensions": changed}


# ============================================================
# 反向：九维 → PAD + 情绪标签
# ============================================================

def get_state() -> dict:
    """读取九维，映射为 PAD 三维 + 情绪标签（供前端驱动表情）。"""
    cfg = load_config()
    data = read_emotion(cfg)
    dims = data.get("emotional_dimensions", {})

    pad = {"pleasure": 0.0, "arousal": 0.0, "dominance": 0.0}
    mapping = cfg.get("emotion_to_pad", {})
    for dim, coeffs in mapping.items():
        v = dims.get(dim, 50.0)
        norm = v / 50.0 - 1.0  # 0-100 → -1~1
        for k, c in coeffs.items():
            pad[k] = pad.get(k, 0.0) + norm * float(c)
    for k in pad:
        pad[k] = round(max(-1.0, min(1.0, pad[k])), 3)

    # 复用 emotion.py 的 PAD→标签逻辑
    mood_label = _pad_to_mood(pad)

    # 最近情绪变化记录（供 UI 展示触发来源与折线图）
    history = data.get("emotional_history", [])[-20:]

    return {
        "dimensions": dims,
        "pad": pad,
        "mood_label": mood_label,
        "expression_scale": float(cfg.get("expression_scale", 0.6)),
        "last_updated": data.get("last_updated"),
        "recent_history": history,
    }


def _pad_to_mood(pad: dict) -> str:
    """PAD 三维 → 情绪标签（与 desk-pet heart/emotion.py 语义对齐）。"""
    p, a, d = pad.get("pleasure", 0), pad.get("arousal", 0), pad.get("dominance", 0)
    if p > 0.5 and a > 0.3:
        return "excited"
    if p > 0.5:
        return "happy"
    if p < -0.3 and d < -0.3:
        return "sad"
    if p < -0.3 and a > 0.4:
        return "anxious"
    if p < -0.3:
        return "angry"
    if a < -0.3:
        return "calm"
    return "neutral"
