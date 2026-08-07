"""
Gateway backend tools registry.

These tools run inside the Hermes Gateway process and are available
to the LLM tool loop without involving the frontend.
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger("hermes-gateway")


def register_backend_tools(executor: Any) -> None:
    """Register built-in backend tools into the shared tool executor."""

    async def echo_tool(args: dict[str, Any]) -> str:
        message = args.get("message", "")
        return f"[backend echo] {message}"

    async def get_current_time(_args: dict[str, Any]) -> str:
        from datetime import datetime
        return datetime.now().isoformat()

    executor.register_builtin(
        name="echo",
        description="Echo back the given message. Mainly for testing tool plumbing.",
        parameters={
            "message": {
                "type": "string",
                "description": "Message to echo back.",
                "required": True,
            }
        },
        execute=echo_tool,
    )

    executor.register_builtin(
        name="get_current_time",
        description="Return the current server local time in ISO-8601 format.",
        parameters={},
        execute=get_current_time,
    )
