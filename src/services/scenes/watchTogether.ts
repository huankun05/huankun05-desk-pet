/**
 * "一起看"场景逻辑
 *
 * 负责：
 * - 截屏（通过 Tauri 命令）
 * - 构建多模态消息（系统提示词 + 截图）
 * - 调用 LLM 分析画面内容
 * - 解析 JSON 响应（comment + expression + description）
 *
 * 不负责 UI 状态管理（由 useWatchTogether Hook 处理）和 TTS 播放。
 */

import { invoke } from '@tauri-apps/api/core';
import { aiService } from '../ai';
import { isVisionModel } from '../provider/ollama/chat';
import { providerManager } from '../provider/manager';
import { recordUsage } from '../provider/usageLedger';
import type { ChatMessage, MessageContentPart } from '../provider/types';
import { createLogger } from '../../utils/logger';

const log = createLogger('WatchTogether');

/** 视觉分析结果 */
export interface WatchTogetherResult {
  /** 角色评论（展示在气泡 + TTS 播放） */
  comment: string;
  /** 表情标签：happy / sad / surprised / angry / shy / neutral */
  expression: string;
  /** 画面描述（仅日志用，不展示） */
  description: string;
}

/** 默认系统提示词 */
export const DEFAULT_WATCH_PROMPT = `你是一个正在和我一起刷短视频的桌面宠物伙伴。
我刚刚截取了当前屏幕画面。请：
1. 简要描述你看到的视频内容（不超过 20 字）
2. 以可爱、活泼的语气发表一句评论（不超过 30 字）
3. 根据内容选择一个合适的表情标签：[happy, sad, surprised, angry, shy, neutral]
返回 JSON: { "comment": "...", "expression": "...", "description": "..." }`;

/**
 * 截取当前屏幕
 * @returns data URL 格式的 JPEG base64（如 "data:image/jpeg;base64,..."）
 */
export async function captureScreenshot(): Promise<string> {
  const dataUrl = await invoke<string>('capture_screenshot');
  return dataUrl;
}

/**
 * 检测当前活跃的 LLM 是否支持视觉
 *
 * 优先读取多模态配置（manual 模式），否则自动检测模型名。
 */
export function checkVisionCapability(
  modelName: string,
  config: { visionDetection: 'auto' | 'manual'; isVisionModel: boolean },
): boolean {
  if (config.visionDetection === 'manual') {
    return config.isVisionModel;
  }
  return isVisionModel(modelName);
}

/**
 * 分析截图：构建多模态消息 → 调用 LLM/Vision → 解析 JSON
 *
 * @param imageDataUrl 截图 data URL（JPEG base64）
 * @param systemPrompt 系统提示词
 * @param options.visionSourcePriority 视觉来源优先级：
 *   - 'vision_model_first' 且已配置独立视觉模型时，优先使用 VisionProvider（避免把截图塞给对话大脑）
 *   - 其他情况（auto / llm_first / embedding_first）回退到对话 LLM
 * @returns 解析后的评论 + 表情 + 描述
 */
export async function analyzeScreenshot(
  imageDataUrl: string,
  systemPrompt: string,
  options?: {
    visionSourcePriority?: 'auto' | 'llm_first' | 'embedding_first' | 'vision_model_first';
  },
): Promise<WatchTogetherResult> {
  const preferVisionModel =
    options?.visionSourcePriority === 'vision_model_first' &&
    providerManager.getActiveVisionProvider() != null;

  const provider = preferVisionModel
    ? providerManager.getActiveVisionProvider()!
    : aiService.getChatProvider();
  if (!provider) {
    throw new Error('No chat provider configured. Please check your settings.');
  }

  // 构建多模态消息
  const contentParts: MessageContentPart[] = [
    { type: 'text', text: '请分析这张截图。' },
    { type: 'image_url', image_url: { url: imageDataUrl } },
  ];

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: contentParts },
  ];

  log.info('Sending screenshot for analysis', {
    provider: preferVisionModel ? 'vision' : 'chat',
    model: provider.config.model,
    imageSize: imageDataUrl.length,
  });

  const raw = await provider.chat(messages, {
    temperature: 0.8,
    maxTokens: 200,
  });

  recordUsage({
    tier: preferVisionModel ? 'vision' : 'chat',
    model: provider.config.model,
    callLabel: 'vision_watch',
    promptChars: systemPrompt.length + imageDataUrl.length,
    completionChars: raw.length,
    promptTokens: provider.lastUsage?.promptTokens,
    completionTokens: provider.lastUsage?.completionTokens,
  });

  log.debug('LLM response', { length: raw.length, preview: raw.slice(0, 100) });

  return parseWatchResult(raw);
}

/**
 * 解析 LLM 返回的 JSON 结果
 *
 * 容错处理：
 * - 提取 ```json ... ``` 代码块
 * - 提取 { ... } JSON 片段
 * - 解析失败时返回降级结果
 */
export function parseWatchResult(raw: string): WatchTogetherResult {
  try {
    // 尝试提取 JSON 代码块
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw.trim();

    // 尝试提取 { ... } 片段
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    const finalStr = jsonMatch ? jsonMatch[0] : jsonStr;

    const parsed = JSON.parse(finalStr);

    return {
      comment: String(parsed.comment || '').trim() || '这个画面好有趣~',
      expression: String(parsed.expression || 'neutral')
        .trim()
        .toLowerCase(),
      description: String(parsed.description || '').trim(),
    };
  } catch (err) {
    log.warn('Failed to parse JSON response, using fallback', { err, raw: raw.slice(0, 200) });
    // 降级：直接用原始文本作为评论
    const text = raw.replace(/```json?|```/g, '').trim();
    return {
      comment: text.slice(0, 50) || '这个画面好有趣~',
      expression: 'neutral',
      description: '',
    };
  }
}
