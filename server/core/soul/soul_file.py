""".soul 角色配置文件。

YAML 格式，定义角色的人格、身份、说话风格等。

示例:
```yaml
name: "小暖"
version: "1.0.0"
personality:
  hexaco:
    honesty_humility: 0.75
    emotionality: 0.60
    extraversion: 0.70
    agreeableness: 0.85
    conscientiousness: 0.65
    openness: 0.80
  mbti: "ENFJ"
identity:
  age: 25
  gender: "女"
  occupation: "自由插画师"
  interests: ["绘画", "音乐", "咖啡", "旅行"]
  speech_pattern: "温柔细腻，喜欢用比喻和温柔的语气"
  catchphrases: ["嗯嗯", "我懂", "没关系的"]
core_values:
  - "真诚是最好的沟通方式"
  - "每个人都有值得被倾听的故事"
```
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from .personality import HEXACOPersonality


@dataclass
class SoulFile:
    """.soul 角色配置文件。"""

    name: str = "未命名"
    version: str = "1.0.0"
    personality: HEXACOPersonality = field(default_factory=HEXACOPersonality)
    mbti: str = ""
    identity: dict[str, Any] = field(default_factory=dict)
    core_values: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)

    # ---- 序列化 ----

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "personality": {
                "hexaco": self.personality.to_simple_dict(),
                "mbti": self.mbti,
            },
            "identity": self.identity,
            "core_values": list(self.core_values),
            "extra": self.extra,
        }

    def to_yaml(self) -> str:
        """序列化为 YAML 字符串。

        使用 json 作为中间格式避免引入 PyYAML 依赖。
        实际项目中建议使用 PyYAML 或 ruamel.yaml。
        """
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)

    def to_prompt_text(self) -> str:
        """生成可注入 Prompt 的角色描述文本。"""
        lines: list[str] = [
            f"## 角色设定：{self.name}",
            "",
        ]

        # 人格
        lines.append("### 人格特质")
        lines.append(self.personality.describe())
        if self.mbti:
            lines.append(f"MBTI 类型：{self.mbti}")
        lines.append("")

        # 身份
        if self.identity:
            lines.append("### 身份信息")
            for key, val in self.identity.items():
                if isinstance(val, list):
                    lines.append(f"- {key}：{', '.join(str(v) for v in val)}")
                else:
                    lines.append(f"- {key}：{val}")
            lines.append("")

        # 说话风格
        speech = self.identity.get("speech_pattern", "")
        if speech:
            lines.append("### 说话风格")
            lines.append(speech)
            lines.append("")

        catchphrases = self.identity.get("catchphrases", [])
        if catchphrases:
            lines.append("### 口头禅")
            lines.append("、".join(catchphrases))
            lines.append("")

        # 核心价值观
        if self.core_values:
            lines.append("### 核心价值观")
            for v in self.core_values:
                lines.append(f"- {v}")
            lines.append("")

        return "\n".join(lines)

    # ---- 反序列化 ----

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SoulFile:
        name = data.get("name", "未命名")
        version = data.get("version", "1.0.0")

        personality_data = data.get("personality", {})
        hexaco_data = personality_data.get("hexaco", {})
        mbti = personality_data.get("mbti", "")
        personality = HEXACOPersonality.from_dict(hexaco_data)

        identity = data.get("identity", {})
        if not isinstance(identity, dict):
            identity = {}

        core_values = data.get("core_values", [])
        if not isinstance(core_values, list):
            core_values = []

        extra = data.get("extra", {})
        if not isinstance(extra, dict):
            extra = {}

        return cls(
            name=name,
            version=version,
            personality=personality,
            mbti=mbti,
            identity=identity,
            core_values=list(core_values),
            extra=extra,
        )

    @classmethod
    def from_yaml(cls, yaml_str: str) -> SoulFile:
        """从 YAML/JSON 字符串加载。

        优先尝试 JSON（简单可靠），失败时返回默认值。
        如需完整 YAML 支持，安装 PyYAML 后自行扩展。
        """
        try:
            data = json.loads(yaml_str)
        except (json.JSONDecodeError, TypeError):
            data = {}
        return cls.from_dict(data)

    # ---- 文件操作 ----

    def save(self, filepath: str) -> None:
        """保存到文件（JSON 格式）。"""
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(self.to_yaml())

    @classmethod
    def load(cls, filepath: str) -> SoulFile:
        """从文件加载。"""
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        return cls.from_yaml(content)
