import { useCallback, useEffect } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { getRAGEngine, reloadRAGFromStore, type RAGDocument } from '../services/rag/engine';
import { createLogger } from '../utils/logger';
import { isTauriEnv } from '../utils/tauriEnv';
import { RAG_UPDATED_EVENT } from '../services/eventBus';

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
 *
 * 跨窗口同步：RAG 引擎改用共享文件后端（见 rag/engine.ts 的 ragStore），
 * 任一窗口写入后广播 RAG_UPDATED_EVENT，另一窗口监听后从共享文件重载内存态，
 * 保证主窗与聊天面板窗记忆一致。
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

      // 广播：另一窗口（主窗 / 面板窗）从共享文件重载，保持记忆一致
      if (isTauriEnv()) {
        emit(RAG_UPDATED_EVENT, {}).catch(() => {});
      }
    } catch (ragErr) {
      log.warn('RAG persistence failed', { err: String(ragErr) });
    }
  }, []);

  // 监听其他窗口的 RAG 写入，重载本窗口内存态
  useEffect(() => {
    if (!isTauriEnv()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<Record<string, unknown>>(RAG_UPDATED_EVENT, () => {
      reloadRAGFromStore().catch(() => {});
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* 非 Tauri 环境忽略 */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return { addToRag };
}
