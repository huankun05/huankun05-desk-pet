"""
主管道模块
音频流 → VAD → ASR → LLM → TTS → 扬声器

核心职责：
- 协调所有模块的协作
- 管理音频处理流程
- 处理打断（全双工）
- 提供简洁的启动接口
"""

import os
import sys
import signal
import queue
import asyncio
import threading
import numpy as np
from pathlib import Path
from loguru import logger

# 抑制 Windows asyncio 清理错误
import warnings
warnings.filterwarnings("ignore", message=".*ProactorBasePipeTransport.*")
warnings.filterwarnings("ignore", message=".*ConnectionResetError.*")

# 加载 .env 文件
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

# 加载配置
import yaml

from modules.vad import VADProcessor
from modules.asr import StreamingASR
from modules.tts import create_tts
from modules.llm import LLMChat
from modules.speaker_id import SpeakerIdentifier
from modules.text_clean import clean_for_tts
from core.audio_stream import AudioStream
from core.session import Session


def load_config(config_path: str = "config.yaml") -> dict:
    """加载配置文件"""
    # 相对于项目根目录解析路径
    project_root = Path(__file__).parent.parent
    path = project_root / config_path
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    logger.warning(f"配置文件不存在: {path}，使用默认配置")
    return {}


def setup_model_env(config: dict):
    """设置模型缓存环境变量，确保所有模型下载到项目目录内"""
    import os

    project_root = Path(__file__).parent.parent
    models_cfg = config.get("models", {})
    root_dir = project_root / models_cfg.get("root_dir", "models")

    # 创建模型目录
    for subdir in ["asr", "speaker", "tts", "vad", "torch_hub"]:
        (root_dir / subdir).mkdir(parents=True, exist_ok=True)

    # 重定向 ModelScope 缓存（ASR + Speaker ID 模型）
    os.environ["MODELSCOPE_CACHE"] = str(root_dir)
    os.environ["MODELSCOPE_HOME"] = str(root_dir)

    # 重定向 torch.hub 缓存（Silero VAD）
    os.environ["TORCH_HOME"] = str(root_dir / "torch_hub")

    # HuggingFace 缓存（某些模型可能用到）
    os.environ["HF_HOME"] = str(root_dir / "huggingface")
    os.environ["TRANSFORMERS_CACHE"] = str(root_dir / "huggingface")

    logger.info(f"模型缓存目录: {root_dir}")
    return root_dir


class NahidaPipeline:
    """纳西妲语音对话管道"""

    def __init__(self, config_path: str = "config.yaml"):
        """
        初始化管道。

        Args:
            config_path: 配置文件路径
        """
        # 加载配置
        self.config = load_config(config_path)

        # 设置模型缓存路径（确保模型下载到项目目录内）
        self.models_dir = setup_model_env(self.config)

        # 初始化各模块
        logger.info("=" * 50)
        logger.info("🌿 正在初始化 Nahida Voice AI...")
        logger.info("=" * 50)

        # 音频流
        self.audio = AudioStream(self.config.get("audio", {}))

        # VAD
        self.vad = VADProcessor(self.config.get("vad", {}))

        # ASR
        self.asr = StreamingASR(self.config.get("asr", {}))

        # TTS（使用工厂函数，自动降级）
        self.tts = create_tts(self.config)

        # LLM
        self.llm = LLMChat(self.config.get("llm", {}))

        # Speaker ID
        self.speaker = SpeakerIdentifier(self.config.get("speaker_id", {}))

        # 会话管理
        self.session = Session(self.config.get("conversation", {}))

        # 管道配置
        pipeline_cfg = self.config.get("pipeline", {})
        self.interruption_enabled = pipeline_cfg.get("interruption_enabled", True)
        self.interruption_threshold = pipeline_cfg.get("interruption_threshold", 0.3)
        self.overlap_asr_tts = pipeline_cfg.get("overlap_asr_tts", True)
        self.buffer_duration = pipeline_cfg.get("buffer_duration", 0.5)

        # 运行状态
        self._running = False
        self._processing = False  # 正在处理语音
        self._speech_queue = queue.Queue()  # 语音处理队列
        self._processing_thread = None  # 处理线程

        # 初始化模型（加载权重）
        self._init_models()

        logger.info("=" * 50)
        logger.info("✅ 所有模块初始化完成")
        logger.info("=" * 50)
        self._print_status()

    def _init_models(self):
        """加载各模块的模型权重"""
        # ASR 模型
        if self.config.get("asr", {}).get("mode") == "local":
            try:
                logger.info("📝 加载 ASR 模型...")
                self.asr.init_local_model()
                logger.info("✅ ASR 模型加载完成")
            except Exception as e:
                logger.error(f"❌ ASR 模型加载失败: {e}")

        # TTS 模型（如果使用 CosyVoice 需要加载）
        if hasattr(self.tts, 'init_local_model'):
            try:
                logger.info("🔊 加载 TTS 模型...")
                self.tts.init_local_model()
                logger.info("✅ TTS 模型加载完成")
            except Exception as e:
                logger.error(f"❌ TTS 模型加载失败: {e}")
                logger.info("💡 降级到 EdgeTTS（需要网络）")
                from modules.tts_edge import EdgeTTS
                self.tts = EdgeTTS(self.config.get("tts", {}))

        # Speaker ID 模型
        if self.speaker.enabled:
            try:
                logger.info("👤 加载 Speaker ID 模型...")
                self.speaker.init_model(self.config.get("speaker_id", {}))
                logger.info("✅ Speaker ID 模型加载完成")
            except Exception as e:
                logger.error(f"❌ Speaker ID 模型加载失败: {e}")

    def _print_status(self):
        """打印各模块状态"""
        logger.info(f"  音频: {self.audio.sample_rate}Hz, chunk={self.audio.chunk_size}")
        logger.info(f"  VAD: threshold={self.vad.threshold}")
        logger.info(f"  ASR: {self.asr}")
        logger.info(f"  TTS: {self.tts}")
        logger.info(f"  LLM: {self.llm}")
        logger.info(f"  Speaker ID: {'启用' if self.speaker.enabled else '禁用'}")

    # ==================== 核心管道 ====================

    def start(self):
        """启动实时语音对话"""
        if self._running:
            logger.warning("管道已在运行中")
            return

        self._running = True

        # 显示问候语
        greeting = self.session.start()
        logger.info(f"🌿 纳西妲: {greeting}")

        # 启动音频输出并播放问候语
        self.audio.start_playback()
        self._speak(greeting)

        # 启动麦克风录音
        self.audio.start_recording()

        # 启动处理线程
        self._processing_thread = threading.Thread(
            target=self._processing_loop, daemon=True
        )
        self._processing_thread.start()

        logger.info("🎤 开始监听... (按 Ctrl+C 退出)")
        logger.info("-" * 50)

        try:
            self._main_loop()
        except KeyboardInterrupt:
            logger.info("\n收到退出信号")
        finally:
            self._running = False
            self.stop()

    def _main_loop(self):
        """主循环：持续监听音频，检测语音段"""
        while self._running:
            chunk = self.audio.get_audio_chunk(timeout=0.1)
            if chunk is None:
                continue

            # VAD 检测
            is_speech, prob = self.vad.feed_chunk(chunk)

            if is_speech and not self._processing:
                # 检测到语音开始
                self._processing = True

                # 打断当前播放（使用配置的阈值过滤误触发）
                if self.interruption_enabled and self.audio._playing and prob >= self.interruption_threshold:
                    logger.info("⚡ 检测到语音，打断播放")
                    self.audio.interrupt()

                # 收集完整语音段
                speech_audio = self._collect_speech()

                if speech_audio is not None and len(speech_audio) > 0:
                    # 放入处理队列
                    self._speech_queue.put(speech_audio)

                self._processing = False

    def _processing_loop(self):
        """后台处理线程：从队列取出语音段，执行 ASR → LLM → TTS"""
        while self._running:
            try:
                speech_audio = self._speech_queue.get(timeout=0.5)
            except Exception:
                continue

            self._process_speech(speech_audio)

    def _collect_speech(self) -> np.ndarray | None:
        """收集完整语音段"""
        chunks = []
        silence_count = 0
        # 根据 buffer_duration 计算静音帧数（每帧 ~32ms）
        chunk_duration_ms = self.audio.chunk_size / self.audio.sample_rate * 1000
        max_silence = int(self.buffer_duration * 1000 / chunk_duration_ms)
        max_chunks = 312  # 最大 10 秒

        while self._running and len(chunks) < max_chunks:
            chunk = self.audio.get_audio_chunk(timeout=0.1)
            if chunk is None:
                continue

            is_speech, _ = self.vad.feed_chunk(chunk)
            chunks.append(chunk)

            if is_speech:
                silence_count = 0
            else:
                silence_count += 1
                if silence_count >= max_silence and len(chunks) > 5:
                    break

        if not chunks:
            return None

        return np.concatenate(chunks)

    def _process_speech(self, speech_audio: np.ndarray):
        """处理一段完整语音 — 流式重叠优化"""
        import time

        # 1. ASR 识别
        logger.info("📝 正在识别...")
        t_start = time.time()

        asr_result = self.asr.recognize(speech_audio)
        if not asr_result or not asr_result.strip():
            logger.debug("ASR 未识别到有效文本")
            return

        t_asr = time.time() - t_start
        logger.info(f"📝 识别结果 ({t_asr:.2f}s): {asr_result}")

        # 2. Speaker ID（如果启用）
        if self.speaker.enabled:
            speaker_info = self.speaker.identify(speech_audio)
            logger.info(
                f"👤 说话人: {speaker_info['user_id']} "
                f"(置信度: {speaker_info['confidence']:.2f})"
            )

        # 3. 添加到对话历史（同时触发 PAD 情绪更新）
        self.session.add_user_message(asr_result)

        # 3.5 从会话获取当前情绪（用于 TTS 风格控制）
        emotion = self.session.get_emotion_label()
        logger.info(f"🎭 情绪: {emotion}")

        # 4. LLM 生成 + TTS 流式重叠
        logger.info("🧠 正在思考...")
        t_start = time.time()

        context = self.session.get_context()

        # 流式策略：累积一定量文字后立即开始 TTS
        accumulated_text = ""
        tts_started = False
        sentence_buffer = ""

        for token in self.llm.chat_stream(context):
            accumulated_text += token
            sentence_buffer += token

            # 检测到句子结束标记，立即开始 TTS
            if not tts_started and any(
                punct in sentence_buffer
                for punct in ["。", "！", "？", "，", "！", ".", "!", "?"]
            ):
                # 第一个完整句子，开始 TTS
                tts_text = sentence_buffer.strip()
                if tts_text:
                    logger.info(f"🔊 开始合成: {tts_text[:20]}...")
                    threading.Thread(
                        target=self._speak,
                        kwargs={"text": tts_text, "emotion": emotion},
                        daemon=True,
                    ).start()
                    tts_started = True
                    sentence_buffer = ""

        # 处理剩余文字
        remaining = sentence_buffer.strip()
        if remaining:
            if tts_started:
                # 追加播放剩余部分
                threading.Thread(
                    target=self._speak,
                    kwargs={"text": remaining, "emotion": emotion},
                    daemon=True,
                ).start()
            else:
                # 没有触发过 TTS，播放全部
                self._speak(accumulated_text.strip(), emotion=emotion)

        t_llm = time.time() - t_start
        logger.info(f"🧠 回复 ({t_llm:.2f}s): {accumulated_text}")

        # 5. 添加到对话历史
        self.session.add_assistant_message(accumulated_text)

        # 6. 反思并提取记忆
        self.session.reflect_on_exchange(asr_result, accumulated_text)

        logger.info("-" * 50)

    def _speak(self, text: str, emotion: str = None):
        """
        TTS 合成并播放。

        Args:
            text: 要说的话
            emotion: 情感标签（如 "开心"、"认真"），为 None 时使用默认
        """
        if not text or not text.strip():
            return

        # 清理文本：移除表情符号、括号动作描述等
        clean_text = clean_for_tts(text)
        if not clean_text:
            logger.debug(f"清理后文本为空，跳过 TTS: {text}")
            return

        try:
            # 如果有情感标签，添加到文本前
            if emotion:
                styled_text = f"[{emotion}]{clean_text}"
            else:
                styled_text = clean_text

            # 流式 TTS
            def on_chunk(audio_chunk: np.ndarray):
                """播放每个音频块"""
                self.audio.play_chunk(audio_chunk)

            self.tts.synthesize_stream(styled_text, on_chunk)
        except Exception as e:
            logger.error(f"TTS 合成失败: {e}")
            # 降级：直接输出文本
            logger.info(f"（文本回复: {clean_text}）")

    # ==================== 控制接口 ====================

    def stop(self):
        """停止管道"""
        logger.info("正在停止 Nahida Pipeline...")
        self._running = False

        # 关闭各模块
        self.audio.close()
        self.vad.close()
        self.asr.close()
        self.tts.close()
        self.llm.close()
        self.speaker.close()

        # 保存会话
        try:
            self.session.save("logs/session.json")
        except Exception:
            pass

        logger.info("✅ Nahida Pipeline 已停止")

    def process_text(self, text: str) -> str:
        """
        文本输入模式（不通过麦克风）。

        Args:
            text: 用户输入文本

        Returns:
            纳西妲回复文本
        """
        self.session.add_user_message(text)

        context = self.session.get_context()
        reply = self.llm.chat(context)

        self.session.add_assistant_message(reply)
        self.session.reflect_on_exchange(text, reply)
        return reply

    # ==================== 诊断工具 ====================

    def benchmark(self) -> dict:
        """运行延迟基准测试"""
        import time
        results = {}

        # 测试 ASR
        dummy_audio = np.random.randn(16000).astype(np.float32)  # 1 秒
        t_start = time.time()
        self.asr.recognize(dummy_audio)
        results["asr_latency"] = time.time() - t_start

        # 测试 TTS
        t_start = time.time()
        self.tts.synthesize("测试")
        results["tts_latency"] = time.time() - t_start

        # 测试 LLM
        context = [{"role": "user", "content": "你好"}]
        t_start = time.time()
        self.llm.chat(context)
        results["llm_latency"] = time.time() - t_start

        results["total_latency"] = sum(results.values())
        return results


# ==================== 命令行入口 ====================

def main():
    """命令行启动"""
    import argparse

    parser = argparse.ArgumentParser(
        description="🌿 Nahida Voice AI - 纳西妲语音对话系统",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用示例:
  python -m core.pipeline              # 语音对话模式（默认）
  python -m core.pipeline --text       # 文本对话模式（无需麦克风）
  python -m core.pipeline --greeting   # 仅播放问候语
  python -m core.pipeline --benchmark  # 运行延迟基准测试
        """,
    )
    parser.add_argument(
        "--text", action="store_true",
        help="文本对话模式（无需麦克风，直接输入文字）",
    )
    parser.add_argument(
        "--greeting", action="store_true",
        help="仅播放问候语后退出",
    )
    parser.add_argument(
        "--benchmark", action="store_true",
        help="运行延迟基准测试",
    )
    parser.add_argument(
        "--config", type=str, default="config.yaml",
        help="配置文件路径 (默认: config.yaml)",
    )
    args = parser.parse_args()

    # 配置日志
    logger.remove()
    logger.add(sys.stderr, level="INFO", format=(
        "<green>{time:HH:mm:ss}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan> - "
        "<level>{message}</level>"
    ))

    logger.info("🌿 Nahida Voice AI 启动中...")
    logger.info("")

    # 创建管道
    try:
        pipeline = NahidaPipeline(args.config)
    except Exception as e:
        logger.error(f"管道初始化失败: {e}")
        logger.info("💡 请先运行 python tools/download_models.py 下载模型")
        sys.exit(1)

    # 处理退出信号
    def signal_handler(sig, frame):
        logger.info("\n收到退出信号，正在停止...")
        pipeline.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)

    # 根据模式执行
    try:
        if args.benchmark:
            _run_benchmark(pipeline)
        elif args.greeting:
            _run_greeting(pipeline)
        elif args.text:
            _run_text_chat(pipeline)
        else:
            pipeline.start()
    except Exception as e:
        logger.error(f"运行异常: {e}")
        pipeline.stop()
        raise


def _run_benchmark(pipeline):
    """运行延迟基准测试"""
    logger.info("📊 开始延迟基准测试...")
    results = pipeline.benchmark()

    logger.info("")
    logger.info("=" * 50)
    logger.info("📊 延迟测试结果:")
    for name, latency in results.items():
        logger.info(f"  {name}: {latency*1000:.1f}ms")
    logger.info("=" * 50)

    pipeline.stop()


def _run_greeting(pipeline):
    """播放问候语"""
    greeting = pipeline.session.start()
    logger.info(f"🌿 纳西妲: {greeting}")

    try:
        pipeline.audio.start_playback()
        pipeline._speak(greeting)
        import time
        time.sleep(3)  # 等待播放完成
    except Exception as e:
        logger.error(f"播放问候语失败: {e}")
    finally:
        pipeline.stop()


def _run_text_chat(pipeline):
    """文本对话模式（无需麦克风）"""
    logger.info("💬 文本对话模式 (输入 'quit' 或 'exit' 退出)")
    logger.info("=" * 50)

    # 显示问候语
    greeting = pipeline.session.start()
    logger.info(f"🌿 纳西妲: {greeting}")
    logger.info("")

    try:
        while True:
            try:
                user_input = input("👤 你: ").strip()
            except EOFError:
                break

            if not user_input:
                continue
            if user_input.lower() in ("quit", "exit", "q"):
                logger.info("再见，旅行者！")
                break

            # 处理输入
            reply = pipeline.process_text(user_input)
            logger.info(f"🌿 纳西妲: {reply}")
            logger.info("")

    except KeyboardInterrupt:
        logger.info("\n再见，旅行者！")
    finally:
        pipeline.stop()


if __name__ == "__main__":
    main()
