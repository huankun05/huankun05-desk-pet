import { describe, it, expect, vi, beforeEach } from "vitest";

// tool-registry 通过 ../rag/index 间接 import electron；这里 stub 掉避免 electron 二进制检查
vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => "/tmp") },
}));

// mock 整个 SDK,在测试里不需要真连
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: vi.fn(),
}));

const mockStdioConnect = vi.fn().mockResolvedValue(undefined);
const mockSseConnect = vi.fn().mockResolvedValue(undefined);
const mockSseClose = vi.fn().mockResolvedValue(undefined);
const mockStdioClose = vi.fn().mockResolvedValue(undefined);

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn().mockImplementation(function (this: unknown, opts: unknown) {
		return {
			close: mockStdioClose,
			_opts: opts,
		};
	}),
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
	SSEClientTransport: vi.fn().mockImplementation(function (this: unknown, url: unknown) {
		return {
			close: mockSseClose,
			onerror: null as ((err: Error) => void) | null,
			_url: url,
		};
	}),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
	StreamableHTTPClientTransport: vi.fn().mockImplementation(function (this: unknown, url: unknown, opts?: unknown) {
		return {
			close: vi.fn().mockResolvedValue(undefined),
			onerror: null as ((err: Error) => void) | null,
			_url: url,
			_opts: opts,
		};
	}),
}));

// sampling 依赖注入 mock：handler 里的默认 createLlmClient().chatNonStream / loadModelSettings
const mcpMocks = vi.hoisted(() => ({
	chatNonStream: vi.fn(),
	loadSettings: vi.fn(() => ({
		provider: "deepseek",
		baseUrl: "https://api.deepseek.com/v1",
		model: "deepseek-chat",
		apiKey: "test-key",
		explicitTransport: "openai" as const,
	})),
}));

vi.mock("../services/llm/llm-client", () => ({
	createLlmClient: vi.fn(() => ({ chatNonStream: mcpMocks.chatNonStream })),
}));

vi.mock("../settings/model-settings", () => ({
	loadModelSettings: mcpMocks.loadSettings,
}));

import { connectMcpServer, disconnectMcpServer, createMcpSamplingHandler, toVendorMessages } from "./mcp-adapter";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { toolRegistry } from "./tools/registry/tool-registry";

describe("mcp-adapter transport split", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// 清空 registry,避免互相污染
		for (const t of toolRegistry.getAllTools()) toolRegistry.unregister(t.id);
	});

	it("stdio transport uses StdioClientTransport with command/args", async () => {
		const Client = (await import("@modelcontextprotocol/sdk/client/index.js")).Client as any;
		Client.mockImplementation(function (this: unknown) {
			return {
				connect: vi.fn().mockResolvedValue(undefined),
				listTools: vi.fn().mockResolvedValue({ tools: [] }),
				close: vi.fn().mockResolvedValue(undefined),
			};
		});

		await connectMcpServer({
			id: "test-stdio",
			name: "Test Stdio",
			transport: "stdio",
			command: "node",
			args: ["foo.js"],
		});

		expect(StdioClientTransport).toHaveBeenCalledWith({
			command: "node",
			args: ["foo.js"],
			env: undefined,
			cwd: undefined,
		});
		expect(SSEClientTransport).not.toHaveBeenCalled();
	});

	it("sse transport uses SSEClientTransport with URL", async () => {
		const Client = (await import("@modelcontextprotocol/sdk/client/index.js")).Client as any;
		Client.mockImplementation(function (this: unknown) {
			return {
				connect: vi.fn().mockResolvedValue(undefined),
				listTools: vi.fn().mockResolvedValue({ tools: [] }),
				close: vi.fn().mockResolvedValue(undefined),
			};
		});

		await connectMcpServer({
			id: "test-sse",
			name: "Test SSE",
			transport: "sse",
			url: "https://example.com/sse",
		});

		expect(SSEClientTransport).toHaveBeenCalledWith(new URL("https://example.com/sse"));
		expect(StdioClientTransport).not.toHaveBeenCalled();
	});

	it("sse transport without url throws", async () => {
		await expect(
			connectMcpServer({
				id: "test-sse-bad",
				name: "Bad SSE",
				transport: "sse",
			})
		).rejects.toThrow(/sse transport requires url/);
	});

	it("http transport uses StreamableHTTPClientTransport with URL and headers", async () => {
		const Client = (await import("@modelcontextprotocol/sdk/client/index.js")).Client as any;
		Client.mockImplementation(function (this: unknown) {
			return {
				connect: vi.fn().mockResolvedValue(undefined),
				listTools: vi.fn().mockResolvedValue({ tools: [] }),
				close: vi.fn().mockResolvedValue(undefined),
			};
		});

		await connectMcpServer({
			id: "test-http",
			name: "Test HTTP",
			transport: "http",
			url: "https://example.com/mcp",
			headers: { Authorization: "Bearer abc" },
		});

		expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
			new URL("https://example.com/mcp"),
			{ requestInit: { headers: { Authorization: "Bearer abc" } } },
		);
		expect(SSEClientTransport).not.toHaveBeenCalled();
		expect(StdioClientTransport).not.toHaveBeenCalled();
	});

	it("http transport without headers passes undefined options", async () => {
		const Client = (await import("@modelcontextprotocol/sdk/client/index.js")).Client as any;
		Client.mockImplementation(function (this: unknown) {
			return {
				connect: vi.fn().mockResolvedValue(undefined),
				listTools: vi.fn().mockResolvedValue({ tools: [] }),
				close: vi.fn().mockResolvedValue(undefined),
			};
		});

		await connectMcpServer({
			id: "test-http-plain",
			name: "Test HTTP Plain",
			transport: "http",
			url: "https://example.com/mcp",
		});

		expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(new URL("https://example.com/mcp"), {});
	});

	it("http transport without url throws", async () => {
		await expect(
			connectMcpServer({
				id: "test-http-bad",
				name: "Bad HTTP",
				transport: "http",
			})
		).rejects.toThrow(/http transport requires url/);
	});

	it("propagates MCP isError as a failed tool execution", async () => {
		const callTool = vi.fn().mockResolvedValue({
			isError: true,
			content: [{ type: "text", text: "remote tool failed" }],
		});
		const Client = (await import("@modelcontextprotocol/sdk/client/index.js")).Client as any;
		Client.mockImplementation(function (this: unknown) {
			return {
				connect: vi.fn().mockResolvedValue(undefined),
				listTools: vi.fn().mockResolvedValue({
					tools: [{
						name: "explode",
						description: "always fails",
						inputSchema: { type: "object", properties: { value: { type: "string" } } },
					}],
				}),
				callTool,
				close: vi.fn().mockResolvedValue(undefined),
			};
		});

		await connectMcpServer({
			id: "test-error",
			name: "Test Error",
			transport: "stdio",
			command: "node",
			args: ["server.js"],
		});
		const tool = toolRegistry.getById("test-error-explode");

		await expect(tool?.execute({ value: "x" })).rejects.toThrow("E_MCP_TOOL_FAILED");
		expect(callTool).toHaveBeenCalledWith({ name: "explode", arguments: { value: "x" } });
	});
});

describe("mcp-adapter sampling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		for (const t of toolRegistry.getAllTools()) toolRegistry.unregister(t.id);
	});

	it("registers sampling handler on the client when sampling.enabled is true", async () => {
		const setRequestHandler = vi.fn();
		const Client = (await import("@modelcontextprotocol/sdk/client/index.js")).Client as any;
		Client.mockImplementation(function (this: unknown) {
			return {
				connect: vi.fn().mockResolvedValue(undefined),
				listTools: vi.fn().mockResolvedValue({ tools: [] }),
				close: vi.fn().mockResolvedValue(undefined),
				setRequestHandler,
			};
		});

		await connectMcpServer({
			id: "test-sampling",
			name: "Test Sampling",
			transport: "stdio",
			command: "node",
			sampling: { enabled: true },
		});

		expect(setRequestHandler).toHaveBeenCalledTimes(1);
		expect(setRequestHandler.mock.calls[0][0]).toBe(CreateMessageRequestSchema);
	});

	it("does not register sampling handler when disabled", async () => {
		const setRequestHandler = vi.fn();
		const Client = (await import("@modelcontextprotocol/sdk/client/index.js")).Client as any;
		Client.mockImplementation(function (this: unknown) {
			return {
				connect: vi.fn().mockResolvedValue(undefined),
				listTools: vi.fn().mockResolvedValue({ tools: [] }),
				close: vi.fn().mockResolvedValue(undefined),
				setRequestHandler,
			};
		});

		await connectMcpServer({
			id: "test-no-sampling",
			name: "Test No Sampling",
			transport: "stdio",
			command: "node",
		});

		expect(setRequestHandler).not.toHaveBeenCalled();
	});

	it("maps sampling messages + systemPrompt, uses current model and returns assistant text", async () => {
		mcpMocks.chatNonStream.mockResolvedValue({
			text: "模型生成的结果",
			finishReason: "end_turn",
			thinking: undefined,
			refusal: undefined,
			structuredValue: undefined,
		});

		const handler = createMcpSamplingHandler({
			id: "s1",
			name: "Sampling Server",
			transport: "stdio",
			command: "node",
			sampling: { enabled: true, maxTokens: 300 },
		});

		const result = await handler({
			method: "sampling/createMessage",
			params: {
				messages: [
					{ role: "user", content: { type: "text", text: "请总结这段对话" } },
					{ role: "assistant", content: [{ type: "text", text: "好的" }] },
				],
				systemPrompt: "你是总结助手",
				maxTokens: 200,
			},
		});

		expect(mcpMocks.chatNonStream).toHaveBeenCalledWith(
			expect.objectContaining({ model: "deepseek-chat" }),
			[
				{ role: "system", content: "你是总结助手" },
				{ role: "user", content: "请总结这段对话" },
				{ role: "assistant", content: "好的" },
			],
			undefined, // temperature
			expect.any(Number), // timeoutMs
			expect.stringContaining("MCP sampling"),
			undefined, // reasoningOverride
			{ maxTokens: 300 }, // config sampling.maxTokens 优先于 request.maxTokens
		);
		expect(result).toEqual({
			role: "assistant",
			content: { type: "text", text: "模型生成的结果" },
			model: "deepseek-chat",
		});
	});

	it("config sampling.model overrides the active model", async () => {
		mcpMocks.chatNonStream.mockResolvedValue({ text: "ok", finishReason: "end_turn" });

		const handler = createMcpSamplingHandler({
			id: "s2",
			name: "S2",
			transport: "stdio",
			command: "node",
			sampling: { enabled: true, model: "special-model" },
		});

		await handler({
			method: "sampling/createMessage",
			params: { messages: [{ role: "user", content: { type: "text", text: "hi" } }] },
		});

		expect(mcpMocks.chatNonStream).toHaveBeenCalledWith(
			expect.objectContaining({ model: "special-model" }),
			[{ role: "user", content: "hi" }],
			undefined,
			expect.any(Number),
			expect.any(String),
			undefined,
			{ maxTokens: undefined },
		);
	});

	it("skips non-text content blocks when mapping", async () => {
		mcpMocks.chatNonStream.mockResolvedValue({ text: "x", finishReason: "end_turn" });
		const handler = createMcpSamplingHandler({
			id: "s3",
			name: "S3",
			transport: "stdio",
			command: "node",
			sampling: { enabled: true },
		});

		await handler({
			method: "sampling/createMessage",
			params: {
				messages: [
					{
						role: "user",
						content: [
							{ type: "image", data: "base64...", mimeType: "image/png" },
							{ type: "text", text: "文字部分" },
						],
					},
				],
			},
		});

		expect(mcpMocks.chatNonStream).toHaveBeenCalledWith(
			expect.anything(),
			[{ role: "user", content: "文字部分" }],
			undefined,
			expect.any(Number),
			expect.any(String),
			undefined,
			{ maxTokens: undefined },
		);
	});

	it("toVendorMessages joins multiple text blocks", () => {
		const messages = toVendorMessages([
			{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
		]);
		expect(messages).toEqual([{ role: "user", content: "a\nb" }]);
	});
});
