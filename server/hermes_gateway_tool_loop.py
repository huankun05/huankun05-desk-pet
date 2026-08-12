"""
Gateway Tool Loop — 服务端多轮工具执行

协议：
1. 前端发送 chat 消息，携带 mode 与可选的 frontend_tool_handlers
2. Gateway 调用 LLM，若返回 tool_calls：
   - backend tool：Gateway 本地执行
   - frontend tool：Gateway 发送 tool:execute 给前端，等待 tool:result
3. 工具结果回传 LLM，继续循环直到无 tool_calls 或达到上限
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator

log = logging.getLogger("hermes-gateway")

MAX_TOOL_ITERATIONS = 5
BACKEND_TOOL_TIMEOUT = 30


class ToolCall:
    def __init__(self, call_id: str, name: str, arguments: dict[str, Any]) -> None:
        self.id = call_id
        self.name = name
        self.arguments = arguments


class ToolResult:
    def __init__(self, call_id: str, name: str, content: str, is_error: bool = False) -> None:
        self.id = call_id
        self.name = name
        self.content = content
        self.is_error = is_error


class ToolLoop:
    """Frontend/backend mixed tool loop runner."""

    def __init__(
        self,
        ws: Any,
        session_id: str,
        msg_id: str = "",
        frontend_tools: list[dict[str, Any]] | None = None,
        backend_tools: list[dict[str, Any]] | None = None,
        max_iterations: int = MAX_TOOL_ITERATIONS,
        executor: Any = None,
    ) -> None:
        self.ws = ws
        self.session_id = session_id
        self.msg_id = msg_id
        self.frontend_tools = {t["name"]: t for t in (frontend_tools or [])}
        self.backend_tools = {t["name"]: t for t in (backend_tools or [])}
        self.max_iterations = max_iterations
        self._frontend_results: dict[str, ToolResult] = {}
        self._executor = executor

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(
        self,
        user_text: str,
        mode: str,
        llm_stream: Any,
        initial_messages: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Run tool loop and return done payload.

        每次迭代只调用一次 LLM：同时收集 tool_calls 与流式文本。
        若本轮有 tool_calls 则执行后进入下一轮；否则把文本当作最终回复并结束。
        """
        if initial_messages:
            messages = list(initial_messages)
        else:
            messages = self._build_initial_messages(user_text, mode)
        tools = self._to_openai_tools()
        accumulated = ""
        all_calls: list[ToolCall] = []
        all_results: list[ToolResult] = []

        for _ in range(self.max_iterations):
            tool_calls, text_parts = await self._collect(messages, llm_stream, tools=tools)
            # 累积每一轮产生的文本（含工具轮的次要说明），保证流式与最终一致
            accumulated += "".join(text_parts)
            if not tool_calls:
                break

            # 通知前端（展示用）
            await self.ws.send_json({
                "type": "tool:call",
                "session_id": self.session_id,
                "calls": [
                    {"id": c.id, "name": c.name, "arguments": c.arguments}
                    for c in tool_calls
                ],
            })

            # 执行工具（后端本地 / 前端经 WS）
            round_results = await self._execute_tools(tool_calls)

            # 通知前端结果（展示用）
            await self.ws.send_json({
                "type": "tool:result",
                "session_id": self.session_id,
                "results": [
                    {
                        "id": r.id,
                        "name": r.name,
                        "content": r.content,
                        "isError": r.is_error,
                    }
                    for r in round_results
                ],
            })

            # 追加到消息历史（OpenAI tool_calls / tool 格式）
            messages.append({
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": c.id,
                        "type": "function",
                        "function": {
                            "name": c.name,
                            "arguments": json.dumps(c.arguments, ensure_ascii=False),
                        },
                    }
                    for c in tool_calls
                ],
            })
            for r in round_results:
                messages.append({
                    "role": "tool",
                    "content": r.content,
                    "tool_call_id": r.id,
                    "name": r.name,
                })

            all_calls.extend(tool_calls)
            all_results.extend(round_results)
            # 继续下一轮：LLM 可能再产生 tool_calls 或最终文本

        return {
            "accumulated": accumulated,
            "toolCalls": all_calls,
            "toolResults": all_results,
        }

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _build_initial_messages(self, user_text: str, mode: str) -> list[dict[str, Any]]:
        """Fallback: build system + user when no initial_messages provided."""
        cfg = self._mode_config(mode)
        return [
            {"role": "system", "content": cfg["system_prompt"]},
            {"role": "user", "content": user_text},
        ]

    def _to_openai_tools(self) -> list[dict[str, Any]]:
        """Convert backend + frontend tool schemas into OpenAI `tools` format."""
        tools: list[dict[str, Any]] = []
        for t in list(self.backend_tools.values()) + list(self.frontend_tools.values()):
            params = t.get("parameters") or {}
            properties: dict[str, Any] = {}
            required: list[str] = []
            if isinstance(params, dict):
                all_json_schema = (
                    "type" in params or "properties" in params
                ) and not any(
                    isinstance(v, dict) and "type" in v for v in params.values()
                )
                if all_json_schema:
                    properties = params.get("properties", {})
                    required = list(params.get("required", []))
                else:
                    for pname, pdef in params.items():
                        if not isinstance(pdef, dict):
                            continue
                        properties[pname] = {
                            k: pdef[k] for k in ("type", "description") if k in pdef
                        }
                        if pdef.get("required"):
                            required.append(pname)
            tools.append({
                "type": "function",
                "function": {
                    "name": t.get("name", ""),
                    "description": t.get("description", ""),
                    "parameters": {
                        "type": "object",
                        "properties": properties,
                        "required": required,
                    },
                },
            })
        return tools

    def _mode_config(self, mode: str) -> dict[str, Any]:
        cfg = {
            "chat": {
                "system_prompt": (
                    "你是一个桌面宠物精灵，性格活泼可爱，用简短自然的语气和用户对话。"
                    "回复保持在 1-3 句话，像朋友聊天一样轻松。"
                    "\n\n【工具使用原则】你拥有 web_search（联网搜索）与 get_current_time（当前时间）两个工具，但默认不调用。"
                    "仅当用户明确询问实时 / 最新信息（如新闻、天气、股价、当前日期时间、近期事件）时才使用；"
                    "闲聊、问候、情感交流、观点讨论、或可用常识直接回答的问题，请直接自然回复，绝不调用任何工具。"
                ),
                "history_limit": 20,
            },
            "work": {
                "system_prompt": (
                    "你是一个智能桌面助手（桌面宠物精灵），具备完整的问题解决能力。"
                    "你可以帮助用户完成编程、写作、分析、搜索、文件操作等各类任务。"
                    "回答要准确、有条理、可操作。"
                ),
                "history_limit": 50,
            },
        }
        return cfg.get(mode, cfg["chat"])

    async def _collect(
        self,
        messages: list[dict[str, Any]],
        llm_stream: Any,
        tools: list[dict[str, Any]] | None = None,
    ) -> tuple[list[ToolCall], list[str]]:
        """单次 LLM 调用：同时收集 tool_calls 与流式文本。"""
        tool_calls: list[ToolCall] = []
        text_parts: list[str] = []

        try:
            async for chunk in llm_stream(messages, tools=tools):
                if isinstance(chunk, str):
                    text_parts.append(chunk)
                    # 实时流式推送 token 给前端，气泡逐字增长
                    if self.msg_id:
                        try:
                            await self.ws.send_json({
                                "type": "token",
                                "id": self.msg_id,
                                "token": chunk,
                            })
                        except Exception:  # noqa: BLE001
                            pass
                elif isinstance(chunk, dict) and chunk.get("type") == "tool_calls":
                    for call in chunk.get("calls", []):
                        tool_calls.append(ToolCall(
                            call_id=call.get("id", f"call_{time.time()}"),
                            name=call.get("name", ""),
                            arguments=call.get("arguments", {}),
                        ))
        except Exception as exc:
            log.warning("Tool loop LLM call failed: %s", exc)

        log.info("[TOOL_LOOP] _collect done: text_parts=%d tool_calls=%d", len(text_parts), len(tool_calls))
        if text_parts:
            log.info("[TOOL_LOOP] first_text=%s", text_parts[0][:120])
        if tool_calls:
            log.info("[TOOL_LOOP] tool_calls=%s", [c.name for c in tool_calls])

        return tool_calls, text_parts

    async def _execute_tools(self, calls: list[ToolCall]) -> list[ToolResult]:
        results: list[ToolResult] = []
        for call in calls:
            start = time.time()
            is_frontend = call.id.startswith("fe_") or call.name in self.frontend_tools
            try:
                if is_frontend:
                    result = await self._execute_frontend(call)
                else:
                    result = await self._execute_backend(call)
            except Exception as exc:
                result = ToolResult(call.id, call.name, str(exc), is_error=True)
                log.warning("Tool %r failed: %s", call.name, exc)
            log.info("Tool %r done in %.2fs", call.name, time.time() - start)
            results.append(result)
        return results

    async def _execute_backend(self, call: ToolCall) -> ToolResult:
        if self._executor is not None:
            try:
                content = await self._executor.execute(call.name, call.arguments)
                return ToolResult(call.id, call.name, content, is_error=False)
            except Exception as exc:
                return ToolResult(call.id, call.name, str(exc), is_error=True)

        tool = self.backend_tools.get(call.name)
        if not tool:
            return ToolResult(call.id, call.name, f"Unknown backend tool: {call.name}", is_error=True)
        fn = tool.get("execute")
        if not fn:
            return ToolResult(call.id, call.name, f"Tool missing execute: {call.name}", is_error=True)
        try:
            content = await asyncio.wait_for(fn(call.arguments), timeout=BACKEND_TOOL_TIMEOUT)
            return ToolResult(call.id, call.name, content, is_error=False)
        except Exception as exc:
            return ToolResult(call.id, call.name, str(exc), is_error=True)

    async def _execute_frontend(self, call: ToolCall) -> ToolResult:
        if call.name not in self.frontend_tools:
            return ToolResult(call.id, call.name, f"Unknown frontend tool: {call.name}", is_error=True)

        # Check cached result
        cached = self._frontend_results.pop(call.id, None)
        if cached:
            return cached

        # Ask frontend
        await self.ws.send_json({
            "type": "tool:execute",
            "session_id": self.session_id,
            "id": call.id,
            "name": call.name,
            "arguments": call.arguments,
        })

        # Wait for result (with timeout)
        try:
            raw = await asyncio.wait_for(self.ws.receive_text(), timeout=BACKEND_TOOL_TIMEOUT)
            data = json.loads(raw)
            if data.get("type") == "tool:result" and data.get("id") == call.id:
                return ToolResult(
                    call.id,
                    data.get("name", call.name),
                    data.get("content", ""),
                    is_error=bool(data.get("isError")),
                )
            # Store for later pickup if mismatched
            self._frontend_results[data.get("id", call.id)] = ToolResult(
                data.get("id", call.id),
                data.get("name", call.name),
                data.get("content", ""),
                is_error=bool(data.get("isError")),
            )
        except asyncio.TimeoutError:
            return ToolResult(call.id, call.name, "Frontend tool timed out", is_error=True)
        return ToolResult(call.id, call.name, "Frontend tool result missing", is_error=True)
