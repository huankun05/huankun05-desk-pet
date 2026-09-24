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

/** 分片 SSE：每片单独 enqueue，用于验证跨块边界解析。 */
function chunkedSse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("HermesClient", () => {
  it("sends bearer auth and parses health body", async () => {
    const m = mockFetch([() => json({ status: "ok" })]);
    const client = new HermesClient({
      baseUrl: "http://127.0.0.1:8642",
      apiKey: "secret",
      fetchImpl: m.impl as unknown as typeof fetch,
    });
    const h = await client.health();
    expect(h.ok).toBe(true);
    expect(h.status).toBe(200);
    expect(h.body).toEqual({ status: "ok" });
    expect(m.calls[0].url).toBe("http://127.0.0.1:8642/health");
    const headers = m.calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret");
  });

  it("strips trailing slash from baseUrl", async () => {
    const m = mockFetch([() => json({})]);
    const client = new HermesClient({
      baseUrl: "http://127.0.0.1:8642/",
      fetchImpl: m.impl as unknown as typeof fetch,
    });
    await client.health();
    expect(m.calls[0].url).toBe("http://127.0.0.1:8642/health");
  });

  it("returns text body when health payload is not JSON", async () => {
    const m = mockFetch([() => new Response("up", { status: 200 })]);
    const client = new HermesClient({
      baseUrl: "http://127.0.0.1:8642",
      fetchImpl: m.impl as unknown as typeof fetch,
    });
    const h = await client.health();
    expect(h.body).toBe("up");
  });

  it("posts chat completions and returns parsed body", async () => {
    const m = mockFetch([
      () => json({ choices: [{ message: { content: "pong" } }] }),
    ]);
    const client = new HermesClient({
      baseUrl: "http://127.0.0.1:8642",
      apiKey: "k",
      fetchImpl: m.impl as unknown as typeof fetch,
    });
    const res = (await client.chatCompletions([{ role: "user", content: "hi" }])) as {
      choices: Array<{ message: { content: string } }>;
    };
    expect(res.choices[0].message.content).toBe("pong");
    expect(m.calls[0].url).toBe("http://127.0.0.1:8642/v1/chat/completions");
    const init = m.calls[0].init;
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body)) as { stream: boolean; model: string };
    expect(body.stream).toBe(false);
    expect(body.model).toBe("hermes-agent");
  });

  it("throws with status and body on chat failure", async () => {
    const m = mockFetch([() => new Response("bad key", { status: 401 })]);
    const client = new HermesClient({
      baseUrl: "http://127.0.0.1:8642",
      apiKey: "wrong",
      fetchImpl: m.impl as unknown as typeof fetch,
    });
    await expect(
      client.chatCompletions([{ role: "user", content: "hi" }]),
    ).rejects.toThrow(/chatCompletions 401/);
  });

  it("consumes SSE run events and accumulates tokens", async () => {
    const m = mockFetch([
      () => json({ run_id: "run-1" }),
      () =>
        sseBody([
          'event: token\ndata: {"token":"你"}\n\n',
          'event: token\ndata: {"token":"好"}\n\n',
          'event: done\ndata: {"ok":true}\n\n',
        ]),
    ]);
    const client = new HermesClient({
      baseUrl: "http://127.0.0.1:8642",
      apiKey: "k",
      fetchImpl: m.impl as unknown as typeof fetch,
    });
    const seen: string[] = [];
    const events: string[] = [];
    const res = await client.runOnce("hi", {
      onToken: (t) => seen.push(t),
      onEvent: (name) => events.push(name),
    });
    expect(res.runId).toBe("run-1");
    expect(res.text).toBe("你好");
    expect(seen).toEqual(["你", "好"]);
    expect(events).toEqual(["token", "token", "done"]);
    expect(m.calls[1].url).toBe("http://127.0.0.1:8642/v1/runs/run-1/events");
  });

  it("accepts id field as run id", async () => {
    const m = mockFetch([
      () => json({ id: "run-2" }),
      () => sseBody(['data: {"content":"A"}\n\n']),
    ]);
    const client = new HermesClient({
      baseUrl: "http://127.0.0.1:8642",
      apiKey: "k",
      fetchImpl: m.impl as unknown as typeof fetch,
    });
    const res = await client.runOnce("hi");
    expect(res.runId).toBe("run-2");
    expect(res.text).toBe("A");
  });

  it("handles SSE payloads split across chunk boundaries", async () => {
    const m = mockFetch([
      () => json({ run_id: "run-3" }),
      () =>
        chunkedSse([
          'event: token\nda',
          'ta: {"content":"A"}\n\nevent: token\nda',
          'ta: {"content":"B"}\n\n',
        ]),
    ]);
    const client = new HermesClient({
      baseUrl: "http://127.0.0.1:8642",
      apiKey: "k",
      fetchImpl: m.impl as unknown as typeof fetch,
    });
    const res = await client.runOnce("hi");
    expect(res.runId).toBe("run-3");
    expect(res.text).toBe("AB");
  });

  it("ignores SSE blocks without data", async () => {
    const m = mockFetch([
      () => json({ run_id: "run-4" }),
      () => sseBody(["event: ping\n\n", 'data: {"token":"x"}\n\n', "\n"]),
    ]);
    const client = new HermesClient({
      baseUrl: "http://127.0.0.1:8642",
      apiKey: "k",
      fetchImpl: m.impl as unknown as typeof fetch,
    });
    const events: string[] = [];
    const res = await client.runOnce("hi", { onEvent: (n) => events.push(n) });
    expect(res.text).toBe("x");
    expect(events).toEqual(["message"]);
  });

  it("rejects when run creation fails", async () => {
    const m = mockFetch([() => new Response("nope", { status: 500 })]);
    const client = new HermesClient({
      baseUrl: "http://127.0.0.1:8642",
      apiKey: "k",
      fetchImpl: m.impl as unknown as typeof fetch,
    });
    await expect(client.runOnce("hi")).rejects.toThrow(/POST \/v1\/runs 500/);
  });

  it("rejects when run creation omits the run id", async () => {
    const m = mockFetch([() => json({})]);
    const client = new HermesClient({
      baseUrl: "http://127.0.0.1:8642",
      apiKey: "k",
      fetchImpl: m.impl as unknown as typeof fetch,
    });
    await expect(client.runOnce("hi")).rejects.toThrow(/missing run id/);
  });

  it("rejects when the events stream is not ok", async () => {
    const m = mockFetch([
      () => json({ run_id: "run-5" }),
      () => new Response("gone", { status: 404 }),
    ]);
    const client = new HermesClient({
      baseUrl: "http://127.0.0.1:8642",
      apiKey: "k",
      fetchImpl: m.impl as unknown as typeof fetch,
    });
    await expect(client.runOnce("hi")).rejects.toThrow(/GET events 404/);
  });
});
