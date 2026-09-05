import { Notification } from "electron";
import type { BrowserWindow } from "electron";
import type { IpcScope } from "../application/ipc-scope";
import type { AgentRuntime } from "../orchestrator/agent-runtime";
import { toolRegistry } from "../orchestrator/tools/registry/tool-registry";
import { SchedulerEngine, type SchedulerEngineDeps } from "./scheduler-engine";
import { getSchedulerStore } from "./scheduler-store";
import { registerSchedulerIpc } from "./scheduler-ipc";
import { createSchedulerRunner } from "./scheduler-runner";
import type { ScheduledRunResult, ScheduledTask } from "./types";

export interface SchedulerSubsystemDeps {
  agentRuntime: AgentRuntime;
  getReactChatWindow(): BrowserWindow | null;
  store?: ReturnType<typeof getSchedulerStore>;
  createEngine?: (deps: SchedulerEngineDeps) => SchedulerEngine;
  registerIpc?: typeof registerSchedulerIpc;
  /** 共享 IPC scope；传入后 scheduler IPC 由组合根统一注销。 */
  ipc?: IpcScope;
}

export interface SchedulerSubsystem {
  store: ReturnType<typeof getSchedulerStore>;
  engine: SchedulerEngine;
  initialize(): void;
  start(): void;
  stop(): void;
}

/**
 * 组装 scheduler 子系统。构造期只创建 store 引用 / runner / engine，
 * 不加载 store、不注册 IPC、不启动定时器 —— initialize / start / stop 必须显式调用。
 */
/**
 * 定时任务完成后的桌面通知投递。
 * 成功：显示任务标题 + 结果预览（前 120 字）
 * 失败：显示任务标题 + 错误信息
 */
function deliverScheduledResultToDesktop(task: ScheduledTask, result: ScheduledRunResult): void {
  try {
    const title = result.ok
      ? `定时任务完成：${task.title}`
      : `定时任务失败：${task.title}`;
    const body = result.ok
      ? (result.reply ?? "").slice(0, 120) || "任务已完成"
      : (result.error ?? "未知错误").slice(0, 120);
    const notification = new Notification({ title, body, silent: false });
    notification.show();
  } catch (err) {
    console.error("[scheduler] 桌面通知投递失败:", err instanceof Error ? err.message : err);
  }
}

export function createSchedulerSubsystem(deps: SchedulerSubsystemDeps): SchedulerSubsystem {
  const store = deps.store ?? getSchedulerStore();

  const runner = createSchedulerRunner({
    buildOptions: (task) => deps.agentRuntime.buildSchedulerOptions(task),
    getChatWebContents: () => {
      const win = deps.getReactChatWindow();
      return win && !win.isDestroyed() ? win.webContents : null;
    },
    recordHistory: (entry) => store.recordHistory(entry),
    id: () => `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    now: () => new Date(),
    deliverResult: deliverScheduledResultToDesktop,
  });

  const engineDeps: SchedulerEngineDeps = {
    store,
    runTask: runner.runScheduledTask,
  };
  const engine = deps.createEngine
    ? deps.createEngine(engineDeps)
    : new SchedulerEngine(engineDeps);
  const registerIpc = deps.registerIpc ?? registerSchedulerIpc;

  let initialized = false;
  return {
    store,
    engine,
    /** 加载持久化 store + 注册 IPC。idempotent。 */
    initialize(): void {
      if (initialized) return;
      initialized = true;
      store.load();
      registerIpc(store, engine, () => toolRegistry.getAllTools(), deps.ipc);
    },
    /** 只启动 engine 定时器（必须在 MCP 恢复之后调用）。 */
    start(): void {
      engine.start();
    },
    /** 只停止 engine 定时器。 */
    stop(): void {
      engine.stop();
    },
  };
}
