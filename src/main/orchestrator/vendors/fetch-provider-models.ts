/**
 * 从模型服务商拉取可用模型列表（OpenAI 兼容 GET {baseUrl}/models）。
 * 部分提供方（如 OpenRouter）会在条目上带 context_length；DeepSeek 等通常只有 id。
 */
export type ProviderModelInfo = {
  id: string;
  contextWindow?: number;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

/** 把 /v1 或裸域名归一到可拼 /models 的前缀 */
function modelsUrl(baseUrl: string): string {
  const u = normalizeBaseUrl(baseUrl);
  if (/\/v1$/i.test(u)) return `${u}/models`;
  if (/\/openai\/v1$/i.test(u)) return `${u}/models`;
  return `${u}/v1/models`;
}

function pickContext(obj: Record<string, unknown>): number | undefined {
  const keys = ["context_length", "context_window", "max_context_length", "contextLength"];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  }
  const nested = obj.context as Record<string, unknown> | undefined;
  if (nested && typeof nested === "object") {
    const w = nested.window ?? nested.max_tokens ?? nested.length;
    if (typeof w === "number" && Number.isFinite(w) && w > 0) return Math.floor(w);
  }
  return undefined;
}

export async function fetchProviderModels(input: {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; models: ProviderModelInfo[]; error?: string; url: string }> {
  const url = modelsUrl(input.baseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 12_000);
  try {
    const headers: Record<string, string> = {};
    if (input.apiKey?.trim()) headers.Authorization = `Bearer ${input.apiKey.trim()}`;
    const res = await fetchImpl(url, { method: "GET", headers, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, models: [], error: `HTTP ${res.status} ${text.slice(0, 200)}`, url };
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, models: [], error: "响应不是 JSON", url };
    }
    const list = (data as { data?: unknown[]; models?: unknown[] }).data
      ?? (data as { models?: unknown[] }).models
      ?? (Array.isArray(data) ? data : null);
    if (!Array.isArray(list)) {
      return { ok: false, models: [], error: "未找到 models 列表", url };
    }
    const models: ProviderModelInfo[] = [];
    for (const item of list) {
      if (typeof item === "string" && item) {
        models.push({ id: item });
        continue;
      }
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const id = obj.id ?? obj.name ?? obj.model;
        if (typeof id === "string" && id) {
          models.push({ id, contextWindow: pickContext(obj) });
        }
      }
    }
    models.sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, models, url };
  } catch (e) {
    return { ok: false, models: [], error: e instanceof Error ? e.message : String(e), url };
  } finally {
    clearTimeout(timer);
  }
}
