"""
CosyVoice V3 TTS HTTP Server（纳西妲微调）
==========================================

复用参考项目 F:\\Work\\Create\\TTS 的完整代码 + 权重（CosyVoice/ 目录），
按 PROJECT_ARCHITECTURE.md 的说明：CosyVoice V3 是当前主力离线引擎
（GPT-SoVITS v2 为备用）。这是 desk_pet 唯一拥有
完整本地权重的 TTS 引擎。

端点
----
  GET  /health  -> {status, model_loaded, model_exists, device, sample_rate, load_error}
  GET  /voices  -> {voices: ["cosyvoice_v3_nahida"]}
  POST /tts     -> body {text, prompt_text?, speed?} -> WAV(24kHz) + X-Sample-Rate 头

环境自举
--------
CosyVoice V3 依赖特定的 torch(2.4.1+cu121) + cosyvoice 源码，必须与参考项目的
.venv 一起运行。本脚本启动时会自动 re-exec 到参考 .venv
（F:\\Work\\Create\\TTS\\.venv\\Scripts\\python.exe），可通过环境变量
DESKPET_COSY_PYTHON 覆盖。

启动: python server/cosyvoice_server.py --port 8003
"""
import os
import sys
import io
import threading
import argparse
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("cosyvoice-server")

# ===== 路径常量（参考项目 F:\Work\Create\TTS）=====
REF_ROOT = r"F:/Work/Create/TTS"
REF_VENV = os.environ.get("DESKPET_COSY_PYTHON") or os.path.join(
    REF_ROOT, ".venv", "Scripts", "python.exe"
)
REF_MODULES = os.path.join(REF_ROOT, "NahidaVoiceAI", "modules")
COSY_ROOT = os.path.join(REF_ROOT, "CosyVoice")
INFERENCE_MODEL_DIR = os.path.join(
    COSY_ROOT, "models", "nahida_cv3_finetuned", "inference_model"
)
PROMPT_WAV = os.path.join(REF_ROOT, "assets", "nahida", "vo_HSEQ002_11_nahida_12.wav")
PROMPT_TEXT = "我没事。最近我的空余时间有不少，又听说奥摩斯港很热闹，就过来到处走走看看。"

# ===== 环境自举：确保用参考 .venv 运行（含正确 torch + cosyvoice 源码）=====
if os.path.isfile(REF_VENV) and os.path.abspath(sys.executable) != os.path.abspath(REF_VENV):
    log.info("切换到参考 .venv 运行 CosyVoice: %s", REF_VENV)
    try:
        os.execv(REF_VENV, [REF_VENV, *sys.argv])
    except Exception as e:  # noqa: BLE001
        log.error("re-exec 到参考 .venv 失败: %s", e)
        # 继续尝试用当前解释器运行（可能失败，但给出明确错误）


# ===== 导入参考项目的 CosyVoice V3 模块 =====
for _p in (REF_MODULES, COSY_ROOT, os.path.join(COSY_ROOT, "third_party", "Matcha-TTS")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    from tts_cosyvoice_v3 import CosyVoiceV3TTS
except Exception as e:  # noqa: BLE001
    log.error("无法导入参考 CosyVoice V3 模块 (REF_MODULES=%s): %s", REF_MODULES, e)
    raise

from fastapi import FastAPI, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


# ===== 引擎加载（后台线程）=====
_engine = None
_load_event = threading.Event()
_load_error: str | None = None

CONFIG = {
    "tts": {
        "cosyvoice_root": COSY_ROOT,
        "device": "cuda",
        "fp16": True,
        "prompt_wav": PROMPT_WAV,
        "prompt_text": PROMPT_TEXT,
        "speed": 1.0,
    }
}


def _model_exists() -> bool:
    required = ["llm.pt", "flow.pt", "hift.pt", "campplus.onnx"]
    return all(os.path.isfile(os.path.join(INFERENCE_MODEL_DIR, f)) for f in required)


def _load_model() -> None:
    global _engine, _load_error
    try:
        log.info("后台加载 CosyVoice V3（纳西妲微调）...")
        eng = CosyVoiceV3TTS(CONFIG)
        eng.init_model()
        _engine = eng
        _load_event.set()
        log.info("CosyVoice V3 加载完成 ✅ sample_rate=%s", eng.sample_rate)
    except Exception as e:  # noqa: BLE001
        _load_error = repr(e)
        log.exception("CosyVoice V3 加载失败")


# 启动即后台加载（模型较大，加载期间 /health 立即可用，/tts 会等待加载完成）
threading.Thread(target=_load_model, daemon=True).start()


app = FastAPI(title="CosyVoice V3 TTS Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "http://tauri.localhost",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TTSRequest(BaseModel):
    text: str
    prompt_text: str = PROMPT_TEXT
    speed: float = 1.0


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": _load_event.is_set() and _engine is not None,
        "model_exists": _model_exists(),
        "device": "cuda",
        "sample_rate": _engine.sample_rate if _engine else 24000,
        "load_error": _load_error,
    }


@app.get("/")
async def root():
    return {"status": "ok", "engine": "cosyvoice_v3"}


@app.get("/voices")
async def list_voices():
    return {"voices": ["cosyvoice_v3_nahida"]}


@app.post("/tts")
async def synthesize(req: TTSRequest):
    if not req.text or not req.text.strip():
        return Response(
            content='{"error":"text is empty"}',
            status_code=400,
            media_type="application/json",
        )

    # 等待后台模型加载完成
    if not _load_event.wait(timeout=180):
        return Response(
            content='{"error":"model still loading, please retry later"}',
            status_code=503,
            media_type="application/json",
        )
    if _engine is None:
        return Response(
            content='{"error":"model not loaded: ' + str(_load_error) + '"}',
            status_code=503,
            media_type="application/json",
        )

    text = req.text.strip()
    log.info("TTS request: text_len=%d speed=%.2f preview=%.30s", len(text), req.speed, text)

    try:
        import soundfile as sf

        audio = _engine.synthesize(text, prompt_text=req.prompt_text, speed=req.speed)
        if audio is None or len(audio) == 0:
            raise RuntimeError("CosyVoice V3 返回空音频")

        buf = io.BytesIO()
        sf.write(buf, audio, _engine.sample_rate, format="WAV", subtype="PCM_16")
        wav_bytes = buf.getvalue()
        log.info("TTS done: wav_size=%d sample_rate=%s", len(wav_bytes), _engine.sample_rate)

        return Response(
            content=wav_bytes,
            media_type="audio/wav",
            headers={
                "Content-Disposition": "inline; filename=speech.wav",
                "X-Sample-Rate": str(_engine.sample_rate),
            },
        )
    except Exception as e:  # noqa: BLE001
        log.exception("CosyVoice V3 合成失败")
        return Response(
            content='{"error":"' + str(e).replace('"', "'") + '"}',
            status_code=500,
            media_type="application/json",
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CosyVoice V3 TTS HTTP Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host address")
    parser.add_argument("--port", type=int, default=8003, help="Port number")
    args = parser.parse_args()

    log.info("Starting CosyVoice V3 TTS Server on %s:%d", args.host, args.port)
    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)
