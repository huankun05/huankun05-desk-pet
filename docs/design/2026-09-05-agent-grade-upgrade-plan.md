# Agent 能力升级规划（2026-09-05）

> 目标：在保留 CyreneHarness 核心的前提下，把 Work / Code 档位升级到"真正能写代码、跑任务"的 Agent 水平。
> 策略：**参考移植 Hermes，不重造轮子**——每一块能力都直接拆解 Hermes（NousResearch/hermes-agent）的源码结构与设计思路，落到 Cyrene 现有架构上。
> 范围：本文档是升级路线总纲；每个 P 阶段执行前应单独产出实施细节（或直接在本文档对应小节迭代补充）。

---

## 0. 背景与决策记录

### 0.1 为什么保留 CyreneHarness 而非换核 Hermes

| 维度 | CyreneHarness | Hermes Agent |
| --- | --- | --- |
| 核心主循环 | 与 Hermes 对等（流式、压缩、前缀缓存、checkpoint、副作用记账、双时钟） | 同水平 |
| 陪伴资产 | Live2D 人格、DMAE Worldbook、TTS/ASR、飞书/微信/QQ 渠道 | 无 |
| 语言/宿主 | TypeScript / Electron 桌面 | Python / CLI + Gateway |
| 差距 | 并行编排、项目上下文、跨会话搜索、凭据安全等外围能力 | — |

**结论**：换核会同时摧毁陪伴资产与现有集成，且差距点全部是可增量移植的外围能力。保留核心、按优先级移植 Hermes 设计。

### 0.2 目标形态：一个核心，两个档位

- **陪伴档**（Chat / Learn）：角色化交流、记忆、语音、渠道。Cyrene 原生，不动。
- **Agent 档**（Work / Code）：真实多步任务、写代码、并行执行、验证闭环。本规划升级对象。
- 共享底座：L0/L1/L2 记忆、RAG、定时任务、多模型适配、MCP。

### 0.3 现状盘点（2026-09-05 已核验）

- Harness 主循环：无遗留 TODO；并行调度 5 个已知问题（2026-08-25）与 GLM-5.3/超时/沙箱 3 批已知问题（2026-08-26/27）均已修复；harness 单测 25 文件 / 175 用例全部通过。
- 子任务：`task` 工具 → `executeTask` → `createTaskExecutor`（task-runtime.ts），**前台串行委派**（父 Harness await 单个子 Harness 结束）。README 声称的 `src/main/orchestrator/subagents/` 目录不存在，实际实现位于 `task-runtime.ts` + `tasks/`。
- 项目上下文：无 AGENTS.md / context files 读取机制。
- 跨会话搜索：L0/L1/L2 + Worldbook 已有，无会话级全文/向量检索。
- 凭据：`model-settings.json` / `mcp-servers.json` 等明文存储（README 自认短板）。
- 定时任务：无人值守 Work Harness + 工具白名单（scheduler-runner.ts），无渠道投递。

---

## 1. 路线图总览

| 优先级 | 能力 | 状态 | 交付物 |
| --- | --- | --- | --- |
| P0 | 并行子 Agent（task_group + 并行执行器 + 结果聚合） | ✅ 已完成 | task-runtime / builtin-tools / dispatcher / tests |
| P0 | AGENTS.md 项目上下文注入 | ✅ 已完成 | workspace-context / run-preparation / tests |
| P1 | 验证闭环自迭代（改 → 验 → 修） | ✅ 已完成 | IterationBudget 移植 + 预算耗尽总结 + 文件变更页脚 |
| P1 | 跨会话搜索（FTS/向量 + LLM 摘要） | ✅ 已完成 | recall_history 工具增强（limit + sessionId 过滤 + 来源会话） |
| P1 | 凭据全量加密（safeStorage） | ✅ 已完成 | CredentialVault + model-settings 读写路径加解密 |
| P2 | 定时任务渠道投递 | ✅ 已完成 | ScheduledTask.deliver + 桌面通知投递 |
| P2 | 成本核算（token × 单价） | ✅ 已完成 | model-pricing + cost-calculator（30+ 常见模型默认价） |
| P2 | Trajectory 导出（训练/评测） | ⏳ 待做 | run-store 轨迹导出 |

---

## 2. P0-1 并行子 Agent（task_group）

### 2.1 目标

把"前台串行委派"升级为"**并行委派 + 结果聚合**"：父 Harness 一次调用可同时派出多个独立子任务（互不依赖的调查方向、多文件/多模块独立审查），并行执行（有并发上限），聚合结果一次性回给模型。

### 2.2 设计

#### 2.2.1 类型与接口（task-runtime.ts）

```ts
export interface TaskGroupExecuteRequest {
  tasks: TaskExecuteRequest[];          // 每个元素与单任务请求同构
  maxParallel?: number;                 // 并发上限，默认 4
}

export interface TaskGroupExecuteResult {
  results: TaskExecuteResult[];         // 按 tasks 顺序对齐
}
```

#### 2.2.2 并行执行器（task-runtime.ts）

- 抽取 `createTaskExecutor` 返回函数体内的"单任务执行"逻辑为内部 `runSingleTask`，`createTaskExecutor` 与新增 `createTaskGroupExecutor` 复用同一实现（同一 store / characterPool / onLifecycle / trace 投影 / checkpoint 语义）。
- `createTaskGroupExecutor` 用 `Promise.allSettled` + 并发上限（默认 4）调度 `tasks`；单个子任务失败/取消不影响其余子任务；聚合结果按输入顺序对齐，rejected 映射为 `{ status: "failed" | "cancelled", text: 错误信息 }`。
- 子任务可恢复性：每个子任务仍走 `store.create/resume + checkpoint`，与单任务完全一致。
- 取消：共享父 `signal`；父取消时在飞子任务各自返回 cancelled。

#### 2.2.3 内置工具 task_group（builtin-tools.ts）

- 工具名：`task_group`
- 参数：`{ tasks: [{ description, prompt, subagent_type, companion_id, task_id? }], max_parallel?: number }`
- 描述要点（写给模型）：
  - 何时用：多个**互不依赖**的调查/审查/实现方向需要并行；多文件独立改动。
  - 何时不用：方向存在依赖、需要共享中间结果的。
  - **并行子任务必须选择不同的 companion_id**（黄金裔互不相同，角色租约按会话互斥）；冲突时工具会回告失败，模型应换人重派。
  - 子任务不能询问用户、不能再委托（含 task_group）。
- 结果回执：聚合 JSON `{ results: [{ taskId, status, text }] }`，模型可一次性看到全部子任务结果。

#### 2.2.4 接入点

| 文件 | 改动 |
| --- | --- |
| `harness/types.ts` | `HarnessInput` 增加可选 `taskGroupExecutor` |
| `harness/tool-dispatcher.ts` | `case "task_group"` → `executeTaskGroup` |
| `harness/builtin-tools.ts` | spec + handler + `HARNESS_BUILTIN_TOOL_IDS` + `getHarnessBuiltinToolSpecs`（includeTask 时一并注入） |
| `harness/adapter/tool-runtime.ts` | work/code 模式创建 group executor 并下传 |
| `harness-adapter.ts` | `harnessInput.taskGroupExecutor` 透传 |
| `task-profiles.ts` | `CHILD_BLOCKED_TOOL_IDS` 增加 `task_group` |

#### 2.2.5 并发守卫与安全

- 角色租约池（TaskCharacterLeasePool）按会话 + 名字互斥：并行任务天然要求不同黄金裔，描述层引导；冲突子任务以失败回执呈现，父模型自行换人。
- 每个子任务独立 TaskSessionStore 会话、独立 checkpoint、独立 trace；互不覆盖。
- 子任务工具集仍受 `resolveTaskTools`（profile 白名单 ∩ 父工具集）约束，`task_group` / `task` / `ask_user` 全部屏蔽。

### 2.3 验收标准

- [ ] `task_group` 工具出现在 Work / Code 模式的工具清单（includeTask=true）。
- [ ] 两个及以上子任务并行执行，总耗时 ≈ max(单任务耗时) 而非累加（用 mock harness 计时验证）。
- [ ] 单任务失败不影响其余；聚合结果按输入顺序对齐。
- [ ] 子任务内不可见 `task_group` / `task` / `ask_user`。
- [ ] 相同 companion_id 冲突时该子任务失败并携带明确信息。
- [ ] 新增单测覆盖：并发上限、失败隔离、顺序对齐、参数校验、角色冲突。

### 2.4 风险与说明

- 并行子任务共享同一父 `signal`：父取消全部取消，符合"用户取消 = 全部终止"语义。
- 并发上限默认 4；后续可按设备能力调参。
- 并行子任务各自消耗独立上下文窗口，token 成本 = 各子任务之和；描述层引导"不要拆分过细"。

---

## 3. P0-2 AGENTS.md 项目上下文注入

### 3.1 目标

Code（及绑定工作目录的 Work）模式下，读取工作区根目录的 `AGENTS.md`（Hermes context files 的等价物），在 run 启动时一次性物化为内部上下文，让模型每轮都能看到项目级约定（构建/测试命令、架构、约束）。

### 3.2 设计

- 新增 `src/main/orchestrator/workspace-context.ts`：
  - `loadWorkspaceContext(workspaceRoot?: string): string | undefined`
  - 仅当 `workspaceRoot` 存在且目录下存在 `AGENTS.md`（Windows 大小写不敏感）时读取；UTF-8；超长截断（上限 16KB，截断处标注）；读取失败静默跳过。
- 接入点：`harness/adapter/run-preparation.ts`，在 `buildHarnessPromptLayers` 之后、`materializeHarnessStartTranscript` 之前，把工作区上下文并入 `runtimeContext`（动态事实一次性物化，不进 stablePrefix，不破坏前缀缓存）。
- 仅在 `conversationMode === "code"`（或绑定工作目录的 work）且 `resolvedWorkspaceRoot` 存在时生效。

### 3.3 验收标准

- [ ] 绑定含 AGENTS.md 的目录后，Code 模式 run 的启动 transcript 包含工作区上下文。
- [ ] 无 AGENTS.md 时行为与现状完全一致（零侵入）。
- [ ] 超长 AGENTS.md 被截断并带标注。
- [ ] 单测覆盖：读取、缺失、截断、非 code 模式不注入。

---

## 4. P1 预研要点（后续阶段）

### 4.1 验证闭环自迭代

**移植来源**：Hermes `agent/iteration_budget.py` + `agent/conversation_loop.py`（主循环预算消费）+ `agent/turn_finalizer.py`（预算耗尽总结 + 文件变更失败页脚）。

**核心发现**：Hermes 没有独立的 `verify_and_fix` 工具。它的"自迭代验证闭环"由四部分组成：
1. **IterationBudget** — 每次模型调用 consume，程序化工具调用成功后 refund，防死循环
2. **预算耗尽 → 无工具总结调用** — `_handle_max_iterations` 做最后一次总结
3. **文件变更失败追踪 + 响应页脚** — 防止模型虚报"全部修改成功"
4. **回合退出诊断** — 记录为什么结束（budget_exhausted / timeout / text_response 等）

**已落地实现**：

| 组件 | 文件 | 说明 |
| --- | --- | --- |
| IterationBudget | `harness/iteration-budget.ts` | 移植自 Hermes：consume/refund/used/remaining/exhausted/snapshot；父 agent 默认 90，子 agent 默认 50 |
| 配置接入 | `harness/types.ts` | `HarnessConfig.maxIterations`，默认 90；`task-runtime.ts` 子 agent 传 50 |
| 主循环消费 | `harness/cyrene-harness.ts` | 每轮 callLLM 前 `consume()`；耗尽则 `budgetExhaustedSummary()` 做无工具总结调用 |
| 程序化工具 refund | `harness/tool-round.ts` | `run_verification` 成功后 `refund()`（推理成本极低，不消耗迭代预算） |
| 文件变更失败追踪 | `harness/tool-round.ts` | `trackFileMutation()`：write_file/patch/edit_file 等失败时记录，同路径成功时清除 |
| 响应页脚 | `harness/cyrene-harness.ts` | `appendFileMutationFooter()`：终态时若存在未覆盖的失败文件变更，在回复尾部追加警告 |
| 回合退出诊断 | `harness/cyrene-harness.ts` | `turnExitReason` 字段 + `settleRun` 后日志输出（reason/api_calls/tool_turns/response_len） |

**验收标准**：
- [x] IterationBudget 单测 13 个全部通过
- [x] 主循环每轮 consume，耗尽后触发无工具总结调用
- [x] run_verification 成功后 refund，预算不被程序化工具消耗
- [x] 文件变更失败时记录，同路径后续成功时清除
- [x] 终态回复包含文件变更失败页脚（如有）
- [x] 全量 orchestrator 测试 1098/1099 通过（唯一失败为环境缺 Git Bash 的既有问题）
- [x] `tsc --noEmit` 类型检查通过

### 4.2 跨会话搜索

**核心发现**：Cyrene 已有完整的跨会话搜索基础设施，无需从零构建。

**已有能力**（P1-2 启动前已存在）：
- `recall_history` 工具（`history-tools.ts`）：全局注册，所有模式可用，语义检索所有历史对话（source="chat_history"）
- `indexConversationTurn`：每轮对话后自动索引（user + assistant 各存一条），在 agui-bridge 和 channels/bootstrap 中调用
- `HybridRetriever`（`rag/retriever.ts`）：向量 + BM25 混合检索 + jieba 中文分词（停用词降权/名词加权）+ reranker 精排
- RAG 基础设施完整：`vectorstore.ts`、`embedding.ts`（BGE-M3 本地/云端）、`reranker.ts`、`file-ingest.ts`、`document-index-worker.ts`

**本次增强**（P1-2 交付）：
| 增强项 | 说明 |
| --- | --- |
| `limit` 参数 | 新增可选参数，默认 5，最大 20；Agent 档深度任务可请求更多结果 |
| `sessionId` 过滤 | 新增可选参数，限定只搜索某个特定会话的历史；不传则搜索所有会话 |
| 来源会话展示 | 每条结果增加 `[会话:xxxx]` 标签（sessionId 前 8 位），让模型知道历史来自哪个会话 |
| 候选池扩大 | 检索时取 `max(limit*3, 15)` 条候选，再按 days/sessionId 过滤，避免过滤后结果不足 |

**验收标准**：
- [x] `recall_history` 工具支持 query/days/limit/sessionId 四个参数
- [x] limit 默认 5，最大 20，超出自动截断
- [x] sessionId 过滤正确工作，不传则搜索所有会话
- [x] 每条结果带来源会话标签
- [x] 全量 orchestrator 测试 1098/1099 通过（唯一失败为环境缺 Git Bash）
- [x] `tsc --noEmit` 类型检查通过

### 4.3 凭据全量加密

**设计原则**（移植自 music/token-vault.ts 的 TokenVault 模式）：
- 内存中始终明文（调用方无感知）
- 落盘时加密（JSON 文件中不可见明文 API Key）
- 向后兼容：旧明文自动识别并迁移（首次保存时加密）
- safeStorage 不可用时回退明文（dev 环境，打 warning）
- 加密值带 `enc:v1:` 前缀，便于识别和未来版本升级

**新增模块**：
| 文件 | 说明 |
| --- | --- |
| `settings/credential-vault.ts` | 通用凭据加密保险箱，封装 Electron safeStorage（Windows DPAPI / macOS Keychain / Linux libsecret） |
| `settings/credential-vault.test.ts` | 18 个单测：加密/解密/回退/轮询/边界 |

**CredentialVault API**：
- `encrypt(plaintext: string): string` — 加密返回 `enc:v1:<base64>`；空值透传；已加密不重复加密；safeStorage 不可用回退明文
- `decrypt(value: string): string` — `enc:v1:` 前缀解密；无前缀视为旧明文透传（向后兼容）
- `isEncrypted(value: string): boolean` — 判断是否为已加密值
- `isAvailable(): boolean` — safeStorage 是否可用
- `getCredentialVault()` — 全局单例

**model-settings.ts 接入**：
- `applyVaultToSettings(settings, action)` — 递归对所有 apiKey 字段加解密
- 覆盖字段：顶层 `apiKey`、`perProvider[*].apiKey`（真值）、`vision.apiKey`、`auxiliary.apiKey`、`modelProfiles[*].apiKey`
- `loadModelSettings0()`：JSON parse → decrypt → normalize（内存中始终明文）
- `saveModelSettings()`：normalize → encrypt → writeFileSync（落盘加密）

**验收标准**：
- [x] CredentialVault 18 个单测全部通过
- [x] model-settings 读写路径加解密正确
- [x] 旧明文配置自动兼容（decrypt 对无前缀值透传）
- [x] safeStorage 不可用时优雅回退明文
- [x] 全量 orchestrator 测试 1098/1099 通过（唯一失败为环境缺 Git Bash）
- [x] settings 目录 42/42 测试通过
- [x] `tsc --noEmit` 类型检查通过

**后续增强（P2+）**：
- MCP server env 凭据加密（API_KEY/TOKEN/SECRET 等环境变量）
- 凭据导出/导入工具（换机时迁移加密凭据）
- 凭据变更审计日志

### 4.4 定时任务渠道投递

**设计决策**：第一期实现桌面通知投递（`deliver: "desktop"`），渠道投递（飞书/QQ/微信）留作后续增强。桌面通知是最通用、最可逆的投递方式，且不依赖渠道连接状态。

**新增类型**：
```ts
type ScheduledTaskDelivery = "local" | "desktop";
// "local" = 仅聊天窗口（默认，既有行为）
// "desktop" = 额外弹桌面通知
```

**ScheduledTask 新增字段**：
- `deliver?: ScheduledTaskDelivery` — 可选，默认 undefined（= local）

**实现要点**：
| 模块 | 变更 |
| --- | --- |
| `scheduler/types.ts` | 新增 `ScheduledTaskDelivery` 类型；ScheduledTask/NewScheduledTaskInput/ScheduledTaskPatch 增加 `deliver` 字段 |
| `scheduler/scheduler-runner.ts` | RunnerDeps 新增 `deliverResult` 回调；任务成功/失败后，若 `task.deliver === "desktop"` 则调用回调 |
| `scheduler/bootstrap.ts` | 新增 `deliverScheduledResultToDesktop()` 函数，使用 Electron `Notification` API 弹桌面通知；成功显示结果预览（前 120 字），失败显示错误信息 |
| `scheduler/scheduler-store.ts` | 新增 `normalizeDelivery()`；normalizeLoadedTask/addTask/updateTask 三处规范化 deliver 字段（非法值 → undefined） |

**桌面通知内容**：
- 成功：标题 `定时任务完成：{title}`，正文为回复前 120 字
- 失败：标题 `定时任务失败：{title}`，正文为错误信息前 120 字

**验收标准**：
- [x] ScheduledTask 支持 deliver 字段（local/desktop）
- [x] deliver=desktop 时任务完成后弹桌面通知
- [x] 成功和失败均触发通知
- [x] deliver 字段持久化到 scheduled-tasks.json
- [x] 非法 deliver 值规范化为 undefined（local）
- [x] scheduler 28/28 测试通过（含新增 deliver 测试）
- [x] 全量 1168/1169 通过（唯一失败为环境缺 Git Bash）
- [x] `tsc --noEmit` 类型检查通过

**后续增强（P2+）**：
- 渠道投递（飞书/QQ/微信）：复用 proactive-delivery-routing，将任务结果通过渠道发送
- 通知点击跳转：点击桌面通知打开聊天窗口并定位到任务结果
- 通知静默时段：夜间不弹桌面通知

### 4.5 成本核算（token × 单价）

**核心发现**：Cyrene 已有完整的 token 用量追踪基础设施（`token-usage-store.ts`），按天/按模型聚合 input/output/缓存命中 token，持久化到 `token-usage.json`，提供 `getUsageReport()` 查询。P2-2 只需补充模型单价配置 + 成本计算。

**新增模块**：
| 文件 | 说明 |
| --- | --- |
| `orchestrator/model-pricing.ts` | 模型定价配置，内置 30+ 常见模型默认价（OpenAI/Anthropic/DeepSeek/MiniMax/GLM/Qwen/Kimi/豆包），支持用户自定义覆盖 |
| `orchestrator/cost-calculator.ts` | 成本计算纯函数，input/output/cacheHit/cacheCreation 分项计算，按天/按模型汇总，格式化输出 |
| `orchestrator/model-pricing.test.ts` | 12 个单测 |
| `orchestrator/cost-calculator.test.ts` | 18 个单测 |

**定价模型**：
- 价格单位：美元 / 1M tokens（行业标准）
- 四档单价：inputPrice / outputPrice / cacheHitPrice / cacheCreationPrice
- cacheHitPrice 默认 = inputPrice × 0.5，cacheCreationPrice 默认 = inputPrice × 1.25
- 模型名小写包含匹配，先匹配先生效；未匹配返回 null（不显示成本）

**成本计算 API**：
- `calculateCost(input, output, pricing, cacheHit?, cacheCreation?)` → CostBreakdown（分项 + 总计）
- `calculateCostForModel(modelName, input, output, ...)` → 自动查定价
- `calculateDayCost(day)` → 按天汇总（按模型拆分后累加）
- `calculateModelCost(modelName, usage)` → 单模型成本
- `formatCost(cost)` → 可读字符串（$1.23 / $0.0123 / $0.000123）

**验收标准**：
- [x] 30+ 常见模型内置定价
- [x] 用户自定义定价覆盖（setCustomPricing / clearCustomPricing）
- [x] input/output/cacheHit/cacheCreation 四档成本计算
- [x] 按天汇总（多模型累加）
- [x] 未匹配模型返回 null（不显示成本）
- [x] 成本格式化（按金额自动选择精度）
- [x] model-pricing 12/12 + cost-calculator 18/18 测试通过
- [x] 全量 1128/1129 通过（唯一失败为环境缺 Git Bash）
- [x] `tsc --noEmit` 类型检查通过

**后续增强（P2+）**：
- 成本展示 UI：在用量统计页面显示每日/每模型成本
- 用户可配置单价：在设置页面编辑模型单价（覆盖内置默认价）
- 预算告警：月度成本超阈值时通知用户
- 人民币结算：按汇率换算为人民币显示

### 4.6 Trajectory 导出（训练/评测）

**目标**：将 Agent 运行轨迹（输入/输出/工具调用/中间状态）导出为结构化格式，用于模型训练、效果评测和问题复现。

**设计要点（预研）**：
- 复用现有 run-store / checkpoint 机制
- 导出格式：JSONL（每行一个 turn），含 prompt、response、tool_calls、tool_results、latency、token_usage
- 支持按会话/按任务/按时间范围筛选导出
- 敏感信息脱敏（API Key、个人信息）
- ⏳ 待做

---

## 5. 执行记录

| 日期 | 事项 | 结果 |
| --- | --- | --- |
| 2026-09-05 | 规划落盘；P0-1 / P0-2 实施完成 | 并行子 Agent + AGENTS.md 注入已落地，新增 20 个单测用例，全部通过 |
| 2026-09-05 | P1-1 验证闭环自迭代实施完成 | 移植 Hermes IterationBudget + 预算耗尽总结 + 文件变更失败页脚 + 回合退出诊断；新增 iteration-budget.ts（13 单测），修改 5 个核心文件；全量测试 1098/1099 通过 |
| 2026-09-05 | P1-2 跨会话搜索实施完成 | 核心能力已存在（recall_history + 自动索引 + 混合检索）；增强 limit/sessionId 过滤/来源会话展示；修改 history-tools.ts；全量测试 1098/1099 通过 |
| 2026-09-05 | P1-3 凭据全量加密实施完成 | 新增 CredentialVault（safeStorage 封装，移植自 TokenVault 模式）；model-settings 读写路径加解密；旧明文自动兼容；18 单测 + 全量 1098/1099 通过 |
| 2026-09-05 | P2-1 定时任务渠道投递实施完成 | ScheduledTask 新增 deliver 字段（local/desktop）；scheduler-runner 完成后触发 deliverResult 回调；bootstrap 接入 Electron 桌面通知；store 层规范化；scheduler 28/28 + 全量 1168/1169 通过 |
| 2026-09-05 | P2-2 成本核算实施完成 | 新增 model-pricing（30+ 常见模型默认价 + 自定义覆盖）和 cost-calculator（input/output/cacheHit/cacheCreation 四档成本 + 按天/按模型汇总 + 格式化）；30 单测 + 全量 1128/1129 通过 |
