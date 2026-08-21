/**
 * callSummaries — 语音通话总结的存储与查询（Core:9877）。
 *
 * 通话内容不进入聊天历史，但挂断后会生成一段口语化总结，
 * 按「标题 + 日期」存储，可在设置页查看 / 搜索 / 重命名 / 删除 / 导出。
 */

const CORE_API_BASE = 'http://localhost:9877';

export interface CallSummaryListItem {
  id: number;
  title: string;
  call_date: string;
  duration_seconds: number;
  created_at: string;
}

export interface CallSummaryDetail extends CallSummaryListItem {
  summary_text: string;
  transcript_json: string;
}

export interface CallSummaryCreatePayload {
  title: string;
  call_date: string;
  duration_seconds: number;
  summary_text: string;
  transcript_json: string;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${CORE_API_BASE}${path}`, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 列表（可按标题/日期搜索） */
export async function listCallSummaries(search?: string): Promise<CallSummaryListItem[]> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  return request<CallSummaryListItem[]>(`/api/core/call/summaries${qs}`);
}

/** 详情（含总结文本与原文 transcript） */
export async function getCallSummary(id: number): Promise<CallSummaryDetail> {
  return request<CallSummaryDetail>(`/api/core/call/summaries/${id}`);
}

/** 创建一条总结（通话挂断后由前端生成文本并写入） */
export async function createCallSummary(
  payload: CallSummaryCreatePayload,
): Promise<CallSummaryDetail> {
  return request<CallSummaryDetail>('/api/core/call/summaries', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** 重命名（用户可改成有意义的标题） */
export async function renameCallSummary(id: number, title: string): Promise<CallSummaryDetail> {
  return request<CallSummaryDetail>(`/api/core/call/summaries/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  });
}

/** 删除 */
export async function deleteCallSummary(id: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/core/call/summaries/${id}`, { method: 'DELETE' });
}
