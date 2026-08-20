# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **后端记忆系统接入情绪快照**：`memory_fragments` 增加 `emotion_snapshot` 字段；`Session.reflect_on_exchange` 记录单轮 PAD 快照并计算整轮平均后持久化。
- **记忆检索情绪相似度加分**：`Librarian.search` 支持 `current_pad`，按记忆 `emotion_snapshot` 与当前 PAD 距离做加分；`format_prompt` 增加情绪标签。
- **情绪状态持久化扩展**：`emotion_states` 增加 `boredom/loneliness`；互动后下降，作为内在状态持久化在后端。
- **主动消息调度增强**：ProactiveScheduler 支持情绪优先 + 2h 冷却 + 随机兜底；用户发消息重置冷却。
- **聊天活跃会话路由**：主动消息 `sessionId` 路由到当前活跃会话；`deskpet_active_session_id` localStorage 跨窗口同步。
- **未读消息徽标**：`ControlsOrb` 右上角展示未读；用户发送消息 +1，打开聊天窗口清空。

### TODO（明日继续）

- [ ] 主动消息生成：LLM 优先 + 前端台词池 fallback
- [ ] `boredom/loneliness` idle 增长：无互动随时间上升
- [ ] 回忆情绪叠加：30% × importance PAD 叠加 + 10s 指数衰减回原状态，前端表情/状态叠加接入
- [ ] 运行时验证：`InteractionPage.tsx` 后端消息热更新、未读徽标实际行为

- **物理互动低频聚合沉淀（摸头/拍打/踩脚 → 长期记忆）**: 新增 `server/core/interaction_agg.py`——每次互动只做轻量计数（`interaction_stats` 累计 + `interaction_events` 近 7 天窗口样本，样本上限 1000），某类互动累计较上次沉淀新增 ≥5 次时，才沉淀**一条**偏好记忆（`client_ref=interact-settle:{type}` 幂等更新，内容带累计次数，随频率增长更新），不逐条入库。接入：①`POST /api/core/emotion/bridge/event` 收到 `interaction:*` 事件先聚合计数（不受情绪节流影响）；②新增 `GET /api/core/interaction/stats`；③gateway 新增 `_fetch_interaction_context()`（60s 缓存）在每次聊天注入 `<interaction-context>`——角色知道"最近互动过什么、频率多少"（如"摸头 23 次（近 7 天 8 次）"），可自然提起但不生硬复述次数。已验证：5 次摸头沉淀 1 条、再攒 5 次幂等更新不新增、拍打独立成第二条。 (`server/core/interaction_agg.py`, `server/core/api_server.py`, `server/hermes_gateway_server.py`)
- **情绪→说话方式打通（"像人"的关键）**: `hermes_gateway_server.py` 新增 `_fetch_emotion_context()`——每次聊天从 core 拉当前情绪，构造 `<emotion-context>` 说话方式指南注入 system prompt（愉悦高→热情分享、低落→语气克制带情绪、高唤醒→兴奋话多），生气时说话带情绪、开心时乐于分享。 (`server/hermes_gateway_server.py`)
- **人格可调整 + 设定初始状态**: 后端新增 `PUT /api/core/soul/personality`（六维手动设定 / `reset=true` 恢复默认 0.5，设定后情绪基线自动跟随）；PersonalityPage 加「编辑」（六维滑块）「保存」「恢复初始」。 (`server/core/api_server.py`, `src/services/coreApi.ts`, `src/settings/pages/models/PersonalityPage.tsx`)
- **情绪/人格系统合并为一套 + 双向影响打通**: 后端 core 服务成为单一事实源（SQLite + 引擎），前端 useEmotion 初始化和事件与后端同步（离线自动降级本地）。具体：
  - **人格→情绪**：`get_state` 读 HEXACO → `pad_baseline_influence()` 作为 `EmotionState.baseline`，每次读取向人格基线 `drift()` 回落并持久化；回落速率人格化（情绪性高→回落慢，0.01~0.05）
  - **情绪→人格**：`process_event` 自动触发 `apply_drift_from_event`（正向互动→诚实-谦逊/宜人性微升；负面→情绪性升/宜人性降；学习→开放性升），HEXACO 随使用缓慢漂移
  - **时间节律**：`get_state` 叠加 `CircadianRhythm` 影响（±15%，仅展示不写库）
  - **前端桥接**：新增 `src/services/emotionBackendMap.ts`（PAD/mood→本地 emotion/mood 映射）；`useEmotion` 初始化读 `GET /api/core/heart/emotion`、事件 `POST /api/core/heart/emotion/event` 双写
  - 详见 `docs/emotion-personality-system.md`（含 PAD/OCC 调研与待办：prompt 注入、情绪-记忆耦合）
- **修复人格画像页 toFixed 崩溃（前后端结构不匹配）**: 后端 `/api/core/soul/personality` 返回 `{hexaco: {六维}, description, pad_baseline, updated_at}`，前端却从顶层取 `data.honesty_humility` → undefined → `.toFixed(2)` 崩。`coreApi.getPersonality()` 适配解包 hexaco 并带回 `description`/`pad_baseline`；PersonalityPage 优先采用后端描述与 PAD 基线（缺失时回退前端规则）。 (`src/services/coreApi.ts`, `src/settings/pages/models/PersonalityPage.tsx`)
- **情绪/人格页硬编码中文接入 i18n**: 人格页「中间型人格」「低/高」，情绪页相对时间（刚刚/秒前/分钟前…）与 PAD 三维标签（愉悦/唤醒/支配）全部接入 zh/en。
- **EmotionPage 展示后端内在状态**: 情绪状态页新增「内在状态」区块，通过 `GET /api/core/heart/emotion` 读取后端 `boredom`/`loneliness` 并以进度条展示，让用户可直接看到后端持久化数值的变化。 (`src/settings/pages/models/EmotionPage.tsx`, `src/i18n/locales/zh-CN.json`, `src/i18n/locales/en-US.json`)
- **新增情绪与人格系统分析文档**: `docs/emotion-personality-system.md`——梳理前端 useEmotion 与后端九维/HEXACO 两套体系、事件→数值变化链路，并基于 PAD/OCC 三层模型调研给出 7 项优化建议（人格→PAD 基线回路、漂移触发接线、半衰期衰减等）。**结论：九维情绪是活的，HEXACO 人格只读不漂移（drift 端点前端零调用）**。
- **修复悬浮球窗口仍出现在任务栏**: 根因是 tao 的 `skip_taskbar`（构造期与 JS `setSkipTaskbar`）走 `ITaskbarList::DeleteTab`，窗口未注册进任务栏或重新显示时存在时序失效。改为 Rust 侧 Win32 方案：新增 `force_hide_from_taskbar` 命令，直接设置 `WS_EX_TOOLWINDOW` 并清除 `WS_EX_APPWINDOW`（APPWINDOW 会覆盖 TOOLWINDOW），窗口样式持久生效。 (`src-tauri/src/lib.rs`, `src/components/Pet/ControlsOrb.tsx`)
- **插件市场 roadmap 记录**: 市场数据源（GitHub 仓库 `huankun05/desk-pet-registry`）待建，实现步骤写入 `docs/known-warnings-and-roadmap.md`；顺带把 ESLint 74 警告清零状态同步进该文档。
- **修复角色位置重启后漂移（多显示器）**: 根因是前端 `invoke('clamp_window_position')` 调用的命令在 Rust 侧**不存在**，恢复位置时总是走 `window.screen`（仅主屏）fallback——副屏/贴边位置会被错误拉回主屏。修复：①Rust 实现 `clamp_window_position`（Win32 `EnumDisplayMonitors` 枚举所有显示器 work area，优先 clamp 到包含窗口中心的显示器，宽容允许贴边半隐藏）；②前端按 `devicePixelRatio` 物理像素换算传参/取回。 (`src-tauri/src/lib.rs`, `src-tauri/Cargo.toml` 加 `Win32_Graphics_Gdi` feature, `src/hooks/useWindowManager.ts`)
- **市场页 404 友好提示**: registry 数据源（GitHub 仓库 `huankun05/desk-pet-registry`）当前不存在导致 `fetchRegistry` 404；前端将 404 与网络故障区分开，显示「插件市场数据源尚未配置」而非裸报错。 (`src/settings/pages/marketplace/MarketplaceIndex.tsx`, i18n)
- **修复设置页「市场」路由 404**: 市场页归入「扩展」板块后，树条目 path 与导航目标仍指向 `/settings/marketplace`，但 `buildChildRoutes` 按嵌套生成的实际路由是 `/settings/extensions/marketplace` → 点击 404（浏览器实测确认）。统一改为嵌套路径（tree path + loader key + ExtensionsIndex 卡片 + PluginsPage「去市场」跳转）。 (commit `ed5a770`)
- **按窗口代码分割（React.lazy）**: `src/App.tsx` 四个窗口组件改为 `lazy()` 动态加载，Vite 自动拆独立 chunk——主 bundle 由单文件 736.94 kB 拆为 `MainPetApp 301.75 kB` / `ChatPanelWindow 389.23 kB` / `StatusPanelWindow 15.15 kB` 等，每个 webview 只下载自己窗口的代码（Live2D/vosk 不再进面板窗）。
- **跨窗情绪同步迁 Tauri 事件**: 新增 `src/services/emotionSync.ts`（事件常量 + `normalizeEmotionState` 规整逻辑）；主窗 `MainPetApp` 情绪变化时 `emit('deskpet:emotion-changed')`，状态面板由 2s 轮询改为事件监听 + 30s 低频兜底（防事件失效），同步更及时、省常驻 interval。 (`src/services/emotionSync.ts`, `src/MainPetApp.tsx`, `src/components/Status/StatusPanelWindow.tsx`)
- **性能分析文档更新**: `docs/performance-optimization.md` 记录本轮 5 项落地成果，并将 vosk chunk（5.78 MB）、统一轮询调度器、tauriEnv 共享 chunk（417 kB）等列入后续优化计划。
- **74 个 ESLint 警告清零 + Prettier 统一**: 按五类规则清零 warning（`no-unused-vars` 14 / `no-explicit-any` 25 / `exhaustive-deps` 4 / `react-hooks/set-state-in-effect` 19 / `react-refresh/only-export-components` 12）。抽离 `src/components/Chat/favorites.ts` 与 `src/settings/pages/models/interactionConfig.ts` 消除组件+工具混合导出；Confirm/Toast/routes 强耦合处加针对性豁免；`eslint.config.js` 启用 `allowConstantExport`。`npm run lint` / `typecheck` / `format:check` 三绿。 (commit `0342ad7`)
- **修复悬浮球（控制面板按钮）残留任务栏窗口**: `controls` 窗口构造期 `skipTaskbar: true` 在部分环境不生效，悬浮球挂载时显式 `getCurrentWindow().setSkipTaskbar(true)` 强制移出任务栏（`setSkipTaskbar` 为 `Window` 类方法，`WebviewWindow` 实例无此方法）。 (`src/components/Pet/ControlsOrb.tsx`)
- **气泡状态跟随角色**: ①锁定态——锁定走窗口级 `setIgnoreCursorEvents(true)` 实现整窗穿透，气泡保持可见并随整窗一起点击穿透（与角色一致），不再被隐藏；②悬停淡出——气泡与角色同步挂 `fading` 类，跟随 `--fade-opacity` 一起透明；③长文本——`.chat-bubble-content` 由 `nowrap+ellipsis` 改为 `white-space:normal` 完整换行显示，`.bubble-zone` 高度自适应向上展开。 (`src/MainPetApp.tsx`, `src/App.css`)
- **定时任务调度器智能化**: `src/services/cron/manager.ts` 重写——①**精确调度**：cron 任务由「每分钟轮询」改为 `nextCronTime()` 算出下一次触发点 `setTimeout` 到点触发并自动重新排程（空闲时不再周期性唤醒，降 CPU）；②**防重入**：同一任务上次未跑完则不重复触发；③**失败指数退避**：连续失败按 15s→30min 指数退避，成功即重置；④**错过补偿**：应用关闭期间错过的持久化任务（24h 内）启动时只补跑一次，避免堆叠轰炸；⑤**自定义 handler 持久保留**：enable/disable/update 后不再丢失插件注册的 handler；⑥**抖动**：interval 首周期加小随机延迟防惊群；⑦补全 `nextRunTime` 计算（设置页「下次运行」时间现在有真实值）；⑧`removeJob` 由仅停止改为彻底删除。 (`src/services/cron/manager.ts`, `src/services/cron/types.ts`)
- **修复久坐提醒插件全局监听泄漏**: `onTerminate` 现在会 `removeEventListener` 移除 `mousemove`/`keydown`/`click` 三个活动监听器（原先开关一次即永久残留）。 (`src/services/skills/plugins/sedentaryReminder.ts`)
- **性能优化：主窗光标轮询门控**: `useWindowManager` 每 200ms 的 `get_cursor_window_info` Rust IPC 查询在未开启「悬停淡出」时整体跳过（默认省 5 次/秒系统调用；锁定/变换态穿透由 effect 依赖重新设置，无需轮询）。 (`src/hooks/useWindowManager.ts`)
- **依赖与文件清理**: 移除 6 个 `src/` 内零引用的依赖（`framer-motion`、`@heroui/react`、`@tanstack/react-virtual`、`zustand`、`react-hot-toast`、`@iconify-json/solar`）及 `vite.config.ts` 对应的空 `vendor-motion` chunk，双锁文件（`pnpm-lock.yaml` / `package-lock.json`）同步更新；删除 4 个无路由/无 loader/无引用的孤儿设置页（`BackupPage`、`GrowthPage`、`PluginBuilderPage`、`PluginMarketPage`，git 历史可恢复）；清理根目录与 `logs/` 的临时开发日志。分析文档见 `docs/performance-optimization.md`。
- **Lint 警告清理（92→74）**: 清理大量未使用导入/variable（`SlashCommand`、`eventBus`、`LogicalPosition`、`handleSlashHelpToggle`、`PANEL_INNER_W`、`prevMode`、`MODE_CHANGED_EVENT`、`guideTitle`、`guideIntro`、`idPrefix`、`ServiceSetupGuide`、`RiskLevel`、`CapabilityGroup`、`pluginRegistry`、`registerBuiltinPlugins`、`pluginConfigManager`、`PluginMetadata`、`PluginConfigProperty`、`isToolDisabled`、`registerBuiltinTools`、`useEffect`、`useState`、`Section`、`Switch` 等）；修正误删导入导致 TS 报错（`RiskLevel`、`useEffect`、`registerBuiltinTools`）；禁用不匹配的 `react-hooks/preserve-manual-memoization` 规则；修复 `audioFiles.ts` regex 多余转义；修复 `PermissionManager.ts` 无用数组初始化。 (`src/components/Chat/ChatPanelWindow.tsx`, `src/settings/components/ServiceWizard.tsx`, `src/settings/pages/extensions/PluginsPage.tsx`, `src/settings/pages/extensions/ToolsPage.tsx`, `src/hooks/usePanelWindows.ts`, `src/components/Pet/ControlsOrb.tsx`, `src/services/permission/capabilities.ts`, `src/settings/components/Toast.tsx`, `src/settings/components/Confirm.tsx`, `src/settings/pages/chat/ChatModesPage.tsx`, `eslint.config.js`, `src/services/audio/audioFiles.ts`, `src/services/permission/PermissionManager.ts`)
- **Proactive Chat 统一调度**: 所有主动 LLM 消息统一通过 `proactiveScheduler` 调度；`useInteraction.ts` 空闲定时器降为 45s–105s 并降低触发概率；`MainPetApp.tsx` proactive 触发时注入 emotion/mood/recent topics 场景感知提示词；新增 `aiService.proactiveChat()` API 供自定义主动消息使用。
- **TTS 全链路走大脑调度**: 所有 TTS 路径（主聊天、流式、主动、交互预生成）统一改为 `synthesizeViaBrain`，移除直接 `provider.synthesize()` 调用；`InteractTTS`、`streaming-tts.ts`、`pipeline/stages/tts.ts` 全部对齐。
- **成长记忆查看页**: 新增「记忆体 → 成长记忆」（`/settings/memory/growth`，`GrowthPage.tsx`），可查看/删除/手动添加记忆（网关不可用时提示）。

### Added

- **Gateway Tool Loop**: 新增服务端多轮工具执行链路，backend tools + frontend tools 混合执行；Gateway 直接驱动 LLM tool_calls 多轮循环，前端不再单独维护 tool loop。
- **Frontend Tool Protocol**: 新增 `tool:execute` / `tool:result` WebSocket 协议，Gateway 可下发前端工具调用，ChatPanelWindow 执行后回传结果。
- **Backend Tool Executor**: 新增 `server/hermes_gateway_tool_executor.py`、`server/hermes_gateway_backend_tools.py`，支持在 Gateway 内注册/执行 backend tools，默认包含 `echo` 与 `get_current_time`。
- **Tool Loop Runner**: 新增 `server/hermes_gateway_tool_loop.py`，封装多轮工具调用、frontend/backend 分发、结果回传 LLM 的完整循环。
- **前端工具透传**: `useHermesGateway.ts` 发送消息时附带当前启用的 frontend tool schema；`ChatPanelWindow` 监听 `tool:execute` 并调用本地 `toolRegistry.execute()` 回传结果。
- **Embedding 服务配置页**: 新增 `/settings/services/embedding` 独立页面，支持添加/编辑/删除 Embedding 配置，含 API Base/模型/Key 输入、测试连接按钮、ProviderStatusBadge 状态展示，与 LLM/TTS/STT 服务页结构一致
- **Embedding Provider 实现**: 新增 `OllamaEmbeddingProvider` 和 `OpenAIEmbeddingProvider`，支持本地 Ollama 与云端 OpenAI 兼容接口的向量模型接入
- **ProviderManager Embedding 支持**: 扩展 `ProviderManager` 支持 `embedding` 类型，新增 `embeddingSlot`、`activeEmbeddingId`、`setActiveEmbeddingProvider()`、`getActiveEmbeddingProvider()` 方法
- **多模态视觉优先级配置**: `MultimodalPage` 新增 `visionSourcePriority` 字段，支持 `auto`/`manual` 模式，区分自动检测与手动标记的原生多模态模型
- **混合检索摘要卡片**: `BehaviorPage` 的混合检索区块改为摘要卡片 + 跳转按钮，指向 Embedding 服务配置页
- **Provider 连通性测试补齐**: Embedding 服务页新增测试连接功能，支持实时检测 provider 可用性
- **Splash WebGL 预热**: `index.html` 中新增隐藏 canvas + 原生脚本预热 WebGL 上下文；`useSplashInit` hook 进一步编译最小着色器程序，提前唤醒 GPU 驱动/着色器编译器
- **预热上下文复用**: `initLive2D()` 和 `LAppGlManager.initFromCanvas()` 支持传入外部 WebGL 上下文；首屏初始化时优先复用 splash 预热上下文，避免重复创建上下文导致的冷启动延迟
- **启动队列**: `useStartupQueue` hook 提供 P0-P3 优先级调度，MCP 自动连接、Behavior 系统初始化等非关键任务延后到首屏空闲时执行
- **模型预加载与配置缓存**: `usePetModel` 新增配置默认值 fallback，优先读取本地缓存，减少首屏解析开销
- **聊天窗口 UI 重写（仿 QQ 风格）**: 将控制面板聊天窗口重写为现代、干净、浅色为主的 QQ 风格——圆角气泡 + 气泡尾、顶部上下文栏 → 消息列表 → 输入区（附件 / 语音 / TTS 开关）；消息 hover 出操作栏、语音按钮开始录音、模式切换有明确反馈。所有对话、收藏、主题、字体大小持久化，后端统一走 Gateway
- **聊天设置拆分为五个清晰分区**: 聊天设置作为独立入口，内部含「外观 / 输入 / 语音 / 模式 / 会话与数据」五个分区。外观页涵盖头像（AI 默认桌宠形象、用户可上传）、气泡（圆角 / 气泡尾 / 字号）、聊天背景、配色（浅色为主 + 可切深色 + 强调色预设）并带实时预览；会话与数据页管理历史会话、收藏消息与数据清理。各分区可一键跳转到外观气泡、全局主题、模型等关联设置页
- **聊天外观独立配置体系**: 在 `appearanceConfig.ts` 新增全套 `chat*` 键（`chatTheme` / `chatAccent` / `chatBubbleRadius` / `chatBubbleTail` / `chatShowAvatar` / `chatUserAvatar` / `chatAiAvatar` / `chatFontSize` / `chatBackgroundImage`），与桌宠头顶气泡、应用全局主题完全解耦；`writeAppearanceConfig` 写入后通过 Tauri `CHAT_APPEARANCE_EVENT` 跨 webview 实时同步，`useChatAppearance` 三通道订阅（storage 事件 + Tauri 事件 + 窗口聚焦）
- **聊天主题 CSS 与头像组件**: 新增 `chat-theme.css`（`.chat-root` 变量、`.chat-bubble--user/ai`、气泡尾 `::after`、`.chat-chip--pop` 动画）与 `ChatAvatar.tsx`（role 区分 user/assistant/system，支持上传、AI 默认桌宠渐变 + `solar:cat-bold`）
- **自学习成长能力（仿 Hermes）**: 新增 `server/hermes_gateway_memory.py` 记忆主仓库（独立 `data/memories.db`，类别 preference/fact/feedback/rule，支持 add/recall/list/delete/clear），每轮对话后异步用 LLM 抽取值得记住的事实写库；`_handle_chat` 在生成前召回相关记忆并注入 `<memory-context>` 块进 system prompt。新增 `GET/POST/DELETE /api/gateway/memory` 与 `GET /api/gateway/mode-tools` REST 端点。
- **工具 / 技能 / MCP 可视化管理**: 新增设置页「扩展 → 工具」（`/settings/extensions/tools`，`ToolsPage.tsx`），分组列出前端/后端/MCP 工具，每项可开关启用/禁用（禁用态存 `localStorage.deskpet_disabled_tools`，经 `src/services/tools/toolManagement.ts`，后端 `_handle_chat` 双层过滤），并显示 chat/work 可用性徽章；含技能/MCP/插件入口。
- **成长记忆查看页**: 新增「记忆体 → 成长记忆」（`/settings/memory/growth`，`GrowthPage.tsx`），可查看/删除/手动添加记忆（网关不可用时提示）。
- **聊天窗口 AI 状态条**: `ChatWindow` 顶部新增 AI 状态指示（正在思考 / 正在回复 / 正在调用工具：联网搜索·获取时间…），订阅 `eventBus` 的 `hermes:token` / `tool:call` / `tool:result` / `hermes:done`，悬浮窗与面板共用；含中英文 i18n 与 `.ai-status-bar` 主题样式。 (`src/components/Chat/ChatWindow.tsx`, `src/components/Chat/chat-theme.css`, `src/i18n/locales/zh-CN.json`, `src/i18n/locales/en-US.json`)
- **后端分发模块（打包即能跑）**: 新增 `src-tauri/src/backend.rs`，打包后 `server/` 随 Tauri resource 分发，首次运行复制到 `%APPDATA%/com.lihuankun.desk-pet/backend/`（只读 resource 不可写），并按优先级复用本机已有 Python 或新建 venv 并 `pip install`；`tauri.conf.json` 的 `bundle.resources` 设为 `["../server", "../dist"]`，权重与 venv 由 `.tauriignore` 剔除。 (`src-tauri/src/backend.rs`, `src-tauri/tauri.conf.json`, `src-tauri/.tauriignore`)
- **服务配置向导 + 空状态指引**: 新增通用 `ServiceWizard`（3 步：选引擎 → 填信息+选权重位置 → 测试连接+完成）与 `ServiceSetupGuide` 空状态指引，统一应用于 TTS / LLM / STT / Embedding 四个服务页；注册 TTS 后自动拉起后端（`serviceLauncher.ts`）。 (`src/settings/components/ServiceWizard.tsx`, `src/settings/components/ServiceSetupGuide.tsx`, `src/services/provider/serviceLauncher.ts`, `src/settings/pages/services/*.tsx`)
- **原生文件夹选择器**: 引入 `tauri-plugin-dialog`（Rust `rfd` 调用 OS 原生对话框），`src/utils/pickFolder.ts` 封装并守卫 `isTauriEnv()`；Rust 侧注册插件 + `capabilities/default.json` 授予 `dialog:default`/`dialog:allow-open`。 (`src/utils/pickFolder.ts`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `src-tauri/Cargo.toml`, `package.json`)
- **CosyVoice TTS 后端**: 新增 `server/cosyvoice_server.py` 与前端适配器 `src/services/provider/tts/cosyvoice.ts`，补全第三套语音合成引擎。

### Changed

- **人格可视化页面（PersonalityPage）**: 新增 `src/settings/pages/models/PersonalityPage.tsx`，基于 HEXACO 六维人格展示雷达图、PAD 基线与人格描述；新增路由 `/settings/models/personality` 与 ModelsIndex 卡片；补充 `PersonalityPage.test.tsx` 单测。 (`src/settings/pages/models/PersonalityPage.tsx`, `src/settings/routes.tsx`, `src/settings/pages/models/ModelsIndex.tsx`, `src/i18n/locales/zh-CN.json`, `src/i18n/locales/en-US.json`)
- **离线降级阻断**: 在 `useHermesGateway.ts sendMessage`、`MainPetApp.tsx proactiveScheduler`、`services/ai.ts` 3 个 AI 入口增加 `isOfflineModeEnabled()` 检查；断网时 AI 功能静默禁用并弹出 toast/气泡提示；`eventBus` 新增 `offline:changed` 事件类型。 (`src/hooks/useHermesGateway.ts`, `src/MainPetApp.tsx`, `src/services/eventBus.ts`, `src/services/ai.ts`)
- **测试覆盖补充**: 新增 `useHermesGateway.test.ts` 覆盖离线模式拦截与 `sendMessage` 行为；新增 `PersonalityPage.test.tsx` 覆盖页面渲染与 i18n。 (`src/hooks/useHermesGateway.test.ts`, `src/settings/pages/models/PersonalityPage.test.tsx`)
- **双引擎残留清理**: 全项目搜索确认 `useChatPipeline` / `ChatPipeline` 零引用，旧双引擎代码彻底清除。
- **修复聊天设置错误跳转**: 原 `ChatGeneralPage` 误跳 `/settings/appearance/bubble`，已删除并以 `ChatAppearancePage` 取代；同步将 `GeneralPage` 中 `/settings/chat/general` 修正为 `/settings/chat/appearance`，并在外观页明确提示「聊天窗口外观与桌宠气泡、全局主题互不影响」
- **`createStorage` 改为每次 set 立即写盘**: 移除原 1s 防抖，避免窗口关闭时配置丢失（`storage.test.ts` 同步更新断言为「无防抖」）
- **国际化补齐**: 新增 72 个 `settings.chat.*` 键（中英文对称）、`app.close`、`chat.attachment`；移除 6 个废弃键（`general_title` 等）

- **ProviderSlot abort 约束放宽**: 将 `abort()` 改为可选 `abort?()`，避免 EmbeddingProvider 等无 abort 实现的类型报错
- **zh-CN.json 修复**: 修复 JSON 语法错误，使用 json5 解析并重新序列化，确保 Vite 正常加载国际化文件
- **Provider 创建逻辑增强**: `createProviderFromConfig` 补全 embedding 分支，自动根据 API Base 选择 Ollama 或 OpenAI 适配器
- **设置重组：记忆相关项迁出行为页**: 将「上下文管理」「本地长期记忆（RAG）」「LLM 增强记忆抽取」「混合检索」四项从 `BehaviorPage`（角色行为）迁移至独立的「记忆体」分区，新增 `ContextPage`（`/settings/memory/context`）与 `LongTermPage`（`/settings/memory/long-term`）；行为页不再保留跳转入口，记忆体索引页与环境变量配置同步更新。混合检索摘要卡片原位于 `BehaviorPage`，现归属 `LongTermPage`
- **i18n 归位**: 上述四项文案从 `settings.models` 下迁移至 `settings.memory` 命名空间（`zh-CN.json` / `en-US.json` 各 49 key 对齐）

- **市场页重构（去嵌套 + 归入扩展）**: 原「市场」为设置树顶级独立项，且页内「插件」tab 直接套用 `PluginMarketPage`（其自身还有「插件 / MCP 预设」二级 tab），导致双层嵌套、插件与 MCP 预设混显。现改为：①`MarketplaceIndex` 完全重写，三个顶级 tab（插件 / MCP 预设 / 技能）各自独立渲染内容，零嵌套；②市场从顶级移入「扩展」板块（`settingsTree` 的 extensions children，order 4），`ExtensionsIndex` 列表补充「市场」入口卡片；③「扩展 → 插件」保留「去市场」跳转卡片。 (`src/settings/pages/marketplace/MarketplaceIndex.tsx`, `src/settings/pages/extensions/ExtensionsIndex.tsx`, `src/settings/pages/extensions/PluginsPage.tsx`, `src/settings/routes.tsx`, `src/i18n/locales/zh-CN.json`, `src/i18n/locales/en-US.json`)
- **移除 VoxCPM2**: 删除 `server/voxcpm/`（含 conf/src/training 等）、`server/voxcpm_server.py` 与前端适配器 `src/services/provider/tts/voxcpm.ts`；权重与训练代码不再随项目维护。
- **运行时路径全部去 `CARGO_MANIFEST_DIR`**: gateway 重启 / 启动线程 / provider 自启 / 模型检查 / 管理页静态资源（`dist/admin.html`、`/assets/*`）原先写死构建机路径，已全部改为运行时 `resource_dir()` 解析，并保留 dev 回退。 (`src-tauri/src/lib.rs`, `src-tauri/src/admin_server.rs`)
- **`manager.updateProvider` 放宽**: 签名纳入 `EmbeddingProviderConfig`，Embedding 编辑态可正常持久化。 (`src/services/provider/manager.ts`)

### Fixed

- **角色说话被误判为用户消息（聊天 role 契约 bug）**: 插件（`DailyGreeting` / `Pomodoro` / `WaterReminder` / `EyeCare` / `SedentaryReminder` / `WatchTogether`）通过 `say()` 开口时，原实现误走 `handleSendMessage`（`role: 'user'`），导致角色的问候/提醒/评论显示在右侧蓝色「用户」气泡里（如「晚安~明天又是美好的一天！」被当成用户发的）。新增 `useHermesGateway.injectAssistantMessage()`（直接创建 `role: 'assistant'` 消息、持久化并跨窗同步），`usePluginSystem` 的 `say` 改为优先走该路径。 (`src/hooks/useHermesGateway.ts`, `src/hooks/usePluginSystem.ts`, `src/MainPetApp.tsx`)
- **聊天回复过慢**: 聊天模式向 StepFun 传入过宽的 `web_search` 描述（「某个概念是什么」过宽）且 system prompt 缺工具使用约束，导致闲聊（如「你好」）也被模型强制先调工具再生成。收紧 `web_search` 描述（只用于实时/最新信息，并显式列出「不要用于」场景）+ 新增「默认不调用工具，仅实时信息才用」的 system prompt 原则。 (`server/hermes_gateway_server.py`, `server/hermes_gateway_tool_loop.py`, `src/services/tools/builtins.ts`)
- **发送消息光标闪动**: 移除流式消息末尾的 `▋` 闪动光标（纯视觉噪音，无信息量）。 (`src/components/Chat/MessageItem.tsx`, `src/index.css`)
- **角色靠边放置重启位置偏位**: `edgeSnap` 默认开启，拖到边缘会吸附贴边，但吸附动画期间 `onMoved` 被拦截，存的是吸附前的释放点；启动时恢复该点却未重新吸附。现把吸附动画抽为顶层 `snapToEdge`，动画结束保存吸附后最终坐标，启动若贴边则重新 `snapToEdge(...)`。 (`src/hooks/useWindowManager.ts`)
- **悬浮球启动在边上但不吸附**: `restorePos()` 只设 `dockRef.current = edge` 却未调用 `applyDockLayout()`，半隐藏停靠布局未生效，须等 hover 触发。现贴边时直接 `applyDockLayout()` 应用停靠态，自由态清 `dockRef` 并恢复阴影。 (`src/components/Pet/ControlsOrb.tsx`)
- **手势/面部识别依赖缺失**: 运行环境缺 `mediapipe`（手势/面部追踪底层库），仅补装 mediapipe 本体（`--no-deps`，复用现有 opencv），未重下 torch/funasr。感知模块 `hand_tracker`/`face_tracker` 现已可正常加载。 (`server/requirements.txt`, 环境侧)
- **首次运行后端安装进度可见性**: 监听 `backend:install-*` 事件弹 toast，避免打包后首次 `pip install`（torch/funasr 等数 GB）期间看似卡死。 (`src/hooks/useHermesGateway.ts`)

- **Embedding 添加失败**: 修复 ProviderManager 不支持 embedding 类型导致添加失败的问题
- **zh-CN.json 解析错误**: 修复 Vite 报 `position 5310` JSON 语法错误，恢复应用正常加载
- **React 组件渲染测试（Phase 6 测试补齐）**: 新增 `ChatBubble` + `SettingRow` 组件渲染测试，验证 props 渲染、onComplete 定时回调、title/description 缺省显示。 (`src/components/Bubble/ChatBubble.test.tsx`, `src/settings/components/SettingRow.test.tsx`)
- **5 个功能缺口闭环完成**:
  - 离线模式生效：`src/services/ai.ts` 的 `chat/chatStream/generateProactiveMessage` 读取 `deskpet_offline_mode`，离线时直接禁用 AI 调用
  - 看门狗重启接通 Rust：`watchdog.ts` 通过 `invoke('service_stop/start_raw')` 调用 Rust Tauri command，Rust 侧已有完整实现无需改动
  - 结构化记忆接入 BM25：`extractStructuredMemories()` 抽取的 fact/preference/event 已通过 `upsert()` 进入 BM25 索引，`search()/getContext()` 统一检索
  - Perception 前端降级接入 pipeline：`usePerception.ts` 已有完整链路，WebSocket 断开时自动切 `PerceptionFallback`（鼠标/摄像头降级）
  - emotion_bridge 后端进程自动启动：Rust 已有代码自动拉起 Core API (9877) + Hermes Gateway (8765)，前端 `useBrainBridge.ts` 已接通双向调用
- **i18n 键缺失导致构建失败**: `scan-i18n-keys` 发现 `app.close`、`chat.attachment` 缺失（聊天窗口重写引入），已补入 `zh-CN.json` / `en-US.json`
- **设置项一致性校验通过**: `check-settings-entries` 确认 36 个二级路径 / 36 个 loader / 7 个 Index 页三者一致
- **补充 `settings.chat` 遗漏的中文 i18n 键**: 修复 `ChatModesPage` 使用的 `mode_badge_chat` / `mode_badge_work` / `mode_current_title` / `mode_current_desc` 仅在顶层 `chat` 命名空间定义、缺少 `settings.chat` 定义导致中文界面显示原始 key 串的问题（`zh-CN.json` 补齐，中英文对齐）。

- **控制面板悬浮提示显示原始 key**: `ControlsIsland` 用动态 `t(\`controls.${b.label}\`)` 构造 key，静态扫描漏检，`controls.transform`/`controls.mode` 两 locale 均缺失导致悬浮提示显示 key 串；已补齐中英文
- **Gateway Tauri 启动时 ModuleNotFoundError**: `_tool_executor` 等兄弟模块 import 早于 `sys.path` 插入，导致 Tauri spawn 失败；修正 `sys.path` 插入时机（置于兄弟 import 之前）
- **插件页无限转圈至失败**: GitHub registry fetch 超时（`AbortError`）时无降级，一直加载直到失败；改为超时显示「网络不可达」空状态 + 重试按钮，stats 失败静默降级
- **工具页 / 模式页可用工具显示 (0)**: 设置窗口为独立 webview，从未调用 `registerBuiltinTools()`，导致 `toolRegistry.getAll()` 返回空；`ToolsPage` 与 `ChatModesPage` 现均在 `useEffect` 中显式注册内置工具，正确显示前端 / 后端 / MCP 工具数量与 chat/work 可用性徽章
- **历史会话查看器重构为聊天风格**: 点列表项打开 Modal 查看器，消息以圆形猫头头像 + 时间戳气泡呈现，可滚动、可点击查看详情；清空全部会话新增内联下拉框，可选「仅删除会话」或「同时删除备份」（`invoke('delete_backup_files')`）
- **会话查看器统一桌宠视角**: Hermes 与桌宠已融合为同一人，用户尚未发过消息；移除「我 / AI」角色标签，统一使用猫头渐变头像 + 时间戳，避免角色错乱
- **查看器顶部被截断**: Modal 原 `items-start` + `py-10` 在视口有限时被裁切，改为 `items-center` + `p-4` 垂直居中；查看器内部 `maxHeight` 由 `60vh` 调为 `70vh` 并加 `minHeight`，顶部信息栏 padding 加大
- **清空范围下拉框美化 + 防遮挡**: 原生 `<select>` 的 `<option>` 无法 CSS 美化，替换为自定义 `ScopeSelect` 组件（圆角 / 渐变 / 阴影 / 选中色变化），并用 React Portal 渲染至 `document.body`（`z-[9999]`），彻底避免父容器 `overflow` / stacking context 裁切；选中态取消勾选图标，仅保留颜色变化
- **Modal 标题栏与内容区间距**: children 容器 padding 由 `p-6` 改为 `px-6 pb-6 pt-5`，增加标题栏与内容的视觉呼吸间距
- **Live2D 并行加载与崩溃防护**: `LAppModel.loadAssets` 与动作预加载并行化（首屏冷启动提速）；修复 `_modelSetting` 在并行任务启动前未赋值、`_model.saveParameters()` 在 model 为 null 时崩溃两个边界问题
- **窗口位置恢复可见跳动**: 位置恢复期间隐藏窗口避免可见跳动；改为仅恢复一次并使用缓存的模型信息，避免重复 / 错误重置
- **Live2D 表情从未加载（预览 / 情绪换脸无效）**: 根因为 `_model3Json` 在 `model3Promise.then()` 回调中异步赋值，而表情加载代码同步执行时 `_model3Json` 仍为 `null`，导致 `model3Json` 回退路径永远读不到任何表情（日志表现为 `source = NONE | count = 0`，所有 `setExpression` 静默 no-op）。将 MOC 与表情加载合并进同一个 `model3Promise.then()` 回调，确保进入回退分支时 `_model3Json` 已就绪（nahida 现正确加载 16 个表情）。(`src/lib/live2d/lappmodel.ts`)
- **Brain API 情绪标签大小写不匹配**: `useBrainBridge` 将 Brain API 的 `mood_label`（小写如 `happy`）直接当表情名下发 `expression:change`，而模型里是 `Happy`，导致情绪驱动的换脸静默 no-op；`useLive2D` 现统一经 `resolveVisualForModel(expr, modelKey)` 归一后再 `setExpression`。(`src/hooks/useLive2D.ts`, `src/hooks/useBrainBridge.ts`)
- **表情 / 动作预览调试日志清理**: 移除 `lappmodel.ts` / `lappdelegate.ts` / `useLive2D.ts` 排查期间添加的临时 `console.log`，保留跨窗预览 `deskpet:preview-ack` 回执链路与 modelKey 不匹配告警。
- **「表情与动作」管理页可编辑化 + 多模型门控**: 修复预览时 `modelKey` 不匹配（在 nahida 桌宠上预览 hiyori 动作被忽略）的根因——管理页现只读 `localStorage['desk-pet-current-model']` 判定**当前桌宠所用模型**，仅该模型可编辑/预览，另一模型整段置灰只读，从源头杜绝误改其它模型资产（切换模型后在桌宠控件操作、回本页点「刷新」同步）。新增两项用户可编辑覆盖层（均持久化到 localStorage，零风险不改底层资产）：① **显示别名**——只改列表展示名，底层 model3.json 注册名不变；② **绑定情绪**——下拉把任意表情/动作绑定到 11 种情绪之一，`resolveVisualForModel` / `getNahidaExpression` 解析时优先采用覆盖。 (`src/settings/pages/models/ExpressionsPage.tsx`, `src/services/live2d/visualMapping.ts`, `src/settings/components/Switch.tsx`)
- **「表情与动作」页交互重做（按反馈）**: ① 模型选择由「两栏并列 + 置灰只读」改为**顶部下拉栏选角色**——正在桌宠中使用的角色用 ● 高亮并标「使用中」，其它角色用 ○ 灰显标「未使用」；选中未使用角色时给出提示并禁用预览（预览仅对正在使用的角色生效）。② **修正情绪绑定方向**：原先是「动画去绑情绪」（每行动画挂个情绪下拉），概念倒置；现改为「**情绪 → 表情/动作**」——列出 11 种情绪，每种配一个下拉选它该播放的视觉项。存储层同步由 `视觉→情绪`（`deskpet_emotion_overrides`）翻转为 `情绪→视觉`（`deskpet_emotion_bindings`），`resolveVisualForModel` / `getNahidaExpression` 改为读新键，回归静态默认映射无 override 时行为不变。 (`src/settings/pages/models/ExpressionsPage.tsx`, `src/services/live2d/visualMapping.ts`)

### Changed

- **「表情与动作」页精简重构（按反馈）**: 去掉与「情绪绑定」重复的「表情/动作列表」大区，以及行内「显示别名 / 启用停用 / 用于情绪标签」等冗余控件；页面现在只聚焦两件事——顶部角色下拉栏 + 「情绪→动画」绑定表（每种情绪一行：色点 + 中文名 + 下拉选动画 + 预览按钮）。概念就是「给情绪绑动画」。`deskpet_emotion_bindings` 存储与 `resolveVisualForModel` 解析不变；启用/停用底层逻辑（`deskpet_disabled_visuals` / `isVisualEnabled`）仍在 `useLive2D` 生效，只是本页不再暴露 UI。 (`src/settings/pages/models/ExpressionsPage.tsx`, `src/i18n/locales/zh-CN.json`, `src/i18n/locales/en-US.json`)
- **「表情与动作」页样式统一 + 可折叠库管理（按反馈重做）**: ① 视觉与其它设置页一致——原先的蓝色横幅改为白色 `rounded-2xl` 卡片、内边距加大（`gap-5`/`p-5`）、控件 `rounded-xl`，消除「页边距小 / 圆角不够 / 不统一」的观感。② **修复下拉切换无实时更新**：编辑区抽成 `ModelEditor` 子组件，外层用 `key={selectedModel}` 驱动重挂载，切换角色即重新从 localStorage 初始化绑定/别名/停用状态。③ **新增「动作表情库」可折叠区（默认收起）**：列出该角色全部表情/动作，每行可改名（显示别名）、启用/停用（`Switch`）、预览；**被停用的不会出现在上方「情绪→动画」绑定下拉**（`Default` 基础态恒启用不可禁用）。 (`src/settings/pages/models/ExpressionsPage.tsx`, `src/i18n/locales/zh-CN.json`, `src/i18n/locales/en-US.json`)

- **Hermes 深度融合收尾**: Core API + Hermes Gateway 在 Tauri 启动时已自动拉起；情绪事件通过 `/api/core/emotion/bridge/event` 实时同步到 Hermes SessionDB；记忆双向同步已验证（`useUnifiedMemory.ts` 三路并行检索 + `extractStructuredMemories` 自动抽取）。
- **测试覆盖提升**: 测试总数从 46 提升至 54（+8），覆盖 Provider 连通性 + React 组件渲染。

- **大脑接入（Phase 2）**: `server/core/session_service.py` 将 hermes_core.SessionDB 接入 Core API，新增 8 个会话端点（list/create/get/append/search/delete/stats + FTS5 全文检索）。前端 `coreApi.ts` 补全会话 API。设置页新增「大脑状态」面板（`/settings/system/brain`）：健康徽章、会话/消息统计、记忆统一查询、会话列表管理。 (`server/core/session_service.py`, `server/core/api_server.py`, `src/services/coreApi.ts`, `src/settings/pages/system/BrainPage.tsx`)
- **记忆统一查询层（Phase 3）**: `POST /api/core/brain/search-all` 一次检索同时命中 MemoryFragment 记忆碎片与 Hermes FTS5 会话全文。 (`server/core/api_server.py`, `src/services/coreApi.ts`)
- **身体→大脑事件桥接（Phase 3）**: `src/hooks/useBrainBridge.ts` 将对话消息写入主会话、感知事件（手势/表情/交互）写入 brain-events 会话，App.tsx 全局挂载，Core API 离线时静默降级。 (`src/hooks/useBrainBridge.ts`, `src/App.tsx`)
- **情绪双向绑定（方案 A）**: 新增 Emotion Bridge——desk-pet 身体事件（拍头/摸身/戳脚/手势/表情）通过 `POST /api/core/emotion/bridge/event` 更新汐月九维情绪 emotion.json（节流 5s + 权重 3:7 + 惯性平滑 + 原子写入）；前端定时拉取 `GET /api/core/emotion/bridge/state` 映射 PAD 后发射 `expression:change` 驱动 Live2D 表情（流露强度 ×0.6）。全部参数在 `server/core/emotion_bridge_config.json` 热加载可调。 (`server/core/emotion_bridge.py`, `server/core/emotion_bridge_config.json`, `server/core/api_server.py`, `src/services/coreApi.ts`, `src/hooks/useBrainBridge.ts`)
- **设置页搜索框**: PageHeader 标题右侧新增 `SettingsSearch` 组件，数据源为 `settingsTree`（路由单一真相源），支持按标题/副标题/描述搜索全部设置项，下拉结果点击跳转，↑↓ 选择 + Enter 跳转 + Esc 关闭。 (`src/settings/components/SettingsSearch.tsx`, `src/settings/components/PageHeader.tsx`, `src/settings/components/SettingsLayout.tsx`)

### Fixed

- **circadian 端点缺失**: `/api/core/time/circadian` 方法存在但未注册路由（404），已补充。 (`server/core/api_server.py`)
- **设置页缺失图标批量修复**: 16 个不存在的 Solar 图标名（42 处引用）替换为 `@iconify-json/solar` 本地包中同主题有效图标。涉及设置行右侧大图标（`plugin-bold-duotone`→`widget-5-bold-duotone`、`voice-bold-duotone`→`soundwave-bold-duotone`、`plug-in-bold-duotone`→`plug-circle-bold-duotone`）、侧边导航、Toast 警告、加载 spinner、插件市场分类、存储管理等。 (`src/settings/**`, `src/services/market/generator.ts`, `src/plugins/watch-together/index.ts`)

### Changed

#### Phase 5: 性能、可扩展性与健壮性全面优化

**P0 严重问题修复（6项）**

- **Live2D 模型加载 fetch 错误处理**: `lappmodel.ts` 7处 `fetch().then()` 链添加 `.catch()`，`lapppal.ts` 和 `lappwavfilehandler.ts` 同步修复，避免网络错误时模型加载状态机永久卡死
- **聊天管线初始化错误处理**: `useChatPipeline.ts` 的 `Promise.all([...]).then()` 添加 `.catch()`，初始化失败时记录错误日志而非静默
- **ControlsIsland 事件监听器泄漏修复**: `dragStateRef` 新增 `cleanup` 字段 + `useEffect` 兜底清理，防止组件卸载时 `mousemove`/`mouseup` 监听器永久泄漏
- **Behavior 系统 cleanup 时序竞态修复**: 新增 `behaviorDisposedRef` 标记组件卸载状态，async IIFE 在关键节点检查该 ref，防止监听器和定时器在竞态条件下泄漏
- **useLive2D 待机表情 effect 依赖修复**: 依赖数组补全 `customIdle` 和 `energy`，修复待机表情池和活力值变化时定时器不重建的功能 bug
- **usePerception 表情恢复定时器泄漏修复**: 新增 `expressionTimerRef` 管理定时器生命周期，防止手势快速切换时旧定时器叠加执行

**P1 高风险问题修复（6项）**

- **WebSocket 心跳+指数退避+UI反馈**: `perception/service.ts` 新增 30s 心跳机制（连续 2 次未响应触发重连）、指数退避+抖动（2s→4s→8s→16s→30s）、达到最大重连次数后发射 `perception:disconnected` 事件供 UI 订阅
- **fetch 请求超时机制**: 新增 `utils/fetch.ts` 的 `fetchWithTimeout` 工具函数，为 `usePetModel`、`market/client`、`logger`、`Live2DPage` 的 fetch 请求添加 3-15s 超时
- **Pipeline 调度器错误隔离**: `scheduler.ts` 每个 Stage 的 `process` 调用包裹 try-catch，新增 `onStageError` 回调和 `continueOnError` 选项（默认 true），非致命错误不中断管道
- **关键 `.catch(() => {})` 添加日志**: App.tsx（3处）、useWindowManager.ts（6处）、storage.ts（4处）共 13 处静默 catch 添加 `console.warn` 日志
- **localStorage 写入 try-catch 保护**: `useInteraction.ts`、`themes.ts`（2处）、`usePetModel.ts`（2处）、`StatusPanelWindow.tsx`（2处）共 7 处 localStorage 操作添加 try-catch
- **invoke Promise 添加 .catch()**: `StatusPanelWindow.tsx`（2处）、`ChatPanelWindow.tsx`（2处）共 4 处 Tauri invoke 添加 `.catch()`

**P2 架构改进（8项）**

- **App.tsx 拆分**: 抽取 `usePersonaAutoSwitch` 和 `useAppStorageSync` 两个独立 hook，App.tsx 从 959 行减至约 830 行
- **useChatPipeline 职责拆分**: 抽取 `useSttBridge`（STT 轮询桥）和 `useRagPersistence`（RAG 持久化）两个独立 hook，useChatPipeline 从 484 行减至 437 行
- **ProviderManager 泛型抽象**: 新增 `ProviderSlot<T>` 泛型类封装缓存管理，manager.ts 从 903 行减至 675 行（-25%）
- **EDGE_THRESHOLD 统一**: `useWindowManager.ts` 中 40/30 两个不一致阈值统一为 40
- **Provider 默认端口集中**: 新增 `services/provider/defaults.ts`，9 个 Provider 和 Perception WS 的默认端口统一管理
- **Idle 检测逻辑统一**: 新增 `services/idle/constants.ts`，三处不一致的 idle 阈值（5min/6min/30min）提取为共享常量 `IDLE_THRESHOLDS`
- **settingsStorage 重复定义合并**: 新增 `services/storage/settingsStorage.ts` 共享实例，`usePluginSystem` 和 `useWindowManager` 不再各自定义
- **ThemeProvider context value useMemo 优化**: value 对象和 5 个回调函数分别用 `useMemo`/`useCallback` 包裹，消除消费者无谓重渲染

### Changed

- **TTS Provider setup 竞态修复**: `useChatPipeline.ts` 中 TTS Provider 的 validate + setup 从 fire-and-forget（`.then()`）改为 `await`，确保 TTS 控制器在管道执行前完成初始化，避免首句 TTS 播放失败或竞态异常。
- **感知→情感→行为闭环**: `usePerception.ts` 现在通过 eventBus 发射 `perception:gesture` 和 `perception:face_expr` 事件，使情感系统和行为系统能感知到用户的手势和面部表情。`BehaviorRegistry` 新增 `PerceptionResponseBehavior`，根据手势（👍👎✋✊✌️）和面部表情（happy/sad/angry/surprised）触发差异化气泡反馈。
- **点击/触摸→行为闭环**: `useInteraction.ts` 在用户拍打头部、点击身体、戳脚时分别发射 `interaction:pat`/`interaction:tap`/`interaction:step` 事件。`InteractionResponseBehavior` 根据触摸部位和强度给出不同反馈（轻点 vs 用力 vs 连戳）。
- **VAD→STT 流程统一**: `useVoiceInteraction.ts` 添加 `recordingModeRef` 状态机（idle/manual/auto），防止手动录音和 VAD 自动录音互相冲突。VAD auto-STT 仅在 idle 模式下启动，手动录音同样检查模式。
- **主动行为智能化**: `ProactiveScheduler` 新增 `recordUserMessage`/`updateEmotionTrend`/`getContextHints` 方法，追踪最近 10 条用户消息和情感趋势，使主动问候能感知上下文。

### Added

- **RAG long-term memory pipeline**: BM25-based local document retrieval integrated into chat pipeline. `RAGStage` (after `MemoryStage`) injects relevant history into LLM context. Conversations auto-upsert to RAG index with localStorage persistence. Settings page adds RAG toggle, document count display, and memory wipe. (`src/services/pipeline/stages/rag.ts`, `src/services/rag/engine.ts`, `src/hooks/useChatPipeline.ts`, `src/settings/pages/models/BehaviorPage.tsx`)
- **Behavior system integration**: 5 built-in behaviors (greeting, emotion resonance, idle chat, farewell, favorability milestone) auto-registered to `BehaviorRegistry`. App.tsx constructs `PetContextImpl` and forwards eventBus events (`message:sent/response`, `emotion/favorability/persona:changed`, window focus/blur, 6min idle timer) to `registry.dispatch`. Settings page adds per-behavior enable/disable toggles. (`src/services/behavior/builtins.ts`, `src/App.tsx`, `src/settings/pages/models/BehaviorPage.tsx`)
- **Live2D visual decoration event bus**: `BehaviorDecorateStage` emits `expression:change`/`param:update`/`animation:trigger` events. `useLive2D` subscribes and drives Live2D model expression switching, transient parameter overrides (ParamCheek/ParamAngry with auto-expiry), and animation triggering. (`src/hooks/useLive2D.ts`, `src/lib/live2d/lappdelegate.ts`, `src/lib/live2d/lappmodel.ts`)
- **Emotion/favorability event emission**: `useEmotion` now emits `emotion:changed` and `favorability:changed` events via eventBus when state changes, enabling behavior system and proactive scheduler to react. (`src/hooks/useEmotion.ts`)
- **Persona hot-swap UI (runtime switching)**: ControlsIsland now has a persona picker button (next to model picker) for runtime persona switching without restart. App.tsx integrates `personaHotswap.switchTo()` with bubble greeting and `persona:changed` event subscription. CharacterPage adds "Auto-Switch Rules" section for time-based persona switching (e.g. cheerful persona at 10am, calm at 10pm), persisted to localStorage and synced to `personaHotswap` on startup. (`src/components/Pet/ControlsIsland.tsx`, `src/App.tsx`, `src/settings/pages/models/CharacterPage.tsx`)
- **web_search tool (real implementation)**: Rust backend uses `ureq` to fetch DuckDuckGo HTML endpoint and parse results (title/url/snippet), no API key required. Frontend tool upgraded from stub to real `invoke('web_search')` call. (`src-tauri/src/lib.rs`, `src/services/tools/builtins.ts`)
- **Proactive companion UI activation**: BehaviorPage "智能闲聊" switch now drives `proactiveScheduler` in real-time. App initializes scheduler from behavior config on startup. Pet proactively greets by time-of-day, reminds on long idle, lunch/dinner/late-night care. (`src/settings/pages/models/BehaviorPage.tsx`, `src/App.tsx`)
- CI/CD pipeline (GitHub Actions): lint, typecheck, test, Rust fmt/clippy, Tauri build
- **Perception service integration**: MediaPipe hand (21 landmarks) + face (468 landmarks + iris) + gesture recognition via WebSocket real-time stream
  - Python module: `server/perception/` (hand_tracker, face_tracker, data_processor, gesture_learner, perception_server)
  - Frontend module: `src/services/perception/` (types, service, gestureMapping, hooks)
- **Perception admin page** (`/perception`): camera preview with landmark visualization, gesture/facial expression monitoring, sensitivity tuning
- **Tauri environment safety utility**: `src/utils/tauriEnv.ts` with `isTauriEnv()` and `safeTauriCall()` to prevent crashes in non-Tauri (browser) environments
- **Perception page controls**: camera mirror flip, independent hand landmark / face landmark visibility toggles
- **Settings redesign**: card-based layout with 5 modules (Character, Appearance, Interaction, Service Sources, Memory)
- **Plugin management page**: plugin registry with enable/disable toggles
- **Automation (cron tasks) page**: scheduled task management

### Changed

- **tsconfig lib fix**: Added `ES2022.Error` to `lib` array, resolving 19 `TS2554` errors on `new Error(msg, { cause })` calls that blocked `tsc` and `vite build`. (`tsconfig.json`)
- **App.tsx refactored**: 2141-line monolith split into 8 custom hooks (useEmotion, useWindowManager, useChatPipeline, useVoiceInteraction, usePetModel, usePanelWindows, usePerception, usePluginSystem), reduced to 531 lines
- **Emotion system unified**: merged useEmotion / emotionStore / EmotionEngine into single useEmotion hook with Sigmoid decay algorithm and mood-emotion bidirectional influence model
- **Settings system unified**: removed admin backend and floating panel, retained settings window with multi-provider switching, plugin management, and automation
- **ControlsIsland UI optimization**: replaced undefined CSS variables with concrete color values, switched to light theme (white semi-transparent bg + dark text) for better readability
- **Active state button style**: changed from square to rounded corners (borderRadius: 12px)
- **Live2D preload expanded**: 2 files → 10 files (4 texture PNGs + physics3.json + cdi3.json added), covering the full fetch chain. CubismCore now loads via `defer` instead of blocking.
- **Page title**: "Tauri + React + Typescript" → "Desk Pet"
- Removed debug `border: 2px solid red` from `App.css`
- **Default feetOffset**: 0 → 80, model sits lower so bottom reference line aligns with toolbar top edge
- **Documents merged**: CLAUDE.md + ARCHITECTURE.md consolidated into DEVELOPMENT.md (single source of truth for engineering standards)

### Removed

- **Duplicate IdleChatBehavior**: removed the example `IdleChatBehavior` class from `base.ts` (identical id `builtin.idle_chat` as the real implementation in `builtins.ts`). Updated barrel export in `behavior/index.ts`. (`src/services/behavior/base.ts`, `src/services/behavior/index.ts`)
- **Zustand stores**: removed `src/stores/` directory (6 files: emotionStore, personalityStore, etc.), functionality replaced by useState + localStorage
- **Admin dashboard**: removed `src/admin/` directory, admin functionality to be reworked later
- **Floating settings panel**: removed `src/components/Settings/` directory, unified settings via independent window

### Fixed

- **usePluginSystem deps jitter**: useEffect deps included `emotionState` (updates every 120s decay + every interaction), causing all plugins to be shutdown and re-registered repeatedly. Fixed by holding dependencies in a ref, effect now runs only once on mount. (`src/hooks/usePluginSystem.ts`)
- **usePerception deps jitter**: useEffect deps included `currentEmotion`/`getLive2DEmotion`, causing perception WebSocket to disconnect/reconnect on every emotion change (up to every 3s). Fixed by moving emotion deps to a ref. (`src/hooks/usePerception.ts`)
- **Admin panel 401 in dev mode**: `admin.html` rewritten to load from Vite dev server (port 1420) with HMR, eliminating stale `dist/admin.html` issue. `vite.config.ts` now enables CORS for cross-origin module loading.
- **Live2D slow loading (~10s)**: Root cause was synchronous `setup()` in `lib.rs` that blocked the main Tauri thread — each offline provider port triggered a 2s TCP health check timeout. Fix: auto-start loop moved to `std::thread::spawn`, timeouts reduced (TCP connect 2000→500ms, read/write 1500→500ms, attempt_wait 2000→1000ms). Window now creates immediately, Live2D renders in 2-3s.
- **pnpm 11+ compatibility**: `ERR_PNPM_IGNORED_BUILDS` — esbuild postinstall script blocked by default security policy. Fixed via `pnpm-workspace.yaml` with `allowBuilds.esbuild: true`.
- **Tauri API crashes in browser**: `getCurrentWindow()`, `listen()` etc. return undefined in non-Tauri environments causing cascading failures. Fixed with environment guards and try-catch on all Tauri calls.
- **Provider service start/stop state machine**: `startService` now sets state to `starting` instead of jumping directly to `running`, enabling proper ready-state detection via polling. ProviderCard status badges refactored with unified logic and added `error` state support. Stop button works during `starting` (cancel launch), start button works during `error` (retry).
- **Perception camera mirror**: Horizontal flip applied to canvas rendering so hand/face orientation matches real-world direction.
- **Move function**: Fixed `handlePetMouseDown` using deprecated Tauri API, switched to correct `getCurrentWindow().startDragging()`
- **React Hooks order violation**: Fixed App.tsx hooks being called after conditional return, which violated Rules of Hooks and caused runtime failures
- **ESLint errors**: Fixed all ESLint errors (0 errors, 83 warnings remaining), including:
  - `useVADInteraction.ts`: handleSpeechStart used before declaration → refactored with useRef callback pattern
  - `useVoiceInteraction.ts`: ref assigned during render → moved to useEffect
  - Settings pages: setState in effect synchronous calls → adjusted function declaration order
- **Vite build**: Added `settings.html` to build entry points, removed `admin.html`
- **TypeScript errors**: Resolved all TypeScript compilation errors after refactoring

## [0.1.0] - 2026-06-23

- **成长记忆查看页**: 新增「记忆体 → 成长记忆」（`/settings/memory/growth`，`GrowthPage.tsx`），可查看/删除/手动添加记忆（网关不可用时提示）。

### Added

#### Core

- Live2D character rendering (Nahida .moc3) via Cubism SDK v5 native WebGL2
- Borderless transparent window with drag-to-move and resize
- Lock/penetrate toggle (Ctrl+Shift+D) with tray context menu
- Interactive system: click area detection, idle timer, proactive chat

#### AI & Conversation

- OpenAI-compatible API chat with streaming output & typewriter cursor
- Dual-layer emotion system: Mood + Emotion with Sigmoid decay
- Character personality system with hot-swap at runtime
- Inner monologue (`<think>` tags) with per-sentence emotion analysis
- Multi-session chat history persistence

#### Voice

- Three TTS providers: Edge TTS (free), GPT-SoVITS v2, VoxCPM2
- Two STT providers: FunASR, SenseVoice
- Provider abstraction layer with runtime switching

#### Admin Panel

- React 19 + HeroUI v3 + Tailwind v4 admin dashboard
- Liquid-glass theme with 10 pages + KeepAlive caching
- Token-based authentication for local-only access

#### Engineering

- Onion pipeline (10-stage AsyncGenerator) for message processing
- EventBus + Behavior plugin system with PetContext DI
- MCP protocol client (JSON-RPC over stdio) with ToolRegistry
- Context compression: 3-layer defense (round truncation → LLM summary → half-cut)
- RAG semantic memory (BM25 tokenizer + dual-path retrieval)
- Content safety: Keywords, LengthLimit, RateLimit strategies

#### Backend (Rust)

- Tauri 2.0 desktop framework with transparent overlay window
- Full-desktop eye tracking (GetCursorPos + lerp smoothing)
- Service process manager with auto-restart & exponential backoff
- Network online detection via multi-address TCP probing
- DPAPI-encrypted API key storage
- Structured error handling (thiserror + anyhow)
- Screenshot capture & clipboard integration

#### Quality

- TypeScript strict mode + strictNullChecks enabled
- 32 unit tests (Vitest + jsdom)
- ESLint + Prettier + Husky + lint-staged pre-commit hooks
- i18n (zh-CN + en-US, 152 keys)
- React Error Boundary (top-level + page-level)
