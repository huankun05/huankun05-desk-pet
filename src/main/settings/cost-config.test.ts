import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const mocks = vi.hoisted(() => ({
  notificationShow: vi.fn(),
  getPath: vi.fn(),
}));

vi.mock("electron", () => {
  const fsm = require("node:fs");
  const pathm = require("node:path");
  const osm = require("node:os");
  mocks.getPath.mockReturnValue(fsm.mkdtempSync(pathm.join(osm.tmpdir(), "cost-config-test-")));
  return {
    app: { getPath: mocks.getPath },
    Notification: vi.fn(function () {
      return { show: mocks.notificationShow };
    }),
  };
});

vi.mock("../token-usage-store", () => ({
  getCurrentMonthDays: vi.fn(() => []),
}));

import { Notification } from "electron";
import { getCurrentMonthDays } from "../token-usage-store";
import type { TokenUsageDay } from "../token-usage-store";
import { getCostConfig, saveCostConfig, evaluateBudgetAlert, maybeNotifyBudgetExceeded, getCurrentMonthCostUsd, getCurrentMonthModelCosts, WARN_RATIO } from "./cost-config";

function dayWithModel(model: string, input: number, output: number): TokenUsageDay {
  return {
    input,
    output,
    hit: 0,
    miss: 0,
    cacheCreation: 0,
    requests: 1,
    models: { [model]: { input, output, hit: 0, miss: 0, cacheCreation: 0, requests: 1 } },
  };
}

const NotificationMock = Notification as unknown as { mockClear: () => void };

describe("cost-config", () => {
  beforeEach(() => {
    mocks.notificationShow.mockClear();
    NotificationMock.mockClear();
    try {
      fs.rmSync(path.join(mocks.getPath(), "cost-config.json"), { force: true });
    } catch {
      // ignore
    }
  });

  it("默认配置：预算关闭、汇率默认 7.2", () => {
    const config = getCostConfig();
    expect(config.monthlyBudgetUsd).toBe(0);
    expect(config.exchangeRate).toBe(7.2);
    expect(config.lastAlertMonth).toBeNull();
    expect(config.lastWarnMonth).toBeNull();
  });

  it("saveCostConfig 持久化并清洗非法值", () => {
    saveCostConfig({ monthlyBudgetUsd: -5, exchangeRate: 0 });
    expect(getCostConfig().monthlyBudgetUsd).toBe(0);
    expect(getCostConfig().exchangeRate).toBe(7.2);

    saveCostConfig({ monthlyBudgetUsd: 12.5, exchangeRate: 7.4 });
    const saved = getCostConfig();
    expect(saved.monthlyBudgetUsd).toBe(12.5);
    expect(saved.exchangeRate).toBe(7.4);
  });

  it("getCurrentMonthCostUsd 汇总本月各日成本", () => {
    vi.mocked(getCurrentMonthDays).mockReturnValue([
      { key: "2026-09-01", day: dayWithModel("gpt-4o", 1_000_000, 500_000) }, // input $2.5 + output $5.0
      { key: "2026-09-02", day: dayWithModel("gpt-4o", 1_000_000, 0) },       // input $2.5
    ]);
    expect(getCurrentMonthCostUsd()).toBe(10);
  });

  it("evaluateBudgetAlert：未启用时 exceeded 为 false", () => {
    saveCostConfig({ monthlyBudgetUsd: 0 });
    const state = evaluateBudgetAlert();
    expect(state.enabled).toBe(false);
    expect(state.exceeded).toBe(false);
    expect(state.ratio).toBe(0);
  });

  it("evaluateBudgetAlert：超预算时 exceeded 为 true", () => {
    vi.mocked(getCurrentMonthDays).mockReturnValue([
      { key: "2026-09-01", day: dayWithModel("gpt-4o", 2_000_000, 500_000) }, // input $5 + output $5 = $10
    ]);
    saveCostConfig({ monthlyBudgetUsd: 5 });
    const state = evaluateBudgetAlert();
    expect(state.enabled).toBe(true);
    expect(state.exceeded).toBe(true);
    expect(state.monthCostUsd).toBe(10);
    expect(state.budgetUsd).toBe(5);
    expect(state.ratio).toBe(2);
  });

  it("maybeNotifyBudgetExceeded：超预算首次通知，同月不再重复", () => {
    vi.mocked(getCurrentMonthDays).mockReturnValue([
      { key: "2026-09-01", day: dayWithModel("gpt-4o", 2_000_000, 500_000) }, // $10
    ]);
    saveCostConfig({ monthlyBudgetUsd: 5, lastAlertMonth: null });
    expect(maybeNotifyBudgetExceeded()).toBe(true);
    expect(Notification).toHaveBeenCalledTimes(1);
    expect(mocks.notificationShow).toHaveBeenCalledTimes(1);
    // 同月重复调用不再通知
    expect(maybeNotifyBudgetExceeded()).toBe(false);
    expect(Notification).toHaveBeenCalledTimes(1);
  });

  it("maybeNotifyBudgetExceeded：未超预算不通知", () => {
    vi.mocked(getCurrentMonthDays).mockReturnValue([
      { key: "2026-09-01", day: dayWithModel("gpt-4o", 1_000_000, 0) }, // $2.5
    ]);
    saveCostConfig({ monthlyBudgetUsd: 10, lastAlertMonth: null });
    expect(maybeNotifyBudgetExceeded()).toBe(false);
    expect(Notification).not.toHaveBeenCalled();
  });

  it("evaluateBudgetAlert：达到预警阈值时 warning 为 true，未超限", () => {
    // gpt-4o input $2.5/1M：8M input = $20，预算 25 → ratio 0.8
    vi.mocked(getCurrentMonthDays).mockReturnValue([
      { key: "2026-09-01", day: dayWithModel("gpt-4o", 8_000_000, 0) },
    ]);
    saveCostConfig({ monthlyBudgetUsd: 25 });
    const state = evaluateBudgetAlert();
    expect(state.enabled).toBe(true);
    expect(state.exceeded).toBe(false);
    expect(state.warning).toBe(true);
    expect(state.ratio).toBeCloseTo(WARN_RATIO);
  });

  it("evaluateBudgetAlert：低于预警阈值时 warning 为 false", () => {
    vi.mocked(getCurrentMonthDays).mockReturnValue([
      { key: "2026-09-01", day: dayWithModel("gpt-4o", 1_000_000, 0) }, // $2.5
    ]);
    saveCostConfig({ monthlyBudgetUsd: 10 });
    expect(evaluateBudgetAlert().warning).toBe(false);
  });

  it("maybeNotifyBudgetExceeded：接近预算首次预警，同月不重复", () => {
    vi.mocked(getCurrentMonthDays).mockReturnValue([
      { key: "2026-09-01", day: dayWithModel("gpt-4o", 8_000_000, 0) }, // $20，预算 25 → 80%
    ]);
    saveCostConfig({ monthlyBudgetUsd: 25, lastWarnMonth: null });
    expect(maybeNotifyBudgetExceeded()).toBe(true);
    expect(Notification).toHaveBeenCalledTimes(1);
    expect(getCostConfig().lastWarnMonth).toBe("2026-09");
    // 同月重复调用不再预警
    expect(maybeNotifyBudgetExceeded()).toBe(false);
    expect(Notification).toHaveBeenCalledTimes(1);
  });

  it("maybeNotifyBudgetExceeded：预警后成本超限 → 触发超限通知（独立记录）", () => {
    vi.mocked(getCurrentMonthDays).mockReturnValue([
      { key: "2026-09-01", day: dayWithModel("gpt-4o", 8_000_000, 0) }, // $20，预算 25 → 80%
    ]);
    saveCostConfig({ monthlyBudgetUsd: 25, lastWarnMonth: null });
    expect(maybeNotifyBudgetExceeded()).toBe(true); // 预警

    vi.mocked(getCurrentMonthDays).mockReturnValue([
      { key: "2026-09-01", day: dayWithModel("gpt-4o", 20_000_000, 0) }, // $50，预算 25 → 超限
    ]);
    expect(maybeNotifyBudgetExceeded()).toBe(true); // 超限
    expect(Notification).toHaveBeenCalledTimes(2);
    expect(getCostConfig().lastAlertMonth).toBe("2026-09");
  });

  it("maybeNotifyBudgetExceeded：同月已超限后不再发预警", () => {
    vi.mocked(getCurrentMonthDays).mockReturnValue([
      { key: "2026-09-01", day: dayWithModel("gpt-4o", 20_000_000, 0) }, // $50，预算 25 → 超限
    ]);
    saveCostConfig({ monthlyBudgetUsd: 25, lastAlertMonth: "2026-09", lastWarnMonth: null });
    // 已超限且本月已提醒过 → 不重复；未达预警档（exceeded 时 warning 为 false）
    expect(maybeNotifyBudgetExceeded()).toBe(false);
    expect(Notification).not.toHaveBeenCalled();
  });

  it("getCurrentMonthModelCosts：按模型汇总并按成本降序", () => {
    vi.mocked(getCurrentMonthDays).mockReturnValue([
      { key: "2026-09-01", day: dayWithModel("gpt-4o", 1_000_000, 0) },         // $2.5
      { key: "2026-09-02", day: dayWithModel("claude-3-5-sonnet", 1_000_000, 0) }, // $3
      { key: "2026-09-03", day: dayWithModel("gpt-4o", 2_000_000, 0) },         // $5 → gpt-4o 合计 $7.5
    ]);
    const costs = getCurrentMonthModelCosts();
    expect(costs).toHaveLength(2);
    expect(costs[0].model).toBe("gpt-4o");
    expect(costs[0].costUsd).toBeCloseTo(7.5);
    expect(costs[1].model).toBe("claude-3-5-sonnet");
    expect(costs[1].costUsd).toBeCloseTo(3);
  });
});
