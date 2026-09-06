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
import { getCostConfig, saveCostConfig, evaluateBudgetAlert, maybeNotifyBudgetExceeded, getCurrentMonthCostUsd } from "./cost-config";

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
});
