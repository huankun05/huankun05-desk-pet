import type { CronJob, ScheduleOptions } from './types';
import { createStorage } from '../storage';

interface CronStorageData {
  jobs: CronJob[];
}

const storage = createStorage<CronStorageData>('cron-jobs', { jobs: [] });

export class CronJobManager {
  private static instance: CronJobManager;
  private jobs = new Map<string, CronJob>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private scheduledRunnables = new Map<
    string,
    { fn: () => void; timer: ReturnType<typeof setTimeout> | null }
  >();

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

  private startScheduledJobs(): void {
    for (const [id, job] of this.jobs) {
      if (job.enabled) {
        this.scheduleJobInternal(id, job);
      }
    }
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
      this.saveJobs().catch(() => {});
    }

    return id;
  }

  private scheduleJobInternal(
    id: string,
    job: CronJob,
    handler?: () => void | Promise<void>,
  ): void {
    this.cancelJob(id);

    if (!job.enabled) return;

    // 默认 handler：通过 localStorage 事件通知主窗口显示气泡
    // 跨窗口通信（设置窗口 → 主窗口），确保持久化任务恢复后也能触发
    const defaultHandler = () => {
      try {
        localStorage.setItem(
          'deskpet_cron_trigger',
          JSON.stringify({ id, name: job.name, time: Date.now() }),
        );
      } catch {
        /* ignore */
      }
      this.executeJob(id);
    };

    const jobHandler = handler || defaultHandler;

    if (job.jobType === 'basic' && job.runAt) {
      const runAtTime = new Date(job.runAt);
      const now = new Date();
      const delay = runAtTime.getTime() - now.getTime();

      if (delay > 0) {
        const timer = setTimeout(() => {
          this.runJobHandler(jobHandler, id);
          if (job.runOnce) {
            this.disableJob(id);
          }
        }, delay);
        this.scheduledRunnables.set(id, { fn: jobHandler, timer });
      }
    } else if (job.jobType === 'interval' && job.intervalMs) {
      const timer = setInterval(() => {
        this.runJobHandler(jobHandler, id);
      }, job.intervalMs);
      this.timers.set(id, timer);
    } else if (job.jobType === 'cron' && job.cronExpression) {
      const timer = setInterval(() => {
        if (this.shouldRunCron(job.cronExpression!)) {
          this.runJobHandler(jobHandler, id);
        }
      }, 60000);
      this.timers.set(id, timer);
    }
  }

  private runJobHandler(handler: () => void | Promise<void>, id: string): void {
    try {
      const result = handler();
      if (result instanceof Promise) {
        result.catch((err) => this.handleJobError(id, err));
      }
    } catch (err) {
      this.handleJobError(id, err);
    }
  }

  private handleJobError(id: string, err: unknown): void {
    const job = this.jobs.get(id);
    if (job) {
      job.lastError = err instanceof Error ? err.message : String(err);
      this.saveJobs().catch(() => {});
    }
  }

  async executeJob(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job || !job.enabled) return;

    job.lastRunAt = new Date().toISOString();
    job.lastError = undefined;

    await this.saveJobs();
  }

  cancelJob(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }

    const runnable = this.scheduledRunnables.get(id);
    if (runnable?.timer) {
      clearTimeout(runnable.timer);
      this.scheduledRunnables.delete(id);
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
    this.jobs.clear();
  }

  private shouldRunCron(cronExpression: string): boolean {
    try {
      const now = new Date();
      const minute = now.getMinutes();
      const hour = now.getHours();
      const day = now.getDate();
      const month = now.getMonth() + 1;
      const weekday = now.getDay();

      const parts = cronExpression.split(' ');
      if (parts.length !== 5) return false;

      const [minPart, hourPart, dayPart, monthPart, weekPart] = parts;

      return (
        this.matchesPart(minute, minPart) &&
        this.matchesPart(hour, hourPart) &&
        this.matchesPart(day, dayPart) &&
        this.matchesPart(month, monthPart) &&
        this.matchesPart(weekday, weekPart)
      );
    } catch {
      return false;
    }
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

/** 便捷方法：插件移除定时任务 */
export function removeJob(jobId: string): void {
  cronJobManager.cancelJob(jobId);
}
