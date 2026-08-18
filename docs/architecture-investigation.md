# 架构统一方案：基于 Hermes 再开发

**日期**: 2026-08-17 ~ 2026-08-18
**作者**: 汐月 (Hermes Agent)
**状态**: ✅ 已完成执行

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
        ├── emotion/                ← 我们新增：情绪/表情/激素系统
        │   ├── emotion.py
        │   ├── expression.py
        │   └── hormones.py
        ├── soul/                   ← 我们新增：人格/漂移
        │   ├── personality.py
        │   ├── drift.py
        │   └── soul_file.py
        ├── time/                   ← 我们新增：时间感知
        │   ├── circadian.py
        │   ├── anniversaries.py
        │   └── reunion.py
        ├── memory/                 ← 我们新增：记忆碎片系统
        │   ├── store.py
        │   ├── fragment.py
        │   ├── librarian.py
        │   ├── scribe.py
        │   ├── memory_service.py
        │   └── ...
        ├── voice_services.py       ← 我们新增：语音服务启动器
        └── __init__.py             ← 统一导出所有能力
```

**原则**：
- Hermes 原版文件**完全不动**
- 我们的新功能**直接写进 `hermes_core/` 里面**
- 像 Hermes 原生模块一样被 import、被使用
- 一个整体，不是两个系统通过 API 协作

---

## 2. 执行结果（2026-08-18）

### 2.1 已完成

| 步骤 | 操作 | 状态 |
|------|------|------|
| 1 | 创建 `hermes_core/emotion/` — 从 `core/heart/` 迁入 | ✅ |
| 2 | 创建 `hermes_core/soul/` — 从 `core/soul/` 迁入 | ✅ |
| 3 | 创建 `hermes_core/time/` — 从 `core/time/` 迁入 | ✅ |
| 4 | 创建 `hermes_core/memory/` — 从 `core/brain/` 迁入 | ✅ |
| 5 | 创建 `hermes_core/voice_services.py` — 从 `server/voice_services.py` 复制 | ✅ |
| 6 | 更新 `hermes_core/__init__.py` — 导出所有新模块 | ✅ |
| 7 | 创建 `core/` 兼容层 — 旧 import 路径继续可用 | ✅ |
| 8 | 修复内部 import — `soul`、`time` 中对 `heart.emotion` 的引用改为 `emotion` | ✅ |

### 2.2 兼容层设计

旧代码的 import 路径**全部保留**，通过兼容转发层继续工作：

```python
# 旧代码（仍可用）
from core.heart.emotion import EmotionState
from core.soul.personality import HEXACOPersonality
from core.brain.store import MemoryStore

# 新代码（统一入口）
from hermes_core import EmotionState, HEXACOPersonality, MemoryStore
```

兼容层只是转发，**实际代码只有一份**，不存在"两个大脑"。

### 2.3 验证结果

| 检查项 | 结果 |
|--------|------|
| `from hermes_core import SessionDB, EmotionState, MemoryStore, VoiceService` | ✅ |
| `from core.heart.emotion import EmotionState` 兼容层 | ✅ |
| `from core.brain.store import MemoryStore` 兼容层 | ✅ |
| `from core.session import Session` 兼容层 | ✅ |
| `from core.pipeline import main` 兼容层 | ✅ |
| `from hermes_gateway_server import create_app` | ✅ |
| `from core.api_server import create_app` 兼容层 | ✅ |

### 2.4 前端服务生命周期大脑（2026-08-18）

前端新增 `ServiceLifecycle` + `llmScheduler`，所有服务生命周期由大脑统一管理：

| 服务 | 状态 | 调度器 |
|------|------|--------|
| TTS (CosyVoice/Edge/GPT-SoVITS/Piper) | ✅ | `synthesizeViaBrain()` → `ServiceLifecycle` |
| STT (FunASR/SenseVoice) | ✅ | `transcribeViaBrain()` → `ServiceLifecycle` |
| Embedding (Ollama) | ✅ | `getEmbeddingViaBrain()` → `ServiceLifecycle` |
| LLM | ✅ | `llmScheduler.schedule()` → 并发限制 + 优先级排队 |

- **资源感知调度**：按 `estimatedCpuPercent`/`estimatedGpuMb`/`estimatedMemoryMb` 分批启动，批次间延迟避免资源峰值
- **全量接入**：6 个直接调用点（`useHermesGateway.ts`、`useVoiceCall.ts`、`useWakeWord.ts`、`useWatchTogether.ts`、`useVoiceInteraction.ts`、`ChatPanelWindow.tsx`）全部改为走大脑
- **委托层设计**：`ttsBackend.ts`、`sttBackend.ts` 作为任务层唯一入口，内部完全委托给 `ServiceLifecycle`

---

## 3. 数据库架构

### 3.1 两个文件，各管各的

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

## 4. 后续工作

### 4.1 短期（可选优化）

- [ ] 逐步将 `hermes_gateway_server.py`、`core/api_server.py` 的 import 从 `core.brain.xxx` 改为 `hermes_core.xxx`
- [ ] 前端 API 路径保持 `/api/core/...` 不变（后端路由不变）
- [ ] 后续新增功能直接放进 `hermes_core/` 对应子目录

### 4.2 中期（架构优化）

- [ ] 统一情绪状态写入 `core.db`（目前 emotion 状态可能在内存中）
- [ ] 考虑将 `core.db` 的记忆搜索接入 Hermes 的上下文压缩流程
- [ ] 多平台接入（QQ/Telegram）时，情绪和记忆天然就是 Hermes 的一部分

---

## 5. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| 新模块与 Hermes 原版冲突 | 低 | 中 | 保持目录隔离，不修改原版文件 |
| import 路径混乱 | 中 | 低 | 统一通过 `hermes_core/__init__.py` 导出，旧路径通过兼容层保留 |
| 数据库访问冲突 | 低 | 高 | 两个数据库各管各的，不合并 |
| 前端适配工作量 | 低 | 低 | API 路由不变，前端无需改动 |

---

*文档版本: 5.0 (已执行完成)*
*最后更新: 2026-08-18*
