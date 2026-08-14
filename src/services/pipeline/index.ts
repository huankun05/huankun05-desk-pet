/**
 * Pipeline 模块导出
 */

export { PipelineScheduler } from './scheduler';
export { PipelineAbortError } from './types';
export type { Stage, MessageContext, PipelineCallbacks } from './types';

// 现有 Stage
export { ContextStage } from './stages/context';
export { ContentSafetyStage } from './stages/content-safety';
export { LLMStage } from './stages/llm';
export { EmotionFinalizeStage } from './stages/emotion-finalize';
export { ThinkParseStage } from './stages/think-parse';
export { TTSStage } from './stages/tts';

// P1 新增 Stage
export { PersonalityInjectStage } from './stages/personality-inject';
export { BehaviorDecorateStage } from './stages/behavior-decorate';
export type { BehaviorAction } from './stages/behavior-decorate';
export { IdleDetectStage } from './stages/idle-detect';

// M4：MemoryStage（在线 Hermes 核心）与 RAGStage（离线兜底）合并为统一检索链路
export { UnifiedMemoryStage } from './stages/unified-memory';
export { isRAGEnabled, setRAGEnabled } from './stages/rag';

// Phase 12.3：Stage 声明式注册表 + 默认管道
export { KNOWN_STAGES, DEFAULT_PIPELINE, buildPipeline, createDefaultPipeline } from './registry';
export type { StageName, StageFactories } from './registry';
