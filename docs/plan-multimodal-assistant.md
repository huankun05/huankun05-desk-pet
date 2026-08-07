# Desk Pet 多模态助手升级计划 v3

> ✅ 全部 Phase（1-9）已完成并验证通过。
> TypeScript 零错误，Vite 构建成功，Rust cargo check 通过。

---

## 一、目标概述

将 Desk Pet 从"情感陪伴桌宠"升级为"情感陪伴 + 工具助手"双定位：

- **多模态视觉理解**：基于 Ollama vision 模型（llava / minicpm-v / qwen2-vl / gemma3 等），支持"一起刷抖音"场景
- **快捷键唤醒语音助手**：Ctrl+Space 唤醒 → 语音命令 → LLM 意图识别 → 工具调用 → 生成文档/截屏分析
- **文件存储优化**：项目目录优先（data/ + temp/），C 盘仅保留必要的加密敏感配置；打包后路径兼容
- **设置面板完善**：新增快捷键管理、文件管理、多模态配置、MCP 管理 4 个页面

---

## 二、当前进度（已完成 vs 待完成）

### ✅ 已完成（Phase 1-5）

| Phase | 内容 | 关键文件 |
|-------|------|----------|
| Phase 1 | 多模态消息格式升级 | `src/services/provider/types.ts`（ChatMessage 支持 `string \| MessageContentPart[]`）、`openai/chat.ts`、`ollama/chat.ts`（vision 模型检测 `isVisionModel()`）、`tool-loop.ts`（截图转多模态消息） |
| Phase 2 | 文件操作工具实现 | `src-tauri/src/lib.rs`（write_file/read_file_content/list_directory/get_desktop_path 命令）、`src/services/tools/builtins.ts`（screenshot/read_clipboard/list_directory/save_to_desktop 等工具注册） |
| Phase 3a | 基础快捷键注册 | `src/hooks/useGlobalShortcuts.ts`（事件监听 Hook）、`App.tsx`（集成快捷键） |
| Phase 3b | 快捷键自定义配置 + 持久化 + 冲突检测 + 设置页 | `src-tauri/src/shortcuts.rs`（动态注册/注销/冲突检测，配置存 `data/config/preferences.json`）、`src/settings/pages/system/ShortcutsPage.tsx`（录制 + 恢复默认） |
| Phase 4 | 文件存储策略重构 | `src-tauri/src/utils.rs`（`get_project_data_dir()` 开发/打包路径自适应 + 可写性回退、`get_temp_dir()`、`cleanup_temp_files()`）、`src/services/storage.ts`（项目目录存储适配） |
| Phase 5 | 设置面板新增 4 个页面 | `ShortcutsPage.tsx`、`FileManagerPage.tsx`、`MultimodalPage.tsx`、`McpPage.tsx` + 路由配置 + i18n（zh-CN/en-US） |

### ⏳ 待完成（Phase 6-8）

| Phase | 内容 | 优先级 | 依赖 | 状态 |
|-------|------|--------|------|------|
| Phase 6 | "一起刷抖音"场景实现（自动截屏 + 视觉分析 + 角色反应） | P1 | Phase 1+3（已具备） | ✅ 已完成 |
| Phase 7 | Provider 懒加载优化（性能优化） | P2 | 无 | ✅ 已完成 |
| Phase 8 | 语音助手模式（快捷键唤醒语音 + 意图识别 + 工具链路） | P2 | Phase 3（已具备） | ✅ 已完成 |
| Phase 9 | 语音唤醒词（Vosk 离线关键词检测，叫"汐月"即唤醒） | P2 | Phase 8（已具备） | ✅ 已完成 |

---

## 三、设置面板现状（已完成）

设置面板缺口已全部补齐，当前结构：

```
/settings
├── /appearance        外观（通用 + 交互）
├── /models            角色模型（Live2D）
├── /services          服务来源
│   ├── /llm           LLM 方案
│   ├── /tts           TTS 方案
│   ├── /stt           STT 方案
│   ├── /multimodal    ✅ 多模态配置（视觉检测、截图质量、一起看模式）
│   ├── /mcp           ✅ MCP 服务器管理
│   └── /wake-word     ✅ 语音唤醒词配置（启用/关键词/模型下载）
├── /memory            记忆体（规则 + 数据）
└── /system            系统
    ├── /general       通用
    ├── /developer     开发者
    ├── /about         关于
    ├── /plugins       插件管理
    ├── /automation    自动化
    ├── /shortcuts     ✅ 快捷键管理
    └── /files         ✅ 文件管理（数据目录、临时文件清理）
```

### 3.1 各页面可管理内容

| 页面 | 可管理内容 | 状态 |
|------|------------|------|
| 快捷键管理 | 3 个快捷键的展示、自定义修改、冲突检测、恢复默认 | ✅ |
| 文件管理 | 数据目录展示、临时文件大小、手动清理、自动清理周期（24h/7d/30d/不自动） | ✅ |
| 多模态配置 | 启用开关、Vision 模型检测（自动/手动）、截图质量、截图分辨率、一起看模式间隔、系统提示词 | ✅ |
| MCP 管理 | 服务器增删改查、连接状态、工具列表、启用开关 | ✅ |

### 3.2 现有页面待补充（执行 Phase 6 时顺便完成）

| 页面 | 需补充内容 |
|------|------------|
| `LLMPage.tsx` | Provider 卡片显示 vision 模型标记（调用 `isVisionModel()`）、Ollama 模型下拉联动 `/api/tags` |
| `MultimodalPage.tsx` | "一起看"模式的启停按钮、当前状态指示器（idle/watching） |

---

## 四、文件存储策略（已实现，执行 Phase 6 时遵循）

### 4.1 存储分区（已落地）

```
项目根目录（开发）/ exe 同级目录（打包）
├── data/                              # 持久化数据（随应用迁移）
│   ├── config/                        # 非敏感配置
│   │   ├── preferences.json           # 偏好设置（快捷键、主题等）
│   │   └── automation.json            # 自动化任务配置
│   ├── sessions/                      # 对话历史（按 session_id 分文件）
│   ├── memory/                        # 记忆数据
│   ├── plugins/                       # 插件数据
│   ├── mcp/                           # MCP 服务器配置
│   └── logs/                          # 日志文件（7 天滚动）
├── temp/                              # 临时文件（定期清理）
│   ├── screenshots/                   # 截图缓存（24h 自动清理）
│   ├── audio/                         # 音频缓存（TTS 输出、STT 输入）
│   └── cache/                         # 通用缓存
└── server/                            # Python 后端服务（如需要）

C 盘（%APPDATA%\desk-pet\）仅保留：
├── settings.json                      # 通用设置（含 API Key，DPAPI 加密）
└── providers.json                     # Provider 配置（含 API Key，DPAPI 加密）
```

**设计原则**：
- 含 API Key 等敏感信息的配置 → C 盘加密存储（DPAPI）
- 非敏感的持久化数据 → 项目目录 `data/`（便于迁移、备份、打包）
- 临时数据 → 项目目录 `temp/`（定期清理，不占用 C 盘）

### 4.2 Rust 侧路径管理（已实现）

**文件**：`src-tauri/src/utils.rs`

已实现函数：
- `get_data_dir()` — C 盘加密配置目录（`%APPDATA%\desk-pet\`）
- `get_project_data_dir()` — 项目数据目录（开发：项目根/data/；打包：exe 同级/data/；不可写时回退 `%APPDATA%\desk-pet\data\`）
- `get_temp_dir()` — 临时文件目录
- `cleanup_temp_files(max_age_hours)` — 清理超过指定时长的临时文件
- `is_dev_mode()` / `find_project_root()` / `is_dir_writable()` — 环境检测辅助

### 4.3 存储分类表

| 数据类型 | 存储位置 | 加密 | 生命周期 | 迁移方式 |
|----------|----------|------|----------|----------|
| Provider 配置（含 API Key） | `%APPDATA%\desk-pet\providers.json` | ✅ DPAPI | 持久 | 不迁移 |
| 通用设置（含 API Key） | `%APPDATA%\desk-pet\settings.json` | ✅ DPAPI | 持久 | 不迁移 |
| 偏好设置（快捷键等） | `data/config/preferences.json` | ❌ | 持久 | 随项目迁移 |
| 对话历史 | `data/sessions/` | ❌ | 持久 | 随项目迁移 |
| 记忆数据 | `data/memory/` | ❌ | 持久 | 随项目迁移 |
| 插件数据 | `data/plugins/` | ❌ | 持久 | 随项目迁移 |
| MCP 配置 | `data/mcp/` | ❌ | 持久 | 随项目迁移 |
| 自动化任务 | `data/config/automation.json` | ❌ | 持久 | 随项目迁移 |
| 日志 | `data/logs/` | ❌ | 7 天滚动 | 随项目迁移 |
| 截图缓存 | `temp/screenshots/` | ❌ | 24h | 不迁移 |
| 音频缓存 | `temp/audio/` | ❌ | 24h | 不迁移 |

### 4.4 打包兼容性（已实现）

- 开发环境检测：exe 在 `target\debug` 或 `target\release` 下时，向上查找 `package.json` 定位项目根
- 打包环境：exe 同级目录优先，不可写时回退到 `%APPDATA%\desk-pet\data\`
- 首次启动自动创建 `data/` 和 `temp/` 子目录

---

## 五、剩余工作详细方案

### Phase 6：「一起刷抖音」场景实现（P1）

#### 5.1.1 核心流程

```
用户刷抖音
  → 按 Ctrl+Shift+S 触发"一起看"模式
  → Rust 截屏 (capture_screenshot) → JPEG base64 → 前端
  → 前端将截图 + 系统提示词组装为多模态消息
  → 发送给当前 LLM（若为 vision 模型则带 image_url）
  → vision 模型分析画面内容（识别视频内容、文案、表情等）
  → LLM 生成角色化的评论/反应（JSON 格式）
  → 前端解析 JSON：comment + expression + description
  → 角色通过 TTS 说话 + Live2D 表情同步
  → 气泡显示文字
  → 每 30s（可配置）自动重复
  → 再按 Ctrl+Shift+S 或 Esc 退出模式
```

#### 5.1.2 系统提示词（存入多模态设置页配置）

```
你是一个正在和我一起刷短视频的桌面宠物伙伴。
我刚刚截取了当前屏幕画面。请：
1. 简要描述你看到的视频内容（不超过 20 字）
2. 以可爱、活泼的语气发表一句评论（不超过 30 字）
3. 根据内容选择一个合适的表情标签：[happy, sad, surprised, angry, shy, neutral]
返回 JSON: { "comment": "...", "expression": "...", "description": "..." }
```

#### 5.1.3 状态机

```
idle → (Ctrl+Shift+S) → watching
watching → (每 30s 或手动快捷键) → screenshot → analyze → react → watching
watching → (Esc 或再按快捷键) → idle
```

#### 5.1.4 性能优化

- 截图压缩为 JPEG（质量 70%，可配置），控制 base64 大小在 100KB 以内
- 非阻塞：截图分析在后台进行，不影响用户操作
- 防抖：连续触发时只执行最后一次
- 上下文缓存：保留最近 3 次截图分析结果，避免重复评论
- Vision 模型未启用时：降级为纯文本提示（"用户开启了一起看模式，但你当前模型不支持视觉"）

#### 5.1.5 新增文件

| 文件路径 | 说明 |
|----------|------|
| `src/hooks/useWatchTogether.ts` | "一起看"模式状态机（启停、定时调度、结果分发） |
| `src/services/scenes/watchTogether.ts` | 场景逻辑（截屏调度、提示词构建、JSON 解析、表情/TTS 联动） |

#### 5.1.6 修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `src/hooks/useGlobalShortcuts.ts` | Ctrl+Shift+S 事件路由到 `useWatchTogether` |
| `src/App.tsx` | 集成 `useWatchTogether` Hook |
| `src/settings/pages/services/MultimodalPage.tsx` | 新增"一起看"模式启停按钮 + 状态指示器 |
| `src/settings/pages/services/LLMPage.tsx` | Provider 卡片显示 vision 模型标记 |

#### 5.1.7 验证步骤

1. 确认 Ollama 已下载 vision 模型（如 `ollama pull llava`）
2. 在 LLM 设置页选择 vision 模型作为当前 Provider
3. 打开抖音网页/客户端
4. 按 Ctrl+Shift+S 进入"一起看"模式
5. 验证：角色每 30s 自动评论一次，表情同步切换，TTS 播放评论
6. 按 Esc 退出，验证状态恢复正常

---

### Phase 7：Provider 懒加载优化（P2）

#### 5.2.1 问题

当前 `ProviderManager.init()` 启动时为所有 `enable=true` 的 Provider 创建实例，即使用户只用 1 个 Chat Provider，所有启用的 TTS/STT Provider 也会被实例化，浪费资源。

#### 5.2.2 优化方案

**文件**：`src/services/provider/manager.ts`

- 仅保存配置，不预创建实例
- `getActiveChatProvider()` 按需创建并缓存
- 切换 Provider 时自动 `validate()`，失败时提示用户
- 资源回收：切换 Provider 时调用旧实例的 `dispose()`（如有）

#### 5.2.3 验证步骤

1. 启动应用，确认无 Provider 实例化日志
2. 发起对话，确认 Chat Provider 按需创建
3. 切换 TTS Provider，确认旧实例释放、新实例创建
4. 验证无内存泄漏（连续切换 10 次后内存稳定）

---

### Phase 8：语音助手模式（P2）

#### 5.3.1 快捷键唤醒流程

```
Ctrl+Space 按下
  → 前端收到 Rust 事件 (shortcut-voice)
  → 启动录音（如果 STT 可用）
  → UI 显示"正在聆听..."气泡
  → 松开 / 1.5s 静音 → 停止录音
  → STT 转文字
  → 文字发送到 Chat Pipeline
  → LLM 处理（可能调用工具：写文件、搜索等）
  → TTS 播放回复
  → 气泡显示文字
```

#### 5.3.2 语音命令意图识别

LLM 通过 system prompt 自然理解意图，无需专门路由：

| 用户说 | LLM 理解 | 调用工具 |
|--------|----------|----------|
| "帮我写一个关于 AI 的调研报告" | 生成 Markdown 报告 | `save_to_desktop` |
| "截个屏看看我屏幕上是什么" | 截屏分析 | `screenshot` → vision |
| "搜索一下今天的天气" | 网页搜索 | `web_search`（需 MCP） |
| "打开设置面板" | 打开设置 | 前端事件 |

#### 5.3.3 新增/修改文件

| 文件路径 | 说明 |
|----------|------|
| `src/hooks/useVoiceAssistant.ts` | 语音助手状态机（唤醒、录音、识别、处理、回复） |
| `src/hooks/useGlobalShortcuts.ts` | Ctrl+Space 事件路由到 `useVoiceAssistant` |
| `src/App.tsx` | 集成 `useVoiceAssistant` Hook |

#### 5.3.4 验证步骤

1. 确认 STT Provider 已配置可用
2. 按 Ctrl+Space，验证"正在聆听..."气泡出现
3. 说"帮我写一个关于 AI 的调研报告"，验证桌面生成 Markdown 文件
4. 说"截个屏看看我屏幕上是什么"，验证截图 + 视觉分析
5. 验证 TTS 播放回复

---

### Phase 9：语音唤醒词（P2）

#### 5.4.1 核心流程

```
用户说"汐月"
  → Vosk WASM 引擎本地识别关键词
  → 角色气泡显示"在！"
  → TTS 播放"在"
  → 自动触发语音助手（useVoiceAssistant.wake()）
  → 用户继续语音指令（写文件、截屏分析等）
  → 语音助手结束后恢复唤醒词监听
```

#### 5.4.2 技术方案

- **Vosk-browser WASM**：使用 vosk-browser 的 WebAssembly 构建实现本地语音识别
- **关键词列表模式**：通过 grammar 参数仅识别配置的唤醒词，CPU 占用极低
- **离线模型**：vosk-model-small-cn-0.22（约 42MB），下载到项目 `data/models/vosk/` 目录
- **资源管理**：默认关闭，用户在设置页手动启用；语音助手活跃时自动暂停监听避免回声误触发
- **跨窗口同步**：配置存储在 localStorage，通过 storage 事件实现设置页↔主窗口实时同步

#### 5.4.3 新增文件

| 文件路径 | 说明 |
|----------|------|
| `src/hooks/useWakeWord.ts` | 唤醒词状态机（启用/禁用/模型加载/检测回调/跨窗口同步） |
| `src/services/wakeWord/voskEngine.ts` | Vosk WASM 引擎封装（模型加载/麦克风监听/识别器管理） |
| `src/settings/pages/services/WakeWordPage.tsx` | 唤醒词设置页（启用开关/关键词/模型下载/状态指示器） |
| `src-tauri/src/wake_word.rs` | Rust 侧 Vosk 模型管理（检查/下载/删除/进度事件） |

#### 5.4.4 修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `src/App.tsx` | 集成 useWakeWord，voiceStateRef 避免闭包过期 |
| `src/settings/routes.tsx` | 新增 `/settings/services/wake-word` 路由 |
| `src/settings/pages/services/ServicesIndex.tsx` | 新增唤醒词入口 |
| `src/i18n/locales/zh-CN.json` | 新增 wake_word 翻译块 |
| `src/i18n/locales/en-US.json` | 新增 wake_word 翻译块 |
| `src-tauri/tauri.conf.json` | CSP 添加 asset: 和 alphacephei.com；assetProtocol scope 添加 data/models |
| `src-tauri/Cargo.toml` | tauri features 添加 protocol-asset |
| `src-tauri/src/lib.rs` | 注册 wake_word 模块和 4 个命令 |

#### 5.4.5 验证步骤

1. 在设置页「语音唤醒」下载 Vosk 模型（约 42MB）
2. 启用语音唤醒开关
3. 说"汐月"，验证角色气泡显示"在！"并 TTS 回应
4. 验证语音助手自动唤醒，可以继续下指令
5. 语音助手活跃期间说"汐月"不触发（避免回声）
6. 禁用开关后验证麦克风释放

---

## 六、MCP / Skills 需求

### 6.1 内置工具（Tool）现状

| 工具名 | 状态 | 说明 |
|--------|------|------|
| `screenshot` | ✅ 已有 | 截屏并返回 base64，已支持多模态回传 |
| `read_clipboard` | ✅ 已有 | 读取剪贴板文本/图片 |
| `write_file` | ✅ 已有 | 写文件到指定路径 |
| `read_file` | ✅ 已有 | 读文件内容 |
| `list_directory` | ✅ 已有 | 列目录 |
| `save_to_desktop` | ✅ 已有 | 保存文件到桌面 |
| `system_info` | ✅ 已有 | 系统信息 |
| `web_search` | ❌ 桩实现 | 需后端支持或接入 MCP |
| `open_url` | ❌ 未实现 | 用默认浏览器打开 URL（P1，Phase 8 需要） |

### 6.2 推荐的 MCP Server

| MCP Server | 用途 | 接入方式 | 优先级 |
|------------|------|----------|--------|
| `@modelcontextprotocol/server-filesystem` | 文件系统操作（扩展能力） | npm 包，stdio 通信 | P2（内置已覆盖基础） |
| `@modelcontextprotocol/server-brave-search` | 网页搜索 | 需 Brave API Key | P1（Phase 8 语音搜索需要） |
| `@modelcontextprotocol/server-fetch` | 抓取网页内容 | npm 包 | P1 |
| 自定义桌面 MCP | 桌面操作（打开应用、管理窗口） | Rust 实现 | P2 |

### 6.3 现有 Skills（插件）

| 插件 | 状态 |
|------|------|
| 番茄钟 | ✅ 已有 |
| 喝水提醒 | ✅ 已有 |
| 久坐提醒 | ✅ 已有 |
| 护眼提醒 | ✅ 已有 |
| 每日问候 | ✅ 已有 |

### 6.4 需要新增的 Skills

| 插件 | 优先级 | 说明 |
|------|--------|------|
| 屏幕伴侣 | P1 | "一起看"模式的自动化逻辑（定时截屏、分析调度）— Phase 6 可作为 Hook 实现而非插件 |
| 定时报告 | P2 | 定时生成工作日报/周报并保存到桌面 |

### 6.5 MCP 管理现状

- ✅ 已有 `src/services/mcp/manager.ts`、`client.ts`、`bridge.ts` 完整的 MCP 客户端实现
- ✅ 支持 stdio 通信、工具发现、工具注册到 LLM
- ✅ 已有设置面板 UI（`McpPage.tsx`）支持增删改查
- ✅ 配置存储在项目目录 `data/mcp/`

---

## 七、实施顺序

```
当前状态（Phase 1-5 已完成）
  ↓
Phase 6（"一起刷抖音"场景）— P1，最高优先级
  ├─ 新增 useWatchTogether.ts + watchTogether.ts
  ├─ 修改 useGlobalShortcuts.ts + App.tsx
  ├─ 补充 MultimodalPage.tsx 状态指示器
  └─ 补充 LLMPage.tsx vision 模型标记
  ↓
Phase 8（语音助手模式）— P2
  ├─ 新增 useVoiceAssistant.ts
  ├─ 实现 open_url 工具
  └─ 接入 Brave Search MCP（可选）
  ↓
Phase 7（Provider 懒加载优化）— P2，性能优化最后做
  └─ 重构 manager.ts
```

**理由**：Phase 6 是用户最关心的"一起刷抖音"核心场景，且依赖的 Phase 1+3 已完成，可立即开始。Phase 8 语音助手扩展工具能力。Phase 7 是纯性能优化，非功能性，放最后。

---

## 八、文件影响范围（剩余工作）

### 8.1 新增文件

| 文件路径 | Phase | 说明 |
|----------|-------|------|
| `src/hooks/useWatchTogether.ts` | 6 | "一起看"模式状态机 |
| `src/services/scenes/watchTogether.ts` | 6 | 场景逻辑（截屏调度、提示词构建、JSON 解析） |
| `src/hooks/useVoiceAssistant.ts` | 8 | 语音助手状态机 |

### 8.2 修改文件

| 文件路径 | Phase | 修改内容 |
|----------|-------|----------|
| `src/hooks/useGlobalShortcuts.ts` | 6+8 | Ctrl+Shift+S 路由到 watchTogether，Ctrl+Space 路由到 voiceAssistant |
| `src/App.tsx` | 6+8 | 集成 useWatchTogether + useVoiceAssistant |
| `src/settings/pages/services/MultimodalPage.tsx` | 6 | 新增"一起看"模式启停按钮 + 状态指示器 |
| `src/settings/pages/services/LLMPage.tsx` | 6 | Provider 卡片显示 vision 模型标记 |
| `src/services/tools/builtins.ts` | 8 | 新增 `open_url` 工具 |
| `src/services/provider/manager.ts` | 7 | 懒加载重构 |
| `src-tauri/src/lib.rs` | 8 | 新增 `open_url` 命令（如需） |

---

## 九、验证计划

每个 Phase 完成后执行：

1. **TypeScript 类型检查**：`npx tsc --noEmit` 零错误
2. **构建验证**：`pnpm build` 成功
3. **功能测试**：
   - Phase 6：按 Ctrl+Shift+S 进入"一起看"模式 → 自动截屏 → vision 模型分析 → 角色评论 + 表情 + TTS
   - Phase 7：启动无 Provider 实例化 → 按需创建 → 切换释放
   - Phase 8：Ctrl+Space 唤醒 → 录音 → STT → LLM → 工具调用 → TTS 回复
4. **打包验证**（全部完成后）：`pnpm tauri build` → 安装包数据目录正确（exe 同级/data/）

---

## 十、风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| Vision 模型未安装 | 检测 Ollama 已下载模型，无 vision 模型时引导用户 `ollama pull llava` |
| 截图 base64 过大 | JPEG 质量可配置 + 分辨率缩减，控制 100KB 以内 |
| Ollama 服务未运行 | `checkOllamaRunning()` 检测，提示用户启动服务 |
| 快捷键冲突（与其他应用） | 注册失败时提示用户更换快捷键（设置页可改） |
| 语音识别失败 | STT 不可用时降级为文本输入框 |
| MCP Server 启动失败 | 超时机制 + 错误提示 + 不影响其他 Server |
| Phase 7 重构引入回归 | 保留旧接口兼容，分步切换，每步验证 |
