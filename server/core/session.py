"""
会话管理模块
管理多轮对话状态、对话历史、上下文窗口。

核心功能：
- 维护多轮对话历史
- 管理对话上下文（system prompt + 历史 + 当前输入）
- 上下文窗口裁剪（防止 token 溢出）
- 会话持久化
- PAD 情绪状态 + 表达策略注入
"""

import json
import time
from pathlib import Path
from loguru import logger

try:
    from core.heart.emotion import PADValues, EmotionState
    from core.heart.expression import ExpressionEngine
    from core.heart.hormones import HormonalSystem, HormonalEngine
    from core.soul.personality import HEXACOPersonality
    _PAD_AVAILABLE = True
except ImportError:
    _PAD_AVAILABLE = False

try:
    from core.brain.librarian import Librarian
    from core.brain.scribe import Scribe, ExtractionConfig
    from core.brain.store import MemoryStore
    _BRAIN_AVAILABLE = True
except ImportError:
    _BRAIN_AVAILABLE = False


class Message:
    """对话消息"""

    def __init__(self, role: str, content: str, timestamp: float = None):
        """
        Args:
            role: "system" | "user" | "assistant"
            content: 消息内容
            timestamp: 时间戳（秒）
        """
        self.role = role
        self.content = content
        self.timestamp = timestamp or time.time()

    def to_dict(self) -> dict:
        return {
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Message":
        return cls(
            role=data["role"],
            content=data["content"],
            timestamp=data.get("timestamp"),
        )

    def __repr__(self):
        return f"Message({self.role}, {self.content[:20]}...)"


class Session:
    """对话会话管理器"""

    def __init__(self, config: dict = None):
        """
        初始化会话管理器。

        Args:
            config: 对话配置字典
        """
        cfg = config or {}
        self.max_history = cfg.get("max_history", 20)
        self.system_prompt = ""
        self.greeting = cfg.get("greeting", "你好呀，旅行者！今天过得怎么样？")

        # 记忆系统配置
        self.memory_enabled = cfg.get("memory_enabled", True)
        self.memory_top_k = cfg.get("memory_top_k", 3)
        self.memory_reflection_enabled = cfg.get("memory_reflection_enabled", True)
        self.character_id = cfg.get("character_id", "default")
        self.user_id = cfg.get("user_id", "default")

        # 对话历史
        self._history: list[Message] = []
        self._current_user_input = ""

        # 会话元数据
        self.session_id = f"session_{int(time.time())}"
        # 保留 config 传入的 user_id；未指定时默认 'default'，供后续声纹识别更新
        self.user_id = self.user_id or "default"
        self.created_at = time.time()

        # PAD 情绪状态（可选，若模块可用则初始化）
        self._pad_available = _PAD_AVAILABLE
        self._emotion_state = None
        self._hormones = None
        self._hormonal_engine = None
        self._expression_engine = None
        self._personality = None
        self._last_emotion_update = time.time()
        if self._pad_available:
            self._emotion_state = EmotionState(pad=PADValues())
            self._hormones = HormonalSystem()
            self._hormonal_engine = HormonalEngine()
            self._expression_engine = ExpressionEngine()
            self._personality = HEXACOPersonality()
            logger.info("PAD 情绪系统已启用")

        # 单轮对话 PAD 快照，用于提取整轮平均情绪
        self._round_pad_snapshots: list[dict[str, float]] = []

        # 记忆检索与提取（可选）
        self._brain_available = _BRAIN_AVAILABLE and self.memory_enabled
        self._librarian = None
        self._scribe = None
        if self._brain_available:
            try:
                store = MemoryStore(
                    character_id=self.character_id,
                    user_id=self.user_id,
                )
                self._librarian = Librarian(store=store, top_k=self.memory_top_k)
                self._scribe = Scribe(
                    store=store,
                    config=ExtractionConfig(),
                )
                logger.info("记忆系统已启用")
            except Exception as e:
                logger.warning(f"记忆系统初始化失败: {e}")
                self._brain_available = False

        # 加载 system prompt
        prompt_file = cfg.get("system_prompt_file", "prompts/system_prompt.txt")
        # 相对于项目根目录解析路径
        project_root = Path(__file__).parent.parent
        prompt_path = project_root / prompt_file
        self._load_system_prompt(str(prompt_path))

        logger.info(f"Session 初始化: {self.session_id}")

    def _load_system_prompt(self, path: str):
        """加载系统 prompt"""
        try:
            prompt_path = Path(path)
            if prompt_path.exists():
                self.system_prompt = prompt_path.read_text(encoding="utf-8").strip()
                logger.info(f"已加载 system prompt: {path}")
            else:
                logger.warning(f"system prompt 文件不存在: {path}")
                self.system_prompt = "你是纳西妲，须弥的智慧之神。"
        except Exception as e:
            logger.error(f"加载 system prompt 失败: {e}")
            self.system_prompt = "你是纳西妲，须弥的智慧之神。"

    def start(self) -> str:
        """
        开始新会话，返回问候语。

        Returns:
            纳西妲的问候语
        """
        # 添加 system prompt
        if self.system_prompt:
            self._history.append(Message("system", self.system_prompt))

        greeting = self.greeting
        self._history.append(Message("assistant", greeting))
        logger.info(f"会话开始: {greeting}")
        return greeting

    def add_user_message(self, text: str):
        """
        添加用户消息。

        Args:
            text: 用户说的话（ASR 识别结果）
        """
        self._current_user_input = text
        self._history.append(Message("user", text))
        logger.debug(f"用户: {text}")

        # 更新情绪状态（用户输入可能影响情绪）
        if self._pad_available and self._emotion_state is not None:
            self._update_emotion_from_event(text)

        # 裁剪历史
        self._trim_history()

    def add_assistant_message(self, text: str):
        """
        添加助手回复。

        Args:
            text: 纳西妲的回复
        """
        self._history.append(Message("assistant", text))
        logger.debug(f"纳西妲: {text}")

    def _update_emotion_from_event(self, event: str):
        """根据对话内容更新情绪状态（用户输入 -> 事件响应 + 时间漂移）。"""
        if not self._pad_available or self._emotion_state is None or self._hormones is None:
            return

        now = time.time()
        elapsed_minutes = (now - self._last_emotion_update) / 60.0
        self._last_emotion_update = now

        # 1. 时间漂移（情绪回归基线），仅在间隔超过 10 秒时生效
        if elapsed_minutes > 0.17:
            drift_rate = min(0.3, elapsed_minutes / 60.0 * 0.2)
            self._emotion_state.drift(rate=drift_rate)

        # 2. 事件对激素的影响（先更新激素，再计算 PAD 影响）
        if self._hormonal_engine is not None:
            self._hormones = self._hormonal_engine.decay_all(self._hormones, elapsed_minutes)
            self._hormones = self._hormonal_engine.process_event(event, self._hormones)
            # 激素对 PAD 的持续影响（加权 0.3，不直接覆盖情绪）
            hormone_pad = self._hormonal_engine.pad_influence(self._hormones)
            current = self._emotion_state.pad
            new_pad = PADValues(
                pleasure=max(-1.0, min(1.0, current.pleasure + hormone_pad.pleasure * 0.2)),
                arousal=max(-1.0, min(1.0, current.arousal + hormone_pad.arousal * 0.2)),
                dominance=max(-1.0, min(1.0, current.dominance + hormone_pad.dominance * 0.2)),
            )
            self._emotion_state = EmotionState(pad=new_pad)

        # 3. 事件对 PAD 的直接影响（对话交互强度 0.8）
        self._emotion_state.apply_event(event, intensity=0.8)

        self._round_pad_snapshots.append(
            {
                "pleasure": self._emotion_state.pad.pleasure,
                "arousal": self._emotion_state.pad.arousal,
                "dominance": self._emotion_state.pad.dominance,
            }
        )

        mood = self._emotion_state.get_mood_label()
        logger.debug(f"🎭 情绪更新: {mood} (P={self._emotion_state.pad.pleasure:.3f}, A={self._emotion_state.pad.arousal:.3f})")

    def _compute_round_emotion_snapshot(self) -> dict[str, float]:
        if not self._round_pad_snapshots:
            current = self._emotion_state.pad if self._emotion_state else None
            if current is None:
                return {}
            return {
                "pleasure": current.pleasure,
                "arousal": current.arousal,
                "dominance": current.dominance,
            }
        snapshots = self._round_pad_snapshots
        return {
            "pleasure": sum(s["pleasure"] for s in snapshots) / len(snapshots),
            "arousal": sum(s["arousal"] for s in snapshots) / len(snapshots),
            "dominance": sum(s["dominance"] for s in snapshots) / len(snapshots),
        }

    def build_emotion_prompt(self) -> str:
        """生成当前情绪状态的系统提示注入文本。"""
        if not self._pad_available or self._emotion_state is None or self._expression_engine is None:
            return ""

        strategy = self._expression_engine.build_strategy_from_emotion_state(self._emotion_state)
        mood_cn = self._emotion_state.get_mood_label()
        pad = self._emotion_state.pad

        prompt_parts = [
            f"【当前情绪状态】{mood_cn}（愉悦度 {pad.pleasure:+.2f}，唤醒度 {pad.arousal:+.2f}，支配度 {pad.dominance:+.2f}）",
            f"【表达风格】{strategy.tone}",
        ]
        if strategy.word_choice:
            prompt_parts.append(f"【用词倾向】{'、'.join(strategy.word_choice[:5])}")
        if strategy.sentence_length != 1.0:
            length_desc = "简短" if strategy.sentence_length < 1 else "稍长"
            prompt_parts.append(f"【句子长度】{length_desc}（系数 {strategy.sentence_length:.1f}）")
        if strategy.initiative > 0.5:
            prompt_parts.append("【主动性：较高，会主动发起话题或提问】")
        else:
            prompt_parts.append("【主动性：中等，以回应为主】")

        return "\n".join(prompt_parts)

    def build_memory_prompt(self) -> str:
        """根据最后一条用户输入检索相关记忆并格式化。"""
        if not self._brain_available or self._librarian is None:
            return ""

        query = self._current_user_input.strip()
        if not query:
            return ""

        try:
            results = self._librarian.search(query, top_k=self.memory_top_k)
            if not results:
                return ""
            return self._librarian.format_prompt(results)
        except Exception as e:
            logger.warning(f"记忆检索失败: {e}")
            return ""

    def get_context(self) -> list[dict]:
        """
        获取 LLM 对话上下文（自动包含 system prompt + 情绪注入 + 记忆注入）。

        Returns:
            消息列表 [{"role": "system", "content": "..."}, ...]
        """
        context = []
        # 确保 system prompt 始终在第一条，并注入情绪状态与相关记忆
        has_system = any(m.role == "system" for m in self._history)
        if not has_system and self.system_prompt:
            full_system = self.system_prompt

            # 注入情绪提示
            if self._pad_available:
                emotion_prompt = self.build_emotion_prompt()
                if emotion_prompt:
                    full_system = full_system + "\n\n" + emotion_prompt

            # 注入相关记忆
            if self._brain_available:
                memory_prompt = self.build_memory_prompt()
                if memory_prompt:
                    full_system = full_system + "\n\n" + memory_prompt

            context.append({"role": "system", "content": full_system})
        for msg in self._history:
            context.append({"role": msg.role, "content": msg.content})
        return context

    def get_emotion_label(self) -> str:
        """获取当前情绪标签（用于 TTS 风格映射）。"""
        if not self._pad_available or self._emotion_state is None:
            return "温柔"
        return self._emotion_state.get_mood_label()

    def reflect_on_exchange(
        self,
        user_text: str,
        assistant_text: str,
        context: str = "",
    ) -> list[dict]:
        """对一轮对话进行反思，提取并保存记忆碎片。

        Args:
            user_text: 用户输入
            assistant_text: 助手回复
            context: 额外上下文（可选）

        Returns:
            已保存的记忆碎片字典列表
        """
        if not self._brain_available or self._scribe is None or not self.memory_reflection_enabled:
            return []

        try:
            emotion_snapshot = self._compute_round_emotion_snapshot()
            fragments = self._scribe.reflect_and_save(
                user_text=user_text,
                assistant_text=assistant_text,
                context=context,
                emotion_snapshot=emotion_snapshot,
            )
            self._round_pad_snapshots.clear()
            if fragments:
                logger.info(f"🧠 提取并保存 {len(fragments)} 条记忆")
            return [frag.to_dict() for frag in fragments]
        except Exception as e:
            logger.warning(f"记忆反思失败: {e}")
            return []

    def get_last_user_message(self) -> str:
        """获取最后一条用户消息"""
        return self._current_user_input

    def _trim_history(self):
        """裁剪对话历史，保留 system prompt + 最近 N 轮对话"""
        if len(self._history) <= 1:
            return

        # 保留 system prompt (第 0 条)
        system_msg = self._history[0] if self._history[0].role == "system" else None
        non_system = [m for m in self._history if m.role != "system"]

        # 保留最近的 max_history 条非系统消息
        if len(non_system) > self.max_history:
            non_system = non_system[-self.max_history:]

        # 重建历史
        self._history = []
        if system_msg:
            self._history.append(system_msg)
        self._history.extend(non_system)

    def clear(self):
        """清空对话历史，开始新会话"""
        self._history.clear()
        self._current_user_input = ""
        self.session_id = f"session_{int(time.time())}"
        self._round_pad_snapshots.clear()
        logger.info(f"会话已清空: {self.session_id}")

    def save(self, path: str):
        """
        保存会话到文件。

        Args:
            path: 保存路径
        """
        data = {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "created_at": self.created_at,
            "messages": [m.to_dict() for m in self._history],
        }
        try:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            logger.info(f"会话已保存: {path}")
        except Exception as e:
            logger.error(f"保存会话失败: {e}")

    def load(self, path: str):
        """
        从文件加载会话。

        Args:
            path: 加载路径
        """
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            self.session_id = data.get("session_id", self.session_id)
            self.user_id = data.get("user_id")
            self.created_at = data.get("created_at", self.created_at)
            self._history = [Message.from_dict(m) for m in data.get("messages", [])]
            logger.info(f"会话已加载: {path} ({len(self._history)} 条消息)")
        except Exception as e:
            logger.error(f"加载会话失败: {e}")

    @property
    def message_count(self) -> int:
        """对话消息数（不含 system prompt）"""
        return len([m for m in self._history if m.role != "system"])

    @property
    def duration(self) -> float:
        """会话持续时长（秒）"""
        return time.time() - self.created_at

    def __repr__(self):
        return (
            f"Session({self.session_id}, "
            f"msgs={self.message_count}, "
            f"duration={self.duration:.0f}s)"
        )
