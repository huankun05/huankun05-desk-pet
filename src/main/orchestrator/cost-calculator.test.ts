import { describe, expect, it } from "vitest";
import { calculateCost, calculateCostForModel, calculateDayCost, calculateModelCost, formatCost, type CostBreakdown } from "./cost-calculator";
import { setCustomPricing, clearCustomPricing } from "./model-pricing";
import type { TokenUsageDay, TokenUsageModel } from "../token-usage-store";

describe("cost-calculator", () => {
  describe("calculateCost", () => {
    it("calculates basic input + output cost", () => {
      const cost = calculateCost(1_000_000, 500_000, { inputPrice: 2.0, outputPrice: 10.0 });
      expect(cost.inputCost).toBe(2.0);
      expect(cost.outputCost).toBe(5.0);
      expect(cost.totalCost).toBe(7.0);
    });

    it("uses default cacheHitPrice = inputPrice * 0.5 when not specified", () => {
      const cost = calculateCost(0, 0, { inputPrice: 2.0, outputPrice: 10.0 }, 1_000_000);
      expect(cost.cacheHitCost).toBe(1.0); // 2.0 * 0.5
    });

    it("uses default cacheCreationPrice = inputPrice * 1.25 when not specified", () => {
      const cost = calculateCost(0, 0, { inputPrice: 2.0, outputPrice: 10.0 }, 0, 1_000_000);
      expect(cost.cacheCreationCost).toBe(2.5); // 2.0 * 1.25
    });

    it("uses explicit cacheHitPrice and cacheCreationPrice when provided", () => {
      const cost = calculateCost(0, 0, {
        inputPrice: 2.0,
        outputPrice: 10.0,
        cacheHitPrice: 0.5,
        cacheCreationPrice: 3.0,
      }, 1_000_000, 1_000_000);
      expect(cost.cacheHitCost).toBe(0.5);
      expect(cost.cacheCreationCost).toBe(3.0);
    });

    it("handles zero tokens", () => {
      const cost = calculateCost(0, 0, { inputPrice: 2.0, outputPrice: 10.0 });
      expect(cost.totalCost).toBe(0);
    });

    it("rounds to 6 decimal places", () => {
      const cost = calculateCost(123456, 789012, { inputPrice: 2.5, outputPrice: 10.0 });
      // 123456/1e6 * 2.5 = 0.30864
      expect(cost.inputCost).toBe(0.30864);
      // 789012/1e6 * 10.0 = 7.89012
      expect(cost.outputCost).toBe(7.89012);
    });
  });

  describe("calculateCostForModel", () => {
    it("returns cost for known model", () => {
      const cost = calculateCostForModel("gpt-4o", 1_000_000, 500_000);
      expect(cost).not.toBeNull();
      expect(cost?.inputCost).toBe(2.5);
      expect(cost?.outputCost).toBe(5.0);
    });

    it("returns null for unknown model", () => {
      const cost = calculateCostForModel("unknown-model-xyz", 1_000_000, 500_000);
      expect(cost).toBeNull();
    });

    it("includes cache hit cost when provided", () => {
      const cost = calculateCostForModel("claude-3-5-sonnet", 0, 0, 1_000_000);
      expect(cost?.cacheHitCost).toBe(0.3); // Claude 3.5 Sonnet cache hit = $0.3/1M
    });
  });

  describe("calculateDayCost", () => {
    it("calculates total cost for a day with multiple models", () => {
      const day: TokenUsageDay = {
        input: 2_000_000,
        output: 1_000_000,
        hit: 0,
        miss: 0,
        cacheCreation: 0,
        requests: 2,
        models: {
          "gpt-4o": { input: 1_000_000, output: 500_000, hit: 0, miss: 0, cacheCreation: 0, requests: 1 },
          "deepseek-chat": { input: 1_000_000, output: 500_000, hit: 0, miss: 0, cacheCreation: 0, requests: 1 },
        },
      };
      const cost = calculateDayCost(day);
      expect(cost).not.toBeNull();
      // gpt-4o: 2.5 + 5.0 = 7.5
      // deepseek-chat: 0.27 + 0.55 = 0.82
      expect(cost?.totalCost).toBeCloseTo(8.32, 5);
    });

    it("returns null when no models have pricing", () => {
      const day: TokenUsageDay = {
        input: 1_000_000,
        output: 500_000,
        hit: 0,
        miss: 0,
        cacheCreation: 0,
        requests: 1,
        models: {
          "unknown-model": { input: 1_000_000, output: 500_000, hit: 0, miss: 0, cacheCreation: 0, requests: 1 },
        },
      };
      expect(calculateDayCost(day)).toBeNull();
    });

    it("returns null for legacy data without model breakdown", () => {
      const day: TokenUsageDay = {
        input: 1_000_000,
        output: 500_000,
        hit: 0,
        miss: 0,
        cacheCreation: 0,
        requests: 1,
      };
      expect(calculateDayCost(day)).toBeNull();
    });

    it("partially calculates when some models have pricing", () => {
      const day: TokenUsageDay = {
        input: 2_000_000,
        output: 1_000_000,
        hit: 0,
        miss: 0,
        cacheCreation: 0,
        requests: 2,
        models: {
          "gpt-4o": { input: 1_000_000, output: 500_000, hit: 0, miss: 0, cacheCreation: 0, requests: 1 },
          "unknown-model": { input: 1_000_000, output: 500_000, hit: 0, miss: 0, cacheCreation: 0, requests: 1 },
        },
      };
      const cost = calculateDayCost(day);
      expect(cost).not.toBeNull();
      // only gpt-4o counted: 2.5 + 5.0 = 7.5
      expect(cost?.totalCost).toBeCloseTo(7.5, 5);
    });
  });

  describe("calculateModelCost", () => {
    it("calculates cost for a model usage entry", () => {
      const usage: TokenUsageModel = {
        input: 2_000_000,
        output: 1_000_000,
        hit: 500_000,
        miss: 1_500_000,
        cacheCreation: 100_000,
        requests: 5,
      };
      const cost = calculateModelCost("gpt-4o", usage);
      expect(cost).not.toBeNull();
      // input: 2M * 2.5/1M = 5.0
      // output: 1M * 10/1M = 10.0
      // cacheHit: 500K * 1.25/1M = 0.625
      // cacheCreation: 100K * 3.75/1M = 0.375
      expect(cost?.totalCost).toBeCloseTo(16.0, 5);
    });
  });

  describe("formatCost", () => {
    it("formats >= $1 with 2 decimals", () => {
      expect(formatCost(7.5)).toBe("$7.50");
      expect(formatCost(100)).toBe("$100.00");
    });

    it("formats >= $0.01 with 4 decimals", () => {
      expect(formatCost(0.0123)).toBe("$0.0123");
      expect(formatCost(0.99)).toBe("$0.9900");
    });

    it("formats < $0.01 with 6 decimals", () => {
      expect(formatCost(0.000123)).toBe("$0.000123");
      expect(formatCost(0.001)).toBe("$0.001000");
    });

    it("formats zero", () => {
      expect(formatCost(0)).toBe("$0.000000");
    });
  });
});
