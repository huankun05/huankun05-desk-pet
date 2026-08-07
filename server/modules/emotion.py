"""
情感分析模块
根据对话内容自动调整 TTS 风格。

核心功能：
- 分析用户输入文本的情感倾向
- 映射到 TTS 风格标签（开心/认真/害羞/思考等）
- 支持基于规则和关键词的快速分析
- 支持基于 LLM 的深度分析（可选）
"""

import re
from loguru import logger


# 情感关键词映射
EMOTION_KEYWORDS = {
    "开心": [
        "开心", "高兴", "快乐", "太好了", "真棒", "厉害", "哈哈", "嘻嘻",
        "好耶", "不错", "可以", "喜欢", "爱", "感谢", "谢谢", "辛苦了",
        "恭喜", "庆祝", "胜利", "成功", "完美", "太棒了",
    ],
    "认真": [
        "重要", "严肃", "必须", "一定", "注意", "小心", "危险", "警告",
        "紧急", "关键", "问题", "错误", "失败", "报告", "分析", "解释",
        "为什么", "怎么回事", "发生了什么",
    ],
    "害羞": [
        "害羞", "不好意思", "那个", "其实", "也许", "可能", "大概",
        "秘密", "悄悄", "只告诉你", "别告诉别人", "嗯...", "哎呀",
        "讨厌", "才不是", "不要说了",
    ],
    "思考": [
        "让我想想", "思考", "分析", "考虑", "比较", "选择", "决定",
        "计划", "方案", "策略", "原理", "为什么", "如何", "怎样",
        "意义", "目的", "本质", "深层",
    ],
    "担忧": [
        "担心", "害怕", "恐惧", "焦虑", "不安", "紧张", "危险",
        "怎么办", "糟糕", "完了", "出事", "问题", "困难", "麻烦",
        "受伤", "生病", "痛苦",
    ],
    "温柔": [
        "晚安", "早安", "你好", "再见", "想你", "思念", "回忆",
        "过去", "曾经", "那时候", "记得", "难忘", "珍贵",
    ],
}

# 默认情感（无明显情感时使用）
DEFAULT_EMOTION = "温柔"

# 情感到 TTS instruct_text 的映射
EMOTION_TO_INSTRUCT = {
    "开心": "用开心活泼的语气说",
    "认真": "用认真严肃的语气说",
    "害羞": "用害羞温柔的语气说",
    "思考": "用思考犹豫的语气说",
    "担忧": "用担忧关切的语气说",
    "温柔": "用温柔轻声的语气说",
}


def analyze_emotion(text: str) -> str:
    """
    分析文本情感，返回 TTS 风格标签。

    Args:
        text: 用户输入文本

    Returns:
        情感标签（如 "开心"、"认真" 等）
    """
    if not text or not text.strip():
        return DEFAULT_EMOTION

    text = text.strip().lower()

    # 统计各情感匹配分数
    scores = {}
    for emotion, keywords in EMOTION_KEYWORDS.items():
        score = 0
        for keyword in keywords:
            if keyword in text:
                score += 1
        if score > 0:
            scores[emotion] = score

    if not scores:
        return DEFAULT_EMOTION

    # 返回得分最高的情感
    best_emotion = max(scores, key=scores.get)
    logger.debug(f"情感分析: '{text[:20]}...' → {best_emotion} (得分: {scores})")
    return best_emotion


def get_instruct_text(emotion: str) -> str:
    """
    获取情感对应的 TTS instruct_text。

    Args:
        emotion: 情感标签

    Returns:
        instruct_text 字符串
    """
    return EMOTION_TO_INSTRUCT.get(emotion, "用温柔的语气说")


def analyze_and_get_instruct(text: str) -> tuple[str, str]:
    """
    分析情感并返回 (情感标签, instruct_text)。

    Args:
        text: 用户输入文本

    Returns:
        (emotion, instruct_text) 元组
    """
    emotion = analyze_emotion(text)
    instruct = get_instruct_text(emotion)
    return emotion, instruct
