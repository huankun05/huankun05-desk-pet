"""
VoxCPM TTS 模块
基于 VoxCPM2 的高质量声音克隆。

优点：
- 声音克隆效果好
- 支持流式输出
- 只需参考音频 + 文本

依赖：
- voxcpm (使用本地副本)
"""

import os
import sys
import asyncio
import numpy as np
from pathlib import Path
from loguru import logger

# 抑制 Windows asyncio 清理错误
import warnings
warnings.filterwarnings("ignore", message=".*ProactorBasePipeTransport.*")
warnings.filterwarnings("ignore", message=".*ConnectionResetError.*")

# 添加本地 VoxCPM 副本路径（优先级最高）
LOCAL_VOXCPM_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "voxcpm_local")
if os.path.exists(LOCAL_VOXCPM_PATH) and LOCAL_VOXCPM_PATH not in sys.path:
    sys.path.insert(0, LOCAL_VOXCPM_PATH)
    logger.info(f"使用本地 VoxCPM: {LOCAL_VOXCPM_PATH}")
else:
    # 回退到原始路径
    VOXCPM_PATH = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "VoxCPM", "src"
    )
    if VOXCPM_PATH not in sys.path:
        sys.path.insert(0, VOXCPM_PATH)


class VoxCPMTTS:
    """VoxCPM TTS 封装"""

    def __init__(self, config: dict = None):
        """
        初始化 VoxCPM TTS。

        Args:
            config: 配置字典
        """
        cfg = config or {}
        self.model_dir = cfg.get("model_dir", "models/tts/VoxCPM2")

        # 相对于项目根目录解析路径
        project_root = Path(__file__).parent.parent
        if not os.path.isabs(self.model_dir):
            self.model_dir = str(project_root / self.model_dir)
        self.device = cfg.get("device", "cuda")
        self.sample_rate = cfg.get("sample_rate", 24000)
        self.cfg_value = cfg.get("cfg_value", 2.0)
        self.inference_timesteps = cfg.get("inference_timesteps", 10)
        self.max_len = cfg.get("max_len", 4096)

        # 参考音频配置（相对路径解析为绝对路径）
        prompt_wav = cfg.get("prompt_wav", "")
        if prompt_wav and not os.path.isabs(prompt_wav):
            prompt_wav = str(project_root / prompt_wav)
        self.prompt_wav = prompt_wav
        self.prompt_text = cfg.get("prompt_text", "")

        # 模型实例
        self._model = None
        self._loaded = False

        logger.info(f"VoxCPMTTS: model_dir={self.model_dir}, device={self.device}")

    def init_model(self):
        """加载 VoxCPM 模型"""
        try:
            from voxcpm import VoxCPM

            logger.info(f"正在加载 VoxCPM 模型: {self.model_dir}")

            # 检查模型路径
            if not os.path.exists(self.model_dir):
                # 尝试从 HuggingFace 下载
                logger.warning(f"模型目录不存在: {self.model_dir}")
                logger.info("尝试从 HuggingFace 下载...")
                self._model = VoxCPM.from_pretrained(
                    "openbmb/VoxCPM2",
                    load_denoiser=False,
                    optimize=True,
                    device=self.device,
                )
            else:
                self._model = VoxCPM(
                    voxcpm_model_path=self.model_dir,
                    enable_denoiser=False,
                    optimize=True,
                    device=self.device,
                )

            self._loaded = True
            logger.info("VoxCPM 模型加载完成")

        except ImportError:
            logger.error("VoxCPM 未安装，请从源码安装: pip install -e ../VoxCPM/")
            raise
        except Exception as e:
            logger.error(f"VoxCPM 加载失败: {e}")
            raise

    def synthesize(self, text: str, emotion: str = None) -> np.ndarray:
        """
        合成语音。

        Args:
            text: 待合成文本
            emotion: 情感标签（可选）

        Returns:
            音频 numpy 数组 (float32)
        """
        if not self._loaded:
            logger.error("VoxCPM 模型未加载")
            return np.array([], dtype=np.float32)

        try:
            # 清理文本（移除情感标签）
            from modules.tts import _strip_styles
            clean_text, _ = _strip_styles(text)

            # 声音克隆：使用 reference_wav_path 进行音色隔离
            # （VoxCPM2 的 reference 模式通过 ref_audio tokens 提取音色，效果最优）
            kwargs = {
                "text": clean_text,
                "cfg_value": self.cfg_value,
                "inference_timesteps": self.inference_timesteps,
            }
            if self.prompt_wav and os.path.exists(self.prompt_wav):
                kwargs["reference_wav_path"] = self.prompt_wav

            # 合成
            logger.debug(f"VoxCPM 合成: {clean_text}")
            logger.debug(f"合成参数: {kwargs}")
            audio = self._model.generate(**kwargs)

            if audio is not None and len(audio) > 0:
                logger.debug(f"合成完成: {len(audio)/self.sample_rate:.1f}s")
                return audio.astype(np.float32)
            else:
                logger.warning("合成结果为空")
                return np.array([], dtype=np.float32)

        except Exception as e:
            logger.error(f"VoxCPM 合成失败: {e}")
            return np.array([], dtype=np.float32)

    def synthesize_stream(self, text: str, chunk_callback):
        """
        流式合成（支持分句，提高响应速度）。

        优化：使用 prompt cache 复用参考音频编码，多句场景避免重复编码。

        Args:
            text: 待合成文本
            chunk_callback: 回调函数 callback(audio_chunk: np.ndarray)
        """
        if not self._loaded:
            logger.error("VoxCPM 模型未加载")
            return

        # 没有参考音频时回退到非流式
        if not self.prompt_wav or not os.path.exists(self.prompt_wav):
            audio = self.synthesize(text)
            if len(audio) > 0:
                chunk_callback(audio)
            return

        try:
            from modules.tts import _strip_styles
            clean_text, _ = _strip_styles(text)

            # 分句合成（提高首包响应速度）
            sentences = self._split_sentences(clean_text)
            logger.debug(f"分句合成: {len(sentences)} 句")

            # Step 1: 预构建 prompt cache（编码参考音频一次，后续复用）
            prompt_cache = self._model.tts_model.build_prompt_cache(
                reference_wav_path=self.prompt_wav,
            )
            logger.debug(f"Prompt cache 已构建 (mode={prompt_cache.get('mode', 'unknown')})")

            for i, sentence in enumerate(sentences):
                if not sentence.strip():
                    continue

                logger.debug(f"合成第 {i+1} 句: {sentence}")

                # 使用 prompt cache 生成，避免重复编码参考音频
                gen = self._model.tts_model._generate_with_prompt_cache(
                    target_text=sentence,
                    prompt_cache=prompt_cache,
                    inference_timesteps=self.inference_timesteps,
                    cfg_value=self.cfg_value,
                    streaming=True,
                )

                for chunk in gen:
                    audio_np = chunk.squeeze(0).cpu().numpy()
                    if len(audio_np) > 0:
                        chunk_callback(audio_np.astype(np.float32))

                # 将本句生成的音频合并回 cache，保持多句间的音色连贯
                # （仅在有后续句子时做，避免不必要开销）
                if i < len(sentences) - 1:
                    try:
                        # 最后一次生成的结果包含了 audio_feat，合并回 cache
                        pass  # merge_prompt_cache 在需要时启用
                    except Exception:
                        pass

        except Exception as e:
            logger.error(f"VoxCPM 流式合成失败: {e}")
            # 降级：非流式合成整段
            logger.info("降级到非流式合成...")
            audio = self.synthesize(text)
            if len(audio) > 0:
                chunk_callback(audio)

    def _split_sentences(self, text: str) -> list[str]:
        """按句子分割文本"""
        import re
        # 按中文/英文句号、问号、感叹号、分号分割
        sentences = re.split(r'([。！？；.!?;])', text)
        result = []
        i = 0
        while i < len(sentences):
            if i + 1 < len(sentences) and sentences[i + 1] in '。！？；.!?;':
                result.append(sentences[i] + sentences[i + 1])
                i += 2
            else:
                if sentences[i].strip():
                    result.append(sentences[i])
                i += 1
        return result

    def set_prompt(self, wav_path: str, text: str):
        """设置参考音频"""
        self.prompt_wav = wav_path
        self.prompt_text = text
        logger.info(f"参考音频已更新: {wav_path}")

    def close(self):
        """释放资源"""
        self._model = None
        self._loaded = False
        logger.info("VoxCPMTTS 已关闭")
