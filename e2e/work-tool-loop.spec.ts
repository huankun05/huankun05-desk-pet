import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { launchApp, waitForWindow, type ElectronApplication } from "./helpers";

/**
 * Work 模式工具回路 E2E：mock LLM（OpenAI 兼容流式 tool_calls）↔ 本地 Harness 执行。
 *
 * 链路：agui.run(work) → CyreneHarness → 流式 tool_calls（read_file）
 *       → 本地工具执行（读真实文件）→ tool result 回喂 → mock 终答。
 *
 * 这是 P1 换脑最重要的行为基线：Work/Code/Learn 的「本地工具执行 +
 * 权限策略 + 会话状态」必须留在壳内，换脑只换模型接入层。此测试证明：
 * - Harness 能消费 OpenAI 流式 tool_calls 并本地执行 read_file；
 * - 工具结果真实回喂（mock 在第二轮请求里校验到文件内容才发终答标记）。
 *
 * 隔离：CYRENE_USER_DATA_DIR 临时目录；citaEnabled 默认关闭，无预处理器调用。
 */

const FINAL_MARKER = "E2E_WORK_TOOL_OK";
const FILE_MARKER = "PLANTED_FILE_MARKER_12345";
const FILE_BODY = `${FILE_MARKER}\n第二行内容\n`;

let app: ElectronApplication;
let mockServer: Server;
let mockPort = 0;
let workspaceDir = "";
let sawToolResult = false;

test.beforeAll(async () => {
  workspaceDir = mkdtempSync(join(tmpdir(), "cyrene-work-e2e-"));
  const plantedPath = join(workspaceDir, "e2e-tool.txt");
  writeFileSync(plantedPath, FILE_BODY, "utf8");

  mockServer = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      const sse = (chunks: string[]) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const c of chunks) res.write(`data: ${JSON.stringify({ choices: [{ delta: c }] })}\n\n`);
        res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
        res.write("data: [DONE]\n\n");
        res.end();
      };
      try {
        const parsed = JSON.parse(body) as {
          messages?: Array<{ role?: string; content?: unknown }>;
        };
        const messages = parsed.messages ?? [];
        const toolMsg = messages.find((m) => m.role === "tool");
        if (toolMsg) {
          // 第二轮：Harness 已本地执行 read_file 并回喂结果
          const content = typeof toolMsg.content === "string" ? toolMsg.content : JSON.stringify(toolMsg.content);
          if (content.includes(FILE_MARKER)) sawToolResult = true;
          sse([{ role: "assistant", content: "" }, { content: FINAL_MARKER }]);
          return;
        }
        if (body.includes('"tools"')) {
          // 第一轮：要求读取种下的文件（流式 tool_calls）
          const args = JSON.stringify({ path: plantedPath });
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    role: "assistant",
                    tool_calls: [{ index: 0, id: "call-e2e-1", type: "function", function: { name: "read_file", arguments: args } }],
                  },
                },
              ],
            })}\n\n`,
          );
          res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
        // 其他辅助请求（记忆/摘要等）：中性回复
        sse([{ role: "assistant", content: "ok" }]);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    });
  });
  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  mockPort = (mockServer.address() as { port: number }).port;

  const userDataDir = mkdtempSync(join(tmpdir(), "cyrene-work-e2e-ud-"));
  mkdirSync(join(userDataDir, "workspaces"), { recursive: true });
  writeFileSync(
    join(userDataDir, "model-settings.json"),
    JSON.stringify({
      mode: "manual",
      provider: "MockE2E",
      baseUrl: `http://127.0.0.1:${mockPort}`,
      model: "mock-model",
      apiKey: "e2e-mock-key",
      perProvider: { MockE2E: { baseUrl: `http://127.0.0.1:${mockPort}`, model: "mock-model", apiKey: "e2e-mock-key" } },
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
    }),
  );

  app = await launchApp({ env: { ...process.env, CYRENE_USER_DATA_DIR: userDataDir } });
});

test.afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => mockServer?.close(() => resolve()));
});

test("Work 模式：Harness 本地执行流式 tool_calls 并回喂工具结果", async () => {
  test.setTimeout(180_000);
  const chatWindow = await waitForWindow(app, /聊天/);
  await chatWindow.waitForLoadState("domcontentloaded");

  const result = await chatWindow.evaluate(
    (wsRoot) =>
      new Promise<{ finished: boolean; error?: string; text: string; wsOk: boolean }>((resolve, reject) => {
        const w = window as unknown as {
          chatStore?: {
            create: (p: unknown) => Promise<Record<string, unknown>>;
            setWorkspace: (id: string, root: string) => Promise<unknown>;
          };
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
          resolve({ finished: false, error: "timeout(150s)", text, wsOk: false });
        }, 150_000);
        void (async () => {
          try {
            const session = await w.chatStore.create({ title: "e2e-work", mode: "work" });
            const sessionId = String(session?.id ?? session?.sessionId ?? "");
            if (!sessionId) throw new Error("会话创建失败");
            const ws = await w.chatStore.setWorkspace(sessionId, wsRoot);
            const wsOk = Boolean((ws as { ok?: boolean })?.ok ?? true);
            await w.agui.run({
              messages: [{ role: "user", content: "请读取 e2e-tool.txt 并告诉我内容" }],
              sessionId,
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
                  wsOk,
                  error: errored ? JSON.stringify(events.find((e) => e.type === "RUN_ERROR")) : undefined,
                  text,
                });
              }
            }, 250);
          } catch (err) {
            clearInterval(poll);
            clearTimeout(deadline);
            unsubscribe();
            resolve({ finished: false, error: String(err), text, wsOk: false });
          }
        })();
      }),
    workspaceDir,
  );

  expect(result.error, `不应出现 RUN_ERROR: ${result.error ?? ""}`).toBeUndefined();
  expect(result.finished, "应收到 RUN_FINISHED").toBeTruthy();
  expect(result.wsOk, "工作区绑定应成功").toBeTruthy();
  expect(sawToolResult, "mock 应在第二轮请求中收到包含文件内容的 tool 结果（证明本地工具真实执行）").toBe(true);
  expect(result.text, "终答应来自 mock 的工具回路完成标记").toContain(FINAL_MARKER);
});
