/**
 * ToolLoopRunner — 多轮工具循环引擎
 *
 * 借鉴 AstrBot `tool_loop_agent_runner.py` 的多轮工具调用循环：
 * 1. 调用 LLM（可能返回 tool_calls）
 * 2. 执行工具 → 以 `role: 'tool'` 消息格式回传 LLM
 * 3. 继续循环直到无 tool_calls 或达到最大迭代次数
 *
 * 修复原有 LLMStage 中工具结果不回传 LLM 的 bug：
 * 之前只在 UI 显示工具摘要，LLM 看不到工具输出，无法根据输出调整回复。
 */

import type { ChatMessage, ChatProvider, MessageContentPart } from '../provider/types';
import type { ToolCall, ToolResult, OpenAIToolSchema } from '../tools/types';
import { toolRegistry } from '../tools/registry';
import { eventBus } from '../eventBus';

// ===== 常量 =====

const MAX_TOOL_ITERATIONS = 5;

// ===== 类型 =====

export interface ToolLoopEvent {
  type: 'text_chunk';
  content: string;
}

export interface ToolRoundEvent {
  type: 'tool_round';
  calls: ToolCall[];
  results: ToolResult[];
}

export interface ToolLoopDoneEvent {
  type: 'done';
  accumulated: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
}

export type ToolLoopChunk = ToolLoopEvent | ToolRoundEvent | ToolLoopDoneEvent;

export interface ToolLoopCallbacks {
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (result: ToolResult) => void;
  onAccumulated?: (accumulated: string) => void;
}

// ===== ToolLoopRunner =====

export class ToolLoopRunner {
  private maxIterations: number;
  private onAbort: () => boolean;

  constructor(maxIterations = MAX_TOOL_ITERATIONS, onAbort: () => boolean = () => false) {
    this.maxIterations = maxIterations;
    this.onAbort = onAbort;
  }

  /**
   * 执行多轮工具循环
   *
   * @param provider - ChatProvider 实例
   * @param initialMessages - 初始消息列表（system + 历史对话）
   * @param tools - OpenAI tool schema
   * @param callbacks - UI 回调
   * @returns AsyncGenerator，逐轮 yield 循环事件
   */
  async *run(
    provider: ChatProvider,
    initialMessages: ChatMessage[],
    tools: OpenAIToolSchema[] | undefined,
    callbacks: ToolLoopCallbacks = {},
  ): AsyncGenerator<ToolLoopChunk, ToolLoopDoneEvent, unknown> {
    const messages: ChatMessage[] = [...initialMessages];
    let accumulated = '';
    const allToolCalls: ToolCall[] = [];
    const allToolResults: ToolResult[] = [];

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      if (this.onAbort()) break;

      let iterText = '';
      let iterToolCalls: ToolCall[] = [];

      // ===== 调用 LLM（流式） =====
      for await (const chunk of provider.chatStream({
        messages,
        temperature: 0.7,
        maxTokens: 1000,
        tools,
      })) {
        if (this.onAbort()) break;

        if (chunk.type === 'text') {
          iterText += chunk.content;
          accumulated += chunk.content;
          yield { type: 'text_chunk', content: chunk.content };
          callbacks.onAccumulated?.(accumulated);
        } else if (chunk.type === 'tool_calls') {
          iterToolCalls = chunk.calls;
        }
        // 'done' chunk 由 loop 自然处理
      }

      if (this.onAbort()) break;

      // ===== 无工具调用 → 对话结束 =====
      if (iterToolCalls.length === 0) {
        break;
      }

      // ===== 有工具调用 → 执行并回传 =====
      allToolCalls.push(...iterToolCalls);

      // 将 LLM 的 tool_calls 响应加入消息历史（不持久化）
      messages.push({
        role: 'assistant',
        content: iterText || '',
        tool_calls: iterToolCalls,
        _no_save: true,
      });

      // 执行每个工具，结果以 `role: 'tool'` 消息加入历史
      const roundResults: ToolResult[] = [];
      for (const call of iterToolCalls) {
        callbacks.onToolCall?.(call);
        eventBus.emit('tool:call', { name: call.name, args: call.arguments });

        const result = await toolRegistry.execute(call);
        allToolResults.push(result);
        roundResults.push(result);

        callbacks.onToolResult?.(result);
        eventBus.emit('tool:result', {
          name: result.name,
          content: result.content,
          isError: result.isError,
        });

        // 截图等图片工具结果：转为多模态 user 消息，让 vision 模型能看到图片
        if (call.name === 'screenshot' && result.content.startsWith('data:image/')) {
          const multimodalContent: MessageContentPart[] = [
            { type: 'text', text: '这是当前屏幕截图，请分析画面内容。' },
            { type: 'image_url', image_url: { url: result.content } },
          ];
          messages.push({
            role: 'user',
            content: multimodalContent,
            _no_save: true,
          });
        } else {
          // 普通工具结果以 `role: 'tool'` 格式回传给 LLM（不持久化）
          messages.push({
            role: 'tool',
            content: result.content,
            tool_call_id: call.id,
            name: call.name,
            _no_save: true,
          });
        }
      }

      // 通知 UI 本轮工具调用完成
      yield { type: 'tool_round', calls: iterToolCalls, results: roundResults };
    }

    // 流结束，无论是否有 tool_calls 都生成摘要文本
    return {
      type: 'done',
      accumulated,
      toolCalls: allToolCalls,
      toolResults: allToolResults,
    };
  }
}

/**
 * 生成工具调用摘要文本（插入到 UI 气泡中显示）
 */
export function buildToolSummary(calls: ToolCall[], results: ToolResult[]): string {
  if (calls.length === 0) return '';
  return calls
    .map((c, i) => {
      const r = results[i];
      const status = r?.isError ? '❌' : '✅';
      const preview = r ? r.content.slice(0, 80) : '';
      return `${status} ${c.name}: ${preview}`;
    })
    .join('\n');
}
