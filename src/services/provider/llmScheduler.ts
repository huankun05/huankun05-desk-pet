/**
 * llmScheduler — LLM 请求调度器
 *
 * 职责：
 *   - 限制并发 LLM 请求数，避免 GPU/CPU 瞬间过载
 *   - 排队机制：超出并发上限的请求排队等待
 *   - 资源紧张时降级：拒绝新请求并提示用户
 *   - 与 ServiceLifecycle 配合：资源预算不足时延迟非关键请求
 *
 * 设计理念（大脑管理身体）：
 *   - 所有 LLM 调用（sendMessage / TTS 后的二次调用等）必须经过本调度器
 *   - 任务层只负责发起请求，调度器负责“现在能不能发”
 */

import { createLogger } from '../../utils/logger';

const log = createLogger('LLMScheduler');

/** 调度状态 */
export enum SchedulePhase {
  Idle = 'idle',
  Running = 'running',
  Queued = 'queued',
  Throttled = 'throttled',
}

interface QueuedRequest {
  id: string;
  /** 实际执行函数 */
  execute: () => Promise<void>;
  /** 优先级（数字越小越优先） */
  priority: number;
  /** 入队时间 */
  queuedAt: number;
  /** 回调：完成后执行 */
  resolve: () => void;
  reject: (err: Error) => void;
}

const MAX_CONCURRENT = 1;
const QUEUE_TIMEOUT_MS = 120_000;
const RESOURCE_CHECK_INTERVAL_MS = 5_000;

class LLMRequestScheduler {
  private activeCount = 0;
  private queue: QueuedRequest[] = [];
  private phase: SchedulePhase = SchedulePhase.Idle;
  private lastResourceCheck = 0;
  private resourceThrottled = false;

  /** 提交请求：返回 Promise，resolve 时表示请求已执行完成 */
  async schedule(execute: () => Promise<void>, priority = 50): Promise<void> {
    // 如果并发未满，直接执行
    if (this.activeCount < MAX_CONCURRENT) {
      return this.run(execute);
    }

    // 否则排队
    return new Promise<void>((resolve, reject) => {
      const request: QueuedRequest = {
        id: `llm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        execute,
        priority,
        queuedAt: Date.now(),
        resolve: () => {
          this.dequeue(request.id);
          resolve();
        },
        reject: (err: Error) => {
          this.dequeue(request.id);
          reject(err);
        },
      };

      // 按优先级插入队列（数字小的优先）
      const insertIdx = this.queue.findIndex((q) => q.priority > priority);
      if (insertIdx === -1) {
        this.queue.push(request);
      } else {
        this.queue.splice(insertIdx, 0, request as QueuedRequest);
      }

      this.phase = SchedulePhase.Queued;
      log.info('LLM 请求排队', {
        queueLength: this.queue.length,
        priority,
        active: this.activeCount,
      });
    });
  }

  /** 获取当前调度状态（供 UI 显示） */
  getStatus(): { phase: SchedulePhase; queueLength: number; active: number } {
    return {
      phase: this.phase,
      queueLength: this.queue.length,
      active: this.activeCount,
    };
  }

  /** 是否允许立即执行（不排队） */
  canRunNow(): boolean {
    // 资源紧张时拒绝
    if (this.resourceThrottled) {
      return false;
    }
    return this.activeCount < MAX_CONCURRENT;
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private async run(request: QueuedRequest | (() => Promise<void>)): Promise<void> {
    this.activeCount++;
    this.phase = SchedulePhase.Running;

    try {
      if (typeof request === 'function') {
        await request();
      } else {
        await request.execute();
        request.resolve();
      }
    } catch (err) {
      if (typeof request !== 'function') {
        request.reject(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.phase = this.activeCount > 0 ? SchedulePhase.Running : SchedulePhase.Idle;
      // 执行完一个，尝试从队列取下一个
      this.processQueue();
    }
  }

  /** 处理队列中的下一个请求 */
  private processQueue(): void {
    if (this.queue.length === 0) return;
    if (this.activeCount >= MAX_CONCURRENT) return;
    if (this.resourceThrottled) return;

    // 检查是否超时
    const now = Date.now();
    const timedOut = this.queue.filter((q) => now - q.queuedAt > QUEUE_TIMEOUT_MS);
    for (const q of timedOut) {
      log.warn('LLM 请求排队超时，取消', { id: q.id, queuedAt: q.queuedAt });
      q.reject(new Error('LLM request queue timeout'));
      this.dequeue(q.id);
    }

    if (this.queue.length === 0) return;

    const next = this.queue[0];
    if (next) this.run(next);
  }

  /** 从队列移除指定请求 */
  private dequeue(id: string): void {
    const idx = this.queue.findIndex((q) => q.id === id);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
    }
    if (this.queue.length === 0 && this.activeCount === 0) {
      this.phase = SchedulePhase.Idle;
    }
  }

  /** 资源检查：定期更新 resourceThrottled 状态 */
  checkResources(): void {
    const now = Date.now();
    if (now - this.lastResourceCheck < RESOURCE_CHECK_INTERVAL_MS) {
      return;
    }
    this.lastResourceCheck = now;

    // 简化版：检查 ServiceLifecycle 中 Running 的服务数量
    // 如果超过阈值，进入节流模式
    // TODO: tighten after ServiceLifecycle resource profiles are complete
  }
}

/** 全局唯一实例 */
export const llmScheduler = new LLMRequestScheduler();
