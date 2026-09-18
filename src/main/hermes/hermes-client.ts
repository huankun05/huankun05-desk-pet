/**
 * HermesClient — P0 最小骨架（对接官方 gateway API server）
 *
 * 协议：http://localhost:<port> + Header: Authorization: Bearer <API_SERVER_KEY>
 * 文档：desk-pet/docs/architecture/hermes-integration.md
 *
 * 本阶段只做：health / chat completions / runs SSE，不接 UI、不改 Harness。
 */

export type HermesClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

export type HermesHealth = {
  ok: boolean;
  status: number;
  body: unknown;
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type RunStreamHandlers = {
  onEvent?: (name: string, data: unknown) => void;
  onToken?: (token: string) => void;
};

function defaultBaseUrl(): string {
  return process.env.HERMES_API_BASE_URL ?? "http://127.0.0.1:8642";
}

function defaultApiKey(): string {
  return process.env.API_SERVER_KEY ?? process.env.HERMES_API_KEY ?? "";
}

export class HermesClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HermesClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? defaultBaseUrl()).replace(/\/$/, "");
    this.apiKey = options.apiKey ?? defaultApiKey();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async health(): Promise<HermesHealth> {
    const res = await this.fetchImpl(`${this.baseUrl}/health`, {
      headers: this.headers(),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return { ok: res.ok, status: res.status, body };
  }

  /** OpenAI-compatible non-stream chat（冒烟用） */
  async chatCompletions(messages: ChatMessage[], model?: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: model ?? process.env.HERMES_MODEL ?? "hermes-agent",
        messages,
        stream: false,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`chatCompletions ${res.status}: ${text.slice(0, 400)}`);
    }
    return JSON.parse(text);
  }

  /**
   * 启动 Agent Run（POST /v1/runs）并消费 SSE。
   * 返回 run_id 与累计文本。
   */
  async runOnce(userMessage: string, handlers: RunStreamHandlers = {}): Promise<{
    runId: string;
    text: string;
  }> {
    const create = await this.fetchImpl(`${this.baseUrl}/v1/runs`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ message: userMessage }),
    });
    const createText = await create.text();
    if (!create.ok) {
      throw new Error(`POST /v1/runs ${create.status}: ${createText.slice(0, 400)}`);
    }
    const created = JSON.parse(createText) as { run_id?: string; id?: string };
    const runId = created.run_id ?? created.id ?? "";
    if (!runId) {
      throw new Error(`POST /v1/runs missing run id: ${createText.slice(0, 200)}`);
    }

    const eventsUrl = `${this.baseUrl}/v1/runs/${encodeURIComponent(runId)}/events`;
    const res = await this.fetchImpl(eventsUrl, { headers: this.headers() });
    if (!res.ok || !res.body) {
      throw new Error(`GET events ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";

    const emitSseBlock = (block: string) => {
      const lines = block.split(/\r?\n/);
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) return;
      let parsed: unknown = data;
      try {
        parsed = JSON.parse(data);
      } catch {
        /* raw */
      }
      handlers.onEvent?.(event, parsed);
      const obj = parsed as { token?: string; content?: string; text?: string; delta?: string };
      const chunk = obj.token ?? obj.delta ?? obj.content ?? obj.text;
      if (typeof chunk === "string" && chunk) {
        text += chunk;
        handlers.onToken?.(chunk);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\n\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) emitSseBlock(part);
    }
    if (buffer.trim()) emitSseBlock(buffer);

    return { runId, text };
  }
}
