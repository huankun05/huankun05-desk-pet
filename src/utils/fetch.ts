/**
 * 带超时的 fetch 封装
 * @param url 请求地址
 * @param options fetch 配置
 * @param timeoutMs 超时毫秒数，默认 10 秒
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
