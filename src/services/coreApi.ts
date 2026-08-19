/**
 * Core API — 统一封装 Python Brain API 调用
 *
 * 记忆/情绪/人格/时间四大系统通过此模块访问。
 * 优先 API（@port 9877），失败降级 localStorage。
 */

// ============================================================
// 配置
// ============================================================

const CORE_API_BASE = 'http://localhost:9877';

// 超时（ms）
const TIMEOUT = 8000;

// ============================================================
// 类型定义
// ============================================================

export interface MemoryHit {
  id: number;
  character_id: string;
  user_id: string;
  content: string;
  importance: number;
  access_count: number;
  last_accessed: string;
  is_permanent: boolean;
  created_at: string;
}

export interface MemoryStats {
  total: number;
  permanent: number;
  ephemeral: number;
  avg_importance: number;
  recent_7d: number;
  accessed_ratio: number;
}

export interface EmotionState {
  pleasure: number;
  arousal: number;
  dominance: number;
  mood: string | null;
  updated_at: string;
}

export interface EmotionEventRequest {
  event: string;
  character_id?: string;
}

// ============================================================
// 工具函数
// ============================================================

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);

  try {
    const res = await fetch(`${CORE_API_BASE}${path}`, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// 记忆 API
// ============================================================

/** 检索相关记忆（Librarian） */
export async function searchMemories(
  query: string,
  options?: { character_id?: string; limit?: number },
): Promise<MemoryHit[]> {
  const body: Record<string, unknown> = { query, limit: options?.limit || 3 };
  if (options?.character_id) body.character_id = options.character_id;

  return request<MemoryHit[]>('/api/core/brain/memories/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** 列出所有记忆碎片 */
export async function listMemories(options?: {
  character_id?: string;
  limit?: number;
}): Promise<MemoryHit[]> {
  const params = new URLSearchParams();
  if (options?.character_id) params.set('character_id', options.character_id);
  if (options?.limit) params.set('limit', String(options.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request<MemoryHit[]>(`/api/core/brain/memories${qs}`);
}

/** 手动添加一条记忆碎片 */
export async function addMemoryFragment(data: {
  content: string;
  importance?: number;
  is_permanent?: boolean;
  character_id?: string;
  user_id?: string;
}): Promise<MemoryHit> {
  return request<MemoryHit>('/api/core/brain/memories', {
    method: 'POST',
    body: JSON.stringify({
      content: data.content,
      importance: data.importance ?? 0.5,
      is_permanent: data.is_permanent ?? false,
      character_id: data.character_id || 'default',
      user_id: data.user_id || 'default',
    }),
  });
}

/** 标记/取消标记为永久记忆 */
export async function setMemoryPermanent(fragId: number, isPermanent: boolean): Promise<MemoryHit> {
  return request<MemoryHit>(`/api/core/brain/memories/${fragId}/permanent`, {
    method: 'PATCH',
    body: JSON.stringify({ is_permanent: isPermanent }),
  });
}

/** 删除一条记忆碎片 */
export async function deleteMemory(fragId: number): Promise<{ success: boolean; id: number }> {
  return request(`/api/core/brain/memories/${fragId}`, { method: 'DELETE' });
}

/** 触发 Scribe 从对话中自动抽取记忆碎片 */
export async function addMessageToMemory(data: {
  content: string;
  importance?: number;
  is_permanent?: boolean;
  character_id?: string;
  user_id?: string;
  use_llm?: boolean;
}): Promise<{ extracted: number; fragments?: unknown[]; error?: string }> {
  return request('/api/core/brain/memories/extract', {
    method: 'POST',
    body: JSON.stringify({
      user_text: data.content,
      assistant_text: '',
      character_id: data.character_id || 'default',
      user_id: data.user_id || 'default',
      use_llm: data.use_llm ?? false,
    }),
  });
}

/** 记忆库统计 */
export async function getMemoryStats(character_id?: string): Promise<MemoryStats> {
  const params = character_id ? `?character_id=${encodeURIComponent(character_id)}` : '';
  return request<MemoryStats>(`/api/core/brain/memories/stats${params}`);
}

/** 触发遗忘衰减（Ebbinghaus + 中等遗忘策略） */
export async function applyMemoryDecay(
  character_id?: string,
): Promise<{ processed: number; changed: number; deleted: number }> {
  const body: Record<string, unknown> = {};
  if (character_id) body.character_id = character_id;
  return request('/api/core/brain/memories/apply-decay', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ============================================================
// 情绪 API
// ============================================================

/** 获取当前情绪状态 */
export async function getEmotion(character_id?: string): Promise<EmotionState> {
  const params = character_id ? `?character_id=${encodeURIComponent(character_id)}` : '';
  return request<EmotionState>(`/api/core/heart/emotion${params}`);
}

/** 触发情绪事件更新 */
export async function postEmotionEvent(
  event: string,
  character_id?: string,
): Promise<EmotionState> {
  const body: Record<string, unknown> = { event };
  if (character_id) body.character_id = character_id;
  return request<EmotionState>('/api/core/heart/emotion/event', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ============================================================
// 人格 API
// ============================================================

export interface PersonalityState {
  honesty_humility: number;
  emotionality: number;
  extraversion: number;
  agreeableness: number;
  conscientiousness: number;
  openness: number;
  /** 后端生成的人格描述（可能为空） */
  description?: string;
  /** 后端 PAD 基线（可能为空） */
  pad_baseline?: { pleasure: number; arousal: number; dominance: number };
  updated_at: string;
}

/** 后端 /api/core/soul/personality 原始结构：六维嵌套在 hexaco 下 */
interface PersonalityRaw {
  hexaco?: Record<string, number>;
  hexaco_detail?: Record<string, unknown>;
  description?: string;
  pad_baseline?: { pleasure: number; arousal: number; dominance: number };
  updated_at?: string;
}

/** 获取当前人格状态（适配后端 hexaco 嵌套结构，扁平化为前端 PersonalityState） */
export async function getPersonality(character_id?: string): Promise<PersonalityState> {
  const params = character_id ? `?character_id=${encodeURIComponent(character_id)}` : '';
  const raw = await request<PersonalityRaw>(`/api/core/soul/personality${params}`);
  const h = raw.hexaco ?? {};
  return {
    honesty_humility: Number(h.honesty_humility ?? 0),
    emotionality: Number(h.emotionality ?? 0),
    extraversion: Number(h.extraversion ?? 0),
    agreeableness: Number(h.agreeableness ?? 0),
    conscientiousness: Number(h.conscientiousness ?? 0),
    openness: Number(h.openness ?? 0),
    description: raw.description,
    pad_baseline: raw.pad_baseline,
    updated_at: raw.updated_at ?? '',
  };
}

/** 手动设定 HEXACO 人格（调整/设定初始状态）；reset=true 恢复默认 0.5 */
export async function updatePersonality(
  updates: {
    honesty_humility?: number;
    emotionality?: number;
    extraversion?: number;
    agreeableness?: number;
    conscientiousness?: number;
    openness?: number;
    reset?: boolean;
  },
  character_id?: string,
): Promise<PersonalityState> {
  return request<PersonalityState>('/api/core/soul/personality', {
    method: 'PUT',
    body: JSON.stringify({ ...updates, ...(character_id ? { character_id } : {}) }),
  });
}

// ============================================================
// 健康检查
// ============================================================

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${CORE_API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// 缓存版健康查询：避免每条消息都去 fetch /health（3s 超时很慢）。
// 结果缓存 TTL 毫秒，过期后才重新探活；探活失败直接降级 false。
let _cachedHealthy: boolean | null = null;
let _lastHealthCheck = 0;
const HEALTH_TTL_MS = 30_000;

export async function isBackendAvailable(): Promise<boolean> {
  const now = Date.now();
  if (_cachedHealthy !== null && now - _lastHealthCheck < HEALTH_TTL_MS) {
    return _cachedHealthy;
  }
  _cachedHealthy = await healthCheck().catch(() => false);
  _lastHealthCheck = now;
  return _cachedHealthy;
}

/** 仅供测试/手动刷新：清除健康缓存 */
export function resetBackendHealthCache(): void {
  _cachedHealthy = null;
  _lastHealthCheck = 0;
}

// ============================================================
// Session API（Hermes 大脑会话，hermes_core.SessionDB）
// ============================================================

export interface SessionMeta {
  id: string;
  source?: string;
  title?: string;
  message_count?: number;
  last_active?: string;
  preview?: string;
  [key: string]: unknown;
}

export interface SessionMessage {
  id: number;
  session_id: string;
  role: string;
  content?: string;
  timestamp?: string;
  token_count?: number;
  [key: string]: unknown;
}

export interface SessionSearchHit {
  id?: number;
  session_id?: string;
  role?: string;
  snippet?: string;
  content?: string;
  timestamp?: string;
  source?: string;
  [key: string]: unknown;
}

/** 会话统计 */
export interface SessionStats {
  session_count: number;
  message_count: number;
  fts5_available: boolean;
  db_path: string;
}

/** 列出会话（source 为空则全部来源） */
export async function listSessions(options?: {
  source?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: SessionMeta[]; total: number }> {
  const params = new URLSearchParams();
  if (options?.source) params.set('source', options.source);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/core/session/list${qs}`);
}

/** 创建会话 */
export async function createSession(
  session_id: string,
  source = 'desk-pet',
): Promise<{ session: SessionMeta | null }> {
  return request('/api/core/session', {
    method: 'POST',
    body: JSON.stringify({ session_id, source }),
  });
}

/** 读取会话详情（含消息） */
export async function getSession(
  session_id: string,
): Promise<{ session: SessionMeta | null; messages: SessionMessage[] }> {
  return request(`/api/core/session/${encodeURIComponent(session_id)}`);
}

/** 追加消息 */
export async function appendSessionMessage(
  session_id: string,
  role: string,
  content: string,
): Promise<{ session_id: string; messages: SessionMessage[] }> {
  return request(`/api/core/session/${encodeURIComponent(session_id)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role, content }),
  });
}

/** FTS5 全文检索会话消息 */
export async function searchSessionMessages(
  query: string,
  limit = 10,
): Promise<{ query: string; hits: SessionSearchHit[] }> {
  return request('/api/core/session/search', {
    method: 'POST',
    body: JSON.stringify({ query, limit }),
  });
}

/** 删除会话 */
export async function deleteSession(
  session_id: string,
): Promise<{ deleted: boolean; session_id: string }> {
  return request(`/api/core/session/${encodeURIComponent(session_id)}`, { method: 'DELETE' });
}

/** 会话统计（总数 / 消息数 / FTS5 可用性） */
export async function getSessionStats(): Promise<SessionStats> {
  return request('/api/core/session/stats');
}

/** 记忆统一查询（Brain 碎片 + Hermes FTS5 会话） */
export async function unifiedSearch(
  query: string,
  limit = 10,
): Promise<{ query: string; fragments: MemoryHit[]; sessions: SessionSearchHit[] }> {
  return request('/api/core/brain/search-all', {
    method: 'POST',
    body: JSON.stringify({ query, limit }),
  });
}

// ============================================================
// Emotion Bridge API（身体事件 ↔ 汐月九维情绪，方案 A）
// ============================================================

export interface EmotionBridgeState {
  dimensions: Record<string, number>;
  pad: { pleasure: number; arousal: number; dominance: number };
  mood_label: string;
  expression_scale: number;
  last_updated?: string;
  recent_history?: Array<{
    timestamp?: string;
    trigger?: string;
    dimensions?: Record<string, number>;
    intensity?: number;
  }>;
}

export interface EmotionBridgeEventResult {
  applied: boolean;
  reason?: string;
  event?: string;
  value?: string | null;
  dimensions?: Record<string, number>;
}

/** 发送身体事件 → 更新汐月九维情绪（映射表在服务端 config，可热调） */
export async function postEmotionBridgeEvent(
  event: string,
  value?: string,
): Promise<EmotionBridgeEventResult> {
  return request('/api/core/emotion/bridge/event', {
    method: 'POST',
    body: JSON.stringify({ event, value: value ?? null }),
  });
}

/** 读取汐月当前九维情绪 + PAD 映射（供表情驱动） */
export async function getEmotionBridgeState(): Promise<EmotionBridgeState> {
  return request('/api/core/emotion/bridge/state');
}

/** 读取桥接配置（映射表/权重/节流/表情强度） */
export async function getEmotionBridgeConfig(): Promise<Record<string, unknown>> {
  return request('/api/core/emotion/bridge/config');
}

// ============================================================
// Interaction API（台词池）
// ============================================================

export interface InteractionMessage {
  id: number;
  character_id: string;
  category: string;
  subcategory: string;
  messages: string[];
  emotion?: string | null;
  time_of_day?: string | null;
  enabled: boolean;
  updated_at?: string | null;
}

/** 列出互动台词（可按 category 过滤） */
export async function listInteractionMessages(options?: {
  character_id?: string;
  category?: string;
}): Promise<InteractionMessage[]> {
  const params = new URLSearchParams();
  if (options?.character_id) params.set('character_id', options.character_id);
  if (options?.category) params.set('category', options.category);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request<InteractionMessage[]>(`/api/core/interaction/messages${qs}`);
}

/** 创建/整替代台词 */
export async function upsertInteractionMessage(data: {
  character_id?: string;
  category: string;
  subcategory: string;
  messages: string[];
  emotion?: string | null;
  time_of_day?: string | null;
  enabled?: boolean;
}): Promise<InteractionMessage> {
  return request<InteractionMessage>('/api/core/interaction/messages', {
    method: 'POST',
    body: JSON.stringify({
      character_id: data.character_id || 'default',
      category: data.category,
      subcategory: data.subcategory,
      messages: data.messages,
      emotion: data.emotion ?? null,
      time_of_day: data.time_of_day ?? null,
      enabled: data.enabled ?? true,
    }),
  });
}

/** 局部更新台词（messages/emotion/time_of_day/enabled） */
export async function updateInteractionMessage(
  msgId: number,
  data: {
    messages?: string[];
    emotion?: string | null;
    time_of_day?: string | null;
    enabled?: boolean;
  },
): Promise<InteractionMessage> {
  const body: Record<string, unknown> = {};
  if (data.messages !== undefined) body.messages = data.messages;
  if (data.emotion !== undefined) body.emotion = data.emotion;
  if (data.time_of_day !== undefined) body.time_of_day = data.time_of_day;
  if (data.enabled !== undefined) body.enabled = data.enabled;
  return request<InteractionMessage>(`/api/core/interaction/messages/${msgId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
