/**
 * OpenAIVisionProvider：视觉模型 Provider 实现
 *
 * 视觉模型本质是"能接收图片的 Chat 模型"（OpenAI 兼容 chat/completions
 * 原生支持 image_url 内容块），因此直接复用 OpenAIChatProvider 的全部能力
 * （SSE 流式、图片消息、abort 等），仅把 config 类型收敛为 VisionProviderConfig
 * 并对外以 'vision' 类型暴露，使「多模态 / 一起看」可独立配置一个视觉端点，
 * 而不必把截图塞给对话 LLM。
 */

import type {
  ChatMessage,
  ChatOptions,
  ChatProviderConfig,
  VisionProvider,
  VisionProviderConfig,
} from '../types';
import { OpenAIChatProvider } from './chat';

export class OpenAIVisionProvider implements VisionProvider {
  readonly config: VisionProviderConfig;
  private inner: OpenAIChatProvider;

  constructor(config: VisionProviderConfig) {
    this.config = config;
    this.inner = new OpenAIChatProvider(
      config as unknown as ChatProviderConfig & {
        systemPrompt?: string;
        enableSmartChat?: boolean;
      },
    );
  }

  getName(): string {
    return this.config.name || 'OpenAI 兼容视觉接口';
  }

  getType() {
    return 'vision' as const;
  }

  async validate(): Promise<boolean> {
    return this.inner.validate();
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    return this.inner.chat(messages, options);
  }

  /** 透传内层 ChatProvider 的最近一次 token 用量 */
  get lastUsage(): { promptTokens: number; completionTokens: number } | null {
    return this.inner.lastUsage;
  }

  async getModels(): Promise<string[]> {
    return this.inner.getModels();
  }

  abort(): void {
    this.inner.abort();
  }
}
