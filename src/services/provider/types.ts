/**
 * Provider 抽象层：类型定义
 *
 * 定义所有 Provider 的接口和配置类型。
 * ChatProvider 本阶段实现，TTS/STT/Embedding 仅定义接口骨架。
 */

import type { ToolCall, ChatStreamChunk, OpenAIToolSchema } from '../tools/types';

// ===== 通用消息类型 =====

/** 多模态内容片段 */
export type MessageContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** 支持纯文本或多模态内容数组（图片等） */
  content: string | MessageContentPart[];
  /** assistant 消息的工具调用请求 */
  tool_calls?: ToolCall[];
  /** tool 消息的关联 ID */
  tool_call_id?: string;
  /** tool 消息的工具名 */
  name?: string;
  /**
   * 标记此消息为运行时注入，不应持久化到会话存储。
   *
   * 用于：
   * - 多轮工具循环中的中间 assistant+tool 消息
   * - Proactive Agent 的唤醒消息
   * - RAG/系统注入的临时上下文消息
   */
  _no_save?: boolean;
}

/** 角色当前情感状态，可注入 AI 上下文 */
export interface EmotionContext {
  mood: string;
  moodIntensity: number;
  emotion: string;
  emotionIntensity: number;
  favorability: number;
  /** 人格特质（由 PersonaManager 注入） */
  personality?: {
    cheerfulness: number;
    sensitivity: number;
    sociability: number;
    energy: number;
  };
}

// ===== Provider 基础类型 =====

export type ProviderType = 'chat' | 'tts' | 'stt' | 'embedding';

export interface ProviderConfig {
  /** 唯一标识，如 'openai-chat-1' */
  id: string;
  /** Provider 类型 */
  type: ProviderType;
  /** 显示名称，如 'OpenAI GPT-4' */
  name: string;
  /** 是否启用 */
  enable: boolean;
}

/** Provider 适配器元信息（注册时使用） */
export interface ProviderMeta {
  /** 适配器类型名，如 'openai_chat' */
  typeName: string;
  /** 人类可读名称，如 'OpenAI 兼容接口' */
  displayName: string;
  /** 适配器描述 */
  description: string;
  /** 对应的 Provider 类型 */
  providerType: ProviderType;
}

/** 所有 Provider 的基础接口 */
export interface Provider {
  readonly config: ProviderConfig;
  getName(): string;
  getType(): ProviderType;
  /** 测试连接是否可用 */
  validate(): Promise<boolean>;
}

// ===== ChatProvider =====

export interface ChatProviderConfig extends ProviderConfig {
  type: 'chat';
  /** 适配器类型名，如 'openai_chat'，对应 Registry 注册的 typeName */
  typeName: string;
  apiKey: string;
  /** API 基础地址，如 'https://api.openai.com/v1' */
  apiBase: string;
  /** 模型名称 */
  model: string;
}

export interface ChatStreamOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** 可用工具列表（OpenAI function calling） */
  tools?: OpenAIToolSchema[];
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface ChatProvider extends Provider {
  readonly config: ChatProviderConfig;
  /** 流式聊天，yield ChatStreamChunk（文本/工具调用/完成） */
  chatStream(options: ChatStreamOptions): AsyncGenerator<ChatStreamChunk, void, unknown>;
  /** 非流式聊天 */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  /** 获取可用模型列表 */
  getModels(): Promise<string[]>;
  /** 取消当前请求 */
  abort(): void;
}

// ===== TTSProvider =====

/** TTS 合成结果 */
export interface TTSResult {
  /** WAV 音频数据 */
  audio: ArrayBuffer;
  /** 采样率 */
  sampleRate: number;
}

export interface TTSProviderConfig extends ProviderConfig {
  type: 'tts';
  /** 适配器类型名，如 'edge_tts' / 'gpt_sovits' / 'voxcpm' */
  typeName: string;
  /** HTTP 服务地址，如 'http://localhost:8001' */
  apiBase: string;
  /** 语音名称 / 角色名 */
  voice?: string;
  /** 语速倍率，默认 1.0 */
  speed?: number;
  /** 输出采样率 */
  sampleRate?: number;
}

export interface TTSOptions {
  /** 覆盖默认语音 */
  voice?: string;
  /** 覆盖默认语速 */
  speed?: number;
  /** 情感标签（如 [开心]），部分引擎支持 */
  emotion?: string;
}

export interface TTSProvider extends Provider {
  readonly config: TTSProviderConfig;
  /** 合成语音，返回 WAV 音频数据 */
  synthesize(text: string, options?: TTSOptions): Promise<TTSResult>;
  /** 流式合成，yield 音频 chunk */
  synthesizeStream(text: string, options?: TTSOptions): AsyncGenerator<ArrayBuffer, void, unknown>;
  /** 是否支持流式合成 */
  supportStream(): boolean;
  /** 获取可用语音列表 */
  getVoices(): Promise<string[]>;
  /** 取消当前合成请求 */
  abort(): void;
}

// ===== STTProvider =====

/** STT 识别结果（扩展支持情绪标签） */
export interface STTResult {
  /** 识别文本 */
  text: string;
  /** 情绪标签（SenseVoice 等引擎支持） */
  emotion?: 'happy' | 'sad' | 'angry' | 'neutral';
  /** 置信度 0-1 */
  confidence?: number;
}

export interface STTProviderConfig extends ProviderConfig {
  type: 'stt';
  /** 适配器类型名，如 'funasr' / 'sensevoice' */
  typeName: string;
  /** HTTP/WebSocket 服务地址 */
  apiBase: string;
  /** 识别语言，如 'zh-CN' */
  language?: string;
}

export interface STTProvider extends Provider {
  readonly config: STTProviderConfig;
  /** 语音转文本（完整音频 → 文本） */
  transcribe(audio: ArrayBuffer, format?: string): Promise<STTResult>;
  /** 是否支持流式识别 */
  supportStreaming(): boolean;
  /** 取消当前识别 */
  abort(): void;
}

// ===== EmbeddingProvider (Phase 4 实现) =====

export interface EmbeddingProviderConfig extends ProviderConfig {
  type: 'embedding';
  apiBase?: string;
  apiKey?: string;
  model?: string;
}

export interface EmbeddingProvider extends Provider {
  readonly config: EmbeddingProviderConfig;
  /** 获取文本向量 */
  getEmbedding(texts: string[]): Promise<number[][]>;
  /** 获取向量维度 */
  getDim(): number;
  /** 取消当前请求（可选，用于与 ProviderSlot 缓存机制兼容） */
  abort?: () => void;
}

// ===== Pipeline / Behavior hooks =====

export interface PipelineContext {
  emotionCtx?: EmotionContext;
  memoryContext?: string;
  [key: string]: unknown;
}
