/**
 * sttBackend — STT 后端生命周期委托层
 *
 * 职责：
 *   - 保留旧 API（ensureActiveSTTBackend）兼容调用方
 *   - 启动/停止/切换完全由 ServiceLifecycle 单例管理
 *   - 任务层只检查就绪状态，不再触发启动
 *
 * 设计理念（大脑管理身体）：
 *   - bootstrapAll() 在应用启动时统一拉起所有服务
 *   - 任务层只做两件事：
 *     1) 使用前调用 transcribeViaBrain() 进行识别；
 *     2) 配置切换时调用 switchActiveSTTBackend() 更换服务。
 *   - 任务层不再各自判断要不要启动。
 */

import { providerManager } from './manager';
import { resolveLaunchSpec } from './serviceLauncher';
import { createLogger } from '../../utils/logger';
import { lifecycle } from './serviceLifecycle';
import { AudioRecorder } from '../audio/recorder';
import { StreamingSTTClient } from '../audio/streaming-stt';

const log = createLogger('STTBackend');

/** 获取活跃 STT 配置对应的本地端口 */
function getActiveSTTPort(): number {
  const cfg = providerManager.getActiveSTTConfig();
  if (!cfg) return 0;
  const spec = resolveLaunchSpec(cfg.typeName, cfg.launch);
  return spec?.port ?? 0;
}

/**
 * 通过大脑识别语音（完整流程：检查后端 → 等待就绪 → 获取 provider → 识别）。
 * 这是任务层唯一推荐的识别入口，保证服务生命周期由大脑控制。
 */
export async function transcribeViaBrain(
  audio: ArrayBuffer,
  format: string = 'wav',
): Promise<{ text: string; emotion?: string } | null> {
  const port = getActiveSTTPort();
  if (!port) {
    log.warn('transcribeViaBrain: 无活跃 STT provider，跳过');
    return null;
  }

  // 1. 大脑检查/等待后端就绪（不触发新启动）
  const ready = await lifecycle.waitReady(port, 30000);
  if (!ready) {
    log.warn('transcribeViaBrain: STT 后端未就绪', { port });
    return null;
  }

  // 2. 获取当前活跃 provider（由大脑管理生命周期）
  const sttProvider = providerManager.getActiveSTTProvider();
  if (!sttProvider) {
    log.warn('transcribeViaBrain: 无可用 STT Provider');
    return null;
  }

  // 3. 执行识别
  try {
    const result = await sttProvider.transcribe(audio, format);
    return result;
  } catch (err) {
    log.error('transcribeViaBrain: 识别失败', { error: String(err) });
    return null;
  }
}

/**
 * 确保活跃 STT 后端正在运行（委托给 ServiceLifecycle）。
 * 注意：启动决策由 lifecycle.bootstrapAll() 在应用启动时统一做出。
 * 本函数仅用于任务层检查/等待就绪，不再触发新的启动流程。
 */
export function ensureActiveSTTBackend(opts?: {
  waitReady?: boolean;
  timeoutMs?: number;
}): Promise<boolean> {
  const port = getActiveSTTPort();
  if (!port) {
    log.warn('ensureActiveSTTBackend: 无活跃 STT provider，跳过');
    return Promise.resolve(false);
  }

  const waitReady = opts?.waitReady ?? true;
  const timeoutMs = opts?.timeoutMs ?? 30000;

  // 仅检查/等待，不触发启动
  if (waitReady) {
    return lifecycle.waitReady(port, timeoutMs);
  }
  return Promise.resolve(lifecycle.isReady(port));
}

/**
 * 热插拔式切换活跃 STT 后端（委托给 ServiceLifecycle）。
 * 这是唯一允许任务层触发启动的场景（配置变更）。
 */
export async function switchActiveSTTBackend(
  oldPort = 0,
  opts?: { waitReady?: boolean; timeoutMs?: number },
): Promise<boolean> {
  await providerManager.ready;

  const cfg = providerManager.getActiveSTTConfig();
  const fallbackType = providerManager.getActiveSTTProvider()?.config.typeName ?? '';
  const typeName = cfg?.typeName ?? fallbackType;
  const spec = resolveLaunchSpec(typeName, cfg?.launch);
  const newPort = spec?.port ?? 0;

  // 1) 卸载旧后端（释放资源）——端口不同才停
  if (oldPort && oldPort !== newPort) {
    await lifecycle.stop(oldPort);
    log.info('switchActiveSTTBackend: 已卸载旧 STT 后端', { oldPort });
  }

  // 2) 拉起新后端（委托给 lifecycle）——这是唯一允许任务层触发启动的场景
  if (!newPort) {
    log.warn('switchActiveSTTBackend: 无法确定新后端端口', { typeName, newPort });
    return false;
  }

  // 使用大脑的 launchService 真正启动服务
  const launcher = cfg ? () => lifecycle.launchService(typeName, 'stt') : null;
  if (!launcher) {
    log.warn('switchActiveSTTBackend: 无有效配置', { typeName });
    return false;
  }

  const started = await lifecycle.ensureStarted(newPort, launcher);
  if (!started) return false;

  // waitReady 默认 false → 切换即时返回
  if (opts?.waitReady ?? false) {
    return lifecycle.waitReady(newPort, opts?.timeoutMs ?? 30000);
  }
  return true;
}

/**
 * 判断识别文本是否为「可用的语音输入」，用于过滤环境噪音/回声被误识别的短文本。
 *
 * 实测场景：聆听起始阶段若录音很快静音停止（如阈值过低），只录到 0.66s 噪音，
 * SenseVoice 会误识别出 "Yeah."、"." 等——若当作用户消息发给 LLM，会引发
 * 「AI 回『我在呢』→ 再聆听 → 再误识别」的循环。
 *
 * 规则：
 *  - 去掉标点/空白后为空 → 无效
 *  - 含中文字符：至少 2 个字符（过滤单字「嗯」「啊」类误识别）
 *  - 纯英文/数字：至少 6 个字符（过滤 "Yeah" 等短英文误识别；中文场景可接受）
 */
export function isValidSpeechText(text: string): boolean {
  const t = (text || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  if (!t) return false;
  const hasCjk = /[\u4e00-\u9fa5]/.test(t);
  if (hasCjk) return t.length >= 2;
  return t.length >= 6;
}

/**
 * 语音识别结果智能润色：用活跃 Chat LLM 纠正同音错字、去掉重复表达，并结合上下文
 * 理解意图（如 AI 工具语境下的 "cloud" 应纠正为 "claude"）。
 *
 * 参考主流语音输入产品（讯飞输入法智能纠错 / Azure Speech 后处理 / Whisper 客户端）
 * 的一致做法：识别文本 → 轻量 LLM/规则后处理 → 语义修正。本函数失败/超时返回原文，
 * 不阻塞主链路；仅在调用方确认开关开启后调用。
 *
 * @param text 待润色的识别文本
 * @param context 最近对话上下文（用户消息，供理解专有名词/话题）
 */
export async function polishSTTText(text: string, context?: string[]): Promise<string> {
  const t = (text || '').trim();
  if (!t) return text;
  const chatProvider = providerManager.getActiveChatProvider();
  if (!chatProvider) {
    log.debug('polishSTTText: 无活跃 Chat Provider，返回原文');
    return text;
  }
  const ctxBlock =
    context && context.length > 0
      ? `\n最近对话上下文（仅用于理解话题与专有名词）：\n${context.slice(-6).join('\n')}`
      : '';
  const prompt = `你是语音识别后处理助手。语音识别出的文本可能有同音错字、断句错误、重复词。请纠正为最可能的正确表达：
1. 保持原意、语气与口语感，不扩写、不缩写、不改写内容
2. 专有名词结合上下文纠正（例如 AI 工具语境下的 "cloud" 应为 "claude"）
3. 去掉明显的重复表达（如"嗯嗯""好的好的"保留单次即可）
4. 只输出纠正后的文本本身，不要任何解释、引号或前后缀
${ctxBlock}

待纠正文本：
${t}`;
  try {
    const result = await chatProvider.chat(
      [{ role: 'system', content: prompt }],
      { temperature: 0.3, maxTokens: 300 },
    );
    const cleaned = (result || '').trim();
    return cleaned && cleaned.length >= 1 ? cleaned : text;
  } catch (err) {
    log.warn('polishSTTText 失败，返回原文', { error: String(err) });
    return text;
  }
}

/**
 * 启动流式 STT 会话：建立 WebSocket 连接并把录音器的 PCM 帧推给服务端，
 * 边说边识别（partial 经 onPartial 回调透传），停止时由调用方调用 finish() 取最终结果。
 *
 * 返回 null 表示 WebSocket 不可用/连接失败，调用方应回退到 transcribeViaBrain（整段识别）。
 * 调用方负责在合适时机调用 finish() 与 dispose()。
 */
export interface StreamingSTTHandle {
  /** 结束流式、返回最终结果；null 表示流式中断，调用方应回退整段识别 */
  finish: (timeoutMs?: number) => Promise<{ text: string; emotion?: string } | null>;
  dispose: () => void;
}

export async function startStreamingSTT(
  recorder: AudioRecorder,
  opts: { onPartial?: (text: string) => void; engine?: string } = {},
): Promise<StreamingSTTHandle | null> {
  const cfg = providerManager.getActiveSTTConfig();
  if (!cfg) {
    log.warn('startStreamingSTT: 无活跃 STT provider');
    return null;
  }
  const provider = providerManager.getActiveSTTProvider();
  const apiBase = provider?.config.apiBase;
  if (!apiBase) {
    log.warn('startStreamingSTT: provider 无 apiBase，回退整段识别');
    return null;
  }
  const engine = opts.engine ?? (cfg.typeName === 'sensevoice' ? 'sensevoice' : 'funasr');

  const client = new StreamingSTTClient(apiBase, engine);
  if (opts.onPartial) client.onPartial(opts.onPartial);

  try {
    await client.connect();
  } catch (err) {
    log.warn('startStreamingSTT: WS 连接失败，回退整段识别', { error: String(err) });
    client.dispose();
    return null;
  }

  // 接管录音器的 onAudioChunk，把 PCM 帧推流（保存旧回调以便恢复）
  const prevOnChunk = recorder.onAudioChunk;
  recorder.onAudioChunk = (f32: Float32Array) => client.pushFloat32(f32);

  return {
    finish: async (timeoutMs = 8000) => {
      const final = await client.end(timeoutMs);
      return final ? { text: final.text, emotion: final.emotion } : null;
    },
    dispose: () => {
      recorder.onAudioChunk = prevOnChunk;
      client.dispose();
    },
  };
}
