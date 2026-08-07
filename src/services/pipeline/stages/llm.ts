/**
 * LLMStage — 流式 LLM 调用 + 多轮工具循环 + 逐句情感分析
 *
 * 核心阶段：
 * 1. 构建消息列表（system prompt + 会话历史 + 记忆上下文 + 人格注入）
 * 2. 使用 ToolLoopRunner 进行多轮 Agent 工具循环：
 *    a. 调用 LLM（支持 function calling）
 *    b. LLM 返回 tool_calls → 执行工具 → 以 `role: 'tool'` 消息回传 LLM
 *    c. 重复直到 LLM 不再返回 tool_calls 或达到最大迭代次数（5轮）
 * 3. 在句子边界触发情感分析，更新 UI 消息内容
 *
 * 修复（2026-06-22）：工具结果现在正确以 `role: 'tool'` 格式回传 LLM，
 * LLM 在后续迭代中可以看到工具输出并据此调整回复。
 * 之前仅将工具结果注入 UI 文本，LLM 无法认知工具输出。
 */

import type { Stage, MessageContext, PipelineCallbacks } from '../types';
import type { Message } from '../../../components/Chat/ChatWindow';
import type { AIService } from '../../ai';
import type { ToolCall, ToolResult } from '../../tools/types';
import { toolRegistry } from '../../tools/registry';
import { ToolLoopRunner, buildToolSummary } from '../tool-loop';

export class LLMStage implements Stage {
  readonly name = 'llm';
  private aiService: AIService;

  constructor(aiService: AIService) {
    this.aiService = aiService;
  }

  async process(ctx: MessageContext, callbacks: PipelineCallbacks): Promise<void> {
    // 获取 provider（如果不可用则报错）
    const provider = this.aiService.getChatProvider(ctx.session.id);
    if (!provider) {
      callbacks.onStreamChunk(ctx.assistantMessageId, '错误：没有聊天服务配置');
      return;
    }

    const tools = toolRegistry.hasTools() ? toolRegistry.toOpenAISchema() : undefined;

    // ===== 构建初始消息列表 =====
    const messages = this.aiService.buildInitialMessages(
      ctx.session.id,
      ctx.session,
      ctx.memoryContext || undefined,
      ctx.emotionSnapshot,
      ctx.compressedHistory,
    );

    // ===== 多轮工具循环 =====
    const runner = new ToolLoopRunner(5, () => ctx.aborted);
    let accumulated = '';
    let sentenceBuffer = '';
    const allToolCalls: ToolCall[] = [];
    const allToolResults: ToolResult[] = [];

    const loop = runner.run(provider, messages, tools, {
      onToolCall: (call) => {
        callbacks.onToolCall?.(call);
      },
      onToolResult: (result) => {
        callbacks.onToolResult?.(result);
      },
      onAccumulated: (text) => {
        callbacks.onStreamChunk(ctx.assistantMessageId, text);
      },
    });

    for await (const chunk of loop) {
      if (ctx.aborted) return;

      if (chunk.type === 'text_chunk') {
        sentenceBuffer += chunk.content;

        // 逐句触发情感分析
        if (/[。！？\n]/.test(sentenceBuffer)) {
          callbacks.onEmotionAnalyze(sentenceBuffer);
          callbacks.onStreamingTTS?.(sentenceBuffer.trim());
          sentenceBuffer = '';
        }
      } else if (chunk.type === 'tool_round') {
        allToolCalls.push(...chunk.calls);
        allToolResults.push(...chunk.results);

        // 工具执行摘要注入 UI 显示
        const summary = buildToolSummary(chunk.calls, chunk.results);
        accumulated += `\n\n🔧 ${summary}\n\n`;
        callbacks.onStreamChunk(ctx.assistantMessageId, accumulated);
      }
    }

    // 循环结束，获取最终结果
    const done = await loop.next();
    if (done.value && done.value.type === 'done') {
      accumulated = done.value.accumulated;
    }

    // ===== 写入上下文供后续阶段使用 =====
    ctx.accumulated = accumulated;
    ctx.sentenceBuffer = sentenceBuffer;

    // ===== 保存到会话 =====
    const finalMessage: Message = {
      id: ctx.assistantMessageId,
      role: 'assistant',
      content: accumulated,
      timestamp: new Date(),
      toolCalls:
        allToolCalls.length > 0
          ? allToolCalls.map((c, i) => ({
              name: c.name,
              input: c.arguments,
              output: allToolResults[i]?.content,
              status: allToolResults[i]?.isError ? ('error' as const) : ('success' as const),
            }))
          : undefined,
    };
    callbacks.onSaveMessage(finalMessage);
  }
}
