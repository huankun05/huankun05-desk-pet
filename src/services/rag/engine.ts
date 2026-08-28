/**
 * RAG Engine — 语义记忆 / 检索增强生成
 *
 * 双路检索架构：
 * - BM25 关键词检索（本地，无 Embedding 依赖）
 * - Embedding 向量检索（预留，需 Provider 支持）
 *
 * 用途：
 * - 长期记忆检索（从历史对话中提取关键信息）
 * - 知识库检索（FAQ、角色背景故事）
 *
 * 集成状态（2026-07-30）：已集成到主应用
 * - BM25 关键词检索引擎已实现，支持文档CRUD、检索、自动清理
 * - 作为 UnifiedMemoryStage 的离线兜底检索源（在线走 Hermes 核心 Brain API）
 * - 对话完成后自动 upsert user/assistant 消息到 RAG 索引并持久化
 * - M3 离线轻量遗忘：Ebbinghaus 指数衰减 + 软遗忘（forget）+ 硬上限（hardCap）
 * - 设置面板 BehaviorPage 提供 RAG 开关、条目数显示、清空记忆
 *
 * 未来计划：
 *   1. 添加 Embedding 向量检索支持（需 Provider 提供 embedding 接口）
 *   2. 实现知识库管理功能（导入、导出、分类）
 *   3. 按 sessionId 维度检索
 */

import { createLogger } from '../../utils/logger';
import { memoryExtractor, mergeExtractedMemories } from '../memory/extractor';
import { EmbeddingIndex } from './embedding-index';
import type { EmbeddingProvider } from '../provider/types';
import { enhanceMemoriesWithLLM, type LLMCall } from '../memory/llm-enhancer';
import { createStorage } from '../storage';

const log = createLogger('RAG');

// ===== 类型 =====

export interface RAGDocument {
  id: string;
  content: string;
  metadata?: Record<string, string>;
  createdAt: Date;
  accessCount: number;
  lastAccessed: Date;
  /** 当前（可能已衰减的）重要性（0-1）。检索权重 / 清理判定均以此为准。 */
  importance: number;
  /**
   * 原始重要性锚点（0-1）。写入时由传入的 importance 锁定，后续不随时间变化
   * （除非被重新提及抬升）。effectiveImportance() 以此为基底做 Ebbinghaus 衰减，
   * 因此不会因反复衰减而“雪崩”。
   */
  baseImportance?: number;
}

export interface RAGSearchResult {
  doc: RAGDocument;
  score: number; // 0-1，越高越相关
}

export interface RAGConfig {
  /** 最大文档数量 */
  maxDocuments: number;
  /** prune 清理时的最低保留分数 */
  minImportanceToKeep: number;
  /** 检索返回的最大结果数 */
  maxSearchResults: number;
  /** 混合检索开关 */
  hybridEnabled: boolean;
  /** BM25 权重 (0-1) */
  hybridBm25Weight: number;
  /** Embedding 权重 (0-1) */
  hybridEmbeddingWeight: number;
  /** LLM 增强记忆抽取（可选，默认关闭） */
  llmEnhancementEnabled: boolean;
  // ===== M3 离线轻量遗忘（Ebbinghaus 指数衰减 + 软遗忘） =====
  /** 衰减率 λ：effective = base * exp(-λ * (ageDays - graceDays)) */
  decayLambda: number;
  /** 每次被检索访问的保留加成（按访问次数累加，封顶 50 次） */
  accessBoost: number;
  /** 软遗忘阈值：effective 低于此值且超过宽限期则删除 */
  forgetThreshold: number;
  /** 宽限期（天）：创建后此期间内不衰减、不被遗忘 */
  graceDays: number;
}

export const DEFAULT_RAG_CONFIG: RAGConfig = {
  maxDocuments: 1000,
  minImportanceToKeep: 0.1,
  maxSearchResults: 5,
  hybridEnabled: false,
  hybridBm25Weight: 0.5,
  hybridEmbeddingWeight: 0.5,
  llmEnhancementEnabled: false,
  // M3 默认值：λ=0.012 ≈ 半年后降到 ~0.48；grace 14 天；遗忘阈值 0.15
  decayLambda: 0.012,
  accessBoost: 0.02,
  forgetThreshold: 0.15,
  graceDays: 14,
};

// ===== BM25 索引 =====

/**
 * RAG 持久化形态（跨窗口共享）。
 * 改用 createStorage 的「project 文件后端」，使主窗与聊天面板窗共用同一份记忆文件，
 * 不再各自写隔离的 localStorage（每 WebView 的 localStorage 互不可见，会导致记忆分叉）。
 */
interface RAGPersistDoc {
  id: string;
  content: string;
  metadata?: Record<string, string>;
  createdAt: string;
  accessCount: number;
  lastAccessed: string;
  importance: number;
  baseImportance: number;
}

interface RAGPersistShape {
  docs: RAGPersistDoc[];
}

const ragStore = createStorage<RAGPersistShape>(
  'rag_docs',
  { docs: [] },
  { location: 'project', subdir: 'memory' },
);

class BM25Index {
  private k1 = 1.5;
  private b = 0.75;

  /** 词 → 文档频率 */
  private df = new Map<string, number>();
  /** 文档 → 词频表 */
  private tf = new Map<string, Map<string, number>>();
  /** 文档 → 长度 */
  private docLen = new Map<string, number>();
  /** 平均文档长度 */
  private avgLen = 0;
  /** 文档总数 */
  private n = 0;

  /** 索引文档 */
  index(docId: string, text: string): void {
    const tokens = this.tokenize(text);
    if (tokens.length === 0) return;

    this.docLen.set(docId, tokens.length);
    this.n++;
    this.avgLen = [...this.docLen.values()].reduce((s, l) => s + l, 0) / this.n;

    const freq = new Map<string, number>();
    // df 必须按「每篇文档首次出现」计 1：若按词频累加，单篇高词频会把 df 撑到 > n，
    // 使 idf = log((n-df+0.5)/(df+0.5)+1) 变负，相关文档分数被清零（检索失效）。
    const dfSeen = new Set<string>();
    for (const t of tokens) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
      if (!dfSeen.has(t)) {
        dfSeen.add(t);
        this.df.set(t, (this.df.get(t) ?? 0) + 1);
      }
    }
    this.tf.set(docId, freq);
  }

  /** 移除文档 */
  remove(docId: string): void {
    const freq = this.tf.get(docId);
    if (freq) {
      for (const t of freq.keys()) {
        const d = this.df.get(t);
        if (d !== undefined) {
          if (d <= 1) this.df.delete(t);
          else this.df.set(t, d - 1);
        }
      }
    }
    this.tf.delete(docId);
    this.docLen.delete(docId);
    this.n = this.docLen.size;
    this.avgLen = this.n > 0 ? [...this.docLen.values()].reduce((s, l) => s + l, 0) / this.n : 0;
  }

  /** 全文清空 */
  clear(): void {
    this.df.clear();
    this.tf.clear();
    this.docLen.clear();
    this.avgLen = 0;
    this.n = 0;
  }

  /** BM25 检索（返回 docId → score） */
  search(query: string, docIds: string[]): Map<string, number> {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0 || docIds.length === 0) return new Map();

    const qFreq = new Map<string, number>();
    for (const t of queryTokens) qFreq.set(t, (qFreq.get(t) ?? 0) + 1);

    const scores = new Map<string, number>();

    for (const docId of docIds) {
      const len = this.docLen.get(docId);
      if (!len) continue;

      let score = 0;
      for (const [qt, qf] of qFreq) {
        const df = this.df.get(qt);
        if (!df || df === 0) continue;

        const idf = Math.log((this.n - df + 0.5) / (df + 0.5) + 1);
        const tf = this.tf.get(docId)?.get(qt) ?? 0;
        // BM25 term score
        const termScore =
          idf *
          ((tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (len / this.avgLen))));
        score += termScore * qf;
      }

      if (score > 0) scores.set(docId, score);
    }

    // 归一化
    const maxScore = Math.max(...scores.values(), 1);
    for (const [k, s] of scores) scores.set(k, s / maxScore);

    return scores;
  }

  // ===== 中文分词（unigram + bigram） =====

  private tokenize(text: string): string[] {
    // 用 Unicode escape 避免特殊中文标点导致 parser 报错，同时兼容 ASCII 标点
    const cjkPunct =
      '\uFF0C\u3002\uFF01\uFF1F\uFF1B\uFF1A\u201C\u201D\u2018\u2019\uFF08\uFF09\u3010\u3011\u300A\u300B\u2026\u2014';
    const cleaned = text
      .replace(new RegExp(`[${cjkPunct}\\s,.!?;:"'()\\[\\]{}<>/\\\\]+`, 'g'), ' ')
      .toLowerCase()
      .trim();

    if (!cleaned) return [];

    const tokens: string[] = [];

    // unigram
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] !== ' ') tokens.push(cleaned[i]);
    }

    // bigram（跨越空格）
    const chars = cleaned.split(' ').join('').split('');
    for (let i = 0; i < chars.length - 1; i++) {
      tokens.push(chars[i] + chars[i + 1]);
    }

    return tokens;
  }
}

// ===== RAG Engine =====

export class RAGEngine {
  private docs = new Map<string, RAGDocument>();
  private bm25 = new BM25Index();
  private vec = new EmbeddingIndex();
  private config: RAGConfig;
  private embeddingProvider: EmbeddingProvider | null = null;
  /** LLM 增强抽取回调（可选；来自 providerManager.getActiveChatProvider） */
  private llmEnhancer: LLMCall | null = null;

  constructor(config: Partial<RAGConfig> = {}) {
    this.config = { ...DEFAULT_RAG_CONFIG, ...config };
  }

  /** Update hybrid config at runtime (used by settings UI). */
  setConfig(patch: Partial<RAGConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  /** 设置 embedding provider，用于混合检索 */
  setEmbeddingProvider(provider: EmbeddingProvider | null): void {
    this.embeddingProvider = provider;
  }

  /** 设置 LLM 增强抽取回调（可选；来自 providerManager.getActiveChatProvider） */
  setLLMEnhancer(fn: LLMCall | null): void {
    this.llmEnhancer = fn;
  }

  // ===== CRUD =====

  /** 添加/更新文档 */
  async upsert(doc: RAGDocument): Promise<void> {
    const isNew = !this.docs.has(doc.id);
    if (!isNew) {
      this.bm25.remove(doc.id);
      this.vec.remove(doc.id);
    }

    if (isNew) {
      // 新建：以传入 importance 为衰减锚点
      doc.baseImportance = doc.importance;
    } else {
      // 重新提及：抬升基底（取较大值），但绝不被已衰减值拉低
      doc.baseImportance = Math.max(doc.baseImportance ?? doc.importance, doc.importance);
    }
    // 立即写入衰减后的 live 值，避免首检仍是旧值
    doc.importance = this.effectiveImportance(doc);

    this.docs.set(doc.id, doc);
    this.bm25.index(doc.id, doc.content);

    // 异步写入 embedding，避免阻塞主流程
    if (this.config.hybridEnabled && this.embeddingProvider && doc.content.trim()) {
      this.embeddingProvider
        .getEmbedding([doc.content])
        .then((vecs) => {
          if (vecs[0]) this.vec.upsert(doc.id, vecs[0]);
        })
        .catch(() => {
          /* ignore embedding failure */
        });
    }

    // 超过上限时触发硬上限安全阀
    if (this.docs.size > this.config.maxDocuments) {
      this.hardCap();
    }
  }

  /** 删除文档 */
  delete(id: string): boolean {
    if (!this.docs.has(id)) return false;
    this.bm25.remove(id);
    this.vec.remove(id);
    this.docs.delete(id);
    return true;
  }

  /** 获取文档 */
  get(id: string): RAGDocument | undefined {
    return this.docs.get(id);
  }

  /** 获取文档总数 */
  get size(): number {
    return this.docs.size;
  }

  /** 获取所有文档（只读快照，用于展示） */
  getAllDocuments(): RAGDocument[] {
    return Array.from(this.docs.values());
  }

  // ===== 检索 =====

  /**
   * 双路检索
   *
   * BM25 + Embedding 混合检索（可选）。
   * 当开启 hybrid 且有 embedding provider 时并行双路，按权重融合。
   */
  async search(query: string): Promise<RAGSearchResult[]> {
    // M3：检索前先跑一次软遗忘清扫（离线兜底时自然稀疏化旧记忆）
    this.forget();

    const docIds = [...this.docs.keys()];
    if (docIds.length === 0) return [];

    const bm25Raw = this.bm25.search(query, docIds);
    const bm25Max = Math.max(...bm25Raw.values(), 1);

    let embeddingRaw = new Map<string, number>();
    if (this.config.hybridEnabled && this.embeddingProvider) {
      try {
        const queryVecs = await this.embeddingProvider.getEmbedding([query]);
        const queryVec = queryVecs[0] ?? [];
        embeddingRaw = this.vec.search(queryVec, docIds, this.config.maxSearchResults * 3);
      } catch {
        // 向量检索失败则回退纯 BM25
      }
    }
    const embeddingMax = Math.max(...embeddingRaw.values(), 1);

    const combined = new Map<string, { bm25: number; embedding: number }>();
    for (const id of docIds) {
      const b = bm25Raw.get(id) ?? 0;
      const e = embeddingRaw.get(id) ?? 0;
      if (b === 0 && e === 0) continue;
      combined.set(id, { bm25: b / bm25Max, embedding: e / embeddingMax });
    }

    const results: RAGSearchResult[] = [];
    for (const [docId, { bm25, embedding }] of combined) {
      const doc = this.docs.get(docId);
      if (!doc) continue;
      const score =
        this.config.hybridEnabled && this.embeddingProvider
          ? bm25 * this.config.hybridBm25Weight + embedding * this.config.hybridEmbeddingWeight
          : bm25;
      results.push({ doc, score });
    }

    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, this.config.maxSearchResults);

    for (const r of top) {
      // 写回衰减后的 live 重要性（基底 baseImportance 不变，不会雪崩）
      r.doc.importance = this.effectiveImportance(r.doc);
      r.doc.accessCount++;
      r.doc.lastAccessed = new Date();
    }

    return top;
  }

  /**
   * 将检索结果拼接为上下文文本（注入 LLM）
   */
  async getContext(query: string, maxChars = 2000): Promise<string> {
    const results = await this.search(query);
    if (results.length === 0) return '';

    const lines: string[] = [];
    let used = 0;

    for (const r of results) {
      const line = `[记忆] ${r.doc.content.slice(0, 300)}`;
      if (used + line.length > maxChars) break;
      lines.push(line);
      used += line.length;
    }

    return lines.join('\n');
  }

  /**
   * Extract structured memories from a conversation exchange.
   * Generates fact/preference/event entries and indexes them into BM25.
   *
   * Returns array of extracted memory document IDs.
   */
  async extractStructuredMemories(userText: string, assistantText?: string): Promise<string[]> {
    try {
      const ruleCandidates = memoryExtractor.extractFromExchange(userText, assistantText);
      let all = ruleCandidates;

      // 可选 LLM 增强：补充 / 修正规则结果（需启用且有 provider 注入）
      if (this.config.llmEnhancementEnabled && this.llmEnhancer) {
        try {
          const enhanced = await enhanceMemoriesWithLLM({
            userText,
            assistantText,
            ruleCandidates,
            llmCall: this.llmEnhancer,
          });
          all = mergeExtractedMemories([...ruleCandidates, ...enhanced]);
        } catch (err) {
          log.warn('LLM memory enhancement failed, fallback to rule-only', { err: String(err) });
        }
      }

      const ids: string[] = [];
      for (const m of all) {
        const doc: RAGDocument = {
          id: m.id,
          content: `[${m.type}] ${m.content}`,
          metadata: {
            type: m.type,
            confidence: String(m.confidence),
            source: m.source ?? 'unknown',
          },
          createdAt: new Date(m.createdAt),
          accessCount: 0,
          lastAccessed: new Date(m.createdAt),
          importance: m.confidence,
        };
        await this.upsert(doc);
        ids.push(m.id);
      }

      if (ids.length > 0) {
        log.debug('Structured memories extracted', { count: ids.length });
      }

      return ids;
    } catch (err) {
      log.warn('Structured memory extraction failed', { err: String(err) });
      return [];
    }
  }

  // ===== M3 遗忘 / 清理 =====

  /**
   * 计算文档的“当前有效重要性”（Ebbinghaus 指数衰减 + 访问加成）。
   * 始终以 baseImportance 为基底，因此反复调用不会雪崩式衰减。
   * 永久记忆（metadata.permanent === 'true'）不衰减。
   */
  private effectiveImportance(doc: RAGDocument, now: number = Date.now()): number {
    const base = doc.baseImportance ?? doc.importance;
    if (doc.metadata?.permanent === 'true') return Math.max(base, 0.9);
    const ageDays = (now - doc.createdAt.getTime()) / 86_400_000;
    if (ageDays <= this.config.graceDays) return base;
    const decayed = base * Math.exp(-this.config.decayLambda * (ageDays - this.config.graceDays));
    const boosted = decayed + this.config.accessBoost * Math.min(doc.accessCount, 50);
    return Math.max(0, Math.min(1, boosted));
  }

  /**
   * 软遗忘清扫：遍历所有文档，对“超过宽限期且有效重要性低于阈值”的非永久记忆删除。
   * 在 search() 中自动触发，离线兜底场景下随对话自然稀疏化旧记忆。
   */
  private forget(): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, doc] of [...this.docs.entries()]) {
      if (doc.metadata?.permanent === 'true') continue;
      const ageDays = (now - doc.createdAt.getTime()) / 86_400_000;
      if (ageDays < this.config.graceDays) continue;
      if (this.effectiveImportance(doc, now) < this.config.forgetThreshold) {
        this.bm25.remove(id);
        this.vec.remove(id);
        this.docs.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      log.info('RAG forgot low-importance memories', { removed, remaining: this.docs.size });
    }
    return removed;
  }

  /**
   * 硬上限安全阀：文档数超过 maxDocuments 时，按有效重要性从低到高逐出
   * （永久记忆跳过），直至降到 maxDocuments - 50。仅作为容量兜底，不负责时间衰减。
   */
  private hardCap(): number {
    if (this.docs.size <= this.config.maxDocuments) return 0;
    // 目标保留数：留 50 条缓冲以减少抖动，但至少保留 1 条
    const target = Math.max(1, this.config.maxDocuments - 50);
    const sorted = [...this.docs.entries()].sort(
      (a, b) => this.effectiveImportance(a[1]) - this.effectiveImportance(b[1]),
    );
    let removed = 0;
    for (const [id, doc] of sorted) {
      if (this.docs.size <= target) break;
      if (doc.metadata?.permanent === 'true') continue;
      this.bm25.remove(id);
      this.vec.remove(id);
      this.docs.delete(id);
      removed++;
    }
    if (removed > 0) {
      log.info('RAG hard-cap evicted documents', { removed, remaining: this.docs.size });
    }
    return removed;
  }

  /** 清空所有文档 */
  clear(): void {
    this.docs.clear();
    this.bm25.clear();
    this.vec.clear();
    log.info('RAG engine cleared');
  }

  // ===== 持久化（跨窗口共享文件，见文件顶部 ragStore） =====

  /** 序列化并写入共享文件 + 每窗 localStorage 缓存（跨窗口权威源 + 兼容历史键） */
  saveToStorage(): void {
    try {
      // 软上限保护：超过配置上限时逐出最低效文档，避免无限增长
      if (this.docs.size > this.config.maxDocuments) {
        this.evictLowestForStorage();
      }
      const docs: RAGPersistDoc[] = Array.from(this.docs.values()).map((d) => ({
        id: d.id,
        content: d.content,
        metadata: d.metadata,
        createdAt: d.createdAt.toISOString(),
        accessCount: d.accessCount,
        lastAccessed: d.lastAccessed.toISOString(),
        importance: d.importance,
        baseImportance: d.baseImportance ?? d.importance,
      }));
      // 1) 共享文件（主窗/面板窗共用，跨窗口权威源；fire-and-forget，忽略配额）
      try {
        ragStore.set({ docs });
      } catch {
        /* ignore */
      }
      // 2) 每窗 localStorage 缓存（保留旧键 deskpet_rag_docs_v1，兼容历史与配额降级逻辑）
      try {
        localStorage.setItem('deskpet_rag_docs_v1', JSON.stringify(docs));
      } catch {
        // 配额超限：逐出最低效文档后重试（内存态始终保留，仅持久化降级）
        if (this.evictLowestForStorage() > 0) {
          const trimmed: RAGPersistDoc[] = Array.from(this.docs.values()).map((d) => ({
            id: d.id,
            content: d.content,
            metadata: d.metadata,
            createdAt: d.createdAt.toISOString(),
            accessCount: d.accessCount,
            lastAccessed: d.lastAccessed.toISOString(),
            importance: d.importance,
            baseImportance: d.baseImportance ?? d.importance,
          }));
          try {
            localStorage.setItem('deskpet_rag_docs_v1', JSON.stringify(trimmed));
          } catch {
            /* ignore */
          }
          try {
            ragStore.set({ docs: trimmed });
          } catch {
            /* ignore */
          }
        }
      }
      log.debug('RAG persisted', { docs: docs.length });
    } catch (err) {
      log.warn('RAG persist failed', { err: String(err) });
    }
  }

  /** 超限降级：按有效重要性从低到高逐出非永久文档，最多 20%，返回逐出数 */
  private evictLowestForStorage(): number {
    const targets = [...this.docs.entries()]
      .filter(([, d]) => d.metadata?.permanent !== 'true')
      .sort((a, b) => this.effectiveImportance(a[1]) - this.effectiveImportance(b[1]));
    const maxEvict = Math.max(1, Math.floor(this.docs.size * 0.2));
    let evicted = 0;
    for (const [id] of targets) {
      if (evicted >= maxEvict) break;
      this.bm25.remove(id);
      this.vec.remove(id);
      this.docs.delete(id);
      evicted++;
    }
    if (evicted > 0) {
      log.warn('RAG storage quota exceeded, evicted lowest-importance docs', { evicted });
    }
    return evicted;
  }

  /** 从共享存储（先内存/文件，再迁移旧版 localStorage）反序列化恢复 */
  loadFromStorage(): void {
    try {
      let arr: RAGPersistDoc[] | undefined = ragStore.get()?.docs;
      if (!arr || arr.length === 0) {
        // 迁移旧版 localStorage 数据（deskpet_rag_docs_v1），仅首次运行一次
        const legacy = localStorage.getItem('deskpet_rag_docs_v1');
        if (legacy) {
          try {
            arr = JSON.parse(legacy) as RAGPersistDoc[];
            log.info('RAG migrated from legacy localStorage', { count: arr.length });
          } catch {
            // 旧键损坏则清掉，避免下次继续解析失败
            try {
              localStorage.removeItem('deskpet_rag_docs_v1');
            } catch {
              /* ignore */
            }
            arr = undefined;
          }
        }
      }
      if (!arr || arr.length === 0) return;
      let restored = 0;
      for (const rawDoc of arr) {
        const doc: RAGDocument = {
          id: rawDoc.id,
          content: rawDoc.content,
          metadata: rawDoc.metadata,
          createdAt: new Date(rawDoc.createdAt),
          accessCount: rawDoc.accessCount,
          lastAccessed: new Date(rawDoc.lastAccessed),
          importance: rawDoc.importance,
          baseImportance: rawDoc.baseImportance ?? rawDoc.importance,
        };
        this.docs.set(doc.id, doc);
        this.bm25.index(doc.id, doc.content);
        restored++;
      }
      // 同步写入新存储，保证迁移后格式一致
      ragStore.set({ docs: arr });
      log.info('RAG restored from storage', { restored });
    } catch (err) {
      log.warn('RAG restore failed', { err: String(err) });
    }
  }

  /** 清空持久化 + 内存 */
  wipeAll(): void {
    this.clear();
    try {
      ragStore.reset();
    } catch {
      /* ignore */
    }
  }
}

/** 全局单例 */
let _ragEngine: RAGEngine | null = null;

export function getRAGEngine(): RAGEngine {
  if (!_ragEngine) {
    _ragEngine = new RAGEngine();
    // 同步加载本会话 localStorage 缓存（若有）；随后从共享文件异步恢复最新记忆
    _ragEngine.loadFromStorage();
    ragStore
      .init()
      .then(() => _ragEngine?.loadFromStorage())
      .catch(() => {});
  }
  return _ragEngine;
}

/**
 * 跨窗口重载：另一窗口写入共享文件后，本窗口调用此方法把最新记忆读入内存。
 * 由 useRagPersistence 在收到 'rag:updated' 事件时触发。
 */
export async function reloadRAGFromStore(): Promise<void> {
  try {
    await ragStore.reload();
    getRAGEngine().loadFromStorage();
  } catch (err) {
    log.warn('RAG reload from store failed', { err: String(err) });
  }
}

/** 测试用：重置共享存储与旧键，隔离用例（避免模块级单例跨用例残留） */
export function resetRagStoreForTests(): void {
  try {
    ragStore.reset();
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem('deskpet_rag_docs_v1');
  } catch {
    /* ignore */
  }
}

export function resetRAGEngine(): void {
  _ragEngine?.clear();
  _ragEngine = null;
}
