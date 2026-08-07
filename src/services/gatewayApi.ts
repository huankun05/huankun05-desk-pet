/**
 * Gateway REST 客户端
 *
 * Hermes Gateway 在 127.0.0.1:8765 同时提供 WebSocket（对话）与 REST（管理）。
 * 本文件封装管理类接口：工具清单、成长记忆的增删查。
 */

const GATEWAY_REST = 'http://127.0.0.1:8765/api/gateway';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GATEWAY_REST}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`Gateway ${path} -> HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface ModeToolsInfo {
  chat: string[] | null;
  work: string[] | null;
  backend: string[];
}

export interface MemoryItem {
  id: number;
  text: string;
  category: string;
  source: string;
  created_at?: number;
}

/** 各模式可用工具白名单（null 表示全部） */
export function fetchModeTools(): Promise<ModeToolsInfo> {
  return request<ModeToolsInfo>('/mode-tools');
}

/** 列出成长记忆（q 非空时按相关性召回） */
export function fetchMemories(q?: string): Promise<{ items: MemoryItem[]; count?: number }> {
  return request(`/memory${q ? `?q=${encodeURIComponent(q)}` : ''}`);
}

/** 手动添加一条成长记忆 */
export function addMemory(text: string, category = 'fact'): Promise<{ id: number }> {
  return request('/memory', {
    method: 'POST',
    body: JSON.stringify({ text, category, source: 'manual' }),
  });
}

/** 删除一条成长记忆 */
export function deleteMemory(id: number): Promise<{ ok: boolean }> {
  return request(`/memory/${id}`, { method: 'DELETE' });
}
