import { describe, expect, it, vi } from "vitest";
import * as os from "os";
import * as path from "path";

// recordUsage 依赖 app.getPath("userData")，用独立临时目录隔离本测试。
vi.mock("electron", () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), "cyrene-token-usage-hook-test"),
  },
}));

import {
  applyUsageToDay,
  clearUsage,
  recordUsage,
  setUsageRecordedHook,
  type TokenUsageDay,
} from "./token-usage-store";

describe("applyUsageToDay", () => {
  it("tracks cache coverage for a model only when the provider reports cached input", () => {
    const day: TokenUsageDay = {
      input: 0,
      output: 0,
      hit: 0,
      miss: 0,
      cacheCreation: 0,
      requests: 0,
    };

    applyUsageToDay(day, 20, 4, 1, 8, "test-model");
    applyUsageToDay(day, 10, 2, 1, undefined, "test-model");

    expect(day.models?.["test-model"]).toEqual({
      input: 30,
      output: 6,
      hit: 8,
      miss: 12,
      cacheCreation: 0,
      requests: 2,
      cacheUsageRequests: 1,
    });
  });
});

describe("clearUsage", () => {
  it("removes every stored day and model record", () => {
    const days: Record<string, TokenUsageDay> = {
      "2026-08-16": {
        input: 20,
        output: 4,
        hit: 8,
        miss: 12,
        cacheCreation: 0,
        requests: 1,
        cacheUsageRequests: 1,
        models: {
          "test-model": { input: 20, output: 4, hit: 8, miss: 12, cacheCreation: 0, requests: 1, cacheUsageRequests: 1 },
        },
      },
    };

    clearUsage(days);

    expect(days).toEqual({});
  });
});

describe("setUsageRecordedHook", () => {
  it("recordUsage 后触发已注册的回调；解除后不再触发", () => {
    clearUsage();
    const hook = vi.fn();
    setUsageRecordedHook(hook);

    recordUsage(10, 5, 1, undefined, "hook-model");
    expect(hook).toHaveBeenCalledTimes(1);

    setUsageRecordedHook(null);
    recordUsage(1, 1, 1, undefined, "hook-model");
    expect(hook).toHaveBeenCalledTimes(1); // 解除后不再触发
  });
});
