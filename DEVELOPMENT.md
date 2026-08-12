# 📘 Desk Pet 项目文档

> 最后更新：2026-07-29 | 本文档整合项目规则、系统架构与开发准则，是项目唯一的工程规范文档。路线图见 [PLAN.md](./PLAN.md)

---

## 目录

- [Part 0：项目规则（强制）](#part-0项目规则强制)
- [Part 1：系统架构](#part-1系统架构)
- [Part 2：技术栈与架构原则](#part-2技术栈与架构原则)
- [Part 3：编码规范](#part-3编码规范)
- [Part 4：质量保障](#part-4质量保障)
- [Part 5：工作流程](#part-5工作流程)
- [Part 6：参考附录](#part-6参考附录)
- [开发日志](#开发日志)

---

## Part 0：项目规则（强制）

### 0.1 PLAN.md 实时更新（强制）

**每次完成功能开发、bug 修复或重大改动后，必须同步更新 `PLAN.md`。**

更新规则：
1. 完成的功能从"待实现"移到"已完成"，标记 `[x]`
2. 新发现的待办事项添加到"待优化"或对应 Phase 下
3. 项目结构有变动时更新结构图
4. 技术栈有变动时更新顶部技术栈说明
5. 改动量较小时仅更新 checklist，不需要重写整个文件

### 0.2 安全红线

- 不要在 `PLAN.md` 或任何文档中写入敏感信息（API Key 等）
- 不要删除"已完成"中的历史记录

---

## Part 1：系统架构

### 1.1 总览图

Desk Pet 是基于 **Tauri 2.0** 的桌面宠物应用：React 19 + TypeScript 前端 + Rust 后端 + Python AI 服务 + Python 感知服务。

```
┌──────────────────────────────────────────────────────────┐
│                   桌面窗口 (WebView)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │ Live2D   │ │ Chat     │ │ Status   │ │ Settings   │  │
│  │ Viewer   │ │ Panel    │ │ Panel    │ │ Panel      │  │
│  │ (主窗口)  │ │ (独立窗口) │ │ (独立窗口) │ │ (独立窗口)  │  │
│  └────┬─────┘ └─────┬────┘ └─────┬────┘ └─────┬──────┘  │
│       │              │            │             │         │
│       └──────────────┴────────────┴─────────────┘         │
│                          │ localStorage 跨窗口通信          │
│                          ▼                                │
│  ┌───────────────────────────────────────────────────┐    │
│  │              React 应用层 (App.tsx)                │    │
│  │   useEmotion / useInteraction / useMemory ...     │    │
│  │   usePerception / useHandData / useFaceData ...   │    │
│  └──────┬──────────┬──────────┬──────────┬──────────┘    │
│         │          │          │          │                │
│         ▼          ▼          ▼          ▼                │
│  ┌───────┐ ┌──────────┐ ┌────────┐ ┌──────────┐         │
│  │Pipeline│ │Provider  │ │EventBus│ │Perception│         │
│  │        │ │Manager   │ │        │ │Service   │         │
│  └───┬───┘ └────┬─────┘ └───┬────┘ └────┬─────┘         │
│      │          │            │           │                │
└──────┼──────────┼────────────┼───────────┼────────────────┘
       │          │            │           │
       │   ┌──────┴──────┐     │           │ WebSocket (实时数据流)
       │   │  Tauri IPC  │     │           │
       │   │  (invoke)   │     │           │
       │   └──────┬──────┘     │           │
       │          │            │           │
       ▼          ▼            ▼           ▼
┌──────────────────────────────┐  ┌─────────────────────┐
│       Rust 后端 (Tauri)       │  │ Python 感知服务       │
│  ┌──────────┐ ┌──────────┐   │  │ (server/perception/) │
│  │ MCP      │ │ 文件系统  │   │  │  hand_tracker.py     │
│  │ 进程管理  │ │ 持久化    │   │  │  face_tracker.py     │
│  └────┬─────┘ └────┬─────┘   │  │  data_processor.py   │
│       │            │          │  │  gesture_learner.py  │
│       ▼            ▼          │  │  perception_server.py│
│  ┌──────────────────────────┐ │  └─────────────────────┘
│  │  Admin HTTP Server       │ │
│  │  (localhost:9876)        │ │
│  └──────────────────────────┘ │
└──────────────────────────────┘
       │
       ▼  JSON-RPC over stdio
┌───────────────────┐   ┌───────────────────┐
│ MCP Server A      │   │ MCP Server B      │
│ (子进程, stdio)    │   │ (子进程, stdio)    │
└───────────────────┘   └───────────────────┘
```

### 1.2 数据流

#### 1.2.1 消息处理管道

用户输入按顺序经过 Stage 链：

```
用户输入
  │
  ▼
┌──────────────────────────────────────────┐
│ MemoryStage         记忆上下文注入         │
├──────────────────────────────────────────┤
│ ContentSafetyStage  内容安全检查 (可选)     │
├──────────────────────────────────────────┤
│ LLMStage            AI 流式调用 + FC 工具  │
│                     (内含 ToolRegistry)   │
├──────────────────────────────────────────┤
│ EmotionFinalizeStage 情感分析 + 表情映射    │
├──────────────────────────────────────────┤
│ ThinkParseStage     <think> 标签解析       │
├──────────────────────────────────────────┤
│ TTSStage            语音合成 (可选)         │
└──────────────────────────────────────────┘
  │
  ▼
显示 (气泡 + 对话面板) + 语音播放
```

#### 1.2.2 消息角色契约（重要，防回归）

聊天消息只有两种角色，必须严格区分，否则会出现「角色说的话变成用户消息」的 UI bug：

- **`role: 'user'`** —— 仅用户真实输入：手动打字、语音通话/语音助手的语音转写结果。
  唯一入口是 `useHermesGateway.handleSendMessage` 及其公开别名 `sendMessage`。
- **`role: 'assistant'`** —— AI 回复，以及**一切由桌宠 / 2D 模型 / 插件主动说出的话**。

插件（`DailyGreeting` / `Pomodoro` / `WaterReminder` / `EyeCare` / `SedentaryReminder` / `WatchTogether`）
通过 `pluginContext.say()` 开口，必须走 `injectAssistantMessage()`（直接创建 `role: 'assistant'` 消息、
持久化并跨窗同步），**严禁**复用 `handleSendMessage`（会被当成用户消息，显示为右侧蓝色气泡）。
`usePluginSystem` 已把 `say` 绑定到 `injectAssistantMessage`。

> ⚠️ 回归陷阱：任何「让角色/模型主动开口」的新功能，都要用 `injectAssistantMessage`，
> 不要走用户发送通道；否则会出现「晚安~」之类的话被算成用户发的。

#### 1.2.3 MCP 工具调用

```
LLM 返回 tool_calls
  │
  ▼ LLMStage.onToolCall() → ToolRegistry.execute()
  │
  ▼ bridge.ts → mcpCallTool(serverId, toolName, args)
  │
  ▼ Tauri invoke('mcp_call_tool')
  │
  ▼ Rust mcp_call_tool() → JSON-RPC writeln! → stdin
  │
  ▼ MCP Server 子进程 → stdout → brace counting 解析
  │
  ▼ serde_json::parse → Result → 返回前端
  │
  ▼ bridge.ts → ToolResult → LLM 下一轮迭代
```

#### 1.2.3 语音链路

```
mousedown(🎤) → AudioRecorder(MediaRecorder+VAD)
  → WAV 16kHz → STT Provider(transcribe)
  → SenseVoice emotion → updateFromVoice()
  → handleSendMessage() → AI 流式回复
  → getSpeakableText(parseThinkTags())
  → TTS Provider(synthesize) → audioPlayer.enqueue()
  → setMouthOpenY(振幅) → Live2D ParamMouthOpenY
```

#### 1.2.4 感知数据流（WebSocket 实时流）

```
摄像头采集 (OpenCV)
  │
  ▼
┌──────────────────────────────────────────┐
│ hand_tracker.py    手部 21 点检测         │
│ face_tracker.py    面部 468 点 + 虹膜追踪 │
│ gesture_learner.py KNN 手势分类          │
│ data_processor.py  EMA 平滑 + 表情分类    │
└──────────────────────────────────────────┘
  │
  ▼ WebSocket (默认 ws://localhost:8765)
┌──────────────────────────────────────────┐
│ src/services/perception/service.ts       │
│  - 自动重连 + 事件订阅模式                 │
│  - useHandData / useFaceData Hooks       │
└──────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────┐
│ gestureMapping.ts 手势 → 表情/动作映射    │
│ Live2DViewer 参数驱动（注视方向/眨眼/嘴型）│
└──────────────────────────────────────────┘
```

**关键约束**：感知服务是独立的 WebSocket 实时数据流模块，**不纳入** Chat/TTS/STT Provider 请求-响应体系，原因是数据流模式不同（持续推送 vs 单次请求）且由独立 Python 后端进程驱动。

### 1.2.5 Hermes State DB 内核（已移植，2026-08-02）

Hermes State DB 核心已移植到 `server/hermes_core/`，desk-pet 原生读写 state.db。

**移植文件（15 个核心模块，约 16,000 行）**：

```
server/hermes_core/
├── hermes_state.py             — SessionDB（state.db 读写，8,569 行）
├── hermes_state_search.py      — FTS5 全文检索（1,907 行）
├── hermes_state_common.py      — Schema SQL + 共享常量（523 行）
├── hermes_state_schema.py      — Schema 版本管理（779 行）
├── hermes_state_portability.py — 导入导出/备份（656 行）
├── hermes_constants.py         — 路径/平台常量（1,242 行）
├── hermes_bootstrap.py         — 启动流程（239 行）
├── hermes_logging.py           — 异步日志（800 行）
├── message_sanitization.py     — 消息清洗（852 行）
├── sqlite_runtime.py           — SQLite 工具（124 行）
├── sqlite_safe_read.py         — 连接安全读取（stub，68 行）
├── _subprocess_compat.py       — 子进程兼容层（439 行）
├── stubs.py                    — memory/skill 最小桩（53 行替代 ~2,000 行）
├── memory_manager.py           — stub（4 行，转发到 stubs）
└── skill_commands.py           — stub（16 行，转发到 stubs）
```

> 另有 `__init__.py`（包入口，49 行）与 `verify.py`（自测脚本，125 行）两个支持文件，不计入核心移植模块。

**设计决策**：原始 `memory_manager.py`（1,241 行）+ `skill_commands.py`（812 行）+ `tools/`（126 文件）三大模块在 `hermes_state` 里只用到 1 个函数（`sanitize_context()`）+ 2 个常量，因此用 `stubs.py` 提供最小实现替代，代码量从 ~1,200 文件降到 1 个文件；其余 12 个实现文件（约 16,000 行）完整保留（见上表）。

**用法**：
```python
from hermes_core import SessionDB, SCHEMA_VERSION, FTS_SQL, get_hermes_home
db = SessionDB("data/hermes_state.db")
db.create_session("my-session", source="desk-pet")
db.append_message("my-session", role="user", content="hello")
results = db.search_messages("hello")
```

**验证**：`server/hermes_core/verify.py` — 5/5 PASS（2026-08-02）
- import hermes_core ✅ SCHEMA_VERSION=23
- get_hermes_home ✅ → D:\hermes_env\.hermes
- SQLite FTS5 ✅
- SessionDB 打开 ✅
- Session CRUD（create + append + read）✅
- FTS5 全文检索 ✅

### 1.3 核心引擎模块 (server/core/)

> **当前状态**：✅ 算法已移植 / ✅ Core API 已暴露 / ✅ Session/Pipeline 已集成
>
> 以下四大系统为从 ai-companion 项目移植的核心算法模块，已暴露 FastAPI 端点并接入语音对话管道。

#### 1.3.1 Brain 记忆系统

- **路径**：`server/core/brain/`
- **数据模型**：`MemoryFragment` 记忆碎片
- **算法**：Ebbinghaus 艾宾浩斯遗忘曲线 (`decay.py`)
- **存储层**：`store.py`（SQLite，与 `api_server.py` 共用 `data/core.db`）
- **检索**：`librarian.py` — SQLite LIKE + 本地哈希向量 + 关键词重叠，Top-3 注入 Prompt
- **提取**：`scribe.py` — 规则提取 + 可选 LLM 提取，保存事实性记忆
- **向量**：`embedding.py` — `local_hash` 384 维，零外部依赖
- **集成**：`Session.get_context()` 自动检索相关记忆；`Pipeline` 每轮对话后调用 `Session.reflect_on_exchange()` 保存新记忆
- **状态**：✅ 算法 + 存储 + 检索 + 提取 + Pipeline 集成已完成

#### 1.3.2 Heart 情感系统

- **路径**：`server/core/heart/`
- **核心维度**：PAD 三维情感模型（愉悦度 Pleasure / 唤醒度 Arousal / 优势度 Dominance）
- **激素系统**：多巴胺 / 皮质醇 / 催产素，分泌、衰减、相互作用 (`hormones.py`)
- **表达策略**：情感 → 语言风格映射 (`expression.py`)
- **集成**：`Session` 维护 `EmotionState`；用户输入触发 `apply_event` + 激素漂移；`Session.get_context()` 注入情绪提示；`Pipeline` 用情绪标签控制 TTS 风格
- **状态**：✅ 算法 + API + Pipeline 集成已完成

#### 1.3.3 Soul 人格系统

- **路径**：`server/core/soul/`
- **核心维度**：HEXACO 六维人格模型（诚实-谦逊 / 情绪性 / 外向性 / 宜人性 / 尽责性 / 开放性）
- **人格文件**：`.soul` 人格定义文件格式
- **人格漂移**：长期交互中的人格缓慢演化机制
- **状态**：✅ 算法 + API 已完成；🔲 接入 Session PAD 基线待实现

#### 1.3.4 Time 时间系统

- **路径**：`server/core/time/`
- **昼夜节律**：基于真实时间的精力/情绪周期波动
- **重逢机制**：长时间离线后的重逢检测与情感补偿
- **时间感知**：主观时间流速调节
- **状态**：✅ 算法 + API 已完成；🔲 接入 Session 主动问候待实现

#### 1.3.5 Core 引擎与 Pipeline 集成

**情感注入流程：**

```
用户语音/文本
  │
  ▼
Session.add_user_message(text)
  → _update_emotion_from_event() 更新 PAD + 激素
  │
  ▼
Pipeline 调用 Session.get_context()
  → system prompt + 【当前情绪状态】+ 【表达风格】
  │
  ▼
LLM 生成回复
  │
  ▼
Session.add_assistant_message(reply)
Session.reflect_on_exchange(user, reply)  → 提取并保存记忆碎片
```

**记忆注入流程：**

```
Session.get_context()
  │
  ├─ 加载 system prompt
  ├─ 追加情绪提示（PAD + 表达策略）
  └─ 调用 Librarian.search(last_user_input)
       → 从 memory_fragments 召回 Top-3 相关记忆
       → 格式化为【相关记忆】注入 system prompt
```

**关键文件：**

| 文件 | 职责 |
|------|------|
| `server/core/session.py` | 维护对话历史、PAD 情绪、记忆检索/保存 |
| `server/core/pipeline.py` | 调用 `get_context()` 获取 LLM 输入，对话后触发反思 |
| `server/core/brain/store.py` | SQLite 存储层，避免 `api_server.py` 与 `session.py` 循环导入 |
| `server/core/brain/librarian.py` | 检索并格式化记忆 |
| `server/core/brain/scribe.py` | 从对话提取事实性记忆 |
| `server/core/api_server.py` | FastAPI 暴露 Brain/Heart/Soul/Time HTTP API |

#### 1.3.6 Rust 自动拉起 Core API

Tauri 应用启动时，在 `setup` 钩子中通过后台线程检测并启动 `server.core.api_server`：

```rust
std::thread::spawn(move || {
    let core_port: u16 = 9877;
    if !service::check_http_health(core_port) {
        let project_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .to_string_lossy()
            .to_string();
        let python_cmd = /* 检测 python / python3 */;
        let args = vec![
            "-m".to_string(),
            "server.core.api_server".to_string(),
            "--port".to_string(),
            core_port.to_string(),
        ];
        match service::service_start_raw(
            &python_cmd, &args, &project_root, core_port, &app_handle
        ) {
            Ok(info) => println!("[Core API] Started: id={}, port={}", info.id, core_port),
            Err(e) => eprintln!("[Core API] Failed to start: {:?}", e),
        }
    }
});
```

**要点：**

- 端口 `9877` 与 Admin HTTP Server (`9876`) 区分
- 通过 `service::check_http_health()` 避免重复启动
- 使用 `service_start_raw()` 复用现有的 Python 子进程生命周期管理
- 失败仅打印日志，不阻塞窗口创建
- 实现位置：`src-tauri/src/lib.rs` 的 `setup` 闭包

### 1.4 模块职责

#### 1.4.1 前端 (React)

| 模块 | 路径 | 职责 |
|------|------|------|
| App | `src/App.tsx` | 主应用、窗口管理、生命周期、消息发送 |
| Live2DViewer | `src/components/Pet/Live2DViewer.tsx` | Live2D 模型渲染 |
| ChatWindow | `src/components/Chat/ChatWindow.tsx` | 对话面板 UI + 录音按钮 |
| ChatBubble | `src/components/Bubble/ChatBubble.tsx` | 对话气泡 |
| SettingsPanel | `src/components/Settings/SettingsPanel.tsx` | 设置面板 |
| StatusPanel | `src/components/Status/StatusPanel.tsx` | 状态面板 |
| useEmotion | `src/hooks/useEmotion.ts` | 双层情感状态机 (Mood+Emotion) |
| useInteraction | `src/hooks/useInteraction.ts` | 用户交互逻辑 |
| useMemory | `src/hooks/useMemory.ts` | 记忆 CRUD |
| useLive2D | `src/hooks/useLive2D.ts` | Live2D 模型控制 |

#### 1.4.2 服务层 (TypeScript, 无 React 依赖)

| 模块 | 路径 | 职责 |
|------|------|------|
| Pipeline | `src/services/pipeline/` | 消息处理管道编排 (10 Stage) |
| Provider Manager | `src/services/provider/manager.ts` | Provider 注册/查询/生命周期 |
| Provider Chat | `src/services/provider/openai/chat.ts` | OpenAI 兼容 Chat API (SSE 流式) |
| Provider TTS | `src/services/provider/tts/*.ts` | Edge TTS / GPT-SoVITS / VoxCPM |
| Provider STT | `src/services/provider/stt/*.ts` | FunASR / SenseVoice |
| **Perception Service** | `src/services/perception/` | **WebSocket 实时手势/面部数据流（独立模块）** |
| Audio Player | `src/services/audio/player.ts` | Web Audio API 播放队列 + 打断 + 振幅回调 |
| Audio Recorder | `src/services/audio/recorder.ts` | MediaRecorder + 静音 VAD + WAV 转换 |
| ToolRegistry | `src/services/tools/registry.ts` | 工具注册/执行/OpenAI schema 生成 |
| EventBus | `src/services/eventBus.ts` | 组件间事件通信 |
| AI Service | `src/services/ai.ts` | Chat API 封装 (流式/非流式) |
| ChatStorage | `src/services/chatStorage.ts` | 会话持久化 |
| Storage | `src/services/storage.ts` | 双备份存储 (localStorage + 文件) |
| Safety | `src/services/safety.ts` | 内容安全检查 |
| Logger | `src/utils/logger.ts` | 分级日志系统 |

#### 1.4.3 感知服务（Python，独立模块）

| 模块 | 路径 | 职责 |
|------|------|------|
| `__init__.py` | `server/perception/__init__.py` | 模块入口 |
| `config.py` | `server/perception/config.py` | 模型路径、WS 端口、摄像头、校准配置 |
| `hand_tracker.py` | `server/perception/hand_tracker.py` | MediaPipe 手部 21 点检测封装 |
| `face_tracker.py` | `server/perception/face_tracker.py` | 面部 468 点 + 虹膜追踪 + 表情分类 + 头部姿态 |
| `data_processor.py` | `server/perception/data_processor.py` | EMA 平滑、手势分类、CalibConfig |
| `gesture_learner.py` | `server/perception/gesture_learner.py` | KNN 手势学习分类器 |
| `perception_server.py` | `server/perception/perception_server.py` | WebSocket 服务入口 |

#### 1.4.4 前端感知服务（TypeScript）

| 模块 | 路径 | 职责 |
|------|------|------|
| `types.ts` | `src/services/perception/types.ts` | HandData/FaceData/CalibData 等类型定义 |
| `service.ts` | `src/services/perception/service.ts` | WebSocket 连接 + 自动重连 + 事件订阅 |
| `gestureMapping.ts` | `src/services/perception/gestureMapping.ts` | 16 种手势 → 表情/动作映射 |
| `hooks.ts` | `src/services/perception/hooks.ts` | usePerception / useHandData / useFaceData 等 |
| `index.ts` | `src/services/perception/index.ts` | 模块统一导出 |

#### 1.4.5 MCP 子系统

| 模块 | 路径 | 职责 |
|------|------|------|
| Types | `src/services/mcp/types.ts` | McpServerConfig / McpToolInfo |
| Client | `src/services/mcp/client.ts` | Tauri invoke 封装 (5 命令) |
| Manager | `src/services/mcp/manager.ts` | 配置持久化 + 生命周期 |
| Bridge | `src/services/mcp/bridge.ts` | MCP 工具 ↔ ToolRegistry 桥接 |
| Rust Engine | `src-tauri/src/mcp.rs` | std::process 子进程 + JSON-RPC |

#### 1.4.6 设置窗（Settings Window）

> 原 Admin 管理后台（`src/admin/pages/*`）已在重构中删除，功能统一迁入独立的**设置窗**（`settings.html` → `src/settings/main.tsx`，路由见 `src/settings/routes.tsx`）。

| 分区 | 路径 | 职责 |
|------|------|------|
| 总览/搜索 | `src/settings/pages/IndexPage.tsx` | 设置首页 + 全局搜索 |
| 外观 | `src/settings/pages/appearance/` | 主题/气泡/淡出/帧率 |
| 角色模型 | `src/settings/pages/models/`（EmotionPage/BehaviorPage/CharacterPage/Live2DPage） | 模型/情感/行为/人设 |
| 记忆 | `src/settings/pages/memory/MemoryViewPage.tsx` | 记忆检索/管理 |
| 服务 | `src/settings/pages/services/` | LLM/TTS/STT/多模态 Provider |
| 聊天 | `src/settings/pages/chat/`（通用/输入命令/语音/模式） | 对话面板设置 |
| 扩展 | `src/settings/pages/extensions/`（插件 / 工具管理 / 市场） | 插件、工具启停与模式可用性管理 |
| 系统 | `src/settings/pages/system/` | 通用/窗口/托盘/监控 |
| Admin Server | `src-tauri/src/admin_server.rs` | 后端 HTTP API（端口 9876，**非 UI**） |

#### 1.4.7 Rust 后端

| 模块 | 路径 | 职责 |
|------|------|------|
| lib.rs | `src-tauri/src/lib.rs` | Tauri Builder + Commands + Admin HTTP Server |
| mcp.rs | `src-tauri/src/mcp.rs` | MCP 进程管理 + JSON-RPC over stdio |
| service.rs | `src-tauri/src/service.rs` | Python 服务进程生命周期管理 |

#### 1.4.8 Provider 适配器注册表

| 类型 | typeName | 文件 | 说明 |
|------|----------|------|------|
| Chat | `openai_chat` | `provider/openai/chat.ts` | OpenAI 兼容接口 (SSE streaming) |
| TTS | `edge_tts` | `provider/tts/edge.ts` | Edge TTS → edge_tts_server.py:8001 |
| TTS | `gpt_sovits` | `provider/tts/gptsovits.ts` | GPT-SoVITS v2 声音克隆 → :9880 |
| TTS | `voxcpm` | `provider/tts/voxcpm.ts` | VoxCPM2 → :8000/8808 |
| STT | `funasr` | `provider/stt/funasr.ts` | FunASR Paraformer → stt_server.py:8002 |
| STT | `sensevoice` | `provider/stt/sensevoice.ts` | SenseVoice 情绪检测 → :8002 |

> **注**：感知服务不在此注册表中，它是独立的 WebSocket 服务。

### 1.5 跨进程通信

#### 1.5.1 六种通信机制

| 机制 | 方向 | 用途 |
|------|------|------|
| **Tauri IPC (invoke)** | 前端 ↔ Rust | 文件读写、系统能力、MCP 管理 |
| **Tauri Events** | Rust → 前端 | 管理后台推送状态变更 |
| **localStorage 轮询** | 多窗口间 | 消息/状态/情感数据同步 |
| **HTTP (Admin API)** | Admin → Rust | CRUD 操作 (localhost:9876, 60+ 端点) |
| **MCP stdio** | Rust ↔ 子进程 | JSON-RPC 2.0 双向通信 |
| **WebSocket** | Python 感知服务 → 前端 | 实时手势/面部数据流 (默认 :8765) |

#### 1.5.2 localStorage 跨窗口同步 Key 列表

| Key | 内容 |
|-----|------|
| `deskpet_messages` | 消息列表 |
| `deskpet_chatPending` | 待发送消息 |
| `deskpet_chatLoading` / `deskpet_chatStreaming` | 加载/流式状态 |
| `deskpet_chatCancel` | 取消流式标志 |
| `deskpet_sttAudio` | STT 音频 base64 |
| `deskpet_emotion` / `deskpet_emotionHistory` | 情感数据 |
| `deskpet_*_geometry` | 窗口位置持久化 |

### 1.6 存储层

#### 1.6.1 双备份存储

```typescript
const storage = createStorage<T>('key', default_value);
storage.get()   // localStorage 读取
storage.set(v)  // localStorage + 异步写 %APPDATA%/desk-pet/{key}.json
```

#### 1.6.2 持久化文件

路径：`%APPDATA%/desk-pet/` (Windows) / `~/.config/desk-pet/` (macOS/Linux)

| 文件 | 内容 |
|------|------|
| `settings.json` | API 配置、AI 参数 |
| `emotion.json` | 情感状态、性格参数 |
| `emotionHistory.json` | 情感历史记录 |
| `memory.json` | 规则、事实、偏好 |
| `providers.json` | Provider 配置列表 |
| `chat_sessions.json` | 对话会话 |
| `mcp_servers.json` | MCP 服务器配置 |
| `logs.json` | 操作日志 |
| `model-config.json` | Live2D 模型配置 |
| `*.json` | 窗口几何位置 |

### 1.7 安全模型

| 层级 | 措施 |
|------|------|
| 网络 | Admin API 仅监听 `127.0.0.1`，不可外部访问 |
| 认证 | 启动时生成随机 token，前端 Authorization header 校验 |
| 加密 | API Key 使用 DPAPI/Keychain 加密存储，日志掩码 `sk-****...****` |
| 内容 | ContentSafetyStage 可选启用，输入 ≤4096 字符，速率限制 |
| 进程 | MCP/Service/Perception 子进程隔离，崩溃不影响主应用 |
| 文件 | 仅在 AppData 目录读写，临时文件使用后清理 |

---

## Part 2：技术栈与架构原则

### 2.1 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2.0 (Rust) |
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 7 |
| Live2D | Cubism SDK v5 (原生 WebGL2) |
| AI 服务 | OpenAI-compatible API / Ollama |
| 感知服务 | MediaPipe (Hand/Face/Iris) + OpenCV + WebSocket |
| 状态管理 | React Hooks + Context |
| 持久化 | localStorage + Tauri 文件系统 |
| 包管理 | pnpm |

### 2.2 分层架构

```
UI 层 (components/)
  ↓ 调用 hooks
Hook 层 (hooks/)
  ↓ 调用 services
服务层 (services/)     ← 纯逻辑，不依赖 React
  ↓ 调用 Tauri IPC / HTTP / WebSocket
Rust 后端 (src-tauri/) + Python 服务 (server/)
```

**铁律**：上层可调用下层，下层不得反向调用上层。

### 2.3 模块职责边界

| 目录 | 职责 | 禁止 |
|------|------|------|
| `components/` | UI 展示、用户交互 | 直接调用 Tauri IPC、API 请求 |
| `hooks/` | 状态管理、副作用、组合逻辑 | 渲染 JSX |
| `services/` | 纯业务逻辑、Provider、音频、API、感知 | import React、操作 DOM |
| `utils/` | 无状态工具函数 | 持有状态、副作用 |
| `lib/` | 第三方 SDK 封装 | 业务逻辑 |
| `src-tauri/` | 系统能力、文件 IO、安全存储 | 业务逻辑 |
| `server/perception/` | 感知服务独立模块 | 集成进 Provider 体系 |

### 2.4 Provider 抽象层

所有外部服务（Chat/TTS/STT）必须通过 Provider 接口调用，禁止硬编码 API。

```typescript
// 接口体系 (src/services/provider/types.ts)
interface ChatProvider extends Provider {
  chatStream(options: ChatStreamOptions): AsyncGenerator<string>;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  getModels(): Promise<string[]>;
  abort(): void;
}

interface TTSProvider extends Provider {
  synthesize(text: string, options?: TTSOptions): Promise<TTSResult>;
  synthesizeStream(text: string, options?: TTSOptions): AsyncGenerator<ArrayBuffer>;
  supportStream(): boolean;
  getVoices(): Promise<string[]>;
  abort(): void;
}

interface STTProvider extends Provider {
  transcribe(audio: ArrayBuffer, format?: string): Promise<STTResult>;
  supportStreaming(): boolean;
  abort(): void;
}
```

新增 Provider 只需实现对应接口并注册工厂函数，不修改已有代码。

> **注**：感知服务不实现 Provider 接口，它走独立的 WebSocket 推送通道。

### 2.5 消息处理管道

参考 AstrBot Pipeline，消息按 Stage 链有序处理：

```
用户输入 → MemoryInject → ContentSafety → LLMCall → ThinkParse → EmotionAnalyze → TTSynthesize → Display
```

每个 Stage 实现 `process(event)`，可标记 `enabled: false` 跳过。新功能优先以新 Stage 加入。

### 2.6 事件总线

组件间通信统一用 EventBus，避免 prop drilling：

```typescript
eventBus.emit('emotion:changed', { emotion: 'happy', intensity: 0.8 });
eventBus.on('llm:response', (data) => { /* ... */ });
```

### 2.7 MCP 工具集成

```
Rust (mcp.rs) → std::process::Command → 子进程
  → JSON-RPC 2.0 over stdin/stdout
  → tools/list + tools/call
    ↓
JS (src/services/mcp/)
  → client.ts   : Tauri invoke 封装
  → manager.ts  : 配置持久化 + 连接生命周期
  → bridge.ts   : MCP 工具 → ToolRegistry 注册
    ↓
设置页 (services/McpPage.tsx) : 添加/连接/断开 MCP 服务器
```

**已知限制**：
- JSON-RPC read_line 同步阻塞，无超时机制
- 无 MCP 市场集成，需手动配置
- 无权限守卫（连接/断开 = 开关级权限）

### 2.8 Admin 管理后台通信

```
Admin 页面 → fetch() → localhost:9876
  → Rust tiny_http 处理
  → 文件读写 %APPDATA%/desk-pet/*.json
  → Tauri Event 通知主窗口
```

API 前缀 `/api/`，60+ 端点。静态资源由 Rust 直接 serve。

### 2.9 感知服务集成（独立模块）

```
Python 感知进程 (perception_server.py)
  → MediaPipe Hand/Face Landmarker
  → 数据后处理 (EMA 平滑 + 手势分类)
    ↓
WebSocket Server (默认 ws://localhost:8765)
    ↓ 实时推送 JSON 帧
前端 PerceptionService (src/services/perception/)
  → 自动重连 + 事件订阅
  → React Hooks (useHandData / useFaceData / useGestureMapping)
    ↓
Live2DViewer 参数驱动 + 手势→表情映射
```

**启动方式**：`python -m server.perception.perception_server`

**约束**：感知服务是独立的 WebSocket 实时数据流模块，**不纳入** Chat/TTS/STT Provider 请求-响应体系。

---

## Part 3：编码规范

### 3.1 文件大小限制

| 语言 | 最大行数 | 超标处理 |
|------|---------|----------|
| TypeScript / TSX | 400 行 | 拆为多个模块或提取 hooks/utils |
| Rust | 500 行 | 拆为独立 module |
| Python | 400 行 | 拆为多个 module |
| CSS | 300 行 | 按组件/功能拆分 |

### 3.2 TypeScript

#### 严格模式（目标）

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

#### 类型使用

```typescript
// ✅ 正确
interface PetState {
  mood: Mood;
  emotion: Emotion;
  favorability: number;
}

// ❌ 隐式 any
function process(data) { ... }

// ✅ 优先 unknown + 类型守卫
function handle(event: unknown): void {
  if (isPetEvent(event)) { ... }
}
```

#### 禁止事项

| 禁止 | 替代 |
|------|------|
| `any`（无充分理由+注释） | `unknown` + 类型守卫 |
| `as` 强制断言（测试外） | 类型守卫函数 |
| `@ts-ignore` | `@ts-expect-error` + 注释 |
| 导出 `any` 类型签名 | 明确定义参数和返回值类型 |

#### 类型文件组织

- 组件级类型：与组件同文件或 `types.ts`
- 跨模块类型：`src/types/`
- Provider 类型：`src/services/provider/types.ts`
- Perception 类型：`src/services/perception/types.ts`
- Admin 类型：`src/admin/types.ts`

### 3.3 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 组件 | PascalCase | `ChatWindow.tsx` |
| Hook | camelCase + use 前缀 | `useLive2D.ts` |
| 工具函数 | camelCase | `estimateTokens.ts` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| 类型/接口 | PascalCase | `ProviderConfig` |
| 事件名 | kebab-case + 冒号分隔 | `emotion:changed` |
| CSS 类 | kebab-case | `chat-bubble` |
| 文件名 | 与主导出匹配 | `EventBus.ts` / `event-bus.ts` |

### 3.4 React 组件

#### 标准结构（从上到下）

```typescript
// 1. imports（第三方 → 项目 → 类型）
import { useState, useCallback } from 'react';
import type { PetConfig } from '@/types';

// 2. 类型定义
interface MyComponentProps {
  config: PetConfig;
  onUpdate: (config: PetConfig) => void;
}

// 3. 常量（组件外定义）
const DEFAULT_CONFIG: Partial<PetConfig> = { ... };

// 4. 组件
export const MyComponent = React.memo(function MyComponent({ config, onUpdate }: MyComponentProps) {
  // 4a. hooks
  const [local, setLocal] = useState(config);

  // 4b. derived state (useMemo)
  const derived = useMemo(() => compute(local), [local]);

  // 4c. callbacks (useCallback)
  const handleSave = useCallback(() => onUpdate(local), [local, onUpdate]);

  // 4d. effects (useEffect)
  useEffect(() => { setLocal(config); }, [config]);

  // 4e. render
  return <div>...</div>;
});
```

#### 拆分原则

- **单一职责**：一个组件只做一件事
- **80/20 规则**：组件主体超过 80 行 → 考虑拆分
- **3 次重复**：JSX 出现 3 次以上 → 提取为独立组件
- **Presentational vs Container**：UI 和状态逻辑分离

#### React.memo 使用

以下组件必须包裹：
- 高频渲染组件（消息列表项、状态面板字段）
- 包含复杂计算的组件
- 父组件频繁 re-render 但自身 props 变化少的子组件

### 3.5 Hooks

```typescript
// ✅ 完整依赖数组
useEffect(() => {
  fetchData(config.url);
}, [config.url]);

// ⚠️ 空数组必须注释原因
useEffect(() => {
  initOnce();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时初始化一次
}, []);
```

### 3.6 Services 层

#### 目录结构

```
src/services/
├── {domain}/
│   ├── index.ts
│   ├── types.ts
│   ├── engine.ts
│   └── __tests__/
│       └── engine.test.ts
```

#### 纯函数优先

```typescript
// ✅ 纯函数或依赖注入
export function estimateTokens(text: string): number { ... }

export class RAGEngine {
  constructor(private index: BM25Index, private store: StorageAdapter) {}
  async search(query: string): Promise<Document[]> { ... }
}

// ❌ 隐式全局依赖
const globalConfig = window.__CONFIG__;
export function badFunction(msg: string) { ... }
```

#### 铁律

```typescript
// ❌ services/ 禁止
import { useState } from 'react';
import { useLive2D } from '@/hooks/useLive2D';

// ✅ hooks/ 才依赖 React，services/ 保持纯净
```

### 3.7 Python 感知模块

- 模块统一放在 `server/perception/`，使用相对导入（`from .config import ...`）
- 感知服务是独立进程，不与现有 Chat/TTS/STT Provider 体系耦合
- 配置集中在 `server/perception/config.py`
- WebSocket 端口、模型路径、摄像头索引等参数应可配置

### 3.8 Rust

#### 模块拆分

```rust
// lib.rs — 入口，仅 setup + 模块注册
mod commands;
mod admin;
mod mcp;
mod service;
mod cursor;
mod storage;
mod logging;
```

#### 错误处理

```rust
// ✅ thiserror 定义错误类型
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Service crashed: {0}")]
    ServiceCrashed(String),
}

let config = load_config().map_err(|e| AppError::Io(e))?;

// ❌ 禁止裸 unwrap()
```

#### 安全准则

- 禁止 `unsafe` 块，除非有充分理由并在 PR 中说明
- 外部命令执行须路径白名单校验
- 子进程必须有超时机制

---

## Part 4：质量保障

### 4.1 错误处理

#### Error Boundary（强制）

```typescript
class ErrorBoundary extends React.Component<Props, State> {
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    log.error('React crash', { error: error.message, stack: error.stack });
  }
  render() {
    if (this.state.hasError) {
      return <ErrorFallback onRetry={() => this.setState({ hasError: false })} />;
    }
    return this.props.children;
  }
}
```

顶层 + 关键页面各一层。

#### 异步静默降级

```typescript
// ✅ 完整错误处理
async function fetchData(url: string): Promise<Data | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      log.warn('fetchData failed', { url, status: resp.status });
      return null;
    }
    return await resp.json();
  } catch (err) {
    log.error('fetchData error', { url, error: String(err) });
    return null;  // 静默降级，不抛异常
  }
}
```

### 4.2 性能

#### 避免不必要重渲染

```typescript
// ✅ useCallback 稳定引用
const handleClick = useCallback((id: string) => setSelected(id), []);

// ✅ 拆分 Context 避免全局重渲染
<ThemeContext.Provider value={theme}>
  <ConfigContext.Provider value={config}>
    {children}
  </ConfigContext.Provider>
</ThemeContext.Provider>
```

#### 大列表虚拟滚动

聊天消息 >50 条、管理后台列表 >100 项 → 必须用 react-window。

#### 定时器清理

```typescript
// ✅ 必须清理
useEffect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}, []);
```

#### 性能目标

| 指标 | 目标 |
|------|------|
| 主包 gzip | < 200KB |
| Live2D 渲染 | 不可见时暂停/降帧 |
| IPC 调用 | 批量事件合并，渲染循环中禁止 |
| 首屏加载 | 非首屏组件 dynamic import |
| 感知 WebSocket | 自动重连 + 帧节流，避免 React 高频重渲染 |

### 4.3 安全

#### 敏感数据处理

| 数据类型 | 存储 | 显示 |
|----------|------|------|
| API Key | DPAPI/Keychain 加密 | 掩码 `sk-****...****` |
| System Prompt | localStorage + 可选加密 | 密码框切换 |
| 对话内容 | 本地明文 (可选加密) | 仅会话页显示 |
| 截屏数据 | 仅内存 Base64 | 不持久化 |
| 摄像头帧 | 仅内存处理，不持久化 | 不显示原始帧 |

#### HTTP API

- 仅监听 `127.0.0.1`
- 启动时生成随机 token，前端传入 Authorization
- 敏感操作需额外校验

#### 输入验证

- 所有用户输入经 ContentSafetyStage
- 单条消息 ≤4096 字符
- 速率限制：每分钟 ≤20 条

### 4.4 测试

#### 测试金字塔

```
        ┌─────┐
        │ E2E │  Playwright (核心流程 3-5 条)
        ├─────┤
        │集成 │  组件渲染 + API mock
        ├─────┤
        │单元 │  utils / services / hooks 纯逻辑
        └─────┘  覆盖率 >80%
```

#### 文件组织

```
tests/
├── unit/           # 对应 src/services/, src/utils/
│   ├── provider/
│   ├── pipeline/
│   ├── perception/
│   └── ...
├── components/     # 对应 src/components/
└── e2e/            # 端到端场景
```

命名：`*.test.ts` (单元/组件)、`*.e2e.ts` (E2E)

#### 必须写测试的场景

- 工具函数（计算/转换/格式化）
- 数据解析/序列化
- 状态转换逻辑
- Provider 接口实现
- 感知数据后处理（手势分类、平滑算法）

#### 原则

- **测试行为不测试实现**：验证输入输出，不验证内部调用
- **Mock 边界**：只 mock 外部依赖，不 mock 被测模块内部
- **可复现**：不依赖网络/时间
- **先写测试再修 Bug**：先写复现测试再修复

#### 运行

```bash
pnpm test              # 单元测试
pnpm test:components   # 组件测试
pnpm test:e2e          # E2E 测试
pnpm test:ci           # 全部测试（CI 模式）
```

### 4.5 代码格式化与 Lint

| 语言 | 工具 |
|------|------|
| TypeScript / React | ESLint + Prettier (2空格缩进, 单引号) |
| Rust | `cargo fmt` + `cargo clippy -- -D warnings` |
| Python | `black` + `ruff` (推荐) |

提交前运行 `pnpm check` 确保通过。

---

## Part 5：工作流程

### 5.1 Git 工作流

#### 分支命名

| 类型 | 格式 | 示例 |
|------|------|------|
| 新功能 | `feat/简短描述` | `feat/system-tray` |
| 修复 | `fix/简短描述` | `fix/tts-reachability` |
| 重构 | `refactor/简短描述` | `refactor/split-app-tsx` |
| 文档 | `docs/简短描述` | `docs/engineering-standards` |

#### 提交信息 (Conventional Commits)

```
<type>(<scope>): <subject>

feat(voice): 新增情绪预设快捷按钮
fix(tts): 修复可及性检查使用了不存在的 GET / 端点
refactor(rust): lib.rs 拆分为 commands + admin + mcp 模块
test(token): 新增 tokenEstimator 单元测试
feat(perception): 整合 gesture-character 感知服务
```

#### Pre-commit Hooks

```
husky + lint-staged:
  *.ts, *.tsx → eslint --fix + prettier --write
  *.rs        → cargo fmt
```

一个 commit 做一件事，禁止 `--no-verify` 跳过。

### 5.2 开发环境

```bash
git clone <repo-url> && cd desk-pet
pnpm install
pnpm prepare          # 安装 pre-commit hooks

# 启动主应用
pnpm tauri dev

# 启动感知服务（独立）
python -m server.perception.perception_server

# 测试与检查
pnpm test
pnpm lint && pnpm typecheck
```

### 5.3 部署与发布

#### 版本号 (Semantic Versioning)

`MAJOR.MINOR.PATCH` — 不兼容变更/新功能/Bug修复

#### 发布流程

1. 更新版本号 (`package.json` + `tauri.conf.json`)
2. 更新 CHANGELOG.md
3. `pnpm build` 确认构建成功
4. `cargo tauri build` 生成安装包
5. 创建 GitHub Release 并上传

#### CI/CD 流水线

```
lint → typecheck → test → build → release
```

每个 PR 必须通过 CI 检查才能合并。

---

## Part 6：参考附录

### 6.1 日志规范

统一使用 `src/utils/logger.ts`：

```typescript
import { createLogger } from './utils/logger';
const log = createLogger('Emotion');

log.info('State restored', { emotion: 'happy', mood: 'cheerful' });
log.warn('Cooldown active, reducing intensity');
log.error('Failed to persist state', err);
```

| 级别 | 用途 |
|------|------|
| `error` | 需立即关注的故障 |
| `warn` | 异常但系统可继续运行 |
| `info` | 关键业务流程节点 |
| `verbose` | 调试信息 |

**格式**：`HH:MM:SS.mmm [Module] message {context}`

**关键规则**：
- 第一条参数：简短英文消息
- 第二条参数：结构化 JSON 上下文
- 禁止日志打印完整 API Key

**各模块日志覆盖**：

| 模块 | Logger 名 | 关键日志点 |
|------|----------|-----------|
| `useEmotion.ts` | `Emotion` | 状态恢复、情绪转换、冷却检测 |
| `openai/chat.ts` | `ChatProvider` | 请求发起、流式完成、错误 |
| `player.ts` | `AudioPlayer` | 入队、播放/中断、队列完成 |
| `recorder.ts` | `Recorder` | 录音开始/停止、静音自动停止 |
| `manager.ts` | `ProviderManager` | 初始化、添加/移除、切换 |
| `App.tsx` | `App` | 消息发送、流式完成、TTS/STT结果 |
| `perception/service.ts` | `Perception` | 连接、断开、重连、数据帧 |

Python 服务端日志：

```python
import logging
logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S")
log = logging.getLogger("perception-server")
```

Rust 后端：`println!`/`eprintln!`，格式 `[模块] 消息`。

### 6.2 反模式清单（禁止）

| 反模式 | 正确做法 |
|--------|----------|
| God File (单文件 >500 行) | 拆分为多模块 |
| Prop Drilling (>3 层) | Context 或状态管理 |
| 内联大对象 (`style={{...}}`) | 组件外定义或 useMemo |
| 魔法数字 | 提取为命名常量 |
| `index.ts` 含副作用 | 只做 re-export |
| 循环中串行 await | 无依赖时用 `Promise.all` |
| 未清理的副作用 | useEffect return cleanup |
| `// TODO` 无 issue 编号 | `// TODO(#42): 描述` |
| 把感知服务塞进 Provider 体系 | 独立 WebSocket 模块 |

### 6.3 代码内联优先

借鉴 AstrBot 的 "inline-first" 规则：

- 不为一次使用创建工具函数，直接内联
- 同一逻辑出现 3 次以上才提取
- 不在 `utils/` 创建"通用工具库"
- 可读性 > DRY

### 6.4 ai-companion 移植参考

#### 6.4.1 项目来源

- **源项目**：ai-companion
- **规格文档**：`F:\Work\Create\BOT\ai-companion\PROJECT_SPEC.md`
- **移植日期**：2026-07-07

#### 6.4.2 移植模块清单

从 ai-companion 项目移植到 desk-pet 的核心算法模块：

| 模块 | 源路径 | 目标路径 | 状态 |
|------|--------|----------|------|
| Brain 记忆系统 | `core/brain/` | `server/core/brain/` | ✅ 算法已移植 |
| Heart 情感系统 | `core/heart/` | `server/core/heart/` | ✅ 算法已移植 |
| Soul 人格系统 | `core/soul/` | `server/core/soul/` | ✅ 算法已移植 |
| Time 时间系统 | `core/time/` | `server/core/time/` | ✅ 算法已移植 |

#### 6.4.3 移植说明

- 移植的四大系统均为**纯算法模块**，不包含 I/O、网络、UI 等外部依赖
- 目前仅完成算法代码移植，**尚未接入**消息管道、API 层和前端 UI
- 后续集成工作需按优先级逐步推进：Brain → Heart → Soul → Time
- 移植过程中保持算法逻辑原样，仅做路径和导入语句适配

### 6.5 注释规范

- **文件头**：模块职责简述
- **函数**：公共 API 用 JSDoc (`/** ... */`)
- **Rust**：公共 API 用 `///` 文档注释
- **Python**：模块/类/函数 docstring
- **TODO/FIXME**：`// TODO(#issue): 描述` 格式
- 注释解释"为什么"而非"做了什么"

```typescript
/**
 * 估算文本 Token 数（零 API 开销本地计算）
 * @param text - 输入文本
 * @returns 向上取整的 token 估算值
 */
export function estimateTokens(text: string): number { ... }
```

### 6.6 代码审查检查清单

每个 PR 合并前必须确认：

- [ ] TypeScript 编译通过 (`pnpm typecheck`)
- [ ] ESLint 无错误 (`pnpm lint`)
- [ ] Prettier 格式化通过 (`pnpm format:check`)
- [ ] 新增功能有对应单元测试
- [ ] 文件行数在限制内 (TS ≤400, Rust ≤500, Python ≤400)
- [ ] 无 `any` / `as` / `@ts-ignore` 引入
- [ ] 敏感信息无硬编码
- [ ] useEffect 有正确的依赖数组
- [ ] 定时器/监听器有清理逻辑
- [ ] 异步操作有错误处理
- [ ] 大列表使用了虚拟滚动 (如有)
- [ ] 感知服务改动未污染 Provider 体系
- [ ] 提交信息符合 Conventional Commits

### 6.7 必须维护的文档

| 文档 | 用途 |
|------|------|
| [PLAN.md](./PLAN.md) | 项目路线图与阶段规划 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 工程规范（本文档，含架构 + 编码规范） |
| [CHANGELOG.md](./CHANGELOG.md) | 版本变更记录 |
| 模块 README | 各模块职责与 API 说明 |

### 6.8 参考资料

- [React 官方文档](https://react.dev)
- [Tauri v2 文档](https://v2.tauri.app)
- [TypeScript Deep Dive](https://basarat.gitbook.io/typescript/)
- [AstrBot 架构参考](https://github.com/Soulter/AstrBot)
- [MediaPipe 文档](https://developers.google.com/mediapipe)

---

## 开发日志

### 设置页面卡片式重构 & Live2D 初始化修复 — 2026-07-26

**设置页面卡片式设计**：
- 参考 AIRI 设置页面，采用卡片式布局设计
- 5 个模块卡片：角色模型、外观、交互、服务来源、记忆体
- 卡片悬停效果：轻微上移 + 阴影增强
- 卡片入场动画：依次淡入上移（50ms 延迟）
- 子页面使用导航栏 + 返回按钮模式
- 每个子页面独立布局，服务来源包含 API 配置和测试连接
- 外观页面包含主题预设和明暗模式切换
- 交互页面包含淡出透明度滑块
- 记忆体页面包含规则编辑器
- **文件**: `src/components/Settings/SettingsPanel.tsx`

**Live2D 初始化修复**：
- `initializedRef.current` 在初始化开始前被设为 true，导致失败后无法重试
- 修复：只有在 `initLive2D` 成功后才标记为已初始化，失败时重置为 false
- **文件**: `src/hooks/useLive2D.ts`

**面板收起时间优化**：
- 自动收起时间从 1500ms 缩短为 800ms，响应更灵敏
- **文件**: `src/components/Pet/ControlsIsland.tsx`

### 控制面板功能修复 & 移动缩放并存 & 布局微调 — 2026-07-26

**移动/缩放图标修复**：
- `solar:drag-linear` / `solar:zoom-in-linear` 图标不存在于 Solar 图标集，导致不显示
- 换用 `lucide:move`（移动）和 `lucide:scan`（缩放）
- **文件**: `src/components/Pet/ControlsIsland.tsx`

**移动与缩放并存**：
- 移动和缩放不再互斥，可同时开启（拖拽移动 + 滚轮缩放）
- 两者仅与锁定互斥：开启移动或缩放时自动解锁，锁定时自动关闭移动和缩放
- **文件**: `src/App.tsx`

**退出改为隐藏到托盘**：
- 原退出按钮调用 `getCurrentWindow().close()` 会终止应用
- 改为 `invoke('hide_to_tray')`，仅隐藏窗口，可通过托盘双击重新打开
- **文件**: `src/App.tsx`

**锁定时淡出效果**：
- 锁定后鼠标穿透，`onMouseEnter` 无法触发淡出
- 在锁定 cursor 轮询中增加淡出检测：鼠标在窗口内且不在控制面板区域时触发淡出
- 新增 `fadeOnHoverRef` 在轮询中读取最新值
- **文件**: `src/App.tsx`

**锁定后面板自动隐藏**：
- 移除锁定时强制展开面板的逻辑
- 面板在锁定/非锁定状态下都遵循：鼠标进入展开，离开 1.5s 自动折叠
- **文件**: `src/components/Pet/ControlsIsland.tsx`

**气泡与角色间距微调**：
- 气泡高度：80px → 70px，气泡对齐方式改为底部对齐（`align-items: flex-end`）
- 角色区域 top：60px → 48px，减小头部与气泡间隙
- config.json 同步更新 bubbleHeight
- **文件**: `src/App.css`, `public/models/nahida/config.json`, `public/models/hiyori/hiyori_free_zh/config.json`, `src/App.tsx`

### 控制面板功能重构 & 窗口布局优化 & 淡出透明度设置 — 2026-07-26

**控制面板功能调整**：
- 移除「居中」「主题」「置顶」三个按钮
- 新增「移动」「缩放」按钮，支持切换移动/缩放模式
- 保留按钮：设置、聊天、刷新、角色、淡出、锁定、退出
- **文件**: `src/components/Pet/ControlsIsland.tsx`

**锁定功能逻辑优化**：
- 新增 `handlePetClick` 包装函数，统一控制点击交互条件
- 未锁定 + 非移动/缩放状态：角色可点击交互（摸头/戳身体/踩脚等）
- 未锁定 + 移动模式：可拖拽窗口，点击不触发交互
- 未锁定 + 缩放模式：滚轮缩放，点击不触发交互
- 锁定后：角色区域鼠标事件穿透，仅保留右下角控制面板区域可交互
- **文件**: `src/App.tsx`

**淡出透明度可配置**：
- 设置面板新增「淡出透明度」滑块组件 `FadeOpacitySlider`
- 调节范围：0%（完全透明）~ 100%（完全不透明），步进 5%
- 默认值：15%
- 设置持久化到 localStorage，刷新后保留
- 通过 `--fade-opacity` CSS 变量控制 `.pet-zone.fading .pet-model` 透明度
- 应用启动时从 localStorage 读取并设置 CSS 变量
- **文件**: `src/components/Settings/SettingsPanel.tsx`, `src/App.css`, `src/App.tsx`

**窗口布局优化**：
- 窗口宽度：450px → 280px，更贴合角色宽度
- 气泡高度：120px → 80px
- 角色区域 top：100px → 60px，缩小气泡与头顶间距
- 气泡内边距：16px → 8px
- config.json 同步更新 windowWidth / bubbleHeight
- **文件**: `src/App.css`, `public/models/nahida/config.json`, `public/models/hiyori/hiyori_free_zh/config.json`, `src/App.tsx`

### Live2D 角色切换 & 动画灵动感优化 & 鼠标跟踪修复 — 2026-07-26

**角色切换功能**：
- 新增 `public/models/index.json` 模型列表配置，支持多模型注册
- 从 AIRI 项目使用的远程模型源下载 Hiyori（希奥莉）模型到 `public/models/hiyori/`
- App.tsx 添加 `availableModels`、`currentModelId` 状态，模型选择记忆到 localStorage
- ControlsIsland 新增"角色"按钮和模型选择面板（带高亮当前选中项）
- 模型配置（config.json）随当前模型动态加载，不再硬编码 nahida 路径
- main.tsx 预加载模型列表 `index.json`
- **文件**: `src/App.tsx`, `src/components/Pet/ControlsIsland.tsx`, `src/main.tsx`, `public/models/index.json`, `public/models/hiyori/hiyori_free_zh/config.json`

**待机微摇摆（Idle Sway）系统**：
- 新增 `src/lib/live2d/animation/idle-sway.ts`：多层正弦波叠加模拟自然待机晃动
- 头部 X/Y/Z 轴 + 身体 X/Y 轴独立频率/相位，避免单调机械感
- idle 状态下自动启用，叠加到头部角度和身体角度
- **文件**: `src/lib/live2d/animation/idle-sway.ts`, `src/lib/live2d/lappmodel.ts`

**呼吸 & 眼跳参数调优**：
- 呼吸幅度降低（避免与 idle sway 叠加后过大），频率更自然
- 眼跳 CDF 分布缩短平均间隔（从 ~2.5s 到 ~1s），增加眼球活跃度
- **文件**: `src/lib/live2d/lappmodel.ts`, `src/lib/live2d/animation/saccade.ts`

**鼠标跟踪卡顿修复（关键）**：
- 修复 `_dragManager.update()` 被重复调用两次的 bug（第 567 行 + 原第 620 行）
  - CubismTargetPoint.update() 内部累加时间和执行物理演算，调用两次会导致时间翻倍、平滑曲线失真
  - 这是鼠标跟踪卡顿不平滑的根本原因
- 眼球追踪从 `addParameterValueById` 改为 `setParameterValueById`，避免与 motion 叠加导致偏移
- **文件**: `src/lib/live2d/lappmodel.ts`

**启动脚本修复**：
- 修复 `pnpm-workspace.yaml` 中 `esbuild: set this to true or false` 无效值导致 pnpm 命令失败
- 修复 if 块内延迟变量展开（`%NEED_CREATE%` → `!NEED_CREATE!`）
- **文件**: `pnpm-workspace.yaml`

### Provider 服务启停逻辑修复 & 感知页面增强 — 2026-07-06

**Provider 服务状态机修复**：
- `startService` 启动后状态从直接 `running` 改为 `starting` 过渡，轮询检测健康检查通过后自动转为 `running`
- `isPortRunning` 判定扩展为包含 `starting`（端口活跃），新增 `isPortReady` 仅匹配 `running`（服务就绪）
- ProviderCard 状态徽章统一逻辑：Ollama > 通用服务（running/starting/error/stopped）> API > 已禁用
- 新增 `error` 状态显示（"异常"红色徽章），此前完全缺失
- 停止按钮在 `starting` 状态可用（"取消启动"），启动按钮在 `error` 状态可用（失败重试）
- **文件**: `src/admin/pages/Providers/hooks/useServiceManager.ts`, `src/admin/pages/Providers/components/ProviderCard.tsx`

**感知调校页面增强**：
- 摄像头水平镜像翻转（Canvas `scale(-1, 1)` + `translate`），默认开启，解决左右方向相反
- 手部节点 / 面部节点独立显示开关，替换原单一"显示关键点"总开关
- 节点显示控制细化为 4 个开关：显示预览 / 镜像翻转 / 手部节点 / 面部节点
- **文件**: `src/admin/pages/Perception.tsx`

**角色位置微调**：
- 默认 `feetOffset` 从 0 调整为 80，模型整体下移，底部蓝线与功能栏上方贴合
- **文件**: `src/App.tsx`

### pnpm 11+ & Tauri 环境兼容 — 2026-07-06

**pnpm 11+ 兼容性**：
- `ERR_PNPM_IGNORED_BUILDS`：pnpm 11 默认阻止第三方包构建脚本，esbuild postinstall 被拦截
- 修复：`pnpm-workspace.yaml` 配置 `allowBuilds.esbuild: true`
- **文件**: `pnpm-workspace.yaml`

**Tauri 环境安全调用**：
- 浏览器环境下 `getCurrentWindow()`、`listen()` 等 Tauri API 为 undefined 导致级联崩溃
- 新增 `src/utils/tauriEnv.ts`：`isTauriEnv()` 环境检测 + `safeTauriCall()` 安全调用包装
- 所有 Tauri 调用增加环境守卫 + try-catch，确保浏览器模式不崩溃
- **文件**: `src/utils/tauriEnv.ts`, `src/App.tsx`, `src/hooks/useLive2D.ts`

### 感知服务整合 — 2026-07-06

将独立开发的 gesture-character 项目整合到 Desk Pet：

- `server/perception/` — Python 感知模块（hand_tracker/face_tracker/data_processor/gesture_learner/perception_server/config）
- `src/services/perception/` — 前端感知服务（types/service/gestureMapping/hooks/index）
- import 路径适配（`from config` → `from .config`）
- 移除原项目中的 UserConfig/LLM/TTS 依赖，仅保留感知核心
- 感知服务保持独立 WebSocket 模块，**未纳入** Provider 体系
- `server/requirements.txt` 新增 `mediapipe>=0.10.0`、`opencv-python-headless>=4.8.0`
- 项目清理：删除 `venv/` (~4.8GB)、`src-tauri/target/` (~9.1GB)、`dist/`、临时输出文件
- `.gitignore` 新增 `*_output.txt`、`*_result.txt`、`*_out.txt`、`cargo_err.txt` 规则

### Service 进程生命周期管理 — 2026-06-21

新增 Service 进程管理器，实现 Provider 配置与 TTS/STT 服务生命周期一体化：

- `src-tauri/src/service.rs` — Mutex<HashMap> 进程池，支持启动/停止/状态查询/批量清理
- `src-tauri/src/lib.rs` — 注册 ServiceManager 状态 + 4 Tauri commands + 7 HTTP API
- `src/admin/pages/Providers.tsx` — 服务状态轮询 (5s)、运行/停止徽章、一键启停

预填命令映射：

| 类型 | command | args | port | 工作目录 |
|------|---------|------|------|---------|
| Edge TTS | python | server/edge_tts_server.py --port 8001 | 8001 | 项目根 |
| GPT-SoVITS | python | api_v2.py -a 127.0.0.1 -p 9880 | 9880 | `server/gpt_sovits/` |
| FunASR / SenseVoice | python | server/stt_server.py --port 8002 | 8002 | 项目根 |

> **注意**：GPT-SoVITS 必须在 `server/gpt_sovits/` 目录下启动，因为 `tts_infer.yaml` 中的模型路径（`GPT_SoVITS/pretrained_models/...`）为相对路径。

### Phase 1.8: 管理后台 UI 重制 — 2026-06-20

UI 框架升级：手写组件库 → HeroUI v3.2.1 + Tailwind CSS v4 + Framer Motion

- 路由：state 路由 → React Router HashRouter
- 主题：仅暗色 → Dark/Light 双主题 (sakura pink #FF7FAC)
- 通知：useToast → react-hot-toast
- 9 页面全部迁移，8 个新可复用组件，旧组件体系删除

### Phase 3: MCP 工具集成 — 2026-06-21

- MCP 进程外工具扩展 (mcp.rs)
- JSON-RPC brace counting 支持多行响应

### GPT-SoVITS 实时推理优化 — 2026-07-29

针对本地 RTX 4070 Laptop GPU (8GB) 实现 RTF < 1 的实时语音合成，同时保留 3GB+ 显存余量给其他应用。

**资源位置（全部在项目内）：**

| 资源 | 路径 | 大小 |
|------|------|------|
| GPT-SoVITS 源码 | `server/gpt_sovits/`（.gitignore 排除，第三方仓库） | — |
| T2S 模型权重（用户训练） | `server/gpt_sovits/GPT_SoVITS/pretrained_models/nahida_gpt.ckpt` | 147.9 MB |
| VITS 模型权重（用户训练） | `server/gpt_sovits/GPT_SoVITS/pretrained_models/nahida_sovits.pth` | 81.0 MB |
| 参考音频 | `server/gpt_sovits/nahida/slicer_opt_trimmed/trimmed_vo_HSEQ002_11_nahida_12.wav` | — |
| BERT 基座 | `server/gpt_sovits/GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large/` | — |
| HuBERT 基座 | `server/gpt_sovits/GPT_SoVITS/pretrained_models/chinese-hubert-base/` | — |
| 服务启动脚本 | `server/gpt_sovits/api_v2.py`（含 BERT INT8 量化代码） | — |
| 推理配置 | `server/gpt_sovits/GPT_SoVITS/configs/tts_infer.yaml` | — |
| 前端适配器 | `src/services/provider/tts/gptsovits.ts` | — |

**三项关键优化：**

1. **BERT INT8 动态量化**（`api_v2.py`）
   - BERT（chinese-roberta-wwm-ext-large, 325.5M 参数）仅用于文本特征提取
   - 启动时自动量化为 INT8 并移至 CPU 推理，释放约 0.21GB GPU 显存给 T2S/VITS
   - 模型体积减少 68%，推理速度提升约 4%，音质影响 < 2%
   - 量化失败时自动回退 FP16，不影响服务可用性

2. **推理参数调优**（`api_v2.py` 的 `TTS_Request` 默认值 + `gptsovits.ts` 的 `DEFAULT_CONFIG`）
   - `top_k=5`（默认 15）— 收敛更快，减少采样波动
   - `temperature=0.6`（默认 1.0）— 降低随机性，提升稳定性
   - `top_p=0.9`（默认 1.0）— 核采样截断
   - `parallel_infer=False`（默认 True）— 关闭并行避免显存峰值
   - `repetition_penalty=1.1`（默认 1.35）— 轻度抑制重复
   - `speed_factor=1.0` — 正常语速

3. **流式合成**（`streaming_mode=1`）
   - 首包延迟 0.86~1.0 秒（短句），长句边合成边播放
   - 前端 `synthesizeStream()` 通过 ReadableStream 持续 yield 音频 chunk

**性能指标（RTX 4070 Laptop, 8GB 显存）：**

| 场景 | 显存占用 | RTF | 首包延迟 |
|------|---------|-----|---------|
| 短句（<10 字） | 1.83 GB | 0.33 | 0.86s |
| 长句（30+ 字） | 1.83 GB | 0.83 | 1.0s |
| 受限场景（其他应用占 4GB） | 1.83 GB | 0.95 | 1.2s |

> 显存余量：6.0+ GB（无其他应用）/ 2.0+ GB（其他应用占 4GB 时仍可实时）

**配置一致性约束：**
- `api_v2.py` 的 `TTS_Request` 默认值必须与 `gptsovits.ts` 的 `DEFAULT_CONFIG` 保持同步
- 模型权重路径由 `tts_infer.yaml` 的 `t2s_weights_path` / `vits_weights_path` 指定，使用相对路径
- 参考音频路径由 `gptsovits.ts` 的 `refAudioPath` 指定，相对于 GPT-SoVITS 工作目录（`server/gpt_sovits/`）

---

*最后更新：2026-07-29*
