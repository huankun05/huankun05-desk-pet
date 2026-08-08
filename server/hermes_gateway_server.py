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
from hermes_gateway_memory import memory_store, extract_memories_async

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] hermes-gateway: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("hermes-gateway")

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
        if not llm or not llm.is_available():
            # LLM 不可用时返回空（不暴露内部回显信息给用户）
            yield ""
            return

        loop = asyncio.get_running_loop()
        with __import__("concurrent.futures").ThreadPoolExecutor(max_workers=1) as pool:
            tokens = await loop.run_in_executor(
                pool, lambda: list(llm.chat_stream(messages, tools=tools))
            )
        for token in tokens:
            yield token

    async def _sync_to_core(self, user_text: str, assistant_text: str) -> None:
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
                try:
                    await client.post(
                        "/api/core/brain/memories/extract",
                        json={
                            "user_text": user_text[:500],
                            "assistant_text": assistant_text[:500],
                            "character_id": "default",
                            "user_id": "default",
                            "use_llm": False,
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

    engine: HermesEngine = HermesEngine()
    register_backend_tools(tool_executor)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        log.info("Hermes Gateway started (port %d)", getattr(app, "_port", 8765))
        yield
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
    def get_memory(q: str | None = None, limit: int = 300):
        if q:
            return {"items": memory_store.recall(q, limit)}
        return {"items": memory_store.list_all(limit), "count": memory_store.count()}

    @app.post("/api/gateway/memory")
    async def add_memory(body: dict):
        text = (body.get("text") or "").strip()
        if not text:
            return {"error": "text is required"}
        mid = memory_store.add(
            text, body.get("category", "fact"), body.get("source", "manual")
        )
        return {"id": mid}

    @app.delete("/api/gateway/memory/{mid}")
    def del_memory(mid: int):
        memory_store.delete(mid)
        return {"ok": True}

    @app.post("/api/gateway/chat")
    async def chat_rest(body: dict):
        text = body.get("text", "")
        if not text:
            return {"error": "text is required"}
        mode = body.get("mode", "chat")
        full = ""
        async for token in engine.chat_stream(text, mode=mode):
            full += token
        return {"response": full, "session_id": engine.SESSION_ID}

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


async def _learn(engine: HermesEngine, user_text: str, assistant_text: str) -> None:
    """自学习：从一轮对话中抽取持久记忆并入库。失败静默降级。"""
    if not assistant_text or not user_text:
        return
    conversation = f"用户: {user_text}\n助手: {assistant_text}"
    try:
        memories = await extract_memories_async(conversation, engine._llm_stream)
    except Exception as exc:  # noqa: BLE001
        log.warning("自学习抽取异常: %s", exc)
        return
    if not memories:
        return
    added = 0
    for m in memories:
        if memory_store.add(m["text"], m.get("category", "fact"), source="chat") > 0:
            added += 1
    if added:
        log.info("自学习：本轮抽取并保存 %d 条记忆", added)


async def _handle_chat(ws: WebSocket, engine: HermesEngine, data: dict) -> None:
    text = data.get("text", "")
    if not text:
        log.warning("[CHAT] empty text received, ignoring")
        return
    msg_id = data.get("id", f"msg_{time.time()}")
    mode = data.get("mode", "chat")
    frontend_tools = data.get("frontend_tools", []) or []

    log.info("[CHAT] start id=%s mode=%s text=%s", msg_id, mode, text[:120])
    # 工具白名单：None 表示全部可用；列表则只暴露该子集（最少工具原则）
    cfg = engine.MODE_CONFIGS.get(mode, engine.MODE_CONFIGS["chat"])
    # 前端可临时禁用某些工具（持久化在 localStorage，随消息上报）
    disabled = set(data.get("disabled_tools", []) or [])
    log.info("[CHAT] frontend_tools=%s disabled=%s", [t.get("name") for t in frontend_tools], list(disabled))

    whitelist = cfg.get("tool_names", None)

    # Persist user message
    engine.append_message("user", text)

    # Build initial prompt：召回成长记忆并注入（仿 Hermes <memory-context> 协议）
    system_content = cfg["system_prompt"]
    recalled = memory_store.recall(text, limit=6)
    if recalled:
        mem_block = "\n".join(f"- {m['text']}" for m in recalled)
        system_content += (
            "\n\n<memory-context>\n以下是关于用户已记住的信息，请自然运用，不要重复确认：\n"
            f"{mem_block}\n</memory-context>"
        )
    history = engine.get_history(limit=cfg["history_limit"])
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_content},
        *[
            {"role": m.get("role", "user"), "content": m.get("content", "")}
            for m in history[-cfg["max_history"] :]
            if m.get("role") in ("user", "assistant") and m.get("content")
        ],
        {"role": "user", "content": text},
    ]

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

    tool_loop = ToolLoop(
        ws=ws,
        session_id=engine.SESSION_ID,
        frontend_tools=allowed_frontend,
        backend_tools=allowed_backend,
        executor=tool_executor,
    )
    log.info("[CHAT] tool_loop created frontend=%d backend=%d", len(allowed_frontend), len(allowed_backend))
    log.info("[CHAT] calling tool_loop.run...")
    result = await tool_loop.run(text, mode, engine._llm_stream, initial_messages=messages)
    log.info("[CHAT] tool_loop.run finished keys=%s accumulated_len=%d", list(result.keys()), len(result.get("accumulated", "") or ""))
    log.info("[CHAT] toolCalls=%d toolResults=%d", len(result.get("toolCalls", [])), len(result.get("toolResults", [])))

    full_response = result.get("accumulated", "") or text
    if full_response:
        engine.append_message("assistant", full_response)
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

    # 后台自学习：从本轮对话抽取持久记忆（不阻塞响应）
    try:
        asyncio.create_task(_learn(engine, text, full_response))
    except RuntimeError:
        # 无运行中的事件循环时跳过（如 REST 调用路径）
        pass


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
