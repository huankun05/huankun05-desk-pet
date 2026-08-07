/**
 * MCP Tauri 命令封装
 *
 * 调用 Rust 端的 MCP 进程管理命令。
 */

import { invoke } from '@tauri-apps/api/core';
import type { McpToolInfo } from './types';

/**
 * 连接（启动）一个 MCP 服务器并获取其工具列表
 */
export async function mcpConnect(
  serverId: string,
  command: string,
  args: string[],
): Promise<McpToolInfo[]> {
  return invoke<McpToolInfo[]>('mcp_connect', {
    serverId,
    command,
    args,
  });
}

/**
 * 调用 MCP 工具并返回文本结果
 */
export async function mcpCallTool(
  serverId: string,
  toolName: string,
  arguments_: Record<string, unknown>,
): Promise<string> {
  return invoke<string>('mcp_call_tool', {
    serverId,
    toolName,
    arguments: arguments_,
  });
}

/**
 * 断开（停止）一个 MCP 服务器
 */
export async function mcpDisconnect(serverId: string): Promise<void> {
  return invoke<void>('mcp_disconnect', { serverId });
}

/**
 * 断开所有 MCP 服务器
 */
export async function mcpDisconnectAll(): Promise<void> {
  return invoke<void>('mcp_disconnect_all');
}

/**
 * 获取当前已连接的服务器 ID 列表
 */
export async function mcpListConnections(): Promise<string[]> {
  return invoke<string[]>('mcp_list_connections');
}
