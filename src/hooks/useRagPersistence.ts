import { useCallback } from 'react';
import { getRAGEngine, type RAGDocument } from '../services/rag/engine';
import { createLogger } from '../utils/logger';

const log = createLogger('RagPersistence');

export interface AddToRagMeta {
  userMessageId: string;
  assistantMessageId: string;
  sessionId: string;
}

export type AddToRag = (userText: string, aiText: string, meta: AddToRagMeta) => void;

/**
 * RAG 持久化 + 抽取端路由（统一后：本地优先单方案）。
 *
 * 记忆完全运行在本地，不再区分后端在线 / 离线：
 * - 原始对话始终写入本地 RAG，作为长期记忆。
 * - 抽取端统一走本地 extractStructuredMemories（M2 规则抽取）；
 *   若开启「LLM 增强记忆抽取」，引擎内部会再叠加 LLM 调用。
 * 这样记忆永不离线，也不存在后端 / 本地双存储漂移。
 */
export function useRagPersistence(): { addToRag: AddToRag } {
  const addToRag = useCallback<AddToRag>(async (userText, aiText, meta) => {
    try {
      const ragEngine = getRAGEngine();
      const now = new Date();

      // 原始对话写入 RAG，作为长期记忆
      if (userText.trim().length >= 6) {
        const userDoc: RAGDocument = {
          id: `u_${meta.userMessageId}`,
          content: `用户说：${userText}`,
          metadata: { type: 'user', sessionId: meta.sessionId },
          createdAt: now,
          accessCount: 0,
          lastAccessed: now,
          importance: 0.3,
        };
        await ragEngine.upsert(userDoc);
      }
      if (aiText.trim().length >= 6) {
        const assistDoc: RAGDocument = {
          id: `a_${meta.assistantMessageId}`,
          content: `我回复：${aiText}`,
          metadata: { type: 'assistant', sessionId: meta.sessionId },
          createdAt: now,
          accessCount: 0,
          lastAccessed: now,
          importance: 0.4,
        };
        await ragEngine.upsert(assistDoc);
      }

      // 统一本地抽取（原离线分支，现在始终执行）
      await ragEngine.extractStructuredMemories(userText, aiText);

      ragEngine.saveToStorage();
    } catch (ragErr) {
      log.warn('RAG persistence failed', { err: String(ragErr) });
    }
  }, []);

  return { addToRag };
}
