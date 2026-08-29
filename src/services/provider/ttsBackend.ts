/**
 * ttsBackend — TTS 后端生命周期委托层
 *
 * 职责：
 *   - 保留旧 API（ensureActiveTTSBackend / switchActiveTTSBackend）兼容调用方
 *   - 启动/停止/切换完全由 ServiceLifecycle 单例管理
 *   - 任务层只检查就绪状态，不再触发启动
 *
 * 设计理念（大脑管理身体）：
 *   - bootstrapAll() 在应用启动时统一拉起所有服务
 *   - 任务层只做两件事：
 *     1) 使用前调用 ensureActiveTTSBackend() 检查是否就绪；
 *     2) 配置切换时调用 switchActiveTTSBackend() 更换服务。
 *   - 任务层不再各自判断要不要启动。
 */

import { providerManager } from './manager';
import { resolveLaunchSpec } from './serviceLauncher';
import { createLogger } from '../../utils/logger';
import { lifecycle } from './serviceLifecycle';

const log = createLogger('TTSBackend');

/** TTS 后端就绪等待上限（ms）。后端不可用时应快速失败，避免阻塞语音与回复。 */
const TTS_READY_TIMEOUT_MS = 10000;

/** 获取活跃 TTS 配置对应的本地端口 */
function getActiveTTSPort(): number {
  const cfg = providerManager.getActiveTTSConfig();
  if (!cfg) return 0;
  const spec = resolveLaunchSpec(cfg.typeName, cfg.launch);
  return spec?.port ?? 0;
}

/**
 * 通过大脑合成语音（完整流程：检查后端 → 等待就绪 → 获取 provider → 合成）。
 * 这是任务层唯一推荐的合成入口，保证服务生命周期由大脑控制。
 */
export async function synthesizeViaBrain(
  text: string,
  opts?: { emotion?: string },
): Promise<{ audio: ArrayBuffer; sampleRate: number } | null> {
  const port = getActiveTTSPort();
  if (!port) {
    log.warn('synthesizeViaBrain: 无活跃 TTS provider，跳过');
    return null;
  }

  // 1. 大脑检查/等待后端就绪（不触发新启动）
  // 超时从 30s 收紧到 10s：后端真没起来时，30s 的等待会阻塞整句合成，
  // 且流式场景下多句并发会叠加成数十秒的卡顿。
  const ready = await lifecycle.waitReady(port, TTS_READY_TIMEOUT_MS);
  if (!ready) {
    log.warn('synthesizeViaBrain: TTS 后端未就绪', { port });
    return null;
  }

  // 2. 获取当前活跃 provider（由大脑管理生命周期）
  const ttsProvider = providerManager.getActiveTTSProvider();
  if (!ttsProvider) {
    log.warn('synthesizeViaBrain: 无可用 TTS Provider');
    return null;
  }

  // 3. 执行合成
  try {
    const result = await ttsProvider.synthesize(text.trim(), {
      emotion: opts?.emotion,
    });
    return result;
  } catch (err) {
    log.error('synthesizeViaBrain: 合成失败', { error: String(err) });
    return null;
  }
}

/**
 * 流式合成（逐 chunk 返回）。
 *
 * 若活跃 provider 支持流式（supportStream() === true，如 CosyVoice / Edge），
 * 走 synthesizeStream 拿到首块即可播放，显著降低「首音延迟」。
 * 流式失败（如老版本服务端无 /tts/stream 端点）自动回退到整段合成，保证不静音。
 * 整段合成也不行（后端真挂了）→ 不产出任何 chunk，由调用方触发熔断。
 *
 * 用于 StreamingTTSPlayer，使「整段合成较慢」的引擎也能边合成边播。
 */
export async function* synthesizeStreamViaBrain(
  text: string,
  opts?: { emotion?: string },
): AsyncGenerator<{ audio: ArrayBuffer; sampleRate: number }, void, unknown> {
  const port = getActiveTTSPort();
  if (!port) {
    log.warn('synthesizeStreamViaBrain: 无活跃 TTS provider，跳过');
    return;
  }
  const ready = await lifecycle.waitReady(port, TTS_READY_TIMEOUT_MS);
  if (!ready) {
    log.warn('synthesizeStreamViaBrain: TTS 后端未就绪', { port });
    return;
  }
  const ttsProvider = providerManager.getActiveTTSProvider();
  if (!ttsProvider) {
    log.warn('synthesizeStreamViaBrain: 无可用 TTS Provider');
    return;
  }

  const sampleRate = ttsProvider.config.sampleRate ?? 24000;
  const trimmed = text.trim();

  try {
    if (ttsProvider.supportStream()) {
      let streamed = 0;
      try {
        for await (const chunk of ttsProvider.synthesizeStream(trimmed, {
          emotion: opts?.emotion,
        })) {
          if (!chunk || chunk.byteLength === 0) continue;
          streamed += 1;
          yield { audio: chunk, sampleRate };
        }
      } catch (streamErr) {
        log.warn('synthesizeStreamViaBrain: 流式失败，回退整段合成', { error: String(streamErr) });
      }
      // 流式至少产出过一块 → 视为成功，不再整段回退（避免重复音频）
      if (streamed > 0) return;
    }
    // 不支持流式，或流式失败 → 整段合成兜底
    const res = await ttsProvider.synthesize(trimmed, { emotion: opts?.emotion });
    if (res) yield res;
  } catch (err) {
    log.error('synthesizeStreamViaBrain: 合成失败', { error: String(err) });
  }
}

/**
 * 确保活跃 TTS 后端正在运行（委托给 ServiceLifecycle）。
 * 注意：启动决策由 lifecycle.bootstrapAll() 在应用启动时统一做出。
 * 本函数仅用于任务层检查/等待就绪，不再触发新的启动流程。
 */
export function ensureActiveTTSBackend(opts?: {
  waitReady?: boolean;
  timeoutMs?: number;
}): Promise<boolean> {
  const port = getActiveTTSPort();
  if (!port) {
    log.warn('ensureActiveTTSBackend: 无活跃 TTS provider，跳过');
    return Promise.resolve(false);
  }

  const waitReady = opts?.waitReady ?? true;
  const timeoutMs = opts?.timeoutMs ?? TTS_READY_TIMEOUT_MS;

  // 仅检查/等待，不触发启动
  if (waitReady) {
    return lifecycle.waitReady(port, timeoutMs);
  }
  return Promise.resolve(lifecycle.isReady(port));
}

/**
 * 热插拔式切换活跃 TTS 后端（委托给 ServiceLifecycle）。
 * 这是唯一允许任务层触发启动的场景（配置变更）。
 */
export async function switchActiveTTSBackend(
  oldPort = 0,
  opts?: { waitReady?: boolean; timeoutMs?: number },
): Promise<boolean> {
  await providerManager.ready;

  const cfg = providerManager.getActiveTTSConfig();
  const fallbackType = providerManager.getActiveTTSProvider()?.config.typeName ?? '';
  const typeName = cfg?.typeName ?? fallbackType;
  const spec = resolveLaunchSpec(typeName, cfg?.launch);
  const newPort = spec?.port ?? 0;

  // 1) 卸载旧后端（释放资源）——端口不同才停
  if (oldPort && oldPort !== newPort) {
    await lifecycle.stop(oldPort);
    log.info('switchActiveTTSBackend: 已卸载旧 TTS 后端', { oldPort });
  }

  // 2) 拉起新后端（委托给 lifecycle）——这是唯一允许任务层触发启动的场景
  if (!newPort) {
    log.warn('switchActiveTTSBackend: 无法确定新后端端口', { typeName, newPort });
    return false;
  }

  // 使用大脑的 launchService 真正启动服务
  const launcher = cfg ? () => lifecycle.launchService(typeName, 'tts') : null;
  if (!launcher) {
    log.warn('switchActiveTTSBackend: 无有效配置', { typeName });
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
