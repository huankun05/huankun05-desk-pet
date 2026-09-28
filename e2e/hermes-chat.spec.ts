import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { launchApp, waitForWindow, type ElectronApplication } from "./helpers";

/**
 * P1 换脑第一刀 E2E：Chat 模式经本地引擎（Hermes gateway）路由。
 *
 * 隔离 userData 中：
 * - model-settings.json 指向死端点（若走了默认 Harness 路径必然失败）；
 * - hermes-settings.json 开启 chatViaHermes、autoStartGateway=false
 *   （不拉起真实网关），指向本地 mock gateway。
 *
 * mock gateway 校验 Bearer 凭据并按 OpenAI 兼容 SSE 返回网关专属标记
 * E2E_HERMES_OK——断言它出现，即证明 Chat 请求真实走了 Hermes 路径。
 */

const HERMES_MARKER = "E2E_HERMES_OK";
const GATEWAY_KEY = "e2e-hermes-key-123456";

let app: ElectronApplication;
let mockGateway: Server;
let mockPort = 0;

test.beforeAll(async () => {
  mockGateway = createServer((req, res) => {
    const auth = req.headers.authorization ?? "";
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
        if (auth !== `Bearer ${GATEWAY_KEY}`) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "bad gateway key" } }));
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n');
        res.write(`data: {"choices":[{"delta":{"content":"${HERMES_MARKER}"}}]}\n\n`);
        res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", platform: "mock-hermes" }));
    });
  });
  await new Promise<void>((resolve) => mockGateway.listen(0, "127.0.0.1", resolve));
  mockPort = (mockGateway.address() as { port: number }).port;

  const userDataDir = mkdtempSync(join(tmpdir(), "cyrene-hermes-e2e-"));
  writeFileSync(
    join(userDataDir, "model-settings.json"),
    JSON.stringify({
      mode: "manual",
      provider: "DeadProvider",
      baseUrl: "http://127.0.0.1:1",
      model: "dead-model",
      apiKey: "dead-key",
      perProvider: { DeadProvider: { baseUrl: "http://127.0.0.1:1", model: "dead-model", apiKey: "dead-key" } },
      runtimeSync: "off",
      stickerEnabled: false,
      stickerSize: "medium",
      stickerSimilarityThreshold: 0.8,
      chatRequestTimeoutSec: 60,
      citaRepairBudgetSec: 8,
      rerankerMode: "none",
      embeddingModel: "bgem3",
      multimodal: false,
      contextWindowTokens: 256000,
    }),
  );
  writeFileSync(
    join(userDataDir, "hermes-settings.json"),
    JSON.stringify({
      chatViaHermes: true,
      autoStartGateway: false,
      apiServerKey: GATEWAY_KEY,
      apiHost: "127.0.0.1",
      apiPort: mockPort,
    }),
  );

  app = await launchApp({ env: { ...process.env, CYRENE_USER_DATA_DIR: userDataDir } });
});

test.afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => mockGateway?.close(() => resolve()));
});

test("Chat 模式经 chatViaHermes 路由到本地引擎网关", async () => {
  test.setTimeout(120_000);
  const chatWindow = await waitForWindow(app, /聊天/);
  await chatWindow.waitForLoadState("domcontentloaded");

  const result = await chatWindow.evaluate(
    (marker) =>
      new Promise<{ finished: boolean; error?: string; text: string }>((resolve, reject) => {
        const w = window as unknown as {
          chatStore?: { create: (p: unknown) => Promise<Record<string, unknown>> };
          agui?: {
            run: (input: unknown) => Promise<{ runId?: string }>;
            onEvent: (cb: (e: Record<string, unknown>) => void) => () => void;
          };
        };
        if (!w.chatStore || !w.agui) return reject(new Error("preload 桥缺失"));
        const events: Array<Record<string, unknown>> = [];
        let text = "";
        const unsubscribe = w.agui.onEvent((event) => {
          events.push(event);
          if (event.type === "TEXT_MESSAGE_CONTENT" && typeof event.delta === "string") text += event.delta;
        });
        const deadline = setTimeout(() => {
          unsubscribe();
          resolve({ finished: false, error: "timeout(90s)", text });
        }, 90_000);
        void (async () => {
          try {
            const session = await w.chatStore.create({ title: "e2e-hermes", mode: "chat" });
            const sessionId = String(session?.id ?? session?.sessionId ?? "");
            if (!sessionId) throw new Error("会话创建失败");
            await w.agui.run({
              messages: [{ role: "user", content: "ping" }],
              sessionId,
              executionMode: "chat",
            });
            const poll = setInterval(() => {
              const finished = events.some((e) => e.type === "RUN_FINISHED");
              const errored = events.some((e) => e.type === "RUN_ERROR");
              if (finished || errored) {
                clearInterval(poll);
                clearTimeout(deadline);
                unsubscribe();
                resolve({
                  finished,
                  error: errored ? JSON.stringify(events.find((e) => e.type === "RUN_ERROR")) : undefined,
                  text,
                });
              }
            }, 200);
          } catch (err) {
            clearInterval(poll);
            clearTimeout(deadline);
            unsubscribe();
            resolve({ finished: false, error: String(err), text });
          }
        })();
      }),
    HERMES_MARKER,
  );

  expect(result.error, `不应出现 RUN_ERROR: ${result.error ?? ""}`).toBeUndefined();
  expect(result.finished, "应收到 RUN_FINISHED").toBeTruthy();
  expect(result.text, "回复应来自 Hermes 网关标记").toContain(HERMES_MARKER);
});
