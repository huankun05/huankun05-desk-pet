import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ChatResponse } from "../vendors/types";

/** 模拟 SDK 抛出的原始 APIError（带 status，如 429/500）。 */
function apiError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.name = "APIError";
  err.status = status;
  return err;
}

const fakeAdapter = {
  transport: "openai",
  capability: { anthropicAuthStyle: false as const, authStyle: "bearer" as const },
  buildRequest: vi.fn((req: unknown) => ({
    url: "https://fake.local/v1/chat/completions",
    headers: { authorization: "Bearer x" },
    body: JSON.stringify(req),
  })),
  parseResponse: vi.fn(async (json: unknown) => json as ChatResponse),
};

const fakeStreamChatWithSdk = vi.fn();

vi.mock("../vendors", () => ({
  getAdapterForConfig: vi.fn(() => fakeAdapter),
  streamChatWithSdk: (...args: unknown[]) => fakeStreamChatWithSdk(...args),
  resolveTransport: vi.fn(() => "openai"),
}));

vi.mock("../../token-usage-store", () => ({
  recordUsage: vi.fn(),
  recordRequest: vi.fn(),
}));

vi.mock("../vendors/stream-support", () => ({
  isExplicitStreamUnsupported: vi.fn(() => false),
}));

import { callLLM } from "./harness-llm";

const vendorConfig = {
  provider: "fake",
  baseUrl: "https://fake.local",
  model: "fake-model",
  apiKey: "fake-key",
} as never;

const promptLayers = { stablePrefix: "test", mode: "work" } as never;

function okResponse(text = "完成"): ChatResponse {
  return {
    assistantMessage: { role: "assistant", content: text },
    text,
    toolCalls: [],
    finishReason: "stop",
    raw: {},
  };
}

describe("callLLM 429/5xx 自动重试", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeStreamChatWithSdk.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("流式路径 429（tpm exhausted）后自动重试并成功", async () => {
    fakeStreamChatWithSdk
      .mockRejectedValueOnce(Object.assign(
        new Error("模型服务请求失败。", { cause: apiError(429, "inference tpm exhausted") }),
        { name: "AgentRuntimeError", code: "E_MODEL_REQUEST_FAILED" },
      ))
      .mockResolvedValueOnce(okResponse("重试成功"));

    const promise = callLLM(vendorConfig, promptLayers, [{ role: "user", content: "hi" }], [], {
      totalTimeoutMs: 300_000,
    } as never);
    await vi.advanceTimersByTimeAsync(4_100); // 第一次退避 4s 后重试

    const result = await promise;
    expect(result.text).toBe("重试成功");
    expect(fakeStreamChatWithSdk).toHaveBeenCalledTimes(2);
  });

  it("仅按错误文本（无 status 字段）也能识别 tpm 限流", async () => {
    fakeStreamChatWithSdk
      .mockRejectedValueOnce(Object.assign(
        new Error("模型服务请求失败。", { cause: apiError(0, "inference tpm exhausted") }),
        { name: "AgentRuntimeError", code: "E_MODEL_REQUEST_FAILED" },
      ))
      .mockResolvedValueOnce(okResponse("ok"));

    const promise = callLLM(vendorConfig, promptLayers, [{ role: "user", content: "hi" }], [], {
      totalTimeoutMs: 300_000,
    } as never);
    await vi.advanceTimersByTimeAsync(4_100);
    expect((await promise).text).toBe("ok");
    expect(fakeStreamChatWithSdk).toHaveBeenCalledTimes(2);
  });

  it("连续 429 时重试到上限后抛出原错误", async () => {
    const failure = Object.assign(
      new Error("模型服务请求失败。", { cause: apiError(429, "inference tpm exhausted") }),
      { name: "AgentRuntimeError", code: "E_MODEL_REQUEST_FAILED" },
    );
    fakeStreamChatWithSdk.mockRejectedValue(failure);

    const promise = callLLM(vendorConfig, promptLayers, [{ role: "user", content: "hi" }], [], {
      totalTimeoutMs: 300_000,
    } as never);
    const assertion = expect(promise).rejects.toThrow(/模型服务请求失败/);
    await vi.advanceTimersByTimeAsync(12_100); // 4s + 8s 两次退避

    await assertion;
    expect(fakeStreamChatWithSdk).toHaveBeenCalledTimes(3);
  });

  it("非重试错误（400）立即抛出，不做重试", async () => {
    fakeStreamChatWithSdk.mockRejectedValueOnce(Object.assign(
      new Error("模型服务请求失败。", { cause: apiError(400, "bad request") }),
      { name: "AgentRuntimeError", code: "E_MODEL_REQUEST_FAILED" },
    ));

    const promise = callLLM(vendorConfig, promptLayers, [{ role: "user", content: "hi" }], [], {
      totalTimeoutMs: 300_000,
    } as never);
    const assertion = expect(promise).rejects.toThrow(/模型服务请求失败/);
    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
    expect(fakeStreamChatWithSdk).toHaveBeenCalledTimes(1);
  });
});
