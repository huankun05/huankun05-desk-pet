import { describe, expect, it } from "vitest";
import { HermesClient } from "./hermes-client";

/** mock fetch：记录调用，按队列依次返回响应。 */
function mockFetch(responses: Array<() => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const impl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    const make = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return Promise.resolve(make());
  };
  return { impl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** 构造 SSE 响应体（text/event-stream）。 */
function sseBody(blocks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const b of blocks) controller.enqueue(enc.encode(b));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

/** 把 SSE 块切成固定大小字节块（模拟跨 chunk 边界）。 */
function chunkedSse(parts: string[]): Response {
  const enc = new TextEncoder();
  const bytes = enc.encode(parts.join(""));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const size = 7;
      for (let i = 0; i < bytes.length; i += size) {
        controller.enqueue(bytes.slice(i, i + size));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function client(m: ReturnType<typeof mockFetch>): HermesClient {
  return new HermesClient({
    baseUrl: "http://127.0.0.1:8642",
    apiKey: "k",
    fetchImpl: m.impl as unknown as typeof fetch,
  });
}

describe("HermesClient", () => {
  it("health parses ok response", async () => {
    const m = mockFetch([() => json({ status: "ok", platform: "hermes-agent", version: "0.21.3" })]);
    const res = await client(m).health();
    expect(res.ok).toBe(true);
    expect(res.body).toMatchObject({ status: "ok" });
  });

  it("chatCompletions posts openai-compatible body", async () => {
    const m = mockFetch([
      () => json({ choices: [{ message: { role: "assistant", content: "hey" } }] }),
    ]);
    const res = (await client(m).chatCompletions([{ role: "user", content: "hi" }])) as {
      choices: Array<{ message: { content: string } }>;
    };
    expect(res.choices[0].message.content).toBe("hey");
    expect(String(m.calls[0].init?.body)).toContain('"stream":false');
  });

  it("chatCompletions rejects non-2xx", async () => {
    const m = mockFetch([() => new Response("unauthorized", { status: 401 })]);
    await expect(
      client(m).chatCompletions([{ role: "user", content: "hi" }]),
    ).rejects.toThrow(/chatCompletions 401/);
  });

  it("consumes agent-run SSE events and accumulates deltas", async () => {
    const m = mockFetch([
      () => json({ run_id: "run-1", session_id: "sess-1" }),
      () =>
        sseBody([
          'data: {"event":"message.delta","run_id":"run-1","delta":"你"}\n\n',
          'data: {"event":"message.delta","run_id":"run-1","delta":"好"}\n\n',
          'data: {"event":"run.completed","run_id":"run-1","output":"你好"}\n\n',
          ": stream closed\n\n",
        ]),
    ]);
    const seen: string[] = [];
    const events: string[] = [];
    const res = await client(m).runOnce("hi", {
      onToken: (t) => seen.push(t),
      onEvent: (name) => events.push(name),
    });
    expect(res.runId).toBe("run-1");
    expect(res.sessionId).toBe("sess-1");
    expect(res.text).toBe("你好");
    expect(seen).toEqual(["你", "好"]);
    expect(events).toEqual(["message.delta", "message.delta", "run.completed"]);
    // 真实网关协议：请求体是 input（不是 message）
    expect(String(m.calls[0].init?.body)).toContain('"input":"hi"');
    expect(m.calls[1].url).toBe("http://127.0.0.1:8642/v1/runs/run-1/events");
  });

  it("passes session/instructions/history overrides in the run body", async () => {
    const m = mockFetch([
      () => json({ run_id: "run-o" }),
      () => sseBody(['data: {"event":"run.completed","output":"ok"}\n\n']),
    ]);
    await client(m).runOnce({
      input: "hi",
      sessionId: "pet-1",
      instructions: "你是昔涟",
      conversationHistory: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      model: "mock-model",
    });
    const body = String(m.calls[0].init?.body);
    expect(body).toContain('"session_id":"pet-1"');
    expect(body).toContain('"instructions":"你是昔涟"');
    expect(body).toContain('"conversation_history"');
    expect(body).toContain('"model":"mock-model"');
  });

  it("falls back to run.completed output when no deltas arrived", async () => {
    const m = mockFetch([
      () => json({ id: "run-2" }),
      () => sseBody(['data: {"event":"run.completed","output":"A"}\n\n']),
    ]);
    const res = await client(m).runOnce("hi");
    expect(res.runId).toBe("run-2");
    expect(res.text).toBe("A");
    expect(res.output).toBe("A");
  });

  it("handles SSE payloads split across chunk boundaries", async () => {
    const m = mockFetch([
      () => json({ run_id: "run-3" }),
      () =>
        chunkedSse([
          'data: {"event":"message.delta","de',
          'lta":"A"}\n\ndata: {"event":"message.delta","de',
          'lta":"B"}\n\n',
        ]),
    ]);
    const res = await client(m).runOnce("hi");
    expect(res.runId).toBe("run-3");
    expect(res.text).toBe("AB");
  });

  it("ignores keepalive comments and blocks without data", async () => {
    const m = mockFetch([
      () => json({ run_id: "run-4" }),
      () => sseBody([": keepalive\n\n", 'data: {"event":"message.delta","delta":"x"}\n\n', "\n"]),
    ]);
    const events: string[] = [];
    const res = await client(m).runOnce("hi", { onEvent: (n) => events.push(n) });
    expect(res.text).toBe("x");
    expect(events).toEqual(["message.delta"]);
  });

  it("rejects when the gateway reports run.failed", async () => {
    const m = mockFetch([
      () => json({ run_id: "run-f" }),
      () => sseBody(['data: {"event":"run.failed","error":"model unavailable"}\n\n']),
    ]);
    await expect(client(m).runOnce("hi")).rejects.toThrow(/hermes run failed: model unavailable/);
  });

  it("rejects when run creation fails", async () => {
    const m = mockFetch([() => new Response("nope", { status: 500 })]);
    await expect(client(m).runOnce("hi")).rejects.toThrow(/POST \/v1\/runs 500/);
  });

  it("rejects when run creation omits the run id", async () => {
    const m = mockFetch([() => json({})]);
    await expect(client(m).runOnce("hi")).rejects.toThrow(/missing run id/);
  });

  it("rejects when the events stream is not ok", async () => {
    const m = mockFetch([
      () => json({ run_id: "run-5" }),
      () => new Response("gone", { status: 404 }),
    ]);
    await expect(client(m).runOnce("hi")).rejects.toThrow(/GET events 404/);
  });
});
