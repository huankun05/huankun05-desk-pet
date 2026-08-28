"""空闲自学习调度器（Idle Self-Learning Scheduler）。

设计目标：
- 聊天结束后（_handle_chat 末尾）把本轮对话入队，做到「聊天结束即触发学习」；
- 网关**空闲**（无进行中聊天）时，后台协程批量把缓冲的对话轮次抽取成记忆并入库，
  做到「空余时间自行进行自学习」，完全不阻塞对话响应；
- 空闲且配置了可用 LLM 时，用 LLM 抽取（质量更高），否则回退离线规则抽取；
- 缓冲队列持久化到 data/learning_queue.jsonl，网关重启后可续跑；
  配合 store 的内容去重，即使崩溃重跑也不会产生重复记忆。
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, Callable

from .memory_service import get_memory_service
from .store import get_db_path

logger = logging.getLogger("core.brain.learning_scheduler")

PendingItem = dict[str, Any]  # {character_id, user_id, user_text, assistant_text, ts}


class LearningScheduler:
    """聊天后入队、空闲时批量抽取记忆的调度器。"""

    def __init__(
        self,
        llm_provider: Callable[[], Any] | None = None,
        interval: float = 20.0,
    ) -> None:
        self._llm_provider = llm_provider
        self._interval = max(1.0, float(interval))
        self._queue: list[PendingItem] = []
        self._lock = threading.Lock()
        self._active = 0
        self._wake = asyncio.Event()
        self._stop = False
        self._stress = False
        self._task: asyncio.Task | None = None
        self._queue_path = get_db_path().parent / "learning_queue.jsonl"
        self._load_pending()

    # ------------------------------------------------------------------
    # 外部接口
    # ------------------------------------------------------------------

    def enqueue(self, character_id: str, user_id: str, user_text: str, assistant_text: str) -> None:
        """把一轮对话压入学习队列（聊天结束时调用）。"""
        if not user_text or not assistant_text:
            return
        item: PendingItem = {
            "character_id": character_id or "default",
            "user_id": user_id or "default",
            "user_text": user_text,
            "assistant_text": assistant_text,
            "ts": time.time(),
        }
        with self._lock:
            self._queue.append(item)
        self._persist()
        self._wake.set()

    def mark_chat_active(self) -> None:
        """标记有聊天进行中（用于判断「空闲」）。"""
        with self._lock:
            self._active += 1

    def mark_chat_idle(self) -> None:
        """标记一轮聊天结束；若无进行中聊天则唤醒空闲学习。"""
        with self._lock:
            self._active = max(0, self._active - 1)
            idle = self._active == 0
        if idle:
            self._wake.set()

    def start(self) -> asyncio.Task | None:
        """在运行中的事件循环里启动后台学习协程。"""
        try:
            self._task = asyncio.create_task(self.run())
        except RuntimeError:
            # 无运行中的事件循环（极少数路径）则跳过
            self._task = None
        return self._task

    def stop(self) -> None:
        """请求停止并唤醒循环以便尽快退出。"""
        self._stop = True
        self._wake.set()

    def set_stress(self, enabled: bool) -> None:
        """交感应激模式：开启时暂停后台抽取（队列仍缓冲并持久化，不丢数据）。

        用于系统高负载时让出 CPU/LLM 给实时对话；关闭时立即唤醒恢复抽取。
        """
        self._stress = bool(enabled)
        if self._stress:
            logger.info("LearningScheduler 进入应激模式（暂停后台抽取）")
        else:
            logger.info("LearningScheduler 退出应激模式（恢复后台抽取）")
            self._wake.set()

    # ------------------------------------------------------------------
    # 主循环
    # ------------------------------------------------------------------

    async def run(self) -> None:
        """空闲学习主循环：等待唤醒或超时，空闲且有缓冲时抽取。"""
        while not self._stop:
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=self._interval)
            except asyncio.TimeoutError:
                pass
            self._wake.clear()
            with self._lock:
                idle = self._active == 0
                has = bool(self._queue)
            if idle and has:
                if self._stress:
                    # 交感应激：暂停后台抽取。队列仍缓冲并持久化，恢复后不丢数据。
                    logger.debug("应激模式：跳过本轮后台抽取（队列保留 %d 条）", len(self._queue))
                else:
                    try:
                        await self._drain()
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("空闲自学习 drain 异常: %s", exc)

    async def _drain(self) -> None:
        """取出全部缓冲轮次，按 (character_id, user_id) 分组后批量抽取。"""
        with self._lock:
            batch = self._queue
            self._queue = []
        if not batch:
            return

        groups: dict[tuple[str, str], list[PendingItem]] = {}
        for it in batch:
            groups.setdefault((it["character_id"], it["user_id"]), []).append(it)

        loop = asyncio.get_running_loop()
        total = 0
        for (cid, uid), turns in groups.items():
            svc = get_memory_service(character_id=cid, user_id=uid)
            llm = self._llm_provider() if self._llm_provider else None
            use_llm = bool(llm and getattr(llm, "is_available", lambda: False)())
            llm_fn = (lambda msgs, _llm=llm: _llm.chat(msgs)) if use_llm else None
            group_total = 0
            for turn in turns:
                try:
                    saved = await loop.run_in_executor(
                        None,
                        lambda t=turn, s=svc, fn=llm_fn, ul=use_llm: s.extract_and_store(
                            t["user_text"], t["assistant_text"], llm_fn=fn, use_llm=ul
                        ),
                    )
                    if saved:
                        total += len(saved)
                        group_total += len(saved)
                        logger.info(
                            "空闲自学习：%s/%s 抽取 %d 条记忆", cid, uid, len(saved)
                        )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("空闲自学习单轮异常: %s", exc)
            # 累积达阈值后自动聚合 L2 场景 / L3 画像（离线可用；有 LLM 时质量更高）
            if group_total and hasattr(svc, "maybe_autogenerate"):
                try:
                    svc.maybe_autogenerate(new_count=group_total, llm_fn=llm_fn, use_llm=use_llm)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("空闲自学习自动分层生成异常: %s", exc)
        if total:
            logger.info("空闲自学习本轮共抽取 %d 条记忆", total)
        self._persist()

    # ------------------------------------------------------------------
    # 持久化（崩溃可续跑）
    # ------------------------------------------------------------------

    def _persist(self) -> None:
        try:
            with self._lock:
                items = list(self._queue)
            self._queue_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._queue_path.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                for it in items:
                    f.write(json.dumps(it, ensure_ascii=False) + "\n")
            tmp.replace(self._queue_path)
        except Exception as exc:  # noqa: BLE001
            logger.warning("学习队列持久化失败（可忽略）: %s", exc)

    def _load_pending(self) -> None:
        try:
            if not self._queue_path.exists():
                return
            with open(self._queue_path, "r", encoding="utf-8") as f:
                lines = [ln for ln in f if ln.strip()]
            items: list[PendingItem] = []
            for ln in lines:
                try:
                    items.append(json.loads(ln))
                except json.JSONDecodeError:
                    continue
            with self._lock:
                self._queue = items
            if items:
                logger.info("空闲自学习：载入 %d 条待处理历史对话", len(items))
        except Exception as exc:  # noqa: BLE001
            logger.warning("学习队列载入失败（可忽略）: %s", exc)

    # ------------------------------------------------------------------
    # 测试辅助
    # ------------------------------------------------------------------

    def reset(self) -> None:
        """清空内存队列与持久化文件（测试用）。"""
        with self._lock:
            self._queue = []
            self._active = 0
        try:
            if self._queue_path.exists():
                self._queue_path.unlink()
        except Exception:
            pass
