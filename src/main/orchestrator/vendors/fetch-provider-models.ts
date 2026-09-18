/**
 * 从模型服务商拉取可用模型列表（OpenAI 兼容 GET {baseUrl}/v1/models）。
 * Anthropic 路径（/anthropic）通常不提供该接口，会自动回退到 OpenAI 风格 base。
 */
export type ProviderModelInfo = {
  id: string;
  contextWindow?: number;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function maskKey(key: string): string {
  const k = (key || "").trim();
  if (k.length <= 8) return k ? "****" : "";
  return `${k.slice(0, 3)}****${k.slice(-4)}`;
}

/** 生成候选 models URL（OpenAI 兼容优先，去掉 anthropic 专用路径） */
export function candidateModelsUrls(baseUrl: string): string[] {
  const u = normalizeBaseUrl(baseUrl);
  const urls: string[] = [];
  const push = (x: string) => {
    if (x && !urls.includes(x)) urls.push(x);
  };
  if (!u) return urls;
  // anthropic-only 路径 → 回退到主机 OpenAI 风格
  if (/\/anthropic$/i.test(u) || /\/anthropic\/v1$/i.test(u)) {
    const host = u.replace(/\/anthropic(\/v1)?$/i, "");
    push(`${host}/v1/models`);
  }
  if (/\/v1$/i.test(u)) push(`${u}/models`);
  else if (/\/openai\/v1$/i.test(u)) push(`${u}/models`);
  else push(`${u}/v1/models`);
  // 兜底：再试一次去掉 /v1
  push(`${u.replace(/\/v1$/i, "")}/v1/models`);
  return urls;
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

function parseModels(text: string): ProviderModelInfo[] {
  const data = JSON.parse(text);
  const list =
    (data as { data?: unknown[]; models?: unknown[] }).data ??
    (data as { models?: unknown[] }).models ??
    (Array.isArray(data) ? data : null);
  if (!Array.isArray(list)) return [];
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
  return models;
}

export async function fetchProviderModels(input: {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<{
  ok: boolean;
  models: ProviderModelInfo[];
  error?: string;
  url: string;
  triedUrls: string[];
}> {
  const urls = candidateModelsUrls(input.baseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const masked = maskKey(input.apiKey);
  const tried: string[] = [];
  const auth = input.apiKey?.trim()
    ? `Bearer ${input.apiKey.trim()}`
    : undefined;

  if (!urls.length) {
    return {
      ok: false,
      models: [],
      error: "未配置有效的 Base URL，请填写厂商地址后再获取",
      url: "",
      triedUrls: [],
    };
  }

  let lastErr = "";
  for (const url of urls) {
    tried.push(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 12_000);
    try {
      const headers: Record<string, string> = {};
      if (auth) headers.Authorization = auth;
      const res = await fetchImpl(url, { method: "GET", headers, signal: controller.signal });
      const text = await res.text();
      if (res.ok) {
        const models = parseModels(text);
        if (models.length) {
          return { ok: true, models, url, triedUrls: tried };
        }
        lastErr = "接口返回成功但列表为空";
        continue;
      }
      // 401/403：认证问题，不再继续试其它 URL 也可能一样
      let msg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text) as { error?: { message?: string } };
        const raw = j.error?.message || text.slice(0, 160);
        msg = raw.replace(input.apiKey || "\u0000", `****${masked.slice(-4)}`.slice(-8));
        if (masked && msg.includes(input.apiKey?.trim() ?? "\u0000")) {
          msg = msg.split(input.apiKey!.trim()).join(`key:${masked}`);
        }
      } catch {
        msg = text.slice(0, 160);
      }
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          models: [],
          error: `认证失败（HTTP ${res.status}）。请检查 API Key 是否正确、是否与当前厂商匹配。Key: ${masked || "未填写"} · 请勿填写错厂商。`,
          url,
          triedUrls: tried,
        };
      }
      lastErr = msg;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    models: [],
    error: lastErr || "获取失败",
    url: tried[tried.length - 1] ?? urls[0],
    triedUrls: tried,
  };
}
