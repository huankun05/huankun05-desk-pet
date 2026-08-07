"""
Hermes 技能 → desk-pet Behavior 系统桥接

Hermes 的 slash 技能系统（以 / 开头的命令）通过此模块
映射到 desk-pet 前端的 BehaviorRegistry 事件分发。

映射表定义在 data/hermes_skill_map.json 中，支持热加载。
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger("hermes-skills-bridge")

# 默认技能映射表
_DEFAULT_SKILL_MAP: dict[str, str] = {
    "/help": "show_help",
    "/status": "show_status",
    "/emotion": "show_emotion",
    "/memory": "search_memory",
    "/clear": "clear_context",
    "/reset": "reset_personality",
    "/time": "show_time",
    "/dance": "trigger_dance",
    "/pet": "request_pet",
    "/sleep": "enter_sleep",
}


def _get_map_path() -> Path:
    """技能映射表路径：<desk-pet>/data/hermes_skill_map.json"""
    from core.session_service import get_session_db_path
    db_path = get_session_db_path()
    return db_path.parent / "hermes_skill_map.json"


def load_skill_map() -> dict[str, str]:
    """加载技能映射表。"""
    path = _get_map_path()
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except Exception as exc:
            log.warning("Failed to load skill map: %s", exc)
    return dict(_DEFAULT_SKILL_MAP)


def save_skill_map(mapping: dict[str, str]) -> None:
    """保存技能映射表。"""
    path = _get_map_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Skill map saved: %d entries", len(mapping))


def detect_skill(text: str) -> Optional[tuple[str, str, str]]:
    """
    检测文本是否为技能调用。

    Returns:
        (完整命令, 技能名, 行为事件名) 或 None
    """
    text = text.strip()
    if not text.startswith("/"):
        return None

    # 提取命令（空格前的内容）
    parts = text.split(" ", 1)
    cmd = parts[0].lower()
    args = parts[1] if len(parts) > 1 else ""

    skill_map = load_skill_map()
    behavior_event = skill_map.get(cmd)

    if behavior_event:
        return (cmd, behavior_event, args)
    return None


def get_all_skills() -> list[dict]:
    """获取所有已注册的技能（含内置 + 自定义）。"""
    skill_map = load_skill_map()
    skills = []
    for cmd, behavior_event in skill_map.items():
        skills.append({
            "command": cmd,
            "behavior_event": behavior_event,
            "description": _get_skill_description(cmd, behavior_event),
            "is_builtin": cmd in _DEFAULT_SKILL_MAP,
        })
    return skills


def _get_skill_description(cmd: str, behavior_event: str) -> str:
    """获取技能描述。"""
    descriptions = {
        "/help": "显示帮助菜单",
        "/status": "查看宠物状态",
        "/emotion": "查看当前情绪",
        "/memory": "搜索记忆",
        "/clear": "清除对话上下文",
        "/reset": "重置人格状态",
        "/time": "查看当前时间",
        "/dance": "让宠物跳舞",
        "/pet": "请求抚摸",
        "/sleep": "进入睡眠模式",
    }
    return descriptions.get(cmd, f"触发 {behavior_event} 行为")