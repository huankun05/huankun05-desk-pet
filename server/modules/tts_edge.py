"""
Edge TTS 模块 — 轻量级备选 TTS
使用 Microsoft Edge TTS API，无需本地模型。

优点：
- 无需 GPU，无需下载大模型
- 支持多种中文语音（包括年轻女声）
- 延迟低，质量好

缺点：
- 需要网络连接
- 无法自定义声音克隆
"""

import asyncio
import io
import numpy as np
from loguru import logger

try:
    import edge_tts
    HAS_EDGE_TTS = True
except ImportError:
    HAS_EDGE_TTS = False


# 可用的中文语音（适合纳西妲的年轻女声）
VOICE_OPTIONS = [
    "zh-CN-XiaoyiNeural",      # 年轻女声，活泼
    "zh-CN-XiaoxiaoNeural",    # 年轻女声，温柔
    "zh-CN-XiaohanNeural",     # 年轻女声，知性
    "zh-CN-XiaomengNeural",    # 年轻女声，可爱
    "zh-CN-XiaomoNeural",      # 年轻女声，温暖
    "zh-CN-XiaoruiNeural",     # 年轻女声，清新
    "zh-CN-XiaoshuangNeural",  # 童声
    "zh-CN-XiaoxuanNeural",    # 年轻女声，优雅
]


# 情感到语音参数的映射
EMOTION_PARAMS = {
    "开心": {"rate": "+15%", "pitch": "+5Hz", "volume": "+10%"},    # 语速快、音调高、音量大
    "认真": {"rate": "-5%", "pitch": "+0Hz", "volume": "+5%"},      # 语速慢、音调正常、音量稍大
    "害羞": {"rate": "-10%", "pitch": "+3Hz", "volume": "-10%"},    # 语速慢、音调高、音量小
    "思考": {"rate": "-20%", "pitch": "+0Hz", "volume": "-5%"},     # 语速很慢、音调正常、音量小
    "担忧": {"rate": "+5%", "pitch": "-3Hz", "volume": "-5%"},     # 语速稍快、音调低、音量小
    "温柔": {"rate": "-5%", "pitch": "+2Hz", "volume": "-5%"},     # 语速慢、音调高、音量小
}


class EdgeTTS:
    """Edge TTS 封装"""

    def __init__(self, config: dict = None):
        """
        初始化 Edge TTS。

        Args:
            config: 配置字典
        """
        cfg = config or {}
        self.voice = cfg.get("voice", "zh-CN-XiaoyiNeural")
        self.rate = cfg.get("rate", "+0%")      # 语速: -50% ~ +100%
        self.volume = cfg.get("volume", "+0%")   # 音量: -50% ~ +100%
        self.pitch = cfg.get("pitch", "+0Hz")    # 音调: -50Hz ~ +50Hz
        self.sample_rate = cfg.get("sample_rate", 24000)

        if not HAS_EDGE_TTS:
            logger.warning("edge-tts 未安装，请运行: pip install edge-tts")

        logger.info(f"EdgeTTS: voice={self.voice}, rate={self.rate}")

    def _parse_emotion(self, text: str) -> tuple[str, str]:
        """
        从文本中解析情感标签。

        Args:
            text: 可能包含 [开心]、[认真] 等标签的文本

        Returns:
            (清理后的文本, 情感标签)
        """
        import re
        # 匹配 [xxx] 格式的情感标签
        match = re.match(r'^\[([^\]]+)\](.+)$', text)
        if match:
            emotion = match.group(1)
            clean_text = match.group(2)
            return clean_text, emotion
        return text, None

    def _get_emotion_params(self, emotion: str) -> dict:
        """获取情感对应的语音参数"""
        return EMOTION_PARAMS.get(emotion, {"rate": "+0%", "pitch": "+0Hz", "volume": "+0%"})

    def synthesize(self, text: str, emotion: str = None) -> np.ndarray:
        """
        同步合成语音。

        Args:
            text: 待合成文本（可包含 [开心] 等情感标签）
            emotion: 情感标签（可选，覆盖文本中的标签）

        Returns:
            音频 numpy 数组 (float32, 24kHz)
        """
        if not HAS_EDGE_TTS:
            logger.error("edge-tts 未安装")
            return np.array([], dtype=np.float32)

        # 解析情感标签
        clean_text, parsed_emotion = self._parse_emotion(text)
        emotion = emotion or parsed_emotion

        # 获取情感参数
        if emotion:
            params = self._get_emotion_params(emotion)
            rate = params["rate"]
            pitch = params["pitch"]
            volume = params["volume"]
            logger.debug(f"情感: {emotion}, 语速: {rate}, 音调: {pitch}, 音量: {volume}")
        else:
            rate = self.rate
            pitch = self.pitch
            volume = self.volume

        # 运行异步合成
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    audio = pool.submit(
                        asyncio.run, self._async_synthesize(clean_text, rate, pitch, volume)
                    ).result()
            else:
                audio = loop.run_until_complete(
                    self._async_synthesize(clean_text, rate, pitch, volume)
                )
        except RuntimeError:
            audio = asyncio.run(self._async_synthesize(clean_text, rate, pitch, volume))

        return audio

    async def _async_synthesize(self, text: str, rate: str, pitch: str, volume: str) -> np.ndarray:
        """异步合成语音"""
        communicate = edge_tts.Communicate(
            text=text,
            voice=self.voice,
            rate=rate,
            volume=volume,
            pitch=pitch,
        )

        # 收集音频数据
        audio_chunks = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_chunks.append(chunk["data"])

        if not audio_chunks:
            return np.array([], dtype=np.float32)

        # 合并音频数据
        audio_bytes = b"".join(audio_chunks)

        # 解析 MP3 为 numpy 数组
        return self._decode_audio(audio_bytes)

    def _decode_audio(self, audio_bytes: bytes) -> np.ndarray:
        """将音频字节解码为 numpy 数组"""
        try:
            import soundfile as sf

            # 尝试用 soundfile 解析
            audio, sr = sf.read(io.BytesIO(audio_bytes))

            # 重采样到目标采样率
            if sr != self.sample_rate:
                import librosa
                audio = librosa.resample(
                    audio, orig_sr=sr, target_sr=self.sample_rate
                )

            return audio.astype(np.float32)
        except Exception:
            pass

        # 降级：用 pydub 解析
        try:
            from pydub import AudioSegment
            audio = AudioSegment.from_mp3(io.BytesIO(audio_bytes))
            audio = audio.set_frame_rate(self.sample_rate)
            audio = audio.set_channels(1)
            samples = np.array(audio.get_array_of_samples(), dtype=np.float32)
            samples /= np.max(np.abs(samples)) + 1e-6
            return samples
        except Exception as e:
            logger.error(f"音频解码失败: {e}")
            return np.array([], dtype=np.float32)

    def synthesize_stream(
        self, text: str, chunk_callback
    ):
        """
        流式合成（回调方式）。

        Args:
            text: 待合成文本
            chunk_callback: 回调函数 callback(audio_chunk: np.ndarray)
        """
        audio = self.synthesize(text)
        if len(audio) > 0:
            # 分块回调（每 4800 样本 = 200ms @ 24kHz）
            chunk_size = 4800
            for i in range(0, len(audio), chunk_size):
                chunk = audio[i:i + chunk_size]
                chunk_callback(chunk)

    def list_voices(self) -> list[str]:
        """列出可用的中文语音"""
        return VOICE_OPTIONS

    def close(self):
        """清理资源"""
        pass


def create_edge_tts(config: dict = None) -> EdgeTTS:
    """创建 EdgeTTS 实例"""
    return EdgeTTS(config)
