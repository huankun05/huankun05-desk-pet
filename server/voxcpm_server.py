"""
VoxCPM TTS HTTP Server
======================

轻量级 FastAPI 服务，封装 VoxCPM2 语音合成为 HTTP API。
供 desk_pet 桌面宠物调用。

使用前需安装 VoxCPM:
  pip install -e ../VoxCPM  # 如果有 VoxCPM 源码
  或从 HuggingFace 自动下载模型

启动: python server/voxcpm_server.py --port 8000
依赖: torch, transformers, huggingface-hub, librosa, soundfile, fastapi, uvicorn
"""

import argparse
import io
import logging
import numpy as np
from pathlib import Path

import soundfile as sf

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("voxcpm-server")

# 延迟导入（避免启动时加载 CUDA）
_model = None


def get_model():
    global _model, _cached_model_path
    if _model is not None:
        return _model
    log.info("正在加载 VoxCPM2 模型（首次请求加载，可能需要 10-30 秒）...")
    try:
        from voxcpm import VoxCPM
    except ImportError:
        # 尝试从本地路径导入（desk-pet/server/voxcpm/src/）
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent / "voxcpm" / "src"))
        from voxcpm import VoxCPM

    # 模型路径：环境变量 → HuggingFace 缓存 → 自动下载
    import os
    vox_dir = os.environ.get("VOXCPM_MODEL_PATH", "")
    if not vox_dir or not Path(vox_dir).exists():
        existing = _find_voxcpm_model()
        if existing:
            vox_dir = existing
            log.info("使用已缓存模型: %s", vox_dir)
        else:
            # openbmb/VoxCPM2 是 HuggingFace repo ID，自动下载到缓存
            from huggingface_hub import snapshot_download
            log.info("VOXCPM_MODEL_PATH 未设置或不存在，从 HuggingFace 下载 openbmb/VoxCPM2 ...")
            vox_dir = snapshot_download("openbmb/VoxCPM2")
            log.info("模型下载完成: %s", vox_dir)

    _model = VoxCPM(
        voxcpm_model_path=vox_dir,
        enable_denoiser=True,
        optimize=True,
    )
    _cached_model_path = vox_dir  # 缓存路径供状态检查
    log.info("VoxCPM2 模型加载完成")
    return _model


# ----------------------
# FastAPI App
# ----------------------

from fastapi import FastAPI
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="VoxCPM TTS Server", version="1.0.0")

# CORS: 允许 Tauri webview 跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "http://127.0.0.1:1420", "tauri://localhost", "http://tauri.localhost"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TTSRequest(BaseModel):
    text: str
    prompt_wav: str = ""
    prompt_text: str = ""
    cfg_value: float = 2.0
    inference_timesteps: int = 10
    max_len: int = 4096
    denoise: bool = False


@app.post("/tts")
async def synthesize(req: TTSRequest):
    """合成语音，返回 WAV 音频"""
    import asyncio
    log.info("TTS request: text_len=%d prompt=%s", len(req.text), req.prompt_wav or "(无参考)")

    model = get_model()
    audio = await asyncio.to_thread(
        model.generate,
        text=req.text,
        prompt_wav_path=req.prompt_wav or None,
        prompt_text=req.prompt_text or None,
        cfg_value=req.cfg_value,
        inference_timesteps=req.inference_timesteps,
        max_len=req.max_len,
        denoise=req.denoise,
    )

    if isinstance(audio, np.ndarray):
        sr = model.tts_model.sample_rate if hasattr(model.tts_model, "sample_rate") else 24000
    else:
        sr, audio = 24000, np.array(audio, dtype=np.float32)

    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="wav")
    wav_bytes = buf.getvalue()
    log.info("VoxCPM done: wav_size=%d duration=%.2fs", len(wav_bytes), len(audio) / sr)

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"Content-Disposition": "inline; filename=speech.wav"},
    )


@app.get("/voices")
async def list_voices():
    return {"voices": ["voxcpm2"]}


@app.get("/health")
async def health():
    # 判断模型是否已加载
    loaded = _model is not None
    model_path = _find_voxcpm_model()
    return {
        "status": "ok",
        "model_loaded": loaded,
        "model_exists": model_path is not None,
        "model_path": model_path or "",
    }


@app.post("/preload")
async def preload():
    """预加载 VoxCPM2 模型（后台线程）"""
    if _model is not None:
        return {"ok": True, "message": "模型已加载"}
    log.info("预加载 VoxCPM2 模型（后台线程）...")
    import asyncio
    try:
        model = await asyncio.to_thread(get_model)
        return {"ok": True, "model_loaded": model is not None}
    except Exception as e:
        log.error("预加载失败: %s", e)
        return {"ok": False, "error": str(e)}


# ===== 模型状态与下载 =====
_downloading = False
_download_progress = {"total": 0, "downloaded": 0, "status": "idle"}  # idle | downloading | done | error


_cached_model_path: str | None = None
"""缓存 get_model() 返回的模型路径，避免重复查找"""


def _find_voxcpm_model() -> str | None:
    """多路径查找已下载的 VoxCPM2 模型目录"""
    import os as _os

    # 1) 缓存路径（上次加载时记录的）
    if _cached_model_path and Path(_cached_model_path).exists():
        return _cached_model_path

    # 2) 环境变量
    env_path = _os.environ.get("VOXCPM_MODEL_PATH", "")
    if env_path and Path(env_path).exists():
        return env_path

    # 3) HuggingFace cache API
    try:
        from huggingface_hub import try_to_load_from_cache
        cached = try_to_load_from_cache("openbmb/VoxCPM2", "config.yaml")
        if cached:
            return str(Path(cached).parent)
    except Exception:
        pass

    # 4) 常见 HF 缓存目录（兼容不同版本）
    from huggingface_hub.constants import HF_HUB_CACHE
    cache_dirs = [
        HF_HUB_CACHE,
        _os.path.join(_os.path.expanduser("~"), ".cache", "huggingface", "hub"),
        _os.path.join(_os.path.expanduser("~"), ".cache", "huggingface"),
    ]
    for cd in cache_dirs:
        repo_dir = _os.path.join(cd, "models--openbmb--VoxCPM2")
        if _os.path.isdir(repo_dir):
            snapshots = _os.path.join(repo_dir, "snapshots")
            if _os.path.isdir(snapshots):
                for item in sorted(_os.listdir(snapshots), reverse=True):
                    sp = _os.path.join(snapshots, item)
                    if _os.path.isdir(sp) and _os.path.isfile(_os.path.join(sp, "config.yaml")):
                        return sp
            # 某些版本直接放 blobs 下
            blobs = _os.path.join(repo_dir, "blobs")
            if _os.path.isdir(blobs):
                # 有 blob 文件存在则说明已下载
                for item in _os.listdir(blobs):
                    bp = _os.path.join(blobs, item)
                    if _os.path.isfile(bp) and _os.path.getsize(bp) > 100:
                        # 尝试 symlinks 目录
                        symlinks = _os.path.join(repo_dir, "refs", "main")
                        if _os.path.isfile(symlinks):
                            return str(repo_dir)
                        break

    return None


@app.get("/models/status")
async def model_status():
    """返回 VoxCPM2 模型下载状态"""
    model_path = _find_voxcpm_model()
    return {
        "ok": True,
        "models": {
            "voxcpm2": {
                "exists": model_path is not None,
                "path": model_path or "",
                "loaded": _model is not None,
            }
        },
        "progress": dict(_download_progress),
    }


@app.post("/models/download")
async def model_download():
    """触发 VoxCPM2 模型下载（从 HuggingFace 下载）"""
    global _downloading, _download_progress
    if _downloading:
        return {"ok": False, "error": "下载已在进行中", "progress": _download_progress}

    _downloading = True
    _download_progress = {"total": 1, "downloaded": 0, "status": "downloading"}

    import threading

    def _download_worker():
        global _downloading, _download_progress
        try:
            # 触发模型加载（含自动下载）
            get_model()
            _download_progress["downloaded"] = 1
            _download_progress["status"] = "done"
            log.info("VoxCPM2 模型下载/加载完成")
        except Exception as e:
            log.error("VoxCPM2 模型下载失败: %s", e)
            _download_progress["status"] = "error"
        finally:
            _downloading = False

    threading.Thread(target=_download_worker, daemon=True).start()
    return {"ok": True, "message": "下载已开始", "progress": _download_progress}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="VoxCPM TTS HTTP Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host address")
    parser.add_argument("--port", type=int, default=8000, help="Port number")
    parser.add_argument("--preload", action="store_true", help="启动时立即加载模型（避免首次请求等待）")
    args = parser.parse_args()

    log.info("Starting VoxCPM TTS Server on %s:%d", args.host, args.port)

    if args.preload:
        import threading
        def _preload():
            log.info("预加载模式：启动时加载 VoxCPM2 模型...")
            get_model()
            log.info("预加载完成：VoxCPM2 模型已就绪")
        threading.Thread(target=_preload, daemon=True).start()

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)
