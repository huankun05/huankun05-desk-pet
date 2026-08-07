"""
Edge TTS HTTP Server
====================

轻量级 FastAPI 服务，封装微软 Edge TTS 为 HTTP API。
供 desk_pet 桌面宠物调用。

启动: python server/edge_tts_server.py --port 8001
依赖: pip install edge-tts fastapi uvicorn
"""

import io
import logging
import argparse
import struct
import asyncio
from typing import Optional

import edge_tts
from fastapi import FastAPI
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("edge-tts-server")

app = FastAPI(title="Edge TTS Server", version="1.0.0")

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
    voice: str = "zh-CN-XiaoyiNeural"
    rate: str = "+0%"
    pitch: str = "+0Hz"
    volume: str = "+0%"


@app.post("/tts")
async def synthesize(req: TTSRequest):
    """合成语音，返回 WAV 音频"""
    # 请求校验
    if not req.text or not req.text.strip():
        log.warning("TTS request rejected: empty text")
        return Response(
            content='{"error": "text is empty"}',
            status_code=400,
            media_type="application/json",
        )

    log.info("TTS request: voice=%s rate=%s pitch=%s vol=%s text_len=%d text_preview=%.40s",
             req.voice, req.rate, req.pitch, req.volume, len(req.text), req.text)

    try:
        communicate = edge_tts.Communicate(
            text=req.text,
            voice=req.voice,
            rate=req.rate,
            pitch=req.pitch,
            volume=req.volume,
        )

        # 收集所有 MP3 数据
        mp3_data = io.BytesIO()
        chunk_count = 0
        error_count = 0
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                mp3_data.write(chunk["data"])
                chunk_count += 1
            elif chunk["type"] == "WordBoundary":
                pass  # 忽略词边界事件
            elif chunk["type"] == "SessionEnd":
                pass  # 会话结束
            else:
                log.debug("Unknown chunk type: %s", chunk.get("type"))

        mp3_bytes = mp3_data.getvalue()
        if len(mp3_bytes) == 0:
            log.error("Edge TTS returned empty audio: voice=%s text=%.40s", req.voice, req.text)
            return Response(
                content='{"error": "Edge TTS returned empty audio data"}',
                status_code=502,
                media_type="application/json",
            )

        log.info("Edge TTS done: mp3_size=%d chunks=%d", len(mp3_bytes), chunk_count)

        # 转换为 WAV (24kHz mono 16bit)
        wav_bytes = await mp3_to_wav(mp3_bytes)
        log.info("Response: wav_size=%d", len(wav_bytes))

        return Response(
            content=wav_bytes,
            media_type="audio/wav",
            headers={"Content-Disposition": "inline; filename=speech.wav"},
        )
    except Exception as e:
        log.error("Edge TTS synthesis failed: %s [text=%.60s]", e, req.text)
        import traceback
        traceback.print_exc()
        return Response(
            content='{"error": "' + str(e).replace('"', "'") + '"}',
            status_code=500,
            media_type="application/json",
        )


@app.get("/voices")
async def list_voices():
    """返回可用语音列表"""
    voices = await edge_tts.list_voices()
    # 筛选中文语音
    zh_voices = [
        {"name": v["ShortName"], "gender": v["Gender"]}
        for v in voices
        if v["Locale"].startswith("zh-")
    ]
    log.info("Voices listed: %d Chinese voices", len(zh_voices))
    return {"voices": [v["name"] for v in zh_voices], "details": zh_voices}


@app.get("/health")
async def health():
    return {"status": "ok"}


async def mp3_to_wav(mp3_bytes: bytes, sample_rate: int = 24000) -> bytes:
    """
    MP3 → WAV 转换。
    优先使用 ffmpeg，不可用时返回原始 MP3 加 WAV header（降级）。
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-i", "pipe:0",
            "-ar", str(sample_rate),
            "-ac", "1",
            "-sample_fmt", "s16",
            "-f", "wav",
            "pipe:1",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        wav_data, stderr = await proc.communicate(input=mp3_bytes)
        if proc.returncode == 0:
            log.debug("ffmpeg conversion OK: wav_size=%d", len(wav_data))
            return wav_data
        log.warning("ffmpeg failed (rc=%d): %s", proc.returncode, stderr.decode(errors="replace")[:200])
    except FileNotFoundError:
        log.warning("ffmpeg not found, returning raw MP3 data")

    # ffmpeg 不可用，直接返回 MP3 数据（前端 Web Audio API 也能解码 MP3）
    return mp3_bytes


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Edge TTS HTTP Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host address")
    parser.add_argument("--port", type=int, default=8001, help="Port number")
    args = parser.parse_args()

    log.info("Starting Edge TTS Server on %s:%d", args.host, args.port)
    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)
