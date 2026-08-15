"""
CosyVoice V3 TTS 模块
=====================

封装 CosyVoice V3 纳西妲语音合成，统一 TTS 接口。

特性:
  - 使用 epoch_0 微调模型（最佳音质）
  - 零样本推理（zero-shot）带参考音频
  - 支持流式/非流式合成
"""
import os
import sys
import gc
import threading
from pathlib import Path
from typing import Optional, Iterator

import numpy as np
import torch
from loguru import logger


class CosyVoiceV3TTS:
    """
    CosyVoice V3 纳西妲 TTS 引擎。

    Usage:
        tts = CosyVoiceV3TTS(config)
        tts.init_model()
        audio = tts.synthesize("你好呀旅行者！")
    """

    def __init__(self, config: dict):
        tts_cfg = config.get("tts", config) if "tts" in config else config

        # 项目根目录（本文件位于 NahidaVoiceAI/modules/，往上两级 = TTS/）
        project_root = Path(__file__).parent.parent.parent

        # CosyVoice 项目根目录
        # 相对路径相对于 project_root 解析（不依赖 CWD，避免从 NahidaVoiceAI 启动时路径错误）
        cosyvoice_root = tts_cfg.get(
            "cosyvoice_root",
            str(project_root / "CosyVoice"),
        )
        if not os.path.isabs(cosyvoice_root):
            cosyvoice_root = str(project_root / cosyvoice_root)
        self._root = os.path.abspath(cosyvoice_root)

        # 基座模型路径（相对于 CosyVoice 根目录）
        self.base_model: str = tts_cfg.get(
            "base_model", "pretrained_models/Fun-CosyVoice3-0.5B"
        )

        # 微调模型路径（相对于 CosyVoice 根目录）
        self.finetuned_ckpt: str = tts_cfg.get(
            "finetuned_ckpt", "models/nahida_cv3_finetuned/epoch_0_whole.pt"
        )

        # 推理模型目录（动态生成）
        self.inference_model_dir: str = tts_cfg.get(
            "inference_model_dir", "models/nahida_cv3_finetuned/inference_model"
        )

        # 设备
        self.device: str = tts_cfg.get("device", "cuda")
        self.fp16: bool = tts_cfg.get("fp16", True)

        # 参考音频配置（相对于 CosyVoice 根目录）
        # 使用原始游戏素材（RTF 0.7-0.95，优于切片版）
        self.prompt_wav: str = tts_cfg.get(
            "prompt_wav", "../assets/nahida/vo_HSEQ002_11_nahida_12.wav"
        )
        self.prompt_text: str = tts_cfg.get(
            "prompt_text",
            "我没事。最近我的空余时间有不少，又听说奥摩斯港很热闹，就过来到处走走看看。"
        )

        # 推理参数
        self.speed: float = tts_cfg.get("speed", 1.0)
        self.stream: bool = tts_cfg.get("stream", False)

        # CosyVoice V3 需要的 prompt 前缀
        self.prompt_prefix: str = "You are a helpful assistant.<|endofprompt|>"

        # 运行时状态
        self._model_loaded: bool = False
        self._lock = threading.Lock()
        self._cosyvoice = None
        self._sample_rate: int = 24000
        self._spk_id: str = ""  # 缓存的说话人 ID

        logger.info(
            f"CosyVoiceV3TTS 配置: root={self._root}, "
            f"finetuned={os.path.basename(self.finetuned_ckpt)}, "
            f"device={self.device}, fp16={self.fp16}"
        )

    def init_model(self) -> None:
        """准备并加载 CosyVoice V3 模型。"""
        if self._model_loaded:
            logger.info("模型已加载，跳过")
            return

        logger.info("正在加载 CosyVoice V3 模型...")

        # 设置 PyTorch 性能选项
        try:
            import torch
            if torch.cuda.is_available():
                # 启用 TF32（Ampere+ GPU 默认已启用，但显式设置确保一致性）
                torch.backends.cuda.matmul.allow_tf32 = True
                torch.backends.cudnn.allow_tf32 = True
                # 启用 cudnn benchmark（自动选择最优卷积算法）
                torch.backends.cudnn.benchmark = True
                logger.debug(f"  GPU: {torch.cuda.get_device_name(0)}, CUDA {torch.version.cuda}")
        except Exception as e:
            logger.warning(f"  GPU 配置失败: {e}")

        # 保存当前 CWD，进入 CosyVoice 根目录
        saved_cwd = os.getcwd()
        os.chdir(self._root)

        # 添加 third_party/Matcha-TTS 到 sys.path
        matcha_path = os.path.join(self._root, "third_party", "Matcha-TTS")
        if matcha_path not in sys.path:
            sys.path.append(matcha_path)
        if self._root not in sys.path:
            sys.path.insert(0, self._root)

        try:
            # 准备推理模型目录
            model_dir = self._prepare_inference_model()

            # 加载模型
            logger.info(f"  加载模型: {model_dir}")
            from cosyvoice.cli.cosyvoice import AutoModel

            t0 = __import__("time").time()
            self._cosyvoice = AutoModel(
                model_dir=model_dir,
                load_trt=False,
                fp16=self.fp16
            )
            self._sample_rate = self._cosyvoice.sample_rate

            logger.info(
                f"CosyVoice V3 模型加载完成 ✅ "
                f"(耗时 {__import__('time').time()-t0:.1f}s, sr={self._sample_rate})"
            )

            # 预缓存默认 prompt（避免每次合成都重新提取 speech_token/feat/embedding）
            self._cache_default_prompt()

            # 性能优化：启用 cudnn benchmark + TF32
            self._tune_cuda()

            # FP16 权重转换：降低显存占用 + 提升推理速度
            # CosyVoice 默认只在推理时用 autocast，但权重仍是 FP32
            # 手动转为 FP16 权重，显存减半，RTF 降低 30-50%
            if self.fp16 and self.device == "cuda":
                import torch
                cv_model = self._cosyvoice.model
                
                def _count_params(module):
                    fp32, fp16 = 0, 0
                    if module is None:
                        return fp32, fp16
                    for p in module.parameters():
                        if p.dtype == torch.float32:
                            fp32 += p.numel()
                        elif p.dtype == torch.float16:
                            fp16 += p.numel()
                    return fp32, fp16
                
                fp32_params = 0
                fp16_params = 0
                for mod_name in ['llm', 'flow', 'hift']:
                    if hasattr(cv_model, mod_name):
                        f32, f16 = _count_params(getattr(cv_model, mod_name))
                        fp32_params += f32
                        fp16_params += f16
                
                logger.info(
                    f"  FP16 转换前: FP32={fp32_params/1e6:.1f}M, FP16={fp16_params/1e6:.1f}M"
                )
                if fp32_params > 0:
                    if hasattr(cv_model, 'llm'):
                        cv_model.llm = cv_model.llm.half()
                    if hasattr(cv_model, 'flow'):
                        cv_model.flow = cv_model.flow.half()
                    if hasattr(cv_model, 'hift'):
                        cv_model.hift = cv_model.hift.half()
                    logger.info("  ✅ 模型权重已转换为 FP16 (显存减半，推理加速)")

            # 标记模型已加载（必须在 _warmup 之前，否则 _warmup → synthesize_bistream
            # → _ensure_model → init_model 会死循环）
            self._model_loaded = True

            # 预热模型（cudnn autotune 会优化后续合成）
            self._warmup()

            # 流式性能优化：小 chunk + 不倍增，确保 chunk 产出节奏稳定
            # - token_hop_len=25: 与训练 static_chunk_size 一致，每 chunk ~1s 音频
            # - stream_scale_factor=1: chunk 大小不变，避免倍增导致 LLM 跟不上
            # - token_max_hop_len=25: 封顶 = 初始值，不增长
            # 实测：每 chunk 0.5-0.8s 产出，~1s 音频，RTF ~0.6，缓冲持续增长
            try:
                cv_model = self._cosyvoice.model
                cv_model.token_hop_len = 25
                cv_model.token_max_hop_len = 25
                cv_model.stream_scale_factor = 1
                # 保存初始值供 synthesize_bistream 重置
                self._initial_token_hop_len = 25
                logger.info(f"  流式参数: hop=25 (~1s/chunk), scale=1 (不倍增)")
            except Exception as e:
                logger.warning(f"  流式参数调整失败(用默认): {e}")
                self._initial_token_hop_len = getattr(cv_model, 'token_hop_len', 25)

        except Exception as e:
            os.chdir(saved_cwd)
            raise RuntimeError(f"CosyVoice V3 模型加载失败: {e}") from e
        finally:
            os.chdir(saved_cwd)

    init_local_model = init_model

    def _cache_default_prompt(self) -> None:
        """预缓存默认 prompt 的 speech_token/feat/embedding，避免每次合成都重新提取。"""
        prompt_wav = self.prompt_wav
        if not os.path.isabs(prompt_wav):
            prompt_wav = str(Path(self._root) / prompt_wav)
        prompt_text_with_prefix = self.prompt_prefix + self.prompt_text

        try:
            self._spk_id = f"nahida_{hash(self.prompt_text + self.prompt_wav) & 0xFFFF}"
            self._cosyvoice.add_zero_shot_spk(
                prompt_text_with_prefix, prompt_wav, self._spk_id
            )
            logger.info(f"  默认 prompt 已缓存 ✅ (spk_id={self._spk_id}, 跳过每次合成的 prompt 处理)")
        except Exception as e:
            logger.warning(f"  prompt 缓存失败，将使用逐次处理: {e}")
            self._spk_id = ""

    def _tune_cuda(self) -> None:
        """调优 CUDA 性能。"""
        try:
            if self.device != "cuda":
                return
            import torch
            # 启用 TF32（在 Ampere+ GPU 上加速 FP32 算子，对 FP16 autocast 也有部分帮助）
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            # 启用 cudnn benchmark（固定输入尺寸时更快）
            torch.backends.cudnn.benchmark = True
            torch.backends.cudnn.deterministic = False
            logger.info("  CUDA 调优: TF32 + cudnn benchmark 已启用")
        except Exception as e:
            logger.warning(f"  CUDA 调优失败: {e}")

    def _warmup(self) -> None:
        """预热模型：整段流式合成，触发所有 CUDA kernel JIT 编译。

        用整段文本 + stream=True 预热，与实际语音对话使用方式一致，
        确保 LLM、flow、hift 所有 kernel 都编译完成。
        """
        import time
        try:
            if self.device != "cuda":
                return

            logger.info("  预热模型（整段流式，与实际使用一致）...")
            warmup_text = "你好呀旅行者，今天天气真不错，我们一起去须弥城逛逛吧。听说今天的教令院有一场很有意思的学术讲座。"
            t0 = time.time()
            chunks = 0

            # 整段流式预热（与实际 synthesize_stream 一致）
            for chunk_np in self.synthesize_stream(warmup_text):
                chunks += 1

            elapsed = time.time() - t0
            total_samples = sum(1 for _ in [])  # no-op, 用 chunks 估算
            logger.info(f"  预热完成 ✅ (耗时 {elapsed:.1f}s, {chunks} chunks)")

            # 清理预热产生的显存
            torch.cuda.empty_cache()

        except Exception as e:
            logger.warning(f"  预热失败（不影响功能，首次合成会稍慢）: {e}")

    def _prepare_inference_model(self) -> str:
        """准备推理模型目录：优先使用微调模型，否则使用基座模型。"""
        import shutil

        base_model_dir = Path(self._root) / self.base_model
        finetuned_path = Path(self._root) / self.finetuned_ckpt
        inference_dir = Path(self._root) / self.inference_model_dir

        # 如果推理目录已存在且包含所有必要文件，直接返回
        required_files = ["llm.pt", "flow.pt", "hift.pt", "campplus.onnx"]
        if all((inference_dir / f).exists() for f in required_files):
            logger.info(f"  推理模型目录已存在: {inference_dir}")
            return str(inference_dir)

        # 创建推理目录
        inference_dir.mkdir(parents=True, exist_ok=True)

        # 复制所有必要文件（从基座模型）
        copy_files = [
            "flow.pt", "hift.pt", "campplus.onnx", "speech_tokenizer_v3.onnx",
            "speech_tokenizer_v3.batch.onnx", "flow.decoder.estimator.fp32.onnx",
            "cosyvoice3.yaml", "configuration.json"
        ]
        for name in copy_files:
            src = base_model_dir / name
            dst = inference_dir / name
            if src.exists():
                shutil.copy2(str(src), str(dst))
                logger.debug(f"  复制: {name}")
            else:
                logger.warning(f"  缺少文件: {src}")

        # 复制 CosyVoice-BlankEN 目录
        blanken_src = base_model_dir / "CosyVoice-BlankEN"
        blanken_dst = inference_dir / "CosyVoice-BlankEN"
        if blanken_src.exists() and not blanken_dst.exists():
            shutil.copytree(str(blanken_src), str(blanken_dst))
            logger.debug(f"  复制: CosyVoice-BlankEN/")

        # llm.pt: 优先使用微调模型，否则使用基座模型
        llm_path = inference_dir / "llm.pt"
        if finetuned_path.exists():
            logger.info(f"  提取微调权重: {finetuned_path.name} -> llm.pt")
            state = torch.load(str(finetuned_path), map_location="cpu", weights_only=False)
            clean_state = {k: v for k, v in state.items() if isinstance(v, torch.Tensor)}
            torch.save(clean_state, str(llm_path))
            logger.info(f"  llm.pt: {len(clean_state)} tensors, {llm_path.stat().st_size / 1024 / 1024:.1f} MB")
            del state, clean_state
            gc.collect()
        else:
            logger.warning(f"  微调模型不存在 ({finetuned_path})，使用基座模型")
            base_llm = base_model_dir / "llm.pt"
            if base_llm.exists():
                shutil.copy2(str(base_llm), str(llm_path))
                logger.info(f"  使用基座模型 llm.pt")
            else:
                raise RuntimeError(f"既没有微调模型也没有基座模型: {finetuned_path} / {base_llm}")

        logger.info(f"  推理模型目录准备完成: {inference_dir}")
        return str(inference_dir)

    def _ensure_model(self) -> None:
        if not self._model_loaded:
            logger.info("TTS 模型未加载，正在初始化...")
            self.init_model()

    # ----------------------------------------------------------
    # TTS 接口
    # ----------------------------------------------------------

    def synthesize(
        self,
        text: str,
        prompt_wav: Optional[str] = None,
        prompt_text: Optional[str] = None,
        speed: Optional[float] = None,
        no_cut: bool = False,
    ) -> np.ndarray:
        """合成语音（整段一次性合成，不按句切分，性能更优）。

        Args:
            text: 要合成的文本
            prompt_wav: 参考音频路径（可选，使用默认）
            prompt_text: 参考文本（可选，使用默认）
            speed: 语速（可选，使用默认）
            no_cut: 是否禁用自动切句（保留兼容，始终不切句）

        Returns:
            音频数据 (numpy array, float32, 24kHz)
        """
        self._ensure_model()

        prompt_wav = prompt_wav or self.prompt_wav
        prompt_text = prompt_text or self.prompt_text
        speed = speed or self.speed

        if not os.path.isabs(prompt_wav):
            prompt_wav = str(Path(self._root) / prompt_wav)

        prompt_text_with_prefix = self.prompt_prefix + prompt_text

        use_cached = (
            self._spk_id
            and prompt_wav == str(Path(self._root) / self.prompt_wav)
            and prompt_text == self.prompt_text
        )

        frontend = self._cosyvoice.frontend
        model = self._cosyvoice.model

        tts_text = text.strip()
        logger.debug(f"synthesize: {tts_text[:30]}... (len={len(tts_text)}, 整段合成)")

        chunks = []
        try:
            normalized = frontend.text_normalize(
                tts_text, split=False, text_frontend=True
            )
            model_input = frontend.frontend_zero_shot(
                normalized,
                prompt_text_with_prefix,
                prompt_wav,
                self._cosyvoice.sample_rate,
                self._spk_id if use_cached else "",
            )
            for item in model.tts(**model_input, stream=False, speed=speed):
                chunks.append(item["tts_speech"])
        except RuntimeError as e:
            if "Kernel size can't be greater than actual input size" in str(e):
                padded = tts_text + "。" * 20
                logger.warning(f"短文本合成失败，加标点重试 (len={len(tts_text)})")
                normalized = frontend.text_normalize(
                    padded, split=False, text_frontend=True
                )
                model_input = frontend.frontend_zero_shot(
                    normalized,
                    prompt_text_with_prefix,
                    prompt_wav,
                    self._cosyvoice.sample_rate,
                    self._spk_id if use_cached else "",
                )
                for item in model.tts(**model_input, stream=False, speed=speed):
                    chunks.append(item["tts_speech"])
            else:
                raise

        if not chunks:
            raise RuntimeError("CosyVoice V3 未生成音频")

        full_audio = torch.cat(chunks, dim=1)
        audio_np = full_audio.squeeze(0).cpu().numpy()

        return audio_np

    def synthesize_stream(
        self,
        text: str,
        prompt_wav: Optional[str] = None,
        prompt_text: Optional[str] = None,
        speed: Optional[float] = None,
        use_true_stream: bool = True,
    ) -> Iterator[np.ndarray]:
        """流式合成语音（整段文本一次性合成，不按句切分，性能更优）。

        关键优化：直接调用 model.tts(stream=True)，不经过 inference_zero_shot 的
        按句切分逻辑，避免每句都重新初始化 LLM 导致首块延迟高。

        实测在 RTX 4070 Laptop 8GB + fp16（预热后）：
          - 整段流式：首块 ~3s，稳定 RTF ~0.7-0.9
          - 按句合成：每句首块 ~15s，整体 RTF ~2-3

        Args:
            use_true_stream: 保留参数兼容，始终使用真流式

        Yields:
            音频片段 (numpy array, float32, 24kHz)
        """
        self._ensure_model()

        prompt_wav = prompt_wav or self.prompt_wav
        prompt_text = prompt_text or self.prompt_text
        speed = speed or self.speed

        if not os.path.isabs(prompt_wav):
            prompt_wav = str(Path(self._root) / prompt_wav)

        prompt_text_with_prefix = self.prompt_prefix + prompt_text

        use_cached = (
            self._spk_id
            and prompt_wav == str(Path(self._root) / self.prompt_wav)
            and prompt_text == self.prompt_text
        )

        frontend = self._cosyvoice.frontend
        model = self._cosyvoice.model

        # 重置 token_hop_len（stream 循环会改大，下次合成必须重置）
        initial_hop = getattr(self, '_initial_token_hop_len', 25)
        try:
            model.token_hop_len = initial_hop
        except Exception:
            pass

        tts_text = text.strip()
        logger.debug(f"synthesize_stream: {tts_text[:30]}... (len={len(tts_text)}, 整段流式)")

        try:
            # 文本 normalize（不切分，整段处理）
            normalized = frontend.text_normalize(
                tts_text, split=False, text_frontend=True
            )

            # 构建模型输入
            model_input = frontend.frontend_zero_shot(
                normalized,
                prompt_text_with_prefix,
                prompt_wav,
                self._cosyvoice.sample_rate,
                self._spk_id if use_cached else "",
            )

            # 直接调用 model.tts(stream=True)，整段流式合成
            for model_output in model.tts(**model_input, stream=True, speed=speed):
                yield model_output['tts_speech'].squeeze(0).cpu().numpy()

        except RuntimeError as e:
            if "Kernel size can't be greater than actual input size" in str(e):
                logger.warning(f"短文本合成失败，加标点重试 (len={len(tts_text)})")
                padded = tts_text + "。" * 20
                normalized = frontend.text_normalize(
                    padded, split=False, text_frontend=True
                )
                model_input = frontend.frontend_zero_shot(
                    normalized,
                    prompt_text_with_prefix,
                    prompt_wav,
                    self._cosyvoice.sample_rate,
                    self._spk_id if use_cached else "",
                )
                for model_output in model.tts(**model_input, stream=True, speed=speed):
                    yield model_output['tts_speech'].squeeze(0).cpu().numpy()
            else:
                raise

    def synthesize_bistream(
        self,
        text_generator,
        prompt_wav: Optional[str] = None,
        prompt_text: Optional[str] = None,
        speed: Optional[float] = None,
    ) -> Iterator[np.ndarray]:
        """bistream 真流式合成：LLM 字符流 → 持续合成音频，无段间 gap

        利用 CosyVoice3 的 inference_bistream（model.py llm_job 检测 Generator 输入）：
          - text_generator 持续 yield 文本小段
          - frontend._extract_text_token_generator 逐段 tokenize 成 text token
          - Qwen2 inference_bistream 边接收 text token 边生成 speech token（KV cache 连续）
          - token2wav 边生成音频 chunk

        优势：
          - 无段间 LLM 重新初始化
          - 真正端到端流式，无"一段一段"拼接感
          - 首块延迟更低（LLM 首批 token + 少量 text token 即可开始 token2wav）

        注意：整篇文本共用一个 uuid，CosyVoice3Model.token2wav 的 hift_cache mel 会累积。
        model.py 的 stream 循环每 4 个 chunk 重置一次 hift cache，控制累积量。

        Args:
            text_generator: Generator[str, None, None]，yield 原始文本小段（8-15字/段）
                            normalize 在方法内部完成

        Yields:
            音频片段 (numpy array, float32, ~1s/chunk)
        """
        self._ensure_model()

        prompt_wav = prompt_wav or self.prompt_wav
        prompt_text = prompt_text or self.prompt_text
        speed = speed or self.speed

        if not os.path.isabs(prompt_wav):
            prompt_wav = str(Path(self._root) / prompt_wav)

        prompt_text_with_prefix = self.prompt_prefix + prompt_text

        use_cached = (
            self._spk_id
            and prompt_wav == str(Path(self._root) / self.prompt_wav)
            and prompt_text == self.prompt_text
        )

        frontend = self._cosyvoice.frontend
        model = self._cosyvoice.model

        # 重置 token_hop_len（stream 循环会改大，下次合成必须重置）
        initial_hop = getattr(self, '_initial_token_hop_len', 25)
        try:
            model.token_hop_len = initial_hop
        except Exception:
            pass

        logger.debug(f"synthesize_bistream: 启动真流式合成（inference_bistream）")

        # prompt_text normalize（带 <|endofprompt|>，inference_bistream 第593行要求）
        prompt_text_norm = frontend.text_normalize(
            prompt_text_with_prefix, split=False, text_frontend=True
        )

        # 包装 text_generator：对每个文本小段做 normalize
        # frontend_zero_shot → _extract_text_token(generator) → _extract_text_token_generator
        # _extract_text_token_generator 对每个 normalize 后的字符串 encode 成 token，逐个 yield
        def _normalized_gen():
            for chunk in text_generator:
                if not chunk or not chunk.strip():
                    continue
                try:
                    normalized = frontend.text_normalize(
                        chunk, split=False, text_frontend=True
                    )
                    if normalized and normalized.strip():
                        yield normalized
                except Exception as e:
                    logger.warning(f"bistream normalize 失败: {e}, chunk={chunk[:20]}")

        # frontend_zero_shot 接收 generator → model_input['text'] = token generator
        model_input = frontend.frontend_zero_shot(
            _normalized_gen(),
            prompt_text_norm,
            prompt_wav,
            self._cosyvoice.sample_rate,
            self._spk_id if use_cached else "",
        )

        # model.tts(stream=True) → llm_job 检测 Generator → inference_bistream 真流式
        # LLM 边消费 text token 边生成 speech token，token2wav 边产出音频
        for model_output in model.tts(**model_input, stream=True, speed=speed):
            yield model_output['tts_speech'].squeeze(0).cpu().numpy()

    @property
    def sample_rate(self) -> int:
        """返回采样率。"""
        return self._sample_rate