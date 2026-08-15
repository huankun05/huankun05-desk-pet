"""
CosyVoice V3 TTS HTTP Server（纳西妲微调，项目内自包含）
=======================================================

模型代码与权重已复制到本项目 server/cosyvoice/ 下，不再依赖任何外部绝对路径：

  server/cosyvoice/
    CosyVoice/                      # CosyVoice 源码（含 cosyvoice 包、third_party/Matcha-TTS）
      models/nahida_cv3_finetuned/inference_model/   # 纳西妲微调权重（llm.pt/flow.pt/...）
    modules/tts_cosyvoice_v3.py     # 适配器
    assets/nahida/                  # 参考音频（prompt）
    .venv/                          # 自带 Python 环境（torch 2.4.1+cu121 + cosyvoice）

端点
----
  GET  /health  -> {status, model_loaded, model_exists, device, sample_rate, load_error}
  GET  /voices  -> {voices: ["cosyvoice_v3_nahida"]}
  POST /tts     -> body {text, prompt_text?, speed?} -> WAV(24kHz) + X-Sample-Rate 头

环境自举
--------
优先使用本目录自带的 .venv；可用环境变量 DESKPET_COSY_PYTHON 覆盖。
若两者都不可用（项目内 .venv 缺失且未设环境变量），则用当前解释器继续，
并给出明确报错，不再回退任何外部绝对路径（本机共享环境 = server/cosyvoice/.venv）。

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

# ===== 路径常量（全部相对本脚本所在目录 server/ 下的 cosyvoice/ 子目录，自包含）=====
HERE = os.path.dirname(os.path.abspath(__file__))          # server/
CONTENT = os.path.join(HERE, "cosyvoice")                   # server/cosyvoice/（自包含内容根）
COSY_ROOT = os.path.join(CONTENT, "CosyVoice")              # CosyVoice 源码 + 权重根
REF_MODULES = os.path.join(CONTENT, "modules")              # tts_cosyvoice_v3.py 所在
MATCHA = os.path.join(COSY_ROOT, "third_party", "Matcha-TTS")
INFERENCE_MODEL_DIR = os.path.join(
    CONTENT, "models", "nahida_cv3_finetuned", "inference_model"
)
PROMPT_WAV = os.path.join(CONTENT, "assets", "nahida", "vo_HSEQ002_11_nahida_12.wav")
PROMPT_TEXT = "我没事。最近我的空余时间有不少，又听说奥摩斯港很热闹，就过来到处走走看看。"

# ===== 环境自举：优先项目内自带 venv（共享环境），其次 DESKPET_COSY_PYTHON 覆盖 =====
# 注意：不再回退任何外部绝对路径（开源安全）。项目内 .venv 缺失且未设环境变量时，
# 沿用当前解释器继续并让后续 import 给出明确错误。
_LOCAL_VENV = os.path.join(CONTENT, ".venv", "Scripts", "python.exe")
REF_VENV = os.environ.get("DESKPET_COSY_PYTHON") or (
    _LOCAL_VENV if os.path.isfile(_LOCAL_VENV) else None
)

if REF_VENV and os.path.isfile(REF_VENV) and os.path.abspath(sys.executable) != os.path.abspath(REF_VENV):
    log.info("切换到 CosyVoice venv 运行: %s", REF_VENV)
    try:
        os.execv(REF_VENV, [REF_VENV, *sys.argv])
    except Exception as e:  # noqa: BLE001
        log.error("re-exec 到 CosyVoice venv 失败: %s", e)
        # 继续尝试用当前解释器运行（可能失败，但给出明确错误）


# ===== 导入 CosyVoice V3 模块（基于脚本所在目录解析）=====
for _p in (REF_MODULES, COSY_ROOT, MATCHA):
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    from tts_cosyvoice_v3 import CosyVoiceV3TTS
except Exception as e:  # noqa: BLE001
    log.error("无法导入 CosyVoice V3 模块 (REF_MODULES=%s): %s", REF_MODULES, e)
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
        "inference_model_dir": INFERENCE_MODEL_DIR,
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
