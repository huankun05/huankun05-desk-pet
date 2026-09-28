import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { launchApp, waitForWindow, type ElectronApplication } from "./helpers";

/**
 * 对话回路 E2E（Chat 模式）：mock OpenAI 兼容服务 ↔ 真实主进程链路。
 *
 * 链路：preload agui.run → IPC.AGUI_RUN → agui-bridge → CyreneAgent
 *       （chat loop）→ OpenAI 兼容 vendor 适配器 → 本地 mock 服务。
 *
 * 隔离措施：
 * - CYRENE_USER_DATA_DIR 指向临时目录，不触碰真实用户配置；
 * - model-settings.json 指向 mock 端点（未知 provider 自动落到
 *   OpenAI 兼容 generic 能力，explicitTransport 固定 openai）；
 * - 贴纸/Reranker 关闭、无 Embedding 时功能自动降级，保证离线确定性。
 *
 * mock 回复标记 E2E_MOCK_REPLY_OK：断言从 RUN_FINISHED 前的事件流中
 * 收到的文本（TEXT_MESSAGE_CONTENT.delta 等），证明模型回复真实流回。
 */

const REPLY_MARKER = "E2E_MOCK_REPLY_OK";
const USER_TEXT = "e2e-ping，请原样回复标记";

let app: ElectronApplication;
let mockServer: Server;
let mockPort = 0;
let userDataDir = "";
let receivedPrompts: string[] = [];

test.beforeAll(async () => {
  // mock OpenAI 兼容服务：POST *（chat/completions）+ GET /v1/models
  mockServer = createServer((req, res) => {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "mock-model" }] }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        receivedPrompts.push(body);
        const parsed = JSON.parse(body || "{}") as { stream?: boolean };
        if (parsed.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          const chunk = (delta: Record<string, unknown>, finish?: string) =>
            `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish ?? null }] })}\n\n`;
          res.write(chunk({ role: "assistant", content: "" }));
          res.write(chunk({ content: REPLY_MARKER.slice(0, 8) }));
          res.write(chunk({ content: REPLY_MARKER.slice(8) }, "stop"));
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 16, completion_tokens: 4, total_tokens: 20 } })}\n\n`,
          );
          res.write("data: [DONE]\n\n");
          res.end();
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [{ message: { role: "assistant", content: REPLY_MARKER }, finish_reason: "stop" }],
              usage: { prompt_tokens: 16, completion_tokens: 4, total_tokens: 20 },
            }),
          );
        }
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    });
  });
  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  mockPort = (mockServer.address() as { port: number }).port;

  // 临时 userData：写入指向 mock 的模型设置（明文 key 读取兼容）
  userDataDir = mkdtempSync(join(tmpdir(), "cyrene-e2e-"));
  const baseUrl = `http://127.0.0.1:${mockPort}`;
  const providerSettings = {
    mode: "manual",
    provider: "MockE2E",
    baseUrl,
    model: "mock-model",
    apiKey: "e2e-mock-key",
    explicitTransport: "openai",
    perProvider: {
      MockE2E: { baseUrl, model: "mock-model", apiKey: "e2e-mock-key", explicitTransport: "openai" },
    },
    runtimeSync: "off",
    stickerEnabled: false,
    stickerSize: "medium",
    stickerSimilarityThreshold: 0.8,
    chatRequestTimeoutSec: 120,
    citaRepairBudgetSec: 8,
    rerankerMode: "none",
    embeddingModel: "bgem3",
    multimodal: false,
    contextWindowTokens: 256000,
  };
  writeFileSync(join(userDataDir, "model-settings.json"), JSON.stringify(providerSettings, null, 2));

  app = await launchApp({ env: { ...process.env, CYRENE_USER_DATA_DIR: userDataDir } });
});

test.afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => mockServer?.close(() => resolve()));
});

test("Chat 对话回路：mock LLM 回复经完整链路流回", async () => {
  test.setTimeout(120_000);
  const chatWindow = await waitForWindow(app, /聊天/);
  await chatWindow.waitForLoadState("domcontentloaded");

  // 在聊天窗页面内：创建 chat 会话 → agui.run → 等待 RUN_FINISHED，收集事件文本
  const result = await chatWindow.evaluate(
    ({ userText, marker }) =>
      new Promise<{ finished: boolean; error?: string; text: string; ackOk: boolean }>((resolve, reject) => {
        const w = window as unknown as {
          chatStore?: { create: (p: unknown) => Promise<Record<string, unknown>> };
          agui?: {
            run: (input: unknown) => Promise<{ runId?: string }>;
            onEvent: (cb: (e: Record<string, unknown>) => void) => () => void;
          };
        };
        if (!w.chatStore || !w.agui) return reject(new Error("preload 桥缺失（chatStore/agui）"));

        const events: Array<Record<string, unknown>> = [];
        let text = "";
        const unsubscribe = w.agui.onEvent((event) => {
          events.push(event);
          if (event.type === "TEXT_MESSAGE_CONTENT" && typeof event.delta === "string") {
            text += event.delta;
          }
        });

        const deadline = setTimeout(() => {
          unsubscribe();
          resolve({ finished: false, error: "timeout(90s)", text, ackOk: false });
        }, 90_000);

        void (async () => {
          try {
            const session = await w.chatStore.create({ title: "e2e-mock", mode: "chat" });
            const sessionId = String(session?.id ?? session?.sessionId ?? "");
            if (!sessionId) throw new Error("会话创建失败：无 id");
            const ack = await w.agui.run({
              messages: [{ role: "user", content: userText }],
              sessionId,
              executionMode: "chat",
            });
            // 轮询等待 RUN_FINISHED / RUN_ERROR
            const poll = setInterval(() => {
              const finished = events.some((e) => e.type === "RUN_FINISHED");
              const errored = events.some((e) => e.type === "RUN_ERROR");
              if (finished || errored) {
                clearInterval(poll);
                clearTimeout(deadline);
                unsubscribe();
                resolve({
                  finished,
                  ackOk: Boolean(ack?.runId),
                  error: errored
                    ? JSON.stringify(events.find((e) => e.type === "RUN_ERROR"))
                    : undefined,
                  text,
                });
              }
            }, 200);
          } catch (err) {
            clearInterval(poll);
            clearTimeout(deadline);
            unsubscribe();
            resolve({ finished: false, ackOk: false, error: String(err), text });
          }
        })();
      }),
    { userText: USER_TEXT, marker: REPLY_MARKER },
  );

  expect(result.ackOk, "AGUI_RUN 应返回 runId ack").toBeTruthy();
  expect(result.error, `不应出现 RUN_ERROR: ${result.error ?? ""}`).toBeUndefined();
  expect(result.finished, "应收到 RUN_FINISHED 终态事件").toBeTruthy();
  expect(result.text, "事件流应包含 mock 回复标记").toContain(REPLY_MARKER);

  // mock 服务确实收到了包含用户消息的请求
  await expect.poll(() => receivedPrompts.some((b) => b.includes("e2e-ping"))).toBe(true);
});
