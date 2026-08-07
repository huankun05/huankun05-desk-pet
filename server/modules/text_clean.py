"""
文本清理模块
在 TTS 合成前清理文本，移除不应朗读的内容。
"""

import re
from loguru import logger


# 常见表情符号列表
EMOJIS = set("😀😁😂🤣😃😄😅😆😉😊😋😎😍🥰😘😗😙😚🤪🤩🥳😏🤭🤫🤔😐😑😶🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🤧🥵🥶🥴😵🤯🤠🥳🥺😎🤓🧐😕😟🙁☹️😮😯😲😳🥺😦😧😨😰�😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀☠️💩🤡👹👺👻👽👾🤖😺😸😹😻😼😽🙀😿😾🙈🙉🙊💋💌💘💝💖💗💘💝❤️🧡💛💚💙💜🖤🤍🤎💔❣💕💞💓💗💖💘💝⭐🌟✨💫🔥💯❤️👋🤚🖐✋🖖👌🤌🤏✌🤞🤟🤘🤙👈👉👆🖕👇☝👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏✍💅🤳💪🦾🦿🦵🦶👂🦻👃🧠🫀🫁🦷🦴👀👁👅👄💋")

# 动作描述括号
ACTION_BRACKETS = re.compile(r'[（(][^）)]*[）)]')


def clean_for_tts(text: str) -> str:
    """
    清理文本，使其适合 TTS 朗读。

    Args:
        text: 原始文本

    Returns:
        清理后的纯文本
    """
    if not text:
        return ""

    # 1. 移除表情符号
    for emoji in EMOJIS:
        text = text.replace(emoji, "")

    # 2. 移除括号动作描述
    text = ACTION_BRACKETS.sub("", text)

    # 3. 移除 Markdown 格式
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)  # **粗体**
    text = re.sub(r'\*([^*]+)\*', r'\1', text)       # *斜体*
    text = re.sub(r'__([^_]+)__', r'\1', text)       # __粗体__
    text = re.sub(r'_([^_]+)_', r'\1', text)         # _斜体_

    # 4. 清理多余空格
    text = re.sub(r'\s+', ' ', text).strip()

    # 5. 移除开头的标点（保留句尾标点，TTS 需要）
    text = text.lstrip("，。！？、；：")

    return text


def test_clean():
    """测试清理功能"""
    test_cases = [
        ("你好呀👋", "你好呀"),
        ("（轻轻抬起头）你好", "你好"),
        ("**重要**的事情", "重要的事情"),
        ("太棒了！❤️", "太棒了！"),
        ("嗯...让我想想🤔", "嗯...让我想想"),
        ("你好，旅行者！😊今天天气真好", "你好，旅行者！今天天气真好"),
        ("我有点难过😢", "我有点难过"),
    ]

    print("文本清理测试:")
    all_pass = True
    for input_text, expected in test_cases:
        result = clean_for_tts(input_text)
        status = "✅" if result == expected else "❌"
        if result != expected:
            all_pass = False
        print(f"  {status} '{input_text}' → '{result}' (期望: '{expected}')")

    return all_pass


if __name__ == "__main__":
    test_clean()
