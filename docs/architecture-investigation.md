# 架构统一方案：以 Hermes 为核心

**日期**: 2026-08-17
**作者**: 汐月 (Hermes Agent)
**状态**: 草稿 — 等待锟哥讨论确认

---

## 1. 核心理念：大树嫁接

```
        Hermes Core (主干)
        ├── hermes_state.py      ← 会话存储 + FTS5
        ├── memory_manager.py     ← 上下文压缩
        ├── message_sanitization.py ← 消息清洗
        └── sqlite_runtime.py     ← SQLite 运行时
              │
              │  嫁接
              ▼
        desk-pet 定制层 (枝桠)
        ├── emotion/              ← 情绪/表情/激素系统
        ├── memory_fragments/     ← 记忆碎片 (核心.db)
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
- 代码结构：`hermes_core/` 保持原样，新增 `desk_pet/` 作为嫁接层

---

## 2. Hermes 主干：保留什么，剪掉什么

### 2.1 保留（核心能力）

| 模块 | 作用 | 为什么保留 |
|------|------|-----------|
| `hermes_state.py` (8569 行) | SessionDB + FTS5 + 压缩锁 | 会话持久化是刚需，已生产验证 |
| `memory_manager.py` | 上下文压缩、记忆管理 | 长对话自动压缩，避免上下文爆炸 |
| `message_sanitization.py` | 消息清洗、代理对去除 | 防止 Unicode 错误和安全问题 |
| `sqlite_runtime.py` | SQLite 运行时检查 | WAL bug 检测、版本兼容 |
| `hermes_bootstrap.py` | Windows 平台启动修复 | 防止 platform.win32_ver() 崩溃 |
| `_subprocess_compat.py` | 子进程兼容层 | Windows 下 Python 子进程稳定 |

### 2.2 剪掉（桌面端不需要）

| 模块/功能 | 为什么剪掉 |
|-----------|-----------|
| `skill_commands.py` | 技能脚手架系统，桌面端不需要 |
| `hermes_state_portability.py` | 状态导入导出（JSONL 迁移），桌面端只有单个用户 |
| `hermes_state_search.py` | 复杂会话搜索（delegate 子代理等），桌面端不需要多平台过滤 |
| `hermes_constants.py` | Hermes 平台路径（Telegram/Discord 数据目录等），桌面端有固定路径 |
| `stubs.py` | 类型桩，桌面端不需要 |
| `verify.py` | 安装验证脚本，不需要 |
| `hermes_logging.py` | 多平台日志配置，桌面端用标准 logging |

**预计剪掉**: ~3000 行

### 2.3 简化（保留核心，删除冗余）

| 模块 | 简化方案 |
|------|---------|
| `hermes_state.py` | 保留核心 SessionDB + FTS5，删除 delegate 子代理、多平台 source 过滤 |
| `hermes_state_common.py` | 只保留 SCHEMA_SQL + FTS_SQL，删除复杂 trigger |
| `hermes_state_schema.py` | 简化 schema 版本管理（桌面端不需要跨版本迁移） |

**预计简化**: ~4000 行 → ~2000 行

---

## 3. 嫁接层：我们添加什么

### 3.1 现有项目代码（直接搬入）

```
desk_pet/
├── emotion/              ← 情绪系统 (heart/)
│   ├── emotion_engine.py
│   ├── expression.py
│   └── hormone.py
├── memory/               ← 记忆碎片 (brain/)
│   ├── fragment.py
│   ├── store.py          ← 迁入 hermes_core 作为 MemoryStore 扩展
│   ├── archivist.py
│   ├── hebbian.py
│   ├── librarian.py
│   └── scribe.py
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
├── tools/                ← 本地工具 + 工具循环
│   ├── local/            ← open_app, get_volume 等
│   ├── frontend/         ← 前端工具执行
│   └── loop.py           ← 工具调用循环
└── ui/                   ← Tauri 前端
    └── (已有，不动)
```

### 3.2 新增集成点

```
hermes_core/
├── __init__.py                    ← 重新导出：SessionDB + MemoryStore + EmotionEngine
├── hermes_state.py                ← 剪枝后保留核心
├── memory_unified.py              ← 新增：统一记忆接口
│   ├── search(query, limit)       ← FTS5 messages + BM25 fragments
│   ├── add_fragment(fragment)     ← 写入 core.db
│   └── get_session_history(sid)   ← 读取 hermes_state.db
├── emotion.py                     ← 新增：情绪引擎（从 core/heart 迁入）
├── soul.py                        ← 新增：人格系统（从 core/soul 迁入）
├── time.py                        ← 新增：时间感知（从 core/time 迁入）
└── voice.py                       ← 新增：语音接口（从 server/voice_services 迁入）
```

---

## 4. 数据库架构

### 4.1 保留两个文件（不合并）

| 文件 | 管理者 | 内容 |
|------|--------|------|
| `data/hermes_state.db` | `hermes_core` | messages + FTS5 + sessions |
| `data/core.db` | `hermes_core.memory_unified` | memory_fragments + emotion_history + personality_states |

**为什么不合并？**
- 写入模式不同：hermes_state.db 是事务密集（每轮对话写消息），core.db 是追加密集（记忆碎片批量写入）
- 索引不同：FTS5 vs BM25 + 向量
- 生命周期不同：会话可压缩/删除，记忆碎片永久保留

### 4.2 统一访问入口

```python
from hermes_core import SessionDB, MemoryStore, EmotionEngine

# 会话管理（Hermes 原生）
session = SessionDB()

# 记忆碎片（我们嫁接）
memory = MemoryStore(character_id="nahida")

# 情绪系统（我们嫁接）
emotion = EmotionEngine()
```

---

## 5. 执行计划

### 阶段 1：剪枝 Hermes（本周）
1. 删除 `skill_commands.py`, `hermes_state_portability.py`, `hermes_state_search.py`
2. 简化 `hermes_constants.py`（删除平台特定路径）
3. 删除 `stubs.py`, `verify.py`, `hermes_logging.py`
4. 简化 `hermes_state.py`（删除 delegate 子代理、多平台 source）
5. 简化 `hermes_state_common.py`（删除复杂 trigger）
6. 运行 `cargo check` + `tsc --noEmit` 确保不破坏

**预计**: 剪掉 ~3000 行，简化 ~2000 行

### 阶段 2：嫁接我们的代码（下周）
1. 创建 `hermes_core/memory_unified.py`（统一记忆接口）
2. 创建 `hermes_core/emotion.py`（情绪引擎）
3. 创建 `hermes_core/soul.py`（人格系统）
4. 创建 `hermes_core/time.py`（时间感知）
5. 创建 `hermes_core/voice.py`（语音接口）
6. 更新 `hermes_core/__init__.py` 重新导出

**预计**: 新增 ~1500 行

### 阶段 3：迁移调用方（下下周）
1. 更新 `core/api_server.py` → 使用 `hermes_core`
2. 更新 `hermes_gateway_server.py` → 使用 `hermes_core.emotion` + `hermes_core.voice`
3. 更新前端 `useBrainBridge.ts` → 调用 `hermes_core.memory_unified`
4. 删除 `core/brain/` 兼容层（验证后再删）

### 阶段 4：验证与清理
1. 运行完整测试套件
2. 手动测试对话、TTS、情绪、Live2D
3. 删除 `core/brain/` 遗留代码
4. 更新 PLAN.md

---

## 6. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| 剪枝破坏 Hermes 核心功能 | 中 | 高 | 逐步删除，每步验证 |
| 情绪/记忆系统与 SessionDB 冲突 | 低 | 中 | 保持两个数据库，只统一代码访问 |
| 前端工具循环与 Hermes 工具系统冲突 | 低 | 低 | 桌面端用自有工具循环，Hermes 工具系统剪掉 |
| Live2D 模型与 Hermes 表达系统冲突 | 低 | 低 | Live2D 作为独立模块，通过 emotion.py 集成 |

---

## 7. 下一步（等待锟哥确认）

1. 确认"大树嫁接"方向
2. 确认剪枝范围（是否删除 `hermes_state_search.py`）
3. 确认是否保留 `core/brain/` 兼容层
4. 批准开始阶段 1：剪枝 Hermes

---

*文档版本: 2.0 (大树嫁接方案)*
*最后更新: 2026-08-17*
