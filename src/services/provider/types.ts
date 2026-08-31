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

export type ProviderType = 'chat' | 'tts' | 'stt' | 'embedding' | 'vision';

/**
 * 本地服务启动规格（可选）。
 *
 * 当 provider 需要在本机拉起一个后台进程（本地 TTS/STT 引擎）时，
 * 把启动命令/工作目录/端口/环境变量写在这里，而不是依赖全局写死的映射表。
 * 这样：
 *  - 每个 provider 都能指定自己要用的 Python 解释器（解决"别人用别的模型/环境"问题）；
 *  - 支持「自定义 / 其他模型」：用户直接填启动命令即可。
 * `command` 允许绝对路径（如 `F:/xxx/.venv/Scripts/python.exe`）。
 */
export interface ServiceLaunchSpec {
  command: string;
  args?: string[];
  workDir?: string;
  port?: number;
  env?: Record<string, string>;
}

export interface ProviderConfig {
  /** 唯一标识，如 'openai-chat-1' */
  id: string;
  /** Provider 类型 */
  type: ProviderType;
  /** 显示名称，如 'OpenAI GPT-4' */
  name: string;
  /** 是否启用 */
  enable: boolean;
  /** 本地服务启动规格（可选，仅本地引擎需要） */
  launch?: ServiceLaunchSpec;
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
  /**
   * 轻量健康探针（可选）。
   *
   * 与 validate()（配置校验/连通测试）区分：isAvailable 用于运行时判断
   * "该 provider 当前能否真正产出结果"。未实现时回退到 validate()。
   * ProviderManager 借此在 active provider 损坏时自动回退到其他可用实例
   * （Harness 式"健康探针胜出"自愈，见 PLAN.md Phase 12.1）。
   */
  isAvailable?(): Promise<boolean>;
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
  /** 适配器类型名，如 'edge_tts' / 'gpt_sovits' / 'cosyvoice' */
  typeName: string;
  /** HTTP 服务地址，如 'http://localhost:8001' */
  apiBase: string;
  /** 语音名称 / 角色名 */
  voice?: string;
  /** 语速倍率，默认 1.0 */
  speed?: number;
  /** 输出采样率 */
  sampleRate?: number;
  /** 本地权重目录（绝对路径或相对应用根目录）；用户通过向导「选择权重位置」写入 */
  weightsPath?: string;
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
  /** 适配器类型名（可选）。本地 embedding 服务需要，API 类可省略。 */
  typeName?: string;
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

// ===== VisionProvider（借鉴 Miru 三层模型配置：Vision / Chat / Memory） =====

/**
 * 视觉模型配置。
 *
 * 视觉模型本质是"能接收图片的 Chat 模型"（OpenAI 兼容 chat/completions
 * 支持 image_url 内容块），因此字段与 ChatProviderConfig 一致，单独成类型
 * 是为了让「多模态 / 一起看」可以配置一个独立于对话 LLM 的视觉端点，
 * 避免把截图塞给对话大脑（Miru 的 vision_model_first 思路）。
 */
export interface VisionProviderConfig extends ProviderConfig {
  type: 'vision';
  /** 适配器类型名，如 'openai_vision' */
  typeName: string;
  apiKey: string;
  /** API 基础地址，如 'https://api.openai.com/v1' */
  apiBase: string;
  /** 视觉模型名称，如 'gpt-4o-mini' / 'qwen2-vl' */
  model: string;
}

export interface VisionProvider extends Provider {
  readonly config: VisionProviderConfig;
  /** 非流式视觉理解：文本 + 图片 → 文本 */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  /** 获取可用模型列表 */
  getModels(): Promise<string[]>;
  /** 取消当前请求 */
  abort(): void;
}

// ===== Pipeline / Behavior hooks =====

export interface PipelineContext {
  emotionCtx?: EmotionContext;
  memoryContext?: string;
  [key: string]: unknown;
}
