import type { ToolDefinition } from "../orchestrator/tools/registry/tool-registry";
import type { ScheduledTask } from "./types";

/** 定时任务执行时永远不给的工具（对齐 Hermes：cron 上下文禁用 cronjob 工具集，防止递归建任务）。 */
const NEVER_IN_SCHEDULED_RUN = new Set(["schedule_task"]);

export function filterToolsForTask(task: ScheduledTask, allTools: ToolDefinition[]): ToolDefinition[] {
  const enabledTools = allTools.filter(tool => tool.enabled && !NEVER_IN_SCHEDULED_RUN.has(tool.id));
  if (task.toolMode === "all-enabled") return enabledTools;
  const allowed = new Set(task.allowedToolIds);
  return enabledTools.filter(tool => allowed.has(tool.id));
}
