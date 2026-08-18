# 架构统一方案：以 Hermes 为核心

**日期**: 2026-08-17
**作者**: 汐月 (Hermes Agent)
**状态**: 草稿 — 等待锟哥讨论确认

---

## 1. 核心理念：大树嫁接

```
        Hermes Core (主干，原封不动)
        ├── hermes_state.py         ← 会话存储 + FTS5 + 压缩锁
        ├── memory_manager.py        ← 上下文压缩
        ├── message_sanitization.py  ← 消息清洗
        ├── sqlite_runtime.py        ← SQLite 运行时
        ├── hermes_bootstrap.py      ← Windows 启动修复
        ├── _subprocess_compat.py    ← 子进程兼容
        ├── hermes_constants.py      ← 平台路径 + Hermes Home
        ├── hermes_state_search.py   ← 复杂会话搜索
        ├── hermes_state_portability.py ← 状态导入导出
        ├── skill_commands.py        ← 技能脚手架
        ├── stubs.py                 ← 类型桩
        ├── verify.py                ← 安装验证
        └── ...
              │
              │  嫁接
              ▼
        desk-pet 定制层 (枝桠)
        ├── emotion/              ← 情绪/表情/激素系统
        ├── memory/               ← 记忆碎片 (core.db)
        ├── soul/                 ← 人格/漂移
        ├── time/                 ← 昼夜/纪念日
        ├── voice/                ← TTS/STT/语音服务
        ├── live2d/               ← Live2D 模型控制
        ├── tools/                ← 本地工具 + 前端工具循环
        └── ui/                   ← Tauri 前端界面
```

**原则**：
- Hermes 提供**基础设施**：会话管理、FTS5、上下文压缩、SQLite
- 我们提供**桌面伴侣体验**：情绪、记忆碎片、语音、Live2D、本地工具
- Hermes Core **原封不动**，不做任何剪枝
- 新增 `desk_pet/` 作为嫁接层，通过统一 API 与 Hermes 协作

---

## 2. 为什么不做剪枝

- Hermes Core 总共 **16445 行**，是经过生产验证的成熟代码
- 桌面端不需要 delegate 子代理、复杂搜索等功能，但**保留它们没有运行时成本**
- 剪枝会带来维护负担：每次 Hermes 上游更新都要解决冲突
- 内存占用增加 < 10MB，启动慢 < 50ms — 桌面端完全无感
- **多平台扩展性**：将来想接入 QQ/Telegram/Discord，Hermes 原生支持，不用回退

**结论**：Hermes 代码是资产，不是负担。全部保留。

---

## 3. 嫁接层设计

### 3.1 现有项目代码（整理后）

```
server/desk_pet/
├── emotion/              ← 情绪系统
│   ├── emotion_engine.py
│   ├── expression.py
│   └── hormone.py
├── memory/               ← 记忆碎片
│   ├── fragment.py
│   ├── store.py
│   ├── archivist.py
│   ├── hebbian.py
│   ├── librarian.py
│   ├── scribe.py
│   └── memory_service.py
├── soul/                 ← 人格/漂移
│   ├── personality.py
│   └── drift.py
├── time/                 ← 昼夜/纪念日
│   ├── circadian.py
│   └── anniversaries.py
├── voice/                ← 语音服务
│   ├── tts/              ← CosyVoice/Edge/GPT-SoVITS
│   ├── stt/              ← Whisper
│   └── voiceprint/       ← 声纹识别
├── live2d/               ← Live2D 模型
│   ├── model_control.py
│   └── motion_scheduler.py
└── tools/                ← 本地工具 + 工具循环
    ├── local/            ← open_app, get_volume 等
    ├── frontend/         ← 前端工具执行
    └── loop.py           ← 工具调用循环
```

### 3.2 统一 API 入口

```python
from hermes_core import SessionDB, MemoryStore
from desk_pet.emotion import EmotionEngine
from desk_pet.soul import PersonalityEngine
from desk_pet.time import TimePerception
from desk_pet.voice import VoiceService
from desk_pet.live2d import Live2DController
from desk_pet.tools import ToolLoop

# Hermes 原生能力
session = SessionDB()

# 桌面伴侣能力
emotion = EmotionEngine()
personality = PersonalityEngine()
time = TimePerception()
voice = VoiceService()
live2d = Live2DController()
tools = ToolLoop()
```

---

## 4. 数据库架构

### 4.1 保留两个文件（不合并）

| 文件 | 管理者 | 内容 |
|------|--------|------|
| `data/hermes_state.db` | `hermes_core` | messages + FTS5 + sessions |
| `data/core.db` | `desk_pet.memory` | memory_fragments + emotion_history + personality_states |

**为什么不合并？**
- 写入模式不同：hermes_state.db 是事务密集（每轮对话写消息），core.db 是追加密集（记忆碎片批量写入）
- 索引不同：FTS5 vs BM25 + 向量
- 生命周期不同：会话可压缩/删除，记忆碎片永久保留

### 4.2 统一访问入口

```python
from hermes_core import SessionDB
from desk_pet.memory import MemoryStore

# 会话管理（Hermes 原生）
session = SessionDB()

# 记忆碎片（桌面伴侣）
memory = MemoryStore(character_id="nahida")
```

---

## 5. 执行计划

### 阶段 1：整理嫁接层代码（本周）
1. 创建 `server/desk_pet/` 目录结构
2. 将 `core/heart/` → `desk_pet/emotion/`
3. 将 `core/soul/` → `desk_pet/soul/`
4. 将 `core/time/` → `desk_pet/time/`
5. 将 `core/brain/` → `desk_pet/memory/`
6. 将 `server/voice_services.py` → `desk_pet/voice/`
7. 将 `server/tools/` → `desk_pet/tools/`
8. 将 `server/live2d/` → `desk_pet/live2d/`

**预计**: 整理 ~3000 行代码

### 阶段 2：创建统一 API（下周）
1. 创建 `desk_pet/__init__.py` — 统一导出
2. 创建 `hermes_core/__init__.py` — 重新导出 Hermes API
3. 更新 `server/hermes_gateway_server.py` — 使用统一 API
4. 更新 `server/core/api_server.py` — 使用统一 API

### 阶段 3：迁移调用方（下下周）
1. 更新前端 `useBrainBridge.ts` → 调用 `desk_pet.memory`
2. 更新前端 `useEmotion.ts` → 调用 `desk_pet.emotion`
3. 更新 Rust `backend.rs` → 调用 `desk_pet.tools`
4. 删除 `core/brain/` 遗留代码（验证后再删）

### 阶段 4：验证与清理
1. 运行完整测试套件
2. 手动测试对话、TTS、情绪、Live2D
3. 更新 PLAN.md

---

## 6. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| 嫁接层与 Hermes Core 冲突 | 低 | 中 | 保持两个数据库，不合并 |
| 前端工具循环与 Hermes 工具系统冲突 | 低 | 低 | 桌面端用自有工具循环，Hermes 工具系统不启用 |
| Live2D 模型与 Hermes 表达系统冲突 | 低 | 低 | Live2D 作为独立模块，通过 emotion 集成 |

---

## 7. 下一步（等待锟哥确认）

1. 确认"大树嫁接"方向
2. 确认不做任何剪枝
3. 确认 `server/desk_pet/` 作为嫁接层目录名
4. 批准开始阶段 1：整理嫁接层代码

---

*文档版本: 3.0 (无剪枝版)*
*最后更新: 2026-08-17*
