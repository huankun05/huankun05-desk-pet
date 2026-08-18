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
