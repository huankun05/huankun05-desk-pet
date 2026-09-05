export type ScheduleKind = "once" | "daily" | "weekly" | "interval";

/** 定时任务完成后的投递目标。"local" = 仅聊天窗口（默认）；"desktop" = 额外弹桌面通知。 */
export type ScheduledTaskDelivery = "local" | "desktop";

export type ScheduleConfig =
  | { kind: "once"; runAt: string }
  | { kind: "daily"; timeOfDay: string }
  | { kind: "weekly"; dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; timeOfDay: string }
  | { kind: "interval"; every: number; unit: "minutes" | "hours" };

export type SchedulerToolMode = "all-enabled" | "allow-list";

export interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  enabled: boolean;
  schedule: ScheduleConfig;
  nextFireAt: string | null;
  lastFiredAt?: string;
  toolMode: SchedulerToolMode;
  allowedToolIds: string[];
  /** 完成后投递目标，默认 "local"（仅聊天窗口）。"desktop" 额外弹桌面通知。 */
  deliver?: ScheduledTaskDelivery;
  createdAt: string;
  updatedAt: string;
}

export interface NewScheduledTaskInput {
  title: string;
  prompt: string;
  enabled?: boolean;
  schedule: ScheduleConfig;
  toolMode?: SchedulerToolMode;
  allowedToolIds?: string[];
  deliver?: ScheduledTaskDelivery;
}

export type ScheduledTaskPatch = Partial<Pick<
  ScheduledTask,
  "title" | "prompt" | "enabled" | "schedule" | "nextFireAt" | "lastFiredAt" | "toolMode" | "allowedToolIds" | "deliver"
>>;

export interface ScheduledTaskHistoryEntry {
  id: string;
  taskId: string;
  taskTitle: string;
  firedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: "running" | "success" | "failed" | "skipped";
  reason?: string;
  outputPreview?: string;
  errorMessage?: string;
  effectiveToolIds: string[];
}

export interface ScheduledRunResult {
  ok: boolean;
  historyId: string;
  reply?: string;
  error?: string;
  effectiveToolIds: string[];
}

export interface SchedulerIpcResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: string;
  reason?: string;
}
