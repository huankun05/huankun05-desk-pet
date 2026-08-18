# 架构统一方案：基于 Hermes 再开发

**日期**: 2026-08-17
**作者**: 汐月 (Hermes Agent)
**状态**: 草稿 — 等待锟哥确认后执行

---

## 1. 核心理念：再开发，不是一个整体

```
        server/hermes_core/ (一个整体)
        ├── hermes_state.py         ← Hermes 原版，不动
        ├── memory_manager.py       ← Hermes 原版，不动
        ├── message_sanitization.py ← Hermes 原版，不动
        ├── sqlite_runtime.py       ← Hermes 原版，不动
        ├── hermes_bootstrap.py     ← Hermes 原版，不动
        ├── _subprocess_compat.py   ← Hermes 原版，不动
        ├── hermes_constants.py     ← Hermes 原版，不动
        ├── hermes_state_search.py  ← Hermes 原版，不动
        ├── hermes_state_portability.py ← Hermes 原版，不动
        ├── skill_commands.py       ← Hermes 原版，不动
        ├── stubs.py                ← Hermes 原版，不动
        ├── verify.py               ← Hermes 原版，不动
        │
        ├── emotion.py              ← 我们新增：情绪引擎
        ├── emotion/                ← 我们新增：情绪子模块
        │   ├── expression.py
        │   └── hormone.py
        ├── soul.py                 ← 我们新增：人格/漂移
        ├── soul/                   ← 我们新增：人格子模块
        │   ├── personality.py
        │   └── drift.py
        ├── time.py                 ← 我们新增：时间感知
        ├── time/                   ← 我们新增：时间子模块
        │   ├── circadian.py
        │   └── anniversaries.py
        ├── voice.py                ← 我们新增：语音接口
        ├── voice/                  ← 我们新增：语音子模块
        │   ├── tts/                ← CosyVoice/Edge/GPT-SoVITS
        │   ├── stt/                ← Whisper
        │   └── voiceprint/         ← 声纹识别
        ├── live2d/                 ← 我们新增：Live2D 模型
        │   ├── model_control.py
        │   └── motion_scheduler.py
        └── tools/                  ← 我们新增：本地工具
            ├── local/             ← open_app, get_volume 等
            ├── frontend/          ← 前端工具执行
            └── loop.py            ← 工具调用循环
```

**原则**：
- Hermes 原版文件**完全不动**
- 我们的新功能**直接写进 `hermes_core/` 里面**
- 像 Hermes 原生模块一样被 import、被使用
- 一个整体，不是两个系统通过 API 协作

---

## 2. 为什么是"再开发"而不是"嫁接"

| 维度 | 嫁接层（外部） | 再开发（内部） |
|------|---------------|---------------|
| 架构 | 两个独立系统通过 API 通信 | 一个系统，所有模块平级 |
| 使用方式 | `from desk_pet.emotion import EmotionEngine` | `from hermes_core import EmotionEngine` |
| 启动流程 | 先初始化 Hermes，再初始化 desk_pet | Hermes 启动时自动加载所有模块 |
| 数据流 | 情绪状态通过 API 传给 Hermes | 情绪状态直接写入 Hermes 上下文 |
| 扩展性 | 多平台接入需要额外适配层 | 多平台接入直接使用 Hermes 原生能力 |
| 维护成本 | 两套代码，两份文档 | 一套代码，一个入口 |

**锟哥你要的是"再开发"**：我们的功能成为 Hermes 的一部分，像它原生的 `hermes_state.py` 一样。

---

## 3. 使用方式（再开发后的体验）

```python
# 一个 import，所有能力
from hermes_core import (
    SessionDB,          # Hermes 原版：会话管理
    MemoryManager,      # Hermes 原版：上下文压缩
    EmotionEngine,      # 我们新增：情绪系统
    SoulEngine,         # 我们新增：人格/漂移
    TimePerception,     # 我们新增：时间感知
    VoiceService,       # 我们新增：语音服务
    Live2DController,   # 我们新增：Live2D 模型
    ToolLoop,           # 我们新增：工具循环
)

# Hermes 原版能力
session = SessionDB()

# 桌面伴侣能力（和原生能力一样的使用方式）
emotion = EmotionEngine()
personality = SoulEngine()
time = TimePerception()
voice = VoiceService()
live2d = Live2DController()
tools = ToolLoop()
```

---

## 4. 数据库架构

### 4.1 两个文件，各管各的

| 文件 | 管理者 | 内容 |
|------|--------|------|
| `data/hermes_state.db` | `hermes_core.hermes_state` | messages + FTS5 + sessions |
| `data/core.db` | `hermes_core.memory` | memory_fragments + emotion_history + personality_states |

**为什么不合并？**
- 写入模式不同：hermes_state.db 是事务密集（每轮对话写消息），core.db 是追加密集（记忆碎片批量写入）
- 索引不同：FTS5 vs BM25 + 向量
- 生命周期不同：会话可压缩/删除，记忆碎片永久保留

**但代码上是一个整体**：两个数据库都由 `hermes_core` 管理，不外部暴露。

---

## 5. 执行计划

### 阶段 1：整理代码到 hermes_core/（本周）
1. 创建 `server/hermes_core/emotion/` — 从 `core/heart/` 迁入
2. 创建 `server/hermes_core/soul/` — 从 `core/soul/` 迁入
3. 创建 `server/hermes_core/time/` — 从 `core/time/` 迁入
4. 创建 `server/hermes_core/memory/` — 从 `core/brain/` 迁入
5. 创建 `server/hermes_core/voice/` — 从 `server/voice_services.py` 拆分
6. 创建 `server/hermes_core/live2d/` — 从 `server/live2d/` 迁入
7. 创建 `server/hermes_core/tools/` — 从 `server/tools/` 迁入

**预计**: 整理 ~3000 行代码到 `hermes_core/` 目录

### 阶段 2：创建统一入口（下周）
1. 更新 `hermes_core/__init__.py` — 导出所有能力（Hermes 原版 + 我们新增）
2. 创建 `hermes_core/emotion.py` — 情绪引擎入口
3. 创建 `hermes_core/soul.py` — 人格引擎入口
4. 创建 `hermes_core/time.py` — 时间感知入口
5. 创建 `hermes_core/voice.py` — 语音服务入口
6. 创建 `hermes_core/tools/__init__.py` — 工具循环入口

### 阶段 3：迁移调用方（下下周）
1. 更新 `server/hermes_gateway_server.py` — 使用 `from hermes_core import EmotionEngine`
2. 更新 `server/core/api_server.py` — 使用 `from hermes_core import MemoryStore`
3. 更新前端 `useBrainBridge.ts` — 调用 `hermes_core.memory`
4. 更新前端 `useEmotion.ts` — 调用 `hermes_core.emotion`
5. 更新 Rust `backend.rs` — 调用 `hermes_core.tools`

### 阶段 4：清理与验证
1. 删除 `core/heart/`、`core/soul/`、`core/time/`、`core/brain/`（验证通过后）
2. 运行完整测试套件
3. 手动测试对话、TTS、情绪、Live2D
4. 更新 PLAN.md

---

## 6. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| 新模块与 Hermes 原版冲突 | 低 | 中 | 保持目录隔离，不修改原版文件 |
| import 路径混乱 | 中 | 低 | 统一通过 `hermes_core/__init__.py` 导出 |
| 数据库访问冲突 | 低 | 高 | 两个数据库各管各的，不合并 |
| 前端适配工作量 | 中 | 中 | 逐步迁移，保持向后兼容 |

---

## 7. 下一步（等待锟哥确认）

1. 确认"再开发"方向 — 我们的代码直接进 `hermes_core/`
2. 确认 Hermes 原版文件完全不动
3. 确认两个数据库保持独立
4. 批准开始阶段 1：整理代码到 `hermes_core/`

---

*文档版本: 4.0 (再开发方案)*
*最后更新: 2026-08-17*
