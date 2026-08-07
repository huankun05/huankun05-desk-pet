"""
Silero VAD (Voice Activity Detection) 封装模块
==============================================
基于 snakers4/silero-vad 模型，提供实时和批量语音检测能力。
用于 Nahida Voice AI 的实时语音管道，检测音频流中的语音活动。

核心功能:
- 实时流式检测: feed_chunk() 逐帧处理，自动跟踪语音状态
- 批量处理: process_full() 一次性处理整段音频
- 语音分段: 返回带时间戳的语音片段及其音频数据
"""

import threading
import time
from typing import Optional

import numpy as np
import torch
from loguru import logger

# Silero VAD 要求的采样率
_SAMPLE_RATE = 16000

# 默认配置值 (与 config.yaml 保持一致)
_DEFAULT_CONFIG = {
    "threshold": 0.5,               # 语音检测阈值 (0-1)
    "min_speech_duration": 0.25,    # 最短语音段 (秒)
    "min_silence_duration": 0.3,    # 最短静音段 (秒)
    "speech_pad": 0.1,              # 语音前后填充 (秒)
    "max_speech_duration": 30,      # 最长语音段 (秒)
    "chunk_size": 512,              # 每帧采样点数 (32ms @ 16kHz)
}


def get_speech_timestamps(
    audio: np.ndarray,
    model: torch.nn.Module,
    threshold: float = 0.5,
    sampling_rate: int = _SAMPLE_RATE,
    min_speech_duration_ms: int = 250,
    min_silence_duration_ms: int = 300,
    speech_pad_ms: int = 100,
    max_speech_duration_s: float = 30.0,
) -> list[dict]:
    """
    获取语音时间戳 —— 包装 silero-vad 自带的 utils 函数。

    Args:
        audio: float32 numpy 数组, 16kHz 单声道音频
        model: 已加载的 Silero VAD 模型
        threshold: 检测阈值 (0-1)
        sampling_rate: 采样率, 默认 16000
        min_speech_duration_ms: 最短语音段 (毫秒)
        min_silence_duration_ms: 最短静音段 (毫秒)
        speech_pad_ms: 语音前后填充 (毫秒)
        max_speech_duration_s: 最长语音段 (秒)

    Returns:
        语音分段列表, 每个元素为 {"start": 采样点, "end": 采样点}
    """
    from silero_vad.utils import get_speech_timestamps as _get_speech_timestamps

    # 确保模型处于评估模式
    model.eval()

    return _get_speech_timestamps(
        audio,
        model,
        threshold=threshold,
        sampling_rate=sampling_rate,
        min_speech_duration_ms=min_speech_duration_ms,
        min_silence_duration_ms=min_silence_duration_ms,
        speech_pad_ms=speech_pad_ms,
        max_speech_duration_s=max_speech_duration_s,
    )


class VADProcessor:
    """
    Silero VAD 处理器 —— 支持实时流式和批量两种处理模式。

    实时模式下, 通过 feed_chunk() 逐帧送入音频, 内部自动跟踪语音状态,
    在检测到语音结束 (静音超过阈值) 时返回完整的语音段。

    用法示例::

        # 初始化
        vad = VADProcessor(config)

        # 实时模式
        is_speech, prob = vad.feed_chunk(audio_chunk)
        if is_speech:
            segment = vad.get_current_segment()  # 获取当前语音段

        # 批量模式
        segments = vad.process_full(audio_array)

        # 清理
        vad.close()
    """

    def __init__(self, config: Optional[dict] = None):
        """
        初始化 VAD 处理器。

        Args:
            config: VAD 配置字典, 支持的键参见 _DEFAULT_CONFIG。
                    未提供的键使用默认值。
        """
        # 合并配置: 用户配置覆盖默认值
        cfg = {**_DEFAULT_CONFIG, **(config or {})}

        self._threshold: float = cfg["threshold"]
        self._min_speech_duration: float = cfg["min_speech_duration"]
        self._min_silence_duration: float = cfg["min_silence_duration"]
        self._speech_pad: float = cfg["speech_pad"]
        self._max_speech_duration: float = cfg["max_speech_duration"]
        self._chunk_size: int = cfg["chunk_size"]

        # 采样点单位的阈值计算
        self._min_speech_samples = int(self._min_speech_duration * _SAMPLE_RATE)
        self._min_silence_samples = int(self._min_silence_duration * _SAMPLE_RATE)
        self._speech_pad_samples = int(self._speech_pad * _SAMPLE_RATE)
        self._max_speech_samples = int(self._max_speech_duration * _SAMPLE_RATE)

        # 加载 Silero VAD 模型
        # 优先使用 pip 安装的 silero-vad，失败则尝试 torch.hub
        logger.info("正在加载 Silero VAD 模型...")

        try:
            # 方式1: 使用 pip 安装的 silero-vad
            from silero_vad import load_silero_vad
            self._model = load_silero_vad(onnx=False)
            logger.info("Silero VAD 模型加载完成 (pip)")
        except ImportError:
            # 方式2: 使用 torch.hub (需要网络)
            logger.info("pip silero-vad 不可用，尝试 torch.hub...")
            self._model, _ = torch.hub.load(
                repo_or_dir="snakers4/silero-vad",
                model="silero_vad",
                force_reload=False,
                onnx=False,
                source="github",
            )
            logger.info("Silero VAD 模型加载完成 (torch.hub)")

        # 实时处理状态
        self._lock = threading.Lock()
        self._reset_stream_state()

        # 模型是否已释放
        self._closed = False

    def _reset_stream_state(self) -> None:
        """重置流式处理的内部状态。"""
        # 语音状态追踪
        self._speech_started = False        # 是否正在语音中
        self._speech_buffer: list[np.ndarray] = []  # 当前语音段的音频缓冲
        self._silence_counter = 0           # 连续静音帧计数
        self._total_samples = 0             # 已处理的总采样点数

        # 模型的隐状态 (用于流式处理的上下文传递)
        self._model.reset_states()

    def _compute_chunk_probability(self, chunk: np.ndarray) -> float:
        """
        计算单个音频块的语音概率。

        Args:
            chunk: float32 numpy 数组, 长度应为 chunk_size (512)

        Returns:
            语音概率 (0-1)
        """
        # 将 numpy 转为 torch tensor
        tensor = torch.from_numpy(chunk)

        # Silero VAD 要求输入为 1D tensor
        if tensor.dim() == 1:
            tensor = tensor.unsqueeze(0)

        with torch.no_grad():
            prob = self._model(tensor, _SAMPLE_RATE).item()

        return prob

    def feed_chunk(self, chunk: np.ndarray) -> tuple[bool, float]:
        """
        实时处理单个音频块。

        线程安全: 内部使用锁保护状态。

        Args:
            chunk: float32 numpy 数组, 16kHz 单声道,
                   建议长度为 chunk_size (512 采样点)

        Returns:
            (is_speech, probability) 元组:
            - is_speech: 当前块是否包含语音
            - probability: 语音检测概率 (0-1)
        """
        if self._closed:
            raise RuntimeError("VADProcessor 已关闭, 无法继续处理")

        with self._lock:
            prob = self._compute_chunk_probability(chunk)
            is_speech = prob >= self._threshold

            if is_speech:
                # 检测到语音
                self._speech_buffer.append(chunk.copy())
                self._silence_counter = 0

                if not self._speech_started:
                    # 新语音段开始
                    self._speech_started = True
                    logger.debug(
                        f"语音开始 @ {self._total_samples / _SAMPLE_RATE:.2f}s, "
                        f"概率: {prob:.3f}"
                    )
            else:
                # 检测到静音
                if self._speech_started:
                    self._silence_counter += len(chunk)

                    # 语音进行中仍追加少量数据 (用于平滑过渡)
                    # 但不重置静音计数器
                else:
                    self._silence_counter += len(chunk)

            self._total_samples += len(chunk)

            return is_speech, prob

    def check_speech_end(self) -> Optional[np.ndarray]:
        """
        检查是否应该结束当前语音段。

        在 feed_chunk() 调用之间穿插调用, 当检测到足够的静音后,
        返回完整的语音段音频数据并重置状态。

        Returns:
            如果语音段结束, 返回拼接后的 float32 numpy 数组;
            否则返回 None。
        """
        with self._lock:
            if not self._speech_started:
                return None

            # 语音过长时强制截断
            current_samples = sum(len(c) for c in self._speech_buffer)
            if current_samples >= self._max_speech_samples:
                logger.warning(
                    f"语音段超过最大时长 "
                    f"({self._max_speech_duration}s), 强制截断"
                )
                return self._finalize_speech()

            # 静音足够长 -> 结束语音段
            if self._silence_counter >= self._min_silence_samples:
                return self._finalize_speech()

            return None

    def _finalize_speech(self) -> np.ndarray:
        """
        完成当前语音段: 过滤太短的段, 拼接音频, 重置状态。

        Returns:
            拼接后的音频数据, 或空数组 (如果段太短被过滤)
        """
        if not self._speech_buffer:
            self._speech_started = False
            return np.array([], dtype=np.float32)

        audio = np.concatenate(self._speech_buffer)

        # 过滤太短的语音段
        if len(audio) < self._min_speech_samples:
            logger.debug(
                f"语音段过短 ({len(audio) / _SAMPLE_RATE:.2f}s), 已过滤"
            )
            self._speech_started = False
            self._speech_buffer.clear()
            self._silence_counter = 0
            return np.array([], dtype=np.float32)

        duration = len(audio) / _SAMPLE_RATE
        logger.info(
            f"语音段完成: 时长 {duration:.2f}s, "
            f"采样点 {len(audio)}"
        )

        # 重置状态, 为下一段做准备
        self._speech_started = False
        self._speech_buffer.clear()
        self._silence_counter = 0
        self._model.reset_states()

        return audio

    def get_current_segment(self) -> Optional[dict]:
        """
        获取当前正在处理的语音段 (即使尚未结束)。

        用于需要在语音进行中获取中间结果的场景。

        Returns:
            语音段字典 {"start": 起始秒, "end": 结束秒, "audio": np.ndarray},
            如果没有活跃的语音段则返回 None。
        """
        with self._lock:
            if not self._speech_started or not self._speech_buffer:
                return None

            audio = np.concatenate(self._speech_buffer)
            current_samples = sum(len(c) for c in self._speech_buffer)
            start_sample = self._total_samples - current_samples

            return {
                "start": start_sample / _SAMPLE_RATE,
                "end": self._total_samples / _SAMPLE_RATE,
                "audio": audio,
            }

    def process_full(self, audio: np.ndarray) -> list[dict]:
        """
        批量处理整段音频, 返回所有语音分段。

        适用于非实时场景 (如处理预录制的音频文件)。

        Args:
            audio: float32 numpy 数组, 16kHz 单声道

        Returns:
            语音分段列表, 每个元素为:
            {"start": 起始秒, "end": 结束秒, "audio": np.ndarray}
        """
        if self._closed:
            raise RuntimeError("VADProcessor 已关闭")

        # 获取原始分段 (采样点单位)
        raw_segments = get_speech_timestamps(
            audio,
            self._model,
            threshold=self._threshold,
            min_speech_duration_ms=int(self._min_speech_duration * 1000),
            min_silence_duration_ms=int(self._min_silence_duration * 1000),
            speech_pad_ms=int(self._speech_pad * 1000),
            max_speech_duration_s=self._max_speech_duration,
        )

        # 转换为带时间戳和音频数据的字典
        segments = []
        for seg in raw_segments:
            start_sample = seg["start"]
            end_sample = seg["end"]

            # 添加语音填充 (前后各扩展), 并裁剪到有效范围
            padded_start = max(0, start_sample - self._speech_pad_samples)
            padded_end = min(len(audio), end_sample + self._speech_pad_samples)

            segments.append({
                "start": padded_start / _SAMPLE_RATE,
                "end": padded_end / _SAMPLE_RATE,
                "audio": audio[padded_start:padded_end].copy(),
            })

        logger.info(
            f"批量 VAD 完成: 音频 {len(audio) / _SAMPLE_RATE:.2f}s, "
            f"检测到 {len(segments)} 个语音段"
        )

        return segments

    def reset(self) -> None:
        """重置流式处理状态, 开始新的处理会话。"""
        with self._lock:
            self._reset_stream_state()
            logger.debug("VAD 流式状态已重置")

    def close(self) -> None:
        """
        释放模型资源。

        调用后该实例不可再使用。
        """
        if self._closed:
            return

        with self._lock:
            self._closed = True
            self._model.reset_states()
            del self._model
            self._speech_buffer.clear()
            logger.info("VADProcessor 已关闭, 资源已释放")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
        return False

    def __del__(self):
        """析构时自动释放资源 (安全兜底)。"""
        try:
            self.close()
        except Exception:
            pass  # 析构函数中不抛异常

    # ------------------------------------------------------------------
    # 属性访问 (只读)
    # ------------------------------------------------------------------

    @property
    def is_speaking(self) -> bool:
        """当前是否正在检测到语音。"""
        with self._lock:
            return self._speech_started

    @property
    def threshold(self) -> float:
        """当前检测阈值。"""
        return self._threshold

    @property
    def chunk_size(self) -> int:
        """每帧采样点数。"""
        return self._chunk_size
