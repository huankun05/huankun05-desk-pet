/**
 * AI Service — 薄代理层
 *
 * 保留原有的对外 API 不变（AIConfig, EmotionContext, ChatMessage, aiService），
 * 内部委托 ProviderManager 获取活跃的 ChatProvider 执行实际调用。
 *
 * 消费者（App.tsx, SettingsPanel, useInteraction, useMemory）无需任何修改。
 */

import type { ChatSession } from './chatStorage';
import { providerManager } from './provider/manager';
import type { OpenAIChatProvider } from './provider/openai/chat';
import type { ChatStreamChunk, OpenAIToolSchema } from './tools/types';
import { isOfflineModeEnabled } from './provider/watchdog';

// ===== Re-export（保持向后兼容） =====

export type { ChatMessage, EmotionContext } from './provider/types';

// 内部使用的类型
import type { ChatMessage, EmotionContext } from './provider/types';

// ===== AIConfig（向后兼容接口） =====

export interface AIConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
  enableSmartChat?: boolean;
}

// ===== 配置转换 =====

/** AIConfig (旧格式) → OpenAIChatConfig 字段映射 */
function aiConfigToProviderConfig(config: AIConfig) {
  return {
    apiBase: config.apiUrl,
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt: config.systemPrompt,
    enableSmartChat: config.enableSmartChat,
  };
}

/** OpenAIChatProvider 配置 → AIConfig (旧格式) */
function providerConfigToAIConfig(config: Record<string, unknown>): AIConfig {
  return {
    apiUrl: (config.apiBase as string) || 'https://api.openai.com/v1',
    apiKey: (config.apiKey as string) || '',
    model: (config.model as string) || 'gpt-3.5-turbo',
    systemPrompt: config.systemPrompt as string | undefined,
    enableSmartChat: config.enableSmartChat as boolean | undefined,
  };
}

// ===== AIService 代理 =====

export class AIService {
  /** 获取当前活跃的 OpenAIChatProvider（支持会话级覆盖） */
  private getProvider(sessionId?: string): OpenAIChatProvider | null {
    if (sessionId) {
      return providerManager.getSessionChatProvider(sessionId) as OpenAIChatProvider | null;
    }
    return providerManager.getActiveChatProvider() as OpenAIChatProvider | null;
  }

  /** @deprecated 使用 getProvider(sessionId) 代替 */
  private get provider(): OpenAIChatProvider | null {
    return this.getProvider();
  }

  /** 等待初始化完成 */
  get ready(): Promise<void> {
    return providerManager.ready;
  }

  /**
   * 获取当前配置（AIConfig 格式）
   */
  getConfig(): AIConfig {
    const activeId = providerManager.listProviders('chat')[0]?.id;
    if (!activeId) {
      return {
        apiUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-3.5-turbo',
      };
    }
    const config = providerManager.getConfig<Record<string, unknown>>(activeId);
    return config
      ? providerConfigToAIConfig(config)
      : {
          apiUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-3.5-turbo',
        };
  }

  /**
   * 保存配置（更新活跃 provider）
   */
  saveConfig(config: Partial<AIConfig>): void {
    const activeId = providerManager.listProviders('chat')[0]?.id;
    if (!activeId) return;

    const current = providerManager.getConfig<Record<string, unknown>>(activeId) || {};
    const merged = { ...current, ...aiConfigToProviderConfig(config as AIConfig) };
    providerManager.updateProvider(activeId, merged as never);
  }

  /**
   * 从文件同步（管理后台修改后调用）
   */
  syncFromFile(fileData: AIConfig): void {
    const activeId = providerManager.listProviders('chat')[0]?.id;
    if (!activeId) return;

    const defaults: Record<string, unknown> = {
      apiBase: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-3.5-turbo',
    };
    const newConfig = { ...defaults, ...aiConfigToProviderConfig(fileData) };
    providerManager.updateProvider(activeId, newConfig as never);
  }

  /**
   * 取消当前流式请求
   */
  abortChat(sessionId?: string): void {
    this.getProvider(sessionId)?.abort();
  }

  /**
   * 非流式聊天（用于测试连接等场景）
   */
  async chat(
    userMessage: string,
    emotionCtx?: EmotionContext,
    sessionId?: string,
  ): Promise<string> {
    if (isOfflineModeEnabled()) {
      throw new Error('Offline mode enabled');
    }
    const provider = this.getProvider(sessionId);
    if (!provider) {
      throw new Error('No chat provider configured. Please check your settings.');
    }

    const systemPrompt = provider.getSystemPrompt(emotionCtx);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    return provider.chat(messages, { temperature: 0.7, maxTokens: 500 });
  }

  /**
   * 流式聊天：yield ChatStreamChunk（文本 / 工具调用 / 完成）
   *
   * @example
   * for await (const chunk of aiService.chatStream(session)) {
   *   if (chunk.type === 'text') accumulated += chunk.content;
   * }
   */
  async *chatStream(
    session: ChatSession,
    memoryContext?: string,
    emotionCtx?: EmotionContext,
    tools?: OpenAIToolSchema[],
  ): AsyncGenerator<ChatStreamChunk, void, unknown> {
    if (isOfflineModeEnabled()) {
      throw new Error('Offline mode enabled');
    }
    const provider = this.getProvider(session.id);
    if (!provider) {
      throw new Error('No chat provider configured. Please check your settings.');
    }
    yield* provider.chatStreamWithContext(session, memoryContext, emotionCtx, tools);
  }

  /**
   * 获取 ChatProvider 实例（供 ToolLoopRunner 等直接使用）
   */
  getChatProvider(sessionId?: string): OpenAIChatProvider | null {
    return this.getProvider(sessionId);
  }

  /**
   * 构建初始消息列表（system prompt + 会话历史 + 记忆上下文）
   *
   * 供 LLMStage 在多轮工具循环中使用。复制 provider.buildMessages 逻辑，
   * 但返回 ChatMessage[] 供 ToolLoopRunner 直接操作。
   */
  buildInitialMessages(
    sessionId: string,
    session: ChatSession,
    memoryContext?: string,
    emotionCtx?: EmotionContext,
    compressedHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): ChatMessage[] {
    const provider = this.getProvider(sessionId);
    if (!provider) throw new Error('No chat provider configured.');

    const systemPrompt = this._buildSystemPrompt(provider, memoryContext, emotionCtx);
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

    // 优先使用压缩后的历史，否则从 session 中取最近 20 条
    const history = compressedHistory ?? session.messages.slice(-20);
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content });
    }
    return messages;
  }

  /** 构建 system prompt（兼容 PersonalityInjectStage 完整 prompt 注入） */
  private _buildSystemPrompt(
    provider: OpenAIChatProvider,
    memoryContext?: string,
    emotionCtx?: EmotionContext,
  ): string {
    const basePrompt = provider.getSystemPrompt(emotionCtx);

    if (!memoryContext) return basePrompt;

    // 检测是否已经是完整 system prompt（由 PersonalityInjectStage 生成）
    if (memoryContext.includes('[你的性格设定]') || memoryContext.includes('[当前心情]')) {
      return memoryContext;
    }

    return `${basePrompt}\n\n${memoryContext}`;
  }

  /**
   * 智能闲聊：生成一条主动消息
   */
  async generateProactiveMessage(emotion: string, mood: string): Promise<string> {
    if (isOfflineModeEnabled()) {
      return '';
    }
    return this.getProvider()?.generateProactiveMessage(emotion, mood) ?? '';
  }
}

export const aiService = new AIService();
