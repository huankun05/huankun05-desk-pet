/**
 * MCP 服务器配置管理器
 *
 * 管理 MCP 服务器配置的持久化（通过已有的 createStorage 机制）
 * 和运行时生命周期（启动/停止）。
 */

import { createStorage } from '../storage';
import { mcpConnect, mcpDisconnect, mcpDisconnectAll } from './client';
import type { McpServerConfig, McpServerStatus, McpServersData, McpToolInfo } from './types';

const DEFAULT_MCP_DATA: McpServersData = {
  servers: [],
};

/**
 * MCP 配置存储（复用 createStorage 双备份机制）
 *
 * 存储位置：项目目录 data/mcp/（非敏感配置，便于迁移）
 */
const mcpStorage = createStorage<McpServersData>('mcp_servers', DEFAULT_MCP_DATA, {
  location: 'project',
  subdir: 'mcp',
});

/**
 * 运行时状态（不在持久化存储中）
 */
const serverStatuses = new Map<string, McpServerStatus>();

function getStatus(serverId: string): McpServerStatus {
  if (!serverStatuses.has(serverId)) {
    serverStatuses.set(serverId, { id: serverId, status: 'disconnected' });
  }
  return serverStatuses.get(serverId)!;
}

function setStatus(serverId: string, partial: Partial<McpServerStatus>) {
  const existing = getStatus(serverId);
  Object.assign(existing, partial);
  serverStatuses.set(serverId, existing);
}

// ─── 配置管理 ───

/** 初始化 MCP 配置存储（从文件恢复） */
export async function initMcpStorage(): Promise<void> {
  await mcpStorage.init();
}

export function getMcpServers(): McpServerConfig[] {
  return mcpStorage.get().servers;
}

export function setMcpServers(servers: McpServerConfig[]) {
  const data = mcpStorage.get();
  data.servers = servers;
  mcpStorage.set(data);
}

export function addMcpServer(config: McpServerConfig) {
  const servers = getMcpServers();
  servers.push(config);
  setMcpServers(servers);
}

export function updateMcpServer(id: string, partial: Partial<McpServerConfig>) {
  const servers = getMcpServers();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  servers[idx] = { ...servers[idx], ...partial };
  setMcpServers(servers);
  return true;
}

export function removeMcpServer(id: string) {
  // 先断开连接
  disconnectServer(id);
  const servers = getMcpServers().filter((s) => s.id !== id);
  setMcpServers(servers);
}

// ─── 生命周期管理 ───

export async function connectServer(config: McpServerConfig): Promise<McpToolInfo[]> {
  setStatus(config.id, { status: 'connecting' });

  try {
    const tools = await mcpConnect(config.id, config.command, config.args);
    setStatus(config.id, { status: 'connected', tools, error: undefined });
    return tools;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(config.id, { status: 'error', error: msg });
    throw err;
  }
}

export async function disconnectServer(serverId: string) {
  try {
    await mcpDisconnect(serverId);
  } catch {
    // 忽略断开时的错误
  }
  setStatus(serverId, { status: 'disconnected', tools: undefined, error: undefined });
}

export async function disconnectAllServers() {
  await mcpDisconnectAll();
  for (const [id] of serverStatuses) {
    setStatus(id, { status: 'disconnected', tools: undefined, error: undefined });
  }
}

export async function connectAllEnabledServers(): Promise<McpToolInfo[]> {
  const servers = getMcpServers().filter((s) => s.enabled);
  const allTools: McpToolInfo[] = [];

  for (const server of servers) {
    const status = getStatus(server.id);
    if (status.status === 'connected' || status.status === 'connecting') continue;

    try {
      const tools = await connectServer(server);
      allTools.push(...tools);
    } catch (err) {
      console.warn(`[MCP] 连接服务器 "${server.name}" 失败:`, err);
    }
  }

  return allTools;
}

export function getServerStatus(serverId: string): McpServerStatus {
  return getStatus(serverId);
}

export function getAllServerStatuses(): McpServerStatus[] {
  return getMcpServers().map((s) => getStatus(s.id));
}

/** 生成唯一 ID */
export function generateMcpId(): string {
  return `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
