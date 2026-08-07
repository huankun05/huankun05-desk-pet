/**
 * Pipeline 核心类型定义
 *
 * 消息处理管道的阶段接口和上下文类型。
 * Stage 按顺序执行，通过 MessageContext 传递数据。
 */

import type { Message } from '../../components/Chat/ChatWindow';
import type { ChatSession } from '../chatStorage';
import type { EmotionContext } from '../provider/types';
import type { ToolCall, ToolResult } from '../tools/types';

/** 流经管道的消息上下文 */
export interface MessageContext {
  /** 用户输入文本 */
  userText: string;
  /** 当前会话 */
  session: ChatSession;
  /** assistant 消息 ID（用于 UI 更新） */
  assistantMessageId: string;
  /** LLM 累积响应 */
  accumulated: string;
  /** 句子缓冲区（用于逐句情感分析 + 流式 TTS 收集） */
  sentenceBuffer: string;
  /** 情感上下文快照（避免闭包过期） */
  emotionSnapshot: EmotionContext;
  /** 记忆上下文（MemoryStage 填充） */
  memoryContext: string;
  /** 压缩后的对话历史（ContextStage 填充，供 LLMStage 使用） */
  compressedHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** 可朗读文本（ThinkParseStage 填充） */
  speakableText: string;
  /** TTS 音频结果 */
  ttsAudio: ArrayBuffer | null;
  ttsSampleRate: number;
  /** 是否中止 */
  aborted: boolean;
}

/** Stage 处理回调（UI 更新用，从 App.tsx 注入） */
export interface PipelineCallbacks {
  /** 流式更新 UI 消息 */
  onStreamChunk: (assistantId: string, accumulated: string) => void;
  /** 触发情感分析 */
  onEmotionAnalyze: (text: string) => void;
  /** 流式 TTS：句子边界触发，用于并行合成 */
  onStreamingTTS?: (text: string) => void;
  /** 保存消息到会话 */
  onSaveMessage: (msg: Message) => void;
  /** 工具调用开始 */
  onToolCall?: (call: ToolCall) => void;
  /** 工具调用完成 */
  onToolResult?: (result: ToolResult) => void;
  /** 获取最新情感上下文（用于 EmotionFinalizeStage 更新快照） */
  getLatestEmotion?: () => EmotionContext;
  /** Stage 执行抛错时通知（错误已隔离，不一定会终止管道） */
  onStageError?: (stage: Stage, error: Error, ctx: MessageContext) => void;
}

/** 管道执行选项 */
export interface PipelineExecuteOptions {
  /** 非致命错误是否继续执行后续 Stage（默认 true） */
  continueOnError?: boolean;
}

/** 管道阶段接口 */
export interface Stage {
  readonly name: string;
  process(ctx: MessageContext, callbacks: PipelineCallbacks): Promise<void>;
}

/** 管道中止信号 */
export class PipelineAbortError extends Error {
  constructor() {
    super('Pipeline aborted');
    this.name = 'PipelineAbortError';
  }
}
