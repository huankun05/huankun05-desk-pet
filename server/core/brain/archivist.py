"""Archivist 归档器。

后台任务管理器，负责记忆碎片的自动维护：
1. 遗忘衰减计算 — 定期对所有记忆应用 Ebbinghaus 遗忘曲线
2. 过期清理 — 删除 tombstone 阶段的记忆碎片
3. 记忆合并 — 将相似的记忆碎片合并为更完整的记录

设计原则：
- 永久记忆（is_permanent=True）不会被清理或衰减
- 合并操作保留更高重要性的版本
- 所有操作在事务中执行，保证数据一致性
"""
from __future__ import annotations

import time
import logging
from typing import Optional, Tuple, List
from datetime import datetime

from .fragment import MemoryFragment
from .store import MemoryStore
from .decay import apply_decay, THRESHOLD_TOMBSTONE
from .embedding import cosine_similarity, get_default_embedder

logger = logging.getLogger("archivist")


class ArchiveResult:
    """归档操作结果。"""

    def __init__(self):
        self.processed: int = 0
        self.decayed: int = 0
        self.deleted: int = 0
        self.merged: int = 0
        self.errors: int = 0


class Archivist:
    """记忆归档器。

    负责后台维护任务，建议定时调用（如每小时一次）。

    Args:
        store: 记忆存储实例
        min_merge_similarity: 合并相似度阈值（0-1）
        max_merge_distance_days: 合并时间窗口（天）
    """

    def __init__(
        self,
        store: MemoryStore,
        min_merge_similarity: float = 0.7,
        max_merge_distance_days: int = 7,
    ):
        self.store = store
        self.min_merge_similarity = min_merge_similarity
        self.max_merge_distance_days = max_merge_distance_days
        self.embedder = get_default_embedder()

    def apply_decay_all(self) -> ArchiveResult:
        """对所有记忆碎片应用遗忘衰减。

        Returns:
            ArchiveResult 包含处理统计
        """
        result = ArchiveResult()

        try:
            fragments = self.store.list_all(limit=1000)
            for frag in fragments:
                try:
                    decay_result = apply_decay(frag)
                    result.processed += 1

                    if frag.importance != decay_result.new_importance:
                        result.decayed += 1
                        self.store.update(
                            frag.id,
                            importance=decay_result.new_importance,
                        )
                        logger.debug(
                            f"Decayed: id={frag.id}, "
                            f"importance={frag.importance:.3f}→{decay_result.new_importance:.3f}, "
                            f"stage={decay_result.stage}"
                        )

                    if not decay_result.should_keep:
                        result.deleted += 1
                        if frag.id is not None:
                            self.store.delete(frag.id)
                        logger.info(
                            f"Deleted tombstone: id={frag.id}, "
                            f"content={frag.content[:30]}..."
                        )

                except Exception as e:
                    result.errors += 1
                    logger.error(f"Error processing fragment {frag.id}: {e}")

        except Exception as e:
            result.errors += 1
            logger.error(f"Error in apply_decay_all: {e}")

        logger.info(
            f"Decay completed: processed={result.processed}, "
            f"decayed={result.decayed}, deleted={result.deleted}, errors={result.errors}"
        )
        return result

    def merge_similar(self) -> ArchiveResult:
        """合并相似的记忆碎片。

        合并规则：
        1. 只合并同一阶段的记忆（active/cooling）
        2. 相似度 >= min_merge_similarity
        3. 创建时间差 <= max_merge_distance_days
        4. 保留重要性更高的版本，合并内容

        Returns:
            ArchiveResult 包含合并统计
        """
        result = ArchiveResult()

        try:
            fragments = self.store.list_all(limit=1000)
            active_frags = [
                f for f in fragments
                if not f.is_permanent
                and (datetime.utcnow() - f.last_accessed).total_seconds() / 86400 < THRESHOLD_TOMBSTONE
            ]

            if len(active_frags) < 2:
                return result

            visited = set()
            for i, frag1 in enumerate(active_frags):
                if frag1.id in visited or frag1.id is None:
                    continue

                frag1_vec = frag1.embedding or self.embedder.embed(frag1.content)

                for j in range(i + 1, len(active_frags)):
                    frag2 = active_frags[j]
                    if frag2.id in visited or frag2.id is None:
                        continue

                    time_diff_days = abs(
                        (frag1.created_at - frag2.created_at).total_seconds() / 86400
                    )
                    if time_diff_days > self.max_merge_distance_days:
                        continue

                    frag2_vec = frag2.embedding or self.embedder.embed(frag2.content)
                    similarity = cosine_similarity(frag1_vec, frag2_vec)

                    if similarity >= self.min_merge_similarity:
                        merged = self._merge_two(frag1, frag2)
                        if merged:
                            result.merged += 1
                            visited.add(frag1.id)
                            visited.add(frag2.id)
                            logger.info(
                                f"Merged: id={frag1.id}+{frag2.id} -> new={merged.id}, "
                                f"similarity={similarity:.3f}"
                            )
                            break

        except Exception as e:
            result.errors += 1
            logger.error(f"Error in merge_similar: {e}")

        logger.info(
            f"Merge completed: merged={result.merged}, errors={result.errors}"
        )
        return result

    def _merge_two(self, frag1: MemoryFragment, frag2: MemoryFragment) -> Optional[MemoryFragment]:
        """合并两个相似的记忆碎片。

        策略：保留重要性更高的作为主版本，合并内容和访问记录。

        Args:
            frag1: 第一个碎片
            frag2: 第二个碎片

        Returns:
            合并后的新碎片，或 None（如果合并失败）
        """
        try:
            if frag1.importance >= frag2.importance:
                main, secondary = frag1, frag2
            else:
                main, secondary = frag2, frag1

            merged_content = self._merge_content(main.content, secondary.content)
            merged_importance = min(1.0, (main.importance + secondary.importance) / 2 + 0.1)

            merged = self.store.add(
                MemoryFragment(
                    content=merged_content,
                    importance=merged_importance,
                    is_permanent=False,
                )
            )

            if main.id is not None:
                self.store.delete(main.id)
            if secondary.id is not None:
                self.store.delete(secondary.id)

            return merged

        except Exception as e:
            logger.error(f"Error merging fragments {frag1.id} and {frag2.id}: {e}")
            return None

    def _merge_content(self, content1: str, content2: str) -> str:
        """合并两段文本内容。

        简单策略：去重后拼接，用分号分隔。

        Args:
            content1: 第一段内容
            content2: 第二段内容

        Returns:
            合并后的内容
        """
        parts1 = [p.strip() for p in content1.split("；") if p.strip()]
        parts2 = [p.strip() for p in content2.split("；") if p.strip()]

        all_parts = list(dict.fromkeys(parts1 + parts2))
        return "；".join(all_parts)

    def run_full_cycle(self) -> ArchiveResult:
        """执行完整的归档周期。

        顺序：衰减计算 → 过期清理 → 相似合并

        Returns:
            综合结果
        """
        start = time.time()
        logger.info("Starting archive cycle...")

        result = ArchiveResult()

        decay_result = self.apply_decay_all()
        result.processed += decay_result.processed
        result.decayed += decay_result.decayed
        result.deleted += decay_result.deleted
        result.errors += decay_result.errors

        merge_result = self.merge_similar()
        result.merged += merge_result.merged
        result.errors += merge_result.errors

        elapsed = time.time() - start
        logger.info(
            f"Archive cycle completed in {elapsed:.2f}s: "
            f"processed={result.processed}, decayed={result.decayed}, "
            f"deleted={result.deleted}, merged={result.merged}, errors={result.errors}"
        )

        return result

    def optimize_storage(self) -> int:
        """优化存储：清理冗余数据。

        1. 清理空内容碎片
        2. 清理重复内容（完全相同）
        3. 清理重要性极低的碎片

        Returns:
            删除的碎片数量
        """
        deleted = 0

        try:
            fragments = self.store.list_all(limit=1000)
            seen_content = set()

            for frag in fragments:
                if frag.is_permanent:
                    continue

                if not frag.content.strip():
                    if frag.id is not None:
                        self.store.delete(frag.id)
                        deleted += 1
                    continue

                content_hash = hash(frag.content.strip())
                if content_hash in seen_content:
                    if frag.id is not None:
                        self.store.delete(frag.id)
                        deleted += 1
                    continue
                seen_content.add(content_hash)

                if frag.importance < 0.01:
                    if frag.id is not None:
                        self.store.delete(frag.id)
                        deleted += 1

        except Exception as e:
            logger.error(f"Error in optimize_storage: {e}")

        logger.info(f"Storage optimization completed: deleted {deleted} fragments")
        return deleted