/**
 * 从模型服务商拉取可用模型列表（OpenAI 兼容 GET …/models）。
 * HTML/404 时给出短错误，绝不把网页正文塞进 UI。
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

export function candidateModelsUrls(baseUrl: string): string[] {
  const u = normalizeBaseUrl(baseUrl);
  const urls: string[] = [];
  const push = (x: string) => {
    if (x && !urls.includes(x)) urls.push(x);
  };
  if (!u) return urls;
  if (/\/anthropic(\/v1)?$/i.test(u)) {
    push(`${u.replace(/\/anthropic(\/v1)?$/i, "")}/v1/models`);
  }
  if (/\/v1$/i.test(u)) push(`${u}/models`);
  else if (/\/openai\/v1$/i.test(u)) push(`${u}/models`);
  else push(`${u}/v1/models`);
  push(`${u.replace(/\/v1$/i, "")}/v1/models`);
  // 常见路径变体
  if (/stepfun/i.test(u) || /api\.step/i.test(u)) {
    push("https://api.stepfun.com/v1/models");
    push(`${u.replace(/\/v1$/i, "")}/models`);
  }
  return urls;
}

function pickContext(obj: Record<string, unknown>): number | undefined {
  const keys = ["context_length", "context_window", "max_context_length", "contextLength"];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  }
  return undefined;
}

/** 把接口错误压成一行，去掉 HTML */
export function shortProviderError(status: number, text: string, url: string, maskedKey: string): string {
  const body = (text || "").trim();
  const isHtml = /^<!DOCTYPE|^<html/i.test(body) || body.includes("_next/static");
  if (status === 404 || (isHtml && status >= 400)) {
    return `接口地址可能不正确（HTTP ${status}，返回了网页而非 API）。请检查 Base URL，例如 StepFun 应为 https://api.stepfun.com/v1 · 请求 ${url}`;
  }
  if (status === 401 || status === 403) {
    return `认证失败（HTTP ${status}）。请核对厂商与 API Key 是否匹配。Key：${maskedKey || "未填写"}`;
  }
  if (isHtml) {
    return `服务商返回了网页而非 JSON（HTTP ${status}）。请检查 Base URL 是否为 OpenAI 兼容地址 · ${url}`;
  }
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    const msg = j.error?.message || body;
    return `HTTP ${status} ${String(msg).slice(0, 120)}`;
  } catch {
    return `HTTP ${status} ${body.slice(0, 120)}`;
  }
}

function parseModels(text: string): ProviderModelInfo[] {
  const trimmed = text.trim();
  if (/^<!DOCTYPE|^<html/i.test(trimmed)) {
    throw new Error("RESPONSE_IS_HTML");
  }
  const data = JSON.parse(trimmed);
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
  // step-xxx 等自然排序更友好
  models.sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" }),
  );
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
  const auth = input.apiKey?.trim() ? `Bearer ${input.apiKey.trim()}` : undefined;

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
        lastErr = "接口返回成功但模型列表为空";
        continue;
      }
      lastErr = shortProviderError(res.status, text, url, masked);
      if (res.status === 401 || res.status === 403) {
        return { ok: false, models: [], error: lastErr, url, triedUrls: tried };
      }
    } catch (e) {
      if (String(e).includes("RESPONSE_IS_HTML")) {
        lastErr = `接口返回网页而非模型 JSON，请检查 Base URL · ${url}`;
      } else {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    models: [],
    error: lastErr || "获取模型列表失败",
    url: tried[tried.length - 1] ?? urls[0],
    triedUrls: tried,
  };
}
