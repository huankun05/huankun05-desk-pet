export interface CronJob {
  id: string;
  name: string;
  jobType: 'basic' | 'interval' | 'cron';
  cronExpression?: string;
  intervalMs?: number;
  runAt?: string;
  payload?: Record<string, unknown>;
  enabled: boolean;
  persistent: boolean;
  runOnce: boolean;
  lastRunAt?: string;
  lastError?: string;
  nextRunTime?: string;
  /** 失败退避：此时间之前不再触发（由连续失败次数指数退避决定） */
  nextRunAfter?: string;
}

export interface ScheduleOptions {
  id: string;
  name?: string;
  cronExpression?: string;
  intervalMs?: number;
  runAt?: Date;
  /** 自定义触发处理器；不传则使用默认 handler（通过 localStorage 事件通知主窗口显示气泡） */
  handler?: () => void | Promise<void>;
  persistent?: boolean;
  runOnce?: boolean;
}
