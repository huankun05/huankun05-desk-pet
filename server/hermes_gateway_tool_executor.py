"""
Gateway Tool Executor — 服务端可执行工具注册与执行

支持两类：
- builtin：Gateway 本地实现的通用工具
- mcp：通过 MCP 客户端调用外部工具服务器
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable

log = logging.getLogger("hermes-gateway")

ExecuteFn = Callable[[dict[str, Any]], Awaitable[str]]


class ToolExecutor:
    """Server-side tool executor."""

    def __init__(self) -> None:
        self._tools: dict[str, dict[str, Any]] = {}
        self._mcp_client: Any = None

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register_builtin(self, name: str, description: str, parameters: dict[str, Any], execute: ExecuteFn) -> None:
        self._tools[name] = {
            "name": name,
            "description": description,
            "parameters": parameters,
            "execute": execute,
        }

    def set_mcp_client(self, client: Any) -> None:
        self._mcp_client = client

    def tool_definitions(self) -> list[dict[str, Any]]:
        return [
            {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters"],
            }
            for t in self._tools.values()
        ]

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    async def execute(self, name: str, arguments: dict[str, Any]) -> str:
        tool = self._tools.get(name)
        if not tool:
            return f"Error: unknown backend tool '{name}'"
        try:
            return await tool["execute"](arguments)
        except Exception as exc:
            return f"Error: {exc}"

    async def execute_mcp(self, server_id: str, tool_name: str, arguments: dict[str, Any]) -> str:
        if not self._mcp_client:
            return "Error: MCP client not configured"
        try:
            result = await self._mcp_client.call_tool(server_id, tool_name, arguments)
            return json.dumps(result, ensure_ascii=False, indent=2) if not isinstance(result, str) else result
        except Exception as exc:
            return f"Error: {exc}"


tool_executor = ToolExecutor()
