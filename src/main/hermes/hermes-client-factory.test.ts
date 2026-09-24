import { describe, expect, it, vi } from "vitest";

/** mock 设置层，避免测试触碰真实配置文件。 */
const settings = {
  apiHost: "127.0.0.1",
  apiPort: 8642,
  apiServerKey: "test-key",
};

vi.mock("./hermes-settings", () => ({
  loadHermesSettings: () => settings,
  resolveEffectiveHermesSettings: (s: typeof settings) => s,
}));

import { runHermesSmoke } from "./hermes-client-factory";
import { HermesClient } from "./hermes-client";

/** 用假 fetch 替换 HermesClient 的真实网络调用。 */
function stubClient(opts: {
  health?: () => Promise<{ ok: boolean; status: number; body: unknown }>;
  chat?: () => Promise<unknown>;
}): void {
  vi.spyOn(HermesClient.prototype, "health").mockImplementation(
    opts.health ?? (async () => ({ ok: true, status: 200, body: { status: "ok" } })),
  );
  vi.spyOn(HermesClient.prototype, "chatCompletions").mockImplementation(
    opts.chat ?? (async () => ({ choices: [{ message: { content: "pong" } }] })),
  );
}

describe("runHermesSmoke", () => {
  it("passes when health and chat both succeed", async () => {
    stubClient({});
    const r = await runHermesSmoke();
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.name)).toEqual(["health", "chat"]);
    expect(r.steps.every((s) => s.ok)).toBe(true);
    expect(r.reply).toBe("pong");
  });

  it("stops at health and reports the failing step", async () => {
    const chat = vi.fn();
    stubClient({
      health: async () => ({ ok: false, status: 0, body: "refused" }),
      chat,
    });
    const r = await runHermesSmoke();
    expect(r.ok).toBe(false);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ name: "health", ok: false });
    expect(r.steps[0].detail).toContain("HTTP 0");
    expect(chat).not.toHaveBeenCalled();
  });

  it("reports chat failure with the error text", async () => {
    stubClient({
      chat: async () => {
        throw new Error("chatCompletions 401: bad key");
      },
    });
    const r = await runHermesSmoke();
    expect(r.ok).toBe(false);
    expect(r.steps[0]).toMatchObject({ name: "health", ok: true });
    expect(r.steps[1]).toMatchObject({ name: "chat", ok: false });
    expect(r.steps[1].detail).toContain("401");
  });

  it("marks chat ok when 200 carries no content", async () => {
    stubClient({ chat: async () => ({ choices: [] }) });
    const r = await runHermesSmoke();
    expect(r.ok).toBe(true);
    expect(r.steps[1]).toMatchObject({ name: "chat", ok: true });
    expect(r.steps[1].detail).toContain("无回复内容");
    expect(r.reply).toBe("");
  });

  it("builds the client from resolved settings", async () => {
    const health = vi.fn(async () => ({ ok: true, status: 200, body: {} }));
    stubClient({ health });
    await runHermesSmoke();
    expect(health).toHaveBeenCalled();
  });
});
