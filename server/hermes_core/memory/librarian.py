"""Librarian 记忆检索器。

基础版（P0）实现：
- 使用 SQLite LIKE 做候选集过滤
- 使用本地哈希向量计算语义相似度
- 关键词重叠作为辅助分数
- 简单加权融合，返回 Top-K

远期（P1/P2）可升级为：
- SQLite FTS5 全文索引
- RRF 混合排序（向量 + FTS + 重要性 + 访问频次）
- 外部 Embedding 模型（Ollama / OpenAI）
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .embedding import Embedder, cosine_similarity, get_default_embedder
from .fragment import MemoryFragment
from .store import MemoryStore


@dataclass
class SearchResult:
    """检索结果项。"""

    fragment: MemoryFragment
    score: float
    vector_score: float
    keyword_score: float
    importance_score: float


class Librarian:
    """记忆图书管理员：负责从记忆库中召回相关碎片。"""

    DEFAULT_TOP_K = 3
    DEFAULT_CANDIDATE_LIMIT = 50

    def __init__(
        self,
        store: MemoryStore | None = None,
        embedder: Embedder | None = None,
        top_k: int = DEFAULT_TOP_K,
    ):
        self.store = store or MemoryStore()
        self.embedder = embedder or get_default_embedder()
        self.top_k = top_k

    def search(
        self,
        query: str,
        top_k: int | None = None,
    ) -> list[SearchResult]:
        """检索与 query 相关的记忆碎片。

        评分公式（P0 简化版）：
            final_score = 0.5 * vector_score + 0.3 * keyword_score + 0.2 * importance_score

        Args:
            query: 用户输入或检索主题
            top_k: 返回数量，默认 self.top_k

        Returns:
            SearchResult 列表（按分数降序）
        """
        if top_k is None:
            top_k = self.top_k

        query = query.strip()
        if not query:
            return []

        candidates = self.store.search_like(query, limit=self.DEFAULT_CANDIDATE_LIMIT)
        if not candidates:
            return []

        query_vec = self.embedder.embed(query)
        query_tokens = set(self._tokenize(query))

        results: list[SearchResult] = []
        for frag in candidates:
            # 向量相似度
            frag_vec = (
                frag.embedding
                if frag.embedding
                else self.embedder.embed(frag.content)
            )
            vector_score = cosine_similarity(query_vec, frag_vec)

            # 关键词重叠分数
            frag_tokens = set(self._tokenize(frag.content))
            overlap = len(query_tokens & frag_tokens)
            union = len(query_tokens | frag_tokens)
            keyword_score = overlap / union if union > 0 else 0.0

            # 重要性归一化
            importance_score = frag.importance

            # 综合分数
            score = (
                0.5 * vector_score
                + 0.3 * keyword_score
                + 0.2 * importance_score
            )

            # 记忆情绪与当前情绪相似度加成
            current_pad = self._get_current_pad()
            emotion_bonus = self._emotion_similarity_bonus(frag, current_pad)
            score = score * 0.85 + emotion_bonus * 0.15

            results.append(
                SearchResult(
                    fragment=frag,
                    score=score,
                    vector_score=vector_score,
                    keyword_score=keyword_score,
                    importance_score=importance_score,
                )
            )

        # 按分数降序
        results.sort(key=lambda r: r.score, reverse=True)

        # 返回 Top-K，并记录访问
        top_results = results[:top_k]
        for r in top_results:
            if r.fragment.id is not None:
                self.store.touch(r.fragment.id)

        return top_results

    def format_prompt(self, results: list[SearchResult]) -> str:
        """将检索结果格式化为可注入 system prompt 的文本。"""
        if not results:
            return ""

        lines = ["【相关记忆】"]
        for idx, r in enumerate(results, 1):
            frag = r.fragment
            marker = "（永久）" if frag.is_permanent else ""
            emotion = frag.emotion_snapshot or {}
            emotion_tag = ""
            if emotion:
                p = emotion.get("pleasure", 0)
                a = emotion.get("arousal", 0)
                label = self._pad_to_emotion_label(p, a)
                emotion_tag = f" [{label}]"
            lines.append(f"{idx}. {frag.content}{emotion_tag}{marker}")

        return "\n".join(lines)

    @staticmethod
    def _pad_to_emotion_label(pleasure: float, arousal: float) -> str:
        if pleasure > 0.3 and arousal > 0.3:
            return "开心"
        if pleasure > 0.3 and arousal <= 0.3:
            return "平静"
        if pleasure < -0.3 and arousal > 0.3:
            return "焦虑"
        if pleasure < -0.3 and arousal <= 0.3:
            return "悲伤"
        return "中性"

    def _get_current_pad(self) -> dict[str, float]:
        try:
            from core.heart.emotion import EmotionState
            state = EmotionState()
            return {
                "pleasure": state.pad.pleasure,
                "arousal": state.pad.arousal,
                "dominance": state.pad.dominance,
            }
        except Exception:
            return {"pleasure": 0.0, "arousal": 0.0, "dominance": 0.0}

    def _emotion_similarity_bonus(self, frag: MemoryFragment, current_pad: dict[str, float]) -> float:
        mem_pad = frag.emotion_snapshot or {}
        if not mem_pad or not current_pad:
            return 0.0

        dp = abs(mem_pad.get("pleasure", 0) - current_pad.get("pleasure", 0))
        da = abs(mem_pad.get("arousal", 0) - current_pad.get("arousal", 0))
        similarity = 1.0 - min(1.0, (dp + da) / 2.0)
        return similarity * frag.importance

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        """简单分词：字符 + 2-gram。"""
        text = text.lower().strip()
        chars = list(text.replace(" ", ""))
        bigrams = [text[i : i + 2] for i in range(len(text) - 1)]
        return chars + bigrams
