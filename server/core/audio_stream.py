"""
音频流管理模块
负责麦克风输入和扬声器输出的音频流管理。

核心功能：
- 麦克风实时录音（16kHz 单声道）
- 扬声器播放（支持流式播放）
- 音频格式转换
- 设备管理
"""

import queue
import threading
import numpy as np
from loguru import logger

try:
    import sounddevice as sd
except ImportError:
    sd = None
    logger.warning("sounddevice 未安装，音频 I/O 不可用")


class AudioStream:
    """音频流管理器 — 麦克风输入 + 扬声器输出"""

    def __init__(self, config: dict = None):
        """
        初始化音频流管理器。

        Args:
            config: 音频配置字典，默认从 config.yaml 读取
        """
        cfg = config or {}
        self.sample_rate = cfg.get("sample_rate", 16000)
        self.channels = cfg.get("channels", 1)
        self.chunk_size = cfg.get("chunk_size", 512)  # 512 samples = 32ms @ 16kHz
        self.dtype = cfg.get("dtype", "float32")

        # 录音状态
        self._recording = False
        self._audio_queue: queue.Queue = queue.Queue()
        self._record_stream = None
        self._record_thread = None

        # 播放状态
        self._playing = False
        self._play_queue: queue.Queue = queue.Queue()
        self._play_stream = None
        self._play_thread = None

        # 打断标志
        self._interrupt_flag = False

        logger.info(
            f"AudioStream 初始化: sr={self.sample_rate}, "
            f"chunk={self.chunk_size}, device={'可用' if sd else '不可用'}"
        )

    # ==================== 麦克风输入 ====================

    def start_recording(self, callback=None):
        """
        开始麦克风录音。

        Args:
            callback: 音频回调函数 callback(audio_chunk: np.ndarray)
        """
        if not sd:
            logger.error("sounddevice 未安装，无法录音")
            return

        if self._recording:
            logger.warning("已在录音中")
            return

        self._recording = True
        self._interrupt_flag = False

        def audio_callback(indata, frames, time_info, status):
            """sounddevice 录音回调"""
            if status:
                logger.warning(f"录音状态: {status}")
            # 复制数据（sounddevice 回调中的 buffer 会被重用）
            chunk = indata[:, 0].copy().astype(self.dtype)
            self._audio_queue.put(chunk)
            if callback:
                callback(chunk)

        try:
            self._record_stream = sd.InputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                blocksize=self.chunk_size,
                dtype=self.dtype,
                callback=audio_callback,
            )
            self._record_stream.start()
            logger.info("🎤 麦克风录音已启动")
        except Exception as e:
            self._recording = False
            logger.error(f"启动录音失败: {e}")
            raise

    def stop_recording(self):
        """停止麦克风录音"""
        if not self._recording:
            return

        self._recording = False
        if self._record_stream:
            try:
                self._record_stream.stop()
                self._record_stream.close()
            except Exception as e:
                logger.warning(f"关闭录音流异常: {e}")
            self._record_stream = None
        logger.info("🎤 麦克风录音已停止")

    def get_audio_chunk(self, timeout: float = 0.1) -> np.ndarray | None:
        """
        从录音队列获取一个音频块。

        Args:
            timeout: 超时时间（秒）

        Returns:
            音频块 numpy 数组，或 None（队列为空）
        """
        try:
            return self._audio_queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def read_audio(self) -> np.ndarray:
        """
        读取完整音频（阻塞直到录音停止）。

        Returns:
            完整音频 numpy 数组
        """
        chunks = []
        while self._recording:
            chunk = self.get_audio_chunk(timeout=0.5)
            if chunk is not None:
                chunks.append(chunk)

        if chunks:
            return np.concatenate(chunks)
        return np.array([], dtype=self.dtype)

    # ==================== 扬声器输出 ====================

    def start_playback(self):
        """开始扬声器播放"""
        if not sd:
            logger.error("sounddevice 未安装，无法播放")
            return

        if self._playing:
            logger.warning("已在播放中")
            return

        self._playing = True

        def audio_callback(outdata, frames, time_info, status):
            """sounddevice 播放回调"""
            if status:
                logger.warning(f"播放状态: {status}")
            try:
                chunk = self._play_queue.get_nowait()
                if len(chunk) < frames:
                    # 数据不足，填充零
                    outdata[:len(chunk), 0] = chunk
                    outdata[len(chunk):, 0] = 0
                else:
                    outdata[:, 0] = chunk[:frames]
            except queue.Empty:
                outdata[:, 0] = 0  # 无数据时静音

        try:
            self._play_stream = sd.OutputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                blocksize=self.chunk_size,
                dtype=self.dtype,
                callback=audio_callback,
            )
            self._play_stream.start()
            logger.info("🔊 扬声器播放已启动")
        except Exception as e:
            self._playing = False
            logger.error(f"启动播放失败: {e}")
            raise

    def stop_playback(self):
        """停止扬声器播放"""
        if not self._playing:
            return

        self._playing = False
        # 清空播放队列
        while not self._play_queue.empty():
            try:
                self._play_queue.get_nowait()
            except queue.Empty:
                break

        if self._play_stream:
            try:
                self._play_stream.stop()
                self._play_stream.close()
            except Exception as e:
                logger.warning(f"关闭播放流异常: {e}")
            self._play_stream = None
        logger.info("🔊 扬声器播放已停止")

    def play_audio(self, audio: np.ndarray):
        """
        播放一段完整音频（阻塞）。

        Args:
            audio: 音频数据 numpy 数组
        """
        if not sd:
            logger.error("sounddevice 未安装")
            return

        try:
            sd.play(audio, samplerate=self.sample_rate, blocking=True)
        except Exception as e:
            logger.error(f"播放音频失败: {e}")

    def play_chunk(self, audio_chunk: np.ndarray):
        """
        将一个音频块加入播放队列（非阻塞）。

        Args:
            audio_chunk: 音频块 numpy 数组
        """
        if self._playing:
            self._play_queue.put(audio_chunk)

    # ==================== 打断机制 ====================

    def interrupt(self):
        """打断当前播放"""
        self._interrupt_flag = True
        self.stop_playback()
        logger.info("⚡ 播放已打断")

    def is_interrupted(self) -> bool:
        """检查是否被打断"""
        if self._interrupt_flag:
            self._interrupt_flag = False
            return True
        return False

    # ==================== 工具方法 ====================

    def list_devices(self) -> list[dict]:
        """列出可用音频设备"""
        if not sd:
            return []
        devices = sd.query_devices()
        result = []
        for i, d in enumerate(devices):
            result.append({
                "id": i,
                "name": d["name"],
                "channels_in": d["max_input_channels"],
                "channels_out": d["max_output_channels"],
                "sample_rate": d["default_samplerate"],
            })
        return result

    def wait(self, duration: float = None):
        """
        等待录音结束或指定时长。

        Args:
            duration: 等待时长（秒），None 表示等待直到录音停止
        """
        import time
        if duration:
            time.sleep(duration)
        else:
            while self._recording:
                time.sleep(0.1)

    def close(self):
        """关闭音频流，释放资源"""
        self.stop_recording()
        self.stop_playback()
        # 清空队列
        for q in [self._audio_queue, self._play_queue]:
            while not q.empty():
                try:
                    q.get_nowait()
                except queue.Empty:
                    break
        logger.info("AudioStream 已关闭")
