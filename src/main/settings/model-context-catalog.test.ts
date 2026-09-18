import { describe, expect, it } from "vitest";
import {
  getCatalogSize,
  lookupModelContextWindow,
} from "../orchestrator/model-config/model-context-catalog";

describe("model-context-catalog", () => {
  it("resolves exact model match for known providers", () => {
    expect(lookupModelContextWindow("DeepSeek（深度求索）", "deepseek-v4-pro")).toBe(131_072);
    expect(lookupModelContextWindow("MiniMax（稀宇科技）", "MiniMax-M3")).toBe(1_000_000);
    expect(lookupModelContextWindow("GLM（智谱）", "glm-5.3")).toBe(131_072);
    expect(lookupModelContextWindow("Claude（Anthropic）", "claude-sonnet-4-6")).toBe(200_000);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(lookupModelContextWindow("  deepseek（深度求索） ", "  DEEPSEEK-V4-PRO ")).toBe(131_072);
    expect(lookupModelContextWindow("minimax", "MINIMAX-M3")).toBe(1_000_000);
  });

  it("falls back to provider default when model is unknown", () => {
    // qwen 厂商未知模型 → providerDefault 32768
    expect(lookupModelContextWindow("Qwen（通义千问）", "custom-model-x")).toBe(32_768);
    // minimax 未知模型 → providerDefault 1M
    expect(lookupModelContextWindow("minimax", "some-future-model")).toBe(1_000_000);
  });

  it("accepts both displayName and capability id", () => {
    expect(lookupModelContextWindow("豆包（火山方舟）", "doubao-seed-2-1-pro-260628")).toBe(262_144);
    expect(lookupModelContextWindow("doubao", "doubao-seed-2-0-mini-260428")).toBe(262_144);
    expect(lookupModelContextWindow("kimi", "kimi-k2.6")).toBe(131_072);
    expect(lookupModelContextWindow("Kimi（月之暗面）", "kimi-k2-thinking")).toBe(131_072);
  });

  it("keeps historical name aliases working after rename", () => {
    expect(lookupModelContextWindow("智谱 glm", "glm-4.7")).toBe(131_072);
    expect(lookupModelContextWindow("通义千问（dashscope）", "qwen-max")).toBe(32_768);
    expect(lookupModelContextWindow("通义千问", "qwen-turbo")).toBe(1_048_576);
  });

  it("returns undefined for unknown providers", () => {
    expect(lookupModelContextWindow("不存在的厂商", "any-model")).toBeUndefined();
    expect(lookupModelContextWindow("", "")).toBeUndefined();
  });

  it("has a populated catalog", () => {
    expect(getCatalogSize()).toBeGreaterThanOrEqual(20);
  });
});
