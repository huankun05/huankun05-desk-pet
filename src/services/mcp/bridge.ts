/**
 * MCP → ToolRegistry 桥接层
 *
 * 将发现到的 MCP 工具自动注册到全局 ToolRegistry 中，
 * 这样 LLMStage 就能通过已有的 Function Calling 流程调用它们。
 */

import { toolRegistry } from '../tools/registry';
import type { ToolDefinition } from '../tools/types';
import { mcpCallTool } from './client';
import type { McpToolInfo } from './types';

/** 已注册的 MCP 工具名 → server_id 映射 */
const mcpToolMap = new Map<string, string>();

/**
 * 将一批 MCP 工具同步到 ToolRegistry
 */
export function syncMcpTools(tools: McpToolInfo[]) {
  for (const tool of tools) {
    const toolDef = mcpToolToDefinition(tool);
    toolRegistry.register(toolDef);
    mcpToolMap.set(tool.name, tool.server_id);
  }
}

/**
 * 从 ToolRegistry 中移除指定 MCP 服务器的所有工具
 */
export function removeMcpTools(serverId: string) {
  for (const [name, sid] of mcpToolMap) {
    if (sid === serverId) {
      toolRegistry.unregister(name);
      mcpToolMap.delete(name);
    }
  }
}

/**
 * 清除所有 MCP 工具
 */
export function clearAllMcpTools() {
  for (const [name] of mcpToolMap) {
    toolRegistry.unregister(name);
  }
  mcpToolMap.clear();
}

/**
 * 将 McpToolInfo 转换为 ToolDefinition
 */
function mcpToolToDefinition(tool: McpToolInfo): ToolDefinition {
  const schema = tool.input_schema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };

  const parameters: ToolDefinition['parameters'] = {};

  if (schema?.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      const prop = value as {
        type?: string;
        description?: string;
        enum?: string[];
        default?: unknown;
      };
      parameters[key] = {
        type: prop.type || 'string',
        description: prop.description || '',
        required: schema.required?.includes(key) ?? false,
        enum: prop.enum,
        default: prop.default,
      };
    }
  }

  return {
    name: `mcp_${tool.name}`,
    description: `[MCP/${tool.server_id}] ${tool.description || tool.name}`,
    parameters,
    execute: async (args: Record<string, unknown>) => {
      return mcpCallTool(tool.server_id, tool.name, args);
    },
  };
}
