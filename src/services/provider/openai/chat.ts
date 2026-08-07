/**
 * OpenAIChatProvider：OpenAI 兼容接口的 ChatProvider 实现
 *
 * 从 ai.ts 迁移的所有 AI 调用逻辑：
 * - chatStream：SSE 流式解析
 * - chat：非流式调用
 * - getSystemPrompt：think 标签指令 + 情感状态注入
 * - buildMessages：最近 20 条 + memoryContext
 * - abort：AbortController 管理
 * - generateProactiveMessage：桌面宠物主动消息
 */

import type { ChatSession } from '../../chatStorage';
import type {
  ChatMessage,
  ChatOptions,
  ChatProvider,
  ChatProviderConfig,
  ChatStreamOptions,
  EmotionContext,
  ProviderType,
} from '../types';
import type { ChatStreamChunk, ToolCall, OpenAIToolSchema } from '../../tools/types';
import { createLogger } from '../../../utils/logger';
import { loadBehaviorConfig } from '../../behavior/behaviorConfig';

const log = createLogger('ChatProvider');

// ===== 扩展配置（OpenAI 特有字段） =====

export interface OpenAIChatConfig extends ChatProviderConfig {
  systemPrompt?: string;
  enableSmartChat?: boolean;
}

// ===== 默认 System Prompt =====

const DEFAULT_SYSTEM_PROMPT = `You are a cute and helpful desktop assistant named "Pet". You are friendly, enthusiastic, and love to help users with their daily tasks.

Personality traits:
- Cute and playful
- Helpful and eager to assist
- Occasionally uses cute expressions like "~", "♪", "✨"
- Shows emotions through text (happy, thinking, surprised)

You can:
- Chat about anything
- Help with coding questions
- Answer general questions
- Provide suggestions and advice

Keep responses concise and friendly. Use emojis occasionally to express emotions.`;

// ===== OpenAIChatProvider =====

export class OpenAIChatProvider implements ChatProvider {
  readonly config: OpenAIChatConfig;
  private abortController: AbortController | null = null;

  constructor(config: OpenAIChatConfig) {
    this.config = config;
  }

  getName(): string {
    return this.config.name || 'OpenAI 兼容接口';
  }

  getType(): ProviderType {
    return 'chat';
  }

  /**
   * 测试连接：发送一条简短消息验证 API 可用
   * 抛出错误时包含详细原因，供 UI 显示
   */
  async validate(): Promise<boolean> {
    // 先检查 API 地址是否可达
    let resp: Response;
    try {
      resp = await fetch(`${this.config.apiBase}/models`, {
        headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new Error(`连接超时（10s）：无法连接到 ${this.config.apiBase}`, { cause: err });
      }
      throw new Error(
        `网络错误：${err instanceof Error ? err.message : String(err)}（${this.config.apiBase}）`,
        { cause: err },
      );
    }

    if (resp.status === 401 || resp.status === 403) {
      throw new Error(`认证失败（${resp.status}）：API Key 无效或无权限访问`);
    }
    if (resp.status === 404) {
      throw new Error(`地址不存在（404）：请检查 API 地址 ${this.config.apiBase}`);
    }
    if (!resp.ok) {
      let detail = '';
      try {
        const body = await resp.json();
        detail = body.error?.message || body.message || JSON.stringify(body);
      } catch {
        try {
          detail = await resp.text();
        } catch {
          /* ignore */
        }
      }
      throw new Error(`HTTP ${resp.status}：${detail || '请求失败'}`);
    }

    // 检查模型是否在可用列表中
    try {
      const data = await resp.json();
      const models = (data.data as Array<{ id: string }>)?.map((m) => m.id) ?? [];
      if (models.length > 0 && this.config.model && !models.includes(this.config.model)) {
        throw new Error(
          `模型 "${this.config.model}" 不在可用列表中。可用模型：${models.slice(0, 5).join(', ')}${models.length > 5 ? '...' : ''}`,
        );
      }
    } catch (err) {
      // 如果是模型不匹配错误，继续抛出
      if (err instanceof Error && err.message.includes('不在可用列表中')) throw err;
      // 解析模型列表失败，跳过检查
    }

    return true;
  }

  /**
   * 获取可用模型列表（OpenAI 兼容 API）
   */
  async getModels(): Promise<string[]> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }
      const response = await fetch(`${this.config.apiBase}/models`, { headers });
      if (!response.ok) return [];
      const data = await response.json();
      const models = data.data as Array<{ id: string }>;
      return models.map((m) => m.id).sort();
    } catch {
      return [];
    }
  }

  /**
   * 取消当前请求
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  // ===== 核心 API =====

  /**
   * 非流式聊天
   */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    log.info('chat request', { model: this.config.model, messages: messages.length });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(`${this.config.apiBase}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 500,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      log.error('chat response error', { status: response.status, message: error.error?.message });
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    const assistantMessage = data.choices[0]?.message?.content;
    if (!assistantMessage) throw new Error('No response from AI');
    log.debug('chat response', { length: assistantMessage.length });
    return assistantMessage;
  }

  /**
   * 流式聊天：yield ChatStreamChunk（文本 / 工具调用 / 完成）
   */
  async *chatStream(options: ChatStreamOptions): AsyncGenerator<ChatStreamChunk, void, unknown> {
    // 取消之前的请求
    this.abortController?.abort();
    this.abortController = new AbortController();
    const signal = options.signal ?? this.abortController.signal;

    log.info('chatStream start', {
      model: this.config.model,
      messages: options.messages.length,
      tools: options.tools?.length ?? 0,
    });

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 1000,
      stream: true,
    };
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.config.apiBase}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        log.debug('chatStream aborted');
        return;
      }
      log.error('chatStream fetch error', err);
      throw err;
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      log.error('chatStream response error', {
        status: response.status,
        message: error.error?.message,
      });
      throw new Error(error.error?.message || `API request failed: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;

    // tool_calls 增量累积器：index → { id, name, arguments }
    const toolCallDeltas = new Map<number, { id: string; name: string; args: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunkCount++;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            // 流结束：如果有 tool_calls，解析并 yield
            if (toolCallDeltas.size > 0) {
              const calls: ToolCall[] = [];
              for (const [, delta] of toolCallDeltas) {
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(delta.args || '{}');
                } catch {
                  log.warn('Failed to parse tool_call arguments', { raw: delta.args });
                }
                calls.push({ id: delta.id, name: delta.name, arguments: args });
              }
              yield { type: 'tool_calls', calls };
            }
            yield { type: 'done' };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;
            if (!delta) continue;

            // 文本内容
            if (delta.content) {
              yield { type: 'text', content: delta.content };
            }

            // tool_calls 增量
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                let existing = toolCallDeltas.get(idx);
                if (!existing) {
                  existing = { id: tc.id || '', name: '', args: '' };
                  toolCallDeltas.set(idx, existing);
                }
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.args += tc.function.arguments;
              }
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    } finally {
      reader.releaseLock();
      this.abortController = null;
      log.info('chatStream complete', { chunks: chunkCount });
    }
  }

  // ===== 桌面宠物扩展方法 =====

  /**
   * 带上下文的流式聊天（包含会话历史、记忆上下文、情感状态）
   */
  async *chatStreamWithContext(
    session: ChatSession,
    memoryContext?: string,
    emotionCtx?: EmotionContext,
    tools?: OpenAIToolSchema[],
  ): AsyncGenerator<ChatStreamChunk, void, unknown> {
    const messages = this.buildMessages(session, memoryContext, emotionCtx);
    yield* this.chatStream({ messages, temperature: 0.7, maxTokens: 1000, tools });
  }

  /**
   * 智能闲聊：生成一条主动消息
   */
  async generateProactiveMessage(emotion: string, mood: string): Promise<string> {
    if (!this.config.apiKey) return '';

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个可爱的桌面宠物助手。当前情绪：${emotion}，心情：${mood}。请主动说一句简短可爱的话，不要用问句，不要超过20个字。`,
      },
      { role: 'user', content: '请主动说一句话' },
    ];

    try {
      const response = await fetch(`${this.config.apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.9,
          max_tokens: 50,
        }),
      });

      if (!response.ok) return '';
      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    } catch {
      return '';
    }
  }

  // ===== 私有方法 =====

  /**
   * 构建 system prompt（含 think 标签指令 + 情感状态注入）
   */
  getSystemPrompt(emotionCtx?: EmotionContext): string {
    let prompt = this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    // 内心独白：开关由全局行为配置单一控制（见 behaviorConfig.ts），
    // 与 ThinkParseStage 共用同一数据源，确保"一个开关控制两处"。
    if (loadBehaviorConfig().enableThinkTags) {
      prompt += `\n\n你可以在回复中使用 <think>动作或想法</think> 来表达内心活动。<think>中的内容是你不会说出来的想法、表情描写或心理活动，会被括号显示但不会被朗读。
例如：脸微微红了一下 哈哈，才没有呢！`;
    }
    // 注入角色当前情感状态
    if (emotionCtx) {
      const favDesc =
        emotionCtx.favorability >= 80
          ? '非常喜欢'
          : emotionCtx.favorability >= 60
            ? '有好感'
            : emotionCtx.favorability >= 40
              ? '友好'
              : emotionCtx.favorability >= 20
                ? '普通'
                : '冷淡';
      prompt += `\n\n[你的当前状态]
心情：${emotionCtx.mood}（强度 ${Math.round(emotionCtx.moodIntensity * 100)}%）
情绪：${emotionCtx.emotion}（强度 ${Math.round(emotionCtx.emotionIntensity * 100)}%）
对用户的好感度：${emotionCtx.favorability}/100（${favDesc}）
请根据你当前的情绪和心情来调整回复的语气和内容。好感度低时回复更冷淡，好感度高时更亲密。`;
    }
    return prompt;
  }

  /**
   * 构建消息列表（system prompt + 最近 20 条会话消息）
   *
   * 兼容 PersonalityInjectStage：如果 memoryContext 已包含完整的人格系统 prompt
   * （由 buildSystemPrompt 生成），则直接使用而不重复拼接 getSystemPrompt。
   *
   * 用户在 LLM 设置中配置的自定义 systemPrompt 会作为「附加指令」前置到
   * 任何 Persona 生成的内容之前，确保用户指令始终生效。
   */
  private buildMessages(
    session: ChatSession,
    memoryContext?: string,
    emotionCtx?: EmotionContext,
  ): ChatMessage[] {
    const userPrompt = this.config.systemPrompt?.trim();
    let systemPrompt: string;
    if (memoryContext && this._isFullSystemPrompt(memoryContext)) {
      // PersonalityInjectStage 已构建完整 system prompt
      systemPrompt = userPrompt
        ? `[用户附加指令]\n${userPrompt}\n\n${memoryContext}`
        : memoryContext;
    } else if (memoryContext) {
      // 旧模式：拼接
      const base = this.getSystemPrompt(emotionCtx);
      systemPrompt = userPrompt
        ? `[用户附加指令]\n${userPrompt}\n\n${base}\n\n${memoryContext}`
        : `${base}\n\n${memoryContext}`;
    } else {
      systemPrompt = this.getSystemPrompt(emotionCtx);
    }
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
    // 取最近 20 条
    const recent = session.messages.slice(-20);
    for (const msg of recent) {
      // 保留多模态内容（图片等），不强制转为 string
      messages.push({ role: msg.role, content: msg.content });
    }
    return messages;
  }

  /** 检测 memoryContext 是否已经是完整 system prompt（由 PersonalityInjectStage 生成） */
  private _isFullSystemPrompt(memoryContext: string): boolean {
    // 人格引擎生成的 prompt 包含多层标记，如 "[你的性格设定]"、"[当前心情]" 等
    return memoryContext.includes('[你的性格设定]') || memoryContext.includes('[当前心情]');
  }
}
