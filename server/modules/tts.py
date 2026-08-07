"""
CosyVoice 2 TTS 模块
====================

封装 CosyVoice 2 语音合成能力，支持本地推理和 HTTP API 两种模式。
本地模式通过 CosyVoice Python API 直接加载模型，
API 模式通过 HTTP POST 请求远程 TTS 服务。

纳西妲声音克隆核心流程：加载参考音频 -> CosyVoice2 voice cloning -> 流式输出
"""

import os
import re
import sys
import threading
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import requests
import torchaudio
from loguru import logger


# ============================================================
# 样式标签定义
# ============================================================

# 支持的情绪标签及其对应的 instruct_text
STYLE_MAP: dict[str, str] = {
    "[开心]": "用开心活泼的语气说",
    "[认真]": "用认真严肃的语气说",
    "[害羞]": "用害羞温柔的语气说",
    "[思考]": "用思考犹豫的语气说",
    "[温柔]": "用温柔轻声的语气说",
    "[担忧]": "用担忧关切的语气说",
}

# 匹配所有样式标签的正则
_STYLE_PATTERN = re.compile(
    "(" + "|".join(re.escape(tag) for tag in STYLE_MAP) + ")"
)


def _strip_styles(text: str) -> tuple[str, list[str]]:
    """
    从文本中提取并移除样式标签。

    Returns:
        (清理后的文本, 提取到的 instruct_text 列表)
    """
    found = _STYLE_PATTERN.findall(text)
    clean_text = _STYLE_PATTERN.sub("", text).strip()
    instruct_texts = [STYLE_MAP[tag] for tag in found]
    return clean_text, instruct_texts


def _load_audio(path: str, target_sr: int = 16000) -> np.ndarray:
    """
    加载音频文件并重采样到目标采样率。

    Args:
        path: 音频文件路径
        target_sr: 目标采样率，默认 16kHz (CosyVoice2 要求)

    Returns:
        numpy 数组, shape (1, N)
    """
    if not os.path.isfile(path):
        raise FileNotFoundError(f"参考音频不存在: {path}")

    speech, sr = torchaudio.load(path)
    # 重采样到目标采样率
    if sr != target_sr:
        speech = torchaudio.transforms.Resample(orig_freq=sr, new_freq=target_sr)(speech)
    return speech.numpy()  # shape: (1, N)


# ============================================================
# CosyVoiceAPI - HTTP API 模式
# ============================================================

class CosyVoiceAPI:
    """
    通过 HTTP API 调用远程 CosyVoice TTS 服务。

    请求格式: POST /tts
    Body: { "text": "...", "style": "..." }
    Response: audio/wav 二进制流
    """

    def __init__(self, config: dict):
        self.api_url: str = config.get("api_url", "http://127.0.0.1:9880/tts")
        self.timeout: int = config.get("timeout", 30)
        self.sample_rate: int = config.get("sample_rate", 22050)
        logger.info(f"CosyVoiceAPI 初始化: url={self.api_url}")

    def synthesize(self, text: str, style: str = "") -> np.ndarray:
        """调用 API 合成语音，返回音频 numpy 数组。"""
        payload = {"text": text}
        if style:
            payload["style"] = style

        try:
            resp = requests.post(
                self.api_url, json=payload, timeout=self.timeout
            )
            resp.raise_for_status()
            # 假设返回 WAV 二进制流，解析为 numpy
            import io
            import soundfile as sf

            audio, sr = sf.read(io.BytesIO(resp.content))
            if sr != self.sample_rate:
                logger.warning(
                    f"API 返回采样率 {sr} 与配置 {self.sample_rate} 不一致"
                )
            return audio.astype(np.float32)
        except requests.RequestException as e:
            logger.error(f"TTS API 调用失败: {e}")
            raise


# ============================================================
# CosyVoiceTTS - 本地推理 + 流式合成
# ============================================================

class CosyVoiceTTS:
    """
    CosyVoice 2 本地 TTS 封装。

    核心能力:
      - 基于参考音频的声音克隆
      - 情绪风格控制 ([开心]/[认真]/[害羞]/[思考])
      - 流式合成 (chunk_callback 逐块回调)
      - 线程安全
    """

    def __init__(self, config: dict):
        """
        初始化 TTS 模块。

        Args:
            config: config.yaml 中 tts 部分的配置字典
        """
        # config 传入方式：
        # - 如果直接传 tts 子字典: config = {"model_dir": ..., "device": ...}
        # - 如果传完整 config: config = {"tts": {"model_dir": ...}}
        # 统一处理：优先取 tts 子字典，否则直接用
        tts_cfg = config.get("tts", config) if "tts" in config else config

        # 基本参数
        self.model_dir: str = tts_cfg.get(
            "model_dir", "pretrained_models/CosyVoice2-0.5B"
        )
        self.checkpoint: str = tts_cfg.get("checkpoint", "")
        self.device: str = tts_cfg.get("device", "cuda")
        self.sample_rate: int = tts_cfg.get("sample_rate", 22050)
        self.speed: float = tts_cfg.get("speed", 1.0)
        self.max_mel_tokens: int = tts_cfg.get("max_mel_tokens", 200)
        self.prompt_text: str = tts_cfg.get(
            "prompt_text", "你好，我是纳西妲，世界树的管理者。"
        )
        self.prompt_wav: str = tts_cfg.get("prompt_wav", "")
        self.enable_streaming: bool = tts_cfg.get("streaming", True)

        # 运行时状态
        self._model = None
        self._prompt_audio_16k: Optional[np.ndarray] = None
        self._lock = threading.Lock()

        logger.info(
            f"CosyVoiceTTS 配置加载完成: "
            f"model_dir={self.model_dir}, device={self.device}, "
            f"sample_rate={self.sample_rate}, speed={self.speed}"
        )

    # ----------------------------------------------------------
    # 模型加载
    # ----------------------------------------------------------

    def init_local_model(self) -> None:
        """
        加载 CosyVoice2 模型和参考音频。

        必须在使用 synthesize 之前调用。
        """
        logger.info(f"正在加载 CosyVoice2 模型: {self.model_dir}")

        try:
            # 添加 CosyVoice 路径到 sys.path
            import sys
            cosyvoice_path = str(Path(self.model_dir).parent)
            matcha_path = str(Path(self.model_dir).parent / "third_party" / "Matcha-TTS")
            if cosyvoice_path not in sys.path:
                sys.path.insert(0, cosyvoice_path)
            if matcha_path not in sys.path:
                sys.path.insert(0, matcha_path)

            from cosyvoice.cli.cosyvoice import CosyVoice2
        except ImportError:
            raise ImportError(
                "CosyVoice 未安装。请从源码安装: pip install -e CosyVoice/"
            )

        # 加载模型
        self._model = CosyVoice2(self.model_dir)
        logger.info("CosyVoice2 模型加载完成")

        # 加载纳西妲参考音频 (用于声音克隆)
        if self.prompt_wav:
            self._prompt_audio_16k = _load_audio(self.prompt_wav, target_sr=16000)
            logger.info(
                f"参考音频已加载: {self.prompt_wav} "
                f"(shape={self._prompt_audio_16k.shape})"
            )
        else:
            logger.warning("未配置 prompt_wav，声音克隆功能将不可用")

    def _ensure_model(self) -> None:
        """确保模型已加载，未加载则抛出异常。"""
        if self._model is None:
            raise RuntimeError("模型未初始化，请先调用 init_local_model()")

    # ----------------------------------------------------------
    # 全量合成
    # ----------------------------------------------------------

    def synthesize(self, text: str) -> np.ndarray:
        """
        全量合成：输入完整文本，返回完整音频数组。

        自动处理样式标签 ([开心] 等)，提取 instruct_text。

        Args:
            text: 待合成文本，可包含样式标签

        Returns:
            音频 numpy 数组, shape (N,), float32, 采样率 = self.sample_rate
        """
        self._ensure_model()

        # 解析样式标签
        clean_text, instruct_texts = _strip_styles(text)
        instruct_text = "，".join(instruct_texts) if instruct_texts else ""

        logger.debug(
            f"全量合成: text='{clean_text}', "
            f"instruct='{instruct_text}'"
        )

        with self._lock:
            # 使用 inference_zero_shot 进行声音克隆
            # prompt_text 是参考音频的文本内容
            prompt_text = self.prompt_text if self.prompt_text else ""

            output = self._model.inference_zero_shot(
                tts_text=clean_text,
                prompt_text=prompt_text,
                prompt_wav=self.prompt_wav if self._prompt_audio_16k is not None else None,
                stream=False,
            )
            # 收集所有 chunk，拼接为完整音频
            audio_chunks = []
            for chunk in output:
                audio_chunks.append(chunk["tts_speech"].numpy().flatten())

        if not audio_chunks:
            logger.warning("合成结果为空")
            return np.array([], dtype=np.float32)

        full_audio = np.concatenate(audio_chunks)
        logger.debug(f"合成完成: {len(full_audio)} 样本, {len(full_audio)/self.sample_rate:.2f}s")
        return full_audio

    # ----------------------------------------------------------
    # 流式合成
    # ----------------------------------------------------------

    def synthesize_stream(
        self, text: str, chunk_callback: Callable[[np.ndarray], None]
    ) -> None:
        """
        流式合成：逐块调用 callback，实现低延迟播放。

        每收到一个音频块就立即回调，适用于实时播放场景。

        Args:
            text: 待合成文本，可包含样式标签
            chunk_callback: 回调函数，参数为单个音频 chunk (np.ndarray, float32)
        """
        self._ensure_model()

        clean_text, instruct_texts = _strip_styles(text)
        instruct_text = "，".join(instruct_texts) if instruct_texts else ""

        logger.debug(
            f"流式合成: text='{clean_text}', "
            f"instruct='{instruct_text}'"
        )

        with self._lock:
            # 使用 inference_zero_shot 进行声音克隆
            # prompt_text 是参考音频的文本内容
            prompt_text = self.prompt_text if self.prompt_text else ""

            output = self._model.inference_zero_shot(
                tts_text=clean_text,
                prompt_text=prompt_text,
                prompt_wav=self.prompt_wav if self._prompt_audio_16k is not None else None,
                stream=False,
            )
            chunk_count = 0
            for chunk in output:
                audio = chunk["tts_speech"].numpy().flatten()
                chunk_callback(audio)
                chunk_count += 1

        logger.debug(f"流式合成完成: {chunk_count} 个音频块已回调")

    # ----------------------------------------------------------
    # 带风格的合成
    # ----------------------------------------------------------

    def synthesize_with_style(self, text: str, style: str) -> np.ndarray:
        """
        显式指定风格的合成（不依赖文本中的标签）。

        与 synthesize() 不同，style 参数直接作为 instruct_text，
        文本中的样式标签不会被解析。

        Args:
            text: 纯文本（不含样式标签）
            style: instruct_text，如 "用温柔的语气说"

        Returns:
            音频 numpy 数组
        """
        self._ensure_model()

        logger.debug(f"风格合成: text='{text}', style='{style}'")

        with self._lock:
            output = self._model.inference_instruct2(
                tts_text=text,
                instruct_text=style,
                prompt_wav=self.prompt_wav if self._prompt_audio_16k is not None else None,
            )
            audio_chunks = []
            for chunk in output:
                audio_chunks.append(chunk["tts_speech"].numpy().flatten())

        if not audio_chunks:
            logger.warning("合成结果为空")
            return np.array([], dtype=np.float32)

        full_audio = np.concatenate(audio_chunks)
        logger.debug(f"风格合成完成: {len(full_audio)/self.sample_rate:.2f}s")
        return full_audio

    # ----------------------------------------------------------
    # 参考音频设置
    # ----------------------------------------------------------

    def set_prompt(self, text: str, wav_path: str) -> None:
        """
        更新声音克隆的参考音频。

        可在运行时动态切换角色声音。

        Args:
            text: 参考音频对应的文本（用于 prompt 对齐）
            wav_path: 参考音频文件路径
        """
        self.prompt_text = text
        self.prompt_wav = wav_path
        self._prompt_audio_16k = _load_audio(wav_path, target_sr=16000)
        logger.info(
            f"参考音频已更新: wav={wav_path}, "
            f"text='{text}', shape={self._prompt_audio_16k.shape}"
        )

    # ----------------------------------------------------------
    # 清理资源
    # ----------------------------------------------------------

    def close(self) -> None:
        """释放模型资源和缓存。"""
        with self._lock:
            if self._model is not None:
                del self._model
                self._model = None
            self._prompt_audio_16k = None

            # 尝试释放 CUDA 缓存
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass

        logger.info("CosyVoiceTTS 资源已释放")

    def __del__(self):
        """析构时自动清理。"""
        try:
            self.close()
        except Exception:
            pass

    def __enter__(self):
        """支持 with 语句。"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """支持 with 语句。"""
        self.close()
        return False


# ============================================================
# 工厂函数 - 根据配置创建 TTS 实例
# ============================================================

def create_tts(config: dict):
    """
    根据 config.yaml 配置创建 TTS 实例。

    支持的模式:
      - gpt_sovits: GPT-SoVITS v2（当前主力，RTF 0.47x）
      - voxcpm:     VoxCPM2（备选，音质好但不实时）
      - local:      CosyVoice 2（已废弃，音质不达标）
      - api:        CosyVoice HTTP API
      - edge:       Microsoft Edge TTS（最终降级）

    自动降级策略：
      gpt_sovits/voxcpm 失败 → EdgeTTS

    Args:
        config: 完整的 config.yaml 配置字典

    Returns:
        TTS 实例 (GPTSoVITSTTS / VoxCPMTTS / CosyVoiceTTS / CosyVoiceAPI / EdgeTTS)
    """
    tts_cfg = config.get("tts", {})
    mode = tts_cfg.get("mode", "gpt_sovits")

    if mode == "gpt_sovits":
        try:
            from modules.tts_gpt_sovits import GPTSoVITSTTS
            tts = GPTSoVITSTTS(config)
            tts.init_model()
            return tts
        except Exception as e:
            logger.warning(f"GPT-SoVITS 不可用 ({e})，尝试 VoxCPM...")
            try:
                from modules.tts_voxcpm import VoxCPMTTS
                tts = VoxCPMTTS(tts_cfg)
                tts.init_model()
                return tts
            except Exception as e2:
                logger.warning(f"VoxCPM 也不可用 ({e2})，降级到 EdgeTTS")
                from modules.tts_edge import EdgeTTS
                return EdgeTTS(tts_cfg)

    elif mode == "voxcpm":
        try:
            from modules.tts_voxcpm import VoxCPMTTS
            tts = VoxCPMTTS(tts_cfg)
            tts.init_model()
            return tts
        except Exception as e:
            logger.warning(f"VoxCPM 不可用 ({e})，降级到 EdgeTTS")
            from modules.tts_edge import EdgeTTS
            return EdgeTTS(tts_cfg)

    elif mode == "local":
        try:
            import sys
            model_dir = tts_cfg.get("model_dir", "")
            if model_dir:
                cosyvoice_root = str(Path(model_dir).parent.parent)
                matcha_path = str(Path(model_dir).parent.parent / "third_party" / "Matcha-TTS")
                if cosyvoice_root not in sys.path:
                    sys.path.insert(0, cosyvoice_root)
                if matcha_path not in sys.path:
                    sys.path.insert(0, matcha_path)
                logger.info(f"CosyVoice 路径: {cosyvoice_root}")

            from cosyvoice.cli.cosyvoice import CosyVoice2
            tts = CosyVoiceTTS(config)
            tts.init_local_model()
            return tts
        except (ImportError, Exception) as e:
            logger.warning(f"CosyVoice 不可用 ({e})")
            from modules.tts_edge import EdgeTTS
            return EdgeTTS(tts_cfg)

    elif mode == "api":
        return CosyVoiceAPI(tts_cfg)

    elif mode == "edge":
        from modules.tts_edge import EdgeTTS
        return EdgeTTS(tts_cfg)

    else:
        raise ValueError(f"不支持的 TTS 模式: {mode}")
