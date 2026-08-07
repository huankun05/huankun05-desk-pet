/**
 * useUnifiedMemory — 统一记忆检索 Hook
 *
 * 融合三路记忆源：
 * 1. 前端 Brain 碎片（localStorage）
 * 2. 后端 Hermes FTS5 全文检索（SessionDB）
 * 3. 前端 RAG BM25 引擎
 *
 * 用于 AI 对话前的记忆上下文构建，支持按角色隔离。
 */

import { useState, useCallback } from 'react';
import { createLogger } from '../utils/logger';
import { getRAGEngine } from '../services/rag/engine';
import {
  searchSessionMessages,
  searchMemories,
  type MemoryHit,
  type SessionSearchHit,
} from '../services/coreApi';

const log = createLogger('UnifiedMemory');

export interface UnifiedMemoryResult {
  /** 核心脑碎片（Brain fragments，来自 localStorage） */
  fragments: MemoryHit[];
  /** 会话历史（Hermes FTS5，来自 SessionDB） */
  sessions: SessionSearchHit[];
  /** 前端 RAG 结果（BM25 关键词检索） */
  rag: string[];
  /** 合并后的上下文文本 */
  context: string;
  /** 各源数量 */
  counts: { fragments: number; sessions: number; rag: number };
}

/**
 * 统一记忆检索：同时查询三个记忆源，返回合并结果。
 *
 * @param query 检索关键词
 * @param limit 每源最大结果数
 * @returns 统一记忆结果
 */
export async function unifiedSearch(query: string, limit = 5): Promise<UnifiedMemoryResult> {
  const startTime = performance.now();

  // 并行查询三路
  const [fragments, sessions, ragDocs] = await Promise.all([
    // 1. Brain 碎片（通过 Core API）
    searchMemories(query, { limit }).catch(() => [] as MemoryHit[]),
    // 2. Hermes FTS5 会话（通过 Core API）
    searchSessionMessages(query, limit).catch(() => ({ hits: [] as SessionSearchHit[] })),
    // 3. 前端 RAG BM25
    Promise.resolve().then(async () => {
      const engine = getRAGEngine();
      const docs = await engine.search(query);
      return docs.map((r) => r.doc.content);
    }),
  ]);

  const sessionHits = sessions.hits ?? [];

  // 构建合并上下文
  const parts: string[] = [];
  if (fragments.length > 0) {
    parts.push('【记忆碎片】');
    for (const f of fragments.slice(0, limit)) {
      parts.push(`- ${f.content.slice(0, 200)}`);
    }
  }
  if (sessionHits.length > 0) {
    parts.push('【历史会话】');
    for (const s of sessionHits.slice(0, limit)) {
      const snippet = (s.snippet || s.content || '').slice(0, 200);
      if (snippet) parts.push(`- ${snippet}`);
    }
  }
  if (ragDocs.length > 0) {
    parts.push('【长期记忆】');
    for (const doc of ragDocs.slice(0, limit)) {
      parts.push(`- ${doc.slice(0, 200)}`);
    }
  }

  const elapsed = performance.now() - startTime;
  log.info('Unified search completed', {
    query,
    fragments: fragments.length,
    sessions: sessionHits.length,
    rag: ragDocs.length,
    elapsedMs: Math.round(elapsed),
  });

  return {
    fragments,
    sessions: sessionHits,
    rag: ragDocs,
    context: parts.join('\n'),
    counts: {
      fragments: fragments.length,
      sessions: sessionHits.length,
      rag: ragDocs.length,
    },
  };
}

/**
 * 统一记忆检索 Hook
 *
 * 在组件中使用：
 * ```tsx
 * const { result, search, isLoading } = useUnifiedMemory();
 * ```
 */
export function useUnifiedMemory() {
  const [result, setResult] = useState<UnifiedMemoryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string, limit = 5) => {
    if (!query.trim()) {
      setResult(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await unifiedSearch(query, limit);
      setResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      log.warn('Unified memory search failed', { err: msg });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    result,
    isLoading,
    error,
    search,
    clear,
  };
}
