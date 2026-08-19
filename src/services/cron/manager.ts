import type { CronJob, ScheduleOptions } from './types';
import { createStorage } from '../storage';

interface CronStorageData {
  jobs: CronJob[];
}

const storage = createStorage<CronStorageData>('cron-jobs', { jobs: [] });

/** 错过补偿窗口：应用关闭期间错过的运行，最多补跑一次（且仅限 24h 内的错失） */
const MAX_CATCHUP_MS = 24 * 60 * 60 * 1000;
/** 失败退避初始延迟：15 秒，之后按 2^n 指数增长 */
const BASE_BACKOFF_MS = 15 * 1000;
/** 失败退避上限：30 分钟 */
const MAX_BACKOFF_MS = 30 * 60 * 1000;
/** 持久化写盘防抖（fireJob 高频触发时合并写） */
const PERSIST_DEBOUNCE_MS = 300;

export class CronJobManager {
  private static instance: CronJobManager;
  private jobs = new Map<string, CronJob>();
  /** 自定义 handler（内存态，不随任务持久化）；enable/disable/update 后依然保留 */
  private handlers = new Map<string, () => void | Promise<void>>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private timeouts = new Map<string, ReturnType<typeof setTimeout>>();
  /** 防重入：正在执行中的任务集合（避免同一任务重叠触发） */
  private running = new Set<string>();
  /** 连续失败次数（驱动指数退避） */
  private failureCounts = new Map<string, number>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor() {}

  static getInstance(): CronJobManager {
    if (!CronJobManager.instance) {
      CronJobManager.instance = new CronJobManager();
    }
    return CronJobManager.instance;
  }

  async init(): Promise<void> {
    await this.loadJobs();
    this.startScheduledJobs();
  }

  async loadJobs(): Promise<void> {
    try {
      const saved = storage.get();
      if (saved.jobs) {
        for (const job of saved.jobs) {
          this.jobs.set(job.id, job);
        }
      }
    } catch {
      // ignore
    }
  }

  async saveJobs(): Promise<void> {
    const jobs = Array.from(this.jobs.values());
    storage.set({ jobs });
  }

  /** 防抖持久化：内部触发（执行/失败）合并写盘，避免高频落盘 */
  private schedulePersist(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveJobs().catch(() => {});
    }, PERSIST_DEBOUNCE_MS);
  }

  private startScheduledJobs(): void {
    for (const [id, job] of this.jobs) {
      if (!job.enabled) continue;
      // 错过补偿：应用关闭期间错过的持久化任务，只补跑一次（避免堆叠轰炸）
      if (this.computeMissedRun(job)) {
        void this.fireJob(id, { catchUp: true });
      }
      this.scheduleJobInternal(id, job);
    }
  }

  /** 判断持久化任务在应用关闭期间是否错过了本该执行的运行点 */
  private computeMissedRun(job: CronJob): boolean {
    if (!job.persistent) return false;
    const lastRun = job.lastRunAt ? new Date(job.lastRunAt).getTime() : 0;

    if (job.jobType === 'interval' && job.intervalMs) {
      const idle = Date.now() - lastRun;
      // 距上次运行超过 2 个周期（且 24h 内）→ 视为错过，补一次
      return lastRun > 0 && idle > job.intervalMs * 2 && idle <= MAX_CATCHUP_MS;
    }

    if (job.jobType === 'cron' && job.cronExpression) {
      // 从上次运行之后找第一个匹配点；若该点在当前时间之前且 24h 内 → 错过
      const from = lastRun > 0 ? lastRun : Date.now() - 60 * 60 * 1000;
      const next = this.nextCronTime(job.cronExpression, from);
      if (next === null) return false;
      const missedFor = Date.now() - next;
      return missedFor >= 0 && missedFor <= MAX_CATCHUP_MS;
    }

    return false;
  }

  scheduleJob(options: ScheduleOptions): string | null {
    const {
      id,
      name,
      cronExpression,
      intervalMs,
      runAt,
      handler,
      persistent = false,
      runOnce = false,
    } = options;

    const job: CronJob = {
      id,
      name: name || id,
      jobType: runAt ? 'basic' : intervalMs ? 'interval' : 'cron',
      cronExpression,
      intervalMs,
      runAt: runAt?.toISOString(),
      payload: {},
      enabled: true,
      persistent,
      runOnce,
    };

    this.jobs.set(id, job);
    this.scheduleJobInternal(id, job, handler);

    if (persistent) {
      this.schedulePersist();
    }

    return id;
  }

  /** 取任务生效的 handler：优先自定义（已注册的），否则默认「通知主窗口显示气泡」 */
  private effectiveHandler(id: string, job: CronJob): () => void | Promise<void> {
    const custom = this.handlers.get(id);
    if (custom) return custom;

    return () => {
      try {
        // 跨窗口通信（设置窗口 → 主窗口）：通过 localStorage 事件通知主窗口显示气泡
        localStorage.setItem(
          'deskpet_cron_trigger',
          JSON.stringify({ id, name: job.name, time: Date.now() }),
        );
      } catch {
        /* ignore */
      }
    };
  }

  private scheduleJobInternal(
    id: string,
    job: CronJob,
    handler?: () => void | Promise<void>,
  ): void {
    this.cancelJob(id);

    if (!job.enabled) return;

    if (handler) {
      this.handlers.set(id, handler);
    }

    if (job.jobType === 'basic' && job.runAt) {
      const delay = new Date(job.runAt).getTime() - Date.now();
      if (delay > 0) {
        const timer = setTimeout(() => {
          void this.fireJob(id);
          if (job.runOnce) {
            void this.disableJob(id);
          }
        }, delay);
        this.timeouts.set(id, timer);
      }
    } else if (job.jobType === 'interval' && job.intervalMs) {
      // 抖动：首个周期叠加小随机延迟，避免多个任务同一拍齐射（惊群）
      const jitter = Math.min(1000, job.intervalMs * 0.1) * Math.random();
      const startTimer = () => {
        const timer = setInterval(() => {
          void this.fireJob(id);
        }, job.intervalMs!);
        this.timers.set(id, timer);
      };
      if (jitter > 0) {
        const start = setTimeout(startTimer, jitter);
        this.timeouts.set(id, start);
      } else {
        startTimer();
      }
    } else if (job.jobType === 'cron' && job.cronExpression) {
      // 精确调度：算出下一次触发时间，setTimeout 到点触发并重新排程。
      // 替代原先的每分钟轮询 shouldRunCron —— 空闲时不再周期性唤醒，降低 CPU 占用。
      const scheduleNext = () => {
        const next = this.nextCronTime(job.cronExpression!, Date.now());
        if (next === null) return; // 表达式在未来 24h 内无匹配（如 2 月 30 日），不再轮询
        const delay = Math.max(0, next - Date.now());
        const timer = setTimeout(() => {
          void this.fireJob(id);
          if (job.enabled) scheduleNext();
        }, delay);
        this.timeouts.set(id, timer);
      };
      scheduleNext();
    }
  }

  /**
   * 执行任务（统一入口）：
   * - 防重入：同一任务上次尚未跑完则不重复触发；
   * - 失败退避：连续失败按 2^n 指数退避（15s → 30min 封顶），成功即重置；
   * - 记录 lastRunAt / nextRunTime / lastError 并防抖落盘。
   */
  private async fireJob(id: string, opts?: { force?: boolean; catchUp?: boolean }): Promise<void> {
    const job = this.jobs.get(id);
    if (!job || !job.enabled) return;

    if (this.running.has(id)) {
      // 防重入：跳过本次触发（下次周期自然再试）
      return;
    }

    const now = Date.now();
    if (!opts?.force && job.nextRunAfter) {
      const waitUntil = new Date(job.nextRunAfter).getTime();
      if (now < waitUntil) return; // 退避期内，跳过
    }

    this.running.add(id);
    const handler = this.effectiveHandler(id, job);

    try {
      await handler();
      this.failureCounts.delete(id);
      job.nextRunAfter = undefined;
      job.lastError = undefined;
    } catch (err) {
      const count = (this.failureCounts.get(id) ?? 0) + 1;
      this.failureCounts.set(id, count);
      const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (count - 1), MAX_BACKOFF_MS);
      job.nextRunAfter = new Date(now + backoff).toISOString();
      job.lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[cron] job "${job.name}" (${id}) failed (attempt ${count}): ${job.lastError}`);
    } finally {
      job.lastRunAt = new Date().toISOString();
      job.nextRunTime = this.computeNextRunTime(job);
      this.running.delete(id);
      this.schedulePersist();
    }
  }

  /** 立即执行任务（手动触发）；绕过失败退避，但受防重入保护 */
  async executeJob(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    await this.fireJob(id, { force: true });
  }

  cancelJob(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }

    const timeout = this.timeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(id);
    }
  }

  async enableJob(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;

    job.enabled = true;
    this.scheduleJobInternal(id, job);
    await this.saveJobs();
    return true;
  }

  async disableJob(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;

    job.enabled = false;
    this.cancelJob(id);
    await this.saveJobs();
    return true;
  }

  async toggleJob(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;

    if (job.enabled) {
      await this.disableJob(id);
    } else {
      await this.enableJob(id);
    }
    return job.enabled;
  }

  async deleteJob(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;

    this.cancelJob(id);
    this.handlers.delete(id);
    this.failureCounts.delete(id);
    this.jobs.delete(id);
    await this.saveJobs();
    return true;
  }

  getJob(id: string): CronJob | undefined {
    return this.jobs.get(id);
  }

  getAllJobs(): CronJob[] {
    return Array.from(this.jobs.values());
  }

  async updateJob(id: string, updates: Partial<CronJob>): Promise<CronJob | null> {
    const job = this.jobs.get(id);
    if (!job) return null;

    Object.assign(job, updates);
    this.cancelJob(id);
    if (job.enabled) {
      this.scheduleJobInternal(id, job);
    }
    await this.saveJobs();
    return job;
  }

  shutdown(): void {
    for (const id of this.jobs.keys()) {
      this.cancelJob(id);
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.jobs.clear();
    this.handlers.clear();
    this.failureCounts.clear();
  }

  /** 计算任务下一次运行时间（用于展示 nextRunTime） */
  private computeNextRunTime(job: CronJob): string | undefined {
    if (job.jobType === 'basic' && job.runAt) {
      const t = new Date(job.runAt).getTime();
      return t > Date.now() ? job.runAt : undefined;
    }
    if (job.jobType === 'interval' && job.intervalMs) {
      return new Date(Date.now() + job.intervalMs).toISOString();
    }
    if (job.jobType === 'cron' && job.cronExpression) {
      const next = this.nextCronTime(job.cronExpression, Date.now());
      return next === null ? undefined : new Date(next).toISOString();
    }
    return undefined;
  }

  /** 计算 cron 表达式在 after 之后的第一个匹配时间点（分钟精度，最多向前扫描 24h） */
  private nextCronTime(expr: string, after: number): number | null {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return null;

    const startMinute = Math.floor(after / 60000);
    const limit = after + MAX_CATCHUP_MS;

    for (let m = startMinute; m * 60000 <= limit; m++) {
      const t = m * 60000;
      if (t <= after) continue;
      const d = new Date(t);
      if (
        this.matchesPart(d.getMinutes(), parts[0]) &&
        this.matchesPart(d.getHours(), parts[1]) &&
        this.matchesPart(d.getDate(), parts[2]) &&
        this.matchesPart(d.getMonth() + 1, parts[3]) &&
        this.matchesPart(d.getDay(), parts[4])
      ) {
        return t;
      }
    }
    return null;
  }

  private matchesPart(value: number, part: string): boolean {
    if (part === '*') return true;

    for (const item of part.split(',')) {
      const trimmed = item.trim();
      if (trimmed === '*') return true;

      if (trimmed.includes('-')) {
        const [start, end] = trimmed.split('-').map(Number);
        if (value >= start && value <= end) return true;
      } else if (trimmed.includes('/')) {
        const [base, step] = trimmed.split('/').map(Number);
        if (base === 0 || base === value % step) return true;
      } else {
        if (Number(trimmed) === value) return true;
      }
    }

    return false;
  }
}

export const cronJobManager = CronJobManager.getInstance();

export function getCronJobManager(): CronJobManager {
  return cronJobManager;
}

/** 便捷方法：插件添加定时任务 */
export function addJob(options: ScheduleOptions): string | null {
  return cronJobManager.scheduleJob(options);
}

/** 便捷方法：插件移除定时任务（彻底删除，而非仅停止） */
export function removeJob(jobId: string): void {
  cronJobManager.deleteJob(jobId).catch(() => {});
}
