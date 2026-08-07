"""
Hermes Gateway — WebSocket 实时对话网关

作为大脑（Hermes）与身体（desk-pet 前端）之间的实时通信层：
- 接受前端 WebSocket 连接，接收用户消息
- 通过 Hermes SessionDB 持久化对话历史
- 调用 LLM 生成流式回复
- 通过 Core API 同步情绪/记忆状态
- 流式回传 token 到前端

启动: python -m server.hermes_gateway_server --port 8765
"""
from __future__ import annotations

import argparse
import asyncio
import concurrent.futures
import json
import logging
import sys
import time
from pathlib import Path
from collections.abc import AsyncIterator
from typing import Any, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] hermes-gateway: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("hermes-gateway")

# ---------------------------------------------------------------------------
# Path setup（确保 hermes_core 可导入）
# ---------------------------------------------------------------------------
_server_dir = Path(__file__).resolve().parent
if str(_server_dir) not in sys.path:
    sys.path.insert(0, str(_server_dir))

from hermes_core import SessionDB  # noqa: E402


# ---------------------------------------------------------------------------
# Hermes 引擎封装
# ---------------------------------------------------------------------------

class HermesEngine:
    """Hermes 对话引擎：管理会话、LLM 调用、情绪/记忆同步。"""

    SESSION_ID = "desk-pet-main"

    def __init__(self) -> None:
        # 初始化 SessionDB
        from core.session_service import get_db, get_session_db_path
        self.db_path = get_session_db_path()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._db = get_db()

        # LLM 实例（懒加载）
        self._llm: Any = None

        # 确保主会话存在
        if self._db.get_session(self.SESSION_ID) is None:
            self._db.create_session(self.SESSION_ID, source="desk-pet")

        # Core API 地址（用于同步情绪/记忆）
        self.core_api_base = "http://127.0.0.1:9877"

    # ---- LLM ----

    def _get_llm(self) -> Any:
        """懒加载 LLM 实例。"""
        if self._llm is not None:
            return self._llm
        try:
            from modules.llm import LLMChat
            # 从 providers.json 读取配置
            providers_path = self.db_path.parent.parent / "data" / "providers.json"
            config = {}
            if providers_path.exists():
                try:
                    data = json.loads(providers_path.read_text(encoding="utf-8"))
                    configs = data.get("configs", [])
                    active_id = data.get("activeChatId", "")
                    for c in configs:
                        if c.get("id") == active_id or (not active_id and c.get("enable")):
                            config = {
                                "mode": "api",
                                "api_provider": "openai",
                                "api_base_url": c.get("apiBase", ""),
                                "api_key": c.get("apiKey", ""),
                                "model": c.get("model", ""),
                                "temperature": c.get("temperature", 0.7),
                                "max_tokens": c.get("maxTokens", 2048),
                            }
                            break
                except Exception:
                    log.warning("Failed to parse providers.json", exc_info=True)
            self._llm = LLMChat(config) if config else None
            if self._llm:
                log.info("LLM initialized from providers.json")
            else:
                log.warning("No LLM config found — gateway will echo messages")
        except Exception as exc:
            log.warning("LLM init failed: %s — gateway will echo messages", exc)
            self._llm = None
        return self._llm

    # ---- 会话操作 ----

    def get_history(self, limit: int = 50) -> list[dict]:
        """获取主会话历史。"""
        return self._db.get_messages(self.SESSION_ID, limit=limit)

    def append_message(self, role: str, content: str) -> None:
        """写入消息到 Hermes SessionDB。"""
        self._db.append_message(self.SESSION_ID, role=role, content=content)

    # ---- LLM 对话 ----

    async def chat_stream(self, user_text: str) -> AsyncIterator[str]:
        """流式对话：接收用户文本，yield LLM token。"""
        llm = self._get_llm()

        # 写入用户消息
        self.append_message("user", user_text)

        # 构建消息列表（含历史）
        history = self._db.get_messages(self.SESSION_ID, limit=50)
        messages = [
            {"role": "system", "content": "你是一个桌面宠物精灵，性格活泼可爱，用简短自然的语气和用户对话。"},
        ]
        for msg in history[-40:]:  # 最多 40 条历史
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})

        if llm and llm.is_available():
            # 在线程池中运行同步生成器，避免阻塞事件循环
            loop = asyncio.get_running_loop()
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                tokens = await loop.run_in_executor(
                    pool, lambda: list(llm.chat_stream(messages))
                )
            full_response = ""
            for token in tokens:
                full_response += token
                yield token
            # 写入助手回复
            if full_response:
                self.append_message("assistant", full_response)
                # 同步到 Core API 情绪/记忆
                try:
                    await self._sync_to_core(user_text, full_response)
                except Exception:
                    pass
        else:
            # LLM 不可用时的回退
            fallback = f"[Hermes 收到] {user_text[:50]}{'…' if len(user_text) > 50 else ''}"
            self.append_message("assistant", fallback)
            yield fallback

    async def _sync_to_core(self, user_text: str, assistant_text: str) -> None:
        """同步对话到 Core API（情绪事件 + 记忆提取）。"""
        import httpx
        async with httpx.AsyncClient(base_url=self.core_api_base, timeout=5) as client:
            # 情绪事件
            try:
                await client.post("/api/core/emotion/bridge/event", json={
                    "event": "message:sent",
                    "value": user_text[:200],
                    "source": "hermes-gateway",
                })
            except Exception:
                pass
            # 记忆提取
            try:
                await client.post("/api/core/brain/memories/extract", json={
                    "user_text": user_text[:500],
                    "assistant_text": assistant_text[:500],
                    "character_id": "default",
                    "user_id": "default",
                    "use_llm": False,
                })
            except Exception:
                pass


# ============================================================
# FastAPI App
# ============================================================

def create_app() -> FastAPI:
    from contextlib import asynccontextmanager

    engine: HermesEngine = HermesEngine()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        log.info("Hermes Gateway started (port %d)", getattr(app, "_port", 8765))
        yield
        log.info("Hermes Gateway stopped")

    app = FastAPI(title="Hermes Gateway", version="1.0.0", lifespan=lifespan)

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
        """获取主会话历史。"""
        messages = engine.get_history(limit=limit)
        return {"session_id": engine.SESSION_ID, "messages": messages}

    @app.get("/api/gateway/skills")
    def list_skills():
        """获取所有已注册技能（含映射表）。"""
        from core.hermes_skills_bridge import get_all_skills
        return get_all_skills()

    @app.post("/api/gateway/chat")
    async def chat_rest(body: dict):
        """REST 对话接口（非流式）。"""
        text = body.get("text", "")
        if not text:
            return {"error": "text is required"}
        full = ""
        async for token in engine.chat_stream(text):
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

                # 解析消息
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    await ws.send_json({"type": "error", "message": "Invalid JSON"})
                    continue

                msg_type = data.get("type", "chat")

                if msg_type == "ping":
                    await ws.send_json({"type": "pong", "timestamp": time.time()})
                    continue

                if msg_type == "chat":
                    text = data.get("text", "")
                    if not text:
                        continue

                    log.info("Chat: %s", text[:80])

                    # 流式回复
                    full_response = ""
                    async for token in engine.chat_stream(text):
                        full_response += token
                        await ws.send_json({
                            "type": "token",
                            "token": token,
                            "session_id": engine.SESSION_ID,
                        })

                    # 回复完成
                    await ws.send_json({
                        "type": "done",
                        "session_id": engine.SESSION_ID,
                        "full_response": full_response,
                    })
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