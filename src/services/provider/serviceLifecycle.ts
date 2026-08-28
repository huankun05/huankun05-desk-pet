/**
 * serviceLifecycle — 资源感知的服务生命周期大脑
 *
 * 职责：
 *   - 应用启动时 bootstrapAll()：按优先级 + 资源预算分批拉起服务
 *   - 全局去重 + 冷启动保护
 *   - 健康探针：TCP + HTTP 双保险
 *   - 配置变更时 reloadActive()
 *
 * 设计理念（大脑管理身体）：
 *   不是简单的同时拉起所有服务，而是：
 *   1) 评估当前系统资源（CPU/GPU/内存）
 *   2) 按服务优先级排序
 *   3) 在资源预算内分批启动
 *   4) 资源紧张时降级非关键服务
 */

import { invoke } from '@tauri-apps/api/core';
import { providerManager } from './manager';
import { resolveLaunchSpec } from './serviceLauncher';
import { createLogger } from '../../utils/logger';

const log = createLogger('ServiceLifecycle');

// ============================================================
// 类型定义
// ============================================================

/** 单个端口的运行状态 */
export enum ServicePhase {
  Idle = 'idle',
  Starting = 'starting',
  Running = 'running',
  Failed = 'failed',
}

/** 服务资源画像 */
interface ServiceResourceProfile {
  /** 预估 CPU 占用百分比 */
  estimatedCpuPercent: number;
  /** 预估 GPU 显存占用 MB */
  estimatedGpuMb: number;
  /** 预估内存占用 MB */
  estimatedMemoryMb: number;
  /** 典型启动时间 ms */
  startupTimeMs: number;
  /** 是否应该保持运行（不自动停止） */
  keepAlive: boolean;
  /** 优先级（数字越小越优先，0 = 最高） */
  priority: number;
}

/** 系统资源快照 */
interface _SystemResourceSnapshot {
  cpuPercent: number;
  memoryPercent: number;
  gpuMemoryUsedMb: number;
  gpuMemoryTotalMb: number;
}

/** 服务配置 */
interface ServiceConfig {
  typeName: string;
  port: number;
  kind: 'tts' | 'stt' | 'embedding';
}

// ============================================================
// 资源画像注册表
// ============================================================

const RESOURCE_PROFILES: Record<string, ServiceResourceProfile> = {
  // TTS
  cosyvoice: {
    estimatedCpuPercent: 30,
    estimatedGpuMb: 2048,
    estimatedMemoryMb: 1024,
    startupTimeMs: 8000,
    keepAlive: true,
    priority: 10,
  },
  'edge-tts': {
    estimatedCpuPercent: 5,
    estimatedGpuMb: 0,
    estimatedMemoryMb: 64,
    startupTimeMs: 500,
    keepAlive: true,
    priority: 10,
  },
  gpt_sovits: {
    estimatedCpuPercent: 30,
    estimatedGpuMb: 2048,
    estimatedMemoryMb: 2048,
    startupTimeMs: 20000,
    keepAlive: true,
    priority: 10,
  },
  // STT
  funasr: {
    estimatedCpuPercent: 25,
    estimatedGpuMb: 1024,
    estimatedMemoryMb: 512,
    startupTimeMs: 5000,
    keepAlive: false,
    priority: 20,
  },
  sensevoice: {
    estimatedCpuPercent: 20,
    estimatedGpuMb: 1024,
    estimatedMemoryMb: 512,
    startupTimeMs: 4000,
    keepAlive: false,
    priority: 20,
  },
  // Embedding
  'ollama-embedding': {
    estimatedCpuPercent: 15,
    estimatedGpuMb: 512,
    estimatedMemoryMb: 256,
    startupTimeMs: 3000,
    keepAlive: false,
    priority: 30,
  },
};

/** 获取服务的资源画像 */
function getProfile(typeName: string): ServiceResourceProfile {
  return (
    RESOURCE_PROFILES[typeName] || {
      estimatedCpuPercent: 10,
      estimatedGpuMb: 0,
      estimatedMemoryMb: 128,
      startupTimeMs: 2000,
      keepAlive: false,
      priority: 50,
    }
  );
}

// ============================================================
// 资源预算
// ============================================================

const RESOURCE_BUDGET = {
  /** CPU 占用上限（百分比） */
  maxCpuPercent: 60,
  /** GPU 显存上限（MB） */
  maxGpuMb: 4096,
  /** 内存上限（MB） */
  maxMemoryMb: 2048,
  /** 每批启动间隔（ms） */
  batchIntervalMs: 2000,
};

/** 估算当前系统可用资源（简化版：基于已启动服务的累计估算） */
function _estimateAvailableBudget(): { cpu: number; gpu: number; memory: number } {
  let usedCpu = 0;
  let usedGpu = 0;
  let usedMemory = 0;

  for (const record of lifecycle.records.values()) {
    if (record.phase === ServicePhase.Running || record.phase === ServicePhase.Starting) {
      // 从配置中获取资源占用（简化：直接累加）
      // 实际应该缓存每个端口的 profile
    }
  }

  return {
    cpu: RESOURCE_BUDGET.maxCpuPercent - usedCpu,
    gpu: RESOURCE_BUDGET.maxGpuMb - usedGpu,
    memory: RESOURCE_BUDGET.maxMemoryMb - usedMemory,
  };
}

/** 检查是否有足够资源启动新服务 */
function _canAfford(
  profile: ServiceResourceProfile,
  budget: { cpu: number; gpu: number; memory: number },
): boolean {
  return (
    profile.estimatedCpuPercent <= budget.cpu &&
    profile.estimatedGpuMb <= budget.gpu &&
    profile.estimatedMemoryMb <= budget.memory
  );
}

// ============================================================
// LifecycleRecord
// ============================================================

interface LifecycleRecord {
  phase: ServicePhase;
  readyPromise: Promise<boolean> | null;
  lastLaunchMs: number;
  lastError?: string;
  /** 资源画像缓存 */
  profile: ServiceResourceProfile;
}

// ============================================================
// ServiceLifecycle 主类
// ============================================================

class ServiceLifecycle {
  /** port -> LifecycleRecord */
  records = new Map<number, LifecycleRecord>();

  /**
   * 同一端口 in-flight 的就绪轮询，用于并发去重。
   *
   * 背景：流式 TTS 会对每个句子并发调用 waitReady()，若不 dedupe，
   * N 个句子会同时起 N 个轮询，每个每秒 2 次 Tauri IPC（Rust 侧是同步
   * 阻塞探测），形成 IPC 风暴，直接拖垮 webview（输入框卡顿、回复变慢）。
   */
  private pollPromises = new Map<number, Promise<boolean>>();

  /**
   * 端口最近一次探测失败的时间戳，用于失败冷却（negative caching）。
   * 冷却期内 waitReady 直接返回 false，不再发起探测，避免反复轮询一个
   * 已经确认不可用的服务。
   */
  private lastFailedAt = new Map<number, number>();

  private readonly LAUNCH_COOLDOWN_MS = 4000;
  private readonly HEALTH_PROBE_INTERVAL_MS = 1000;
  private readonly BOOTSTRAP_TIMEOUT_MS = 30000;
  /** 探测失败后的冷却时长：冷却期内不再重复探测（防止 IPC 风暴） */
  private readonly FAILURE_COOLDOWN_MS = 15000;

  // ============================================================
  // 应用启动：分批、按优先级、资源感知
  // ============================================================

  async bootstrapAll(): Promise<void> {
    await providerManager.ready;

    const configs = this.collectActiveServiceConfigs();
    if (configs.length === 0) {
      log.info('bootstrapAll: 无活跃服务配置，跳过');
      return;
    }

    log.info('bootstrapAll: 收集到活跃服务', {
      count: configs.length,
      ports: configs.map((c) => c.port),
      kinds: configs.map((c) => c.kind),
    });

    // 1) 按优先级排序
    configs.sort((a, b) => {
      const pa = getProfile(a.typeName).priority;
      const pb = getProfile(b.typeName).priority;
      return pa - pb;
    });

    // 2) 分批启动（每批间隔，避免瞬间资源峰值）
    const batches: ServiceConfig[][] = [];
    let currentBatch: ServiceConfig[] = [];
    let currentCpu = 0;
    let currentGpu = 0;
    let currentMemory = 0;

    for (const cfg of configs) {
      const profile = getProfile(cfg.typeName);

      // 检查是否能加入当前批次
      const canFit =
        currentCpu + profile.estimatedCpuPercent <= RESOURCE_BUDGET.maxCpuPercent &&
        currentGpu + profile.estimatedGpuMb <= RESOURCE_BUDGET.maxGpuMb &&
        currentMemory + profile.estimatedMemoryMb <= RESOURCE_BUDGET.maxMemoryMb;

      if (canFit) {
        currentBatch.push(cfg);
        currentCpu += profile.estimatedCpuPercent;
        currentGpu += profile.estimatedGpuMb;
        currentMemory += profile.estimatedMemoryMb;
      } else {
        // 当前批次已满，保存并开始新批次
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
        }
        currentBatch = [cfg];
        currentCpu = profile.estimatedCpuPercent;
        currentGpu = profile.estimatedGpuMb;
        currentMemory = profile.estimatedMemoryMb;
      }
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    log.info('bootstrapAll: 分批计划', {
      totalBatches: batches.length,
      batches: batches.map((b) => b.map((c) => c.port)),
    });

    // 3) 逐批启动
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      log.info(`bootstrapAll: 启动批次 ${i + 1}/${batches.length}`, {
        ports: batch.map((c) => c.port),
        kinds: batch.map((c) => c.kind),
      });

      await Promise.all(
        batch.map((cfg) =>
          this.ensureStarted(cfg.port, () => this.launchService(cfg.typeName, cfg.kind)),
        ),
      );

      // 批次之间等待，让系统喘息
      if (i < batches.length - 1) {
        await new Promise((r) => setTimeout(r, RESOURCE_BUDGET.batchIntervalMs));
      }
    }

    log.info('bootstrapAll: 所有批次启动完成');
  }

  // ============================================================
  // 核心方法：确保指定端口有服务在运行
  // ============================================================

  async ensureStarted(port: number, launcher: () => Promise<boolean>): Promise<boolean> {
    const existing = this.records.get(port);

    // 1) 已经 Running → 直接放行
    if (existing?.phase === ServicePhase.Running) {
      log.debug('ensureStarted: 已运行，直接放行', { port });
      return true;
    }

    // 2) 正在 Starting → 复用同一 Promise
    if (existing?.phase === ServicePhase.Starting) {
      if (existing.readyPromise) {
        log.debug('ensureStarted: 正在启动中，复用 Promise', { port });
        return existing.readyPromise;
      }
    }

    // 3) 冷启动保护
    if (existing && Date.now() - existing.lastLaunchMs < this.LAUNCH_COOLDOWN_MS) {
      log.info('ensureStarted: 冷启动保护中', { port });
      const promise = this.pollReady(port, this.LAUNCH_COOLDOWN_MS);
      this.records.set(port, {
        phase: ServicePhase.Starting,
        readyPromise: promise,
        lastLaunchMs: existing.lastLaunchMs,
        profile: existing.profile,
      });
      return promise;
    }

    // 4) 探测端口是否已有健康服务
    const healthy = await this.probePortHealth(port);
    if (healthy) {
      log.info('ensureStarted: 端口已有健康服务', { port });
      this.records.set(port, {
        phase: ServicePhase.Running,
        readyPromise: null,
        lastLaunchMs: Date.now(),
        profile: existing?.profile || this.getDefaultProfile(port),
      });
      return true;
    }

    // 5) 真正启动
    log.info('ensureStarted: 发起启动', { port });
    const promise = launcher()
      .then((started) => {
        if (!started) {
          this.records.set(port, {
            phase: ServicePhase.Failed,
            readyPromise: null,
            lastLaunchMs: Date.now(),
            lastError: '启动请求返回 false',
            profile: existing?.profile || this.getDefaultProfile(port),
          });
          return false;
        }
        return this.pollReady(port, this.BOOTSTRAP_TIMEOUT_MS);
      })
      .then((ready) => {
        if (ready) {
          this.records.set(port, {
            phase: ServicePhase.Running,
            readyPromise: null,
            lastLaunchMs: Date.now(),
            profile: existing?.profile || this.getDefaultProfile(port),
          });
        }
        return ready;
      })
      .catch((err) => {
        log.error('ensureStarted: 启动异常', { port, error: String(err) });
        this.records.set(port, {
          phase: ServicePhase.Failed,
          readyPromise: null,
          lastLaunchMs: Date.now(),
          lastError: String(err),
          profile: existing?.profile || this.getDefaultProfile(port),
        });
        return false;
      });

    this.records.set(port, {
      phase: ServicePhase.Starting,
      readyPromise: promise,
      lastLaunchMs: Date.now(),
      profile: existing?.profile || this.getDefaultProfile(port),
    });

    return promise;
  }

  // ============================================================
  // 停止 / 等待 / 查询
  // ============================================================

  async stop(port: number): Promise<void> {
    const existing = this.records.get(port);
    if (existing?.phase === ServicePhase.Running || existing?.phase === ServicePhase.Starting) {
      try {
        await invoke('service_stop', { serviceId: `service_${port}` });
      } catch {
        // 忽略停止失败
      }
    }
    this.records.set(port, {
      phase: ServicePhase.Idle,
      readyPromise: null,
      lastLaunchMs: 0,
      profile: existing?.profile || this.getDefaultProfile(port),
    });
  }

  async waitReady(port: number, timeoutMs = 30000): Promise<boolean> {
    const existing = this.records.get(port);
    if (existing?.phase === ServicePhase.Running) return true;
    if (existing?.phase === ServicePhase.Failed) return false;

    // 失败冷却：短时间内刚确认不可用，直接返回 false，不再发起探测。
    // 这是防止「服务挂掉后每句话都轮询 30 秒」的关键闸门。
    const failedAt = this.lastFailedAt.get(port) ?? 0;
    if (Date.now() - failedAt < this.FAILURE_COOLDOWN_MS) {
      return false;
    }

    // 并发去重：同一端口复用同一个 in-flight 轮询，N 个并发调用只探测一轮
    const inflight = this.pollPromises.get(port);
    if (inflight) return inflight;

    const promise = this.pollReady(port, timeoutMs).finally(() => {
      this.pollPromises.delete(port);
    });
    this.pollPromises.set(port, promise);
    return promise;
  }

  isReady(port: number): boolean {
    return this.records.get(port)?.phase === ServicePhase.Running;
  }

  // ============================================================
  // 配置变更后重新加载
  // ============================================================

  async reloadActive(): Promise<void> {
    await providerManager.ready;

    const newConfigs = this.collectActiveServiceConfigs();
    const newPorts = new Set(newConfigs.map((c) => c.port));

    // 停止不再活跃的服务
    for (const [port] of this.records) {
      if (!newPorts.has(port)) {
        await this.stop(port);
      }
    }

    // 启动新配置的服务
    for (const cfg of newConfigs) {
      await this.ensureStarted(cfg.port, () => this.launchService(cfg.typeName, cfg.kind));
    }
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /** 收集当前需要本地服务进程的活跃配置（按 kind 分类） */
  private collectActiveServiceConfigs(): ServiceConfig[] {
    const configs: ServiceConfig[] = [];

    const ttsCfg = providerManager.getActiveTTSConfig();
    if (ttsCfg) {
      const spec = resolveLaunchSpec(ttsCfg.typeName, ttsCfg.launch);
      if (spec?.port) {
        configs.push({ typeName: ttsCfg.typeName, port: spec.port, kind: 'tts' });
      }
    }

    const sttCfg = providerManager.getActiveSTTConfig();
    if (sttCfg) {
      const spec = resolveLaunchSpec(sttCfg.typeName, sttCfg.launch);
      if (spec?.port) {
        configs.push({ typeName: sttCfg.typeName, port: spec.port, kind: 'stt' });
      }
    }

    const embCfg = providerManager.getActiveEmbeddingConfig();
    if (embCfg?.typeName) {
      const spec = resolveLaunchSpec(embCfg.typeName, embCfg.launch);
      if (spec?.port) {
        configs.push({ typeName: embCfg.typeName, port: spec.port, kind: 'embedding' });
      }
    }

    return configs;
  }

  /** 启动服务（供 ttsBackend 等委托层调用） */
  async launchService(typeName: string, kind: string): Promise<boolean> {
    try {
      const { startProviderService } = await import('./serviceLauncher');
      return startProviderService(typeName);
    } catch (err) {
      log.error('launchService: 启动失败', { kind, typeName, error: String(err) });
      return false;
    }
  }

  /** 轮询端口健康状态 */
  private async pollReady(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.probePortHealth(port)) {
        const record = this.records.get(port);
        if (record && record.phase !== ServicePhase.Failed) {
          this.records.set(port, {
            phase: ServicePhase.Running,
            readyPromise: null,
            lastLaunchMs: record.lastLaunchMs,
            profile: record.profile,
          });
        }
        return true;
      }
      await new Promise((r) => setTimeout(r, this.HEALTH_PROBE_INTERVAL_MS));
    }
    log.warn('pollReady: 等待就绪超时', { port, timeoutMs });
    this.lastFailedAt.set(port, Date.now());
    return false;
  }

  /** 探测端口健康 */
  private async probePortHealth(port: number): Promise<boolean> {
    try {
      // 先做轻量 TCP 探活；成功即视为健康。
      // 原实现每次都并发发两个 IPC，而 Rust 侧是同步阻塞探测（各 500ms 超时），
      // 高频轮询时代价被成倍放大。改为串行短路后，服务在跑时只需 1 次 IPC。
      const tcpOk = await invoke<boolean>('check_tcp_health', { port });
      if (tcpOk) return true;
      return await invoke<boolean>('check_http_health', { port });
    } catch {
      return false;
    }
  }

  /** 默认资源画像：端口 → 引擎名（端口与 serviceLauncher 的 launch spec 保持一致） */
  private getDefaultProfile(port: number): ServiceResourceProfile {
    if (port === 8001) return getProfile('edge-tts');
    if (port === 8002) return getProfile('funasr');
    if (port === 8003) return getProfile('cosyvoice');
    if (port === 9880) return getProfile('gpt_sovits');
    return getProfile('default');
  }
}

/** 全局唯一实例（单例） */
export const lifecycle = new ServiceLifecycle();
