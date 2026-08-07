/**
 * Function Calling 工具类型定义
 *
 * 定义 ToolDefinition（工具注册）、ToolCall（LLM 调用请求）、
 * ToolResult（执行结果）、OpenAIToolSchema（API 格式）。
 */

/** 工具参数定义 */
export interface ToolParameter {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
  items?: ToolParameter;
}

/** 工具定义（注册时使用） */
export interface ToolDefinition {
  /** 唯一标识，如 'screenshot' */
  name: string;
  /** 给 LLM 看的工具描述 */
  description: string;
  /** 参数定义 */
  parameters: Record<string, ToolParameter>;
  /** 执行函数 */
  execute: (args: Record<string, unknown>) => Promise<string>;
  /** 是否启用 */
  enabled?: boolean;
}

/** LLM 返回的工具调用请求 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 工具执行结果 */
export interface ToolResult {
  callId: string;
  name: string;
  content: string;
  isError?: boolean;
}

/** OpenAI function calling schema */
export interface OpenAIToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/** 流式输出 chunk 类型 */
export type ChatStreamChunk =
  { type: 'text'; content: string } | { type: 'tool_calls'; calls: ToolCall[] } | { type: 'done' };
