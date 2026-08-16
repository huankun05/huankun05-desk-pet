/**
 * ensureActiveTTSBackend — 活跃 TTS 后端「按需自动拉起」
 *
 * 问题背景：
 *   宠物需要说话时（聊天合成 / 预制台词预热 / 语音通话 / 唤醒回应），
 *   本地 TTS 引擎（CosyVoice 等）后端若没运行，原本会静默跳过合成或调用失败。
 *   后端只由向导手动保存时拉起一次，应用重启后不会自动恢复。
 *
 * 本模块提供统一的"先探测 → 未运行则拉起 → 轮询就绪"逻辑，并解决两个坑：
 *   1) 幂等：Rust 端 service_start_raw 非幂等（会先 kill 同端口旧进程再起新的）。
 *      所以严格"先探后起"；并用 Tauri 命令 service_list 判断端口是否已被本机
 *      任意窗口跟踪，避免跨窗口重复拉起把正在加载的引擎杀掉重来。
 *   2) 就绪准确性：CosyVoice 模型加载约 10~20s，期间 /health 即返回 200 但
 *      model_loaded=false。provider.isAvailable() 已修正为要求模型真正就绪，
 *      故轮询会等到可合成才放行，首句不再卡顿。
 *
 * 调用方（均为 speak 入口）：
 *   - interact-tts.ts  prewarm()        （应用启动预热预制台词）
 *   - pipeline/stages/tts.ts  process() （聊天回复朗读）
 *   - useVoiceCall.ts  playTts()        （QQ 式语音通话回话）
 *   - useWakeWord.ts  playResponse()    （唤醒词"在"回应）
 */

import { providerManager } from './manager';
import { startProviderService, stopProviderServiceById, resolveLaunchSpec } from './serviceLauncher';
import type { TTSProvider } from './types';
import { createLogger } from '../../utils/logger';
import { invoke } from '@tauri-apps/api/core';

const log = createLogger('TTSBackend');

/** 跨调用 / 跨窗口去重：同一时刻只跑一个 ensure 流程，其余复用同一 Promise。 */
let inFlight: Promise<boolean> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface ServiceInfoDTO {
  id: string;
  status: string;
  port: number;
  error?: string;
}

/** 查询 Rust 已跟踪的服务列表（跨进程一致，可判定某端口是否正在启动/运行）。 */
async function queryServiceList(): Promise<ServiceInfoDTO[] | null> {
  try {
    const list = await invoke<ServiceInfoDTO[]>('service_list');
    return list ?? [];
  } catch {
    // 命令调用失败（极少见）→ 不阻塞，交由下方启动逻辑
    return null;
  }
}

/** 该端口是否已被管理后台跟踪（Running/Starting），避免重复拉起杀掉正在加载的引擎。 */
async function isPortAlreadyManaged(port: number): Promise<boolean> {
  const list = await queryServiceList();
  if (!list) return false;
  return list.some(
    (s) =>
      s.port === port &&
      (s.status === 'Running' || s.status === 'Starting' || s.status === 'running' || s.status === 'starting'),
  );
}

/** 探测活跃 TTS provider 当前是否真正可产出（isAvailable 优先，回退 validate）。 */
async function probeReady(provider: TTSProvider): Promise<boolean> {
  try {
    return typeof provider.isAvailable === 'function'
      ? await provider.isAvailable()
      : await provider.validate();
  } catch {
    return false;
  }
}

interface EnsureOptions {
  /** 是否等待后端就绪（拉起后轮询直到可合成）。prewarm/通话用 true；纯触发用 false。 */
  waitReady: boolean;
  /** 等待就绪的最长毫秒数（CosyVoice 首加载约 10~20s，给足余量）。 */
  timeoutMs: number;
}

async function runEnsure(opts: EnsureOptions): Promise<boolean> {
  // 确保 providerManager 配置已加载（prewarm 可能在 init 完成前触发）
  await providerManager.ready;

  const provider = providerManager.getActiveTTSProvider();
  if (!provider) {
    log.warn('ensureActiveTTSBackend: 无活跃 TTS provider，跳过');
    return false;
  }

  // 1) 已就绪：直接放行
  if (await probeReady(provider)) {
    providerManager.markHealthy('tts', provider.config.id);
    return true;
  }

  // 2) 解析启动规格（端口用于 list 探活与去重）
  const cfg = providerManager.getActiveTTSConfig();
  const typeName = cfg?.typeName ?? provider.config.typeName;
  const spec = resolveLaunchSpec(typeName, cfg?.launch);
  const port = spec?.port ?? 0;

  // 3) 端口是否已被跟踪（本窗或其他窗已发起启动）→ 不再重复 POST，直接等就绪
  if (port && (await isPortAlreadyManaged(port))) {
    log.info('ensureActiveTTSBackend: 该端口后端已在启动/运行中，直接等待就绪', { port });
  } else if (port) {
    const started = await startProviderService(typeName, cfg?.launch);
    if (!started) {
      log.warn('ensureActiveTTSBackend: 启动请求未返回 ok（可能端口已占用或命令缺失）', {
        typeName,
        port,
      });
      return false;
    }
    log.info('ensureActiveTTSBackend: 已发起 TTS 后端启动', { typeName, port });
  } else {
    // 无法确定本地端口（如自定义外部服务且无 launch）：无法本地拉起，依赖外部已运行
    log.warn('ensureActiveTTSBackend: 无法确定本地端口，跳过自动启动（期待外部服务已运行）', {
      typeName,
    });
  }

  if (!opts.waitReady) return true;

  // 4) 轮询直到就绪（模型加载完成）
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    await sleep(1000);
    if (await probeReady(provider)) {
      providerManager.markHealthy('tts', provider.config.id);
      return true;
    }
  }
  log.warn('ensureActiveTTSBackend: 等待后端就绪超时', { timeoutMs: opts.timeoutMs, typeName });
  return false;
}

/**
 * 确保活跃 TTS 后端正在运行（未运行则拉起并等待就绪）。
 * 并发安全：同一时刻只跑一个流程，其余调用复用同一结果 Promise。
 *
 * @param waitReady 是否等待后端就绪后再返回（默认 true）
 * @param timeoutMs 等待就绪的最长毫秒数（默认 30000）
 */
export function ensureActiveTTSBackend(opts?: {
  waitReady?: boolean;
  timeoutMs?: number;
}): Promise<boolean> {
  const o: EnsureOptions = {
    waitReady: opts?.waitReady ?? true,
    timeoutMs: opts?.timeoutMs ?? 30000,
  };
  if (!inFlight) {
    inFlight = runEnsure(o).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * 热插拔式切换活跃 TTS 后端（像插拔插件一样）：
 *   卸载旧后端（释放端口与 GPU 显存）→ 拉起新后端。
 * 切换动作本身即时返回（不阻塞 UI）：新模型在后台加载，
 * 首次真正说话时 ensureActiveTTSBackend(waitReady) 会等到它就绪。
 *
 * @param oldPort 切换前旧活跃后端的端口；为 0 表示无旧后端（如首次激活）。
 *                仅当 oldPort 与新后端端口不同时才卸载旧进程，避免误杀自身。
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

  // 1) 卸载旧后端（释放资源）——端口不同才停，否则是在同端口重激活，无需动
  if (oldPort && oldPort !== newPort) {
    const ok = await stopProviderServiceById(`service_${oldPort}`);
    log.info('switchActiveTTSBackend: 已卸载旧 TTS 后端', { oldPort, ok });
  }

  // 2) 拉起/等待新后端。waitReady 默认 false → 切换即时返回，新模型后台加载。
  return ensureActiveTTSBackend({
    waitReady: opts?.waitReady ?? false,
    timeoutMs: opts?.timeoutMs,
  });
}
