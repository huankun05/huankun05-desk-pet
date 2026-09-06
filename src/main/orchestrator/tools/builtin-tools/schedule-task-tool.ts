// schedule-task-tool.ts —— 自然语言创建定时任务（#8）
//
// 移植 Hermes cronjob 工具的思路：LLM 把用户自然语言（"每天早上9点提醒我喝水"）
// 转换成紧凑调度字符串（"0 9 * * *"），本工具负责解析字符串 → ScheduleConfig 并写入
// scheduler store。解析失败返回带格式指引的错误文本，让 LLM 自纠重试。

import type { ToolDefinition } from "../registry/tool-registry";
import { parseSchedule } from "../../../scheduler/parse-schedule";
import { getSchedulerStore } from "../../../scheduler/scheduler-store";
import type { ScheduleConfig } from "../../../scheduler/types";

const LOG_PREFIX = "[ScheduleTaskTool]";

/** 工具只接受这些调度字符串格式，写入 description 供 LLM 参考。 */
const SCHEDULE_FORMATS = [
  "'0 9 * * *'：5 字段 cron 表达式（分 时 日 月 周），如每天 9 点 = '0 9 * * *'，工作日每小时 = '0 * * * 1-5'",
  "'every 30m' / 'every 2h' / 'every 1d'：周期重复（分钟/小时/天）",
  "'30m' / '2h' / '1d'：从当前时刻起的一次性任务",
  "'2026-09-06T09:00'：指定本地时间的一次性任务",
];

export function createScheduleTaskTool(): ToolDefinition {
  return {
    id: "schedule_task",
    name: "创建定时任务",
    description:
      "把用户的自然语言安排解析成定时任务并创建。\n\n" +
      "何时用：\n" +
      "- 用户说「每天/每周/每隔 X 提醒我……」「到点后帮我做……」「明天上午 9 点……」「30 分钟后……」\n" +
      "- 用户要求定时重复执行某个工作（如「每天早上 9 点给我天气简报」）\n\n" +
      "解析规则（把自然语言翻译成 schedule 字符串，不要直接写 cron 之外的自由文本）：\n" +
      SCHEDULE_FORMATS.map((f, i) => `- ${i + 1}. ${f}`).join("\n") +
      "\n\n" +
      "参数：\n" +
      "- title (必填)：任务短标题（≤30 字）\n" +
      "- prompt (必填)：到点后执行的工作指令（描述给未来的自己）\n" +
      "- schedule (必填)：按上面格式填写的调度字符串\n" +
      "- toolMode (可选)：'all-enabled'（全部工具，默认）或 'allow-list'（仅白名单工具）\n" +
      "- allowedToolIds (可选)：toolMode=allow-list 时允许使用的工具 id 列表\n" +
      "- deliver (可选)：'local'（仅聊天窗口，默认）或 'desktop'（额外弹桌面通知）\n\n" +
      "不要用于：\n" +
      "- 一次性现在就要执行的请求（直接执行即可，不要建任务）\n" +
      "- 用户没明确要求「定时/重复」的安排",
    enabled: true,
    effectKind: "mutation",
    verificationPolicy: "none",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "任务短标题（≤30 字）" },
        prompt: { type: "string", description: "到点后执行的工作指令" },
        schedule: { type: "string", description: "调度字符串：cron 表达式 / every X / 时长 / 时间戳，格式见工具说明" },
        toolMode: { type: "string", description: "all-enabled 或 allow-list（默认 all-enabled）" },
        allowedToolIds: {
          type: "array",
          description: "toolMode=allow-list 时允许的工具 id 列表",
          items: { type: "string" },
        },
        deliver: { type: "string", description: "local（默认）或 desktop" },
      },
      required: ["title", "prompt", "schedule"],
    },
    execute: async (args) => {
      const title = String(args.title ?? "").trim();
      const prompt = String(args.prompt ?? "").trim();
      if (!title) return "[错误] title 不能为空";
      if (!prompt) return "[错误] prompt 不能为空";

      let schedule: ScheduleConfig;
      try {
        schedule = parseSchedule(String(args.schedule ?? ""));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(LOG_PREFIX, "parse schedule failed:", message);
        return `[错误] schedule 无法解析：${message}\n请按以下格式重试：\n${SCHEDULE_FORMATS.map((f) => `- ${f}`).join("\n")}`;
      }

      try {
        const store = getSchedulerStore();
        store.load();

        const task = store.addTask({
          title,
          prompt,
          schedule,
          toolMode: args.toolMode === "allow-list" ? "allow-list" : "all-enabled",
          allowedToolIds: Array.isArray(args.allowedToolIds)
            ? args.allowedToolIds.map((v) => String(v))
            : [],
          deliver: args.deliver === "desktop" ? "desktop" : "local",
        });

        const next = task.nextFireAt
          ? `，首次执行时间：${new Date(task.nextFireAt).toLocaleString()}`
          : "，任务已排入队列";
        return `已创建定时任务「${task.title}」（id=${task.id}）${next}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(LOG_PREFIX, "add task failed:", message);
        return `[错误] 创建定时任务失败：${message}`;
      }
    },
  };
}
