"""
STT HTTP Server (FunASR + SenseVoice)
======================================

封装 FunASR Paraformer 和 SenseVoice 为 HTTP API。
供 desk_pet 桌面宠物调用。

启动: python server/stt_server.py --port 8002
依赖: pip install funasr modelscope fastapi uvicorn torchaudio

FunASR: 流式 ASR + VAD + 标点恢复
SenseVoice: 识别文本 + 情绪标签 (happy/sad/angry/neutral)
"""

import os
import sys
import logging
import argparse
import asyncio
from typing import Optional

# ===== 强制模型下载到项目目录，不污染 C 盘 =====
# modelscope 默认缓存路径: ~/.cache/modelscope，改为项目内 server/models/asr
# 与 config.yaml 中 models.asr_dir 保持路径一致
_SERVER_ROOT = os.path.dirname(os.path.abspath(__file__))
_MODELS_DIR = os.path.join(_SERVER_ROOT, "models", "asr")
os.makedirs(_MODELS_DIR, exist_ok=True)
os.environ["MODELSCOPE_CACHE"] = _MODELS_DIR
# ModelScope ≥1.0 使用 MODELSCOPE_HUB_CACHE
os.environ["MODELSCOPE_HUB_CACHE"] = _MODELS_DIR
# 离线模式：模型已在本地时跳过远程检查，加速启动
os.environ["MODELSCOPE_OFFLINE"] = "1"
# 同时设置 torch hub 目录
_TORCH_HOME = os.path.join(_SERVER_ROOT, "models", "torch_hub")
os.makedirs(_TORCH_HOME, exist_ok=True)
os.environ["TORCH_HOME"] = _TORCH_HOME

from fastapi import FastAPI, Form, Query, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("stt-server")


def _ensure_ffmpeg() -> bool:
    """启动时把静态 ffmpeg 注入 PATH。

    FunASR 的音频加载器对 WebM/Opus 等非 WAV 格式依赖 ffmpeg 兜底解码；
    开发机/打包环境往往没有系统 ffmpeg，这里用 imageio-ffmpeg 提供的静态
    二进制（已在 requirements.txt 中声明），避免 'Format not recognised' /
    'FileNotFoundError' 导致识别返回空文本。
    """
    try:
        import os
        import shutil
        import imageio_ffmpeg

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        ffmpeg_dir = os.path.dirname(exe)
        if ffmpeg_dir not in os.environ.get("PATH", "").split(os.pathsep):
            os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")

        # FunASR 的 _load_audio_ffmpeg 通过 subprocess 查找 'ffmpeg'，
        # 确保该目录存在名为 ffmpeg[.exe] 的可执行文件。
        import sys
        suffix = ".exe" if sys.platform == "win32" else ""
        canonical = os.path.join(ffmpeg_dir, "ffmpeg" + suffix)
        if not os.path.exists(canonical) and exe != canonical:
            shutil.copy(exe, canonical)

        log.info("ffmpeg ready: %s", canonical)
        return True
    except Exception as e:  # noqa: BLE001
        log.warning(
            "ffmpeg 不可用: %s —— WebM/Opus 等格式将无法解码，识别可能返回空",
            e,
        )
        return False


def _decode_audio_to_wav(audio_bytes: bytes) -> str:
    """将上传的音频字节统一解码为 16k mono 的干净 WAV 临时文件。

    返回临时文件路径（调用方负责清理）。优先用 ffmpeg 解码任意格式
    （WebM/Opus/MP4/m4a 等），失败则回退为原样写盘交给 FunASR 自行尝试
    （合法 WAV 无需 ffmpeg 也能被 soundfile 读取）。
    """
    import os
    import subprocess
    import tempfile

    if _has_ffmpeg:
        src = tempfile.NamedTemporaryFile(delete=False, suffix=".bin")
        try:
            src.write(audio_bytes)
            src.close()
            dst = tempfile.NamedTemporaryFile(delete=False, suffix=".wav").name
            cmd = [
                "ffmpeg", "-y", "-i", src.name,
                "-ar", "16000", "-ac", "1", "-f", "wav", dst,
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            os.unlink(src.name)
            if proc.returncode == 0 and os.path.exists(dst) and os.path.getsize(dst) > 0:
                return dst
            # 解码失败：清理并尝试原样
            if os.path.exists(dst):
                os.unlink(dst)
        except Exception:  # noqa: BLE001
            if os.path.exists(src.name):
                os.unlink(src.name)

    # 回退：原样写盘（合法 WAV 由 soundfile 读取；其余格式交给 FunASR 尝试）
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    tmp.write(audio_bytes)
    tmp.close()
    return tmp.name


# 模块加载时即确保 ffmpeg 可用（供 _decode_audio_to_wav 使用）
_has_ffmpeg = _ensure_ffmpeg()

app = FastAPI(title="STT Server", version="1.0.0")

# CORS: 允许 Tauri webview 跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "http://127.0.0.1:1420", "tauri://localhost", "http://tauri.localhost"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 延迟加载模型（启动时不阻塞）
_funasr_model = None
_sensevoice_model = None
_loading_funasr = False
_loading_sensevoice = False


def _resolve_model_path(model_id: str, local_dirname: str) -> str:
    """优先使用本地已下载的模型目录，仅在缺失时回退到 modelscope id。

    背景：modelscope 在 MODELSCOPE_OFFLINE=1 下按 model id 加载时，会对快照元数据
    做额外校验，已手工下载到 models/asr/iic/<local_dirname> 的模型会被判定为缺失，
    报 `Download: <id> failed!: 'NoneType' object is not iterable`（SenseVoice 复现）。
    直接传本地绝对路径可完全绕过该校验，既免联网也能显著加快加载。
    """
    local = os.path.join(_MODELS_DIR, "iic", local_dirname)
    if os.path.isdir(local):
        log.info("Using local model dir: %s", local)
        return local
    return model_id


def _get_torch_device():
    """检测最佳设备，优先 CUDA 但限制显存占用"""
    import torch
    if torch.cuda.is_available():
        # 限制显存使用比例，避免占满 8G
        # 设置为 0.5，FunASR+SenseVoice 约用 ~4G
        try:
            torch.cuda.set_per_process_memory_fraction(0.5)
            log.info("CUDA memory fraction set to 0.5 (limit ~4G on 8G card)")
        except Exception as e:
            log.warning("Failed to set CUDA memory fraction: %s", e)
        return "cuda"
    if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def get_funasr_model():
    global _funasr_model, _loading_funasr
    if _funasr_model is None and not _loading_funasr:
        _loading_funasr = True
        try:
            log.info("Loading FunASR Paraformer model (first request, may take a while)...")
            from funasr import AutoModel
            import torch

            device = _get_torch_device()
            log.info("FunASR using device: %s", device)

            _funasr_model = AutoModel(
                model=_resolve_model_path(
                    "paraformer-zh-streaming",
                    "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online",
                ),
                vad_model=_resolve_model_path(
                    "fsmn-vad", "speech_fsmn_vad_zh-cn-16k-common-pytorch"
                ),
                punc_model=_resolve_model_path(
                    "ct-punc", "punc_ct-transformer_cn-en-common-vocab471067-large"
                ),
                disable_update=True,
                device=device,
                # ncpu=4 限制 CPU 线程数，减少资源争抢
                ncpu=4,
            )
            # 加载完成后清理 CUDA 缓存碎片
            if device == "cuda" and torch.cuda.is_available():
                torch.cuda.empty_cache()
                allocated = torch.cuda.memory_allocated() / 1024**3
                log.info("CUDA memory after FunASR load: allocated=%.1fG", allocated)
            log.info("FunASR model loaded successfully")
        finally:
            _loading_funasr = False
    return _funasr_model


def get_sensevoice_model():
    global _sensevoice_model, _loading_sensevoice
    if _sensevoice_model is None and not _loading_sensevoice:
        _loading_sensevoice = True
        try:
            log.info("Loading SenseVoice model (first request, may take a while)...")
            from funasr import AutoModel
            import torch

            device = _get_torch_device()
            log.info("SenseVoice using device: %s", device)

            _sensevoice_model = AutoModel(
                model=_resolve_model_path("iic/SenseVoiceSmall", "SenseVoiceSmall"),
                disable_update=True,
                device=device,
                ncpu=4,
            )
            if device == "cuda" and torch.cuda.is_available():
                torch.cuda.empty_cache()
                allocated = torch.cuda.memory_allocated() / 1024**3
                log.info("CUDA memory after SenseVoice load: allocated=%.1fG", allocated)
            log.info("SenseVoice model loaded successfully")
        finally:
            _loading_sensevoice = False
    return _sensevoice_model


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    engine: str = Form("funasr"),
    engine_query: str | None = Query(None, alias="engine"),
):
    """
    语音识别：上传 WAV 音频，返回识别文本。
    engine: 'funasr' 或 'sensevoice'

    注意：engine 必须作为 **表单字段** 接收。前端（funasr.ts / sensevoice.ts）
    通过 multipart form-data 的 `formData.append('engine', ...)` 传参；
    若声明为普通 str 参数，FastAPI 会把它当作 query 参数，导致 form 中的
    engine 被忽略、永远走默认的 funasr —— 用户切换 SenseVoice 会失效。
    这里同时兼容 query (?engine=...) 便于手工调试。
    """
    # query 优先（调试用），否则用表单字段
    if engine_query:
        engine = engine_query
    audio_bytes = await audio.read()
    log.info("Transcribe request: engine=%s audio_size=%d", engine, len(audio_bytes))

    # 空音频保护：前端可用性探测（静音超时 / 空录音）会发 0 字节，
    # 直接喂空文件给解码器会抛 "Format not recognised" / ffmpeg 错误导致 500。
    # 这里直接返回空文本，避免崩溃，也避免无谓加载模型。
    if not audio_bytes:
        log.info("Empty audio (probe/silence) -> return empty result")
        return JSONResponse({"text": "", "confidence": 0.0, "empty": True})

    if engine == "sensevoice":
        return await _transcribe_sensevoice(audio_bytes)
    else:
        return await _transcribe_funasr(audio_bytes)


async def _transcribe_funasr(audio_bytes: bytes) -> JSONResponse:
    """FunASR Paraformer 识别"""
    import os

    # 统一解码为干净 16k mono WAV（处理 WebM/Opus 等格式 + 兜底）
    tmp = _decode_audio_to_wav(audio_bytes)
    try:
        model = get_funasr_model()

        # generate() 是阻塞调用，放入线程池避免阻塞事件循环
        res = await asyncio.to_thread(
            model.generate,
            input=tmp,
        )

        result_text = ""
        if res and len(res) > 0:
            result_text = res[0].get("text", "")

        log.info("FunASR result: text_len=%d text_preview=%s", len(result_text), result_text[:50])
        return JSONResponse({"text": result_text, "confidence": 1.0})
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


async def _transcribe_sensevoice(audio_bytes: bytes) -> JSONResponse:
    """SenseVoice 识别 + 情绪检测"""
    import os
    import re

    # 统一解码为干净 16k mono WAV（处理 WebM/Opus 等格式 + 兜底）
    tmp = _decode_audio_to_wav(audio_bytes)
    try:
        model = get_sensevoice_model()

        # generate() 是阻塞调用，放入线程池
        res = await asyncio.to_thread(
            model.generate,
            input=tmp,
            language="auto",
            use_itn=True,
        )

        text = ""
        emotion = "neutral"

        if res and len(res) > 0:
            raw_text = res[0].get("text", "")
            # SenseVoice 输出格式: <|zh|><|HAPPY|>识别文本
            # 提取情绪标签
            emotion_match = re.search(r"<\|(\w+)\|>", raw_text)
            if emotion_match:
                emotion_tag = emotion_match.group(1).lower()
                emotion_map = {
                    "happy": "happy",
                    "sad": "sad",
                    "angry": "angry",
                    "neutral": "neutral",
                }
                emotion = emotion_map.get(emotion_tag, "neutral")
                # 移除标签，保留纯文本
                text = re.sub(r"<\|\w+\|>", "", raw_text).strip()
            else:
                text = raw_text.strip()

        log.info("SenseVoice result: emotion=%s text_len=%d text_preview=%s", emotion, len(text), text[:50])
        return JSONResponse({
            "text": text,
            "emotion": emotion,
            "confidence": 1.0,
        })
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


@app.get("/health")
async def health():
    loaded = _funasr_model is not None and _sensevoice_model is not None
    loading = _loading_funasr or _loading_sensevoice
    return {
        "status": "loading" if loading and not loaded else ("ok" if loaded else "partial"),
        "models_loaded": loaded,
        "loading": loading,
        "funasr_loaded": _funasr_model is not None,
        "sensevoice_loaded": _sensevoice_model is not None,
    }


@app.post("/preload")
async def preload_models():
    """预加载所有模型，避免首次请求等待"""
    log.info("Preloading all models...")
    import asyncio
    _funasr = await asyncio.to_thread(get_funasr_model)
    _sense = await asyncio.to_thread(get_sensevoice_model)
    return {
        "ok": True,
        "funasr_loaded": _funasr is not None,
        "sensevoice_loaded": _sense is not None,
    }


@app.get("/engines")
async def list_engines():
    return {"engines": ["funasr", "sensevoice"]}


# ===== 模型状态与下载 =====

# 模型所需文件的检测列表（相对于 MODELSCOPE_CACHE）
_MODEL_FILES = {
    "funasr_paraformer": "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "funasr_vad": "speech_fsmn_vad_zh-cn-16k-common-pytorch",
    "funasr_punc": "punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
    "sensevoice": "iic/SenseVoiceSmall",
}

_downloading = False
_download_progress = {"total": 0, "downloaded": 0, "status": "idle"}  # idle | downloading | done | error


def _check_model_exists(dirname: str):
    """多路径检测模型是否存在

    ModelScope 下载路径层级较多，需要检查多个可能位置：
    1. server/models/asr/{dirname}          — 直接目录
    2. server/models/asr/hub/{dirname}      — ModelScope hub 子目录
    3. ~/.cache/modelscope/hub/{dirname}    — 系统默认缓存
    4. server/models/asr/{dirname}.pt/.pth  — 单文件模型
    """
    candidates = [
        os.path.join(_MODELS_DIR, dirname),
        os.path.join(_MODELS_DIR, "hub", dirname),
        os.path.join(os.path.expanduser("~"), ".cache", "modelscope", "hub", dirname),
    ]
    for path in candidates:
        if os.path.isdir(path):
            files = os.listdir(path)
            # 排除空目录
            if files and any(not f.startswith('.') for f in files):
                return True, path
        elif os.path.isfile(path):
            return True, path

    # 单文件形态（.pt, .pth, .onnx, .bin）
    for ext in ['.pt', '.pth', '.onnx', '.bin']:
        file_path = os.path.join(_MODELS_DIR, dirname + ext)
        if os.path.isfile(file_path):
            return True, file_path
        file_path = os.path.join(_MODELS_DIR, "hub", dirname + ext)
        if os.path.isfile(file_path):
            return True, file_path

    return False, ""


@app.get("/models/status")
async def model_status():
    """返回各模型的下载状态（多路径检测）"""
    models = {}
    for name, dirname in _MODEL_FILES.items():
        exists, model_path = _check_model_exists(dirname)
        # loaded: FunASR 的三个子模型共享 _funasr_model
        is_loaded = (_funasr_model is not None) if name != "sensevoice" else (_sensevoice_model is not None)
        is_loading = _loading_funasr if name != "sensevoice" else _loading_sensevoice
        models[name] = {
            "exists": exists,
            "path": model_path,
            "loaded": is_loaded,
            "loading": is_loading,
        }
    models["_progress"] = dict(_download_progress)
    models["_server"] = {
        "funasr_loaded": _funasr_model is not None,
        "sensevoice_loaded": _sensevoice_model is not None,
        "funasr_loading": _loading_funasr,
        "sensevoice_loading": _loading_sensevoice,
    }
    return {"ok": True, "models": models}


@app.post("/models/download")
async def model_download():
    """触发模型下载（首次加载会自动从 ModelScope 下载）"""
    global _downloading, _download_progress
    if _downloading:
        return {"ok": False, "error": "下载已在进行中", "progress": _download_progress}

    _downloading = True
    _download_progress = {"total": 4, "downloaded": 0, "status": "downloading"}

    import threading

    def _download_worker():
        global _downloading, _download_progress
        try:
            # 逐个加载模型确保顺序下载
            steps = [
                ("funasr_paraformer", "FunASR Paraformer"),
                ("funasr_vad", "FunASR VAD"),
                ("funasr_punc", "FunASR 标点"),
                ("sensevoice", "SenseVoice"),
            ]
            for i, (key, label) in enumerate(steps):
                model_path = os.path.join(_MODELS_DIR, _MODEL_FILES[key])
                if os.path.isdir(model_path) and os.listdir(model_path):
                    log.info("模型已存在，跳过: %s", label)
                else:
                    log.info("正在下载模型: %s ...", label)
                    if key == "sensevoice":
                        get_sensevoice_model()
                    else:
                        get_funasr_model()
                _download_progress["downloaded"] = i + 1
                log.info("模型就绪: %s (%d/%d)", label, i + 1, len(steps))
            _download_progress["status"] = "done"
            log.info("所有模型下载完成")
        except Exception as e:
            log.error("模型下载失败: %s", e)
            _download_progress["status"] = "error"
        finally:
            _downloading = False

    threading.Thread(target=_download_worker, daemon=True).start()
    return {"ok": True, "message": "下载已开始", "progress": _download_progress}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="STT HTTP Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host address")
    parser.add_argument("--port", type=int, default=8002, help="Port number")
    parser.add_argument("--preload", action="store_true", help="启动时立即加载模型（避免首次请求等待）")
    parser.add_argument("--no-cuda", action="store_true", help="强制使用 CPU（不加载 CUDA）")
    args = parser.parse_args()

    if args.no_cuda:
        os.environ["CUDA_VISIBLE_DEVICES"] = ""
        log.info("CUDA disabled by --no-cuda flag")

    log.info("Starting STT Server on %s:%d", args.host, args.port)

    if args.preload:
        import threading
        import torch
        def _preload():
            log.info("预加载模式：启动时加载所有模型...")
            try:
                device = _get_torch_device()
                log.info("预加载使用设备: %s", device)
                get_funasr_model()
                if device == "cuda" and torch.cuda.is_available():
                    torch.cuda.empty_cache()
                get_sensevoice_model()
                if device == "cuda" and torch.cuda.is_available():
                    torch.cuda.empty_cache()
                log.info("预加载完成：所有模型已就绪 (device=%s)", device)
                # 显示当前显存使用
                if device == "cuda" and torch.cuda.is_available():
                    allocated = torch.cuda.memory_allocated() / 1024**3
                    reserved = torch.cuda.memory_reserved() / 1024**3
                    log.info("CUDA memory: allocated=%.1fG reserved=%.1fG", allocated, reserved)
            except Exception as e:
                log.error("预加载失败: %s", e, exc_info=True)
        threading.Thread(target=_preload, daemon=True).start()

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)
