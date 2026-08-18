/**
 * ttsBackend — TTS 后端生命周期委托层
 *
 * 职责：
 *   - 保留旧 API（ensureActiveTTSBackend / switchActiveTTSBackend）兼容调用方
 *   - 所有启动/停止/等待逻辑委托给 ServiceLifecycle 单例
 *   - 任务层不再各自判断要不要启动，统一由 lifecycle 管理
 *
 * 调用方（无需修改）：
 *   - interact-tts.ts  prewarm()
 *   - pipeline/stages/tts.ts  process()
 *   - useVoiceCall.ts  playTts()
 *   - useWakeWord.ts  playResponse()
 *   - useWatchTogether.ts
 *   - InteractionPage.tsx
 *   - TTSPage.tsx
 */

import { providerManager } from './manager';
import { resolveLaunchSpec } from './serviceLauncher';
import { createLogger } from '../../utils/logger';
import { lifecycle } from './serviceLifecycle';

const log = createLogger('TTSBackend');

/** 获取活跃 TTS 配置对应的本地端口 */
function getActiveTTSPort(): number {
  const cfg = providerManager.getActiveTTSConfig();
  const provider = providerManager.getActiveTTSProvider();
  if (!cfg || !provider) return 0;
  const spec = resolveLaunchSpec(cfg.typeName, cfg.launch);
  return spec?.port ?? 0;
}

/** 获取启动器函数（用于 lifecycle.ensureStarted） */
function getActiveTTSLauncher(): (() => Promise<boolean>) | null {
  const cfg = providerManager.getActiveTTSConfig();
  if (!cfg) return null;
  return () =>
    import('./serviceLauncher').then((m) => m.startProviderService(cfg.typeName, cfg.launch));
}

/**
 * 确保活跃 TTS 后端正在运行（委托给 ServiceLifecycle）。
 * 旧 API 兼容：waitReady=true 时等待就绪，false 时只发起启动。
 */
export function ensureActiveTTSBackend(opts?: {
  waitReady?: boolean;
  timeoutMs?: number;
}): Promise<boolean> {
  const port = getActiveTTSPort();
  const launcher = getActiveTTSLauncher();
  if (!port || !launcher) {
    log.warn('ensureActiveTTSBackend: 无活跃 TTS provider，跳过');
    return Promise.resolve(false);
  }

  const waitReady = opts?.waitReady ?? true;
  const timeoutMs = opts?.timeoutMs ?? 30000;

  // 委托给 lifecycle：启动决策由 lifecycle 统一管理
  return lifecycle.ensureStarted(port, launcher).then((started) => {
    if (!started) return false;
    if (!waitReady) return true;
    return lifecycle.waitReady(port, timeoutMs);
  });
}

/**
 * 热插拔式切换活跃 TTS 后端（委托给 ServiceLifecycle）。
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

  // 2) 拉起新后端（委托给 lifecycle）
  const launcher = cfg
    ? () => import('./serviceLauncher').then((m) => m.startProviderService(typeName, cfg.launch))
    : null;
  if (!launcher || !newPort) {
    log.warn('switchActiveTTSBackend: 无法确定新后端端口', { typeName, newPort });
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
