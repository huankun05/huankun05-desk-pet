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

def _sample_cpu_percent(sample_ms: int = 500) -> float:
    """Windows 零依赖系统 CPU 占用（%）；失败返回 -1.0（跨平台安全降级）。

    使用 kernel32.GetSystemTimes 对两次采样求差，不引入 psutil 等额外依赖。
    """
    try:
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.windll.kernel32
        idle, kernel, user = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()

        def _read() -> tuple[int, int]:
            if not k32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
                raise OSError("GetSystemTimes failed")
            hi = idle.dwHighDateTime << 32 | idle.dwLowDateTime
            ki = kernel.dwHighDateTime << 32 | kernel.dwLowDateTime
            ui = user.dwHighDateTime << 32 | user.dwLowDateTime
            return (ki + ui), hi

        sys1, idle1 = _read()
        time.sleep(sample_ms / 1000.0)
        sys2, idle2 = _read()
        sys_total = sys2 - sys1
        idle_total = idle2 - idle1
        if sys_total <= 0:
            return -1.0
        return 100.0 * (1.0 - idle_total / sys_total)
    except Exception:
        return -1.0


_STRESS_CPU_THRESHOLD = 80.0  # 系统 CPU 超过该值进入应激模式（暂停后台学习抽取）


async def _stress_monitor_loop(scheduler: "LearningScheduler", poll_seconds: int = 15) -> None:
    """周期采样系统 CPU，高负载时切换 LearningScheduler 应激模式（交感应激）。

    遵循 bionic-life-enhancement-design.md §9：
    - 零额外依赖（ctypes 探针），探针失败安全降级为不触发；
    - 仅调用既有 set_stress 接口，不重写学习逻辑；
    - 任务自身异常被吞，不影响主服务。
    """
    await asyncio.sleep(poll_seconds)
    stressed = False
    while True:
        try:
            cpu = await asyncio.to_thread(_sample_cpu_percent, 500)
        except Exception as exc:  # noqa: BLE001
            log.warning("应激监测 CPU 采样异常（忽略）: %s", exc)
            cpu = -1.0
        if cpu >= 0:
            new_stressed = cpu >= _STRESS_CPU_THRESHOLD
            if new_stressed != stressed:
                stressed = new_stressed
                scheduler.set_stress(stressed)
                log.info("应激模式 %s（系统 CPU=%.1f%%）", "开启" if stressed else "关闭", cpu)
        await asyncio.sleep(poll_seconds)


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

        # 启动空闲自学习后台协程
        scheduler_task = learning_scheduler.start() if learning_scheduler else None
        # 交感应激监测：高负载时暂停后台学习抽取（脉动、可取消）
        stress_task = asyncio.create_task(_stress_monitor_loop(learning_scheduler)) if learning_scheduler else None
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
            if stress_task is not None:
                stress_task.cancel()
                try:
                    await stress_task
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

    @app.post("/api/gateway/memory/regenerate")
    async def regenerate_memory(body: dict):
        """手动触发分层记忆的 L2 场景 / L3 画像重新生成（白盒文件随之更新）。

        仅供「记忆查看」页的「重新生成」按钮使用；正常由空闲自学习调度器自动触发。
        优先使用 engine 的 LLM（若可用），否则走离线聚类/拼装。
        """
        character_id = body.get("character_id", "default")
        user_id = body.get("user_id", "default")
        svc = get_memory_service(character_id=character_id, user_id=user_id)
        llm = None
        use_llm = False
        try:
            if engine is not None:
                llm = engine._get_llm()
                use_llm = bool(llm and getattr(llm, "is_available", lambda: False)())
        except Exception:  # noqa: BLE001
            use_llm = False
        llm_fn = (lambda msgs, _llm=llm: _llm.chat(msgs)) if use_llm else None
        result: dict[str, Any] = {"scene": None, "persona": None, "used_llm": use_llm}
        try:
            scene = svc.generate_scene(llm_fn=llm_fn, use_llm=use_llm)
            if scene:
                result["scene"] = scene.get("content")
            persona = svc.generate_persona(llm_fn=llm_fn, use_llm=use_llm)
            if persona:
                result["persona"] = persona.get("content")
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc), "ok": False}
        result["ok"] = True
        return result

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


# 纯聊天特征：命中则直接判定无需工具，跳过分类器调用（零额外延迟）
_CHAT_HEURISTICS = [
    # 问候 / 礼貌
    "你好", "您好", "hi", "hello", "嗨", "在吗", "在么", "早", "晚安", "午安", "拜拜", "再见", "辛苦了",
    # 情感 / 陪伴
    "想你", "喜欢", "爱你", "难过", "开心", "不开心", "生气", "委屈", "孤单", "陪我", "抱抱", "摸摸",
    "烦", "累", "饿", "困", "无聊", "郁闷", "压力大", "焦虑", "失眠",
    # 闲聊 / 观点
    "你觉得", "你认为", "怎么看", "是不是", "对不对", "哈哈", "嘻嘻", "嘿嘿", "呜呜", "唔", "嗯", "哦",
    "今天天气", "好可爱", "好漂亮", "好厉害", "好棒", "谢谢", "感谢", "辛苦",
]

# 强工作意图特征：命中则直接判定需要用工作人设（完整工具 + 有条理回复）
_WORK_HEURISTICS = [
    "帮我写", "写个", "写一段", "写代码", "写脚本", "代码", "脚本", "bug", "报错", "调试", "编译",
    "帮我做", "帮我分析", "分析一下", "数据分析", "帮我查", "查资料", "搜一下", "搜索", "调研",
    "帮我运行", "运行命令", "执行命令", "打开应用", "打开软件", "文件操作", "读文件", "写文件",
    "总结", "翻译", "生成", "排版", "表格", "报告", "方案", "计划", "整理", "重构", "优化",
]


def _looks_like_pure_chat(text: str) -> bool:
    """规则快路径：极短句或命中纯聊天关键词 → 判定无需工具。"""
    low = text.strip().lower()
    if not low:
        return True
    # 极短（<=6 字符，如"在吗""哈哈""嗯"）且非明显指令
    if len(low) <= 6 and not any(k in low for k in ["帮我", "打开", "查", "写", "做", "搜", "运行", "执行"]):
        return True
    return any(k in low for k in _CHAT_HEURISTICS)


def _looks_like_work(text: str) -> bool:
    """规则快路径：命中强工作意图词 → 判定走工作人设（零额外延迟）。"""
    low = text.strip().lower()
    if not low:
        return False
    return any(k in low for k in _WORK_HEURISTICS)


def _classify_intent(
    engine: "HermesEngine", text: str, all_tool_names: list[str]
) -> dict:
    """自动意图识别：返回结构化结果，让 auto 模式同时自适人设/历史与工具子集。

    返回 dict：
        {
            "intent": "chat" | "work" | "neutral",  # 决定人设与历史长度
            "tools":  list[str] | None,             # None = 全部工具（降级）
            "confidence": float,
            "source": "rule" | "llm" | "fallback",
        }

    设计：
        - 规则快路径覆盖绝大多数闲聊与强工作指令（零额外延迟、零 LLM 调用）。
        - 其余用本地/在线 LLM 做 JSON-mode 轻量分类，同时判断意图类别与所需工具，
          避免每轮把全部工具塞进 prompt（省 token、降选错率、加快首字）。
        - 降级：LLM 不可用/失败 → intent="chat"（聊天人设兜底）+ tools=None（全部工具）。
    """
    # 规则快路径 1：纯聊天 → chat 人设、零工具
    if _looks_like_pure_chat(text):
        return {"intent": "chat", "tools": [], "confidence": 1.0, "source": "rule"}
    # 规则快路径 2：强工作意图 → work 人设（工具由下方 LLM 精挑，规则不抢答）
    if _looks_like_work(text):
        # 工作意图仍让 LLM 精挑工具；若 LLM 不可用则下方统一降级
        pass

    try:
        llm = engine._get_llm()
        if llm is None:
            # 无 LLM：强工作词走 work 人设 + 全部工具；其余聊天人设 + 全部工具
            intent = "work" if _looks_like_work(text) else "chat"
            return {"intent": intent, "tools": None, "confidence": 0.5, "source": "fallback"}
        tool_list = "\n".join(f"- {n}" for n in all_tool_names)
        sys_prompt = (
            "你是一个意图分类器。判断用户消息的意图类别、是否需要调用工具、以及需要哪些工具。\n"
            "只输出 JSON，不要任何解释。\n"
            "格式：{\"intent\": \"chat\"|\"work\"|\"neutral\", \"needs_tools\": bool, "
            "\"tools\": [工具名列表], \"confidence\": 0-1}\n"
            "intent 含义：chat=闲聊/情感/陪伴/观点讨论；work=编程/写作/分析/搜索/文件/命令等任务；"
            "neutral=介于两者之间（用聊天人设即可）。\n"
            "可选工具：\n" + tool_list + "\n"
            "规则：闲聊/问候/情感交流/观点讨论 → intent=chat, needs_tools=false, tools=[]；"
            "需要搜索/查时间/文件操作/代码/运行命令/打开应用等 → intent 取 work 或 neutral，"
            "并选对应工具；若不确定是否需要工具，intent=neutral, needs_tools=false。"
        )
        resp = llm.chat(
            [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": text},
            ],
            max_tokens=256,
            temperature=0.0,
        )
        if not resp:
            intent = "work" if _looks_like_work(text) else "chat"
            return {"intent": intent, "tools": None, "confidence": 0.5, "source": "fallback"}
        # 容错：抽取第一个 JSON 块
        raw = resp.strip()
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1:
            intent = "work" if _looks_like_work(text) else "chat"
            return {"intent": intent, "tools": None, "confidence": 0.5, "source": "fallback"}
        data = json.loads(raw[start : end + 1])
        intent = data.get("intent", "neutral")
        if intent not in ("chat", "work", "neutral"):
            intent = "neutral"
        # neutral 回落到聊天人设（更轻、更亲切），保持体验一致
        if intent == "neutral":
            intent = "chat"
        if not data.get("needs_tools"):
            return {"intent": intent, "tools": [], "confidence": float(data.get("confidence", 0.8)), "source": "llm"}
        picked = [t for t in (data.get("tools") or []) if t in set(all_tool_names)]
        return {
            "intent": intent,
            "tools": picked if picked else None,
            "confidence": float(data.get("confidence", 0.8)),
            "source": "llm",
        }
    except Exception as exc:
        log.warning("[INTENT] 分类失败，降级为聊天人设+全部工具: %s", exc)
        return {"intent": "chat", "tools": None, "confidence": 0.0, "source": "fallback"}


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
        # start / ensure：在后台线程拉起 STT + 前端活跃 TTS 引擎（默认 Edge TTS），
        # GPT-SoVITS（可选），避免阻塞事件循环。tts 字段由前端携带活跃 TTS 的 typeName，
        # 网关据此选择引擎，避免"前端用 CosyVoice、网关却多起一个闲置 Edge"的错位。
        tts_cfg = data.get("tts") or {}
        tts_type = tts_cfg.get("typeName") if isinstance(tts_cfg, dict) else None
        statuses = await asyncio.to_thread(ensure_voice_services, tts_type)
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


async def _fetch_emotion_context() -> str:
    """从 core 服务拉取当前情绪，构造「情绪 → 说话方式」注入块（让 LLM 像人一样
    情绪影响说话语气：生气时克制带情绪、开心时乐于分享）。失败静默返回空串。"""
    try:
        import httpx

        async with httpx.AsyncClient(base_url="http://127.0.0.1:9877", timeout=2) as client:
            resp = await client.get("/api/core/heart/emotion")
            if resp.status_code != 200:
                return ""
            data = resp.json()
        pad = data.get("pad") or {}
        mood_cn = data.get("mood_label_cn") or "平静"
        p = float(pad.get("pleasure", 0.0))
        a = float(pad.get("arousal", 0.0))
        d = float(pad.get("dominance", 0.0))

        # 情绪 → 说话方式指南（让语气自然流露，不刻意声明）
        if p > 0.3:
            tone = "热情开朗、乐于分享，多用轻松语气和感叹"
        elif p < -0.3:
            tone = "情绪低落，语气克制、简短，流露一点难过或不满"
        elif a > 0.3:
            tone = "兴奋话多、愿意主动聊，语速和语气更活跃"
        else:
            tone = "平静温和，正常闲聊"

        return (
            "\n\n<emotion-context>\n"
            f"【当前情绪】{mood_cn}（愉悦 {p:.2f} / 唤醒 {a:.2f} / 支配 {d:.2f}）\n"
            f"【说话方式】当前应{tone}，让回复语气自然体现这个情绪，不要说出来。\n"
            "</emotion-context>"
        )
    except Exception:
        return ""


# 互动统计注入缓存（60s）：避免每次聊天都打 core 服务
_interaction_ctx_cache: dict[str, Any] = {"ts": 0.0, "text": ""}


async def _fetch_interaction_context() -> str:
    """从 core 服务拉取互动低频聚合统计，构造「最近互动」注入块。

    让角色"知道发生了这些事 + 频率"（如用户最近经常摸头），
    但每次互动并不单独进对话——只在沉淀/统计层面聚合。失败静默返回空串。
    """
    now = time.time()
    if now - _interaction_ctx_cache["ts"] < 60:
        return _interaction_ctx_cache["text"]
    try:
        import httpx

        async with httpx.AsyncClient(base_url="http://127.0.0.1:9877", timeout=2) as client:
            resp = await client.get("/api/core/interaction/stats")
            if resp.status_code != 200:
                return ""
            data = resp.json()
        stats = data.get("stats") or {}
        if not stats:
            return ""
        parts: list[str] = []
        for itype, s in stats.items():
            label = s.get("label") or itype
            total = int(s.get("total", 0))
            recent = int(s.get("recent", 0))
            parts.append(f"{label} {total} 次（近 7 天 {recent} 次）")
        text = (
            "\n\n<interaction-context>\n"
            "【最近互动】" + "、".join(parts) + "\n"
            "这些是你与用户之间的肢体互动，是 TA 表达亲昵或玩闹的方式。"
            "可以自然地提起（比如\"又被你摸头了\"），但不要生硬复述次数。\n"
            "</interaction-context>"
        )
        _interaction_ctx_cache["ts"] = now
        _interaction_ctx_cache["text"] = text
        return text
    except Exception:
        return ""


async def _handle_chat(ws: WebSocket, engine: HermesEngine, data: dict) -> None:
    text = data.get("text", "")
    if not text:
        log.warning("[CHAT] empty text received, ignoring")
        return
    msg_id = data.get("id", f"msg_{time.time()}")
    t_chat_start = time.time()
    # 默认 auto：由意图分类器按消息动态决定工具子集（用户无感知切换）。
    # 仍支持显式 'chat'/'work'（走 MODE_CONFIGS 固定白名单，作为可控兜底）。
    mode = data.get("mode", "auto")
    frontend_tools = data.get("frontend_tools", []) or []

    log.info("[CHAT] start id=%s mode=%s text=%s", msg_id, mode, text[:120])
    _trace("[CHAT] start id=%s mode=%s text=%s", msg_id, mode, text[:120])
    # 工具白名单：None 表示全部可用；列表则只暴露该子集（最少工具原则）
    cfg = engine.MODE_CONFIGS.get(mode, engine.MODE_CONFIGS["chat"])
    # 前端可临时禁用某些工具（持久化在 localStorage，随消息上报）
    disabled = set(data.get("disabled_tools", []) or [])
    log.info("[CHAT] frontend_tools=%s disabled=%s", [t.get("name") for t in frontend_tools], list(disabled))
    _trace("[CHAT] frontend_tools=%s disabled=%s", [t.get("name") for t in frontend_tools], list(disabled))

    if mode == "auto":
        # 自动意图识别：按本条消息动态决定【人设/历史】与【工具子集】（用户无感知切换）。
        # intent 选 MODE_CONFIGS 的人设与历史长度；tools 决定下发给 LLM 的工具白名单。
        all_names = [t.get("name") for t in frontend_tools if t.get("name")] + [
            t.get("name") for t in tool_executor.tool_definitions() if t.get("name")
        ]
        classified = _classify_intent(engine, text, list(dict.fromkeys(all_names)))
        # 人设/历史随意图自适应：chat 用聊天人设(轻、亲切)，work 用工作人设(全工具、有条理)
        cfg = engine.MODE_CONFIGS.get(classified["intent"], engine.MODE_CONFIGS["chat"])
        whitelist = classified["tools"]  # [] = 零工具；None = 全部
        _trace("[CHAT][auto] intent=%s source=%s tools=%s", classified["intent"], classified["source"], whitelist)
        log.info("[CHAT][auto] intent=%s source=%s tools=%s", classified["intent"], classified["source"], whitelist)
    else:
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
    # 情绪注入：说话方式跟随角色当前情绪（像人——生气时语气带情绪、开心时乐于分享）
    try:
        emotion_block = await _fetch_emotion_context()
    except Exception:
        emotion_block = ""
    if emotion_block:
        system_content += emotion_block
    # 互动注入：角色知道"最近发生过哪些肢体互动 + 频率"（低频聚合，不逐条进对话）
    try:
        interaction_block = await _fetch_interaction_context()
    except Exception:
        interaction_block = ""
    if interaction_block:
        system_content += interaction_block
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
