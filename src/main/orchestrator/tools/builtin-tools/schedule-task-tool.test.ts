import { beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduleTaskTool } from "./schedule-task-tool";

const storeMock = vi.hoisted(() => ({
  load: vi.fn(),
  addTask: vi.fn(),
}));

vi.mock("../../../scheduler/scheduler-store", () => ({
  getSchedulerStore: () => storeMock,
}));

const tool = createScheduleTaskTool();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("schedule_task tool", () => {
  it("parses a cron schedule string and creates the task", async () => {
    storeMock.addTask.mockReturnValue({
      id: "task-1",
      title: "喝水提醒",
      nextFireAt: "2026-09-07T01:00:00.000Z",
    });

    const result = await tool.execute({
      title: "喝水提醒",
      prompt: "提醒我喝水",
      schedule: "0 9 * * *",
    });

    expect(storeMock.addTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "喝水提醒",
      prompt: "提醒我喝水",
      schedule: { kind: "cron", expr: "0 9 * * *" },
      toolMode: "all-enabled",
      allowedToolIds: [],
      deliver: "local",
    }));
    expect(result).toContain("已创建定时任务");
    expect(result).toContain("task-1");
  });

  it("maps toolMode / allowedToolIds / deliver to allow-list desktop", async () => {
    storeMock.addTask.mockReturnValue({ id: "task-2", title: "简报", nextFireAt: null });

    await tool.execute({
      title: "简报",
      prompt: "生成天气简报",
      schedule: "every 1h",
      toolMode: "allow-list",
      allowedToolIds: ["weather", "web_search"],
      deliver: "desktop",
    });

    expect(storeMock.addTask).toHaveBeenCalledWith(expect.objectContaining({
      schedule: { kind: "interval", every: 1, unit: "hours" },
      toolMode: "allow-list",
      allowedToolIds: ["weather", "web_search"],
      deliver: "desktop",
    }));
  });

  it("returns parse guidance for an invalid schedule string", async () => {
    const result = await tool.execute({ title: "X", prompt: "Y", schedule: "明天早上" });
    expect(result).toContain("无法解析");
    expect(result).toContain("cron");
    expect(storeMock.addTask).not.toHaveBeenCalled();
  });

  it("rejects empty title / prompt", async () => {
    const noTitle = await tool.execute({ title: "", prompt: "Y", schedule: "0 9 * * *" });
    expect(noTitle).toContain("title 不能为空");

    const noPrompt = await tool.execute({ title: "X", prompt: "  ", schedule: "0 9 * * *" });
    expect(noPrompt).toContain("prompt 不能为空");
    expect(storeMock.addTask).not.toHaveBeenCalled();
  });

  it("surfaces store errors as friendly text", async () => {
    storeMock.addTask.mockImplementation(() => { throw new Error("标题不能为空"); });
    const result = await tool.execute({ title: "X", prompt: "Y", schedule: "0 9 * * *" });
    expect(result).toContain("创建定时任务失败");
    expect(result).toContain("标题不能为空");
  });
});
