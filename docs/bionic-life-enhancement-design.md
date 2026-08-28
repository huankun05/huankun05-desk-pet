# 桌宠「活体感」增强设计文档

> 基于《活体仿生智能体（活体AI）完整架构说明书》对照既有代码现状，提炼出**低成本、低风险、可立即落地**的增强项。
> 原则：**不推倒重来、不微调主脑、不引入图数据库**。只把"已写未接线"的能力和缺失的稳态机制补完。

---

## 0. 背景：我们与文档的对照结论

文档核心范式是「GPU 主脑冻结只读 + CPU 副脑承载生命层」。经代码核查，本项目**已独立实现其约 80%**：

- 双脑分离：本地 Ollama 纯只读推理（`src/services/provider/ollama/chat.ts`）+ Python 副脑（`server/core/`）。✅
- 内分泌/激素情绪：`server/core/.../emotion.py`(PAD+激素+drift) + 前端 `src/services/emotion/engine.ts`(sigmoid 衰减/好感度/boredom/性格) + `visualMapping.ts` 情绪→Live2D。✅
- 记忆/可塑性分层：L0–L3（`memory_service` + `LearningScheduler` 空闲后台抽取 fact/preference/rule/feedback）。✅ 但**非图结构**。
- 权限四层：`toolRegistry.execute`→`authorize` + 三态(always/ask/deny) + `DANGEROUS_COMMAND_PATTERNS` 黑名单强确认 + `K_ENABLED` 总开关。✅ 基本对应。

**文档真正启发我们的缺口**（本文档要做的）：

| # | 缺口 | 对应文档概念 |
|---|---|---|
| 1 | 后台自驱循环（circadian/drift/reunion）写了却没接入运行循环 | 副交感神经「空闲自动成长」 |
| 2 | 记忆只软衰减、不真删，长期会膨胀 | 泌尿系统（稳态清理/剪枝） |
| 3 | 后台学习不区分系统负载 | 交感神经「应激模式」 |
| 4 | 主动行为 `ProactiveScheduler` 默认关闭 | 白名单静默自主 + 每日状态简报 |
| 5 | 权限四层语义未显式标注 | 四层安全管控的对齐与文档化 |

---

## 1. 模块一：后台自驱循环接入（副交感模式）  ⚠️ 方案已作废

> **2026-08-28 作废说明**：经核对代码，`circadian`/`drift`/`reunion` 三引擎已完整实现、落盘，并接在实时情绪/心跳流水线上（每次交互触发 `apply_drift_from_event`、取 `heart/emotion` 时算重逢/昼夜节律），**无 `tick()`/`check()` 方法**；"空闲自动成长"也已被 `LearningScheduler._drain` 覆盖。故「后台 idle 循环调 tick/check」的前提不成立，模块一删除。活体感缺口改由模块二~四填补；若需空闲主动行为，并入模块四。

### 1.1 现状
- `server/core/time/circadian.py`（昼夜节律）、`server/core/soul/drift.py`（人格漂移）、`server/core/time/reunion.py`（纪念日）**代码已存在**。
- 入口 `server/hermes_gateway_server.py` 的 `startup_event` 只 `learning_scheduler.start()`（约 line 335），**未启动上述三者**。
- 聊天完成处（line 1075 `learning_scheduler.enqueue(...)`）是唯一挂点。

### 1.2 设计（事件驱动，零轮询，重活复用既有 drain）
摒弃固定 30s 轮询节拍器，改为**空闲转移事件驱动 + 仅空闲期自调度**，把后台 CPU 压到最低，并避免与既有后台抽取冲突：

- **新增文件** `server/core/autonomic/loop.py`，类 `AutonomicLoop`：
  - `mark_interaction()`：**唯一挂点**。在聊天完成 `enqueue`（line 1075）及语音/面板交互处调用，仅更新 `last_interaction_ts` 与「是否空闲」标志；若已有挂起的 consolidation 任务则 `cancel`。
  - `start()`：不启定时器，仅初始化状态（与 `LearningScheduler.start()` 同生命周期）。
  - **空闲转移触发**（无轮询）：
    - 首次进入空闲（`now - last_interaction_ts > IDLE_THRESHOLD`，默认 120s）时，`await asyncio.sleep(IDLE_THRESHOLD)` 后跑**一次**轻量 consolidation。
    - 若仍空闲，按 `IDLE_COOLDOWN`（默认 10min）自调度下一轮，直到新交互 `cancel`。
    - 效果：**活跃期零后台 CPU**（仅一次时间戳写入）；空闲期至多每 10min 一轮轻活。
  - 轻量 consolidation（全部 `await` 协同，不阻塞事件循环）：
    - `circadian.tick()`：由当前时间算昼夜相位（纯计算，免费）。
    - `reunion.check()`：纪念日命中检查（轻量查询）。
    - `drift.tick()`：**纯数值阻尼**（朝目标微调 persona 数值并落盘），**不调用 LLM**。
  - **重活不在此处**：人格聚类 / 记忆内化等 LLM 类后台工作**复用既有 `LearningScheduler._drain`**（它本就空闲触发）。`AutonomicLoop` 只做轻量 tick，避免第二个 LLM worker 与既有循环抢资源、也避免重复抽取导致记忆双写。
  - `stop()`：cancel 挂起任务，配合现有 shutdown（line 347 附近）严格对齐 `LearningScheduler` 的启停写法。
- **实现时核对**：上述模块若未暴露 `tick()/check()` 式统一入口，则补轻量封装（不改内核）。若 `drift` 当前是 LLM 驱动，先改为纯算术版或改为调用既有 drain，确保本循环零 LLM 调用。
- **改动文件**：`server/hermes_gateway_server.py`（`startup_event` 启停各 2–3 行 + `enqueue` 处加 `mark_interaction()`）、`server/core/autonomic/loop.py`（新增）。

### 1.3 验收
- 后端空转 5 分钟后，persona 漂移值 / 昼夜相位发生变化（查日志或状态接口）。
- 纪念日模拟到点能触发事件。
- 关闭后端无残留 `asyncio` task（无警告）。
- **CPU 验收**：活跃交互期间无任何后台任务（无 30s 轮询）；空闲期每 10min 至多一轮轻活；`drift.tick()` 为纯数值、日志中无 LLM 请求。

---

## 2. 模块二：主动记忆剪枝（泌尿系统）

### 2.1 现状
- `memory_fragments` 表字段：`importance`、`access_count`、`is_permanent`、`last_accessed`、`created_at`。
- `server/core/brain/decay.py` 已实现 Ebbinghaus 遗忘曲线（`apply_decay`，`is_permanent` 跳过、低 importance 衰减、90+ 天 tombstone 删除）。
- `MemoryService.apply_decay_all`（`core/api_server.py:908`）在其上叠加「`importance<0.3` 且 30 天未访问 → 删除」，逻辑完整且自包含。
- **缺口只是「没有周期性触发」**——剪枝逻辑本身齐备，无需新建 `pruner.py`。

### 2.2 设计（已落地）
- **不新建 `pruner.py`**。遵循 §9「复用既有接口」，仅在 `core/api_server.py` 的 `lifespan` 中挂一个**周期任务**调度既有 `MemoryService.apply_decay_all`：
  - 新增模块级函数 `_memory_decay_loop(interval_seconds=21600, first_delay=300)`：启动延迟 5 分钟首跑，之后每 6h 跑一次；SQLite I/O 走 `asyncio.to_thread` 不阻塞事件循环；任务自身异常被吞，不影响主服务。
  - `lifespan` 内 `asyncio.create_task(_memory_decay_loop())`，shutdown 时 `cancel()` 并 `await` 收尾（与网关 `learning_scheduler` 启停范式一致）。
  - 统计日志（`processed/changed/deleted`）可直接供模块四「每日状态简报」引用。
- **改动文件**：`server/core/api_server.py`（新增 `_memory_decay_loop` + `lifespan` 启停）。

### 2.3 验收
- `py_compile core/api_server.py` 通过（已验证 `PY_COMPILE_OK`）。
- 启动 core 服务后，5 分钟内日志出现 `memory decay loop started`；后续每 6h 出现 `memory decay run: ...`。
- 注入 ≥ 1000 条低价值记忆后，运行一次 decay，表行数明显下降；`is_permanent` 记录全部保留。
- shutdown 无 `Task was destroyed but it is pending` 类警告（已 cancel + await）。

---

## 3. 模块三：交感应激模式

### 3.1 现状
`LearningScheduler._drain` 后台抽取不区分系统负载，空闲（`_active==0`）即抽，系统 CPU 高时仍会抢占 LLM/CPU 资源。

### 3.2 设计（已落地）
- **`hermes_core/memory/learning_scheduler.py`**：
  - 新增 `self._stress` 标志（默认 False）。
  - 新增 `set_stress(enabled)`：开启时 `run()` 跳过 `_drain`（队列仍缓冲并持久化到 `learning_queue.jsonl`，**不丢数据**）；关闭时 `_wake.set()` 立即恢复抽取。
  - `run()` 在主循环 `idle and has` 分支中判断 `_stress`，跳过则仅打 debug 日志。
- **`hermes_gateway_server.py`**：
  - 新增 Windows 零依赖 CPU 探针 `_sample_cpu_percent()`（ctypes `GetSystemTimes` 两次采样求差；失败返回 -1 安全降级，不引入 psutil）。
  - 新增周期任务 `_stress_monitor_loop(scheduler, poll_seconds=15)`：每 15s 采样一次，CPU ≥ `_STRESS_CPU_THRESHOLD(80%)` 切应激、恢复后切回，状态翻转才 `set_stress` 并打 INFO 日志；任务自身异常被吞。
  - `lifespan` 中 `asyncio.create_task(_stress_monitor_loop(learning_scheduler))`，shutdown 时 `cancel()`+`await` 收尾。
- 阈值 `80%` 为保守值，可在网关常量 `_STRESS_CPU_THRESHOLD` 调整。
- **改动文件**：`hermes_core/memory/learning_scheduler.py`、`hermes_gateway_server.py`。

### 3.3 验收
- `py_compile` 通过（已验证 `PY_COMPILE_OK`）。
- 本机 ctypes 探针实测返回合理值（13.2%，无报错）。
- 高 CPU（>80%）时日志出现 `应激模式 开启` 且 `LearningScheduler 进入应激模式`；恢复后 `应激模式 关闭`。
- 应激期间 enqueue 的对话在退出应激后照常抽取（队列持久化保证）。

---

## 4. 模块四：白名单静默主动 + 每日状态简报

### 4.1 现状
- 真实默认开关在 `src/services/behavior/behaviorConfig.ts` 的 `DEFAULT_BEHAVIOR.enableSmartChat = false`；`MainPetApp` 用它初始化 `proactiveScheduler.updateConfig({ enabled })`。`scheduler.ts` 的 `DEFAULT_CONFIG.enabled` 只是兜底。
- `ProactiveScheduler` 现有场景（`idle_long`/`work_reminder`/`lunch_time`/`dinner_time`/`late_night`/`morning_greeting`/`mood_change`）**全是本地时间/空闲提醒，无外部写**，天然属低风险白名单。
- 设置页 `models/BehaviorPage.tsx` 已有「主动聊天」总开关驱动同一 `enableSmartChat`，无需新增设置条目（避免三处同步风险）。

### 4.2 设计（已落地）
- **白名单默认开启**：`behaviorConfig.ts` 的 `DEFAULT_BEHAVIOR.enableSmartChat` 改为 `true`。所有场景本地低风险，开启即"白名单静默自主"；用户可在 BehaviorPage 一键关闭。
- **新增「每日状态简报」场景（真实数据，非空壳）**：
  - `data/liveModePrompts.ts` 的 `PROACTIVE_SCENES` 新增 `daily_brief`（21:00 触发，本地生成、无外部 API）。
  - `scheduler.ts` 新增 `dailyBriefed` 标志（跨天重置）+ `tick()` 中 `hour===21` 触发一次；新增 `todayTurns` 计数（每次 `message:sent` +1，跨天重置）+ `getDailyStats()` 暴露。
  - **真实数据注入**：`MainPetApp` 的主动触发消费点，对 `daily_brief` 场景 `await getMemoryStats()`（复用既有 `/api/core/brain/memories/stats` 端点，后端 `get_stats` 已补 `today` 字段）取「今日新增记忆数 / 记忆库总量」，结合调度器本地「今日对话轮次 / 情绪趋势」拼入 system prompt。后端不可用时 `catch` 降级为空壳简报，不影响发送。
  - 后端改动：`core/api_server.py` 的 `MemoryService.get_stats` 新增 `today`（过去 24h 新增）计数；`coreApi.ts` 的 `MemoryStats` 接口补 `today` 字段。
- **首次开启走权限闸（ConsentGate）**：
  - `capabilities.ts` 新增 `proactive_chat` 低风险能力（L1 层），使主动聊天正式登记进四层权限体系。
  - `SettingsLayout.tsx` 挂载 `<ConsentGate />`（设置窗是独立 JS 上下文，否则在设置页调 `authorize` 会因 120s 超时退化成拒绝）。
  - `BehaviorPage.tsx` 的「主动聊天」开关 `onClick`：开启时 `await permissionManager.authorize('proactive_chat')`，允许才生效；拒绝则提示并保持不变；异常时安全降级为允许（不阻断功能）。
- **域外行为**：`ProactiveScheduler` 当前不触发任何联网/文件/设备操作；若未来加，仍须走 `permissionManager.authorize`（见模块五）。
- **改动文件**：`behaviorConfig.ts`、`data/liveModePrompts.ts`、`scheduler.ts`、`MainPetApp.tsx`、`coreApi.ts`、`core/api_server.py`（以上模块四）、`capabilities.ts`/`SettingsLayout.tsx`/`BehaviorPage.tsx`（以上模块五落地）。

### 4.3 验收
- `pnpm exec tsc --noEmit` 通过（已验证 `TSC_EXIT=0`）。
- `npm run settings:check` 全绿（已验证，39 路径/40 loader/9 页，未新增设置条目）。
- 默认开启后宠物按场景发本地提醒；`proactiveTts` 仍默认 false，不会突然出声。
- 21:00 触发一次 `daily_brief`，当天不重复。

---

## 5. 权限四层语义标注（贯穿小改）

将现有机制显式映射到文档四层，主要在 `src/services/voice-assistant/.../capabilities.ts` 注释/文档标注：

- **L1 内生偏好层**：`defaultMode=always` 的低危能力（自由）。
- **L2 协商交互层**：`defaultMode=ask`（冲突/风险时协商，用户最终决策）。
- **L3 强制服从层**：管理员高优先级指令跳过协商。
- **L4 终极熔断层**：`DANGEROUS_COMMAND_PATTERNS` 硬拦截，**不依赖会话信任、任何人都不可绕过**（现状已满足，补显式注释 + 单测断言）。

---

## 6. 明确不做（边界，防止过度设计）

- **不实现**自我意识四层涌现、价值观自发涌现、内生目标叙事/日记。保持「情绪真涌现、自我不越界」的边界——文档的"赛博灵魂"部分本质是规则模拟，对桌宠属过度设计且易显诡异。
- **不引入图数据库**：记忆维持 SQLite + `LocalHashEmbedder`，不重写存储层。
- **不对 LLM 主脑微调/训练**：保持只读。

---

## 7. 实施顺序与验收总表

| 顺序 | 模块 | 性质 | 主要改动文件 |
|---|---|---|---|
| 1 | 模块二 主动记忆剪枝 | 稳定性 | `server/core/api_server.py`（周期调度既有 `apply_decay_all`）✅ 已落地 |
| 2 | 模块三 交感应激模式 | 性能 | `learning_scheduler.py`、`hermes_gateway_server.py` ✅ 已落地 |
| 3 | 模块四 白名单主动+简报 | 体验 | `behaviorConfig.ts`/`scheduler.ts`/`liveModePrompts.ts` ✅ 已落地 |
| — | 权限四层标注 | 文档化 | `capabilities.ts` 四层注释映射（L1–L4）✅ 已落地 |

> 每模块完成后单独跑 `pnpm exec tsc --noEmit`（前端）与 `py_compile`（后端）确认零错误，再进入下一模块。前端改动需在 `pnpm tauri dev` 真机复测。

---

## 8. 风险与缓解

- **后台循环占 CPU**：改为事件驱动、仅空闲期自调度（活跃期零轮询）；重活复用 `LearningScheduler._drain`，不另起 LLM worker；drift 纯数值阻尼 + 上限防「性格漂移过头」。
- **剪枝误删**：孤立节点先软标记再硬删；`is_permanent` 铁律跳过。
- **主动行为 creepy**：严格 `risk=low` 白名单 + 设置页可关 + 首次 ConsentGate。
- **双包混淆**：所有改动只动 `server/core/`（运行态），不碰 `server/hermes_core/`（仅 `SessionDB` 被引）。

---

## 9. 集成安全与防错（接轨保障）

为避免新增能力与现有代码冲突、产生新错误，各模块统一遵守以下铁律：

1. **只动运行态 `server/core/`**：`hermes_gateway_server.py` 仅从 `core.brain.*` / `core.session_service` 导入；`server/hermes_core/` 除既有 `SessionDB` 外不碰。新增文件只放 `server/core/autonomic/`、`server/core/brain/`。
2. **先核对再改**：实施每个模块前先 `Read` 目标文件确认真实方法签名（尤其 `circadian/drift/reunion` 的 `tick()`/`check()`、`LearningScheduler.start()/stop()/enqueue` 的真实签名），不猜测、不改内核逻辑。
3. **复用既有接口，不并行新建**：
   - 记忆读写走 `get_memory_service()` / 现有 store API，不清真 SQL（除非先确认列名）；pruner 优先复用 store 方法做软删。
   - 后台 LLM 抽取统一走 `LearningScheduler._drain`，`AutonomicLoop` 不另起 LLM 任务。
   - 主动行为 / 简报复用 `permissionManager.authorize` 与现有 `ProactiveScheduler` / `plugins`，绝不绕过权限闸。
4. **启停对齐**：`AutonomicLoop.start()/stop()` 严格照 `LearningScheduler` 的写法挂在 `startup_event` 与 shutdown，避免新增事件循环竞态。
5. **设置页三处同步**：模块四若新增开关，必须同步 `routes.tsx` loader + `settingsTree` + `pages/...` 三处，并写 zh-CN/en-US；改完跑 `npm run settings:check` 全绿。
6. **逐级验证**：每模块完成后单独跑 `pnpm exec tsc --noEmit`（前端）与 `python -m py_compile`（后端）；前端改动需在 `pnpm tauri dev` 真机复测；任一报错先修再进下一模块。
7. **非破坏约束**：`is_permanent` 铁律跳过；pruner 分批 ≤ 500 行；stress 模式只暂停不丢 `enqueue` 队列；主动行为默认可一键关闭。
