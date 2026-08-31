/**
 * 屏幕感知（阶段三，opt-in）：周期截屏 → 视觉模型总结为一行文本观察。
 *
 * 隐私设计（Miru 借鉴项的强化版）：
 * - 默认关闭（config.enabled = false），仅在设置页显式开启
 * - 截图 base64 仅存在于内存中用于一次视觉调用，用后即弃，不落盘、不进账本之外任何持久化
 * - 持久化的只有一行文本观察（localStorage 环形缓冲，上限 10 条）
 * - 观察文本注入主动调度器上下文，让桌宠知道你在做什么（如"还在写代码"）
 */

import { providerManager } from '../provider/manager';
import { recordUsage } from '../provider/usageLedger';
import { captureScreenshot } from '../scenes/watchTogether';
import { createLogger } from '../../utils/logger';
import type { ChatMessage, MessageContentPart } from '../provider/types';

const log = createLogger('ScreenObservation');

const CONFIG_KEY = 'deskpet_screenPerception';
const OBS_KEY = 'deskpet_screenObservations';
const MAX_OBS = 10;

export interface ScreenPerceptionConfig {
  enabled: boolean;
  /** 观察间隔（分钟）5-60 */
  intervalMinutes: number;
}

const DEFAULT_CONFIG: ScreenPerceptionConfig = { enabled: false, intervalMinutes: 15 };

export function getScreenPerceptionConfig(): ScreenPerceptionConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw
      ? { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<ScreenPerceptionConfig>) }
      : { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveScreenPerceptionConfig(config: ScreenPerceptionConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export interface ScreenObservation {
  ts: string;
  text: string;
}

export function getScreenObservations(): ScreenObservation[] {
  try {
    const raw = localStorage.getItem(OBS_KEY);
    return raw ? (JSON.parse(raw) as ScreenObservation[]) : [];
  } catch {
    return [];
  }
}

function pushObservation(text: string): void {
  try {
    const arr = getScreenObservations();
    arr.push({ ts: new Date().toISOString(), text });
    if (arr.length > MAX_OBS) arr.splice(0, arr.length - MAX_OBS);
    localStorage.setItem(OBS_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

/** 观察提示词：要求一行 ≤25 字的屏幕内容概括 */
const OBSERVE_PROMPT =
  '你是桌面宠物。我截取了用户当前屏幕画面。请用一句话（不超过 25 字）概括用户此刻在做什么' +
  '（例如"在写代码""在看视频""在浏览网页"）。只输出概括本身，不要解释。';

/**
 * 观察一次屏幕：截图 → 视觉模型总结 → 存文本观察 → 返回文本。
 *
 * - 图片即用即弃（不落盘）
 * - 无视觉能力 provider 时返回 null（不报错）
 * - 失败静默返回 null，由调用方决定重试节奏
 */
export async function observeScreenOnce(): Promise<string | null> {
  let dataUrl: string;
  try {
    dataUrl = await captureScreenshot();
  } catch (err) {
    log.warn('capture_screenshot failed', err);
    return null;
  }

  const provider =
    providerManager.getActiveVisionProvider() ?? providerManager.getActiveChatProvider();
  if (!provider) {
    log.warn('no vision-capable provider configured');
    return null;
  }

  const contentParts: MessageContentPart[] = [
    { type: 'text', text: OBSERVE_PROMPT },
    { type: 'image_url', image_url: { url: dataUrl } },
  ];
  const messages: ChatMessage[] = [{ role: 'user', content: contentParts }];

  try {
    const text = (await provider.chat(messages, { temperature: 0.2, maxTokens: 60 })).trim();
    if (!text) return null;
    pushObservation(text);
    recordUsage({
      tier: provider.getType() === 'vision' ? 'vision' : 'chat',
      model: provider.config.model,
      callLabel: 'screen_observe',
      promptChars: OBSERVE_PROMPT.length + dataUrl.length,
      completionChars: text.length,
      promptTokens: provider.lastUsage?.promptTokens,
      completionTokens: provider.lastUsage?.completionTokens,
    });
    return text;
  } catch (err) {
    log.warn('screen observation failed', err);
    return null;
  }
}
