/**
 * MCP (Model Context Protocol) 类型定义
 */

/** MCP 服务器配置 */
export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
}

/** MCP 服务器返回的工具信息 */
export interface McpToolInfo {
  name: string;
  description: string;
  server_id: string;
  input_schema: Record<string, unknown>;
}

/** MCP 服务器连接状态 */
export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** MCP 服务器运行时状态 */
export interface McpServerStatus {
  id: string;
  status: McpConnectionStatus;
  error?: string;
  tools?: McpToolInfo[];
}

/** 存储的 MCP 服务器列表 */
export interface McpServersData {
  servers: McpServerConfig[];
}
