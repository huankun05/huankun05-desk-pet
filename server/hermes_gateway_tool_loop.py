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
        frontend_tools: list[dict[str, Any]] | None = None,
        backend_tools: list[dict[str, Any]] | None = None,
        max_iterations: int = MAX_TOOL_ITERATIONS,
        executor: Any = None,
    ) -> None:
        self.ws = ws
        self.session_id = session_id
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
        """Run tool loop and return done payload."""
        if initial_messages:
            messages = list(initial_messages)
        else:
            messages = self._build_initial_messages(user_text, mode)
        tools = self._to_openai_tools()
        accumulated = ""
        all_calls: list[ToolCall] = []
        all_results: list[ToolResult] = []

        for iteration in range(self.max_iterations):
            tool_calls = await self._collect_tool_calls(messages, llm_stream, tools=tools)
            if not tool_calls:
                break

            # Notify frontend tool calls
            await self.ws.send_json({
                "type": "tool:call",
                "session_id": self.session_id,
                "calls": [
                    {"id": c.id, "name": c.name, "arguments": c.arguments}
                    for c in tool_calls
                ],
            })

            # Execute tools
            round_results = await self._execute_tools(tool_calls)

            # Notify frontend results
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

            # Append to message history (OpenAI tool_calls / tool format)
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

            # Collect final text after this round
            text_parts = await self._collect_tool_calls(
                messages, llm_stream, want_text=True, tools=tools
            )
            if text_parts:
                accumulated += "".join(text_parts)

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

    async def _collect_tool_calls(
        self,
        messages: list[dict[str, Any]],
        llm_stream: Any,
        want_text: bool = False,
        tools: list[dict[str, Any]] | None = None,
    ) -> list[ToolCall]:
        """Call LLM once and return tool_calls from first response."""
        tool_calls: list[ToolCall] = []
        text_parts: list[str] = []

        try:
            async for chunk in llm_stream(messages, tools=tools):
                if isinstance(chunk, str):
                    if want_text:
                        text_parts.append(chunk)
                elif isinstance(chunk, dict):
                    if chunk.get("type") == "tool_calls":
                        for call in chunk.get("calls", []):
                            tool_calls.append(ToolCall(
                                call_id=call.get("id", f"call_{time.time()}"),
                                name=call.get("name", ""),
                                arguments=call.get("arguments", {}),
                            ))
        except Exception as exc:
            log.warning("Tool loop LLM call failed: %s", exc)

        return text_parts if want_text else tool_calls

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
        return await asyncio.wait_for(fn(call.arguments), timeout=BACKEND_TOOL_TIMEOUT)

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
