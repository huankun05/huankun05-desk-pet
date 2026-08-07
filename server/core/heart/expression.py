"""情绪 → 语言风格映射。

8 种情绪标签 → 语气/用词/句长/主动度
用于注入 LLM Prompt，让回复风格随情绪变化。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .emotion import EmotionState, PADValues


MOOD_LABELS: dict[str, str] = {
    "happy": "开心",
    "sad": "悲伤",
    "anxious": "焦虑",
    "calm": "平静",
    "excited": "兴奋",
    "angry": "愤怒",
    "tired": "疲惫",
    "gentle": "温和",
}


EMOTION_STYLE_MAP: dict[str, dict] = {
    "happy": {
        "tone": "阳光活泼，语气轻快",
        "word_choice": [
            "开心", "太好了", "哈哈", "哇",
            "棒", "喜欢",
        ],
        "sentence_length": 0.6,
        "initiative": 0.75,
    },
    "sad": {
        "tone": "低沉温柔，语气轻缓",
        "word_choice": [
            "难过", "抱抱", "没事的",
            "我在呢", "理解你",
        ],
        "sentence_length": 0.35,
        "initiative": 0.25,
    },
    "anxious": {
        "tone": "紧张小心，语气谨慎",
        "word_choice": [
            "别担心", "不会有事的",
            "放心", "应该没问题",
        ],
        "sentence_length": 0.3,
        "initiative": 0.2,
    },
    "calm": {
        "tone": "温和自然，语气平稳",
        "word_choice": [
            "嗯", "好呀", "嗯嗯",
            "明白", "了解", "这样啊",
        ],
        "sentence_length": 0.5,
        "initiative": 0.45,
    },
    "excited": {
        "tone": "热情洋溢，语气激动",
        "word_choice": [
            "太棒了", "哇塞",
            "天哪", "真的吗", "超棒",
        ],
        "sentence_length": 0.65,
        "initiative": 0.85,
    },
    "angry": {
        "tone": "冷静克制，语气严肃",
        "word_choice": [
            "冷静", "我们慢慢说",
            "这样不太好", "需要冷静下",
        ],
        "sentence_length": 0.4,
        "initiative": 0.5,
    },
    "tired": {
        "tone": "疲惫慵懒，语气轻柔",
        "word_choice": [
            "有点困", "嗯…",
            "好呀",
        ],
        "sentence_length": 0.25,
        "initiative": 0.2,
    },
    "gentle": {
        "tone": "温和体贴，语气细腻",
        "word_choice": [
            "心疼", "慢慢来",
            "抱抱", "我在呢",
        ],
        "sentence_length": 0.45,
        "initiative": 0.4,
    },
}


@dataclass(frozen=True)
class ExpressionStrategy:
    """语言表达策略（不可变值对象）。"""

    mood_label: str = "calm"
    tone: str = "温和自然"
    word_choice: list[str] = field(default_factory=list)
    sentence_length: float = 0.5
    initiative: float = 0.45

    def to_dict(self) -> dict:
        return {
            "mood_label": self.mood_label,
            "mood_label_cn": MOOD_LABELS.get(self.mood_label, "平静"),
            "tone": self.tone,
            "word_choice": list(self.word_choice),
            "sentence_length": self.sentence_length,
            "initiative": self.initiative,
        }

    def to_prompt_text(self) -> str:
        """生成可注入 Prompt 的文本描述。"""
        cn_label = MOOD_LABELS.get(self.mood_label, "平静")
        parts = [
            "## 表达策略（当前情绪：" + cn_label + "）",
            "- **语气**：" + self.tone,
        ]
        if self.word_choice:
            words = "、".join(self.word_choice[:6])
            parts.append("- **倾向用词**：" + words + "等")

        if self.sentence_length < 0.35:
            length_desc = "简洁短句"
        elif self.sentence_length < 0.65:
            length_desc = "中长句为主"
        else:
            length_desc = "可长可短，灵活多变"
        parts.append("- **句式节奏**：" + length_desc)

        if self.initiative < 0.3:
            init_desc = "以倾听和回应为主，不要主动发问"
        elif self.initiative < 0.6:
            init_desc = "适度主动关心，可以适当发起话题"
        else:
            init_desc = "积极主动，可以主动分享和提问"
        parts.append("- **主动程度**：" + init_desc)

        parts.append(
            "\n**注意**：以上策略是内部指导，"
            "不要直接输出策略本身。"
            "你的回复要自然体现这些倾向，"
            "而不是声明你的情绪状态。"
        )
        return "\n".join(parts)


class ExpressionEngine:
    """情绪 → 语言风格策略构建器。"""

    VALID_MOODS = set(MOOD_LABELS.keys())

    def build_strategy(self, mood_label: str) -> ExpressionStrategy:
        """从情绪标签构建表达策略。"""
        key = mood_label.lower().strip()
        if key not in self.VALID_MOODS:
            key = "calm"
        style = EMOTION_STYLE_MAP[key]
        return ExpressionStrategy(
            mood_label=key,
            tone=style["tone"],
            word_choice=list(style["word_choice"]),
            sentence_length=style["sentence_length"],
            initiative=style["initiative"],
        )

    def build_strategy_from_pad(
        self,
        pleasure: float = 0.0,
        arousal: float = 0.0,
        dominance: float = 0.0,
    ) -> ExpressionStrategy:
        """从 PAD 三维值推导情绪并构建策略。"""
        p = max(-1.0, min(1.0, float(pleasure)))
        a = max(-1.0, min(1.0, float(arousal)))
        d = max(-1.0, min(1.0, float(dominance)))

        # anger 优先级高于 anxious（anger 有更高的支配度）
        if p < -0.1 and d > 0.3 and a > 0.1:
            mood = "angry"
        elif a > 0.3 and p < -0.1:
            mood = "anxious"
        elif a > 0.3 and p > 0.1:
            mood = "excited"
        elif a < -0.2 and abs(p) < 0.3:
            mood = "tired" if a < -0.5 else "calm"
        elif p > 0.3:
            mood = "happy"
        elif p < -0.3:
            mood = "sad"
        elif d < -0.3 and abs(p) < 0.3:
            mood = "gentle"
        else:
            mood = "calm"

        return self.build_strategy(mood)

    def build_strategy_from_emotion_state(
        self, state: EmotionState
    ) -> ExpressionStrategy:
        """从 EmotionState 构建表达策略。"""
        return self.build_strategy_from_pad(
            pleasure=state.pad.pleasure,
            arousal=state.pad.arousal,
            dominance=state.pad.dominance,
        )
