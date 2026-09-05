import { describe, expect, it, beforeEach } from "vitest";
import { getModelPricing, setCustomPricing, clearCustomPricing, getBuiltinPricingEntries } from "./model-pricing";

describe("model-pricing", () => {
  beforeEach(() => {
    clearCustomPricing();
  });

  describe("getModelPricing", () => {
    it("matches known models by name (case insensitive)", () => {
      const pricing = getModelPricing("gpt-4o-2024-08-06");
      expect(pricing).not.toBeNull();
      expect(pricing?.inputPrice).toBe(2.5);
      expect(pricing?.outputPrice).toBe(10.0);
    });

    it("matches Claude 3.5 Sonnet", () => {
      const pricing = getModelPricing("claude-3-5-sonnet-20241022");
      expect(pricing).not.toBeNull();
      expect(pricing?.inputPrice).toBe(3.0);
      expect(pricing?.outputPrice).toBe(15.0);
      expect(pricing?.cacheHitPrice).toBe(0.3);
    });

    it("matches DeepSeek Chat", () => {
      const pricing = getModelPricing("deepseek-chat");
      expect(pricing).not.toBeNull();
      expect(pricing?.inputPrice).toBe(0.27);
      expect(pricing?.outputPrice).toBe(1.10);
    });

    it("matches MiniMax M2", () => {
      const pricing = getModelPricing("MiniMax-M2");
      expect(pricing).not.toBeNull();
      expect(pricing?.inputPrice).toBe(0.3);
    });

    it("returns null for unknown model", () => {
      expect(getModelPricing("some-random-model-xyz")).toBeNull();
    });

    it("returns null for empty model name", () => {
      expect(getModelPricing("")).toBeNull();
      expect(getModelPricing("   ")).toBeNull();
    });

    it("first match wins (more specific patterns first)", () => {
      // gpt-4o should match before gpt-4 (if gpt-4 existed)
      const pricing = getModelPricing("gpt-4o");
      expect(pricing?.inputPrice).toBe(2.5);
    });

    it("returns a copy (not reference to internal)", () => {
      const p1 = getModelPricing("gpt-4o");
      const p2 = getModelPricing("gpt-4o");
      expect(p1).not.toBe(p2);
      expect(p1).toEqual(p2);
    });
  });

  describe("custom pricing", () => {
    it("custom pricing takes priority over builtin", () => {
      setCustomPricing([{ pattern: "gpt-4o", pricing: { inputPrice: 99.0, outputPrice: 99.0 } }]);
      const pricing = getModelPricing("gpt-4o");
      expect(pricing?.inputPrice).toBe(99.0);
    });

    it("clearCustomPricing restores builtin behavior", () => {
      setCustomPricing([{ pattern: "gpt-4o", pricing: { inputPrice: 99.0, outputPrice: 99.0 } }]);
      clearCustomPricing();
      const pricing = getModelPricing("gpt-4o");
      expect(pricing?.inputPrice).toBe(2.5);
    });

    it("custom pricing can add new model patterns", () => {
      setCustomPricing([{ pattern: "my-custom-model", pricing: { inputPrice: 1.0, outputPrice: 2.0 } }]);
      const pricing = getModelPricing("my-custom-model-v2");
      expect(pricing).not.toBeNull();
      expect(pricing?.inputPrice).toBe(1.0);
    });
  });

  describe("getBuiltinPricingEntries", () => {
    it("returns all builtin entries", () => {
      const entries = getBuiltinPricingEntries();
      expect(entries.length).toBeGreaterThan(20);
      expect(entries[0].pattern).toBeDefined();
      expect(entries[0].pricing.inputPrice).toBeGreaterThan(0);
    });
  });
});
