import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { trace, preparePlanRunContext, buildHarnessPromptLayers, materializeHarnessStartTranscript, runStore } = vi.hoisted(() => ({
  trace: [] as string[],
  preparePlanRunContext: vi.fn(),
  buildHarnessPromptLayers: vi.fn(),
  materializeHarnessStartTranscript: vi.fn(),
  runStore: { create: vi.fn() },
}));

vi.mock("./plan-lifecycle", () => ({ preparePlanRunContext }));
vi.mock("./prompt-builder", () => ({ buildHarnessPromptLayers, materializeHarnessStartTranscript }));
vi.mock("../run-store", () => ({ getHarnessRunStore: vi.fn(() => runStore) }));
vi.mock("../run-recovery", () => ({ prepareHarnessRecovery: vi.fn() }));
vi.mock("../../tools/registry/tool-registry", () => ({
  toolRegistry: { getEnabledTools: vi.fn(() => []) },
}));
vi.mock("electron", () => ({ app: { getPath: vi.fn(() => "C:\\cyrene-preparation") } }));

import { prepareHarnessRun } from "./run-preparation";

describe("harness run preparation", () => {
  beforeEach(() => {
    trace.length = 0;
    preparePlanRunContext.mockReset();
    preparePlanRunContext.mockResolvedValue({ planState: undefined });
    buildHarnessPromptLayers.mockReset();
    buildHarnessPromptLayers.mockReturnValue({
      stablePrefix: "stable",
      runtimeContext: "runtime",
      mode: "work",
    });
    materializeHarnessStartTranscript.mockReset();
    materializeHarnessStartTranscript.mockImplementation((input) => {
      trace.push("materialize");
      return [...input.messages, { role: "user", content: "materialized" }];
    });
    runStore.create.mockReset();
    runStore.create.mockImplementation(() => trace.push("create"));
  });

  it("materializes the startup transcript before creating the run store", async () => {
    const prepared = await prepareHarnessRun({
      runId: "run-preparation",
      conversationId: "thread-1",
      conversationMode: "work",
      settings: { provider: "test", baseUrl: "", model: "model", apiKey: "" },
      messages: [{ role: "user", content: "开始" }],
      toolSystemContent: "",
      soulSystemBaseContent: "persona",
    } as never, new AbortController().signal);

    expect(trace).toEqual(["materialize", "create"]);
    expect(prepared.runId).toBe("run-preparation");
    expect(prepared.systemPrompt).toBe("stable");
    expect(runStore.create).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "thread-1",
      runId: "run-preparation",
      messages: expect.arrayContaining([{ role: "user", content: "materialized" }]),
    }));
  });

  it("injects AGENTS.md workspace context into the startup transcript for code mode", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-run-prep-"));
    try {
      fs.writeFileSync(path.join(root, "AGENTS.md"), "构建命令：npm run build", "utf8");

      await prepareHarnessRun({
        runId: "run-code",
        conversationId: "thread-1",
        conversationMode: "code",
        settings: { provider: "test", baseUrl: "", model: "model", apiKey: "" },
        messages: [{ role: "user", content: "改代码" }],
        toolSystemContent: "",
        soulSystemBaseContent: "persona",
        resolvedWorkspaceRoot: root,
      } as never, new AbortController().signal);

      expect(materializeHarnessStartTranscript).toHaveBeenCalledWith(expect.objectContaining({
        runtimeContext: expect.stringContaining("[WORKSPACE_CONTEXT]"),
      }));
      expect(materializeHarnessStartTranscript).toHaveBeenCalledWith(expect.objectContaining({
        runtimeContext: expect.stringContaining("npm run build"),
      }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not inject workspace context for chat mode or an unbound workspace", async () => {
    await prepareHarnessRun({
      runId: "run-chat",
      conversationId: "thread-1",
      conversationMode: "chat",
      settings: { provider: "test", baseUrl: "", model: "model", apiKey: "" },
      messages: [{ role: "user", content: "聊聊" }],
      toolSystemContent: "",
      soulSystemBaseContent: "persona",
      resolvedWorkspaceRoot: "E:\\some-root",
    } as never, new AbortController().signal);

    expect(materializeHarnessStartTranscript).toHaveBeenCalledWith(expect.objectContaining({
      runtimeContext: "runtime",
    }));
  });
});
