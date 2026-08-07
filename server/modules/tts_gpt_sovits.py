"""
GPT-SoVITS v2 TTS 模块
======================

封装 GPT-SoVITS v2 的纳西妲语音合成，统一 TTS 接口。
使用 test_gen.py 验证过的直接模型加载方式，避免 inference_webui 兼容性问题。

特性:
  - RTF 0.47x 实时合成
  - 7kHz 低通后处理减少电音感
  - 线程安全锁
"""
import os
import sys
import json
import threading
from pathlib import Path
from typing import Optional, Callable

import numpy as np
import torch
from loguru import logger


class GPTSoVITSTTS:
    """
    GPT-SoVITS v2 纳西妲 TTS 引擎。

    Usage:
        tts = GPTSoVITSTTS(config)
        tts.init_model()
        audio = tts.synthesize("你好呀旅行者！")
    """

    def __init__(self, config: dict):
        tts_cfg = config.get("tts", config) if "tts" in config else config

        # GPT-SoVITS 项目根目录
        self._root: str = tts_cfg.get(
            "gpt_sovits_root",
            str(Path(__file__).parent.parent.parent / "GPT-SoVITS" / "GPT-SoVITS"),
        )
        self._root = os.path.abspath(self._root)

        # 模型路径（相对于 GPT-SoVITS 根目录）
        self.gpt_model: str = tts_cfg.get("gpt_model", "GPT_weights_v2Pro/nahida-e15.ckpt")
        self.sovits_model: str = tts_cfg.get("sovits_model", "SoVITS_weights_v2/nahida_e8_s6464.pth")
        self.sovits_config: str = tts_cfg.get("sovits_config", "GPT_SoVITS/configs/s2.json")

        # 设备
        self.device: str = tts_cfg.get("device", "cuda")
        self.is_half: bool = tts_cfg.get("is_half", True)
        self.sample_rate: int = tts_cfg.get("sample_rate", 32000)

        # 推理参数
        self.temperature: float = tts_cfg.get("temperature", 1.0)
        self.top_k: int = tts_cfg.get("top_k", 15)
        self.top_p: float = tts_cfg.get("top_p", 1.0)
        self.speed: float = tts_cfg.get("speed", 1.0)
        self.sample_steps: int = tts_cfg.get("sample_steps", 8)
        self.noise_scale: float = tts_cfg.get("noise_scale", 0.5)

        # 参考音频（相对于 GPT-SoVITS 根目录）
        self.prompt_wav: str = tts_cfg.get(
            "prompt_wav", "nahida/slicer_opt/vo_HSEQ002_11_nahida_01.wav"
        )
        self.prompt_text: str = tts_cfg.get(
            "prompt_text", "嗯？你们在这里做什么呀？刚才好像提到了关于我的话题？"
        )

        # 后处理
        self.lp_cutoff: float = tts_cfg.get("lp_cutoff", 7000.0)
        self.fade_in_ms: float = tts_cfg.get("fade_in_ms", 80.0)   # 句首淡入时长(ms)，掩盖Flow边界电音
        self.noise_clip: float = tts_cfg.get("noise_clip", 0.5)    # Flow方差裁剪上限，防止气息变化处电音
        self.onset_lp_ms: float = tts_cfg.get("onset_lp_ms", 120.0)  # 起音区域加强低通时长(ms)
        self.onset_lp_cutoff: float = tts_cfg.get("onset_lp_cutoff", 3500.0)  # 起音区域低通截止频率(Hz)
        self.onset_xfade_ms: float = tts_cfg.get("onset_xfade_ms", 40.0)  # 起音到正常低通交叉淡化时长(ms)

        # 运行时状态
        self._model_loaded: bool = False
        self._lock = threading.Lock()
        self._saved_cwd: str = ""

        logger.info(
            f"GPTSoVITSTTS 配置: root={self._root}, "
            f"gpt={os.path.basename(self.gpt_model)}, "
            f"sovits={os.path.basename(self.sovits_model)}, "
            f"device={self.device}, is_half={self.is_half}"
        )

    # ----------------------------------------------------------
    # 模型加载（test_gen.py 直接加载方式）
    # ----------------------------------------------------------

    def init_model(self) -> None:
        """加载 GPT + SoVITS 模型。"""
        if self._model_loaded:
            logger.info("模型已加载，跳过")
            return

        # 预下载 NLTK 数据（避免运行时 SSL 下载失败导致崩溃）
        self._ensure_nltk_data()

        logger.info("正在加载 GPT-SoVITS 模型...")
        logger.info(f"  GPT:    {self.gpt_model}")
        logger.info(f"  SoVITS: {self.sovits_model}")

        # 环境设置
        os.environ.setdefault("is_half", str(self.is_half))
        os.environ.setdefault("_CUDA_VISIBLE_DEVICES", "0")

        # 保存当前 CWD，进入 GPT-SoVITS 根目录
        self._saved_cwd = os.getcwd()
        os.chdir(self._root)

        # sys.path 设置：根目录 + GPT_SoVITS 子目录
        if self._root not in sys.path:
            sys.path.insert(0, self._root)
        gs_inner = os.path.join(self._root, "GPT_SoVITS")
        if gs_inner not in sys.path:
            sys.path.insert(0, gs_inner)

        try:
            from AR.models.t2s_lightning_module import Text2SemanticLightningModule
            from GPT_SoVITS.module.models import SynthesizerTrn

            # —— 加载 GPT 模型（先 CPU，再 CUDA）——
            logger.info("  加载 GPT 模型...")
            gpt_ckpt = torch.load(self.gpt_model, map_location="cpu", weights_only=False)
            gpt_config = gpt_ckpt["config"]
            t2s_model = Text2SemanticLightningModule(gpt_config, "****", is_train=False)
            t2s_model.load_state_dict(gpt_ckpt["weight"])
            if self.is_half:
                t2s_model = t2s_model.half()
            t2s_model = t2s_model.to(self.device)
            t2s_model.eval()
            del gpt_ckpt

            # —— 加载 SoVITS 模型（先 CPU，再 CUDA）——
            logger.info("  加载 SoVITS 模型...")
            from GPT_SoVITS.inference_webui import DictToAttrRecursive
            with open(self.sovits_config, "r") as f:
                hps = json.load(f)
            hps = DictToAttrRecursive(hps)
            vq_model = SynthesizerTrn(
                spec_channels=hps["data"]["filter_length"] // 2 + 1,
                segment_size=hps["train"]["segment_size"] // hps["data"]["hop_length"],
                inter_channels=hps["model"]["inter_channels"],
                hidden_channels=hps["model"]["hidden_channels"],
                filter_channels=hps["model"]["filter_channels"],
                n_heads=hps["model"]["n_heads"],
                n_layers=hps["model"]["n_layers"],
                kernel_size=hps["model"]["kernel_size"],
                p_dropout=hps["model"]["p_dropout"],
                resblock=hps["model"]["resblock"],
                resblock_kernel_sizes=hps["model"]["resblock_kernel_sizes"],
                resblock_dilation_sizes=hps["model"]["resblock_dilation_sizes"],
                upsample_rates=hps["model"]["upsample_rates"],
                upsample_initial_channel=hps["model"]["upsample_initial_channel"],
                upsample_kernel_sizes=hps["model"]["upsample_kernel_sizes"],
                n_speakers=hps["data"]["n_speakers"],
                gin_channels=hps["model"]["gin_channels"],
                semantic_frame_rate=hps["model"]["semantic_frame_rate"],
            )
            sovits_ckpt = torch.load(self.sovits_model, map_location="cpu", weights_only=False)
            weight_key = "weight" if "weight" in sovits_ckpt else "model"
            sd = {k: v for k, v in sovits_ckpt[weight_key].items() if "enc_q" not in k}
            vq_model.load_state_dict(sd, strict=False)
            if self.is_half:
                vq_model = vq_model.half()
            vq_model = vq_model.to(self.device)
            vq_model.eval()
            del sovits_ckpt, sd

            # —— 加载参考音频提取 prompt ——
            logger.info("  加载参考音频...")
            import librosa
            wav16k, _ = librosa.load(self.prompt_wav, sr=16000)
            wav16k = torch.from_numpy(wav16k).to(self.device)

            # 缓存到 inference_webui 的全局变量（供 get_tts_wav 使用）
            import GPT_SoVITS.inference_webui as iw
            iw.t2s_model = t2s_model
            iw.vq_model = vq_model
            iw.hps = hps
            iw.device = self.device
            iw.is_half = self.is_half

            self._t2s_model = t2s_model
            self._vq_model = vq_model
            self._wav16k = wav16k
            self._model_loaded = True

            # ★ 注 Flow 方差裁剪（修复气息变化处电音）
            self._patch_decode_variance()

            logger.info("GPT-SoVITS 模型加载完成 ✅")

        except Exception as e:
            os.chdir(self._saved_cwd)
            raise RuntimeError(f"GPT-SoVITS 模型加载失败: {e}") from e

    def _ensure_model(self) -> None:
        if not self._model_loaded:
            raise RuntimeError("模型未初始化，请先调用 init_model()")

    # ----------------------------------------------------------
    # 后处理：Flow方差裁剪 (修复气息变化处电音)
    # ----------------------------------------------------------

    def _patch_decode_variance(self):
        """Monkey-patch SoVITS decoder: 裁剪 Flow 方差防止极端噪声注入。"""
        try:
            from GPT_SoVITS.module.models import SynthesizerTrn
            SynthesizerTrn._original_decode = SynthesizerTrn.decode  # 保存原始引用，方便回退诊断
            original_decode = SynthesizerTrn.decode

            noise_clip = self.noise_clip
            _diag_counter = [0]  # mutable counter for one-time diag log

            @torch.no_grad()
            def patched_decode(self_model, codes, text, refer, noise_scale=0.5, speed=1, sv_emb=None):
                def get_ge(refer, sv_emb):
                    ge = None
                    if refer is not None:
                        refer_lengths = torch.LongTensor([refer.size(2)]).to(refer.device)
                        refer_mask = torch.unsqueeze(
                            commons.sequence_mask(refer_lengths, refer.size(2)), 1
                        ).to(refer.dtype)
                        if self_model.version == "v1":
                            ge = self_model.ref_enc(refer * refer_mask, refer_mask)
                        else:
                            ge = self_model.ref_enc(refer[:, :704] * refer_mask, refer_mask)
                        if self_model.is_v2pro:
                            sv_emb = self_model.sv_emb(sv_emb)
                            ge += sv_emb.unsqueeze(-1)
                            ge = self_model.prelu(ge)
                    return ge

                if type(refer) == list:
                    ges = [get_ge(_refer, sv_emb[idx] if self_model.is_v2pro else None)
                           for idx, _refer in enumerate(refer)]
                    ge = torch.stack(ges, 0).mean(0)
                else:
                    ge = get_ge(refer, sv_emb)

                y_lengths = torch.LongTensor([codes.size(2) * 2]).to(codes.device)
                text_lengths = torch.LongTensor([text.size(-1)]).to(text.device)
                quantized = self_model.quantizer.decode(codes)
                if self_model.semantic_frame_rate == "25hz":
                    quantized = F.interpolate(quantized, size=int(quantized.shape[-1] * 2), mode="nearest")
                x, m_p, logs_p, y_mask, _, _ = self_model.enc_p(
                    quantized, y_lengths, text, text_lengths,
                    self_model.ge_to512(ge.transpose(2, 1)).transpose(2, 1) if self_model.is_v2pro else ge,
                    speed,
                )
                # ★ 裁剪方差上界，防止气息变化处 exp(logs_p) 过大 → 电音
                variance = torch.exp(logs_p)
                max_var_before = variance.max().item()
                variance = torch.clamp(variance, max=noise_clip)
                max_var_after = variance.max().item()
                z_p = m_p + torch.randn_like(m_p) * variance * noise_scale
                z = self_model.flow(z_p, y_mask, g=ge, reverse=True)
                o = self_model.dec((z * y_mask)[:, :, :], g=ge)

                # 诊断：首次推理打印方差统计
                if _diag_counter[0] == 0:
                    _diag_counter[0] = 1
                    mean_var = variance.mean().item()
                    logger.info(
                        f"  Flow方差诊断: max_before={max_var_before:.2f} max_after={max_var_after:.2f} "
                        f"mean={mean_var:.2f} noise_clip={noise_clip} noise_scale={noise_scale}"
                    )

                return o

            SynthesizerTrn.decode = patched_decode
            from GPT_SoVITS.module import commons
            import torch.nn.functional as F
            logger.info(f"  Flow方差裁剪已启用: noise_clip={noise_clip}")
        except Exception as e:
            logger.warning(f"Flow方差裁剪注失败(非致命): {e}")

    # ----------------------------------------------------------
    # 后处理：句首淡入 (掩盖Flow初始瞬态电音)
    # ----------------------------------------------------------

    def _apply_fade_in(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """句首线性淡入，掩盖 Flow 模型初始瞬态电音。"""
        if self.fade_in_ms <= 0:
            return audio
        n_fade = int(sr * self.fade_in_ms / 1000)
        if n_fade >= len(audio):
            n_fade = max(len(audio) // 4, 1)
        if n_fade > 1:
            fade = np.linspace(0, 1, n_fade, dtype=np.float32)
            audio[:n_fade] = audio[:n_fade] * fade
        return audio

    # ----------------------------------------------------------
    # 后处理：起音加强低通 + 交叉淡化 (针对纯元音起音电音)
    # ----------------------------------------------------------

    def _apply_onset_lowpass(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """起音区域用更低截止频率的 Butterworth 低通，交叉淡化到正常低通，消除句首瞬态高频电音。"""
        if self.onset_lp_ms <= 0 or self.lp_cutoff <= 0:
            return audio

        n_onset = int(sr * self.onset_lp_ms / 1000)
        n_xfade = int(sr * self.onset_xfade_ms / 1000)

        if n_onset >= len(audio):
            n_onset = len(audio)
            n_xfade = 0

        if n_onset <= 0:
            return audio

        try:
            from scipy.signal import butter, sosfiltfilt
            nyq = sr / 2
            audio64 = audio.astype(np.float64)

            # 正常低通
            sos_normal = butter(4, self.lp_cutoff / nyq, btype='low', output='sos')
            audio_normal = sosfiltfilt(sos_normal, audio64)

            # 加强低通（更低截止频率）
            sos_tight = butter(4, self.onset_lp_cutoff / nyq, btype='low', output='sos')
            audio_tight = sosfiltfilt(sos_tight, audio64)

        except Exception as e:
            logger.warning(f"起音Butterworth滤波失败，回退原音频: {e}")
            return audio

        # 混合：起音区域用加强低通，之后交叉淡化到正常低通
        audio_mix = audio_normal.copy()
        if n_xfade > 0 and n_onset + n_xfade <= len(audio):
            audio_mix[:n_onset] = audio_tight[:n_onset]
            for i in range(n_xfade):
                idx = n_onset + i
                t = i / n_xfade
                audio_mix[idx] = (1 - t) * audio_tight[idx] + t * audio_normal[idx]
        else:
            audio_mix[:n_onset] = audio_tight[:n_onset]

        return audio_mix.astype(np.float32)

    # ----------------------------------------------------------
    # 后处理：Butterworth 低通滤波（替换砖墙FFT，消除Gibbs振铃）
    # ----------------------------------------------------------

    def _apply_lowpass(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """4阶 Butterworth 低通，零相位滤波，无砖墙Gibbs振铃。"""
        if self.lp_cutoff <= 0 or self.lp_cutoff >= sr / 2:
            return audio
        try:
            from scipy.signal import butter, sosfiltfilt
            nyq = sr / 2
            Wn = self.lp_cutoff / nyq
            sos = butter(4, Wn, btype='low', output='sos')
            filtered = sosfiltfilt(sos, audio.astype(np.float64))
            return filtered.astype(np.float32)
        except Exception as e:
            logger.warning(f"Butterworth低通失败，回退原音频: {e}")
            return audio

    @staticmethod
    def _ensure_nltk_data():
        """确保 NLTK 数据已下载（GPT-SoVITS English 文本处理需要）。"""
        try:
            import nltk
            for resource in ["averaged_perceptron_tagger", "cmudict"]:
                try:
                    nltk.data.find(f"taggers/{resource}" if resource == "averaged_perceptron_tagger" else f"corpora/{resource}")
                except LookupError:
                    logger.info(f"  下载 NLTK 数据: {resource} ...")
                    nltk.download(resource, quiet=True)
        except Exception as e:
            logger.warning(f"NLTK 数据准备失败（非致命，英文 TTS 可能受影响）: {e}")

    # ----------------------------------------------------------
    # 情感韵律
    # ----------------------------------------------------------

    @staticmethod
    def _detect_emotion_speed(text: str, base_speed: float) -> float:
        """
        根据文本标点和内容检测情感倾向，微调语速。
        
        - 感叹/反问 → 略快 (1.05x)
        - 省略/犹豫 → 略慢 (0.95x)  
        - 多个感叹号 → 更快 (1.08x)
        - 疑问句 → 句末上扬感 (略快 1.03x)
        """
        speed = base_speed

        # 强烈情感标记
        if any(c in text for c in '！!'):
            speed *= 1.06
        # 疑问标记
        if any(c in text for c in '？?'):
            speed *= 1.03
        # 犹豫/拖长
        if any(c in text for c in '…～~'):
            speed *= 0.95
        # 多种情感标记叠加
        if text.count('！') + text.count('!') + text.count('？') + text.count('?') >= 2:
            speed *= 1.04

        return round(speed, 3)

    # ----------------------------------------------------------
    # 合成
    # ----------------------------------------------------------

    def synthesize(self, text: str) -> np.ndarray:
        """
        全量合成文本为音频。

        Returns:
            float32 numpy 数组, shape (N,), 采样率 = sample_rate
        """
        self._ensure_model()

        if not text or not text.strip():
            logger.warning("合成文本为空")
            return np.array([], dtype=np.float32)

        logger.info(f"GPT-SoVITS 合成: '{text[:50]}{'...' if len(text) > 50 else ''}'")

        # 情感驱动语速
        adjusted_speed = self._detect_emotion_speed(text, self.speed)
        if adjusted_speed != self.speed:
            logger.info(f"  情感语速: {self.speed} → {adjusted_speed}")

        with self._lock:
            os.chdir(self._root)

            try:
                from GPT_SoVITS.inference_webui import get_tts_wav

                results = list(get_tts_wav(
                    ref_wav_path=self.prompt_wav,
                    prompt_text=self.prompt_text,
                    prompt_language="中文",
                    text=text,
                    text_language="中文",
                    how_to_cut="不切",
                    top_k=self.top_k,
                    top_p=self.top_p,
                    temperature=self.temperature,
                    speed=adjusted_speed,
                    sample_steps=self.sample_steps,
                    noise_scale=self.noise_scale,
                ))
            finally:
                os.chdir(self._saved_cwd)

        if not results:
            logger.warning("合成结果为空")
            return np.array([], dtype=np.float32)

        sr, audio = results[-1]
        if not isinstance(audio, np.ndarray):
            audio = np.array(audio)
        if audio.dtype != np.float32:
            audio = audio.astype(np.float32) / 32768.0

        if self.lp_cutoff > 0:
            audio = self._apply_lowpass(audio, sr)
            audio = self._apply_onset_lowpass(audio, sr)
        audio = self._apply_fade_in(audio, sr)

        duration = len(audio) / sr
        logger.info(f"合成完成: {duration:.2f}s @ {sr}Hz")
        return audio.astype(np.float32)

    # ----------------------------------------------------------
    # 流式合成
    # ----------------------------------------------------------

    def synthesize_stream(
        self, text: str, chunk_callback: Callable[[np.ndarray], None]
    ) -> None:
        """合成后分块回调（GPT-SoVITS 不支持逐 token 流式）。"""
        audio = self.synthesize(text)
        if len(audio) == 0:
            return

        chunk_samples = int(self.sample_rate * 0.2)  # ~200ms
        total = len(audio)
        offset = 0
        while offset < total:
            end = min(offset + chunk_samples, total)
            chunk_callback(audio[offset:end])
            offset = end

    # ----------------------------------------------------------
    # 清理
    # ----------------------------------------------------------

    def close(self) -> None:
        with self._lock:
            self._model_loaded = False
            self._t2s_model = None
            self._vq_model = None

            try:
                import GPT_SoVITS.inference_webui as iw
                iw.t2s_model = None
                iw.vq_model = None
            except Exception:
                pass

            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            if self._saved_cwd:
                try:
                    os.chdir(self._saved_cwd)
                except OSError:
                    pass

        logger.info("GPTSoVITSTTS 资源已释放")

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass
