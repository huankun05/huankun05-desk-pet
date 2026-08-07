"""ASR 语音识别模块 - FunASR Paraformer 流式识别封装

提供两种模式:
  - local: 本地 FunASR Python API，适合离线/低延迟场景
  - websocket: FunASR 推理服务器，适合分布式部署

典型用法:
    # 本地模式
    asr = StreamingASR(config)
    asr.init_local_model()

    # 逐帧喂入音频
    for chunk in audio_frames:
        result = asr.feed_chunk(chunk)
        if result:
            print(result["text"])

    # 批量识别
    text = asr.recognize(full_audio)
    asr.close()
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import threading
from pathlib import Path
from typing import Callable, Optional

import numpy as np
from loguru import logger

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

# FunASR WebSocket 协议版本
_WS_PROTOCOL_VERSION = "1.0"

# 默认服务端地址
_DEFAULT_WS_URL = "ws://127.0.0.1:10095"

# 内部累积 buffer 达到多少采样点后触发一次推理
_TRIGGER_SAMPLES = 2048

# 音频采样率
_SAMPLE_RATE = 16000


# ---------------------------------------------------------------------------
# StreamingASR - 流式语音识别核心类
# ---------------------------------------------------------------------------

class StreamingASR:
    """FunASR Paraformer 流式 ASR 封装，支持本地模型和 WebSocket 两种模式。"""

    def __init__(self, config: dict) -> None:
        """
        初始化 ASR 实例。

        Args:
            config: 配置字典，对应 config.yaml 中的 asr 节。
                    必须包含 mode, model_dir, vad_model_dir,
                    punc_model_dir, device, chunk_size 等字段。
        """
        self._config = config
        self._mode: str = config.get("mode", "local")
        self._chunk_size: int = config.get("chunk_size", 640)
        self._device: str = config.get("device", "cpu")
        self._hotwords: list[str] = config.get("hotwords", [])

        # 相对于项目根目录解析模型路径
        project_root = Path(__file__).parent.parent
        for key in ["model_dir", "vad_model_dir", "punc_model_dir"]:
            if key in self._config and not os.path.isabs(self._config[key]):
                self._config[key] = str(project_root / self._config[key])

        # FunASR 本地模型实例
        self._model = None

        # WebSocket 客户端 (AsyncASRClient)
        self._ws_client: Optional[AsyncASRClient] = None

        # 流式识别状态
        self._buffer = np.array([], dtype=np.float32)
        self._stream_id: int = 0  # 流式会话标识，每次调用识别递增
        self._is_streaming: bool = False
        self._asr_cache: dict = {}  # 流式 ASR 缓存（必须跨调用保持）

        # 线程锁，保证 feed_chunk 线程安全
        self._lock = threading.Lock()

        logger.info("ASR 初始化: mode={}, device={}", self._mode, self._device)

    # ------------------------------------------------------------------
    # 模型加载
    # ------------------------------------------------------------------

    def init_local_model(self) -> None:
        """加载本地 FunASR 模型 (AutoModel)。

        仅在 mode="local" 时使用。模型加载较慢，建议在启动阶段调用。
        """
        if self._mode != "local":
            raise RuntimeError("init_local_model 仅在 mode='local' 时可用")

        try:
            from funasr import AutoModel
        except ImportError:
            raise ImportError("请安装 funasr: pip install funasr")

        logger.info("正在加载 FunASR 模型: {}", self._config.get("model_dir", ""))

        self._model = AutoModel(
            model=self._config["model_dir"],
            vad_model=self._config.get("vad_model_dir"),
            punc_model=self._config.get("punc_model_dir"),
            device=self._device,
            # 热词 (如果模型支持)
            **({"hotword": " ".join(self._hotwords)} if self._hotwords else {}),
        )
        logger.info("FunASR 模型加载完成")

    def init_websocket(self, url: str | None = None) -> None:
        """连接到 FunASR WebSocket 推理服务器。

        Args:
            url: 服务器地址，默认 ws://127.0.0.1:10095
        """
        if self._mode != "websocket":
            raise RuntimeError("init_websocket 仅在 mode='websocket' 时可用")

        ws_url = url or _DEFAULT_WS_URL
        self._ws_client = AsyncASRClient(
            url=ws_url,
            chunk_size=self._chunk_size,
            sample_rate=_SAMPLE_RATE,
        )
        # 在事件循环中启动连接
        self._ws_client.start()
        logger.info("WebSocket ASR 已连接: {}", ws_url)

    # ------------------------------------------------------------------
    # 流式识别 - feed_chunk 系列
    # ------------------------------------------------------------------

    def feed_chunk(self, audio: np.ndarray) -> Optional[dict]:
        """喂入音频片段，返回当前识别结果 (如有)。

        Args:
            audio: float32 numpy 数组，单声道 16kHz。

        Returns:
            {"text": "识别文本", "is_final": True/False} 或 None。
            is_final=True 表示当前语句结束。
        """
        with self._lock:
            # 追加到内部 buffer
            self._buffer = np.concatenate([self._buffer, audio.astype(np.float32)])

            # buffer 不够长时跳过
            if len(self._buffer) < _TRIGGER_SAMPLES and audio is not None:
                return None

            return self._process_buffer(is_final=False)

    def feed_chunk_callback(
        self,
        audio: np.ndarray,
        callback: Callable[[dict], None],
    ) -> None:
        """异步回调版本的 feed_chunk。

        Args:
            audio: 音频片段。
            callback: 回调函数，接收 {"text": ..., "is_final": ...}。
        """
        result = self.feed_chunk(audio)
        if result is not None:
            callback(result)

    def end_stream(self) -> Optional[dict]:
        """通知 ASR 当前流结束，返回最后的识别结果。

        在一段完整语音结束后调用，触发 is_final=True。
        """
        with self._lock:
            result = self._process_buffer(is_final=True)
            # 重置状态
            self._buffer = np.array([], dtype=np.float32)
            self._asr_cache = {}  # 流结束，清空缓存
            self._stream_id += 1
            self._is_streaming = False
        return result

    def _process_buffer(self, is_final: bool) -> Optional[dict]:
        """内部方法：根据当前模式处理 buffer 并返回结果。"""
        if len(self._buffer) == 0 and not is_final:
            return None

        if self._mode == "local":
            return self._process_local(is_final)
        elif self._mode == "websocket":
            return self._process_websocket(is_final)
        else:
            raise ValueError(f"未知的 ASR 模式: {self._mode}")

    def _process_local(self, is_final: bool) -> Optional[dict]:
        """本地模型推理。"""
        if self._model is None:
            raise RuntimeError("本地模型未加载，请先调用 init_local_model()")

        # 构造 FunASR 输入
        # 流式模式: cache 必须跨调用保持，否则每次都是全新推理
        kwargs = {
            "input": self._buffer,
            "chunk_size": [self._chunk_size, 100, 5],
            "is_final": is_final,
            "cache": self._asr_cache,
        }

        try:
            results = self._model.generate(**kwargs)
        except Exception as e:
            logger.error("FunASR 推理失败: {}", e)
            return None

        text = self._extract_text(results)
        if text:
            return {"text": text, "is_final": is_final}
        return None

    def _process_websocket(self, is_final: bool) -> Optional[dict]:
        """WebSocket 模式推理。"""
        if self._ws_client is None:
            raise RuntimeError("WebSocket 未连接，请先调用 init_websocket()")

        return self._ws_client.send_audio(self._buffer, is_final=is_final)

    # ------------------------------------------------------------------
    # 批量识别
    # ------------------------------------------------------------------

    def recognize(self, audio: np.ndarray) -> str:
        """批量识别完整音频 (非流式)。

        Args:
            audio: float32 numpy 数组，单声道 16kHz，任意长度。

        Returns:
            识别结果文本。
        """
        if self._mode == "local":
            return self._recognize_local(audio)
        elif self._mode == "websocket":
            return self._recognize_websocket(audio)
        else:
            raise ValueError(f"未知的 ASR 模式: {self._mode}")

    def _recognize_local(self, audio: np.ndarray) -> str:
        """本地模型批量识别。"""
        if self._model is None:
            raise RuntimeError("本地模型未加载，请先调用 init_local_model()")

        try:
            results = self._model.generate(
                input=audio.astype(np.float32),
                batch_size_s=300,
            )
        except Exception as e:
            logger.error("批量识别失败: {}", e)
            return ""

        return self._extract_text(results) or ""

    def _recognize_websocket(self, audio: np.ndarray) -> str:
        """WebSocket 批量识别。"""
        if self._ws_client is None:
            raise RuntimeError("WebSocket 未连接，请先调用 init_websocket()")

        result = self._ws_client.send_audio(audio, is_final=True)
        return result["text"] if result else ""

    # ------------------------------------------------------------------
    # 工具方法
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_text(results) -> Optional[str]:
        """从 FunASR 返回结果中提取文本。"""
        if not results:
            return None

        texts = []
        for item in results:
            if isinstance(item, dict):
                # 标准 FunASR 输出格式
                text = item.get("text", "")
                if not text and "preds" in item:
                    text = item["preds"][0] if item["preds"] else ""
            elif isinstance(item, str):
                text = item
            else:
                continue

            if text:
                texts.append(text)

        combined = "".join(texts).strip()
        return combined if combined else None

    def close(self) -> None:
        """释放资源，关闭连接。"""
        with self._lock:
            if self._ws_client:
                self._ws_client.close()
                self._ws_client = None
            self._model = None
            self._buffer = np.array([], dtype=np.float32)
        logger.info("ASR 已关闭")


# ---------------------------------------------------------------------------
# AsyncASRClient - WebSocket 模式异步客户端
# ---------------------------------------------------------------------------

class AsyncASRClient:
    """FunASR WebSocket 推理服务器的异步客户端。

    使用 asyncio + websockets 库，适用于 WebSocket 模式。
    内部管理事件循环线程，对外提供同步接口。
    """

    def __init__(
        self,
        url: str,
        chunk_size: int = 640,
        sample_rate: int = 16000,
    ) -> None:
        """
        Args:
            url: FunASR WebSocket 服务器地址。
            chunk_size: 流式 chunk 大小 (采样点)。
            sample_rate: 采样率 (Hz)。
        """
        self._url = url
        self._chunk_size = chunk_size
        self._sample_rate = sample_rate

        self._websocket = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._connected = threading.Event()

        self._session_id: int = 0
        self._lock = threading.Lock()

        logger.debug("AsyncASRClient 创建: url={}", url)

    def start(self) -> None:
        """启动后台事件循环并连接 WebSocket 服务器。"""
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._run_loop,
            daemon=True,
            name="asr-ws-loop",
        )
        self._thread.start()
        # 等待连接就绪
        self._connected.wait(timeout=10.0)
        if not self._connected.is_set():
            raise ConnectionError(f"WebSocket 连接超时: {self._url}")

    def _run_loop(self) -> None:
        """在独立线程中运行事件循环。"""
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._connect())

    async def _connect(self) -> None:
        """建立 WebSocket 连接并发送配置握手。"""
        try:
            import websockets
        except ImportError:
            raise ImportError("请安装 websockets: pip install websockets")

        self._websocket = await websockets.connect(
            self._url,
            ping_interval=30,
            ping_timeout=10,
            close_timeout=5,
        )

        # 发送初始化配置
        config_msg = {
            "mode": "online",
            "chunk_size": [self._chunk_size, 100, 5],
            "wav_name": "stream",
            "is_speaking": True,
            "chunk_interval": 10,
            "itn": True,
            "sample_rate": self._sample_rate,
        }
        await self._websocket.send(json.dumps(config_msg))
        logger.debug("WebSocket 配置已发送")

        self._connected.set()

    def send_audio(
        self,
        audio: np.ndarray,
        is_final: bool = False,
    ) -> Optional[dict]:
        """同步接口：发送音频数据并等待识别结果。

        Args:
            audio: float32 音频数据。
            is_final: 是否为最后一帧。

        Returns:
            {"text": "...", "is_final": bool} 或 None。
        """
        if not self._loop or not self._loop.is_running():
            logger.warning("事件循环未运行")
            return None

        future = asyncio.run_coroutine_threadsafe(
            self._async_send(audio, is_final),
            self._loop,
        )
        try:
            return future.result(timeout=5.0)
        except Exception as e:
            logger.error("WebSocket 发送失败: {}", e)
            return None

    async def _async_send(
        self,
        audio: np.ndarray,
        is_final: bool,
    ) -> Optional[dict]:
        """异步发送音频并接收结果。"""
        if self._websocket is None:
            return None

        try:
            # 编码音频为 base64
            audio_bytes = audio.astype(np.float32).tobytes()
            b64_audio = base64.b64encode(audio_bytes).decode("utf-8")

            # 构造消息
            msg = {
                "wav_name": "stream",
                "wav_format": "pcm",
                "audio": b64_audio,
                "is_final": is_final,
                "chunk_size": [self._chunk_size, 100, 5],
            }

            await self._websocket.send(json.dumps(msg))

            # 接收结果 (可能需要多次接收直到拿到文本)
            result_text = ""
            final = False

            for _ in range(20):  # 最多接收 20 条响应
                try:
                    resp = await asyncio.wait_for(
                        self._websocket.recv(),
                        timeout=3.0,
                    )
                except asyncio.TimeoutError:
                    break

                data = json.loads(resp)
                text = data.get("text", "")
                if text:
                    result_text = text

                if data.get("is_final", False):
                    final = True
                    break

                # 空 text + 非 final -> 继续接收
                if not text and not is_final:
                    break

            if result_text:
                return {"text": result_text, "is_final": final}
            return None

        except Exception as e:
            logger.error("WebSocket 异步发送失败: {}", e)
            return None

    def close(self) -> None:
        """关闭连接和事件循环。"""
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(
                self._async_close(),
                self._loop,
            ).result(timeout=3.0)
            self._loop.call_soon_threadsafe(self._loop.stop)

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)

        if self._loop and not self._loop.is_closed():
            self._loop.close()

        self._websocket = None
        logger.debug("AsyncASRClient 已关闭")

    async def _async_close(self) -> None:
        """异步关闭 WebSocket 连接。"""
        if self._websocket:
            try:
                # 通知服务器会话结束
                close_msg = {"is_speaking": False, "is_final": True}
                await self._websocket.send(json.dumps(close_msg))
                await self._websocket.close()
            except Exception:
                pass  # 连接可能已断开
