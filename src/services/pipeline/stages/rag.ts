/**
 * RAG 开关与离线兜底检索源
 *
 * 原 RAGStage 已合并进 UnifiedMemoryStage（M4：在线权威 / 离线兜底）。
 * 本文件仅保留 RAG 总开关，供 UnifiedMemoryStage 在离线时决定是否回退到
 * 本地 BM25 检索（getRAGEngine().getContext）。
 *
 * 开关：读取 localStorage.deskpet_ragEnabled（默认 true）
 */

const RAG_ENABLED_KEY = 'deskpet_ragEnabled';

export function isRAGEnabled(): boolean {
  try {
    const raw = localStorage.getItem(RAG_ENABLED_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

export function setRAGEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(RAG_ENABLED_KEY, String(enabled));
  } catch {
    /* ignore */
  }
}
