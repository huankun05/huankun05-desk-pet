"""记忆系统回归测试（端到端 + 调度器）。

覆盖此前踩过的坑：
- 网关真实启动 / /health 可用；
- WS memory:list/add/update/delete 全链路；
- 记忆作用域隔离（character_id 不匹配 → 注入失效的断层）；
- 对话抽取去重（空闲自学习重跑不产生重复记忆）；
- 空闲自学习调度器：drain + 持久化续跑（崩溃可恢复）。
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SERVER_DIR = Path(__file__).resolve().parent.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from hermes_gateway_server import create_app  # noqa: E402
import core.brain.learning_scheduler as ls_mod  # noqa: E402
from core.brain.learning_scheduler import LearningScheduler  # noqa: E402
from core.brain.memory_service import get_memory_service  # noqa: E402


# ============================================================
# 网关 + WS 记忆 CRUD
# ============================================================


@pytest.fixture
def client():
    app = create_app()
    with TestClient(app) as c:
        yield c


def _ws(client, payload: dict, max_msgs: int = 30) -> dict:
    """发送一条 WS 消息并匹配回包（按 req_id，无 req_id 则取首个 _result）。"""
    with client.websocket_connect("/ws") as ws:
        ws.send_json(payload)
        req_id = payload.get("req_id")
        for _ in range(max_msgs):
            msg = ws.receive_json()
            if req_id is not None:
                if msg.get("req_id") == req_id:
                    return msg
            elif msg.get("type", "").endswith("_result"):
                return msg
        raise AssertionError("未收到响应消息")


def _cleanup(client, cid: str, uid: str) -> None:
    res = _ws(client, {"type": "memory:list", "character_id": cid, "user_id": uid, "req_id": "clean"})
    for it in res.get("items", []):
        _ws(client, {"type": "memory:delete", "character_id": cid, "user_id": uid,
                     "id": it["id"], "req_id": f"del-{it['id']}"})


def test_app_and_health(client):
    # create_app 成功（TestClient 进入 lifespan）；网关健康检查可用
    assert client.get("/health").status_code == 200


def test_ws_memory_crud_and_scope(client):
    cid, uid = "test_crud_char", "test_crud_user"
    try:
        # 初始空
        res = _ws(client, {"type": "memory:list", "character_id": cid, "user_id": uid, "req_id": "l1"})
        assert res["type"] == "memory:list_result"
        assert res["items"] == []

        # 新增规则
        res = _ws(client, {"type": "memory:add", "character_id": cid, "user_id": uid,
                           "content": "测试：必须用简体中文回复", "category": "rule", "req_id": "a1"})
        assert res["ok"] is True
        rid = res["memory"]["id"]

        # 列表计数 = 1
        res = _ws(client, {"type": "memory:list", "character_id": cid, "user_id": uid, "req_id": "l2"})
        assert len(res["items"]) == 1

        # 作用域隔离：另一个角色看不到这条
        res = _ws(client, {"type": "memory:list", "character_id": "other_char", "user_id": uid, "req_id": "l3"})
        assert res["items"] == []

        # 调重要性（前端以 {id, ...fields} 顶层展开发送）
        res = _ws(client, {"type": "memory:update", "character_id": cid, "user_id": uid,
                           "id": rid, "importance": 0.9, "req_id": "u1"})
        assert res["ok"] is True
        assert res["memory"]["importance"] == 0.9

        # 删除
        res = _ws(client, {"type": "memory:delete", "character_id": cid, "user_id": uid, "id": rid, "req_id": "d1"})
        assert res["ok"] is True
        res = _ws(client, {"type": "memory:list", "character_id": cid, "user_id": uid, "req_id": "l4"})
        assert res["items"] == []
    finally:
        _cleanup(client, cid, uid)
        _cleanup(client, "other_char", uid)


def test_injection_scope_isolation():
    """记忆注入必须按 character_id 隔离——正是此前'设置页记忆在对话里不注入'的断层根因。"""
    cid = "scope_char_x"
    uid = "scope_user"
    svc = get_memory_service(cid, uid)
    try:
        svc.add_memory("作用域测试规则：必须用中文", category="rule", source="ui")
        inj_same = svc.build_injection_prompt(query="你好")
        assert "作用域测试规则：必须用中文" in inj_same
        # 不同作用域不应出现
        other = get_memory_service("scope_char_y", uid)
        inj_other = other.build_injection_prompt(query="你好")
        assert "作用域测试规则：必须用中文" not in inj_other
    finally:
        for m in svc.list_memories():
            svc.delete_memory(m["id"])


def test_extract_idempotent_across_runs():
    """相同对话重复抽取不产生重复记忆（空闲自学习重跑的关键不变量）。"""
    cid = "idem_char"
    svc = get_memory_service(cid, "idem_user")
    try:
        ex = "我喜欢吃火锅，周末常去"
        svc.extract_and_store(ex, "好的，我已记住")
        r2 = svc.extract_and_store(ex, "好的，我已记住")
        # 第二次内容相同 → 被去重，0 条新增
        assert len(r2) == 0
    finally:
        for m in svc.list_memories():
            svc.delete_memory(m["id"])


# ============================================================
# 空闲自学习调度器
# ============================================================


class _FakeSvc:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def extract_and_store(self, user_text, assistant_text="", *, llm_fn=None, use_llm=False):
        self.calls.append((user_text, assistant_text))
        return [{"id": len(self.calls), "content": user_text}]


@pytest.fixture
def fake_svc(monkeypatch):
    svc = _FakeSvc()
    monkeypatch.setattr(ls_mod, "get_memory_service", lambda *a, **k: svc)
    return svc


def test_scheduler_drain_and_persist(fake_svc, tmp_path, monkeypatch):
    monkeypatch.setattr(ls_mod, "get_db_path", lambda: tmp_path / "core.db")
    sched = LearningScheduler(interval=0.1)
    sched.enqueue("c1", "u1", "我喜欢蓝色", "好的")
    sched.enqueue("c1", "u1", "我喜欢红色", "好的")
    # 入队即持久化
    assert (tmp_path / "learning_queue.jsonl").exists()
    asyncio.run(sched._drain())
    assert len(fake_svc.calls) == 2
    # drain 后队列清空，持久化文件也清空
    assert (tmp_path / "learning_queue.jsonl").read_text(encoding="utf-8").strip() == ""


def test_scheduler_resume_after_restart(fake_svc, tmp_path, monkeypatch):
    """崩溃/重启后，新实例应从持久化文件恢复待处理队列（断点续跑）。"""
    monkeypatch.setattr(ls_mod, "get_db_path", lambda: tmp_path / "core.db")
    sched = LearningScheduler(interval=0.1)
    sched.enqueue("c1", "u1", "hello", "world")
    # 模拟重启：丢弃旧实例，新建实例载入历史队列
    sched2 = LearningScheduler(interval=0.1)
    assert len(sched2._queue) == 1
    asyncio.run(sched2._drain())
    assert len(fake_svc.calls) == 1
