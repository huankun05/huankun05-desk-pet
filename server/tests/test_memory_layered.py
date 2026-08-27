"""L0-L3 分层记忆回归测试（借鉴 TencentDB Agent Memory 的分层金字塔）。

覆盖：
- L0 原始对话落盘 + L1 原子记忆抽取（去重仍成立）
- 分层召回：L3 画像 / L2 场景始终注入，query 召回 L1，无 L1 时回退 L0
- L2 场景离线聚合（按共享话题聚类 + 成员归属标记）
- L3 用户画像离线生成（白盒落盘 memory_persona.md）
- 空闲自学习阈值触发 maybe_autogenerate（场景 / 画像）
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SERVER_DIR = Path(__file__).resolve().parent.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import hermes_core.memory.memory_service as ms_mod  # noqa: E402
import hermes_core.memory.store as store_mod  # noqa: E402
from hermes_core.memory.memory_service import get_memory_service, reset_memory_service_cache  # noqa: E402

# 通过 memory_service 模块访问常量（core.brain 兼容层未再导出这些新常量）
LAYER_L0 = ms_mod.LAYER_L0
LAYER_L1 = ms_mod.LAYER_L1
LAYER_L2 = ms_mod.LAYER_L2
LAYER_L3 = ms_mod.LAYER_L3
CATEGORY_RAW = ms_mod.CATEGORY_RAW
CATEGORY_SCENE = ms_mod.CATEGORY_SCENE
CATEGORY_PERSONA = ms_mod.CATEGORY_PERSONA
CATEGORY_PREFERENCE = ms_mod.CATEGORY_PREFERENCE
CATEGORY_FACT = ms_mod.CATEGORY_FACT
CATEGORY_RULE = ms_mod.CATEGORY_RULE
SCENE_EVERY = ms_mod.SCENE_EVERY
PERSONA_EVERY = ms_mod.PERSONA_EVERY
MemoryFragment = ms_mod.MemoryFragment


@pytest.fixture
def tmp_db(monkeypatch, tmp_path):
    """把记忆库指向临时文件，避免污染真实 data/core.db，并重置服务缓存。"""
    reset_memory_service_cache()
    path = tmp_path / "core.db"
    monkeypatch.setattr(ms_mod, "get_db_path", lambda: path)
    monkeypatch.setattr(store_mod, "get_db_path", lambda: path)
    yield path
    reset_memory_service_cache()


def test_l0_and_l1_capture(tmp_db):
    """extract_and_store 同时落盘 L0 原始对话与 L1 原子记忆。"""
    svc = get_memory_service("l0l1", "u")
    saved = svc.extract_and_store("我喜欢喝抹茶拿铁", "好的，记住了")
    assert len(saved) >= 1
    l1 = svc.store.list_by_layer(LAYER_L1)
    assert any(f.category == CATEGORY_PREFERENCE for f in l1)
    l0 = svc.store.list_by_layer(LAYER_L0)
    assert len(l0) == 1
    assert "用户：" in l0[0].content and "抹茶拿铁" in l0[0].content


def test_extract_idempotent_with_l0(tmp_db):
    """相同对话重复抽取：L1 仍为 0 新增，且 L0 原始对话不重复落盘。"""
    svc = get_memory_service("idem2", "u")
    ex = "我喜欢吃火锅，周末常去"
    svc.extract_and_store(ex, "好的，我已记住")
    r2 = svc.extract_and_store(ex, "好的，我已记住")
    assert len(r2) == 0
    # L0 仅 1 条（去重）
    assert svc.store.count_by_layer(LAYER_L0) == 1


def test_layered_recall_includes_persona_and_l1(tmp_db):
    """有画像与 L1 时，注入块包含 L3 画像与按 query 召回的 L1。"""
    svc = get_memory_service("recall", "u")
    svc.extract_and_store("我喜欢蓝色，是一名设计师", "好的")
    svc.extract_and_store("我明天要去上海出差", "好的")
    svc.generate_persona(use_llm=False)
    prompt = svc.build_injection_prompt(query="上海天气怎么样")
    assert "【用户画像 L3】" in prompt
    assert "上海" in prompt  # L1 相关召回


def test_l0_fallback_injection(tmp_db):
    """无 L1 仅有 L0 时，注入回退到 L0 原始对话片段。"""
    svc = get_memory_service("l0fb", "u")
    svc.extract_and_store("我的猫叫咪咪", "好可爱")
    # 清除 L1，仅保留 L0
    for f in svc.store.list_by_layer(LAYER_L1):
        svc.store.delete(f.id)
    prompt = svc.build_injection_prompt(query="你的猫叫什么")
    assert "【原始对话片段 L0】" in prompt


def test_generate_scene_offline(tmp_db):
    """离线按共享话题聚类生成 L2 场景块，并标记成员归属。"""
    svc = get_memory_service("scene", "u")
    cid = "scene"
    svc.store.add(MemoryFragment(
        content="用户喜欢喝咖啡", category=CATEGORY_PREFERENCE,
        layer=LAYER_L1, importance=0.7, character_id=cid, user_id="u",
    ))
    svc.store.add(MemoryFragment(
        content="用户在星巴克买了咖啡", category=CATEGORY_FACT,
        layer=LAYER_L1, importance=0.6, character_id=cid, user_id="u",
    ))
    scene = svc.generate_scene(use_llm=False)
    assert scene is not None
    scenes = svc.store.list_by_layer(LAYER_L2)
    assert len(scenes) == 1
    assert scenes[0].layer == LAYER_L2
    assert scenes[0].category == CATEGORY_SCENE
    member = svc.store.get(scenes[0].meta["member_ids"][0])
    assert member.meta.get("scene_id") == scenes[0].id


def test_generate_persona_offline_and_whitebox(tmp_db, tmp_path):
    """离线生成 L3 画像（永久），并白盒落盘 memory_persona.md。"""
    svc = get_memory_service("persona", "u")
    cid = "persona"
    svc.store.add(MemoryFragment(
        content="用户是大学生", category=CATEGORY_FACT,
        layer=LAYER_L1, importance=0.8, character_id=cid, user_id="u",
    ))
    svc.store.add(MemoryFragment(
        content="用户喜欢喝咖啡", category=CATEGORY_PREFERENCE,
        layer=LAYER_L1, importance=0.7, character_id=cid, user_id="u",
    ))
    res = svc.generate_persona(use_llm=False)
    assert res is not None
    personas = svc.store.list_by_layer(LAYER_L3)
    assert len(personas) == 1
    assert personas[0].is_permanent
    persona_file = tmp_path / "memory_persona.md"
    assert persona_file.exists()
    assert "用户画像" in persona_file.read_text(encoding="utf-8")


def test_maybe_autogenerate_scene_threshold(tmp_db):
    """累计达到场景阈值（且存在可聚类 L1）时自动生成 L2 场景。"""
    svc = get_memory_service("ag_scene", "u")
    cid = "ag_scene"
    for i in range(4):
        svc.store.add(MemoryFragment(
            content=f"用户测试话题{i}关于咖啡", category=CATEGORY_FACT,
            layer=LAYER_L1, importance=0.6, character_id=cid, user_id="u",
        ))
    # 未达阈值不应生成
    svc.maybe_autogenerate(new_count=3, use_llm=False)
    assert svc.store.count_by_layer(LAYER_L2) == 0
    # 达阈值生成
    svc.maybe_autogenerate(new_count=SCENE_EVERY, use_llm=False)
    assert svc.store.count_by_layer(LAYER_L2) >= 1


def test_maybe_autogenerate_persona_threshold(tmp_db):
    """累计达到画像阈值时自动生成 L3 画像。"""
    svc = get_memory_service("ag_persona", "u")
    cid = "ag_persona"
    for i in range(4):
        svc.store.add(MemoryFragment(
            content=f"用户测试话题{i}关于音乐", category=CATEGORY_FACT,
            layer=LAYER_L1, importance=0.6, character_id=cid, user_id="u",
        ))
    svc.maybe_autogenerate(new_count=PERSONA_EVERY, use_llm=False)
    assert svc.store.count_by_layer(LAYER_L3) == 1


def test_generate_persona_llm_cleans_fences(tmp_db):
    """LLM 生成画像路径（会走到 re.sub 清理代码块）不崩，且正确去围栏。"""
    svc = get_memory_service("persona_llm", "u")
    cid = "persona_llm"
    svc.store.add(MemoryFragment(
        content="用户是大学生", category=CATEGORY_FACT,
        layer=LAYER_L1, importance=0.8, character_id=cid, user_id="u",
    ))
    svc.store.add(MemoryFragment(
        content="用户喜欢喝咖啡", category=CATEGORY_PREFERENCE,
        layer=LAYER_L1, importance=0.7, character_id=cid, user_id="u",
    ))

    def fake_llm(messages):
        # 故意返回带 ```md 围栏的回复，验证 _clean_persona 的 re.sub 路径
        return "```markdown\n# 用户画像\n## 基础锚点\n- 用户是大学生\n## 兴趣图谱\n- 用户喜欢喝咖啡\n```"

    res = svc.generate_persona(use_llm=True, llm_fn=fake_llm)
    assert res is not None
    personas = svc.store.list_by_layer(LAYER_L3)
    assert len(personas) == 1
    # 围栏应被剥离，clean 后不以 ``` 开头
    assert not personas[0].content.lstrip().startswith("```")
    assert "用户是大学生" in personas[0].content


def test_event_excluded_from_l1_recall(tmp_db):
    """迭代#3：瞬时 event 类记忆不应作为稳定 L1 事实被语义召回。"""
    svc = get_memory_service("evt_recall", "u")
    cid = "evt_recall"
    svc.store.add(MemoryFragment(
        content="用户今天去跑步了", category="event",
        layer=LAYER_L1, importance=0.6, character_id=cid, user_id="u",
    ))
    svc.store.add(MemoryFragment(
        content="用户喜欢喝咖啡", category=CATEGORY_PREFERENCE,
        layer=LAYER_L1, importance=0.7, character_id=cid, user_id="u",
    ))
    prompt = svc.build_injection_prompt(query="用户今天做了什么运动")
    # event 不应出现在【相关记忆 L1】
    assert "用户今天去跑步了" not in prompt
    # 但偏好仍正常注入
    assert "用户喜欢喝咖啡" in prompt


def test_l0_fallback_when_l1_sparse(tmp_db):
    """迭代#4：L1 相关记忆不足阈值时回退检索 L0 原始对话。"""
    svc = get_memory_service("l0_fb", "u")
    cid = "l0_fb"
    # 仅 1 条可召回的 L1（低于 L0_FALLBACK_MIN_L1=2）
    svc.store.add(MemoryFragment(
        content="用户提到想学吉他", category=CATEGORY_FACT,
        layer=LAYER_L1, importance=0.6, character_id=cid, user_id="u",
    ))
    # 一条 L0 原始对话
    svc.store.add(MemoryFragment(
        content="用户：我想学吉他\n助手：好的，从基础和弦开始", category=CATEGORY_RAW,
        layer=LAYER_L0, importance=0.2, character_id=cid, user_id="u",
    ))
    prompt = svc.build_injection_prompt(query="吉他怎么学")
    # 证据不足 → 应回退到 L0 原始对话片段
    assert "【原始对话片段 L0】" in prompt
    assert "我想学吉他" in prompt


def test_no_l0_fallback_when_l1_enough(tmp_db):
    """迭代#4：L1 相关记忆充足时不应回退 L0（避免噪声）。"""
    svc = get_memory_service("l0_nofb", "u")
    cid = "l0_nofb"
    for i in range(3):
        svc.store.add(MemoryFragment(
            content=f"用户学习吉他第{i}课", category=CATEGORY_FACT,
            layer=LAYER_L1, importance=0.6, character_id=cid, user_id="u",
        ))
    svc.store.add(MemoryFragment(
        content="用户：我想学吉他\n助手：好的", category=CATEGORY_RAW,
        layer=LAYER_L0, importance=0.2, character_id=cid, user_id="u",
    ))
    prompt = svc.build_injection_prompt(query="吉他")
    assert "【相关记忆 L1】" in prompt
    assert "【原始对话片段 L0】" not in prompt
