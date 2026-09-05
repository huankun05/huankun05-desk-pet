import { describe, it, expect, beforeEach, vi } from "vitest";
import { LSPClient, type LSPProcess, type LSPClientConfig } from "./lsp-client";
import { encodeResponse, encodeNotification, LSP_METHODS } from "./lsp-protocol";

// ── Mock LSP 进程 ───────────────────────────────────────────

class MockLSPProcess implements LSPProcess {
  private stdoutCallbacks: ((data: string) => void)[] = [];
  private stderrCallbacks: ((data: string) => void)[] = [];
  private exitCallbacks: ((code: number | null) => void)[] = [];
  private exited = false;
  public writtenData: string[] = [];

  write(data: string): void {
    this.writtenData.push(data);
  }

  onStdout(callback: (data: string) => void): void {
    this.stdoutCallbacks.push(callback);
  }

  onStderr(callback: (data: string) => void): void {
    this.stderrCallbacks.push(callback);
  }

  onExit(callback: (code: number | null) => void): void {
    this.exitCallbacks.push(callback);
  }

  kill(): void {
    this.exited = true;
  }

  isExited(): boolean {
    return this.exited;
  }

  // 测试辅助方法：模拟 stdout 数据
  emitStdout(data: string): void {
    for (const cb of this.stdoutCallbacks) {
      cb(data);
    }
  }

  // 测试辅助方法：模拟进程退出
  emitExit(code: number | null): void {
    this.exited = true;
    for (const cb of this.exitCallbacks) {
      cb(code);
    }
  }

  // 测试辅助方法：获取最后写入的数据
  getLastWritten(): string | null {
    return this.writtenData.length > 0 ? this.writtenData[this.writtenData.length - 1] : null;
  }
}

// ── 测试辅助函数 ─────────────────────────────────────────────

function makeConfig(overrides: Partial<LSPClientConfig> = {}): LSPClientConfig {
  return {
    command: "mock-lsp",
    args: ["--stdio"],
    workspaceRoot: "/workspace",
    initializeTimeout: 1000,
    requestTimeout: 1000,
    ...overrides,
  };
}

function createMockProcessFactory(process: MockLSPProcess) {
  return (_config: LSPClientConfig): LSPProcess => process;
}

// ── 测试用例 ─────────────────────────────────────────────────

describe("LSPClient", () => {
  let mockProcess: MockLSPProcess;
  let client: LSPClient;

  beforeEach(() => {
    mockProcess = new MockLSPProcess();
    client = new LSPClient(makeConfig());
  });

  describe("initial state", () => {
    it("starts in idle state", () => {
      expect(client.getState()).toBe("idle");
    });

    it("returns empty diagnostics before connection", () => {
      expect(client.getDiagnostics("file:///test.ts")).toEqual([]);
      expect(client.getAllDiagnostics().size).toBe(0);
    });
  });

  describe("connect", () => {
    it("successfully initializes the language server", async () => {
      // 模拟 initialize 响应
      setTimeout(() => {
        const response = encodeResponse(1, { capabilities: {} });
        mockProcess.emitStdout(response);
      }, 10);

      await client.connect(createMockProcessFactory(mockProcess));
      expect(client.getState()).toBe("initialized");
    });

    it("sends initialized notification after successful init", async () => {
      setTimeout(() => {
        const response = encodeResponse(1, { capabilities: {} });
        mockProcess.emitStdout(response);
      }, 10);

      await client.connect(createMockProcessFactory(mockProcess));

      // 检查是否发送了 initialized 通知
      const lastWritten = mockProcess.getLastWritten();
      expect(lastWritten).toContain(LSP_METHODS.Initialized);
    });

    it("rejects if initialize returns error", async () => {
      setTimeout(() => {
        const response = encodeResponse(1, undefined, {
          code: -32603,
          message: "Internal error",
        });
        mockProcess.emitStdout(response);
      }, 10);

      await expect(client.connect(createMockProcessFactory(mockProcess))).rejects.toThrow("Initialize failed");
      expect(client.getState()).toBe("error");
    });

    it("rejects if initialize times out", async () => {
      const config = makeConfig({ initializeTimeout: 50 });
      client = new LSPClient(config);

      // 不发送响应，模拟超时
      await expect(client.connect(createMockProcessFactory(mockProcess))).rejects.toThrow("Request timeout");
      expect(client.getState()).toBe("error");
    });

    it("throws if already connected", async () => {
      setTimeout(() => {
        const response = encodeResponse(1, { capabilities: {} });
        mockProcess.emitStdout(response);
      }, 10);

      await client.connect(createMockProcessFactory(mockProcess));
      await expect(client.connect(createMockProcessFactory(mockProcess))).rejects.toThrow("Cannot connect in state");
    });
  });

  describe("sendRequest", () => {
    beforeEach(async () => {
      setTimeout(() => {
        const response = encodeResponse(1, { capabilities: {} });
        mockProcess.emitStdout(response);
      }, 10);
      await client.connect(createMockProcessFactory(mockProcess));
    });

    it("sends a request and receives response", async () => {
      setTimeout(() => {
        const response = encodeResponse(2, { result: "ok" });
        mockProcess.emitStdout(response);
      }, 10);

      const response = await client.sendRequest("textDocument/completion", { textDocument: { uri: "file:///test.ts" } });
      expect(response.id).toBe(2);
      expect(response.result).toEqual({ result: "ok" });
    });

    it("increments request id for each request", async () => {
      setTimeout(() => {
        const response = encodeResponse(2, {});
        mockProcess.emitStdout(response);
      }, 10);
      await client.sendRequest("method1");

      setTimeout(() => {
        const response = encodeResponse(3, {});
        mockProcess.emitStdout(response);
      }, 10);
      await client.sendRequest("method2");

      // 检查请求 id 是否递增
      const written = mockProcess.writtenData;
      const request1 = written.find((w) => w.includes("method1"));
      const request2 = written.find((w) => w.includes("method2"));
      expect(request1).toContain('"id":2');
      expect(request2).toContain('"id":3');
    });

    it("rejects on timeout", async () => {
      const config = makeConfig({ requestTimeout: 50 });
      client = new LSPClient(config);
      setTimeout(() => {
        const response = encodeResponse(1, { capabilities: {} });
        mockProcess.emitStdout(response);
      }, 10);
      await client.connect(createMockProcessFactory(mockProcess));

      // 不发送响应，模拟超时
      await expect(client.sendRequest("slow-method")).rejects.toThrow("Request timeout");
    });

    it("throws if not connected", async () => {
      const disconnectedClient = new LSPClient(makeConfig());
      await expect(disconnectedClient.sendRequest("test")).rejects.toThrow("not connected");
    });
  });

  describe("sendNotification", () => {
    beforeEach(async () => {
      setTimeout(() => {
        const response = encodeResponse(1, { capabilities: {} });
        mockProcess.emitStdout(response);
      }, 10);
      await client.connect(createMockProcessFactory(mockProcess));
    });

    it("sends a notification without waiting for response", () => {
      client.sendNotification("textDocument/didOpen", {
        textDocument: { uri: "file:///test.ts", languageId: "typescript", version: 1, text: "const x = 1;" },
      });

      const lastWritten = mockProcess.getLastWritten();
      expect(lastWritten).toContain("textDocument/didOpen");
      expect(lastWritten).toContain("file:///test.ts");
    });

    it("throws if not connected", () => {
      const disconnectedClient = new LSPClient(makeConfig());
      expect(() => disconnectedClient.sendNotification("test")).toThrow("not connected");
    });
  });

  describe("document sync", () => {
    beforeEach(async () => {
      setTimeout(() => {
        const response = encodeResponse(1, { capabilities: {} });
        mockProcess.emitStdout(response);
      }, 10);
      await client.connect(createMockProcessFactory(mockProcess));
    });

    it("openDocument sends didOpen notification", () => {
      client.openDocument("file:///test.ts", "typescript", 1, "const x = 1;");
      const lastWritten = mockProcess.getLastWritten();
      expect(lastWritten).toContain(LSP_METHODS.TextDocumentDidOpen);
      expect(lastWritten).toContain("typescript");
    });

    it("changeDocument sends didChange notification with full content", () => {
      client.changeDocument("file:///test.ts", 2, "const x = 2;");
      const lastWritten = mockProcess.getLastWritten();
      expect(lastWritten).toContain(LSP_METHODS.TextDocumentDidChange);
      expect(lastWritten).toContain("const x = 2;");
    });

    it("closeDocument sends didClose notification", () => {
      client.closeDocument("file:///test.ts");
      const lastWritten = mockProcess.getLastWritten();
      expect(lastWritten).toContain(LSP_METHODS.TextDocumentDidClose);
    });
  });

  describe("diagnostics", () => {
    beforeEach(async () => {
      setTimeout(() => {
        const response = encodeResponse(1, { capabilities: {} });
        mockProcess.emitStdout(response);
      }, 10);
      await client.connect(createMockProcessFactory(mockProcess));
    });

    it("stores push diagnostics from server", () => {
      const diagnosticsNotification = encodeNotification(
        LSP_METHODS.TextDocumentPublishDiagnostics,
        {
          uri: "file:///test.ts",
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              severity: 1,
              message: "Unexpected token",
              source: "ts",
            },
          ],
        },
      );
      mockProcess.emitStdout(diagnosticsNotification);

      const diagnostics = client.getDiagnostics("file:///test.ts");
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toBe("Unexpected token");
      expect(diagnostics[0].severity).toBe(1);
    });

    it("updates diagnostics for same uri", () => {
      // 第一次诊断
      mockProcess.emitStdout(
        encodeNotification(LSP_METHODS.TextDocumentPublishDiagnostics, {
          uri: "file:///test.ts",
          diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "Error 1" }],
        }),
      );
      expect(client.getDiagnostics("file:///test.ts")).toHaveLength(1);

      // 第二次诊断（更新）
      mockProcess.emitStdout(
        encodeNotification(LSP_METHODS.TextDocumentPublishDiagnostics, {
          uri: "file:///test.ts",
          diagnostics: [
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "Error 1" },
            { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }, message: "Error 2" },
          ],
        }),
      );
      expect(client.getDiagnostics("file:///test.ts")).toHaveLength(2);
    });

    it("clears diagnostics for uri", () => {
      mockProcess.emitStdout(
        encodeNotification(LSP_METHODS.TextDocumentPublishDiagnostics, {
          uri: "file:///test.ts",
          diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "Error" }],
        }),
      );
      expect(client.getDiagnostics("file:///test.ts")).toHaveLength(1);

      client.clearDiagnostics("file:///test.ts");
      expect(client.getDiagnostics("file:///test.ts")).toEqual([]);
    });

    it("returns empty array for uri with no diagnostics", () => {
      expect(client.getDiagnostics("file:///nonexistent.ts")).toEqual([]);
    });

    it("getAllDiagnostics returns all stored diagnostics", () => {
      mockProcess.emitStdout(
        encodeNotification(LSP_METHODS.TextDocumentPublishDiagnostics, {
          uri: "file:///test1.ts",
          diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "Error 1" }],
        }),
      );
      mockProcess.emitStdout(
        encodeNotification(LSP_METHODS.TextDocumentPublishDiagnostics, {
          uri: "file:///test2.ts",
          diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "Error 2" }],
        }),
      );

      const all = client.getAllDiagnostics();
      expect(all.size).toBe(2);
      expect(all.get("file:///test1.ts")).toHaveLength(1);
      expect(all.get("file:///test2.ts")).toHaveLength(1);
    });
  });

  describe("shutdown", () => {
    beforeEach(async () => {
      setTimeout(() => {
        const response = encodeResponse(1, { capabilities: {} });
        mockProcess.emitStdout(response);
      }, 10);
      await client.connect(createMockProcessFactory(mockProcess));
    });

    it("gracefully shuts down the language server", async () => {
      setTimeout(() => {
        const response = encodeResponse(2, null);
        mockProcess.emitStdout(response);
      }, 10);

      await client.shutdown();
      expect(client.getState()).toBe("shutdown");
      expect(mockProcess.isExited()).toBe(true);
    });

    it("sends exit notification after shutdown", async () => {
      setTimeout(() => {
        const response = encodeResponse(2, null);
        mockProcess.emitStdout(response);
      }, 10);

      await client.shutdown();
      const written = mockProcess.writtenData;
      const exitNotification = written.find((w) => w.includes(LSP_METHODS.Exit));
      expect(exitNotification).toBeTruthy();
    });

    it("returns immediately if not initialized", async () => {
      const idleClient = new LSPClient(makeConfig());
      await expect(idleClient.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("code intelligence", () => {
    beforeEach(async () => {
      setTimeout(() => {
        const response = encodeResponse(1, { capabilities: {} });
        mockProcess.emitStdout(response);
      }, 10);
      await client.connect(createMockProcessFactory(mockProcess));
    });

    it("getCompletions returns completion items", async () => {
      setTimeout(() => {
        const response = encodeResponse(2, {
          isIncomplete: false,
          items: [
            { label: "console", kind: 5 },
            { label: "const", kind: 14 },
          ],
        });
        mockProcess.emitStdout(response);
      }, 10);

      const completions = await client.getCompletions("file:///test.ts", { line: 0, character: 5 });
      expect(completions).toHaveLength(2);
      expect(completions[0].label).toBe("console");
      expect(completions[1].label).toBe("const");
    });

    it("getCompletions handles array result", async () => {
      setTimeout(() => {
        const response = encodeResponse(2, [
          { label: "item1" },
          { label: "item2" },
        ]);
        mockProcess.emitStdout(response);
      }, 10);

      const completions = await client.getCompletions("file:///test.ts", { line: 0, character: 0 });
      expect(completions).toHaveLength(2);
    });

    it("getCompletions returns empty array for null result", async () => {
      setTimeout(() => {
        const response = encodeResponse(2, null);
        mockProcess.emitStdout(response);
      }, 10);

      const completions = await client.getCompletions("file:///test.ts", { line: 0, character: 0 });
      expect(completions).toEqual([]);
    });

    it("getCompletions throws on error response", async () => {
      setTimeout(() => {
        const response = encodeResponse(2, undefined, {
          code: -32601,
          message: "Method not found",
        });
        mockProcess.emitStdout(response);
      }, 10);

      await expect(
        client.getCompletions("file:///test.ts", { line: 0, character: 0 }),
      ).rejects.toThrow("Completion failed");
    });

    it("getHover returns hover content", async () => {
      setTimeout(() => {
        const response = encodeResponse(2, {
          contents: "const x: number = 1",
        });
        mockProcess.emitStdout(response);
      }, 10);

      const hover = await client.getHover("file:///test.ts", { line: 0, character: 5 });
      expect(hover).not.toBeNull();
      expect(hover?.contents).toBe("const x: number = 1");
    });

    it("getHover returns null for no hover", async () => {
      setTimeout(() => {
        const response = encodeResponse(2, null);
        mockProcess.emitStdout(response);
      }, 10);

      const hover = await client.getHover("file:///test.ts", { line: 0, character: 0 });
      expect(hover).toBeNull();
    });

    it("getDefinition returns location", async () => {
      setTimeout(() => {
        const response = encodeResponse(2, {
          uri: "file:///definition.ts",
          range: { start: { line: 10, character: 0 }, end: { line: 10, character: 5 } },
        });
        mockProcess.emitStdout(response);
      }, 10);

      const definition = await client.getDefinition("file:///test.ts", { line: 0, character: 5 });
      expect(definition).not.toBeNull();
      expect((definition as { uri: string }).uri).toBe("file:///definition.ts");
    });
  });

  describe("process exit handling", () => {
    it("rejects pending requests when process exits", async () => {
      setTimeout(() => {
        const response = encodeResponse(1, { capabilities: {} });
        mockProcess.emitStdout(response);
      }, 10);
      await client.connect(createMockProcessFactory(mockProcess));

      // 发送一个请求但不响应
      const requestPromise = client.sendRequest("slow-method");

      // 模拟进程退出
      setTimeout(() => {
        mockProcess.emitExit(1);
      }, 10);

      await expect(requestPromise).rejects.toThrow("Language server exited");
    });
  });
});
