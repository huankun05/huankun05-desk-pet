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

## 1. 模块一：后台自驱循环接入（副交感模式）

### 1.1 现状
- `server/core/time/circadian.py`（昼夜节律）、`server/core/soul/drift.py`（人格漂移）、`server/core/time/reunion.py`（纪念日）**代码已存在**。
- 入口 `server/hermes_gateway_server.py` 的 `startup_event` 只 `learning_scheduler.start()`（约 line 335），**未启动上述三者**。
- 聊天完成处（line 1075 `learning_scheduler.enqueue(...)`）是唯一挂点。

### 1.2 设计
新增统一后台节拍器，与 `LearningScheduler` 同生命周期：

- **新增文件** `server/core/autonomic/loop.py`，类 `AutonomicLoop`：
  - `start()`：起一个 `asyncio` 节拍任务（默认 30s 一次）。
  - 维护 `last_interaction_ts`：在聊天完成 `enqueue` 处更新；新增 `mark_interaction()` 供其他交互（语音/面板）调用。
  - **idle 判定**：`now - last_interaction_ts > IDLE_THRESHOLD`（默认 120s）→ 进入「副交感模式」。
  - 节拍逻辑：
    - 非 idle（交感）：仅保活，不做重活。
    - idle（副交感）：依次调用 `circadian.tick()`（更新昼夜相位）、`drift.tick()`（人格漂移沉淀到 L3 persona）、`reunion.check()`（纪念日到点触发事件）。
    - tick 产物写入 persona 状态；经 emotion 引擎让前端 Live2D 出现「心境残留」。
  - `stop()`：cancel 任务，配合现有 shutdown（line 347 附近）对齐。
- **实现时核对**：上述模块若未暴露 `tick()/check()` 式统一入口，则补一个轻量封装函数（不改动其内核逻辑）。
- **改动文件**：`server/hermes_gateway_server.py`（启动/关停各加 2–3 行）、`server/core/autonomic/loop.py`（新增）。

### 1.3 验收
- 后端空转 5 分钟后，persona 漂移值 / 昼夜相位发生变化（查日志或状态接口）。
- 纪念日模拟到点能触发事件。
- 关闭后端无残留 `asyncio` task（无警告）。

---

## 2. 模块二：主动记忆剪枝（泌尿系统）

### 2.1 现状
- `memory_fragments` 表字段：`importance`、`access_count`、`is_permanent`、`is_stale(14d)`、`l0_keep=200`。
- 仅有「软重要性 + 过期」召回加权（`librarian.py`），**无定时真删**，长期日用会膨胀。

### 2.2 设计
- **新增文件** `server/core/brain/pruner.py`，类 `MemoryPruner`：
  - 触发：① 后端启动一次；② 每日定时（`circadian` 午夜 tick 时）或空闲时各跑一次。
  - 规则（按优先级）：
    1. `is_permanent == 1` → 跳过。
    2. L0 原始层：`(SELECT COUNT WHERE layer=L0) > l0_keep(200)` → 超出部分按 `created_at` 升序删最旧。
    3. 普通层：`importance < LOW_IMP(0.2)` 且 `last_accessed > STALE_DAYS(14)` → 删。
    4. 孤立节点：`access_count == 0` 且 `age > ORPHAN_DAYS(30)` → 候选删（先标记 `pruned=1`，隔日观察无关联召回再硬删，防误伤）。
  - 执行：分批（每批 ≤ 500 行），删完 `VACUUM`（SQLite 小，安全）。
  - 输出：统计日志（删除数 / 保留数），供模块四「每日状态简报」引用。
- **改动文件**：`server/core/brain/pruner.py`（新增）、`server/core/autonomic/loop.py`（在 idle/午夜时调用）。

### 2.3 验收
- 注入 ≥ 1000 条低价值记忆后，运行 pruner，表行数明显下降。
- 高 `importance` 与 `is_permanent` 记录全部保留。
- 无 DB 锁异常。

---

## 3. 模块三：交感应激模式

### 3.1 现状
`LearningScheduler._drain` 后台抽取不区分系统负载，繁忙时仍抢占资源。

### 3.2 设计
- 在 `LearningScheduler` 增加负载感知（不新增外部依赖，用进程内信号）：
  - 信号源：① 进行中的聊天/STT 任务计数（`engine` 或 gateway 已有计数处）；② 可选 `psutil` 进程数（若已装）。
  - `set_load(level: "calm"|"stress")` 或读全局 `autonomic_state`。
  - 应激（`stress`，如并发任务 > 阈值）：暂停后台 `_drain` 抽取循环（sleep，不丢 `enqueue` 队列），收紧并发。
  - 恢复 `calm`：自动继续抽取。
- **改动文件**：`server/core/brain/learning_scheduler.py`、`server/hermes_gateway_server.py`（在任务开始/结束时发 `set_load`）。

### 3.3 验收
- 模拟高负载（并发请求）时，后台抽取暂停（日志可见 `stress paused`）。
- 负载恢复后自动继续，已 enqueue 的条目不丢。

---

## 4. 模块四：白名单静默主动 + 每日状态简报

### 4.1 现状
- `src/services/proactive/scheduler.ts` 的 `ProactiveScheduler`：`DEFAULT_CONFIG.enabled = false`（默认关）。
- 已有提醒插件：`dailyGreeting` / `waterReminder` / `eyeCare` / `pomodoro` / `sedentaryReminder` 等。
- 权限闸 `permissionManager.authorize` 已就绪。

### 4.2 设计
- **默认改为「白名单模式开启」**：`enabled = true`，但仅允许 `risk = low` 的内生行为（上述提醒插件）。首次启用仍弹 `ConsentGate`（复用现有 `permissionManager`）。
- **新增「每日状态简报」**：
  - 后端（`circadian` 本地 21:00 tick 或 idle 时）生成当日摘要：情绪走势、今日新学记忆数、交互轮次、待办。
  - 经 Chat Pipeline 推一条消息或写入状态面板；**全程本地、无外部写操作**（走白名单）。
  - 简报内容可引用模块二的 pruner 统计。
- 域外行为（联网检索 / 文件修改 / 设备操作）仍走 `permissionManager` 强制 `ask`/`deny`，绝不被白名单放行。
- **改动文件**：`src/services/proactive/scheduler.ts`（默认白名单开启 + 简报调度）、`server/core/...`（简报数据聚合，可并入 `AutonomicLoop`）、设置页（新增开关，沿用 `deskpet_*` 存储键约定）。

### 4.3 验收
- 默认开启后宠物主动发低风险提醒且不触发任何外部写。
- 每日状态简报生成，内容包含当日统计，无外部 API 调用。
- 设置页可一键关闭全部主动行为。

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
| 1 | 模块一 后台自驱循环 | 活体感核心 | `server/core/autonomic/loop.py`（新）、`hermes_gateway_server.py` |
| 2 | 模块二 主动记忆剪枝 | 稳定性 | `server/core/brain/pruner.py`（新）、`autonomic/loop.py` |
| 3 | 模块三 交感应激模式 | 性能 | `learning_scheduler.py`、`hermes_gateway_server.py` |
| 4 | 模块四 白名单主动+简报 | 体验 | `proactive/scheduler.ts`、`autonomic/loop.py`、设置页 |
| — | 权限四层标注 | 文档化 | `capabilities.ts` 注释 + 断言 |

> 每模块完成后单独跑 `pnpm exec tsc --noEmit`（前端）与 `py_compile`（后端）确认零错误，再进入下一模块。前端改动需在 `pnpm tauri dev` 真机复测。

---

## 8. 风险与缓解

- **后台循环占 CPU**：节拍频率锁 30s，重活仅在 idle 跑；drift 加阻尼/上限防「性格漂移过头」。
- **剪枝误删**：孤立节点先软标记再硬删；`is_permanent` 铁律跳过。
- **主动行为 creepy**：严格 `risk=low` 白名单 + 设置页可关 + 首次 ConsentGate。
- **双包混淆**：所有改动只动 `server/core/`（运行态），不碰 `server/hermes_core/`（仅 `SessionDB` 被引）。
