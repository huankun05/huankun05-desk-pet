"""核心引擎 API 服务。

暴露 Brain/Heart/Soul/Time 四大系统的 HTTP API。
默认端口: 9877（与 admin server 的 9876 区分）

启动: python -m server.core.api_server --port 9877
"""
from __future__ import annotations

import argparse
import json
import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Generator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .heart.emotion import PADValues, EmotionState
from .heart.hormones import HormonalSystem, HormonalEngine
from .heart.expression import ExpressionEngine, ExpressionStrategy
from .brain.fragment import MemoryFragment
from .brain.decay import apply_decay
from .soul.personality import HEXACOPersonality
from .soul.soul_file import SoulFile
from .time.circadian import CircadianRhythm
from .time.reunion import ReunionEngine
from . import session_service
from . import emotion_bridge
from . import interaction_agg

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("core-api")


# ============================================================
# 工具函数
# ============================================================

_CN_MOOD_TO_EN: dict[str, str] = {
    "开心": "happy",
    "悲伤": "sad",
    "焦虑": "anxious",
    "平静": "calm",
    "兴奋": "excited",
    "愤怒": "angry",
    "疲惫": "tired",
    "温和": "gentle",
}


def _cn_mood_to_en(cn_label: str) -> str:
    return _CN_MOOD_TO_EN.get(cn_label, "calm")


# ============================================================
# 数据库
# ============================================================

_DEFAULT_DB_PATH = Path(__file__).parent.parent.parent / "data" / "core.db"


def get_db_path() -> Path:
    return _DEFAULT_DB_PATH


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _ensure_column(db: sqlite3.Connection, table: str, column: str, ddl: str) -> bool:
    """幂等补列：老库升级时 CREATE TABLE IF NOT EXISTS 不会给已存在的旧表补列，
    需显式 ALTER TABLE ADD COLUMN。返回是否执行了补列。"""
    try:
        existing = {r[1] for r in db.execute(f"PRAGMA table_info({table})")}
    except sqlite3.Error:
        return False
    if column in existing:
        return False
    db.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")
    log.info("Schema migrate: %s.%s added", table, column)
    return True


def migrate_db(db: sqlite3.Connection) -> None:
    """老库 schema 增量迁移（幂等）：新增列必须显式补上，避免
    row['<新列>'] 抛 IndexError（如 emotion_states.boredom/loneliness）。
    传入已打开的连接，由调用方管理事务/关闭。"""
    _ensure_column(db, "emotion_states", "boredom", "boredom REAL NOT NULL DEFAULT 0.0")
    _ensure_column(db, "emotion_states", "loneliness", "loneliness REAL NOT NULL DEFAULT 0.0")
    _ensure_column(db, "memory_fragments", "emotion_snapshot", "emotion_snapshot TEXT DEFAULT '{}'")


def init_db() -> None:
    """初始化数据库表。"""
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS emotion_states (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id TEXT DEFAULT 'default',
                pleasure REAL NOT NULL DEFAULT 0.0,
                arousal REAL NOT NULL DEFAULT 0.0,
                dominance REAL NOT NULL DEFAULT 0.0,
                dopamine REAL NOT NULL DEFAULT 0.5,
                cortisol REAL NOT NULL DEFAULT 0.3,
                oxytocin REAL NOT NULL DEFAULT 0.5,
                boredom REAL NOT NULL DEFAULT 0.0,
                loneliness REAL NOT NULL DEFAULT 0.0,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_emotion_character_id ON emotion_states(character_id);

            CREATE TABLE IF NOT EXISTS emotion_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id TEXT DEFAULT 'default',
                pleasure REAL NOT NULL,
                arousal REAL NOT NULL,
                dominance REAL NOT NULL,
                trigger TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_emotion_history_character_id ON emotion_history(character_id);
            CREATE INDEX IF NOT EXISTS idx_emotion_history_created ON emotion_history(created_at);

            CREATE TABLE IF NOT EXISTS personality_states (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id TEXT DEFAULT 'default',
                honesty_humility REAL NOT NULL DEFAULT 0.5,
                emotionality REAL NOT NULL DEFAULT 0.5,
                extraversion REAL NOT NULL DEFAULT 0.5,
                agreeableness REAL NOT NULL DEFAULT 0.5,
                conscientiousness REAL NOT NULL DEFAULT 0.5,
                openness REAL NOT NULL DEFAULT 0.5,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_personality_character_id ON personality_states(character_id);

            CREATE TABLE IF NOT EXISTS memory_fragments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id TEXT DEFAULT 'default',
                user_id TEXT DEFAULT 'default',
                content TEXT NOT NULL,
                importance REAL NOT NULL DEFAULT 0.5,
                access_count INTEGER NOT NULL DEFAULT 0,
                last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
                is_permanent INTEGER NOT NULL DEFAULT 0,
                embedding TEXT DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                emotion_snapshot TEXT DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_memory_character_id ON memory_fragments(character_id);
            CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory_fragments(importance DESC);
            CREATE INDEX IF NOT EXISTS idx_memory_content ON memory_fragments(content);
            CREATE INDEX IF NOT EXISTS idx_memory_permanent ON memory_fragments(is_permanent);

            CREATE TABLE IF NOT EXISTS last_seen (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id TEXT DEFAULT 'default',
                user_id TEXT DEFAULT 'default',
                last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(character_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_lastseen_character_user ON last_seen(character_id, user_id);

            CREATE TABLE IF NOT EXISTS interaction_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id TEXT DEFAULT 'default',
                category TEXT NOT NULL,
                subcategory TEXT NOT NULL,
                messages TEXT NOT NULL,
                emotion TEXT,
                time_of_day TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(character_id, category, subcategory)
            );
            CREATE INDEX IF NOT EXISTS idx_interaction_messages_char_cat ON interaction_messages(character_id, category);
        """)

        # 老库增量迁移：CREATE TABLE IF NOT EXISTS 不会给旧表补列，缺列显式 ALTER
        migrate_db(db)

        # 插入默认情绪状态（如果不存在）
        cursor = db.execute("SELECT COUNT(*) as cnt FROM emotion_states WHERE character_id = 'default'")
        if cursor.fetchone()["cnt"] == 0:
            db.execute(
                "INSERT INTO emotion_states (character_id) VALUES ('default')"
            )

        # 插入默认人格状态
        cursor = db.execute("SELECT COUNT(*) as cnt FROM personality_states WHERE character_id = 'default'")
        if cursor.fetchone()["cnt"] == 0:
            db.execute(
                "INSERT INTO personality_states (character_id) VALUES ('default')"
            )
    log.info("Database initialized at %s", get_db_path())


# ============================================================
# Pydantic Models
# ============================================================


class EmotionEventRequest(BaseModel):
    event: str
    character_id: str = "default"


class EmotionStateResponse(BaseModel):
    pad: dict
    mood_label: str
    mood_label_cn: str
    hormones: dict
    expression: dict
    circadian_pad: dict
    updated_at: str


class PersonalityResponse(BaseModel):
    hexaco: dict
    description: str
    pad_baseline: dict
    updated_at: str


class PersonalityDriftRequest(BaseModel):
    drift_type: str  # positive_interaction / negative_interaction / learning / shared_goal / emotional_support
    character_id: str = "default"


class PersonalityUpdateRequest(BaseModel):
    """手动设定/调整 HEXACO 人格（用户设定初始状态）；reset=True 恢复默认 0.5。"""

    honesty_humility: float | None = None
    emotionality: float | None = None
    extraversion: float | None = None
    agreeableness: float | None = None
    conscientiousness: float | None = None
    openness: float | None = None
    reset: bool = False
    character_id: str = "default"


class MemoryFragmentCreate(BaseModel):
    content: str
    importance: float = 0.5
    is_permanent: bool = False
    character_id: str = "default"
    user_id: str = "default"
    emotion_snapshot: dict[str, float] | None = None



class MemoryExtractRequest(BaseModel):
    user_text: str
    assistant_text: str
    character_id: str = "default"
    user_id: str = "default"
    use_llm: bool = False


class MemoryPermanentRequest(BaseModel):
    is_permanent: bool



class MemorySearchRequest(BaseModel):
    query: str = ""
    limit: int = 10
    character_id: str = "default"


class ReunionCheckRequest(BaseModel):
    character_id: str = "default"
    user_id: str = "default"


# ---- Session / Hermes 大脑会话 ----


class SessionCreateRequest(BaseModel):
    session_id: str
    source: str = "desk-pet"


class SessionAppendRequest(BaseModel):
    role: str
    content: str
    token_count: int | None = None


class SessionSearchRequest(BaseModel):
    query: str
    limit: int = 10


class UnifiedSearchRequest(BaseModel):
    query: str
    limit: int = 10
    character_id: str = "default"


class EmotionBridgeEventRequest(BaseModel):
    event: str
    value: str | None = None
    source: str = "desk-pet"


class InteractionMessage(BaseModel):
    id: int | None = None
    character_id: str = "default"
    category: str
    subcategory: str
    messages: list[str]
    emotion: str | None = None
    time_of_day: str | None = None
    enabled: bool = True
    updated_at: str | None = None


class InteractionMessageUpdate(BaseModel):
    messages: list[str] | None = None
    emotion: str | None = None
    time_of_day: str | None = None
    enabled: bool | None = None


# ============================================================
# Service 层
# ============================================================


class EmotionService:
    """情感服务：状态持久化 + 事件处理 + 历史记录。"""

    @staticmethod
    def _get_pad_baseline(character_id: str = "default"):
        """人格 → PAD 情绪基线（人格影响情绪的回路）。

        读取 HEXACO 六维 → pad_baseline_influence() 得到情绪回落目标点。
        返回 PADValues 或 None（人格表缺失时）。
        """
        try:
            from .soul.personality import HEXACOPersonality

            with get_db() as db:
                row = db.execute(
                    "SELECT * FROM personality_states WHERE character_id = ?",
                    (character_id,),
                ).fetchone()
                if row is None:
                    return None
                hexaco = HEXACOPersonality(
                    honesty_humility=row["honesty_humility"],
                    emotionality=row["emotionality"],
                    extraversion=row["extraversion"],
                    agreeableness=row["agreeableness"],
                    conscientiousness=row["conscientiousness"],
                    openness=row["openness"],
                )
            return hexaco.pad_baseline_influence()
        except Exception:
            return None

    @staticmethod
    def _get_drift_rate(character_id: str = "default") -> float:
        """人格化情绪回落速率：情绪性高 → 回落慢（情绪更持久/更敏感），
        情绪性低 → 回落快（冷静）。基线 0.02，范围 0.01 ~ 0.05。"""
        try:
            with get_db() as db:
                row = db.execute(
                    "SELECT emotionality FROM personality_states WHERE character_id = ?",
                    (character_id,),
                ).fetchone()
            if row is None or row["emotionality"] is None:
                return 0.02
            emotionality = float(row["emotionality"])
            return max(0.01, min(0.05, 0.02 * (1.5 - emotionality)))
        except Exception:
            return 0.02

    @staticmethod
    def apply_drift_from_event(event: str, character_id: str = "default") -> None:
        """情绪 → 人格 回路：按事件正负缓慢漂移 HEXACO 人格。

        正向互动 → 诚实-谦逊/宜人性微升；负面互动 → 情绪性升/宜人性降；
        学习类事件 → 开放性微升。漂移幅度很小（±0.01），需数百次互动才明显。
        失败静默（锦上添花，不影响情绪主流程）。
        """
        try:
            from .soul.drift import PersonalityDrifter
            from .soul.personality import HEXACOPersonality

            with get_db() as db:
                row = db.execute(
                    "SELECT * FROM personality_states WHERE character_id = ?",
                    (character_id,),
                ).fetchone()
                if row is None:
                    return
                current = HEXACOPersonality(
                    honesty_humility=row["honesty_humility"],
                    emotionality=row["emotionality"],
                    extraversion=row["extraversion"],
                    agreeableness=row["agreeableness"],
                    conscientiousness=row["conscientiousness"],
                    openness=row["openness"],
                )

            e = event.lower()
            if any(kw in e for kw in ["表扬", "夸奖", "赞", "感谢", "开心", "喜欢", "pat", "tap"]):
                drift_type = "positive_interaction"
            elif any(kw in e for kw in ["不满", "生气", "难过", "伤心", "讨厌", "step", "踩脚", "频繁"]):
                drift_type = "negative_interaction"
            elif any(kw in e for kw in ["学习", "learn", "记忆", "好奇", "探索"]):
                drift_type = "learning"
            else:
                return

            drifter = PersonalityDrifter(baseline=current, current=current)
            method = {
                "positive_interaction": drifter.on_positive_interaction,
                "negative_interaction": drifter.on_negative_interaction,
                "learning": drifter.on_learning,
            }[drift_type]
            new_personality = method()

            with get_db() as db:
                db.execute(
                    """UPDATE personality_states SET
                       honesty_humility=?, emotionality=?, extraversion=?,
                       agreeableness=?, conscientiousness=?, openness=?,
                       updated_at=datetime('now') WHERE character_id=?""",
                    (
                        new_personality.honesty_humility,
                        new_personality.emotionality,
                        new_personality.extraversion,
                        new_personality.agreeableness,
                        new_personality.conscientiousness,
                        new_personality.openness,
                        character_id,
                    ),
                )
        except Exception:
            pass

    @staticmethod
    def get_state(character_id: str = "default") -> dict:
        with get_db() as db:
            row = db.execute(
                "SELECT * FROM emotion_states WHERE character_id = ?",
                (character_id,),
            ).fetchone()

            if row is None:
                db.execute(
                    "INSERT INTO emotion_states (character_id) VALUES (?)",
                    (character_id,),
                )
                row = db.execute(
                    "SELECT * FROM emotion_states WHERE character_id = ?",
                    (character_id,),
                ).fetchone()

        pad = PADValues(
            pleasure=row["pleasure"],
            arousal=row["arousal"],
            dominance=row["dominance"],
        )
        hormones = HormonalSystem(
            dopamine=row["dopamine"],
            cortisol=row["cortisol"],
            oxytocin=row["oxytocin"],
        )
        # 人格 → 情绪：接入 HEXACO 人格基线，情绪向人格基线自然回落
        baseline = EmotionService._get_pad_baseline(character_id)
        drift_rate = EmotionService._get_drift_rate(character_id)
        emotion_state = EmotionState(pad=pad, baseline=baseline, drift_rate=drift_rate)

        # 每次读取时向人格基线漂移一次并持久化（人格塑造情绪的「活」回路）
        if baseline is not None:
            emotion_state.drift()
            if emotion_state.pad != pad:
                with get_db() as db:
                    db.execute(
                        """UPDATE emotion_states
                           SET pleasure=?, arousal=?, dominance=?,
                               updated_at=datetime('now')
                           WHERE character_id=?""",
                        (
                            emotion_state.pad.pleasure,
                            emotion_state.pad.arousal,
                            emotion_state.pad.dominance,
                            character_id,
                        ),
                    )
                pad = emotion_state.pad

        expression = ExpressionEngine().build_strategy_from_emotion_state(emotion_state)
        # 时间节律（昼夜）轻微影响情绪：白天唤醒略高、深夜愉悦略低（±15% 权重）。
        # 仅影响展示/表情，不写库（临时叠加，回落仍以人格基线为目标）
        circadian = CircadianRhythm().pad_influence()
        pad_with_circadian = PADValues(
            pleasure=pad.pleasure + circadian.pleasure * 0.15,
            arousal=pad.arousal + circadian.arousal * 0.15,
            dominance=pad.dominance,
        )

        mood_cn = EmotionState(pad=pad_with_circadian, baseline=baseline).get_mood_label()
        mood_en = _cn_mood_to_en(mood_cn)
        return {
            "pad": pad_with_circadian.to_dict(),
            "mood_label": mood_en,
            "mood_label_cn": mood_cn,
            "hormones": hormones.to_dict(),
            "expression": expression.to_dict(),
            "circadian_pad": circadian.to_dict(),
            "updated_at": row["updated_at"],
            "boredom": float(row["boredom"] or 0),
            "loneliness": float(row["loneliness"] or 0),
        }

    @staticmethod
    def process_event(event: str, character_id: str = "default") -> dict:
        state = EmotionService.get_state(character_id)
        current_pad = PADValues(**{k: state["pad"][k] for k in ("pleasure", "arousal", "dominance")})
        current_hormones = HormonalSystem(**{k: state["hormones"][k] for k in ("dopamine", "cortisol", "oxytocin")})

        # 激素处理
        hormonal_engine = HormonalEngine()
        new_hormones = hormonal_engine.process_event(event, current_hormones)
        new_hormones = hormonal_engine.decay_all(new_hormones, minutes=0.1)

        # 激素对 PAD 的影响
        hormone_pad = hormonal_engine.pad_influence(new_hormones)

        # 事件对 PAD 的直接影响（关键词触发），带人格基线（回落目标）
        emotion_state = EmotionState(
            pad=current_pad,
            baseline=EmotionService._get_pad_baseline(character_id),
        )
        emotion_state.apply_event(event)

        # 合并：基础 PAD + 激素影响 + 事件直接影响
        event_pleasure_delta = emotion_state.pad.pleasure - current_pad.pleasure
        event_arousal_delta = emotion_state.pad.arousal - current_pad.arousal
        event_dominance_delta = emotion_state.pad.dominance - current_pad.dominance

        new_pad = PADValues(
            pleasure=max(-1.0, min(1.0, current_pad.pleasure + hormone_pad.pleasure * 0.3 + event_pleasure_delta)),
            arousal=max(-1.0, min(1.0, current_pad.arousal + hormone_pad.arousal * 0.3 + event_arousal_delta)),
            dominance=max(-1.0, min(1.0, current_pad.dominance + hormone_pad.dominance * 0.3 + event_dominance_delta)),
        )

        boredom = max(0.0, min(100.0, state.get("boredom", 0) - 15))
        loneliness = max(0.0, min(100.0, state.get("loneliness", 0) - 10))

        # 写回数据库
        with get_db() as db:
            db.execute(
                """UPDATE emotion_states
                   SET pleasure = ?, arousal = ?, dominance = ?,
                       dopamine = ?, cortisol = ?, oxytocin = ?,
                       boredom = ?, loneliness = ?,
                       updated_at = datetime('now')
                   WHERE character_id = ?""",
                (
                    new_pad.pleasure, new_pad.arousal, new_pad.dominance,
                    new_hormones.dopamine, new_hormones.cortisol, new_hormones.oxytocin,
                    float(boredom), float(loneliness),
                    character_id,
                ),
            )
            # 写入历史
            db.execute(
                """INSERT INTO emotion_history
                   (character_id, pleasure, arousal, dominance, trigger)
                   VALUES (?, ?, ?, ?, ?)""",
                (character_id, new_pad.pleasure, new_pad.arousal, new_pad.dominance, event[:200]),
            )

        # 情绪 → 人格：按事件正负缓慢漂移 HEXACO（长期互动塑造性格）
        EmotionService.apply_drift_from_event(event, character_id)

        return EmotionService.get_state(character_id)

    @staticmethod
    def get_history(character_id: str = "default", limit: int = 50) -> list[dict]:
        with get_db() as db:
            rows = db.execute(
                """SELECT * FROM emotion_history
                   WHERE character_id = ?
                   ORDER BY id DESC LIMIT ?""",
                (character_id, limit),
            ).fetchall()
        return [dict(row) for row in rows]


class PersonalityService:
    """人格服务：状态持久化 + 漂移 + 描述生成。"""

    @staticmethod
    def get_personality(character_id: str = "default") -> dict:
        with get_db() as db:
            row = db.execute(
                "SELECT * FROM personality_states WHERE character_id = ?",
                (character_id,),
            ).fetchone()

            if row is None:
                db.execute(
                    "INSERT INTO personality_states (character_id) VALUES (?)",
                    (character_id,),
                )
                row = db.execute(
                    "SELECT * FROM personality_states WHERE character_id = ?",
                    (character_id,),
                ).fetchone()

        hexaco = HEXACOPersonality(
            honesty_humility=row["honesty_humility"],
            emotionality=row["emotionality"],
            extraversion=row["extraversion"],
            agreeableness=row["agreeableness"],
            conscientiousness=row["conscientiousness"],
            openness=row["openness"],
        )
        pad_baseline = hexaco.pad_baseline_influence()

        return {
            "hexaco": hexaco.to_simple_dict(),
            "hexaco_detail": hexaco.to_dict(),
            "description": hexaco.describe(),
            "pad_baseline": pad_baseline.to_dict(),
            "updated_at": row["updated_at"],
        }

    @staticmethod
    def update_personality(
        fields: dict,
        character_id: str = "default",
        reset: bool = False,
    ) -> dict:
        """手动设定/调整 HEXACO 人格（用户设定初始状态），或 reset 恢复默认 0.5。

        手动设定会同步刷新情绪基线（下一次 get_state 生效），并保留后续自动漂移的
        基线约束（MAX_DRIFT_DELTA 相对新值）。
        """
        dims = (
            "honesty_humility",
            "emotionality",
            "extraversion",
            "agreeableness",
            "conscientiousness",
            "openness",
        )

        with get_db() as db:
            row = db.execute(
                "SELECT * FROM personality_states WHERE character_id = ?",
                (character_id,),
            ).fetchone()
            if row is None:
                db.execute(
                    "INSERT INTO personality_states (character_id) VALUES (?)",
                    (character_id,),
                )
                row = db.execute(
                    "SELECT * FROM personality_states WHERE character_id = ?",
                    (character_id,),
                ).fetchone()

        if reset:
            new_values = {d: 0.5 for d in dims}
        else:
            new_values = {
                d: float(fields.get(d, row[d]))
                for d in dims
            }
        new_values = {d: max(0.0, min(1.0, v)) for d, v in new_values.items()}

        with get_db() as db:
            db.execute(
                """UPDATE personality_states SET
                   honesty_humility=?, emotionality=?, extraversion=?,
                   agreeableness=?, conscientiousness=?, openness=?,
                   updated_at=datetime('now')
                   WHERE character_id=?""",
                (
                    new_values["honesty_humility"],
                    new_values["emotionality"],
                    new_values["extraversion"],
                    new_values["agreeableness"],
                    new_values["conscientiousness"],
                    new_values["openness"],
                    character_id,
                ),
            )

        return PersonalityService.get_personality(character_id)

    @staticmethod
    def apply_drift(drift_type: str, character_id: str = "default") -> dict:
        from .soul.drift import PersonalityDrifter

        state = PersonalityService.get_personality(character_id)
        current = HEXACOPersonality.from_dict(state["hexaco"])
        baseline = current  # 简化：用当前值做基线

        drifter = PersonalityDrifter(baseline=baseline, current=current)

        drift_methods = {
            "positive_interaction": drifter.on_positive_interaction,
            "negative_interaction": drifter.on_negative_interaction,
            "learning": drifter.on_learning,
            "shared_goal": drifter.on_shared_goal,
            "emotional_support": drifter.on_emotional_support,
        }

        method = drift_methods.get(drift_type)
        if method is None:
            raise HTTPException(status_code=400, detail=f"Unknown drift type: {drift_type}")

        new_personality = method()

        # 写回数据库
        with get_db() as db:
            db.execute(
                """UPDATE personality_states
                   SET honesty_humility = ?, emotionality = ?, extraversion = ?,
                       agreeableness = ?, conscientiousness = ?, openness = ?,
                       updated_at = datetime('now')
                   WHERE character_id = ?""",
                (
                    new_personality.honesty_humility,
                    new_personality.emotionality,
                    new_personality.extraversion,
                    new_personality.agreeableness,
                    new_personality.conscientiousness,
                    new_personality.openness,
                    character_id,
                ),
            )

        return PersonalityService.get_personality(character_id)


class MemoryService:
    """记忆服务：碎片管理 + 遗忘 + 检索。"""

    @staticmethod
    def add_fragment(data: MemoryFragmentCreate) -> dict:
        with get_db() as db:
            cursor = db.execute(
                """INSERT INTO memory_fragments
                   (character_id, user_id, content, importance, is_permanent, emotion_snapshot)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    data.character_id, data.user_id, data.content,
                    max(0.0, min(1.0, data.importance)), 1 if data.is_permanent else 0,
                    json.dumps(data.emotion_snapshot or {}),
                ),
            )
            frag_id = cursor.lastrowid
        return MemoryService.get_fragment(frag_id)


    @staticmethod
    def extract_from_exchange(
        user_text: str,
        assistant_text: str,
        character_id: str = "default",
        user_id: str = "default",
        context: str = "",
        use_llm: bool = False,
        emotion_snapshot: dict[str, float] | None = None,
    ) -> dict:
        """从对话交换中提取记忆碎片并持久化。"""
        from server.core.brain.scribe import Scribe, ExtractionConfig
        from server.core.brain.store import MemoryStore

        try:
            store = MemoryStore(character_id=character_id, user_id=user_id)
            scribe = Scribe(
                store=store,
                config=ExtractionConfig(enable_llm=use_llm),
            )
            fragments = scribe.extract_from_exchange(
                user_text=user_text,
                assistant_text=assistant_text,
                context=context,
                emotion_snapshot=emotion_snapshot,
            )
            saved = scribe.save_fragments(fragments)
            return {"extracted": len(saved), "fragments": [f.to_dict() for f in saved]}
        except Exception as exc:
            return {"extracted": 0, "error": str(exc)}

        return MemoryService.get_fragment(frag_id)

    @staticmethod
    def get_fragment(frag_id: int) -> dict:
        with get_db() as db:
            row = db.execute(
                "SELECT * FROM memory_fragments WHERE id = ?", (frag_id,),
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Memory fragment not found")
        return MemoryService._row_to_dict(row)

    @staticmethod
    def list_fragments(character_id: str = "default", limit: int = 50) -> list[dict]:
        with get_db() as db:
            rows = db.execute(
                """SELECT * FROM memory_fragments
                   WHERE character_id = ?
                   ORDER BY importance DESC, created_at DESC
                   LIMIT ?""",
                (character_id, limit),
            ).fetchall()
        return [MemoryService._row_to_dict(row) for row in rows]

    @staticmethod
    def search(query: str, character_id: str = "default", limit: int = 10) -> list[dict]:
        if not query.strip():
            return MemoryService.list_fragments(character_id, limit)
        with get_db() as db:
            rows = db.execute(
                """SELECT * FROM memory_fragments
                   WHERE character_id = ? AND content LIKE ?
                   ORDER BY importance DESC
                   LIMIT ?""",
                (character_id, f"%{query}%", limit),
            ).fetchall()
        result = [MemoryService._row_to_dict(row) for row in rows]
        # 标记访问
        for frag in result:
            MemoryService.touch(frag["id"])
        return result

    @staticmethod
    def touch(frag_id: int) -> None:
        with get_db() as db:
            db.execute(
                """UPDATE memory_fragments
                   SET access_count = access_count + 1,
                       last_accessed = datetime('now')
                   WHERE id = ?""",
                (frag_id,),
            )

    @staticmethod
    def set_permanent(frag_id: int, is_permanent: bool) -> dict:
        with get_db() as db:
            db.execute(
                "UPDATE memory_fragments SET is_permanent = ? WHERE id = ?",
                (1 if is_permanent else 0, frag_id),
            )
        return MemoryService.get_fragment(frag_id)

    @staticmethod
    def delete(frag_id: int) -> dict:
        with get_db() as db:
            db.execute("DELETE FROM memory_fragments WHERE id = ?", (frag_id,))
        return {"success": True, "id": frag_id}

    @staticmethod
    def apply_decay_all(character_id: str = "default") -> dict:
        """对所有非永久记忆应用遗忘曲线 + 中等遗忘策略（importance<0.3 且 30 天未访问 → 删除）。"""
        from datetime import datetime as _dt
        frags = MemoryService.list_fragments(character_id, limit=1000)
        changed = 0
        deleted = 0
        with get_db() as db:
            for frag in frags:
                if frag["is_permanent"]:
                    continue
                mf = MemoryFragment(
                    id=frag["id"],
                    content=frag["content"],
                    importance=frag["importance"],
                    access_count=frag["access_count"],
                    is_permanent=frag["is_permanent"],
                )
                result = apply_decay(mf)
                should_delete = False
                if result.new_importance < 0.3 and frag["access_count"] == 0:
                    try:
                        last_acc = _dt.fromisoformat(frag["last_accessed"])
                        days_since = (_dt.now() - last_acc).days
                        if days_since > 30:
                            should_delete = True
                    except Exception:
                        pass
                if should_delete:
                    db.execute("DELETE FROM memory_fragments WHERE id = ?", (frag["id"],))
                    deleted += 1
                elif not result.should_keep:
                    db.execute("DELETE FROM memory_fragments WHERE id = ?", (frag["id"],))
                    deleted += 1
                elif result.new_importance != frag["importance"]:
                    db.execute(
                        "UPDATE memory_fragments SET importance = ? WHERE id = ?",
                        (result.new_importance, frag["id"]),
                    )
                    changed += 1
        return {"processed": len(frags), "changed": changed, "deleted": deleted}


    @staticmethod
    def get_stats(character_id: str = "default") -> dict:
        """记忆库统计信息。"""
        with get_db() as db:
            total = db.execute(
                "SELECT COUNT(*) FROM memory_fragments WHERE character_id = ?",
                (character_id,),
            ).fetchone()[0]
            permanent = db.execute(
                "SELECT COUNT(*) FROM memory_fragments WHERE character_id = ? AND is_permanent = 1",
                (character_id,),
            ).fetchone()[0]
            avg_imp_row = db.execute(
                "SELECT AVG(importance) FROM memory_fragments WHERE character_id = ?",
                (character_id,),
            ).fetchone()
            avg_imp = round(avg_imp_row[0] or 0, 3)
            recent = db.execute(
                "SELECT COUNT(*) FROM memory_fragments WHERE character_id = ? AND created_at >= datetime('now', '-7 days')",
                (character_id,),
            ).fetchone()[0]
            accessed = db.execute(
                "SELECT COUNT(*) FROM memory_fragments WHERE character_id = ? AND access_count > 0",
                (character_id,),
            ).fetchone()[0]
        return {
            "total": total,
            "permanent": permanent,
            "ephemeral": total - permanent,
            "avg_importance": avg_imp,
            "recent_7d": recent,
            "accessed_ratio": round(accessed / total, 3) if total > 0 else 0,
        }

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "character_id": row["character_id"],
            "user_id": row["user_id"],
            "content": row["content"],
            "importance": row["importance"],
            "access_count": row["access_count"],
            "last_accessed": row["last_accessed"],
            "is_permanent": bool(row["is_permanent"]),
            "created_at": row["created_at"],
            "emotion_snapshot": json.loads(row["emotion_snapshot"]) if row["emotion_snapshot"] else {},
        }


class InteractionService:
    """互动消息服务：台词池 CRUD。"""

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "character_id": row["character_id"],
            "category": row["category"],
            "subcategory": row["subcategory"],
            "messages": json.loads(row["messages"]) if row["messages"] else [],
            "emotion": row["emotion"] if "emotion" in row.keys() else None,
            "time_of_day": row["time_of_day"] if "time_of_day" in row.keys() else None,
            "enabled": bool(row["enabled"]),
            "updated_at": row["updated_at"] if "updated_at" in row.keys() else None,
        }

    @staticmethod
    def list_messages(character_id: str = "default", category: str | None = None) -> list[dict]:
        with get_db() as db:
            if category:
                rows = db.execute(
                    "SELECT * FROM interaction_messages WHERE character_id = ? AND category = ? ORDER BY subcategory",
                    (character_id, category),
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM interaction_messages WHERE character_id = ? ORDER BY category, subcategory",
                    (character_id,),
                ).fetchall()
        return [InteractionService._row_to_dict(r) for r in rows]

    @staticmethod
    def get_message(character_id: str, category: str, subcategory: str) -> dict | None:
        with get_db() as db:
            row = db.execute(
                "SELECT * FROM interaction_messages WHERE character_id = ? AND category = ? AND subcategory = ?",
                (character_id, category, subcategory),
            ).fetchone()
        if row is None:
            return None
        return InteractionService._row_to_dict(row)

    @staticmethod
    def upsert_message(
        character_id: str = "default",
        category: str = "",
        subcategory: str = "",
        messages: list[str] | None = None,
        emotion: str | None = None,
        time_of_day: str | None = None,
        enabled: bool = True,
    ) -> dict:
        if not category or not subcategory:
            raise ValueError("category and subcategory are required")
        with get_db() as db:
            row = db.execute(
                "SELECT * FROM interaction_messages WHERE character_id = ? AND category = ? AND subcategory = ?",
                (character_id, category, subcategory),
            ).fetchone()
            messages_json = json.dumps(messages or [])
            if row is None:
                cursor = db.execute(
                    "INSERT INTO interaction_messages (character_id, category, subcategory, messages, emotion, time_of_day, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (character_id, category, subcategory, messages_json, emotion, time_of_day, 1 if enabled else 0),
                )
                msg_id = cursor.lastrowid
            else:
                msg_id = row["id"]
                sets = ["messages = ?", "updated_at = datetime('now')"]
                params: list[Any] = [messages_json]
                if emotion is not None:
                    sets.append("emotion = ?")
                    params.append(emotion)
                if time_of_day is not None:
                    sets.append("time_of_day = ?")
                    params.append(time_of_day)
                sets.append("enabled = ?")
                params.append(1 if enabled else 0)
                params.extend([character_id, category, subcategory])
                db.execute(
                    f"UPDATE interaction_messages SET {', '.join(sets)} WHERE character_id = ? AND category = ? AND subcategory = ?",
                    params,
                )
        return InteractionService.get_message(character_id, category, subcategory) or {"id": msg_id}

    @staticmethod
    def update_message(msg_id: int, **fields) -> dict | None:
        allowed = {"messages", "emotion", "time_of_day", "enabled"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return None
        sets = ["updated_at = datetime('now')"]
        params: list[Any] = []
        for k, v in updates.items():
            if k == "messages":
                sets.append("messages = ?")
                params.append(json.dumps(v if v is not None else []))
            elif k == "enabled":
                sets.append("enabled = ?")
                params.append(1 if v else 0)
            else:
                sets.append(f"{k} = ?")
                params.append(v)
        params.append(msg_id)
        with get_db() as db:
            db.execute(f"UPDATE interaction_messages SET {', '.join(sets)} WHERE id = ?", params)
        with get_db() as db:
            row = db.execute("SELECT * FROM interaction_messages WHERE id = ?", (msg_id,)).fetchone()
        if row is None:
            return None
        return InteractionService._row_to_dict(row)


class TimeService:
    "时间服务：昼夜节律 + 重逢机制。"

    @staticmethod
    def get_circadian() -> dict:
        rhythm = CircadianRhythm()
        tod = rhythm.get_time_of_day()
        pad = rhythm.pad_influence()
        return {
            "time_of_day": tod,
            "time_of_day_cn": rhythm.get_time_label(tod),
            "greeting": rhythm.get_greeting(),
            "pad_influence": pad.to_dict(),
            "initiative_multiplier": rhythm.initiative_multiplier(),
            "style_modifier": rhythm.style_modifier(),
        }

    @staticmethod
    def check_reunion(character_id: str = "default", user_id: str = "default") -> dict:
        engine = ReunionEngine()
        with get_db() as db:
            row = db.execute(
                "SELECT last_seen_at FROM last_seen WHERE character_id = ? AND user_id = ?",
                (character_id, user_id),
            ).fetchone()

            if row is None:
                # 第一次见面
                db.execute(
                    "INSERT INTO last_seen (character_id, user_id, last_seen_at) VALUES (?, ?, datetime('now'))",
                    (character_id, user_id),
                )
                return {
                    "level": "first_meeting",
                    "hours_away": 0,
                    "greeting": "你好呀～第一次见面，很高兴认识你！",
                    "pad_surge": {"pleasure": 0.2, "arousal": 0.15, "dominance": 0.0},
                    "is_reunion": False,
                }

            last_seen = datetime.fromisoformat(row["last_seen_at"])
            result = engine.compute_reunion(last_seen)

            # 更新 last_seen
            db.execute(
                "UPDATE last_seen SET last_seen_at = datetime('now') WHERE character_id = ? AND user_id = ?",
                (character_id, user_id),
            )

        return {
            "level": result.level,
            "hours_away": result.hours_away,
            "greeting": result.greeting,
            "pad_surge": result.pad_surge.to_dict(),
            "should_trigger_event": result.should_trigger_event,
            "is_reunion": result.level not in ("just_now", "short"),
        }


# ============================================================
# FastAPI App
# ============================================================


def create_app() -> FastAPI:
    from contextlib import asynccontextmanager
    from fastapi import FastAPI as _FastAPI

    @asynccontextmanager
    async def lifespan(app: _FastAPI):
        init_db()
        log.info("Core API server started")
        yield

    app = FastAPI(title="Desk Pet Core API", version="1.0.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:1420", "http://127.0.0.1:1420", "tauri://localhost", "http://tauri.localhost"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ---- 健康检查 ----
    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "service": "core-api"}

    # ========================================================
    # Heart / 情感系统
    # ========================================================

    @app.get("/api/core/heart/emotion", response_model=EmotionStateResponse)
    def get_emotion(character_id: str = "default") -> dict:
        return EmotionService.get_state(character_id)

    @app.post("/api/core/heart/emotion/event", response_model=EmotionStateResponse)
    def post_emotion_event(req: EmotionEventRequest) -> dict:
        return EmotionService.process_event(req.event, req.character_id)

    @app.get("/api/core/heart/emotion/history")
    def get_emotion_history(character_id: str = "default", limit: int = 50) -> list[dict]:
        return EmotionService.get_history(character_id, limit)

    # ========================================================
    # Interaction / 互动消息（台词池）
    # ========================================================

    @app.get("/api/core/interaction/messages")
    def list_interaction_messages(character_id: str = "default", category: str | None = None) -> list[dict]:
        return InteractionService.list_messages(character_id, category)

    @app.post("/api/core/interaction/messages")
    def create_interaction_message(req: InteractionMessage) -> dict:
        return InteractionService.upsert_message(
            character_id=req.character_id,
            category=req.category,
            subcategory=req.subcategory,
            messages=req.messages,
            emotion=req.emotion,
            time_of_day=req.time_of_day,
            enabled=req.enabled,
        )

    @app.put("/api/core/interaction/messages/{msg_id}")
    def update_interaction_message(msg_id: int, req: InteractionMessageUpdate) -> dict | None:
        result = InteractionService.update_message(msg_id, **req.model_dump(exclude_none=True))
        if result is None:
            raise HTTPException(status_code=404, detail="Interaction message not found")
        return result

    # ========================================================
    # Soul / 人格系统
    # ========================================================

    @app.get("/api/core/soul/personality", response_model=PersonalityResponse)
    def get_personality(character_id: str = "default") -> dict:
        return PersonalityService.get_personality(character_id)

    @app.post("/api/core/soul/personality/drift", response_model=PersonalityResponse)
    def post_personality_drift(req: PersonalityDriftRequest) -> dict:
        return PersonalityService.apply_drift(req.drift_type, req.character_id)

    @app.put("/api/core/soul/personality", response_model=PersonalityResponse)
    def put_personality(req: PersonalityUpdateRequest) -> dict:
        """手动设定 HEXACO 人格（用户调整/设定初始状态），reset=True 恢复默认。"""
        fields = req.model_dump(exclude={"character_id", "reset"})
        return PersonalityService.update_personality(fields, req.character_id, req.reset)

    # ========================================================
    # Brain / 记忆系统
    # ========================================================

    @app.get("/api/core/brain/memories")
    def list_memories(character_id: str = "default", limit: int = 50) -> list[dict]:
        return MemoryService.list_fragments(character_id, limit)

    @app.post("/api/core/brain/memories/search")
    def search_memories(req: MemorySearchRequest) -> list[dict]:
        return MemoryService.search(req.query, req.character_id, req.limit)

    @app.post("/api/core/brain/memories")
    def add_memory(frag: MemoryFragmentCreate) -> dict:
        return MemoryService.add_fragment(frag)




    @app.post("/api/core/brain/memories/apply-decay")
    def apply_memory_decay(character_id: str = "default") -> dict:
        return MemoryService.apply_decay_all(character_id)


    @app.get("/api/core/brain/memories/stats")
    def get_memory_stats(character_id: str = "default") -> dict:
        return MemoryService.get_stats(character_id)

    @app.post("/api/core/brain/memories/extract")
    def extract_from_exchange(req: MemoryExtractRequest) -> dict:
        return MemoryService.extract_from_exchange(
            user_text=req.user_text,
            assistant_text=req.assistant_text,
            character_id=req.character_id,
            user_id=req.user_id,
            use_llm=req.use_llm,
        )

    @app.get("/api/core/brain/memories/{frag_id}")
    def get_memory(frag_id: int) -> dict:
        return MemoryService.get_fragment(frag_id)
    @app.patch("/api/core/brain/memories/{frag_id}/permanent")
    def set_memory_permanent(frag_id: int, req: MemoryPermanentRequest) -> dict:
        return MemoryService.set_permanent(frag_id, req.is_permanent)

    @app.post("/api/core/time/reunion/check")
    def check_reunion(req: ReunionCheckRequest) -> dict:
        return TimeService.check_reunion(req.character_id, req.user_id)

    @app.get("/api/core/time/circadian")
    def get_circadian() -> dict:
        return TimeService.get_circadian()

    # ========================================================
    # Session / Hermes 大脑会话（hermes_core.SessionDB）
    # ========================================================

    @app.get("/api/core/session/list")
    def session_list(source: str | None = None, limit: int = 20, offset: int = 0) -> dict:
        return session_service.list_sessions(source=source, limit=limit, offset=offset)

    @app.get("/api/core/session/stats")
    def session_stats() -> dict:
        return session_service.get_stats()

    @app.post("/api/core/session")
    def session_create(req: SessionCreateRequest) -> dict:
        return session_service.create_session(req.session_id, source=req.source)

    @app.get("/api/core/session/{session_id}")
    def session_get(session_id: str) -> dict:
        return session_service.get_session(session_id)

    @app.post("/api/core/session/{session_id}/messages")
    def session_append(session_id: str, req: SessionAppendRequest) -> dict:
        return session_service.append_message(
            session_id,
            role=req.role,
            content=req.content,
            token_count=req.token_count,
        )

    @app.post("/api/core/session/search")
    def session_search(req: SessionSearchRequest) -> dict:
        return session_service.search_sessions(req.query, req.limit)

    @app.delete("/api/core/session/{session_id}")
    def session_delete(session_id: str) -> dict:
        return session_service.delete_session(session_id)

    # ========================================================
    # Unified Search / 记忆统一查询（Brain 碎片 + Hermes FTS5）
    # ========================================================

    @app.post("/api/core/brain/search-all")
    def unified_search(req: UnifiedSearchRequest) -> dict:
        fragments = MemoryService.search(req.query, req.character_id, req.limit)
        session_hits = session_service.search_sessions(req.query, req.limit)
        return {
            "query": req.query,
            "fragments": fragments,
            "sessions": session_hits.get("hits", []),
        }

    # ========================================================
    # Emotion Bridge / 身体事件 ↔ 汐月九维情绪（方案 A）
    # ========================================================

    @app.post("/api/core/emotion/bridge/event")
    def emotion_bridge_event(req: EmotionBridgeEventRequest) -> dict:
        # 互动类事件先做低频聚合计数（无论情绪节流与否都记录），
        # 累计达阈值后沉淀「用户喜欢摸头」类偏好记忆 + 供 gateway 注入频率
        if req.event.startswith("interaction:"):
            interaction_agg.record(req.event, character_id="default")
        return emotion_bridge.apply_event(req.event, req.value, req.source)

    @app.get("/api/core/emotion/bridge/state")
    def emotion_bridge_state() -> dict:
        return emotion_bridge.get_state()

    @app.get("/api/core/emotion/bridge/config")
    def emotion_bridge_config() -> dict:
        return emotion_bridge.load_config()

    @app.get("/api/core/interaction/stats")
    def interaction_stats() -> dict:
        """互动低频聚合统计：各类型累计 / 近 7 天次数（gateway 注入用）。"""
        return interaction_agg.get_stats(character_id="default", days=7)

    return app


# ============================================================

def main() -> None:
    parser = argparse.ArgumentParser(description="Desk Pet Core API Server")
    parser.add_argument("--port", type=int, default=9877, help="服务端口 (默认 9877)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="监听地址")
    args = parser.parse_args()

    import uvicorn
    app = create_app()
    log.info("Starting Core API on %s:%d", args.host, args.port)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
