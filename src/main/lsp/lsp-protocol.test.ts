import { describe, it, expect } from "vitest";
import {
  encodeLSPMessage,
  encodeRequest,
  encodeNotification,
  encodeResponse,
  decodeLSPMessage,
  decodeAllLSPMessages,
  isRequest,
  isResponse,
  isNotification,
  LSPDecodeError,
  LSP_ERROR_CODES,
  DiagnosticSeverity,
  type LSPMessage,
  type LSPRequest,
  type LSPResponse,
  type LSPNotification,
} from "./lsp-protocol";

// ── 编码测试 ─────────────────────────────────────────────────

describe("lsp-protocol encoding", () => {
  it("encodes a request message with correct Content-Length", () => {
    const message: LSPRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { processId: null },
    };
    const encoded = encodeLSPMessage(message);
    expect(encoded).toContain("Content-Length:");
    expect(encoded).toContain("\r\n\r\n");

    // 验证 Content-Length 正确
    const headerEnd = encoded.indexOf("\r\n\r\n");
    const header = encoded.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/);
    expect(match).not.toBeNull();
    const contentLength = parseInt(match![1], 10);
    const body = encoded.slice(headerEnd + 4);
    expect(Buffer.byteLength(body, "utf-8")).toBe(contentLength);
  });

  it("encodeRequest creates a valid request", () => {
    const encoded = encodeRequest(1, "textDocument/completion", { textDocument: { uri: "file:///test.ts" } });
    expect(encoded).toContain("textDocument/completion");
    expect(encoded).toContain("file:///test.ts");
  });

  it("encodeRequest without params omits params field", () => {
    const encoded = encodeRequest(1, "shutdown");
    const body = JSON.parse(encoded.split("\r\n\r\n")[1]);
    expect(body.params).toBeUndefined();
  });

  it("encodeNotification creates a notification without id", () => {
    const encoded = encodeNotification("initialized", {});
    const body = JSON.parse(encoded.split("\r\n\r\n")[1]);
    expect(body.id).toBeUndefined();
    expect(body.method).toBe("initialized");
  });

  it("encodeResponse with result creates a success response", () => {
    const encoded = encodeResponse(1, { capabilities: {} });
    const body = JSON.parse(encoded.split("\r\n\r\n")[1]);
    expect(body.id).toBe(1);
    expect(body.result).toEqual({ capabilities: {} });
    expect(body.error).toBeUndefined();
  });

  it("encodeResponse with error creates an error response", () => {
    const encoded = encodeResponse(1, undefined, {
      code: LSP_ERROR_CODES.MethodNotFound,
      message: "Method not found",
    });
    const body = JSON.parse(encoded.split("\r\n\r\n")[1]);
    expect(body.error.code).toBe(LSP_ERROR_CODES.MethodNotFound);
    expect(body.error.message).toBe("Method not found");
  });

  it("handles Unicode characters in Content-Length", () => {
    const message: LSPRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "test",
      params: { text: "你好世界" },
    };
    const encoded = encodeLSPMessage(message);
    const headerEnd = encoded.indexOf("\r\n\r\n");
    const header = encoded.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/);
    const contentLength = parseInt(match![1], 10);
    const body = encoded.slice(headerEnd + 4);
    expect(Buffer.byteLength(body, "utf-8")).toBe(contentLength);
    // 中文字符每个占 3 字节
    expect(contentLength).toBeGreaterThan(body.length);
  });
});

// ── 解码测试 ─────────────────────────────────────────────────

describe("lsp-protocol decoding", () => {
  it("decodes a complete message", () => {
    const original: LSPRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { processId: 123 },
    };
    const encoded = encodeLSPMessage(original);
    const result = decodeLSPMessage(encoded);
    expect(result).not.toBeNull();
    expect(result!.message).toEqual(original);
    expect(result!.remaining).toBe("");
  });

  it("returns null for incomplete header", () => {
    const result = decodeLSPMessage("Content-Length: 100\r\n");
    expect(result).toBeNull();
  });

  it("returns null for incomplete body", () => {
    const original: LSPRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "test",
    };
    const encoded = encodeLSPMessage(original);
    // 截断 body
    const truncated = encoded.slice(0, encoded.length - 5);
    const result = decodeLSPMessage(truncated);
    expect(result).toBeNull();
  });

  it("throws LSPDecodeError for missing Content-Length", () => {
    expect(() => decodeLSPMessage("Invalid-Header: value\r\n\r\n{}")).toThrow(LSPDecodeError);
  });

  it("throws LSPDecodeError for invalid JSON", () => {
    const invalid = "Content-Length: 5\r\n\r\n{invalid}";
    expect(() => decodeLSPMessage(invalid)).toThrow(LSPDecodeError);
  });

  it("throws LSPDecodeError for invalid jsonrpc version", () => {
    const invalid = 'Content-Length: 25\r\n\r\n{"jsonrpc":"1.0","method":"test"}';
    expect(() => decodeLSPMessage(invalid)).toThrow(LSPDecodeError);
  });

  it("preserves remaining buffer after decoding", () => {
    const msg1: LSPRequest = { jsonrpc: "2.0", id: 1, method: "test1" };
    const msg2: LSPRequest = { jsonrpc: "2.0", id: 2, method: "test2" };
    const combined = encodeLSPMessage(msg1) + encodeLSPMessage(msg2);
    const result = decodeLSPMessage(combined);
    expect(result).not.toBeNull();
    expect(result!.message.method).toBe("test1");
    expect(result!.remaining).not.toBe("");
  });
});

// ── decodeAllLSPMessages 测试 ────────────────────────────────

describe("decodeAllLSPMessages", () => {
  it("decodes multiple messages from buffer", () => {
    const msg1: LSPRequest = { jsonrpc: "2.0", id: 1, method: "test1" };
    const msg2: LSPRequest = { jsonrpc: "2.0", id: 2, method: "test2" };
    const msg3: LSPNotification = { jsonrpc: "2.0", method: "test3" };
    const combined = encodeLSPMessage(msg1) + encodeLSPMessage(msg2) + encodeLSPMessage(msg3);
    const result = decodeAllLSPMessages(combined);
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].method).toBe("test1");
    expect(result.messages[1].method).toBe("test2");
    expect(result.messages[2].method).toBe("test3");
    expect(result.remaining).toBe("");
  });

  it("returns remaining incomplete message", () => {
    const msg1: LSPRequest = { jsonrpc: "2.0", id: 1, method: "test1" };
    const msg2: LSPRequest = { jsonrpc: "2.0", id: 2, method: "test2" };
    const combined = encodeLSPMessage(msg1) + encodeLSPMessage(msg2);
    const truncated = combined.slice(0, combined.length - 10);
    const result = decodeAllLSPMessages(truncated);
    expect(result.messages).toHaveLength(1);
    expect(result.remaining).not.toBe("");
  });

  it("returns empty for empty buffer", () => {
    const result = decodeAllLSPMessages("");
    expect(result.messages).toHaveLength(0);
    expect(result.remaining).toBe("");
  });
});

// ── 消息分类测试 ─────────────────────────────────────────────

describe("message classification", () => {
  it("isRequest identifies request messages", () => {
    const request: LSPRequest = { jsonrpc: "2.0", id: 1, method: "test" };
    expect(isRequest(request)).toBe(true);
    expect(isResponse(request)).toBe(false);
    expect(isNotification(request)).toBe(false);
  });

  it("isResponse identifies response messages", () => {
    const response: LSPResponse = { jsonrpc: "2.0", id: 1, result: {} };
    expect(isResponse(response)).toBe(true);
    expect(isRequest(response)).toBe(false);
    expect(isNotification(response)).toBe(false);
  });

  it("isResponse identifies error responses", () => {
    const response: LSPResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    };
    expect(isResponse(response)).toBe(true);
  });

  it("isNotification identifies notification messages", () => {
    const notification: LSPNotification = { jsonrpc: "2.0", method: "test" };
    expect(isNotification(notification)).toBe(true);
    expect(isRequest(notification)).toBe(false);
    expect(isResponse(notification)).toBe(false);
  });
});

// ── 常量测试 ─────────────────────────────────────────────────

describe("constants", () => {
  it("LSP_ERROR_CODES has correct values", () => {
    expect(LSP_ERROR_CODES.ParseError).toBe(-32700);
    expect(LSP_ERROR_CODES.InvalidRequest).toBe(-32600);
    expect(LSP_ERROR_CODES.MethodNotFound).toBe(-32601);
    expect(LSP_ERROR_CODES.InvalidParams).toBe(-32602);
    expect(LSP_ERROR_CODES.InternalError).toBe(-32603);
    expect(LSP_ERROR_CODES.ContentModified).toBe(-32801);
    expect(LSP_ERROR_CODES.RequestCancelled).toBe(-32800);
  });

  it("DiagnosticSeverity has correct values", () => {
    expect(DiagnosticSeverity.Error).toBe(1);
    expect(DiagnosticSeverity.Warning).toBe(2);
    expect(DiagnosticSeverity.Information).toBe(3);
    expect(DiagnosticSeverity.Hint).toBe(4);
  });
});
