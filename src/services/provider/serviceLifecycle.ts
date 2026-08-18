/**
 * serviceLifecycle — 服务生命周期唯一管理者
 *
 * 职责：
 *   - 应用启动时 bootstrapAll()：按当前 TTS 配置自动拉起活跃服务
 *   - 全局去重 + 冷启动保护：同一端口在 N 秒内不重复拉起
 *   - 健康探针：TCP + HTTP 双保险判断端口是否真正可用
 *   - 配置变更时 reloadActive()：只重启变化的部分
 *
 * 设计理念（大脑管理身体）：
 *   只有本模块拥有启动 / 停止 / 重启服务的权限。
 *   任务层只做两件事：
 *     1) 配置阶段告诉 lifecycle 需要什么；
 *     2) 使用前调用 waitReady()，用完不干预。
 */

import { invoke } from '@tauri-apps/api/core';
import { providerManager } from './manager';
import { resolveLaunchSpec } from './serviceLauncher';
import { createLogger } from '../../utils/logger';

const log = createLogger('ServiceLifecycle');

/** 单个端口的运行状态 */
export enum ServicePhase {
  Idle = 'idle', // 尚未尝试启动
  Starting = 'starting', // 正在启动/加载中
  Running = 'running', // 已运行且 /health 通过
  Failed = 'failed', // 启动失败或进程已退出
}

/** 每个本地服务的生命周期记录 */
interface LifecycleRecord {
  phase: ServicePhase;
  /** 就绪 Promise（phase=Starting 时存在，其余为 null） */
  readyPromise: Promise<boolean> | null;
  /** 上次成功启动的时间戳（用于冷启动保护） */
  lastLaunchMs: number;
  /** 最近一次错误信息 */
  lastError?: string;
}

const LAUNCH_COOLDOWN_MS = 4000;
const HEALTH_PROBE_INTERVAL_MS = 1000;
const BOOTSTRAP_TIMEOUT_MS = 30000;

class ServiceLifecycle {
  /** port -> LifecycleRecord */
  private records = new Map<number, LifecycleRecord>();

  /** 应用启动阶段：按当前 TTS 配置自动拉起活跃服务 */
  async bootstrapAll(): Promise<void> {
    await providerManager.ready;

    const cfg = providerManager.getActiveTTSConfig();
    if (!cfg) {
      log.info('bootstrapAll: 无活跃 TTS 配置，跳过');
      return;
    }

    const spec = resolveLaunchSpec(cfg.typeName, cfg.launch);
    const port = spec?.port ?? 0;
    if (!port) {
      log.info('bootstrapAll: 无本地端口，跳过自动启动');
      return;
    }

    log.info('bootstrapAll: 启动 TTS 服务', { typeName: cfg.typeName, port });

    // 委托给 ensureStarted，内部会去重
    await this.ensureStarted(port, () =>
      this.launchTTS({ typeName: cfg.typeName, launch: cfg.launch }),
    );
  }

  /** 核心方法：确保指定端口有服务在运行（全局唯一决策点） */
  async ensureStarted(port: number, launcher: () => Promise<boolean>): Promise<boolean> {
    const existing = this.records.get(port);

    // 1) 已经 Running → 直接放行
    if (existing?.phase === ServicePhase.Running) {
      log.debug('ensureStarted: 已运行，直接放行', { port });
      return true;
    }

    // 2) 正在 Starting → 复用同一 Promise 等待（跨调用去重）
    if (existing?.phase === ServicePhase.Starting) {
      if (existing.readyPromise) {
        log.debug('ensureStarted: 正在启动中，复用 Promise', { port });
        return existing.readyPromise;
      }
      // Starting 但 Promise 丢失（极少见），继续创建新的
    }

    // 3) 冷启动保护：上次启动不到 N 秒，不再拉起，直接轮询
    if (existing && Date.now() - existing.lastLaunchMs < LAUNCH_COOLDOWN_MS) {
      log.info('ensureStarted: 冷启动保护中，等待就绪', {
        port,
        remainingMs: LAUNCH_COOLDOWN_MS - (Date.now() - existing.lastLaunchMs),
      });
      const promise = this.pollReady(port, LAUNCH_COOLDOWN_MS);
      this.records.set(port, {
        phase: ServicePhase.Starting,
        readyPromise: promise,
        lastLaunchMs: existing.lastLaunchMs,
      });
      return promise;
    }

    // 4) 实际探测端口是否已有健康服务（跨窗口去重）
    const healthy = await this.probePortHealth(port);
    if (healthy) {
      log.info('ensureStarted: 端口已有健康服务，直接标记 Running', { port });
      this.records.set(port, {
        phase: ServicePhase.Running,
        readyPromise: null,
        lastLaunchMs: Date.now(),
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
          });
          return false;
        }
        // 启动成功，轮询直到就绪
        return this.pollReady(port, BOOTSTRAP_TIMEOUT_MS);
      })
      .then((ready) => {
        if (ready) {
          this.records.set(port, {
            phase: ServicePhase.Running,
            readyPromise: null,
            lastLaunchMs: Date.now(),
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
        });
        return false;
      });

    this.records.set(port, {
      phase: ServicePhase.Starting,
      readyPromise: promise,
      lastLaunchMs: Date.now(),
    });

    return promise;
  }

  /** 停止指定端口的服务（切换 provider 时由 lifecycle 自己调用） */
  async stop(port: number): Promise<void> {
    const existing = this.records.get(port);
    if (existing?.phase === ServicePhase.Running || existing?.phase === ServicePhase.Starting) {
      try {
        await invoke('service_stop', { serviceId: `service_${port}` });
      } catch {
        // 忽略停止失败（可能已经退出）
      }
    }
    this.records.set(port, {
      phase: ServicePhase.Idle,
      readyPromise: null,
      lastLaunchMs: 0,
    });
  }

  /** 任务层调用：等待指定端口就绪（不触发启动，仅等待） */
  async waitReady(port: number, timeoutMs = 30000): Promise<boolean> {
    const existing = this.records.get(port);
    if (existing?.phase === ServicePhase.Running) {
      return true;
    }
    if (existing?.phase === ServicePhase.Failed) {
      return false;
    }
    // 如果没启动过，不在这里启动，返回 false
    return this.pollReady(port, timeoutMs);
  }

  /** 查询当前是否就绪（同步） */
  isReady(port: number): boolean {
    return this.records.get(port)?.phase === ServicePhase.Running;
  }

  /** 配置变更后重新加载：只重启变化的部分 */
  async reloadActive(): Promise<void> {
    await providerManager.ready;

    const cfg = providerManager.getActiveTTSConfig();
    if (!cfg) return;

    const spec = resolveLaunchSpec(cfg.typeName, cfg.launch);
    const newPort = spec?.port ?? 0;

    if (newPort) {
      const ttsCfg: import('./types').TTSProviderConfig = cfg;
      await this.ensureStarted(newPort, () =>
        this.launchTTS({ typeName: ttsCfg.typeName, launch: ttsCfg.launch }),
      );
    }
  }

  /** 内部：实际调用 Rust 启动 TTS 服务 */
  private async launchTTS(cfg: {
    typeName: string;
    launch: import('./types').ServiceLaunchSpec | undefined;
  }): Promise<boolean> {
    try {
      const { startProviderService } = await import('./serviceLauncher');
      return startProviderService(cfg.typeName, cfg.launch);
    } catch (err) {
      log.error('launchTTS: 启动失败', { typeName: cfg.typeName, error: String(err) });
      return false;
    }
  }

  /** 内部：轮询端口健康状态直到就绪 */
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
          });
        }
        return true;
      }
      await new Promise((r) => setTimeout(r, HEALTH_PROBE_INTERVAL_MS));
    }
    log.warn('pollReady: 等待就绪超时', { port, timeoutMs });
    return false;
  }

  /** 内部：探测端口是否有服务在监听 */
  private async probePortHealth(port: number): Promise<boolean> {
    try {
      const [tcpOk, httpOk] = await Promise.all([
        invoke<boolean>('check_tcp_health', { port }),
        invoke<boolean>('check_http_health', { port }),
      ]);
      return tcpOk || httpOk;
    } catch {
      return false;
    }
  }
}

/** 全局唯一实例（单例） */
export const lifecycle = new ServiceLifecycle();
