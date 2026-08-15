"""
voice_services.py — 本地语音服务(STT/TTS)的按需启动器

设计目标（对齐用户需求：像 QQ 语音通话，"用到才启动，不常驻占资源"）：
- 由 Hermes 网关在收到 voice:start 时调用 ensure_voice_services() 拉起本地推理服务；
- 收到 voice:stop 时调用 stop_voice_services() 释放，避免一直占用显存/内存；
- 服务已运行时直接复用，不重复拉起；
- 启动过程带端口+健康检查与超时，返回结构化状态供前端展示。

解释器选择：默认用网关自身的 python（已验证含 torch 2.8 / funasr / modelscope）。
可通过环境变量 DESKPET_VOICE_PYTHON 覆盖（例如指向 desk-pet/venv）。
"""
import os
import sys
import time
import socket
import signal
import subprocess
from pathlib import Path
from loguru import logger

PROJECT_ROOT = Path(__file__).parent.parent  # desk-pet/

VOICE_PYTHON = os.environ.get("DESKPET_VOICE_PYTHON") or sys.executable

# 服务定义：与前端 providerManager 的 active provider 对应
#   stt  -> FunASR (server/stt_server.py :8002)            —— 语音通话「听」的关键
#   tts  -> Edge TTS (server/edge_tts_server.py :8001)      —— 语音通话「说」的默认回放
#   tts_vc -> GPT-SoVITS (server/gpt_sovits_server.py :9880) —— 可选声音克隆(需模型权重)
#   tts_cosy -> CosyVoice V3 (server/cosyvoice_server.py :8003) —— 项目内自包含引擎
#
# voice:start 校验 stt（必需）+ 按前端活跃 TTS 选择的引擎（默认 Edge TTS :8001）；
# 自定义/未知引擎由前端自行托管（tts 标记 managed_by_frontend，不阻塞通话）；
# tts_vc 作为增强项后台尽力拉起，不阻塞通话启动（缺权重时直接跳过）。
SERVICE_DEFS = {
    "stt": {
        "name": "FunASR STT",
        "script": "server/stt_server.py",
        "port": 8002,
        "args": ["--port", "8002", "--preload"],
        "health": "/health",
    },
    "tts": {
        "name": "Edge TTS",
        "script": "server/edge_tts_server.py",
        "port": 8001,
        "args": ["--port", "8001"],
        "health": "/health",
    },
    "tts_vc": {
        "name": "GPT-SoVITS TTS",
        "script": "server/gpt_sovits_server.py",
        "port": 9880,
        "args": ["--port", "9880"],
        "health": "/",
    },
    "tts_cosy": {
        "name": "CosyVoice V3 TTS",
        "script": "server/cosyvoice_server.py",
        "port": 8003,
        "args": ["--port", "8003"],
        "health": "/health",
    },
}

# 前端 provider typeName -> 本模块服务 key
_TYPE_TO_SERVICE = {
    "edge_tts": "tts",
    "gpt_sovits": "tts_vc",
    "cosyvoice": "tts_cosy",
}


def _resolve_tts_key(type_name: str | None) -> str | None:
    """把前端活跃 TTS 的 typeName 映射到 SERVICE_DEFS 的服务 key。

    返回 None 表示该引擎不由本模块拉起（custom/未知，由前端自行托管）。
    未传 type_name 时默认 Edge TTS（向后兼容）。
    """
    if not type_name:
        return "tts"
    if type_name in SERVICE_DEFS:
        return type_name
    return _TYPE_TO_SERVICE.get(type_name)


# key -> subprocess.Popen（仅记录由本模块拉起的进程）
_PROCS: dict[str, subprocess.Popen] = {}


def _port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.3) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        return s.connect_ex((host, port)) == 0
    finally:
        s.close()


def _http_health(port: int, path: str, timeout: float = 3.0) -> bool:
    import urllib.request

    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=timeout)
        return True
    except Exception:
        return False


def _spawn(key: str) -> dict:
    cfg = SERVICE_DEFS[key]
    script = PROJECT_ROOT / cfg["script"]
    if not script.exists():
        return {"key": key, "ok": False, "status": "missing_script", "detail": str(script)}
    cmd = [VOICE_PYTHON, str(script), *cfg["args"]]
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(PROJECT_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
            creationflags=(
                subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
            ),
        )
    except Exception as e:
        return {"key": key, "ok": False, "status": "spawn_failed", "detail": str(e)}
    _PROCS[key] = proc
    logger.info("🎙 启动 %s (pid=%s): %s", cfg["name"], proc.pid, " ".join(cmd))
    return {"key": key, "ok": True, "status": "starting", "pid": proc.pid}


def _kill_tree(pid: int) -> None:
    """跨平台杀掉进程及其子进程树（GPT-SoVITS 会再拉起 api_v2.py 孙进程）。"""
    if sys.platform == "win32":
        try:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("taskkill 失败 pid=%s: %s", pid, e)
    else:
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except Exception:  # noqa: BLE001
            try:
                os.kill(pid, signal.SIGTERM)
            except Exception:  # noqa: BLE001
                pass


def ensure_service(key: str, wait: int = 120) -> dict:
    """确保某服务运行：已开则直接 ready；否则拉起并等待健康检查。"""
    cfg = SERVICE_DEFS[key]
    # 已运行（无论是否由本模块拉起）
    if _port_open(cfg["port"]):
        pid = _PROCS.get(key).pid if _PROCS.get(key) else None
        return {"key": key, "ok": True, "status": "ready", "pid": pid}
    res = _spawn(key)
    if not res["ok"]:
        return res
    deadline = time.time() + wait
    while time.time() < deadline:
        if _port_open(cfg["port"]) and _http_health(cfg["port"], cfg.get("health", "/")):
            return {"key": key, "ok": True, "status": "ready", "pid": res["pid"]}
        proc = _PROCS.get(key)
        if proc and proc.poll() is not None:
            out = ""
            try:
                if proc.stdout:
                    out = proc.stdout.read().decode("utf-8", "replace")
            except Exception:  # noqa: BLE001
                pass
            _PROCS.pop(key, None)
            logger.error("❌ %s 启动失败:\n%s", cfg["name"], out[-800:])
            return {"key": key, "ok": False, "status": "crashed", "detail": out[-800:]}
        time.sleep(1.0)
    return {
        "key": key,
        "ok": False,
        "status": "timeout",
        "detail": f"服务 {cfg['name']} 在 {wait}s 内未就绪（模型加载较慢或缺少资源）",
    }


def ensure_service_best_effort(key: str) -> dict:
    """尽力拉起某服务但不阻塞：已运行则 ready；否则 spawn 后立刻返回 starting，
    由进程自行在后台加载（用于 GPT-SoVITS 这类缺权重也不应拖垮通话的增强项）。"""
    cfg = SERVICE_DEFS[key]
    if _port_open(cfg["port"]):
        return {"key": key, "ok": True, "status": "ready"}
    res = _spawn(key)
    if not res["ok"]:
        return res
    return {"key": key, "ok": True, "status": "starting"}


def ensure_voice_services(type_name: str | None = None) -> dict:
    """拉起语音通话所需服务：STT（必需）+ 按前端活跃 TTS 选择的引擎（默认 Edge TTS）。

    - type_name 为前端活跃 TTS 的 provider typeName（edge_tts/gpt_sovits/cosyvoice/custom）。
    - CosyVoice 端口一开 /health 即 200（模型加载中也是 200），网关不会阻塞在模型加载上；
      真正的"模型就绪"由前端 ensureActiveTTSBackend 的 isAvailable() 兜底等待。
      若引擎已被前端拉起，此处检测端口占用直接复用，不重复 spawn。
    - custom/未知类型：TTS 由前端自行托管，本模块只保证 STT 就绪（tts 标记 managed_by_frontend）。
    """
    tts_key = _resolve_tts_key(type_name)
    out: dict[str, dict] = {}
    out["stt"] = ensure_service("stt")
    if tts_key and tts_key in SERVICE_DEFS:
        out["tts"] = ensure_service(tts_key)
    else:
        out["tts"] = {"key": "tts", "ok": True, "status": "managed_by_frontend"}
    out["all_ready"] = bool(out["stt"].get("ok") and out["tts"].get("ok"))
    # 可选增强：GPT-SoVITS 声音克隆，后台尽力拉起，不阻塞通话（已选 tts_vc 时跳过）
    if tts_key != "tts_vc":
        out["tts_vc"] = ensure_service_best_effort("tts_vc")
    return out


def stop_service(key: str) -> dict:
    proc = _PROCS.pop(key, None)
    if proc is None:
        return {"key": key, "ok": True, "status": "not_running"}
    try:
        _kill_tree(proc.pid)
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            pass
        return {"key": key, "ok": True, "status": "stopped"}
    except Exception as e:  # noqa: BLE001
        return {"key": key, "ok": False, "status": "error", "detail": str(e)}


def stop_voice_services() -> dict:
    return {key: stop_service(key) for key in list(_PROCS.keys())}


def is_running(key: str) -> bool:
    proc = _PROCS.get(key)
    if proc and proc.poll() is None and _port_open(SERVICE_DEFS[key]["port"]):
        return True
    return _port_open(SERVICE_DEFS[key]["port"])


if __name__ == "__main__":
    # 简单自测：拉起 -> 状态 -> 停止
    logger.info("测试 ensure_voice_services ...")
    statuses = ensure_voice_services()
    for k, v in statuses.items():
        logger.info("  %s -> %s", k, v)
    logger.info("测试 stop_voice_services ...")
    logger.info(stop_voice_services())
