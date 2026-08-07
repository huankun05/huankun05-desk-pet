"""Brain 记忆系统端到端测试。

测试范围：
1. MemoryStore CRUD
2. LocalHashEmbedder 向量一致性
3. Librarian 检索 + Prompt 格式化
4. Scribe 规则提取 + LLM 提取
5. Session 记忆注入 + reflect_on_exchange
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# 将项目根目录加入路径
PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from core.brain.fragment import MemoryFragment
from core.brain.store import MemoryStore, get_db_path
from core.brain.embedding import LocalHashEmbedder, cosine_similarity
from core.brain.librarian import Librarian
from core.brain.scribe import Scribe, ExtractionConfig
from core.session import Session


class TestMemoryE2E:
    """Brain 记忆系统 E2E 测试。"""

    @classmethod
    def setup_class(cls):
        """使用临时数据库，避免污染生产数据。"""
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.db_path = Path(cls.temp_dir.name) / "test_core.db"
        # 通过 monkey-patch 修改 store 的默认 DB 路径
        import core.brain.store as store_module
        cls._original_db_path = store_module._DEFAULT_DB_PATH
        store_module._DEFAULT_DB_PATH = cls.db_path
        cls.store = MemoryStore(character_id="test_char", user_id="test_user")

    @classmethod
    def teardown_class(cls):
        cls.temp_dir.cleanup()
        import core.brain.store as store_module
        store_module._DEFAULT_DB_PATH = cls._original_db_path

    def test_store_crud(self):
        frag = MemoryFragment(content="用户喜欢喝抹茶拿铁", importance=0.7)
        saved = self.store.add(frag)
        assert saved.id is not None

        fetched = self.store.get(saved.id)
        assert fetched is not None
        assert fetched.content == "用户喜欢喝抹茶拿铁"
        assert fetched.importance == 0.7

    def test_local_hash_embedding(self):
        embedder = LocalHashEmbedder()
        vec1 = embedder.embed("我喜欢抹茶")
        vec2 = embedder.embed("我喜欢抹茶")
        assert len(vec1) == 384
        assert vec1 == vec2, "相同文本应产生相同向量"

        vec3 = embedder.embed("完全无关的句子")
        sim = cosine_similarity(vec1, vec3)
        assert -1.0 <= sim <= 1.0

    def test_librarian_search(self):
        # 准备测试数据
        fragments = [
            MemoryFragment(content="用户喜欢喝抹茶拿铁", importance=0.8),
            MemoryFragment(content="用户讨厌下雨天出门", importance=0.6),
            MemoryFragment(content="用户的生日是 3 月 15 日", importance=0.9),
        ]
        for frag in fragments:
            self.store.add(frag)

        librarian = Librarian(store=self.store, top_k=2)
        results = librarian.search("我喜欢喝什么")
        assert len(results) <= 2
        assert any("抹茶" in r.fragment.content for r in results)

        prompt = librarian.format_prompt(results)
        assert "【相关记忆】" in prompt

    def test_scribe_rule_extraction(self):
        scribe = Scribe(
            store=self.store,
            config=ExtractionConfig(enable_rule_based=True, enable_llm=False),
        )
        fragments = scribe.extract_from_exchange(
            user_text="我喜欢喝抹茶拿铁，讨厌下雨天出门。",
            assistant_text="原来你喜欢抹茶呀，下雨天出门确实不舒服。",
        )
        assert len(fragments) >= 1
        contents = {f.content for f in fragments}
        assert any("抹茶" in c for c in contents)
        assert all(f.importance >= 0.3 for f in fragments)

    def test_scribe_llm_extraction(self):
        """使用 mock LLM 验证 LLM 提取路径。"""

        def mock_llm(prompt: str) -> str:
            return '[{"content": "用户是一名软件工程师", "importance": 0.8}]'

        scribe = Scribe(
            store=self.store,
            llm_client=mock_llm,
            config=ExtractionConfig(enable_rule_based=False, enable_llm=True),
        )
        fragments = scribe.extract_from_exchange(
            user_text="我是一名软件工程师。",
            assistant_text="好的，我记住了。",
        )
        assert len(fragments) == 1
        assert "软件工程师" in fragments[0].content

    def test_session_memory_injection(self):
        # 先清空当前测试库，避免之前测试数据干扰
        for frag in self.store.list_all(limit=1000):
            if frag.id is not None:
                self.store.delete(frag.id)

        self.store.add(MemoryFragment(content="用户喜欢喝抹茶拿铁", importance=0.8))

        # 调试：确认 fragment 已写入
        all_frags = self.store.list_all(limit=10)
        print(f"  DEBUG stored fragments: {[(f.id, f.content, f.character_id, f.user_id) for f in all_frags]}")

        session = Session(
            config={
                "character_id": "test_char",
                "user_id": "test_user",
                "memory_enabled": True,
                "memory_top_k": 3,
                "system_prompt_file": "nonexistent.txt",
            }
        )
        session.system_prompt = "你是纳西妲。"
        session.add_user_message("我今天想喝点什么？")

        # 调试：直接检查 Librarian 召回结果
        if session._librarian is not None:
            print(f"  DEBUG session store: char={session._librarian.store.character_id}, user={session._librarian.store.user_id}")
            import core.brain.store as sm
            print(f"  DEBUG db path: {sm._DEFAULT_DB_PATH}")
            raw_results = session._librarian.search("我今天想喝点什么？", top_k=3)
            print(f"  DEBUG librarian results: {[(r.fragment.content, r.score) for r in raw_results]}")

        context = session.get_context()

        system_msg = next((m for m in context if m["role"] == "system"), None)
        assert system_msg is not None, "未生成 system 消息"
        print(f"  DEBUG system content: {system_msg['content'][:200]}")
        assert "【相关记忆】" in system_msg["content"]
        assert "抹茶" in system_msg["content"]

    def test_session_reflect_and_save(self):
        # 先清空
        for frag in self.store.list_all(limit=1000):
            if frag.id is not None:
                self.store.delete(frag.id)

        session = Session(
            config={
                "character_id": "test_char",
                "user_id": "test_user",
                "memory_enabled": True,
                "memory_reflection_enabled": True,
                "system_prompt_file": "nonexistent.txt",
            }
        )
        saved = session.reflect_on_exchange(
            user_text="我喜欢在下雨天看书。",
            assistant_text="下雨天看书很惬意呢。",
        )
        assert len(saved) >= 1
        assert any("看书" in f["content"] for f in saved)


if __name__ == "__main__":
    test = TestMemoryE2E()
    test.setup_class()
    try:
        for name in dir(test):
            if name.startswith("test_"):
                print(f"Running {name}...")
                getattr(test, name)()
                print(f"  ✅ {name} passed")
    finally:
        test.teardown_class()
    print("\n🎉 所有 Brain 记忆 E2E 测试通过")
