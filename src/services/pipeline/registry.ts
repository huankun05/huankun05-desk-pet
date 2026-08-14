/**
 * pipeline/registry — Stage 声明式注册表（Phase 12.3）
 *
 * 对应 DeepSeek Harness: 每个 stage 是插件，靠配置组合；模式 = 不同插件集。
 * 这里把"stage 顺序"从硬编码改为声明式：以名字组合管道，便于增删/切换预设。
 *
 * 用法：
 *   const scheduler = buildPipeline(DEFAULT_PIPELINE, factories);
 *   scheduler.execute(ctx, callbacks);
 * 其中 factories 为 { stageName: () => Stage }，由调用方按自身依赖注入。
 */

import { PipelineScheduler } from './scheduler';
import type { Stage } from './types';

/** 已知 stage 名（拼写错误会在 buildPipeline 时报错，fail-fast） */
export const KNOWN_STAGES = [
  'context',
  'content-safety',
  'personality-inject',
  'unified-memory',
  'llm',
  'think-parse',
  'emotion-finalize',
  'behavior-decorate',
  'idle-detect',
  'tts',
] as const;

export type StageName = (typeof KNOWN_STAGES)[number];

/**
 * 默认管道顺序（与现有 stages 语义一致）：
 * 上下文压缩 → 内容安全 → 人设注入 → 记忆检索 → LLM → 思维解析
 * → 情感定稿 → 行为装饰 → 闲时检测 → TTS
 */
export const DEFAULT_PIPELINE: StageName[] = [
  'context',
  'content-safety',
  'personality-inject',
  'unified-memory',
  'llm',
  'think-parse',
  'emotion-finalize',
  'behavior-decorate',
  'idle-detect',
  'tts',
];

/** stage 名称 → 工厂（调用方注入依赖） */
export type StageFactories = Partial<Record<StageName, () => Stage>>;

/**
 * 按名称列表组装管道。
 * @param names 要加载的 stage 名称（顺序即执行顺序）
 * @param factories 名称 → 工厂映射
 * @param opts.allowUnknown 是否容忍未知 stage 名（默认 false，遇未知即抛错）
 */
export function buildPipeline(
  names: readonly StageName[],
  factories: StageFactories,
  opts: { allowUnknown?: boolean } = {},
): PipelineScheduler {
  const scheduler = new PipelineScheduler();
  for (const name of names) {
    if (!KNOWN_STAGES.includes(name)) {
      if (opts.allowUnknown) {
        console.warn(`[PipelineRegistry] 跳过未知 stage: ${name}`);
        continue;
      }
      throw new Error(`[PipelineRegistry] 未知 stage 名: ${name}`);
    }
    const factory = factories[name];
    if (!factory) {
      throw new Error(`[PipelineRegistry] 未提供 stage 工厂: ${name}`);
    }
    scheduler.addStage(factory());
  }
  return scheduler;
}

/** 用默认顺序 + 提供的工厂构建管道 */
export function createDefaultPipeline(factories: StageFactories): PipelineScheduler {
  return buildPipeline(DEFAULT_PIPELINE, factories);
}
