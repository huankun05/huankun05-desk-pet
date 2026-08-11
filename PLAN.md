# 🐱 Desktop Pet - 智能桌面助手

## 技术栈

- **前端**: React 19 + TypeScript + Vite 7
- **桌面框架**: Tauri 2.0
- **Live2D**: Cubism SDK v5 原生 WebGL2（零框架依赖）
- **Cubism Core**: live2dcubismcore.min.js v5（WASM 运行时）
- **AI**: OpenAI-compatible API（可配置）
- **感知服务**: MediaPipe（Hand 21 点 / Face 468 点 / Iris）+ OpenCV + WebSocket 实时流
- **全局快捷键**: tauri-plugin-global-shortcut（Ctrl+Shift+D 切换锁定）

---

## 📊 项目现状分析（2026-07-07）

### 核心优势

| 维度 | 评价 |
|------|------|
| **架构设计** | 三层分离（React / Rust / Python），Provider 插件式抽象，洋葱管道 10 Stage |
| **AI 集成** | 双 LLM（OpenAI+Ollama）、三 TTS（Edge/GPT-SoVITS/VoxCPM）、双 STT（FunASR/SenseVoice） |
| **感知服务** | MediaPipe 手部 21 点 + 面部 468 点 + 虹膜追踪 + KNN 手势分类，独立 WebSocket 实时流 |
| **情感系统** | PAD 三维情绪模型 + 激素系统 + 表达策略；已接入 Session 和 Pipeline，影响 LLM Prompt 与 TTS 风格 |
| **记忆系统** | MemoryFragment + Ebbinghaus 遗忘曲线 + SQLite 持久化 + FastAPI；Scribe/Librarian 已实现并接入 Session/Pipeline |
| **人格系统** | HEXACO 六维人格 + .soul 配置文件 + 人格漂移；已接入 Session 情绪基线 |
| **时间系统** | 昼夜节律 + 重逢机制；已接入 Session 问候 + 时段提示注入 |
| **上下文管理** | 三层防御链（轮次截断→LLM摘要→对半兜底）、82%阈值触发 |
| **行为系统** | 事件驱动 + 过滤器链 + PetContext 依赖注入，借鉴 AstrBot 成熟设计；已接入感知/交互闭环 |
| **管理后台** | 17 页面、液态玻璃主题、HeroUI + Tailwind + Framer Motion |
| **工程工具** | ESLint + Prettier + Husky + lint-staged 已配置 |
| **国际化** | i18next zh-CN + en-US，152键，7组件已改造 |
| **核心交互闭环** | 感知→情感→行为全链路打通：手势/面部→情感共鸣→差异化反馈；触摸→部位检测→行为响应 |

### 当前短板

| 问题 | 严重度 | 说明 |
|------|--------|------|
| **自动化测试覆盖不足** | 🟡 中等 | 已补充 PersonalityPage + useHermesGateway 单测；Provider/行为/Rust 单元测试仍可继续扩展 |
| **大文件单体** | 🟢 已优化 | App.tsx 从 959→830 行，useChatPipeline 从 484→437 行，manager.ts 从 903→675 行 |
| **服务无自动恢复** | 🟢 已优化 | Rust `start_service_watcher` 已具备 crash 检测 + 指数退避自动重启，Python 服务崩溃后自动恢复 |
| **Tauri 打包发布** | 🟡 中等 | CI 已配置（lint/typecheck/test/build），但尚未生成/分发安装包 |
| **内存泄漏与错误处理** | 🟢 已优化 | Phase 5 全面修复：定时器/监听器泄漏、fetch 超时、Pipeline 错误隔离、localStorage 保护 |

---

## ✅ 已完成（Phase 1 ~ Phase 4d）

### Phase 1: 基础交互
- [x] Live2D 角色显示（纳西妲 .moc3）+ 无边框透明窗口 + 拖拽/缩放
- [x] 智能对话（OpenAI API）+ 记忆系统 + 情感系统 + 设置面板
- [x] 锁定穿透（Ctrl+Shift+D）+ 右键菜单 + 工具栏
- [x] 互动系统（点击区域检测/频繁检测/闲聊定时器/久未互动）
- [x] 双层情感系统（心情/情绪/性格/好感度/复合情感/时间感知）
- [x] 持久化系统（双备份 localStorage + Tauri 文件）

### Live2D 引擎迁移 & 渲染修复
- [x] pixi.js → Cubism SDK v5 原生 WebGL2（零框架依赖）
- [x] 全桌面眼神追踪（Rust GetCursorPos + lerp 平滑 + Dead Zone）
- [x] 4 轮渲染修复（scale/translate 累乘累加、feetOffset 传递链等）

### Phase 1.3: 对话增强
- [x] 流式 LLM 输出 + 打字机光标 + 取消流式
- [x] 内心独白系统（`<think>` 标签）+ 聊天记录持久化（多会话）
- [x] 逐句情感分析 + 智能闲聊（LLM 生成，5min 间隔，每日 20 次上限）

### Phase 1.4 ~ 1.6: 架构升级
- [x] Provider 抽象层（Chat/TTS/STT/Embedding + ProviderManager + 配置持久化）
- [x] 三 TTS（Edge 免费/SoVITS 声音克隆/VoxCPM 最佳音质）+ 双 STT（FunASR/SenseVoice）
- [x] 消息管道 + 事件总线 + 会话级 Provider 隔离

### Phase 1.7 ~ 1.8: 管理后台重制
- [x] admin.html (1917行) → React 19 + TypeScript 多页面 + HeroUI v3 + Tailwind v4
- [x] 液态玻璃重设计 + 10 页面 + KeepAlive 缓存

### Phase 2: 代码辅助 + 视觉感知 + 内容安全
- [x] Function Calling 框架 + 语法高亮 + 截屏上下文 + 剪贴板集成
- [x] 内容安全检查（Keywords/LengthLimit/RateLimit 三策略）

### Phase 3: 系统集成 + MCP + 服务管理
- [x] MCP 进程管理器（JSON-RPC over stdio）+ ToolRegistry 桥接
- [x] ServiceManager（TTS/STT 进程生命周期）+ Ollama 联动
- [x] 精简重构（GPT-SoVITS ~238 文件保留，共享 venv，路径可移植）
- [x] 路径审计 + 模型下载 UI（6 项检查 + HuggingFace 自动下载）

### Phase 4a ~ 4d: 高级功能
- [x] P0 上下文压缩（三层防御链 + Token 估算器 + LLM 摘要）
- [x] P0 Live Mode + Proactive 主动行为提示词
- [x] P1 人格系统升级（CharacterProfile + Few-shot + 多层 Prompt 叠加）
- [x] P1 管道洋葱模型（AsyncGenerator + 递归调度器 + Stage 自注册）
- [x] P1+ 情绪系统优化（Sigmoid 衰减 + 心情自恢复 + Boredom 累加器）
- [x] P1+ 运行时性能优化（定时器降频 66% + React.memo + 代码分割）
- [x] P2 多轮工具循环 + 多态 ContentPart + `_no_save` 标记
- [x] P2 插件/行为系统（DeskPetBehavior + BehaviorRegistry + PetContext DI）
- [x] P2 RAG 语义记忆（BM25 中文分词 + 双路检索 + Embedding 预留）
- [x] P2 角色热切换（运行时无重启切换 + 自动规则 + 撤销支持）
- [x] P0~P2 日志 & TTS 面板修复（可及性检查/日志补全/语音列表/情绪预设）

### Phase 4e: 感知服务整合 + 项目整理（2026-07-06）
- [x] 整合 gesture-character 项目到 Desk Pet（MediaPipe 手势/面部识别 + WebSocket 实时流）
- [x] Python 感知模块迁移到 `server/perception/`（hand_tracker/face_tracker/data_processor/gesture_learner/perception_server/config）
- [x] 前端感知服务迁移到 `src/services/perception/`（types/service/gestureMapping/hooks/index）
- [x] import 路径适配（`from config` → `from .config`），移除 UserConfig/LLM/TTS 依赖
- [x] 感知服务保持独立 WebSocket 模块，**未纳入** Provider 请求-响应体系
- [x] `server/requirements.txt` 新增 `mediapipe>=0.10.0`、`opencv-python-headless>=4.8.0`
- [x] 项目瘦身：删除 `venv/` (~4.8GB)、`src-tauri/target/` (~9.1GB)、`dist/`、临时输出文件
- [x] `.gitignore` 新增 `*_output.txt`、`*_result.txt`、`*_out.txt`、`cargo_err.txt` 规则
- [x] 文档合并：CLAUDE.md + ARCHITECTURE.md 合并到 DEVELOPMENT.md（单一工程规范文档）
- [x] pnpm 11+ 兼容：`pnpm-workspace.yaml` 配置 `allowBuilds.esbuild: true`，解决 `ERR_PNPM_IGNORED_BUILDS`
- [x] Tauri 环境安全调用：`src/utils/tauriEnv.ts` + `isTauriEnv()` + `safeTauriCall()`，防止非 Tauri 环境崩溃
- [x] 角色位置调整：默认 `feetOffset` 从 0 → 80，模型底部蓝线与功能栏上方贴合
- [x] 感知调校页面增强：摄像头水平镜像翻转（默认开启）、手部节点/面部节点独立显示开关
- [x] Provider 服务启停逻辑修复：启动状态 `starting` 过渡、状态徽章重构、error 状态处理、取消启动支持

### Phase 4f: 核心交互闭环（2026-07-07）🔥🔥🔥

> **核心主题**：让宠物真正"活"起来——感知用户 → 理解情感 → 做出行为，形成完整的闭环体验

#### 感知→情感→行为闭环
- [x] `eventBus` 新增感知事件类型（`perception:gesture`、`perception:face_expr`）
- [x] `usePerception.ts` 通过 eventBus 发射手势和面部表情事件
- [x] `BehaviorRegistry` 新增 `PerceptionResponseBehavior`：👍开心/👎不开心/✋挥手/✊加油/✌️耶 → 差异化气泡反馈
- [x] 面部表情映射：happy/neutral/sad/angry/surprised/focused → 情绪共鸣

#### 点击/触摸→行为闭环
- [x] `eventBus` 新增交互事件类型（`interaction:pat`、`interaction:tap`、`interaction:step`）
- [x] `useInteraction.ts` 在不同触摸部位发射差异化事件（头部拍打/身体点击/脚部戳击）
- [x] `InteractionResponseBehavior` 根据部位+强度给出不同反馈（轻点→开心回应、用力→委屈、连戳→抗议）

#### VAD→STT 流程统一
- [x] `useVoiceInteraction.ts` 添加 `recordingModeRef` 状态机（idle/manual/auto）
- [x] 防止手动录音与 VAD 自动录音互相冲突
- [x] VAD auto-STT 仅在 idle 模式下启动，手动录音同样检查模式

#### 主动行为智能化
- [x] `ProactiveScheduler` 新增 `recordUserMessage()` 追踪最近 10 条用户消息
- [x] 新增 `updateEmotionTrend()` 追踪情感趋势
- [x] 新增 `getContextHints()` 生成上下文感知提示（低情绪→安慰、高情绪→活泼、最近话题引用）
- [x] 监听 `message:sent` 事件自动记录对话上下文

### Phase 5: 性能、可扩展性与健壮性全面优化（2026-07-30）

> **核心目标**：全面审查并修复性能泄漏、错误处理缺失、架构耦合等问题

#### P0 严重问题修复（6项）
- [x] Live2D 模型加载 fetch 链添加 `.catch()`（7处 + lapppal + lappwavfilehandler）
- [x] useChatPipeline 初始化 `Promise.all` 添加 `.catch()`
- [x] ControlsIsland `mousemove`/`mouseup` 监听器泄漏修复（dragStateRef cleanup + useEffect 兜底）
- [x] Behavior 系统 `behaviorCleanupRef` 时序竞态修复（behaviorDisposedRef 竞态保护）
- [x] useLive2D 待机表情 effect 依赖数组补全 `customIdle`/`energy`
- [x] usePerception 表情恢复定时器泄漏修复（expressionTimerRef）

#### P1 高风险问题修复（6项）
- [x] WebSocket 心跳机制（30s ping + 2 次未响应重连）+ 指数退避 + `perception:disconnected` 事件
- [x] fetch 请求超时工具 `fetchWithTimeout`（usePetModel/market/logger/Live2DPage）
- [x] Pipeline 调度器错误隔离（try-catch + `onStageError` 回调 + `continueOnError` 选项）
- [x] 13 处关键 `.catch(() => {})` 添加 `console.warn` 日志
- [x] 7 处 localStorage 写入添加 try-catch 保护
- [x] 4 处 Tauri invoke Promise 添加 `.catch()`

#### P2 架构改进（8项）
- [x] App.tsx 拆分：抽取 `usePersonaAutoSwitch` + `useAppStorageSync` 两个 hook
- [x] useChatPipeline 拆分：抽取 `useSttBridge` + `useRagPersistence` 两个 hook
- [x] ProviderManager 泛型抽象：`ProviderSlot<T>` 封装缓存管理（903→675 行，-25%）
- [x] EDGE_THRESHOLD 统一（40/30 → 40）
- [x] Provider 默认端口集中到 `services/provider/defaults.ts`
- [x] Idle 检测阈值集中到 `services/idle/constants.ts`（IDLE_THRESHOLDS）
- [x] settingsStorage 重复定义合并到 `services/storage/settingsStorage.ts`
- [x] ThemeProvider context value `useMemo` + 回调 `useCallback` 优化

---

## 🔲 待实现

### Phase 8: ai-companion 核心系统移植

> **来源**：[ai-companion](file:///F:/Work/Create/BOT/ai-companion) PROJECT_SPEC.md
> **移植策略**：Python 服务端算法直接搬过来，前端 UI 按需重写为 React
> **核心价值**：让宠物真正"像人"——情绪会波动、记忆会遗忘、人格会成长、有生物钟

#### 📊 整体进度汇总

| 模块 | 状态 | 说明 |
|------|------|------|
| ✅ 核心算法移植（10 模块） | 已完成 | server/core/ |
| ✅ Core API 服务（FastAPI + SQLite） | 已完成 | 端口 9877 |
| ✅ 前端 API 层 | 已完成 | coreApi.ts + coreTypes.ts |
| ✅ Emotion UI（已迁移） | 已完成 | `settings/pages/models/EmotionPage.tsx`；原 admin EmotionView 已随后台清理 |
| ❌ PersonalityView UI | **缺失** | 后端 HEXACO 在（`services/persona/`），但无前端可视化页面 |
| ✅ 管道集成 | 已完成 | Session 接入 PAD + Pipeline 替换旧 emotion |
| ✅ Rust 自动拉起 core-api | 已完成 | Tauri setup 启动 |
| ✅ 记忆 Scribe + Librarian + Session 注入 | 已完成 | Brain 存储层 + 本地哈希 + 检索/提取接入 Pipeline |

#### ✅ 已移植完成（核心算法层）

> 以下模块的纯算法/数据模型已移植到 `server/core/`，可直接导入使用。
> 前端集成、API 封装、服务层对接仍待后续工作。

| 系统 | 模块 | 状态 | 位置 |
|------|------|------|------|
| **Heart 情感** | PADValues + EmotionState | ✅ 已移植 | `server/core/heart/emotion.py` |
| | HormonalSystem + HormonalEngine | ✅ 已移植 | `server/core/heart/hormones.py` |
| | ExpressionStrategy + ExpressionEngine | ✅ 已移植 | `server/core/heart/expression.py` |
| **Brain 记忆** | MemoryFragment 记忆碎片 | ✅ 已移植 | `server/core/brain/fragment.py` |
| | Ebbinghaus 遗忘曲线 | ✅ 已移植 | `server/core/brain/decay.py` |
| **Soul 人格** | HEXACOPersonality 六维人格 | ✅ 已移植 | `server/core/soul/personality.py` |
| | SoulFile .soul 文件 | ✅ 已移植 | `server/core/soul/soul_file.py` |
| | PersonalityDrifter 人格漂移 | ✅ 已移植 | `server/core/soul/drift.py` |
| **Time 时间** | CircadianRhythm 昼夜节律 | ✅ 已移植 | `server/core/time/circadian.py` |
| | ReunionEngine 重逢机制 | ✅ 已移植 | `server/core/time/reunion.py` |

---

#### Phase 8a: 情感系统升级（Heart）🔥🔥🔥

**三层递进架构：**
```
L3: 表达策略 (ExpressionStrategy)
    ↓ 基于 L1+L2 + 人格配置
L2: 情绪状态 (EmotionState — PAD三维)
    ↓ 受 L1 调制
L1: 激素系统 (HormonalSystem — dopamine/cortisol/oxytocin)
```

**核心设计：**
- **PAD 三维模型**：Pleasure(愉悦) / Arousal(唤醒) / Dominance(支配)，各维度 [-1, 1]
- **激素系统**：多巴胺(愉悦/半衰期5min)、皮质醇(压力/半衰期3min)、催产素(依恋/半衰期10min)
- **激素交互**：高多巴胺→降皮质醇，高催产素→降皮质醇，高皮质醇→微降多巴胺
- **8 种情绪标签**：开心/悲伤/焦虑/平静/兴奋/愤怒/疲惫/温和

| # | 任务 | 来源模块 | 说明 | 估时 | 状态 |
|---|------|---------|------|------|------|
| H1 | **PAD 三维情绪模型** | `src/core/heart/emotion.py` | Pleasure/Arousal/Dominance 三维值；支持 blend/distance/drift | 4h | ✅ 核心算法 + API 完成 |
| H2 | **激素系统** | `src/core/heart/hormones.py` | 三种激素，分泌/衰减/相互作用，驱动情绪波动 | 3h | ✅ 核心算法 + API 完成 |
| H3 | **情绪状态引擎集成** | EmotionStateEngine | Session 接入 PAD + Pipeline 替换旧 emotion | 4h | ✅ 已完成 |
| H4 | **表达策略** | `src/core/heart/expression.py` | 8 种情绪 → 语言风格映射，注入 LLM Prompt | 4h | ✅ 核心算法 + API 完成 |
| H5 | **情感可视化** | `EmotionView.vue` → React 版 | ✅ 已上线（路径迁 `settings/pages/models/EmotionPage.tsx`，原 admin 页清理） | 3h | ✅ 已完成 |
| H6 | **Heart API 端点** | FastAPI 路由 | `GET /heart/emotion` `POST /heart/event` | 2h | ✅ API 完成 |

#### Phase 8b: 记忆系统升级（Brain）🔥🔥

**四层记忆架构（来自 PROJECT_SPEC）：**
```
L1: 记忆碎片 (Fragments) — 事实性记忆，Ebbinghaus 遗忘
L2: 实体 (Entities) — 命名实体（人/地点/事件/爱好）
L3: 叙事 (Episodes) — 合并后的叙事段落
L4: 知识晶体 (Crystals) — 高频验证的永久性事实
```

**检索策略（RRF 混合排序）：**
```
用户输入
  ├─→ Embedding 向量搜索 Top-20（支持 4 种方案 + 自动维度适配）
  ├─→ FTS 全文关键词搜索 Top-20
  └─→ RRF 融合排序（k=60）→ Top-5 注入 Prompt
```

**Embedding 多方案（来自 PROJECT_SPEC）：**

| 方案 | 后端 | 维度 | 特点 |
|------|------|------|------|
| `local_hash` | 本地哈希 | 384 | 零成本，确定性 |
| `nomic_embed_text` | Ollama | 768 | 语义质量高（推荐） |
| `openai` | OpenAI API | 1536 | ada-002 等 |
| `ollama_generic` | Ollama 任意 | 可配 | 灵活 |

| # | 任务 | 来源模块 | 说明 | 估时 | 状态 |
|---|------|---------|------|------|------|
| B1 | **记忆碎片模型** | `src/core/brain/fragment.py` | Fragment 数据结构 + is_permanent 永久标记 | 2h | ✅ 核心算法 + API 完成 |
| B2 | **Ebbinghaus 遗忘曲线** | `src/core/brain/decay.py` | 遗忘公式 + 四阶段（Active/Cooling/Frozen/Tombstone） | 2h | ✅ 核心算法 + API 完成 |
| B3 | **Scribe 提取器** | `server/core/brain/scribe.py` | 从对话中自动提取记忆碎片（规则 + 可选 LLM 提取 + 重要性评分） | 4h | ✅ P0 完成 |
| B4 | **Librarian 检索器** | `server/core/brain/librarian.py` | SQLite LIKE + 本地哈希向量 + 关键词融合，Top-3 注入 Prompt | 3h | ✅ P0 完成 |
| B5 | **Archivist 归档器** | `server/core/brain/archivist.py` | 后台任务：衰减计算 + 过期清理 + 相似记忆合并 + 存储优化 | 3h | ✅ 已完成 |
| B6 | **Hebbian 共激活** | `server/core/brain/hebbian.py` | 相关记忆互相强化（一起被检索到的记忆连接更强） | 2h | ✅ 已完成 |
| B7 | **Embedding 多方案** | `server/core/brain/embedding.py` | local_hash / nomic_embed_text / openai / ollama_generic 全部接入 | 3h | ✅ 已完成 |
| B8 | **记忆管理 UI** | `src/settings/pages/memory/MemoryViewPage.tsx` | 搜索/添加/标记永久/删除/执行遗忘衰减 | 3h | ✅ 已完成 |

#### Phase 8c: 人格系统升级（Soul）🔥

**.soul 文件结构（来自 PROJECT_SPEC）：**
```yaml
name: "角色名"
version: "1.0.0"
personality:
  hexaco:        # 六维人格 (0-1)
    honesty_humility: 0.75
    emotionality: 0.60
    extraversion: 0.70
    agreeableness: 0.85
    conscientiousness: 0.65
    openness: 0.80
  mbti: "ENFJ"
identity:
  age, gender, occupation, interests, speech_pattern, catchphrases
core_values: [...]
```

**人格 → PAD 基线映射：**
- 外向性↑ → 愉悦度基线↑
- 尽责性↑ → 支配度基线↑
- 情绪性↑ → 唤醒度波动↑
- 宜人性↑ → 愉悦度微↑

| # | 任务 | 来源模块 | 说明 | 估时 | 状态 |
|---|------|---------|------|------|------|
| S1 | **HEXACO 六维人格** | `src/core/soul/personality.py` | 六维度 + PAD 基线映射 + 文字描述 | 3h | ✅ 核心算法 + API 完成 |
| S2 | **.soul 角色文件** | `src/core/soul/soul_file.py` | JSON/YAML 格式 + Prompt 文本生成 | 2h | ✅ 核心算法 + API 完成 |
| S3 | **人格基线接入 Session** | `server/core/session.py` | HEXACO 计算 PAD 基线，设置为 EmotionState baseline | 3h | ✅ 已完成 |
| S4 | **人格动态漂移** | `server/core/soul/drift.py` | 长期互动 → 人格微变化，基线约束 ±0.3 | 4h | ✅ 核心算法 + API 完成 |
| S5 | **Soul API 端点** | FastAPI 路由 | `GET /soul/personality` `POST /soul/drift` | 2h | ✅ API 完成 |
| S6 | **人格可视化** | PersonalityView → React | ✅ 已完成：`src/settings/pages/models/PersonalityPage.tsx`，HEXACO 雷达图 + PAD 基线 + 人格描述，路由 `/settings/models/personality` | 3h | ✅ 已完成 |

#### Phase 8d: 时间系统升级（Time）

**昼夜节律对 PAD 的影响：**
- 早晨(6-9): 唤醒度 +0.2，主动系数 0.8
- 白天(9-18): 唤醒度 +0.1，主动系数 1.0
- 傍晚(18-22): 愉悦度 +0.1，主动系数 0.9
- 深夜(22-6): 唤醒度 -0.3，主动系数 0.3

**重逢机制分级：**
- <1h: 刚见过，正常问候
- 1-4h: 分开一会儿，轻微喜悦
- 4-24h: 一天没见，明显喜悦
- 1-3天: 好久不见，强烈喜悦 + 好奇
- >3天: 非常想念，情绪爆发 + 主动分享

| # | 任务 | 来源模块 | 说明 | 估时 | 状态 |
|---|------|---------|------|------|------|
| T1 | **昼夜节律** | `circadian.py` | 时间 → PAD 基线调整 + 主动行为系数 + 表达风格 | 2h | ✅ 核心算法 + API 完成 |
| T2 | **重逢机制** | `reunion.py` | 分离时长 → 问候语 + 情绪突跃 + 事件触发 | 1h | ✅ 核心算法 + API 完成 |
| T3 | **时间感知接入 Session** | `server/core/session.py` | 综合基线 = 人格基线 + 昼夜节律；重逢检测 + 时段提示注入 | 3h | ✅ 已完成 |
| T4 | **纪念日管理** | `anniversaries.py` | 记录重要日期，到点主动提及 | 2h | ✅ 已完成 |
| T5 | **周期性反思** | `reflection.py` | 每日/每周反思 → 整理记忆 + 微调人格 | 1天 | 🔲 远期 |

#### Phase 8e: 认知循环 & LLM 路由（参考架构）

> 来自 PROJECT_SPEC §4.1 认知循环（CogLoop）设计，供 desk-pet 管道系统参考融合。

```
用户消息
  │
  ▼
[1] Perceive  输入标准化 + 通道上下文绑定
[2] Attend    安全预检查 + 情绪识别 + 显著性评分
[3] Think     检索记忆 → 组装 Prompt → 调用 LLM → 流式输出
              ↓ 需工具时触发 ReAct 循环（最多 3 轮）
[4] Reflect   提取记忆碎片 + 更新情感状态 + Hebbian 强化
[5] 返回响应
```

**LLM 分级路由（参考）：**
- Flash → Standard → Pro → Local (fallback)
- 断路器（3 态机保护，自动降级）
- 成本追踪（内置定价表，自动记录调用成本）
- 响应缓存（TTL 1h，相似问题复用）

| # | 任务 | 说明 | 估时 | 状态 |
|---|------|------|------|------|
| C1 | **认知循环与现有管道融合** | 将 CogLoop 映射到洋葱管道 10 Stage 中 | 1天 | 🔲 待评估 |
| C2 | **LLM 分级路由** | Flash/Standard/Pro/Local 分级 + 断路器 | 1天 | 🔲 待评估 |
| C3 | **成本追踪** | 调用成本统计 + 日预算控制 | 0.5天 | 🔲 待评估 |

#### Phase 8f: 梦境 & 好奇心（远期）

> 来自 PROJECT_SPEC，远期愿景，暂不排期。

| # | 任务 | 来源模块 | 说明 | 估时 |
|---|------|---------|------|------|
| D1 | **Dream Engine** | `src/core/dream/` | 后台"做梦"：记忆回放/压缩/结晶 → 生成永久记忆 | 1天 |
| D2 | **好奇心引擎** | `src/core/curious/` | 知识缺口检测 → 主动提问/探索 → 学习新东西 | 2天 |
| D3 | **反思日记** | `reflection.py` | 周期性自我反思 → 更新人格 + 整理记忆 | 1天 |

#### Phase 8h: Open-LLM-VTuber 语音实时性借鉴 🆕

> 参考 [Open-LLM-VTuber](file:///F:/Work/Create/Open-LLM-VTuber) 项目的语音实时交互能力，移植核心特性到 Desk Pet。

| # | 任务 | 说明 | 估时 | 状态 |
|---|------|------|------|------|
| V1 | **流式 TTS 并行合成 + 有序播放** | Pipeline 接入 SentenceDivider，LLM 流式时按句分割，并行 TTS 合成 + 前端有序播放，首句延迟降低 50%+ | 1天 | ✅ 已完成 |
| V2 | **VAD 前端实时检测 + 语音中断** | 前端集成 Silero VAD ONNX 实时检测语音活动 + TTS 播放中可被打断 | 1天 | ✅ 已完成 |
| V3 | **更多 TTS/ASR 引擎适配** | 移植适配器模式，新增 CosyVoice/MeloTTS/Piper + sherpa_onnx/faster_whisper | 0.5天 | ✅ 已完成 |

---

### Phase 8g: 下一步执行计划

| 优先级 | 任务 | 目标文件 | 状态 | 说明 |
|--------|------|----------|------|------|
| P0 | 记忆 Scribe 提取器 | `server/core/brain/scribe.py` | ✅ 已完成 | 规则 + 可选 LLM 提取事实性记忆，生成 MemoryFragment |
| P0 | Librarian 检索器 | `server/core/brain/librarian.py` | ✅ 已完成 | SQLite LIKE + 本地哈希向量 + 关键词融合，Top-3 注入 Prompt |
| P0 | Session 记忆注入 | `server/core/session.py` | ✅ 已完成 | `get_context()` 中调用 Librarian 检索用户输入相关记忆，拼入 system prompt |
| P0 | Pipeline 记忆反思 | `server/core/pipeline.py` | ✅ 已完成 | 每轮对话后调用 `session.reflect_on_exchange()` 保存记忆 |
| P0 | 记忆系统 E2E 测试 | `server/core/tests/test_memory_e2e.py` | ✅ 已完成 | 7 个用例覆盖存储/检索/提取/注入/反思全流程 |
| P1 | MemoryView UI | `src/settings/pages/memory/MemoryViewPage.tsx` | ✅ 已完成 | 后台管理记忆：搜索/添加/标记永久/删除/执行遗忘衰减 |
| P1 | 人格基线接入 Session | `server/core/session.py` | ✅ 已完成 | HEXACO 计算 PAD 基线，作为情绪漂移目标 |
| P1 | 时间感知接入 Session | `server/core/session.py` | ✅ 已完成 | 昼夜节律调整 PAD 基线；重逢检测触发个性化问候 |
| P2 | Embedding 多方案 | `server/core/brain/embedding.py` | ✅ 已完成 | local_hash / nomic_embed_text / openai / ollama_generic 全部接入 |
| P2 | Archivist 归档器 | `server/core/brain/archivist.py` | ✅ 已完成 | 后台遗忘衰减计算 + 过期清理 + 相似记忆合并 + 存储优化 |

---
---

### Phase 9: Hermes + desk-pet 融合 🔥🔥🔥

> 目标：让 Hermes 成为 desk-pet 的"大脑"，直接合体而不是间接接入
> 2026-08-02 | Phase 9a 已完成

#### Phase 9a: Hermes State DB 内核移植 ✅

**已完成**：`server/hermes_core/` 15 个核心模块（约 16,000 行），另含 `__init__.py` 与 `verify.py` 支持文件

| 文件 | 行数 | 说明 |
|------|------|------|
| `hermes_state.py` | 8,569 | SessionDB（state.db 读写 + FTS5 全文检索） |
| `hermes_state_search.py` | 1,907 | FTS5 搜索 mixin |
| `hermes_state_common.py` | 523 | Schema SQL + 共享常量 |
| `hermes_state_schema.py` | 779 | Schema 管理 mixin |
| `hermes_state_portability.py` | 656 | 导入导出/备份 |
| `hermes_constants.py` | 1,242 | 路径解析/平台常量 |
| `hermes_bootstrap.py` | 239 | 启动流程 |
| `hermes_logging.py` | 800 | 异步日志系统 |
| `message_sanitization.py` | 852 | 消息清洗 |
| `sqlite_runtime.py` | 124 | SQLite 工具函数 |
| `sqlite_safe_read.py` | 68 | 连接安全读取（stub） |
| `_subprocess_compat.py` | 439 | 子进程兼容层 |
| `stubs.py` | 53 | memory_manager/skill_commands 最小桩（替代 ~1200 文件） |
| `memory_manager.py` | 4 | stub 转发到 stubs |
| `skill_commands.py` | 16 | stub 转发到 stubs |

**验证通过**（verify.py）：
- `import hermes_core` → SessionDB, SCHEMA_VERSION=23, FTS_SQL
- `get_hermes_home()` → D:\hermes_env\.hermes
- SQLite FTS5 → 支持
- SessionDB → 创建 session ✓ 写入消息 ✓ 读取 ✓ FTS5 搜索 ✓

**关键决策**：不用 `memory_manager.py` / `skill_commands.py` 完整实现，用 `stubs.py` 提供 `sanitize_context` + 两个常量即可，hermes_state 的其余功能（FTS5/Schema/SessionDB）完全独立。

#### Phase 9b: 情绪融合 ✅

**目标**：desk-pet PAD 情感模型 ↔ Hermes context prompt 双向绑定
- [x] Hermes 回复风格随 PAD 情绪变化（通过 `_sync_to_core` 桥接）
- [x] Hermes 情绪事件注入 desk-pet 情感系统（httpx POST 到 Core API）
- [x] 情绪状态通过 Hermes SessionDB 持久化

#### Phase 9c: 大脑接入 ✅
#### Phase 9c: 大脑接入 ✅
**目标**：Hermes Gateway 统一对话与工具执行
- [x] desk-pet 启动时 spawn Hermes Gateway（WebSocket :8765，Rust ServiceManager 自动拉起）
- [x] 前端 `hermesGateway.ts` 实现 WebSocket 客户端（自动重连 + 消息队列）
- [x] 前端 `useHermesGateway.ts` React Hook 提供对话能力
- [x] Hermes 回复 → 流式 token 回调 + 完整响应
- [x] Gateway tool loop：backend tools + frontend tools 混合执行
- [x] 前端工具注册（截图/剪贴板/文件/搜索）透传到 Gateway
- [x] tool:execute / tool:result 前端协议（Gateway 驱动工具调用）
- [x] 后端工具注册器：echo/get_current_time 内置 backend tools
- [x] ChatPanelWindow 监听 tool:execute 并回传 tool:result
- [x] MainPetApp 注册内置前端工具并支持 Gateway tool loop

#### Phase 9d: 记忆/技能/行为融合 ✅

**目标**：
- [x] Hermes 记忆 ↔ desk-pet MemoryFragment 统一查询（`useUnifiedMemory.ts` 三路并行检索）
- [x] Hermes 技能 ↔ desk-pet 行为事件驱动系统 桥接（`hermesSkillsBridge.ts` + `hermes_skills_bridge.py`）
- [x] 技能映射表 `data/hermes_skill_map.json` 热加载 + 10 个内置 slash 命令

#### 融合文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `server/hermes_gateway_server.py` | Python | WebSocket 实时对话网关（FastAPI + LLM 流式） |
| `server/core/hermes_skills_bridge.py` | Python | 技能 → Behavior 事件桥接层 |
| `src/services/hermesGateway.ts` | TypeScript | WebSocket 客户端（自动重连/消息队列/流式回调） |
| `src/services/hermesSkillsBridge.ts` | TypeScript | 前端技能检测 + 行为事件分发 |
| `src/hooks/useHermesGateway.ts` | TypeScript | 对话 Hook（替代 useChatPipeline 的 Hermes 引擎方案） |
| `src/hooks/useUnifiedMemory.ts` | TypeScript | 三路记忆统一检索 Hook |
| `src-tauri/src/lib.rs` | Rust | Hermes Gateway 自动拉起（`service_start_raw`） |

### Phase 5: Tauri 打包发布

> **状态**: i18n ✅ | 打包 🔲 ← 当前

- [ ] Tauri build 生成安装包（.exe Windows / .dmg macOS / .deb Linux）
- [ ] 版本号管理（Cargo.toml + tauri.conf.json + package.json 同步）
- [ ] 应用图标（多尺寸 .ico / .icns / .png）
- [ ] 安装包测试（全新安装 → 启动 → 基础交互 → 卸载）

---

### Phase 6: 工程质量体系

> 目标：消除当前最大风险项（无测试、无加密、无鉴权），建立可持续维护的工程标准

#### 🔴 P0：安全加固 ✅ 已完成

| # | 任务 | 说明 | 估时 | 状态 |
|---|------|------|------|------|
| 1 | **API Key 加密存储** | Windows DPAPI 加密（crypto.rs）；敏感字段脱敏显示（Providers 页面） | 3h | ✅ |
| 2 | **管理后台鉴权** | 随机 Bearer token 启动时生成 + `X-Admin-Token` Header 验证 | 2h | ✅ |
| 3 | **React Error Boundary** | 顶层 + 页面级两层边界，崩溃显示友好恢复页 + 重试按钮 | 0.5h | ✅ |

#### 🔴 P0：测试破冰 🟡 部分完成

| # | 任务 | 说明 | 估时 | 状态 |
|---|------|------|------|------|
| 4 | **Vitest 单元测试** | logger.test.ts / storage.test.ts / tokenEstimator.test.ts | 4h | ✅ 3个文件 |
| 5 | **Provider 连通性测试** | OpenAIChatProvider / EdgeTTS / FunASR mock 测试 | 3h | 🔲 待实现 |
| 6 | **React Testing Library** | ChatBubble / EmotionDisplay / SettingsPanel 渲染测试 | 3h | 🔲 待实现 |

#### 🟡 P1：代码质量提升 ✅ 已完成

| # | 任务 | 说明 | 估时 | 状态 |
|---|------|------|------|------|
| 7 | **TypeScript strict mode** | tsconfig strict: true，逐文件修复类型错误 | 4h | ✅ |
| 8 | **大文件拆分** | App.tsx → 已拆分；lib.rs → admin_server.rs + crypto.rs + utils.rs + service.rs | 8h | ✅ |
| 9 | **Rust 模块化** | 消除所有 unwrap，使用结构化错误处理 | 4h | ✅ |
| 10 | **JSDoc 注释覆盖** | services/ 和 hooks/ 核心 API 已覆盖 | 3h | ✅ |
| 11 | **魔法数字常量化** | 部分已提取到 constants.ts | 2h | 🟡 部分 |

#### 🟡 P1：可靠性增强 🟡 部分完成

| # | 任务 | 说明 | 估时 | 状态 |
|---|------|------|------|------|
| 12 | **服务自动重启** | Python 服务崩溃检测（Provider 有 starting/error 状态，但无自动重试） | 4h | 🟡 部分 |
| 13 | **离线降级** | 无网络时 Live2D + 基础交互仍然可用，禁用 AI 相关功能 | 2h | 🔲 待实现 |
| 14 | **音频播放容错** | TTS 失败 → 静默降级为纯文本 + 提示图标 | 1h | 🟡 部分 |

#### 🟢 P2：CI/CD + 文档 ✅ 已完成

| # | 任务 | 说明 | 估时 | 状态 |
|---|------|------|------|------|
| 15 | **GitHub Actions CI** | lint → typecheck → test → build → e2e 流水线 | 4h | ✅ |
| 16 | **Playwright E2E** | 配置在 CI 中（Tauri build + Playwright 启动测试） | 4h | ✅ |
| 17 | **CHANGELOG.md** | 按 semver 记录变更历史 | 0.5h | 🔲 待创建 |

---

### Phase 7: 新功能开发

#### 🥇 高优先级（投入小、价值高）

| # | 功能 | 描述 | 产出 | 估时 | 状态 |
|---|------|------|------|------|------|
| 1 | **系统托盘** | 最小化到托盘，右键快捷菜单（锁定/对话/退出），双击恢复 | `src-tauri/src/tray.rs` | 2h | ✅ 已完成 |
| 2 | **宠物等级系统** | 互动累积经验值 → 升级解锁表情/动画/对话风格 | `src/services/leveling/` | 1天 | 🔲 待实现 |
| 3 | **每日问候** | 首次启动根据时段打招呼（早安/午安/晚安），融入时间感知 | `src/services/skills/plugins/dailyGreeting.ts` | 0.5h | ✅ 已完成 |
| 4 | **番茄钟模式** | 25min 专注 + 5min 休息，宠物提醒 + 计时显示 | `src/services/skills/plugins/pomodoro.ts` | 3h | ✅ 已完成 |

#### 🥈 中优先级（差异化体验）

| # | 功能 | 描述 | 产出 | 估时 | 状态 |
|---|------|------|------|------|------|
| 5 | **小游戏** | 猜拳/猜数字/成语接龙，输赢影响情绪 | `src/services/games/` | 2天 | 🔲 待实现 |
| 6 | **宠物换装** | 帽子/眼镜/饰品，纯 UI 叠加层，预设套装 | `src/components/Accessory/` | 1天 | 🔲 待实现 |
| 7 | **环境音效** | 雨声/篝火/咖啡馆白噪音，宠物状态联动静音 | `src/services/ambient/` | 1.5天 | 🔲 待实现 |
| 8 | **个人知识库** | RAG 基础上层包装，笔记/收藏 → 私人助手 | `src/services/knowledge/`（当前为空）+ 前端页面缺失 | 2天 | 🔲 未实现 |
| 9 | **桌面微件** | 天气/CPU/内存小卡片，点击宠物切换显示 | `src/components/Widget/` | 1天 | 🔲 待实现 |

#### 🥉 低优先级（长期愿景）

| # | 功能 | 描述 | 状态 |
|---|------|------|------|
| 10 | **多宠物共存** | 同时渲染多个 Live2D 角色，各自独立 AI 和行为 | 🔲 远期 |
| 11 | **语音唤醒** | "嘿，纳西妲" → 触发对话，浏览器 Speech API 持续监听 | 🔲 远期 |
| 12 | **宠物社区** | 分享自定义人设/表情配置，JSON 导入导出 | 🔲 远期 |
| 13 | **IDE 深度集成** | VS Code 扩展，宠物在侧边栏显示，注入编辑器上下文 | 🔲 远期 |
| 14 | **移动端同步** | 手机 Web App 远程查看宠物状态、发送消息 | 🔲 远期 |

---

#### 🚀 AstrBot 借鉴功能（按推荐优先级）

> 参考 [AstrBot](file:///F:/Work/Create/BOT/AstrBot-master) 项目架构设计，逐步引入成熟功能模块

##### 🥇 P0: 定时任务系统 + 技能系统（核心基础）

| # | 功能 | 描述 | 产出 | 估时 | 状态 |
|---|------|------|------|------|------|
| A1 | **定时任务系统** | cron/单次/周期任务调度，技能运行基础 | `src/services/cron/` | 4h | ✅ 已完成 |
| A2 | **技能系统** | 插件框架 + 5 个内置技能（番茄钟/每日问候/喝水提醒/久坐提醒/护眼提醒） | `src/services/skills/` | 6h | ✅ 已完成 |

##### 🥈 P1: 工具系统 + 备份系统（能力扩展）

| # | 功能 | 描述 | 产出 | 估时 | 状态 |
|---|------|------|------|------|------|
| A3 | **工具系统** | 统一工具注册表（ToolRegistry），浏览器/文件系统/Shell/Python 工具 | `src/services/tools/` | 4h | ✅ 已完成 |
| A4 | **备份系统** | 全 JSON 导出，ZIP 备份，SHA256 校验，manifest 清单 | `src/services/backup/` | 3h | ✅ 已完成 |

##### 🥉 P2: 管道增强 + Agent + 知识库（未来扩展）

| # | 功能 | 描述 | 产出 | 估时 | 状态 |
|---|------|------|------|------|------|
| A5 | **管道系统增强** | 阶段化安全策略（内容安全/速率限制/白名单） | `src/services/pipeline/stages/` | 4h | 🟡 内容安全/速率限制已有 |
| A6 | **Agent 系统** | 多后端支持（OpenAI/Ollama/Coze），工具执行循环 | `src/services/agent/` | 1天 | 🔲 待实现 |
| A7 | **知识库系统** | PDF/EPUB/URL 解析，智能分块，向量检索，重排序 | `src/services/knowledge/` | 2天 | 🔲 待实现 |
| A8 | **平台适配层** | 适配器模式，消息会话抽象，Webhook 支持 | `src/services/platform/` | 1天 | 🔲 远期 |

---

### 全局优化项（持续改进）

- [ ] 表情表达丰富度（利用未使用的 Wink, StarEye, kusa 等表达）
- [ ] 眼神追踪精度微调
- [ ] 情感详情弹窗样式打磨
- [ ] 代码上下文理解（IDE 编辑器内容注入 LLM prompt）
- [ ] MCP 权限控制（确认对话框 + 始终允许/拒绝）
- [ ] MCP 工具扩展（文件系统/系统命令/应用控制）
- [ ] Skill 渐进式披露（SKILL.md，日常摘要，完整加载）
- [ ] 配置 Schema（config.schema.json → Admin 自动生成配置表单）
- [ ] 行为目录结构（behaviors/{name}/main.ts + metadata.yaml + config.schema.json）
- [ ] Python + TypeScript 双管道统一（server/core/pipeline.py ↔ src/services/pipeline/）

---

## 📁 项目结构

```
desk-pet/
├── src/
│   ├── components/                # 前端 UI 组件
│   │   ├── Pet/Live2DViewer.tsx   # Live2D 角色（原生 WebGL2）
│   │   ├── Chat/ChatWindow.tsx    # 对话窗口（流式渲染 + think 标签）
│   │   ├── Settings/SettingsPanel.tsx
│   │   ├── Status/StatusPanel.tsx
│   │   └── Bubble/ChatBubble.tsx
│   ├── hooks/                     # 核心 React Hooks
│   │   ├── useLive2D.ts          # Live2D React Hook（SDK v5 桥接）
│   │   ├── useMemory.ts          # 记忆系统
│   │   ├── useEmotion.ts         # 情感系统
│   │   └── useInteraction.ts     # 互动系统
│   ├── services/                  # 纯逻辑服务层（零 React 依赖）
│   │   ├── provider/             # Provider 抽象层（Chat/TTS/STT）
│   │   ├── perception/           # 感知服务（WebSocket 实时流，独立模块）
│   │   ├── audio/                # 音频播放/录制
│   │   ├── pipeline/             # 洋葱管道（10 Stage + 调度器）
│   │   ├── behavior/             # 行为插件系统
│   │   ├── mcp/                  # MCP 客户端
│   │   ├── tools/                # Function Calling 工具
│   │   ├── safety/               # 内容安全
│   │   ├── emotion/              # 情感引擎
│   │   ├── persona/              # 人设系统（热切换 + Prompt 引擎）
│   │   ├── context/              # 上下文压缩
│   │   ├── rag/                  # RAG 检索引擎
│   │   ├── proactive/            # 主动消息调度
│   │   ├── eventBus.ts           # 事件总线
│   │   ├── storage.ts            # 双备份持久化
│   │   ├── chatStorage.ts        # 会话存储
│   │   └── ai.ts                 # AI 薄代理层
│   ├── admin/                     # 管理后台（HeroUI + Tailwind）
│   │   ├── App.tsx               # 路由入口
│   │   ├── components/           # 10+ 复用组件
│   │   ├── pages/                # 10 页面 + Providers 子模块
│   │   └── providers/            # ThemeProvider
│   ├── i18n/                      # 国际化（zh-CN + en-US）
│   ├── lib/                       # Live2D SDK（framework + live2d）
│   ├── utils/                     # 工具函数（logger/thinkTagParser）
│   └── data/                      # 静态数据（idleMessages/strings/constants）
├── src-tauri/                     # Rust 后端
│   └── src/
│       ├── lib.rs                 # Tauri 入口 + Admin HTTP Server
│       ├── mcp.rs                 # MCP 进程管理器
│       ├── service.rs             # 服务进程管理器
│       ├── cursor.rs              # 光标位置
│       └── storage.rs             # 持久化
├── server/                        # Python AI 语音管道 + 感知服务
│   ├── core/                      # 管道核心（pipeline/session/audio_stream）
│   ├── modules/                   # 11 功能模块（VAD/ASR/LLM/TTS/Emotion）
│   ├── perception/                # 感知服务独立模块（MediaPipe + WebSocket）
│   │   ├── __init__.py            # 模块入口
│   │   ├── config.py              # 模型路径/WS 端口/摄像头/校准配置
│   │   ├── hand_tracker.py        # 手部 21 点检测
│   │   ├── face_tracker.py        # 面部 468 点 + 虹膜 + 表情 + 头部姿态
│   │   ├── data_processor.py      # EMA 平滑 + 手势分类 + CalibConfig
│   │   ├── gesture_learner.py     # KNN 手势学习分类器
│   │   └── perception_server.py   # WebSocket 服务入口（默认 :8765）
│   ├── edge_tts_server.py         # Edge TTS HTTP（port 8001）
│   ├── gpt_sovits_server.py       # GPT-SoVITS HTTP（port 9880）
│   ├── voxcpm_server.py           # VoxCPM HTTP（port 8000）
│   └── stt_server.py              # FunASR + SenseVoice（port 8002）
├── DEVELOPMENT.md                 # 工程规范文档（含项目规则 + 架构 + 编码规范）
└── PLAN.md                        # 本文件
```

---

## 🎯 时间总览

| 阶段 | 内容 | 工期 | 状态 |
|------|------|------|------|
| Phase 1 | 基础交互（Live2D/对话/情感/互动/持久化） | 14天 | ✅ |
| Phase 2 | Function Calling + 内容安全 + 截图/剪贴板 | 6天 | ✅ |
| Phase 3 | MCP + 服务管理 + Ollama + 精简重构 | 4天 | ✅ |
| Phase 4 | 上下文压缩 + 人格系统 + 洋葱管道 + 情绪优化 + 性能 + 工具循环 + 行为系统 + RAG + 热切换 + 日志修复 | 8天 | ✅ |
| Phase 4e | 感知服务整合（gesture-character）+ 项目瘦身 + 文档合并 | 1天 | ✅ |
| Phase 5 | i18n ✅ / Tauri 打包 🔲 | 3天 | 🔴 待续 |
| Phase 6 | 工程化体系（安全/测试/CI/CD） | 5天 | ✅ 已完成 |
| Phase 7 | 新功能（托盘 ✅ / 等级 🔲 / 小游戏 🔲 / 换装 🔲 / 知识库 🔲 / 微件 🔲 / 音效 🔲） | 视优先级 | 🟡 进行中 |
| Phase 7A | AstrBot 借鉴功能（定时任务 ✅ / 技能 ✅ / 工具 ✅ / 备份 ✅） | 视优先级 | ✅ 已完成 |
| Phase 8 | 核心系统移植（Heart ✅ / Brain ✅ / Soul ✅ / Time ✅） | 视优先级 | ✅ 已完成 |
| Phase 9 | Open-LLM-VTuber 语音实时性优化（流式TTS + VAD + 引擎扩展） | 2.5天 | ✅ 已完成 |
| | **TypeScript/ESLint: 0 错误** | | ✅ |

---

## 🎯 下一步行动（按优先级）

### 真实项目状态速览

| 类别 | 已完成 | 部分完成 | 待实现 |
|------|--------|----------|--------|
| **核心系统** | Heart/Brain/Soul/Time 四大系统 + Pipeline + Session + Hebbian + 纪念日管理 | — | Dream Engine |
| **前端功能** | 系统托盘、番茄钟、每日问候、技能系统(5个)、定时任务、工具系统、备份系统、**感知降级(鼠标视线跟随)** | — | 知识库、宠物等级、小游戏、换装、环境音效、桌面微件 |
| **安全加固** | DPAPI加密、Token鉴权、ErrorBoundary | — | — |
| **测试/CI** | Vitest(3)、GitHub Actions CI、Playwright配置 | Provider测试、RTL | — |
| **语音实时性** | Phase 9: 流式TTS并行合成(V1✅) + VAD检测+中断(V2✅) + 引擎扩展(V3✅) | — |

### 🔴 当前执行（差异化体验优化 Phase 11）

> **目标**：点亮三个"代码完整但休眠"的预留模块（RAG/行为系统/人设热切换），形成与其他桌面宠物产品的差异化。

| # | 任务 | 阶段 | 估时 | 状态 |
|---|------|------|------|------|
| 1 | **体验抖动修复** — usePluginSystem/usePerception 的 deps 抖动 | Phase 11 | 0.5天 | ✅ 已完成 |
| 2 | **主动陪伴点亮** — BehaviorPage 智能闲聊开关驱动 proactiveScheduler | Phase 11 | 0.5天 | ✅ 已完成 |
| 3 | **web_search 补完** — Rust ureq 抓取 DuckDuckGo HTML，无需 API key | Phase 11 | 0.5天 | ✅ 已完成 |
| 4 | **人设热切换 UI** — ControlsIsland 角色切换按钮 + 自动规则配置 | Phase 11 | 1天 | ✅ 已完成 |
| 5 | **RAG 长期记忆接入管道** — MemoryStage 后注入 BM25 检索结果 + 对话后 upsert | Phase 11 | 2天 | ✅ 已完成 |
| 6 | **行为系统接入 eventBus** — 激活 BehaviorRegistry + 内置 5 个 behavior + 事件全链路接通 | Phase 11 | 2天 | ✅ 已完成 |

### 🟡 近期任务（按优先级，差异化方向）

| # | 任务 | 阶段 | 估时 | 差异化理由 |
|---|------|------|------|------|
| 1 | ~~人设热切换 UI~~ | Phase 11 #4 | 1天 | ✅ 已完成 |
| 2 | ~~RAG 长期记忆接入管道~~ | Phase 11 #5 | 2天 | ✅ 已完成 |
| 3 | ~~行为系统接入 eventBus~~ | Phase 11 #6 | 2天 | ✅ 已完成 |
| 4 | ~~感知服务降级模式~~ | 新增 | 2天 | ✅ 已完成（`perception/fallback.ts` + Rust `get_cursor_window_info`，鼠标视线跟随，默认开启） |
| 5 | ~~tsconfig lib 修复~~ | 技术债 | 0.5h | ✅ 已完成（加入 ES2022.Error 到 lib） |
| 6 | **宠物等级系统** | Phase 7 #2 | 1天 | 互动累积经验值 → 升级解锁 |
| 7 | **Tauri 打包发布** | Phase 5 | 3h | 配置已 `active:true`，但 `targets:["app"]` 仅 macOS；需加 Windows `nsis/msi` 才能出安装包 |

### 🧠 记忆系统现状与改进路线（前端 RAG + useMemory）

> 2026-08-03 补充，2026-08-06 更新：前端记忆由 4 套存储组成。
> M1 混合检索（BM25 + Embedding 双路融合，默认关闭、需配置 embedding 后端）与 M2 自动记忆抽取（双语规则式：对话后抽取事实/偏好/事件为结构化条目、去重合并入库；另含可选 LLM 增强层，默认关闭、设置中开启）均已落地。
> M3（离线轻量遗忘：Ebbinghaus 指数衰减 + 软遗忘 + 硬上限）与 M4（MemoryStage 在线 Hermes 核心 + RAGStage 离线兜底 合并为 UnifiedMemoryStage 单链）也已落地。仅剩 BM25 语义召回弱一项（靠 M1 向量路径缓解）。

**当前架构（4 套存储）**

| 存储 | 位置/键 | 作用 | 持久化 |
|------|----------|------|--------|
| useMemory（按角色隔离） | `desk_pet_memory_<personaId>` | 规则/偏好/事实/最近对话，由 UnifiedMemoryStage（在线 Hermes Brain / 离线本地 RAG 健康路由）拼进 system prompt | localStorage + Tauri 文件 |
| RAG 引擎（BM25 + 可选 Embedding 混合） | `deskpet_rag_docs_v1` | 长期记忆：对话后 upsert 文档；M2 自动抽取的结构化事实/偏好/事件亦入此索引；检索默认 BM25，开启 hybrid 后叠加向量语义 | localStorage |
| ContextManager | 内存 | 仅运行时裁剪窗口（轮次截断 + token 压缩），不持久化 | — |
| chatStorage | `chat_sessions` | 多会话完整聊天记录 | localStorage + 文件 |

**已知短板**

| 问题 | 影响 |
|------|------|
| BM25 中文语义召回弱 | unigram+bigram 难覆盖同义/上下位；M1 向量路径（开启 hybrid 后）可缓解，未开时仍弱 |
| 整条消息入库 | M2 已改为抽取结构化条目（`[fact]`/`[preference]`/`[event]`）入库，整条噪声大幅减少；原始消息仍并存 |
| 事实靠手动 addFact | M2 已自动抽取（双语规则式），无需手动；可选 LLM 增强层（`llm-enhancer.ts`，默认关闭）可做更聪明的补充/修正 |
| 重要性写死 + 无遗忘 | ~~user0.3/assistant0.4 固定，无时间衰减/访问热度，满 1000 条粗暴 prune~~ → M3 已改为 `baseImportance` 锚定 + Ebbinghaus 指数衰减 + 访问热度加成 + 软遗忘（低于阈值删除）+ 硬上限（超 maxDocuments 逐出最低重要性），永久记忆跳过；在线记忆遗忘由 Hermes `applyMemoryDecay` 负责 |

**改进路线（按性价比排序，增量叠加）**

| # | 任务 | 阶段 | 目标文件 | 说明 | 状态 |
|---|------|------|----------|------|------|
| M1 | **混合检索（BM25 + Embedding）** | 记忆升级 | `services/rag/engine.ts` + `services/provider`（embedding 预留） | 双路召回加权融合：BM25 关键词 + 向量语义；接入本地 Ollama nomic 或云端 OpenAI embedding provider；`LongTermPage` 已接线 `setEmbeddingProvider` + `setConfig({hybridEnabled})` | ✅ 已完成（默认关闭，需配置 embedding 后端启用） |
| M2 | **自动记忆抽取（Mem0 式）** | 记忆升级 | `services/memory/extractor.ts` + `services/memory/llm-enhancer.ts` + `useRagPersistence.ts` | 对话后双语（中/英）规则式抽取"事实/偏好/事件"为结构化条目，去重合并入库，替代"整条消息当文档"；**可选 LLM 增强层**（`llm-enhancer.ts`，依赖倒置注入 `LLMCall`）在启用时把规则候选+对话交对话模型补充/修正再合并，**默认关闭**，由 `LongTermPage`「LLM 增强记忆抽取」开关控制 | ✅ 已完成 |
| M3 | **分层 + 遗忘机制（离线版）** | 记忆升级 | `services/rag/engine.ts` | 为本地 RAG 增加 `baseImportance` 锚点（避免反复衰减雪崩）；`effectiveImportance()` = 基底·exp(-λ·ageDays) + 访问加成，Ebbinghaus 指数衰减；`forget()` 软遗忘（超宽限期且有效重要性低于阈值则删除）、`hardCap()` 硬上限（超 maxDocuments 按有效性逐出，永久记忆跳过）；持久化含 baseImportance。在线记忆遗忘由 Hermes 核心 `applyMemoryDecay`（Ebbinghaus + 四阶段）负责，前端不重复 | ✅ 已完成 |
| M4 | **记忆系统一（合并双写冗余）** | 记忆升级 | `services/pipeline/stages/unified-memory.ts` + `useRagPersistence.ts` + `services/coreApi.ts` | MemoryStage（Hermes 核心，在线权威）与 RAGStage（自研离线兜底）合并为 `UnifiedMemoryStage` 单链：在线 9877 可达→`searchMemories`（Brain Librarian）；离线→本地 `RAGEngine.getContext()`（受 `isRAGEnabled` 约束）；短期/设定上下文始终注入；逐行哈希去重 + 1800 字符预算截断。抽取端在写端 `useRagPersistence.addToRag` 路由：在线→Hermes Scribe（`use_llm` 映射 LLM 增强开关），离线→本地 M2，原始对话始终写入本地 RAG 作热备 | ✅ 已完成 |

> M1/M2/M3/M4 均已完成。仅剩 BM25 语义召回弱一项（靠 M1 向量路径 / 开启 hybrid 缓解）。
> 注：Python 端 `server/core/brain/`（Scribe/Librarian/Archivist）已有完整记忆算法（Phase 8b），前端也可考虑直接复用而非另起炉灶。

### 🟢 已完成（近期已解决）

| # | 任务 | 阶段 | 状态 |
|---|------|------|------|
| 10 | ~~系统托盘~~ | Phase 7 🥇 | ✅ |
| 11 | ~~技能系统（5个内置插件）~~ | Phase 7A P0 | ✅ |
| 12 | ~~定时任务系统~~ | Phase 7A P0 | ✅ |
| 13 | ~~番茄钟~~ | Phase 7 🥇 | ✅ |
| 14 | ~~每日问候~~ | Phase 7 🥇 | ✅ |
| 15 | ~~工具系统~~ | Phase 7A P1 | ✅ |
| 16 | ~~备份系统~~ | Phase 7A P1 | ✅ |
| 17 | ~~Archivist 归档器~~ | Phase 8g | ✅ |
| 18 | ~~Embedding 多方案~~ | Phase 8g | ✅ |
| 19 | ~~MemoryView UI~~ | Phase 8g | ✅ |
| 20 | ~~人格基线接入~~ | Phase 8g | ✅ |
| 21 | ~~时间感知接入~~ | Phase 8g | ✅ |
| 22 | ~~React Error Boundary~~ | Phase 6 P0 | ✅ |
| 23 | ~~管理后台鉴权~~ | Phase 6 P0 | ✅ |
| 24 | ~~API Key 加密~~ | Phase 6 P0 | ✅ |
| 25 | ~~TypeScript strict mode~~ | Phase 6 P1 | ✅ |
| 26 | ~~大文件拆分~~ | Phase 6 P1 | ✅ |
| 27 | ~~GitHub Actions CI~~ | Phase 6 P2 | ✅ |
| 10 | ~~语音实时性优化（流式TTS + VAD + 引擎扩展）~~ | Phase 9 | ✅ |

---

## 🔧 最近修复记录（2026-07-29 — Phase 11 差异化体验优化）

### 体验抖动修复（消除隐性卡顿）
- **usePluginSystem deps 抖动**: 原实现 useEffect deps 包含 `emotionState`，而情绪每 120s 衰减更新 + 每次互动更新，导致所有插件被 shutdown 再重新注册。改为用 ref 持有 emotionState 等依赖，effect 只在挂载时跑一次
  - 文件: `src/hooks/usePluginSystem.ts`
- **usePerception deps 抖动**: 原实现 deps 包含 `currentEmotion`/`getLive2DEmotion`，每次情绪变化（最高每 3s 一次 cooldown）都会断开感知 WebSocket 重连，手势检测中断。改为用 ref 持有情绪依赖，从 deps 移除
  - 文件: `src/hooks/usePerception.ts`

### 主动陪伴点亮（让宠物"活起来"）
- **BehaviorPage 驱动 proactiveScheduler**: 原实现"智能闲聊"开关只写 localStorage 不生效，ProactiveScheduler 的 `enabled` 默认 false 且无 UI 入口。现在 BehaviorPage 的 useEffect 即时同步配置到调度器，App 启动时从行为配置初始化。宠物会按时段主动问候、久未互动提醒、午餐/晚餐/深夜关怀
  - 文件: `src/settings/pages/models/BehaviorPage.tsx`, `src/App.tsx`

### web_search 工具补完（AI 联网能力）
- **Rust 后端**: 用 ureq 抓取 DuckDuckGo HTML 端点（`https://html.duckduckgo.com/html/`），解析 `result__a` 链接 + `result__snippet` 摘要 + 重定向 URL 解码，无需任何 API key
  - 文件: `src-tauri/src/lib.rs`（新增 `web_search` 命令 + `parse_ddg_results` + 辅助函数）
- **前端工具**: 从 stub 替换为真实调用 `invoke('web_search')`，返回格式化的标题/URL/摘要
  - 文件: `src/services/tools/builtins.ts`

### 遗留技术债
- ~~tsconfig lib 配置~~: ✅ 已修复（tsconfig.json 的 lib 加入 `ES2022.Error`）
- **FileManagerPage/ShortcutsPage**: ESLint `react-hooks/set-state-in-effect` 警告（预先存在）

---

## 🔧 最近修复记录（2026-07-30 — Phase 11 集成断链修复）

### P2 健壮性修复（TTS Provider setup 竞态）
- **问题**: `useChatPipeline.ts` 中 TTS Provider 的 validate + setup 使用 fire-and-forget 模式（`.then()`），导致管道继续执行时 TTS 控制器可能尚未完成初始化，首句 TTS 播放可能失败或出现竞态异常
- **修复**: 将 validate + setup 改为 `await` 模式，确保 TTS 控制器在管道执行前完成初始化，失败时仅记录 warn 日志不阻塞对话
- 文件: `src/hooks/useChatPipeline.ts`

### Build 阻塞修复（tsconfig lib 过时）
- **根因**: `tsconfig.json` 的 `lib` 仅含 `ES2020`，但代码中 19 处使用 `new Error(msg, { cause })`（ES2022 特性），导致 `tsc` 报 TS2554 + `vite build` 失败
- **修复**: `lib` 数组新增 `"ES2022.Error"`，仅扩展 Error 构造函数类型，不影响其他类型
- 文件: `tsconfig.json`

### 情绪/好感度事件链路接通（2 个内置行为复活）
- **问题**: `useEmotion.ts` 完全没有 import eventBus，情绪和好感度变化时不 emit 事件，导致 `EmotionResonanceBehavior`（情绪共鸣）和 `FavorabilityMilestoneBehavior`（好感度里程碑）永不触发，`proactiveScheduler` 的 emotion:changed 订阅也收不到信号
- **修复**: 在 `useEmotion` 中新增 `prevStateRef` + `useEffect`，监听 `emotionState` 变化后对比前后值，emit `emotion:changed`（emotion/intensity/reason）和 `favorability:changed`（delta/favorability）
- 文件: `src/hooks/useEmotion.ts`

### Live2D 视觉装饰事件接通（表情/参数/动画真正驱动模型）
- **问题**: `BehaviorDecorateStage` 通过 eventBus emit `expression:change`/`param:update`/`animation:trigger` 三个事件，但 Live2D 渲染层（useLive2D.ts、lappdelegate.ts、lappmodel.ts）完全没有订阅，导致 LLM 回复后模型不会自动切换表情、不会脸红/青筋、不会触发挥手/跳跃动画
- **修复**:
  - `lappmodel.ts`: 新增 `_transientParams` Map + `setTransientParam()` 方法，在 `update()` 末尾 `this._model.update()` 之前应用瞬态参数并自动过期清理
  - `lappdelegate.ts`: 新增 `triggerAnimation(name, duration)` 桥接函数（映射动画名到 motion group，失败回退 TapBody）+ `setParameterOverride(key, value, duration)` 桥接函数
  - `lib/live2d/index.ts`: barrel export 新增两个函数
  - `useLive2D.ts`: 新增 useEffect 订阅三个 eventBus 事件，分别调用 `setExpression`/`setParameterOverride`/`triggerAnimation`
- 文件: `src/lib/live2d/lappmodel.ts`, `src/lib/live2d/lappdelegate.ts`, `src/lib/live2d/index.ts`, `src/hooks/useLive2D.ts`

### 代码清理
- **删除重复 IdleChatBehavior**: `base.ts` 末尾的示例 `IdleChatBehavior` 与 `builtins.ts` 中的正式实现重复（同 id `builtin.idle_chat`），删除 base.ts 中的示例版本 + 同步更新 `behavior/index.ts` 的 re-export
- 文件: `src/services/behavior/base.ts`, `src/services/behavior/index.ts`

### 验证结果
- `npm run typecheck`: 0 errors
- `npm run lint`: 0 errors（17 warnings 均为预先存在的 cascading setState 等）
- `npm run build`: ✓ built in 4.19s

---

## 🔧 最近修复记录（2026-07-26）

### 系统架构重构 & 代码精简（Phase 10）
- **删除Zustand Stores**: 移除 `src/stores/` 目录下6个状态管理文件（emotionStore, personalityStore等），功能已被 useState+localStorage 替代
- **删除管理后台**: 移除 `src/admin/` 目录及相关文件，管理后台功能后续优化
- **删除浮层设置面板**: 移除 `src/components/Settings/` 目录，统一使用独立窗口设置
- **App.tsx 重构**: 从2141行巨型组件拆分为8个独立hooks（useEmotion, useWindowManager, useChatPipeline等），精简至531行
- **情感系统统一**: 整合 useEmotion / emotionStore / EmotionEngine，采用 Sigmoid 衰减算法 + 心情-情绪双向影响模型
- **设置系统重构**: Provider管理改为多方案切换，新增插件管理和自动化（定时任务）页面
- **Switch组件统一**: 全项目统一Switch组件实现
- **vite构建修复**: 删除admin.html入口，添加settings.html入口
- **类型安全**: 解决所有TypeScript编译错误

### 控制面板优化 & 功能修复
- **可见性优化**: ControlsIsland 从使用未定义CSS变量改为具体颜色值，背景白色半透明+深色文字，大幅提升可读性
- **激活状态圆角**: 激活状态按钮从方形改为圆角（borderRadius: 12px）
- **移动功能修复**: 修复 `handlePetMouseDown` 使用旧Tauri API问题，改为 `getCurrentWindow().startDragging()`
- **React Hooks顺序修复**: 修复 App.tsx 中 Hooks 在条件返回之后调用的问题（违反 React Hooks 规则，导致功能异常）
- **ESLint错误修复**: 修复所有 ESLint error（0 errors, 83 warnings），包括：
  - `useVADInteraction.ts`: handleSpeechStart 声明前被调用 → useRef 存储回调
  - `useVoiceInteraction.ts`: ref 在渲染期间赋值 → 移至 useEffect
  - settings 页面多个文件: setState 在 effect 中同步调用 → 调整函数声明顺序
- **vite配置修复**: settings.html 添加到构建入口点
- **构建验证**: `pnpm run build` 通过，`pnpm run lint` 0 errors
- **文件**: `src/components/Pet/ControlsIsland.tsx`, `src/App.tsx`, `src/hooks/useVADInteraction.ts`, `src/hooks/useVoiceInteraction.ts`, `vite.config.ts`

---

## 🔧 最近修复记录（2026-07-06）

### 感知服务整合 + 项目整理（Phase 4e）
- **整合**: gesture-character 项目 → Desk Pet（MediaPipe 手势/面部识别 + WebSocket 实时流）
- **Python 模块**: `server/perception/`（hand_tracker/face_tracker/data_processor/gesture_learner/perception_server/config）
- **前端模块**: `src/services/perception/`（types/service/gestureMapping/hooks/index）
- **架构决策**: 感知服务保持独立 WebSocket 模块，**未纳入** Provider 请求-响应体系
- **依赖更新**: `server/requirements.txt` 新增 `mediapipe>=0.10.0`、`opencv-python-headless>=4.8.0`
- **项目瘦身**: 删除 `venv/` (~4.8GB)、`src-tauri/target/` (~9.1GB)、`dist/`、临时输出文件，共释放 ~13.9GB
- **.gitignore**: 新增 `*_output.txt`、`*_result.txt`、`*_out.txt`、`cargo_err.txt` 规则
- **文档合并**: CLAUDE.md + ARCHITECTURE.md 合并到 DEVELOPMENT.md（单一工程规范文档）

### pnpm 11+ 兼容性修复
- **根因**: pnpm 11 默认阻止第三方包构建脚本（`ERR_PNPM_IGNORED_BUILDS`），esbuild postinstall 被拦截
- **修复**: `pnpm-workspace.yaml` 配置 `allowBuilds.esbuild: true`
- **文件**: `pnpm-workspace.yaml`

### Tauri 环境安全调用修复
- **根因**: 浏览器环境下 Tauri API 为 undefined，`getCurrentWindow()`、`listen()` 等调用导致级联崩溃
- **修复**: `src/utils/tauriEnv.ts` 提供 `isTauriEnv()` + `safeTauriCall()`，所有 Tauri 调用加环境守卫 + try-catch
- **文件**: `src/App.tsx`, `src/hooks/useLive2D.ts`, `src/utils/tauriEnv.ts`

### 角色位置 & 感知页面增强
- **角色位置**: 默认 `feetOffset` 0 → 80，模型底部蓝线与功能栏上方贴合
- **感知页面 - 镜像翻转**: Canvas 水平镜像（`ctx.scale(-1, 1)`），解决摄像头左右方向相反问题，默认开启
- **感知页面 - 节点开关**: 手部节点 / 面部节点独立显示开关，替换原单一"显示关键点"
- **文件**: `src/App.tsx`, `src/admin/pages/Perception.tsx`

### Provider 服务启停逻辑修复
- **根因**: `startService` 启动后立即设为 `running`，跳过 `starting` 过渡，导致就绪检测失效、状态不一致
- **修复项**:
  - `startService` 返回后设为 `starting`，轮询检测健康检查通过后自动变 `running`
  - `isPortRunning` 包含 `starting` 状态（活跃判定），新增 `isPortReady` 仅 `running`
  - ProviderCard 状态徽章重构：统一优先级逻辑，新增 `error` 状态（异常徽章）
  - 停止按钮在 `starting` 状态也可用（"取消启动"）
  - 启动按钮在 `error` 状态也可用（支持失败后重试）
- **文件**: `src/admin/pages/Providers/hooks/useServiceManager.ts`, `src/admin/pages/Providers/components/ProviderCard.tsx`

### 待验证（感知服务）
- [x] 重新安装 Python 依赖
- [x] 下载 MediaPipe 模型（hand_landmarker.task / face_landmarker.task）
- [x] 启动感知服务：`python -m server.perception.perception_server`
- [x] 前端 WebSocket 连接测试（默认 ws://localhost:8765）

---

### 历史修复（2026-06-23）

#### Admin Dev Mode 404/401 修复
- **根因**: `tauri dev` 读取旧 `dist/admin.html`，引用不含 token URL 读取的旧 JS → 401
- **修复**: `admin.html` 重写为 Vite dev server 热加载 + `vite.config.ts` cors:true
- **文件**: `admin.html`, `vite.config.ts`, 删除 `dist/admin.html` + 旧 assets

#### Live2D 加载加速
- **预加载扩展**: 2 文件 → 10 文件 (新增 4 纹理 PNG + physics3.json + cdi3.json)
- **cubismcore 非阻塞化**: `<script defer>` + `<link rel="preload">`
- **文件**: `index.html`, `src/main.tsx`

#### Live2D 10 秒延迟修复（setup 同步阻塞）
- **根因**: `lib.rs setup()` 中 provider 自启动在主线程同步执行，`check_http_health` 每端口 2s TCP 超时
- **修复**: 包进 `std::thread::spawn` → 窗口立即创建，Live2D 不等服务
- **超时削减**: TCP connect 2000→500ms, attempt_wait 2000→1000ms
- **文件**: `src-tauri/src/lib.rs`, `src-tauri/src/service.rs`

#### 验证
- Rust: cargo check 通过，零 lint 警告
- TypeScript: 零错误 (tsc --noEmit)
- Vitest: 32/32 通过

---

## 🔧 最近修复记录（2026-08-06）

### Phase 5: 聊天面板现代化 & 统一 Gateway 架构
- **统一对话引擎**: 主窗口与面板统一走 Hermes Gateway；前端仅保留 UI 渲染与可选 TTS 表现层
- **ChatPanelWindow 接入 Gateway**: 改用 `useHermesGateway` 完成真实流式对话与 session 管理
- **Slash 命令系统**: 面板输入框接入 `complete.slash` RPC 自动补全；`/help` 以 `SlashHelpOverlay` 浮层展示
- **模式切换**: 新增工作模式/聊天模式 toggle，前端状态 + Gateway `mode` 参数双通；切换后 toast 提示
- **消息操作栏**: QQ 风格 hover 操作栏；支持引用/复制/收藏，收藏持久化；转发延后
- **消息附件**: 输入区附件按钮支持图片/文件；消息数据结构扩展 attachments；图片预览 + 文件卡片
- **语音输入**: 面板原生 `AudioRecorder` → STT Provider 直连转录 → `setInput` 回填；不经过主窗口中转
- **主题系统**: 预设现代简洁主题；气泡样式/背景可切换；支持自定义背景上传
- **顶部上下文栏**: 展示模型名、token 使用进度、模式标识、连接状态
- **右侧详情面板**: 宽度可拖拽，默认隐藏；tab 结构（Session Info / Context Usage / Tasks / Tool Calls）
- **设置系统升级**: 新增独立“聊天”设置顶级入口；子页：通用 / 输入与命令 / 语音 / 模式
- **人性化导航跳转**: 语音设置跳转模型设置；通用设置跳转外观气泡与背景页
- **国际化补全**: 新增 `settings.nav.chat`、`settings.chat.*` 多语言键

### 关键修复
- **聊天设置 404**: 设置首页新增聊天入口卡片，修复子页面无法直接访问问题
- **聊天设置无法返回**: 移除自研 `ChatLayout` 自定义布局，恢复标准 `SettingsLayout` + `PageHeader` 路由结构，返回按钮恢复正常
- **聊天设置标题不统一**: 标题统一使用 `settings.nav.chat` 国际化键，不再硬编码“聊天”
- **Gateway 模式传播**: `sendChat` 支持 `mode` 参数；`handleSendMessage` 透传模式到后端
- **双引擎残留**: 主窗口从 `useChatPipeline` 迁移到 `useHermesGateway`，删除空目录 `src/stores`、`src/admin`、`src/ui/components`；`useHermesGateway` 扩展 `onToken` / `onMessageComplete` / `onInterrupt` 回调，统一 Gateway 为唯一对话入口
- **Lint/未使用变量清理**: `App.tsx` 移除未解构的 Gateway 返回值；`ShortcutsPage`/`FileManagerPage`/`WakeWordPage` 清理死代码与未使用 import，减少 `set-state-in-effect` / `no-unused-vars` 告警

### 验证结果
- `pnpm run typecheck`: 0 errors
- `pnpm run lint`: 0 errors（46 warnings 均为历史遗留）
- 相关代码已提交 git 仓库

---

### Phase 5b: 自学习成长 + 工具/技能/MCP 可视化管理（2026-08-07）

> **核心主题**：让桌宠具备 Hermes 式自学习成长能力，并把「工具 / 技能 / MCP」的管理收拢到统一、可见的设置入口。

#### 自学习成长能力（Hermes 式）
- **记忆主仓库**: 新增 `server/hermes_gateway_memory.py`，独立库 `data/memories.db`（不复用会话库）；`MemoryStore` 提供 `add / recall / list_all / delete / clear`，类别 `preference / fact / feedback / rule`
- **自动抽取**: 每轮对话结束后异步用 LLM 从对话中抽 `[{text, category}]` 写入记忆库（`extract_memories_async` 无 JSON/异常时静默返回 `[]`）
- **记忆注入**: `_handle_chat` 生成前召回相关记忆，拼成 `<memory-context>` 块追加进 system prompt（沿用 Hermes 协议桩，现已真正接通）
- **可见入口**: 设置 → 记忆体 → **成长记忆**（`src/settings/pages/memory/GrowthPage.tsx`），可查看 / 删除 / 手动添加；后端 `GET/POST/DELETE /api/gateway/memory`
- **⚠️ 中文检索坑**: 本机 SQLite FTS5 不索引 CJK（单字也搜不到），`recall` 改用 `LIKE %term%` 逐词 AND 匹配（`_split_terms` 按 ASCII 词 / CJK 单字切分）。中文检索一律别用裸 FTS5

#### 工具 / 技能 / MCP 可视化管理
- **工具管理页**: 新增 设置 → 扩展 → **工具**（`src/settings/pages/extensions/ToolsPage.tsx`）：分组列出前端工具 / 后端工具 / MCP 工具，每项可开关**启用 / 禁用**（禁用态存 `localStorage.deskpet_disabled_tools`，后端 `_handle_chat` 双过滤），并显示该工具在 chat / work 模式下的可用性徽章
- **统一入口**: 同页含「技能 / MCP / 插件」入口行，把原本散落的能力收拢到一个可见面板
- **模式页纠正**: `ChatModesPage` 文案纠正（聊天模式也能用联网/时间等少量工具），并实时拉取展示「本模式可用工具」徽章列表 + 「工具管理」直达入口
- **模式工具白名单**: `MODE_CONFIGS[mode]["tool_names"]` 驱动（`chat: ["web_search","get_current_time"]`，`work: None`=全部），由 Gateway `_filter_tools` 统一筛选

#### 修复（提交 `3fe60fc`）
- **i18n 中文漏 key（真 bug）**: 补齐 `settings.chat` 命名空间的 `mode_badge_chat` / `mode_badge_work` / `mode_current_title` / `mode_current_desc`，中文界面不再显示原始 key 串
- **格式对齐**: `prettier --write` 修正 `ChatPanelWindow.tsx` / `ChatModesPage.tsx` / `ToolsPage.tsx` / `GrowthPage.tsx` 的漂移

#### 验证结果
- `vitest`: 131 passed / 22 files
- `tsc --noEmit`: 0 errors；`eslint src`: 0 errors（50 个历史 warning 无关）
- `pnpm check`（lint/typecheck/format/i18n/json/settings）: 全绿；`settings:check`: 38/38
- 提交: `68cfdf4`（功能，14 文件 +990/−11）、`3fe60fc`（修复+文档，6 文件）

---

### Phase 5c: Gateway LLM 可用性修复（2026-08-08）

> **核心问题**：面板发消息后前端显示 `done`，但 `full_response` 一直是用户原话，没有模型回复。

#### 根因
- `%APPDATA%\desk-pet\providers.json` 实际是 Windows DPAPI 加密二进制，前缀为 `DPAPIv1:`，Python 直接 `json.loads()` 会报 `JSONDecodeError`
- 即使解密成功，Python venv 里缺少 `openai` 包，`modules.llm` 初始化后 `llm_available=False`
- `_llm_stream` 里 `__import__("concurrent.futures")` 写法导致 `module 'concurrent' has no attribute 'ThreadPoolExecutor'`
- 修改后未清 `__pycache__`，Python 继续执行旧字节码，补丁看似无效

#### 修复
- `server/hermes_gateway_server.py`：`_get_llm()` 增加 `DPAPIv1:` 前缀检测 + `CryptUnprotectData` 解密路径
- 安装 venv 依赖：`openai`
- 修正导入为 `from concurrent.futures import ThreadPoolExecutor`
- 清除 `server/__pycache__/hermes_gateway_server.cpython-312.pyc`

#### 验证
- 独立 WebSocket 直连测试：`recv done 在的！我在这里...`，确认返回真实 LLM 回复
- `python -m py_compile`、`pnpm run typecheck` 均通过

#### 相关提交
- `4797ea9` decrypt Windows DPAPI providers.json
- `4bba7c6` fix ThreadPoolExecutor import

---
