"""
Hermes Gateway — WebSocket 实时对话网关

作为大脑（Hermes）与身体（desk-pet 前端）之间的实时通信层：
- 接受前端 WebSocket 连接，接收用户消息
- 通过 Hermes SessionDB 持久化对话历史
- 调用 LLM 生成流式回复
- 执行工具循环（backend tools + frontend tools）
- 通过 Core API 同步情绪/记忆状态
- 流式回传 token / tool 事件到前端

启动: python -m server.hermes_gateway_server --port 8765
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any, AsyncIterator

# ---------------------------------------------------------------------------
# Path setup: ensure server/ is on sys.path for sibling module imports.
# This MUST happen before any `from hermes_*` imports so imports resolve
# correctly whether launched as `python -m server.hermes_gateway_server`
# or `python server/hermes_gateway_server.py` from the project root.
# ---------------------------------------------------------------------------
_server_dir = Path(__file__).resolve().parent
if str(_server_dir) not in sys.path:
    sys.path.insert(0, str(_server_dir))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from hermes_gateway_tool_executor import tool_executor
from hermes_gateway_tool_loop import ToolLoop
from hermes_gateway_backend_tools import register_backend_tools
from core.brain.memory_service import get_memory_service
from core.brain.learning_scheduler import LearningScheduler
from voice_services import ensure_voice_services, stop_voice_services

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] hermes-gateway: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("hermes-gateway")

# 模块级空闲自学习调度器（由 create_app 实例化并绑定到 app.state / 本全局）。
learning_scheduler: "LearningScheduler | None" = None

# 额外文件日志：诊断用，确保 Tauri 管道外也能落盘
_trace_logger = logging.getLogger("hermes-gateway-trace")
_trace_logger.setLevel(logging.INFO)
_trace_path = Path(__file__).resolve().parent.parent / "data" / "gateway_trace.log"
try:
    _trace_handler = logging.FileHandler(_trace_path, encoding="utf-8")
    _trace_handler.setFormatter(logging.Formatter("%(asctime)s [TRACE] %(message)s", datefmt="%H:%M:%S"))
    _trace_logger.addHandler(_trace_handler)
    _trace_logger.info("Trace log initialized: %s", _trace_path)
except Exception:
    pass


def _trace(msg: str, *args: Any) -> None:
    try:
        _trace_logger.info(msg, *args)
    except Exception:
        pass

from hermes_core import SessionDB  # noqa: E402


# ---------------------------------------------------------------------------
# Hermes 引擎封装
# ---------------------------------------------------------------------------

class HermesEngine:
    """Hermes 对话引擎：管理会话、LLM 调用、情绪/记忆同步。"""

    SESSION_ID = "desk-pet-main"

    def __init__(self) -> None:
        from core.session_service import get_db, get_session_db_path
        self.db_path = get_session_db_path()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._db = get_db()

        self._llm: Any = None
        self.core_api_base = "http://127.0.0.1:9877"

        if self._db.get_session(self.SESSION_ID) is None:
            self._db.create_session(self.SESSION_ID, source="desk-pet")

    # ---- LLM ----

    def _get_llm(self) -> Any:
        if self._llm is not None:
            return self._llm
        try:
            from modules.llm import LLMChat
            config: dict[str, Any] = {}

            # 多路径查找 providers.json：
            # 1) <project>/data/providers.json（Python Gateway 原始路径）
            # 2) %APPDATA%/desk-pet/providers.json（Rust 前端写入位置）
            candidates: list[Path] = [
                self.db_path.parent.parent / "data" / "providers.json",
            ]
            # 尝试 APPDATA 路径（跨平台）
            import os
            appdata = (
                os.environ.get("APPDATA")
                or os.environ.get("XDG_CONFIG_HOME")
                or None
            )
            if appdata:
                candidates.append(Path(appdata) / "desk-pet" / "providers.json")

            for providers_path in candidates:
                if not providers_path.exists():
                    continue
                try:
                    raw = providers_path.read_text(encoding="utf-8").strip()
                    # Windows DPAPI 加密格式：开头为 "DPAPIv1:"，需要解密
                    if raw.startswith("DPAPIv1:"):
                        encrypted = raw.split(":", 1)[1]
                        try:
                            import base64
                            encrypted_bytes = base64.b64decode(encrypted)
                        except Exception:
                            encrypted_bytes = encrypted.encode("utf-8", errors="replace")
                        raw = self._decrypt_dpapi(encrypted_bytes)
                    data = json.loads(raw)
                    # Rust 端可能存储为加密格式（外层包裹），尝试提取
                    if isinstance(data, str):
                        data = json.loads(data)
                    configs = data.get("configs", [])
                    active_id = data.get("activeChatId", "")
                    for c in configs:
                        if c.get("id") == active_id or (not active_id and c.get("enable")):
                            config = {
                                "mode": "api",
                                "api_provider": "openai",
                                "api_base_url": c.get("apiBase") or c.get("api_base_url") or "",
                                "api_key": c.get("apiKey") or c.get("api_key") or "",
                                "model": c.get("model") or "",
                                "temperature": c.get("temperature", 0.7),
                                "max_tokens": c.get("maxTokens") or c.get("max_tokens", 2048),
                                "top_p": c.get("topP") or c.get("top_p", 1.0),
                            }
                            break
                    if config:
                        log.info("LLM config loaded from %s", providers_path)
                        break
                except Exception:
                    log.warning("Failed to parse %s", providers_path, exc_info=True)

            self._llm = LLMChat(config) if config else None
            if self._llm:
                log.info("LLM initialized successfully")
            else:
                log.warning("No LLM config found — gateway will echo empty")
        except Exception as exc:
            log.warning("LLM init failed: %s — gateway will echo empty", exc)
            self._llm = None
        return self._llm

    @staticmethod
    def _decrypt_dpapi(encrypted_bytes: bytes) -> str:
        """Decrypt Windows DPAPI blob and return UTF-8 string."""
        try:
            import ctypes
            from ctypes import wintypes

            class DATA_BLOB(ctypes.Structure):
                _fields_ = [
                    ("cbData", wintypes.DWORD),
                    ("pbData", ctypes.POINTER(wintypes.BYTE)),
                ]

            blob_in = DATA_BLOB(
                len(encrypted_bytes),
                (wintypes.BYTE * len(encrypted_bytes)).from_buffer_copy(encrypted_bytes),
            )
            blob_out = DATA_BLOB()

            crypt32 = ctypes.windll.crypt32
            kernel32 = ctypes.windll.kernel32

            if not crypt32.CryptUnprotectData(
                ctypes.byref(blob_in),
                None,
                None,
                None,
                None,
                0,
                ctypes.byref(blob_out),
            ):
                err = ctypes.get_last_error()
                raise RuntimeError(f"CryptUnprotectData failed, error={err}")

            decrypted = ctypes.string_at(blob_out.pbData, blob_out.cbData)
            kernel32.LocalFree(blob_out.pbData)
            return decrypted.decode("utf-8", errors="replace")
        except Exception as exc:
            log.warning("DPAPI decryption failed: %s", exc)
            raise

    # ---- 会话操作 ----

    def get_history(self, limit: int = 50) -> list[dict]:
        return self._db.get_messages(self.SESSION_ID, limit=limit)

    def append_message(self, role: str, content: str, **meta: Any) -> None:
        self._db.append_message(self.SESSION_ID, role=role, content=content, **meta)

    # ---- 模式配置 ----

    MODE_CONFIGS: dict[str, dict] = {
        "chat": {
            "system_prompt": (
                "你是一个桌面宠物精灵，性格活泼可爱，用简短自然的语气和用户对话。"
                "回复保持在 1-3 句话，像朋友聊天一样轻松。"
                "\n\n【工具使用原则】你拥有 web_search（联网搜索）与 get_current_time（当前时间）两个工具，但默认不调用。"
                "仅当用户明确询问实时 / 最新信息（如新闻、天气、股价、当前日期时间、近期事件）时才使用；"
                "闲聊、问候、情感交流、观点讨论、或可用常识直接回答的问题，请直接自然回复，绝不调用任何工具。"
            ),
            "history_limit": 20,
            "max_history": 20,
            # 最少工具原则：聊天模式只暴露精简子集（联网 + 时间），其余不挂给模型
            "tool_names": ["web_search", "get_current_time"],
        },
        "work": {
            "system_prompt": (
                "你是一个智能桌面助手（桌面宠物精灵），具备完整的问题解决能力。"
                "你可以帮助用户完成编程、写作、分析、搜索、文件操作等各类任务。"
                "回答要准确、有条理、可操作。"
            ),
            "history_limit": 50,
            "max_history": 40,
            # None = 暴露全部可用工具（工作模式工具更全）
            "tool_names": None,
        },
    }

    # ---- LLM 流式助手 ----

    async def _llm_stream(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None
    ) -> AsyncIterator[str | dict[str, Any]]:
        llm = self._get_llm()
        log.info("[LLM] _llm_stream called llm_available=%s tools=%d", llm is not None and llm.is_available(), len(tools or []))
        if not llm or not llm.is_available():
            # LLM 不可用时返回空（不暴露内部回显信息给用户）
            yield ""
            return

        # 真·增量流式：在子线程里跑同步生成器，把每个 chunk 推进 asyncio.Queue，
        # 主协程边收边 yield，避免整体缓冲导致前端长时间空白。
        loop = asyncio.get_running_loop()
        import threading

        chunk_q: asyncio.Queue = asyncio.Queue()
        t_llm_start = time.time()

        def _pump() -> None:
            try:
                first = True
                for chunk in llm.chat_stream(messages, tools=tools):
                    if first:
                        # 首块到达耗时 = 大模型「首字延迟 TTFT」，是回复慢的唯一代码外瓶颈
                        log.info(
                            "[LLM] first chunk after %.2fs (TTFT)",
                            time.time() - t_llm_start,
                        )
                        first = False
                    asyncio.run_coroutine_threadsafe(chunk_q.put(("chunk", chunk)), loop)
            except Exception as exc:  # noqa: BLE001
                log.warning("[LLM] chat_stream error: %s", exc)
                asyncio.run_coroutine_threadsafe(chunk_q.put(("error", str(exc))), loop)
            finally:
                asyncio.run_coroutine_threadsafe(chunk_q.put(("stop", None)), loop)

        worker = threading.Thread(target=_pump, daemon=True)
        worker.start()

        while True:
            kind, payload = await chunk_q.get()
            if kind == "stop":
                break
            if kind == "error":
                break
            yield payload

    async def _sync_to_core(self, user_text: str, assistant_text: str) -> None:
        """将情绪事件同步到核心后端（记忆沉淀已由本网关统一收口到 core.brain，
        故此处不再重复向核心 API 推送记忆抽取，避免双写冗余）。"""
        try:
            import httpx
            async with httpx.AsyncClient(base_url=self.core_api_base, timeout=5) as client:
                try:
                    await client.post(
                        "/api/core/emotion/bridge/event",
                        json={
                            "event": "message:sent",
                            "value": user_text[:200],
                            "source": "hermes-gateway",
                        },
                    )
                except Exception:
                    pass
        except Exception:
            pass


# ============================================================
# FastAPI App
# ============================================================

def create_app() -> FastAPI:
    from contextlib import asynccontextmanager

    global learning_scheduler

    engine: HermesEngine = HermesEngine()
    register_backend_tools(tool_executor)

    # 空闲自学习调度器：聊天后入队，网关空闲时后台批量抽取记忆。
    # llm_provider 惰性取引擎 LLM；空闲且可用时用 LLM 抽取，否则离线规则。
    learning_scheduler = LearningScheduler(llm_provider=lambda: engine._get_llm())

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        log.info("Hermes Gateway started (port %d)", getattr(app, "_port", 8765))
        # 启动期一次性迁移旧 hermes_gateway_memory（memories.db）→ core.brain（幂等）
        try:
            get_memory_service(character_id="default", user_id="default").migrate_legacy_memories()
        except Exception as exc:  # noqa: BLE001
            log.warning("旧记忆迁移失败（可忽略）: %s", exc)
        # 启动空闲自学习后台协程
        scheduler_task = learning_scheduler.start() if learning_scheduler else None
        try:
            yield
        finally:
            if learning_scheduler is not None:
                learning_scheduler.stop()
            if scheduler_task is not None:
                scheduler_task.cancel()
                try:
                    await scheduler_task
                except (asyncio.CancelledError, Exception):  # noqa: BLE001
                    pass
            log.info("Hermes Gateway stopped")

    app = FastAPI(title="Hermes Gateway", version="1.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ========================================================
    # REST API
    # ========================================================

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "hermes-gateway"}

    @app.get("/api/gateway/session")
    def get_session(limit: int = 50):
        messages = engine.get_history(limit=limit)
        return {"session_id": engine.SESSION_ID, "messages": messages}

    @app.get("/api/gateway/skills")
    def list_skills():
        from core.hermes_skills_bridge import get_all_skills
        return get_all_skills()

    @app.get("/api/gateway/mode-tools")
    def mode_tools():
        """返回各模式可用工具白名单（None 表示全部）。"""
        return {
            "chat": engine.MODE_CONFIGS["chat"].get("tool_names"),
            "work": engine.MODE_CONFIGS["work"].get("tool_names"),
            "backend": list(tool_executor.tool_definitions().keys()),
        }

    @app.get("/api/gateway/memory")
    def get_memory(
        q: str | None = None,
        category: str | None = None,
        character_id: str = "default",
        user_id: str = "default",
        limit: int = 300,
    ):
        svc = get_memory_service(character_id=character_id, user_id=user_id)
        items = svc.list_memories(category=category) if not q else svc.list_memories()
        return {"items": items, "count": len(items)}

    @app.post("/api/gateway/memory")
    async def add_memory(body: dict):
        text = (body.get("text") or body.get("content") or "").strip()
        if not text:
            return {"error": "text is required"}
        svc = get_memory_service(
            character_id=body.get("character_id", "default"),
            user_id=body.get("user_id", "default"),
        )
        try:
            mem = svc.add_memory(
                text,
                category=body.get("category", "fact"),
                source=body.get("source", "ui"),
                importance=float(body.get("importance", 0.5)),
                is_permanent=bool(body.get("is_permanent", False)),
                client_ref=body.get("client_ref", ""),
            )
        except ValueError as exc:
            return {"error": str(exc)}
        return {"id": mem["id"], "memory": mem}

    @app.delete("/api/gateway/memory/{mid}")
    def del_memory(mid: int, character_id: str = "default", user_id: str = "default"):
        svc = get_memory_service(character_id=character_id, user_id=user_id)
        ok = svc.delete_memory(mid)
        return {"ok": bool(ok)}

    # ========================================================
    # WebSocket
    # ========================================================

    @app.websocket("/ws")
    async def websocket_endpoint(ws: WebSocket):
        await ws.accept()
        log.info("WebSocket client connected")

        try:
            while True:
                raw = await ws.receive_text()

                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    await ws.send_json({"type": "error", "message": "Invalid JSON"})
                    continue

                msg_type = data.get("type", "chat")

                if msg_type == "ping":
                    await ws.send_json({"type": "pong", "timestamp": time.time()})
                    continue

                if msg_type == "history":
                    limit = data.get("limit", 50)
                    messages = engine.get_history(limit=limit)
                    await ws.send_json({
                        "type": "history",
                        "session_id": engine.SESSION_ID,
                        "messages": messages,
                    })
                    continue

                if msg_type == "chat":
                    await _handle_chat(ws, engine, data)
                    continue

                if msg_type == "reset":
                    # 新建对话：清空 Gateway 服务端的会话上下文（单一 desk-pet-main 会话），
                    # 否则 AI 会一直沿用全部历史，导致“新建对话”名存实亡。
                    try:
                        engine._db.clear_messages(engine.SESSION_ID)
                        await ws.send_json(
                            {"type": "reset", "ok": True, "session_id": engine.SESSION_ID}
                        )
                    except Exception as exc:
                        log.warning("reset conversation failed: %s", exc)
                        await ws.send_json({"type": "error", "message": f"reset failed: {exc}"})
                    continue

                if msg_type == "memory:list":
                    await _handle_memory_list(ws, data)
                    continue

                if msg_type == "memory:sync":
                    await _handle_memory_sync(ws, data)
                    continue

                if msg_type == "memory:add":
                    await _handle_memory_add(ws, data)
                    continue

                if msg_type == "memory:update":
                    await _handle_memory_update(ws, data)
                    continue

                if msg_type == "memory:delete":
                    await _handle_memory_delete(ws, data)
                    continue

                if msg_type == "voice":
                    await _handle_voice(ws, data)
                    continue

                await ws.send_json({"type": "error", "message": f"Unknown type: {msg_type}"})

        except WebSocketDisconnect:
            log.info("WebSocket client disconnected")
        except Exception as exc:
            log.error("WebSocket error: %s", exc)
            try:
                await ws.send_json({"type": "error", "message": str(exc)})
            except Exception:
                pass

    return app


# ============================================================
# Chat + tool loop
# ============================================================


def _filter_tools(
    tools: list[dict[str, Any]], allowed: list[str] | None
) -> list[dict[str, Any]]:
    """按白名单筛选工具。allowed 为 None 表示不过滤（全部可用）。"""
    if allowed is None:
        return tools
    allowed_set = set(allowed)
    return [t for t in tools if t.get("name") in allowed_set]


def _resolve_ids(data: dict) -> tuple[str, str]:
    """从消息体中解析 character_id / user_id（缺省 default）。"""
    return (data.get("character_id") or "default", data.get("user_id") or "default")


async def _handle_memory_list(ws: WebSocket, data: dict) -> None:
    character_id, user_id = _resolve_ids(data)
    svc = get_memory_service(character_id=character_id, user_id=user_id)
    items = svc.list_memories()
    await ws.send_json({
        "type": "memory:list_result",
        "items": items,
        "character_id": character_id,
        "user_id": user_id,
        "req_id": data.get("req_id"),
    })


async def _handle_memory_sync(ws: WebSocket, data: dict) -> None:
    """批量 upsert（前端全量同步）。每条需携带稳定 client_ref 以便去重。"""
    character_id, user_id = _resolve_ids(data)
    svc = get_memory_service(character_id=character_id, user_id=user_id)
    payload = data.get("items") or []
    saved = 0
    for it in payload:
        client_ref = it.get("client_ref") or ""
        content = (it.get("content") or "").strip()
        if not content or not client_ref:
            continue
        try:
            svc.upsert_memory(
                content,
                client_ref=client_ref,
                category=it.get("category", "fact"),
                source="ui",
                enabled=it.get("enabled", True),
                importance=float(it.get("importance", 0.5)),
                is_permanent=it.get("is_permanent", False),
                meta=it.get("meta"),
            )
            saved += 1
        except Exception as exc:  # noqa: BLE001
            log.warning("memory:sync 单条失败: %s", exc)
    await ws.send_json({
        "type": "memory:result",
        "action": "sync",
        "saved": saved,
        "req_id": data.get("req_id"),
    })


async def _handle_memory_add(ws: WebSocket, data: dict) -> None:
    character_id, user_id = _resolve_ids(data)
    svc = get_memory_service(character_id=character_id, user_id=user_id)
    content = (data.get("content") or data.get("text") or "").strip()
    if not content:
        await ws.send_json({"type": "memory:result", "action": "add", "ok": False,
                            "error": "content required", "req_id": data.get("req_id")})
        return
    try:
        mem = svc.add_memory(
            content,
            category=data.get("category", "fact"),
            source=data.get("source", "ui"),
            enabled=data.get("enabled", True),
            importance=float(data.get("importance", 0.5)),
            is_permanent=data.get("is_permanent", False),
            client_ref=data.get("client_ref", ""),
            meta=data.get("meta"),
        )
    except ValueError as exc:
        await ws.send_json({"type": "memory:result", "action": "add", "ok": False,
                            "error": str(exc), "req_id": data.get("req_id")})
        return
    await ws.send_json({"type": "memory:result", "action": "add", "ok": True,
                        "memory": mem, "req_id": data.get("req_id")})


async def _handle_memory_update(ws: WebSocket, data: dict) -> None:
    character_id, user_id = _resolve_ids(data)
    svc = get_memory_service(character_id=character_id, user_id=user_id)
    frag_id = data.get("id")
    if frag_id is None:
        await ws.send_json({"type": "memory:result", "action": "update", "ok": False,
                            "error": "id required", "req_id": data.get("req_id")})
        return
    # 兼容两种 payload：前端把 fields 展开到顶层 {id, ...fields}，
    # 也兼容显式嵌套 {id, fields: {...}}。
    raw_fields: dict = dict(data.get("fields") or {})
    for k, v in data.items():
        if k in ("content", "category", "source", "enabled", "importance",
                 "is_permanent", "client_ref", "meta"):
            raw_fields.setdefault(k, v)
    fields = {
        k: v for k, v in raw_fields.items()
        if k in ("content", "category", "source", "enabled", "importance",
                 "is_permanent", "client_ref", "meta")
    }
    try:
        mem = svc.update_memory(frag_id, **fields)
    except Exception as exc:  # noqa: BLE001
        await ws.send_json({"type": "memory:result", "action": "update", "ok": False,
                            "error": str(exc), "req_id": data.get("req_id")})
        return
    await ws.send_json({"type": "memory:result", "action": "update", "ok": mem is not None,
                        "memory": mem, "req_id": data.get("req_id")})


async def _handle_memory_delete(ws: WebSocket, data: dict) -> None:
    character_id, user_id = _resolve_ids(data)
    svc = get_memory_service(character_id=character_id, user_id=user_id)
    frag_id = data.get("id")
    client_ref = data.get("client_ref")
    if frag_id is not None:
        ok = svc.delete_memory(frag_id)
    elif client_ref:
        ok = svc.delete_by_client_ref(client_ref)
    else:
        await ws.send_json({"type": "memory:result", "action": "delete", "ok": False,
                            "error": "id or client_ref required", "req_id": data.get("req_id")})
        return
    await ws.send_json({"type": "memory:result", "action": "delete", "ok": bool(ok),
                        "req_id": data.get("req_id")})


async def _handle_voice(ws: WebSocket, data: dict) -> None:
    """语音服务按需拉起/释放（像 QQ 语音通话：用到时才启动本地推理服务）。"""
    action = data.get("action", "start")
    try:
        if action == "stop":
            result = stop_voice_services()
            await ws.send_json({"type": "voice", "action": "stop", "result": result})
            return
        # start / ensure：在后台线程拉起 STT + Edge TTS（必需），GPT-SoVITS（可选），避免阻塞事件循环
        statuses = await asyncio.to_thread(ensure_voice_services)
        all_ready = bool(statuses.get("all_ready", False))
        services = {k: v for k, v in statuses.items() if k != "all_ready"}
        await ws.send_json({
            "type": "voice",
            "action": "start",
            "all_ready": all_ready,
            "services": services,
        })
    except Exception as exc:  # noqa: BLE001
        log.error("voice handler error: %s", exc)
        await ws.send_json({"type": "voice", "action": action, "error": str(exc)})


async def _handle_chat(ws: WebSocket, engine: HermesEngine, data: dict) -> None:
    text = data.get("text", "")
    if not text:
        log.warning("[CHAT] empty text received, ignoring")
        return
    msg_id = data.get("id", f"msg_{time.time()}")
    t_chat_start = time.time()
    mode = data.get("mode", "chat")
    frontend_tools = data.get("frontend_tools", []) or []

    log.info("[CHAT] start id=%s mode=%s text=%s", msg_id, mode, text[:120])
    _trace("[CHAT] start id=%s mode=%s text=%s", msg_id, mode, text[:120])
    # 工具白名单：None 表示全部可用；列表则只暴露该子集（最少工具原则）
    cfg = engine.MODE_CONFIGS.get(mode, engine.MODE_CONFIGS["chat"])
    # 前端可临时禁用某些工具（持久化在 localStorage，随消息上报）
    disabled = set(data.get("disabled_tools", []) or [])
    log.info("[CHAT] frontend_tools=%s disabled=%s", [t.get("name") for t in frontend_tools], list(disabled))
    _trace("[CHAT] frontend_tools=%s disabled=%s", [t.get("name") for t in frontend_tools], list(disabled))

    whitelist = cfg.get("tool_names", None)
    _trace("[CHAT] whitelist=%s", whitelist)

    # Persist user message
    engine.append_message("user", text)
    _trace("[CHAT] user message appended")

    # Build initial prompt：统一记忆注入（core.brain 单源：规则+偏好+语义召回）
    system_content = cfg["system_prompt"]
    character_id = data.get("character_id") or "default"
    user_id = data.get("user_id") or "default"
    _trace("[CHAT] building memory injection...")
    try:
        svc = get_memory_service(character_id=character_id, user_id=user_id)
        mem_block = svc.build_injection_prompt(query=text, top_k=6)
    except Exception as exc:
        log.warning("记忆注入构建失败: %s", exc)
        mem_block = ""
    _trace("[CHAT] mem_block_len=%d", len(mem_block))
    if mem_block:
        system_content += (
            "\n\n<memory-context>\n以下是关于用户已记住的信息，请自然运用，不要重复确认：\n"
            f"{mem_block}\n</memory-context>"
        )
    _trace("[CHAT] fetching history...")
    history = engine.get_history(limit=cfg["history_limit"])
    _trace("[CHAT] history_len=%d", len(history))
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_content},
        *[
            {"role": m.get("role", "user"), "content": m.get("content", "")}
            for m in history[-cfg["max_history"] :]
            if m.get("role") in ("user", "assistant") and m.get("content")
        ],
        {"role": "user", "content": text},
    ]
    _trace("[CHAT] messages_len=%d", len(messages))

    # 解析「允许的工具」：白名单剔除被禁用的；work(None) 仍要剔除禁用项
    if whitelist is None:
        allowed_frontend = [t for t in frontend_tools if t.get("name") not in disabled]
        allowed_backend = [
            t for t in tool_executor.tool_definitions() if t.get("name") not in disabled
        ]
    else:
        allowed_frontend = _filter_tools(frontend_tools, [w for w in whitelist if w not in disabled])
        allowed_backend = _filter_tools(
            tool_executor.tool_definitions(), [w for w in whitelist if w not in disabled]
        )
    _trace("[CHAT] allowed_frontend=%d allowed_backend=%d", len(allowed_frontend), len(allowed_backend))

    tool_loop = ToolLoop(
        ws=ws,
        session_id=engine.SESSION_ID,
        msg_id=msg_id,
        frontend_tools=allowed_frontend,
        backend_tools=allowed_backend,
        executor=tool_executor,
    )
    _trace("[CHAT] tool_loop created")
    log.info("[CHAT] tool_loop created frontend=%d backend=%d", len(allowed_frontend), len(allowed_backend))
    # preflight（召回记忆 + 取历史 + 组装消息）耗时，应为微秒级；若此处就很大说明 DB/召回慢
    log.info("[CHAT] preflight done in %.3fs, calling tool_loop.run...", time.time() - t_chat_start)
    _trace("[CHAT] calling tool_loop.run...")
    result = await tool_loop.run(text, mode, engine._llm_stream, initial_messages=messages)
    _trace("[CHAT] tool_loop.run finished keys=%s accumulated_len=%d", list(result.keys()), len(result.get("accumulated", "") or ""))
    log.info("[CHAT] tool_loop.run finished keys=%s accumulated_len=%d total=%.2fs", list(result.keys()), len(result.get("accumulated", "") or ""), time.time() - t_chat_start)
    log.info("[CHAT] toolCalls=%d toolResults=%d", len(result.get("toolCalls", [])), len(result.get("toolResults", [])))

    full_response = result.get("accumulated", "") or text
    if not full_response.strip():
        full_response = "[DIAGNOSTIC] 后端未检测到可用的 LLM 配置，回复为空。请在 Rust 管理后台或设置页配置 Chat Provider。"
    if full_response:
        engine.append_message("assistant", full_response)
        # 后台同步到核心后端（不阻塞 done，避免核心抖动时拖慢首字/整轮回复）
        try:
            asyncio.create_task(engine._sync_to_core(text, full_response))
        except RuntimeError:
            # 无运行中的事件循环时（极少路径）退化为同步
            try:
                await engine._sync_to_core(text, full_response)
            except Exception:
                pass

    await ws.send_json({
        "type": "done",
        "id": msg_id,
        "session_id": engine.SESSION_ID,
        "full_response": full_response,
    })
    log.info("[CHAT] sent done id=%s response_len=%d", msg_id, len(full_response))

    # 聊天结束 → 入队空闲自学习调度器：后台协程在网关空闲时抽取记忆，
    # 完全不阻塞本轮响应（满足「聊天结束后，空余时间自行进行自学习」）。
    if learning_scheduler is not None and full_response:
        learning_scheduler.enqueue(character_id, user_id, text, full_response)


# ============================================================
# Entry point
# ============================================================

def main() -> None:
    parser = argparse.ArgumentParser(description="Hermes Gateway Server")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket 端口 (默认 8765)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="监听地址")
    args = parser.parse_args()

    import uvicorn
    app = create_app()
    app._port = args.port
    log.info("Starting Hermes Gateway on %s:%d", args.host, args.port)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
