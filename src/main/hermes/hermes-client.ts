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

export type HermesRunInput = {
  input: string;
  /** 会话 id：网关按此持久化/加载历史 */
  sessionId?: string;
  /** 单次 run 的附加 system prompt（追加在网关基础人格之后） */
  instructions?: string;
  /** 显式对话历史（优先级最高，覆盖网关会话历史） */
  conversationHistory?: ChatMessage[];
  /** 请求级模型覆盖（缺省用网关 config.yaml model.default） */
  model?: string;
};

export type HermesRunResult = {
  runId: string;
  sessionId: string;
  text: string;
  /** run.completed 携带的完整输出（与 text 一致或为空） */
  output?: string;
};

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
 *
 * 协议（gateway/platforms/api_server_runs.py）：
 * - 请求体 `{ input, session_id?, instructions?, conversation_history?, model? }`，
 *   202 返回 `{ run_id, session_id? }`；
 * - GET /v1/runs/{id}/events：每帧 `data: {"event": "<name>", ...}`，
 *   token 流为 `message.delta`（字段 `delta`）；终态事件
 *   `run.completed`（`output`）/ `run.failed`（`error`）/ `run.cancelled` / `run.interrupted`；
 *   结束哨兵为 SSE 注释 `: stream closed`（行首 `:` 已按无 data 跳过）。
 */
async runOnce(input: string | HermesRunInput, handlers: RunStreamHandlers = {}): Promise<HermesRunResult> {
  const body: Record<string, unknown> =
    typeof input === "string"
      ? { input }
      : {
          input: input.input,
          ...(input.sessionId ? { session_id: input.sessionId } : {}),
          ...(input.instructions ? { instructions: input.instructions } : {}),
          ...(input.conversationHistory?.length ? { conversation_history: input.conversationHistory } : {}),
          ...(input.model ? { model: input.model } : {}),
        };
  const create = await this.fetchImpl(`${this.baseUrl}/v1/runs`, {
    method: "POST",
    headers: this.headers(),
    body: JSON.stringify(body),
  });
  const createText = await create.text();
  if (!create.ok) {
    throw new Error(`POST /v1/runs ${create.status}: ${createText.slice(0, 400)}`);
  }
  const created = JSON.parse(createText) as {
    run_id?: string;
    id?: string;
    session_id?: string;
  };
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
  let output: string | undefined;
  let failure: string | null = null;

  const emitSseBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    let data = "";
    for (const line of lines) {
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let parsed: unknown = data;
    try {
      parsed = JSON.parse(data);
    } catch {
      /* raw */
    }
    const obj = parsed as { event?: unknown; delta?: unknown; output?: unknown; error?: unknown };
    const name = typeof obj.event === "string" ? obj.event : "message";
    handlers.onEvent?.(name, parsed);
    if (name === "message.delta" && typeof obj.delta === "string" && obj.delta) {
      text += obj.delta;
      handlers.onToken?.(obj.delta);
      return;
    }
    if (name === "run.completed") {
      if (typeof obj.output === "string") {
        output = obj.output;
        if (!text) {
          text = obj.output;
          handlers.onToken?.(obj.output);
        }
      }
      return;
    }
    if (name === "run.failed") {
      failure = typeof obj.error === "string" ? obj.error : JSON.stringify(obj.error ?? "unknown");
      return;
    }
    // run.cancelled / run.interrupted：流即将由网关关闭，无需特殊处理
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

  if (failure !== null) {
    throw new Error(`hermes run failed: ${failure}`);
  }
  return { runId, sessionId: created.session_id ?? "", text, output };
}
}
