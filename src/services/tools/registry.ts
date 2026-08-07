/**
 * ToolRegistry — 工具注册器
 *
 * 管理工具注册/注销、生成 OpenAI schema、执行工具调用。
 * 导出全局单例 toolRegistry。
 */

import type { ToolDefinition, ToolCall, ToolResult, OpenAIToolSchema } from './types';

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /** 注册工具 */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, { ...tool, enabled: tool.enabled ?? true });
  }

  /** 设置工具启用状态 */
  setEnabled(name: string, enabled: boolean): void {
    const tool = this.tools.get(name);
    if (tool) {
      tool.enabled = enabled;
    }
  }

  /** 注销工具 */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /** 获取工具定义 */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** 获取所有已注册工具 */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** 是否有已注册的工具 */
  hasTools(): boolean {
    return this.tools.size > 0;
  }

  /**
   * 生成 OpenAI function calling schema
   *
   * 将内部 ToolDefinition 转换为 OpenAI API 要求的 tools 格式。
   */
  toOpenAISchema(): OpenAIToolSchema[] {
    return this.getAll().map((tool) => {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, param] of Object.entries(tool.parameters)) {
        properties[key] = {
          type: param.type,
          description: param.description,
          ...(param.enum ? { enum: param.enum } : {}),
          ...(param.default !== undefined ? { default: param.default } : {}),
          ...(param.items ? { items: { type: param.items.type } } : {}),
        };
        if (param.required) {
          required.push(key);
        }
      }

      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object',
            properties,
            ...(required.length > 0 ? { required } : {}),
          },
        },
      };
    });
  }

  /**
   * 执行工具调用
   */
  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        callId: call.id,
        name: call.name,
        content: `Error: unknown tool '${call.name}'`,
        isError: true,
      };
    }

    try {
      const content = await tool.execute(call.arguments);
      return { callId: call.id, name: call.name, content };
    } catch (err) {
      return {
        callId: call.id,
        name: call.name,
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }
}

/** 全局单例 */
export const toolRegistry = new ToolRegistry();
