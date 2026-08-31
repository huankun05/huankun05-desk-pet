/**
 * OllamaChatProvider — 本地 Ollama 模型适配器
 *
 * 与 OpenAIChatProvider 共享相同的 OpenAI 兼容 API 协议，
 * 但不需要 API Key，并增加本地模型自动检测。
 *
 * 自动检测能力：
 * - checkRunning(): 检查 Ollama 服务是否运行
 * - getModels(): 通过 /api/tags 获取已下载的模型列表
 */
import type {
  ChatMessage,
  ChatOptions,
  ChatProvider,
  ChatProviderConfig,
  ChatStreamOptions,
  EmotionContext,
  ProviderType,
} from '../types';
import type { ChatStreamChunk, OpenAIToolSchema } from '../../tools/types';
import { OpenAIChatProvider } from '../openai/chat';
import { DEFAULT_ENDPOINTS } from '../defaults';

/** Ollama 默认地址 */
const OLLAMA_DEFAULT_HOST = DEFAULT_ENDPOINTS.ollama;

/** 已知支持视觉的 Ollama 模型关键词 */
const VISION_MODEL_KEYWORDS = [
  'llava',
  'minicpm-v',
  'llama3.2-vision',
  'qwen2-vl',
  'qwen2.5-vl',
  'moondream',
  'bakllava',
  'gemma3', // gemma3 支持视觉
];

/** 检测模型名是否为 vision 模型 */
export function isVisionModel(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return VISION_MODEL_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * 检测 Ollama 服务是否在指定地址运行
 */
export async function checkOllamaRunning(host?: string): Promise<boolean> {
  const base = (host || OLLAMA_DEFAULT_HOST).replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error(`连接超时（3s）：无法连接到 ${base}，请确认 Ollama 已启动`, { cause: err });
    }
    throw new Error(`网络错误：${err instanceof Error ? err.message : String(err)}（${base}）`, {
      cause: err,
    });
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}：Ollama 服务返回错误`);
  }
  return true;
}

/**
 * 获取 Ollama 已下载的模型列表
 */
export async function getOllamaModels(host?: string): Promise<string[]> {
  const base = (host || OLLAMA_DEFAULT_HOST).replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    const models: Array<{ name: string }> = data.models || [];
    return models.map((m) => m.name).sort();
  } catch {
    return [];
  }
}

export class OllamaChatProvider implements ChatProvider {
  readonly config: ChatProviderConfig;
  /** 内部委托给 OpenAIChatProvider 处理实际 API 调用（无 API Key） */
  private inner: OpenAIChatProvider;

  constructor(config: ChatProviderConfig) {
    this.config = {
      ...config,
      apiKey: '', // Ollama 不需要 API Key
      apiBase: (config.apiBase || OLLAMA_DEFAULT_HOST).replace(/\/+$/, '') + '/v1',
    };
    this.inner = new OpenAIChatProvider({
      ...this.config,
      typeName: 'openai_chat',
    });
  }

  getName(): string {
    return this.config.name || 'Ollama（本地）';
  }

  getType(): ProviderType {
    return 'chat';
  }

  /**
   * 测试连接：检查 Ollama 是否在运行
   */
  async validate(): Promise<boolean> {
    return checkOllamaRunning(this.config.apiBase);
  }

  /**
   * 获取本地已下载的模型列表（通过 Ollama 原生 API）
   */
  async getModels(): Promise<string[]> {
    return getOllamaModels(this.config.apiBase);
  }

  /**
   * 取消当前请求
   */
  abort(): void {
    this.inner.abort();
  }

  /** 透传内层 provider 的最近一次 token 用量（Ollama 回传 usage 时非 null） */
  get lastUsage(): { promptTokens: number; completionTokens: number } | null {
    return this.inner.lastUsage;
  }

  /**
   * 非流式聊天（委托给 OpenAIChatProvider）
   */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    return this.inner.chat(messages, options);
  }

  /**
   * 流式聊天（委托给 OpenAIChatProvider）
   */
  async *chatStream(options: ChatStreamOptions): AsyncGenerator<ChatStreamChunk, void, unknown> {
    yield* this.inner.chatStream(options);
  }

  /**
   * 带上下文的流式聊天（委托给 OpenAIChatProvider）
   */
  async *chatStreamWithContext(
    session: import('../../chatStorage').ChatSession,
    memoryContext?: string,
    emotionCtx?: EmotionContext,
    tools?: OpenAIToolSchema[],
  ): AsyncGenerator<ChatStreamChunk, void, unknown> {
    yield* this.inner.chatStreamWithContext(session, memoryContext, emotionCtx, tools);
  }

  /**
   * 生成主动消息（委托给 OpenAIChatProvider）
   */
  async generateProactiveMessage(_emotion: string, _mood: string): Promise<string> {
    // Ollama 没有 API Key，proactive message 不启用
    return '';
  }
}
