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
| P2 | Trajectory 导出（训练/评测） | ✅ 已完成 | trajectory-exporter（JSONL + 脱敏 + 筛选） |
| P3 | 工具重复失败检测（护栏） | ✅ 已完成 | tool-guardrail（移植 Hermes tool_guardrails） |
| P3 | execute_code 独立代码执行工具 | ✅ 已完成 | execute-code-tool（复用 run_shell 安全逻辑，Python/Node/Shell） |
| P3 | 后台 LLM 审查 | ✅ 已完成 | llm-reviewer（prompt 构建 + 结果解析 + 审查执行 + 持久化）+ harness-adapter 可注入回调 |
| P4 | 文件安全黑名单 | ✅ 已完成 | file-safety（移植 Hermes file_safety，敏感路径+目录前缀，读写双向拦截）+ fs-tools 集成 |
| P4 | 流式思维链清理 | ✅ 已完成 | think-scrubber（移植 Hermes think_scrubber，状态机+部分标签暂存+块边界规则），核心模块+39测试 |

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

**核心发现**：Cyrene 已有完整的聊天会话存储（`chats-store.ts`），按会话持久化到 `cyrene-chats/sessions/<id>.json`，每条 `ChatMessage` 含 role/content/reasoning/toolExecutions/contextUsage 等丰富字段。P2-3 只需新增导出层，将会话转换为结构化 JSONL。

**新增模块**：
| 文件 | 说明 |
| --- | --- |
| `chats/trajectory-exporter.ts` | Trajectory 导出模块，纯函数转换 + 文件写入 |
| `chats/trajectory-exporter.test.ts` | 19 个单测 |

**导出格式（JSONL，每行一个 turn）**：
```json
{
  "session_id": "...",
  "session_title": "...",
  "session_mode": "chat|work|code|learn",
  "turn_index": 0,
  "role": "user|assistant|system|tool",
  "content": "...",
  "reasoning": "...",
  "tool_calls": [{"id": "...", "name": "...", "arguments": "..."}],
  "tool_results": [{"tool_call_id": "...", "content": "...", "is_error": false}],
  "timestamp": 1700000000000,
  "token_usage": {"input": 100, "output": 50, "total": 150}
}
```

**核心 API**：
- `sanitizeText(text)` — 敏感信息脱敏（API Key/Bearer Token/password/token/secret）
- `messageToTrajectoryTurn(message, session, turnIndex, sanitize?)` — 单条消息转换
- `sessionToTrajectory(session, options?)` — 会话转换（支持 since/until 时间过滤）
- `exportTrajectory(sessions, getSession, options?)` — 完整导出（支持 sessionId/mode/时间范围筛选 + 文件写入）

**筛选选项**：
- `sessionId` — 只导出指定会话
- `mode` — 只导出指定模式（chat/work/code/learn）
- `since` / `until` — 时间范围过滤（epoch ms）
- `sanitize` — 是否脱敏（默认 true）
- `outputPath` — 输出文件路径；不传则返回记录数组

**验收标准**：
- [x] JSONL 格式导出，每行一个 turn
- [x] 包含 session 元数据 + turn 内容 + 工具调用/结果 + token 用量
- [x] 敏感信息脱敏（API Key/Token/密码）
- [x] 按会话/模式/时间范围筛选
- [x] 纯函数转换 + 文件写入分离，易于测试
- [x] 19/19 单测通过
- [x] 全量 1171/1172 通过（唯一失败为环境缺 Git Bash）
- [x] `tsc --noEmit` 类型检查通过

**后续增强（P3+）**：
- IPC 接口：前端 UI 触发导出（选择会话/时间范围）
- 导出格式扩展：支持 OpenAI JSONL / ShareGPT 格式
- 增量导出：只导出上次导出之后的新消息
- 导出压缩：大会话自动 gzip 压缩

---

## 4. P3 深度对标 Hermes（2026-09-05 新增）

### 4.0 背景：真实差距重审

P0-P2 完成后，用户质疑"对比 Hermes 我们这些都已经补齐了吗？"。经深度通读 Hermes 源码（agent/ 150+ 文件、tools/ 100+ 文件）并逐项对照 Cyrene 现有实现，发现：

**Cyrene 实际已具备的能力（此前被低估）**：
- 上下文压缩：`compaction.ts`（循环内压缩 + 配对安全切点 + Agent 导向摘要）
- 沙箱执行：`sandbox-exec.ts`（基于 Anthropic SRT 的 Windows 沙箱 + 5 档权限）
- 记忆系统：`memory/` 30+ 文件（L0/L1/L2 三层 + 冲突检测 + RAG + DMAE 集成 + Obsidian 导入导出）— **比 Hermes 更复杂**
- 错误分类：`error-classifier.ts`（9 种错误分类）
- 重试策略：`retry-policy.ts`（按错误 + 副作用分类 + 退避抖动）
- 不确定效果守卫：`uncertain-effect-guard.ts`（副作用指纹拦截）
- 文件变更审查：`run-review-tracker.ts`（快照 + diff + 原子落盘）
- 权限策略：`permission-policy.ts`（5 档 6 级）

**真正缺失的 3 项（P3 目标）**：
1. 工具重复失败检测（Hermes `tool_guardrails.py`：exact_failure_block + same_tool_failure_halt + idempotent_no_progress_block）
2. execute_code 独立代码执行工具（Hermes `code_execution_tool.py`：子进程隔离 + RPC + 工具白名单 + 环境清洗）
3. 后台 LLM 审查（Hermes `background_review.py`：LLM 驱动的后台审查线程）

### 4.1 P3-1 工具重复失败检测（护栏）

**移植来源**：Hermes `agent/tool_guardrails.py`（ToolCallGuardrailController）

**核心设计**：
- 每轮（turn）重置计数，避免跨轮误杀
- `before_call`：执行前检查，返回 allow/warn/block/halt
- `after_call`：执行后记录失败/成功，用于下一轮检测
- 三类检测：
  1. **exact_failure_block**：相同工具 + 相同参数失败 N 次（默认 3）→ block 该次调用
  2. **same_tool_failure_halt**：同一工具（任意参数）失败 N 次（默认 5）→ halt 本轮
  3. **idempotent_no_progress_block**：只读工具相同参数返回相同结果 N 次（默认 3）→ block

**新增模块**：
| 文件 | 说明 |
| --- | --- |
| `harness/tool-guardrail.ts` | ToolCallGuardrailController + 纯函数（normalizeToolArgs / classifyToolFailure / isIdempotentTool） |
| `harness/tool-guardrail.test.ts` | 31 个单测：规范化 / 失败分类 / 幂等判断 / 精确失败 block / 同工具失败 halt / 无进展 block / 成功清除 / 每轮重置 / warn 去重 / snapshot |

**接入点**：
| 文件 | 改动 |
| --- | --- |
| `harness/cyrene-harness.ts` | HarnessRun 新增 `toolGuardrail` 字段；每轮 round_start 后调用 `resetForTurn()` |
| `harness/tool-round.ts` | `executeToolCallWithRetry` 中 dispatch 前调用 `beforeCall()`，block/halt 直接返回 not_executed；执行后调用 `afterCall()` 记录结果 |
| `harness/tool-dispatcher.ts` | ToolDispatchResult 新增可选 `guardrailHalt` 字段 |
| `harness/tool-round.ts` | `commitToolResult` 中检查 `guardrailHalt`，为 true 则返回 "halt" |

**配置默认值**（移植自 Hermes）：
- exactFailureBlockAfter: 3
- exactFailureWarnAfter: 2
- sameToolFailureHaltAfter: 5
- sameToolFailureWarnAfter: 3
- noProgressBlockAfter: 3
- noProgressWarnAfter: 2

**验收标准**：
- [x] tool-guardrail 31 个单测全部通过
- [x] 精确失败 3 次后 block，不同参数不触发
- [x] 同工具失败 5 次后 halt，不同工具不触发
- [x] 只读工具相同结果 3 次后 block，不同结果不触发
- [x] 成功后清除失败记录
- [x] 每轮重置计数
- [x] warn 去重（相同 key 只 warn 一次）
- [x] 全量 orchestrator 测试 1159/1160 通过（唯一失败为环境缺 Git Bash）
- [x] `tsc --noEmit` 类型检查通过

### 4.2 P3-2 execute_code 独立代码执行工具（已完成）

**移植来源**：Hermes `tools/code_execution_tool.py`（1700+ 行）的设计思路；实现上复用 Cyrene 现有 `run_shell` 的全部安全执行逻辑。

**目标**：在现有 `run_shell`（通用 shell 执行）之外，新增独立的 `execute_code` 工具，专为代码执行场景优化：
- 子进程隔离（复用 run_shell 的 Anthropic SRT 沙箱）
- 多语言支持（Python / Node.js / Shell）
- 超时 + 中断 + 输出截断（复用 run_shell 的双计时器）
- 运行时不存在时的友好错误提示

**设计决策：复用 run_shell 而非独立实现**

Hermes 的 `code_execution_tool.py` 有 1700+ 行，核心是子进程隔离 + RPC + 工具白名单 + 环境清洗。但 Cyrene 已经有 `run_shell` 工具，它已经实现了：
- 沙箱包装（wrapWithSandbox，基于 Anthropic SRT）
- 双计时器（idle 2 分钟 + total 30 分钟）
- 进程树终止（killTree，Windows taskkill /T /F）
- 输出解码（UTF-8 → GBK 自动检测）
- 输出截断（16KB）
- 灾难命令守卫
- 权限档位集成（full / per-action / scoped / read-only / project-read-only）

因此 `execute_code` 采用**薄封装**策略：把代码写入临时文件 → 构建运行时命令 → 调用 `run_shell.execute()` → 清理临时文件。这样：
- 完全复用 run_shell 的安全逻辑，不重复造轮子
- 代码量小（~250 行），可逆性高
- 沙箱、权限、计时器等安全特性自动继承
- 临时文件放在 cwd 下的 `.cyrene-temp/` 目录，确保沙箱能访问

**新增模块**：
| 文件 | 说明 |
| --- | --- |
| `tools/builtin-tools/execute-code-tool.ts` | execute_code 工具实现（写入临时文件 → 调用 run_shell → 清理） |
| `tools/builtin-tools/execute-code-tool.test.ts` | 23 个单测 |

**修改文件**：
| 文件 | 改动 |
| --- | --- |
| `tools/built-in-tools.ts` | 导入 executeCodeTool，在 run_shell 之后注册 |

**工具参数**：
- `language`：`"python" | "node" | "shell"`，默认 `"python"`
- `code`：代码内容（必填）
- `cwd`：工作目录绝对路径（可选）

**工具返回**：
```json
{
  "language": "python",
  "exitCode": 0,
  "stdout": "hello",
  "stderr": "",
  "timedOut": false,
  "truncated": false,
  "sandboxed": true,
  "errorCode": "RUNTIME_NOT_FOUND"  // 可选，运行时不存在时
}
```

**运行时检测策略**：不预检测（避免额外开销），直接执行；运行时不存在时命令自然失败，stderr 会包含"不是内部或外部命令"等信息，execute_code 检测到这些关键词后补充友好提示并设置 `errorCode: "RUNTIME_NOT_FOUND"`。

**与 run_shell 的区别**：
| 维度 | run_shell | execute_code |
| --- | --- | --- |
| 输入 | 命令字符串（cmd/bash 语法） | 代码片段（有明确语言运行时） |
| 适用场景 | git/npm/pip 等命令行操作 | 跑脚本/数据处理/快速验证代码逻辑 |
| 临时文件 | 无 | 写入 .cyrene-temp/ 临时文件，执行后自动清理 |
| 语言支持 | cmd / bash | python / node / shell |

**验收标准**：
- [x] execute-code-tool 23 个单测全部通过
- [x] 空 code / 不支持语言返回明确错误
- [x] Python / Node / Shell 三种语言都能正确构建命令并调用 run_shell
- [x] 运行时不存在时返回 RUNTIME_NOT_FOUND + 友好提示
- [x] 超时 / 截断 / 沙箱字段正确传递
- [x] 执行后临时文件自动清理（成功和失败都清理）
- [x] run_shell 抛异常时返回错误并清理临时文件
- [x] 全量 orchestrator 测试 1182/1183 通过（唯一失败为环境缺 Git Bash）
- [x] `tsc --noEmit` 类型检查通过
- [x] snapshot test 通过（注册顺序未破坏）

### 4.3 P3-3 后台 LLM 审查（已完成）

**移植来源**：Hermes `agent/background_review.py` 的设计思路

**目标**：在 Run 结束后，后台启动 LLM 审查，对本次 Run 的文件变更进行质量评估：
- 基于现有 `run-review-tracker.ts` 的文件变更快照数据（before/after/diff）
- LLM 审查：代码质量、安全性、潜在 bug、改进建议
- 审查结果持久化，供用户后续查看

**设计决策：核心模块 + 可注入回调**

考虑到可逆性和最小改动，采用"核心模块 + 可注入回调"的设计：
1. **核心模块** `llm-reviewer.ts`：纯函数逻辑（prompt 构建、结果解析、审查执行、持久化），不依赖具体 model client
2. **可注入回调**：`harness-adapter.ts` 导出 `setLLMReviewCallback(callback)`，调用方注入真实的 LLM 调用函数后启用
3. **默认不启用**：未注入回调时，finalizeReview 之后不会触发 LLM 审查，保持原有行为

这样设计的好处：
- 核心逻辑是纯函数，易于测试（33 个单测）
- LLM 调用接口抽象为 `LLMCallFn = (prompt, systemPrompt?) => Promise<string>`，不依赖具体 model client
- 集成点已就位（harness-adapter.ts 中 finalizeReview 之后异步触发），后续只需要调用 `setLLMReviewCallback` 即可启用
- 可逆性高：禁用只需要 `setLLMReviewCallback(null)`

**新增模块**：
| 文件 | 说明 |
| --- | --- |
| `review/llm-reviewer.ts` | LLM 审查核心模块（prompt 构建 + 结果解析 + 审查执行 + 持久化） |
| `review/llm-reviewer.test.ts` | 33 个单测 |

**修改文件**：
| 文件 | 改动 |
| --- | --- |
| `harness-adapter.ts` | 导入 llm-reviewer；新增 `setLLMReviewCallback` 和 `buildDefaultLLMReviewCallback`；finalizeReview 之后异步触发审查（回调存在时） |

**核心类型**：
```typescript
interface FileReview {
  filePath: string;           // 文件路径
  changeKind: string;         // 变更类型
  qualityScore: number;       // 质量评分 1-5
  qualityComment: string;     // 质量评价
  securityIssues: string[];   // 安全问题
  improvements: string[];     // 改进建议
  hasPotentialBug: boolean;   // 是否有潜在 bug
  bugDescription?: string;    // bug 描述
}

interface LLMReviewResult {
  runId: string;
  reviewedAt: number;
  summary: string;            // 总体评价
  overallQualityScore: number; // 平均质量评分
  securityConcerns: string[];  // 安全问题汇总
  improvementSuggestions: string[]; // 改进建议汇总
  fileReviews: FileReview[];  // 每个文件的审查结果
  status: "completed" | "failed" | "skipped";
  model?: string;
}
```

**审查流程**：
1. Run 结束后，`finalizeReview` 生成 ReviewSnapshot
2. 如果 `llmReviewCallback` 存在，异步调用（不 await，不阻塞 Run 结果返回）
3. 回调中：加载 snapshot → 按变更大小排序选择前 20 个文件 → 逐个文件调用 LLM 审查 → 汇总结果 → 持久化到 `llm-review.json`
4. 幂等：已有审查结果则跳过

**Prompt 设计**：
- System prompt：资深代码审查专家角色，审查维度（质量/安全/正确/完整）
- 每个文件的 prompt：文件路径 + 变更类型 + 新增/删除行数 + diff 内容 + 要求返回 JSON
- diff 截断：单个文件超过 8000 字符则截断
- 文件数限制：最多审查 20 个文件（按变更大小排序）

**持久化**：
- 存储位置：`<userData>/cyrene-runs/reviews/<runId>/llm-review.json`
- 原子写：`.tmp + rename`
- 提供 `saveLLMReview` / `loadLLMReview` / `hasLLMReview` 函数

**启用方式**（后续集成）：
```typescript
import { setLLMReviewCallback, buildDefaultLLMReviewCallback } from "./harness-adapter";

// 构建 LLM 调用函数（对接具体 model client）
const llmCall: LLMCallFn = async (prompt, systemPrompt) => {
  // 调用具体的 model client，返回文本结果
  const response = await callModel({ prompt, systemPrompt });
  return response.text;
};

// 启用审查
setLLMReviewCallback(buildDefaultLLMReviewCallback(llmCall, "gpt-4o"));
```

**验收标准**：
- [x] llm-reviewer 33 个单测全部通过
- [x] prompt 构建包含文件路径、变更类型、diff 内容
- [x] 结果解析支持纯 JSON 和 markdown 包裹的 JSON
- [x] 无效 JSON 返回默认值，不崩溃
- [x] 评分限制在 1-5 之间
- [x] 按变更大小排序选择文件
- [x] 限制最多审查 20 个文件
- [x] diff 超过 8000 字符截断
- [x] 没有文件变更时返回 skipped
- [x] LLM 调用失败时记录错误但继续
- [x] 计算平均质量评分
- [x] 汇总安全问题和改进建议
- [x] 生成总体评价
- [x] 保存和加载审查结果（原子写）
- [x] hasLLMReview 正确检测
- [x] 损坏的 JSON 返回 null
- [x] harness-adapter 集成点就位（可注入回调，默认不启用）
- [x] 全量 orchestrator 测试 1215/1216 通过（唯一失败为环境缺 Git Bash）
- [x] `tsc --noEmit` 类型检查通过

**后续增强（P4+）**：
- 在 bootstrap 中对接具体 model client，默认启用 LLM 审查
- 添加 IPC 接口供前端展示审查结果
- 审查结果卡片 UI（质量评分、安全问题、改进建议）
- 审查结果触发自动修复（高质量建议自动应用）
- 批量审查历史 Run

---

## 4. P4 深度审查与安全增强（2026-09-05）

### 4.1 背景：P3 完成后的深度审查

P0-P3 共 10 项路线图全部完成后，进行了深度代码审查和 Hermes 二次对标：

1. **P3 三项代码自审**：逐项审查 tool-guardrail、execute-code-tool、llm-reviewer 的实现，确认无明显遗漏或 bug，记录了可改进点（如 execute_code 支持 py 命令、llm-reviewer 并行审查等）。
2. **Hermes 二次对标**：通读 Hermes agent/ 目录 150+ 文件，按价值排序发现 Cyrene 仍遗漏的核心能力。

### 4.2 Hermes 对标结论

| 能力 | Hermes 模块 | 价值 | 工作量 | 决策 |
| --- | --- | --- | --- | --- |
| 文件安全黑名单 | file_safety.py (539行) | 高（防止误写 SSH 私钥/.env/凭据文件） | 小 | ✅ P4 移植 |
| 流式思维链清理 | think_scrubber.py (343行) | 高（支持思维链模型不泄露推理过程） | 中 | ✅ P4 移植 |
| 消息脱敏 | redact.py + message_sanitization.py | 中 | 中 | P5 可选 |
| LLM 审查增强 | P3-3 改进 | 中 | 中 | P5 可选 |
| execute_code 增强 | P3-2 改进 | 低 | 小 | P5 可选 |
| LSP 集成 | agent/lsp/ (10+文件) | 高（专业 IDE 核心功能） | 大 | P6+ 长期规划 |
| 技能策展 | curator.py (1709行) | 中低 | 大 | 暂不移植 |
| 编码上下文感知 | coding_context.py (620行) | 低（Cyrene 已有 Code/Work 模式+AGENTS.md） | 中 | 暂不移植 |
| 标题生成 | title_generator.py (148行) | 低 | 小 | 暂不移植 |
| Shell 钩子 | shell_hooks.py (709行) | 低（Cyrene 已有灾难命令守卫） | 中 | 暂不移植 |

**真正有价值且 Cyrene 遗漏的核心能力只有 2 项**：文件安全黑名单 + 流式思维链清理。

### 4.3 P4-1 文件安全黑名单

#### 4.3.1 目标

移植 Hermes file_safety.py，在文件读写工具中添加敏感路径检查，防止 Agent 误写/误读敏感文件（SSH 私钥、环境变量、凭据文件等）。

#### 4.3.2 设计

**核心模块**：`src/main/orchestrator/tools/file-safety.ts`

- 纯函数模块，不依赖 Electron/磁盘，可独立测试
- 防御性深度（defense-in-depth）：不是安全边界（Agent 仍可通过 run_shell 绕过），但能阻止大多数误操作，并在日志中留下审计痕迹
- 适配 Windows 路径（Cyrene 是 Windows 桌面应用）

**两类检查**：

1. **写入拒绝**（`isWriteDenied` / `getWriteDeniedError`）：
   - 精确敏感路径：`~/.ssh/id_rsa`、`~/.ssh/id_ed25519`、`~/.ssh/config`、`~/.netrc`、`~/.pgpass`、`~/.npmrc`、`~/.pypirc`、`~/.git-credentials`、`~/.aws/credentials`、`~/.gnupg/secring.gpg`、`~/.kube/config`、`~/.docker/config.json` 等
   - 敏感目录前缀：`~/.ssh/`、`~/.aws/`、`~/.gnupg/`、`~/.kube/`、`~/.docker/`、`~/.azure/`、`~/.config/gh/`、`~/.config/gcloud/` 等
   - Windows 特定：`AppData/Roaming/Microsoft/Credentials/`、`AppData/Local/Microsoft/Credentials/` 等

2. **读取拒绝**（`getReadBlockError`）：
   - 项目级 `.env` 文件：`.env`、`.env.local`、`.env.development`、`.env.production`、`.env.test`、`.env.staging`、`.envrc`、`.env.example`
   - SSH 私钥文件：`id_rsa`、`id_ed25519`、`id_ecdsa`、`id_dsa`、`authorized_keys`（在 `.ssh` 目录下）

**集成点**：`fs-tools.ts`

- `read_file` 工具：路径检查后调用 `getReadBlockError`，拒绝时返回 `ACCESS_DENIED` 错误
- `write_file` 工具：路径检查后调用 `getWriteDeniedError`，拒绝时抛出 `E_ACCESS_DENIED` 错误

#### 4.3.3 验收标准

- [x] file-safety.ts 纯函数模块完成（敏感路径定义 + 写入/读取检查 + 路径规范化）
- [x] fs-tools.ts read_file 集成读取安全检查
- [x] fs-tools.ts write_file 集成写入安全检查
- [x] 37 个单测全部通过（精确路径/目录前缀/普通路径/读取拒绝/路径规范化/isPathInWorkspace/构建函数）
- [x] `tsc --noEmit` 类型检查通过
- [x] 全量 orchestrator 测试通过（唯一失败为环境缺 Git Bash，历史既有）

### 4.4 P4-2 流式思维链清理

#### 4.4.1 目标

移植 Hermes think_scrubber.py，在流式输出中移除思维链标签（`<think>`、`<thinking>`、`<reasoning>`、`<thought>`、`<REASONING_SCRATCHPAD>`），避免把模型的推理过程展示给用户。

#### 4.4.2 为什么需要状态机

简单的正则替换在完整字符串上有效，但在流式 delta 中会失效：

```
delta1 = "<think>"
delta2 = "推理内容"
delta3 = "</think>"
```

逐 delta 正则会把 delta1 删掉，delta2 就被当作普通内容泄露。状态机可以正确处理跨 delta 的标签分割。

#### 4.4.3 设计

**核心模块**：`src/main/orchestrator/llm/think-scrubber.ts`

- 纯状态机，不依赖外部库，可独立测试
- 部分标签跨 delta 时暂存，等待下一个 delta 解析
- 闭合对 `<tag>X</tag>` 总是移除（无论边界）
- 未闭合开放标签只有在块边界（行首/换行后/空白后）才视为思维链开始
- 孤立关闭标签（无匹配开放）移除（连同尾部空白）

**状态机状态**：

- `inBlock`：是否在思维链块内（等待关闭标签），块内所有文本丢弃
- `buf`：暂存的部分标签尾部（跨 delta 的标签分割）
- `lastEmittedEndedNewline`：上一次输出是否以换行结尾（用于判断块边界）

**核心方法**：

- `feed(text)`：输入一个 delta，返回清理后的可见部分
- `flush()`：流结束时刷新，返回暂存的内容（如果不是真实标签）
- `reset()`：重置状态（每轮新对话开始时调用）
- `scrubThinkBlocks(text)`：便捷函数，一次性清理完整字符串（非流式场景）

**标签变体**（不区分大小写）：
- `<think>` / `</think>`
- `<thinking>` / `</thinking>`
- `<reasoning>` / `</reasoning>`
- `<thought>` / `</thought>`
- `<REASONING_SCRATCHPAD>` / `</REASONING_SCRATCHPAD>`

**块边界规则**：

开放标签只有在以下位置才视为思维链开始：
1. 流的开始（位置 0）
2. 换行之后（可选后跟空白）
3. 当前行只有空白（即空白后的开放标签）

这防止了正文中提到标签名（如 "use `<think>` tags here"）被错误抑制。闭合对总是移除，因为它是有意的、有界的构造。

#### 4.4.4 集成状态

- [x] 核心模块 think-scrubber.ts 完成（状态机 + 部分标签暂存 + 块边界规则 + 便捷函数）
- [x] 39 个单测全部通过（闭合对/流式分割/块边界/部分标签暂存/孤立标签/多种标签变体/不区分大小写/flush/reset/普通文本/便捷函数/复杂场景）
- [x] `tsc --noEmit` 类型检查通过
- [ ] 集成到 Cyrene 流式输出管线（涉及 vendors/sdk-stream/harness 多层架构，留作后续优化）

**后续集成计划**：
- 在 `vendors/sdk-stream/` 的 normalizer 层添加 think-scrubber，在 delta 归一化后清理
- 或在 `harness/harness-llm.ts` 的 LLM 调用回调中添加清理
- 每轮新对话开始时调用 `scrubber.reset()`
- 流结束时调用 `scrubber.flush()` 输出暂存内容

#### 4.4.5 验收标准

- [x] 核心模块完整移植 Hermes think_scrubber.py 的状态机逻辑
- [x] 39 个单测全部通过
- [x] `tsc --noEmit` 类型检查通过
- [ ] 集成到流式输出管线（后续优化）

---

## 5. P5 持续优化（2026-09-05）

### 5.1 P5-1 think-filter 增强（多标签变体 + 孤立关闭标签）

#### 5.1.1 背景

P4-2 移植了 Hermes think_scrubber 后，发现 Cyrene 已有 `think-filter` 模块（`src/main/chat/think-filter.ts`），且已集成到 `runtime.ts` 流式管线中（leading-only 模式，把思维链分离为 reasoning_delta）。

对比两者差异：
- think-filter：只支持 `<think>` 标签，strict 模式不过滤块边界，不处理孤立关闭标签
- think-scrubber：支持 5 种标签变体（think/thinking/reasoning/thought/REASONING_SCRATCHPAD），块边界规则，孤立关闭标签处理

#### 5.1.2 决策

**增强 think-filter，吸收 think-scrubber 的额外能力**，而非替换。理由：
- think-filter 已集成到 runtime.ts 流式管线，替换成本高
- think-filter 有 leading-only 模式（think-scrubber 没有），是很好的设计
- think-scrubber 作为独立模块保留，用于其他场景（如非流式清理）

#### 5.1.3 增强内容

1. **5 种标签变体支持**：think / thinking / reasoning / thought / REASONING_SCRATCHPAD，不区分大小写
2. **孤立关闭标签移除**：无匹配开放标签的 `</think>` 等自动移除，连同尾部空白
3. **精确部分标签暂存**：用 `maxPartialSuffix` 代替固定长度暂存，只暂存真正可能是标签前缀的尾部，避免逐字符 feed 时过度缓冲
4. **保持接口不变**：`createThinkFilter` / `stripThinkBlocks` / `ThinkStreamFilter` 接口完全兼容

#### 5.1.4 验收标准

- [x] 5 种标签变体全部支持（strict + leading-only 模式）
- [x] 不区分大小写
- [x] 孤立关闭标签移除（strict + leading-only passthrough 状态）
- [x] 跨 chunk 标签分割正确处理
- [x] 47 个单测全部通过（原有 28 + 新增 19）
- [x] `tsc --noEmit` 类型检查通过
- [x] 全量测试 1408/1409 通过（唯一失败为环境缺 Git Bash，历史既有）

### 5.2 P5-2 execute_code 增强（Python fallback 到 py）

#### 5.2.1 背景

P3-2 实现的 execute_code 工具使用 `python` 命令执行 Python 代码。但在 Windows 上，Python 安装时可能只注册了 `py` 命令（Python Launcher），没有 `python` 命令。这会导致 execute_code 在这些系统上失败。

#### 5.2.2 增强内容

1. **LanguageRuntime 新增 fallbackCommand 字段**：Python 配置 `fallbackCommand: "py"`
2. **自动 fallback 机制**：
   - 构建要尝试的命令列表（主命令 + fallback）
   - 依次尝试，直到成功或所有命令都失败
   - 触发 fallback 的条件：执行异常 或 运行时不存在错误（"不是内部或外部命令" / "not recognized" / "command not found" / "no such file or directory"）
3. **fallback 成功提示**：使用 fallback 命令成功时，在 stderr 中添加提示
4. **更新工具描述**：提到 Python 自动 fallback 到 py

#### 5.2.3 验收标准

- [x] Python 主命令失败时自动 fallback 到 py
- [x] fallback 成功时添加提示
- [x] 所有命令都失败时返回 RUNTIME_NOT_FOUND 错误
- [x] 23 个单测全部通过
- [x] `tsc --noEmit` 类型检查通过
- [x] 不影响 Node.js 和 Shell 语言（无 fallback）

### 5.3 P5-3 LLM 审查增强（列表 + 统计汇总）

#### 5.3.1 背景

P3-3 实现的 llm-reviewer 已有保存/加载/检查单个审查结果的功能，但缺少：
1. 列出所有审查结果（用于 UI 展示历史审查记录）
2. 统计汇总（用于了解整体审查质量、安全问题分布等）

#### 5.3.2 增强内容

1. **ReviewStats 类型**：统计汇总接口，包含总审查数、成功/失败/跳过数、平均质量分、有安全问题的审查数、有潜在 bug 的审查数、总审查文件数、最早/最近审查时间
2. **listLLMReviews(userDataRoot, limit?)**：列出所有已保存的审查结果，按审查时间倒序排列，支持 limit 参数（默认 50）
3. **getReviewStats(userDataRoot)**：遍历所有审查结果，计算统计指标，平均质量分仅统计 completed 状态的审查

#### 5.3.3 验收标准

- [x] listLLMReviews 按时间倒序列出所有审查
- [x] listLLMReviews 支持 limit 参数
- [x] 空目录返回空数组/零统计
- [x] getReviewStats 正确计算所有统计指标
- [x] 平均质量分仅统计 completed 状态
- [x] 35 个单测全部通过（原有 33 + 新增 2）
- [x] `tsc --noEmit` 类型检查通过

---

## 6. 执行记录

| 日期 | 事项 | 结果 |
| --- | --- | --- |
| 2026-09-05 | 规划落盘；P0-1 / P0-2 实施完成 | 并行子 Agent + AGENTS.md 注入已落地，新增 20 个单测用例，全部通过 |
| 2026-09-05 | P1-1 验证闭环自迭代实施完成 | 移植 Hermes IterationBudget + 预算耗尽总结 + 文件变更失败页脚 + 回合退出诊断；新增 iteration-budget.ts（13 单测），修改 5 个核心文件；全量测试 1098/1099 通过 |
| 2026-09-05 | P1-2 跨会话搜索实施完成 | 核心能力已存在（recall_history + 自动索引 + 混合检索）；增强 limit/sessionId 过滤/来源会话展示；修改 history-tools.ts；全量测试 1098/1099 通过 |
| 2026-09-05 | P1-3 凭据全量加密实施完成 | 新增 CredentialVault（safeStorage 封装，移植自 TokenVault 模式）；model-settings 读写路径加解密；旧明文自动兼容；18 单测 + 全量 1098/1099 通过 |
| 2026-09-05 | P2-1 定时任务渠道投递实施完成 | ScheduledTask 新增 deliver 字段（local/desktop）；scheduler-runner 完成后触发 deliverResult 回调；bootstrap 接入 Electron 桌面通知；store 层规范化；scheduler 28/28 + 全量 1168/1169 通过 |
| 2026-09-05 | P2-2 成本核算实施完成 | 新增 model-pricing（30+ 常见模型默认价 + 自定义覆盖）和 cost-calculator（input/output/cacheHit/cacheCreation 四档成本 + 按天/按模型汇总 + 格式化）；30 单测 + 全量 1128/1129 通过 |
| 2026-09-05 | P2-3 Trajectory 导出实施完成 | 新增 trajectory-exporter（JSONL 格式 + 敏感信息脱敏 + 按会话/模式/时间范围筛选 + 纯函数转换与文件写入分离）；19 单测 + 全量 1171/1172 通过；**P0-P2 全部 7 项路线图完成** |
| 2026-09-05 | P3 深度对标 Hermes 差距重审 | 深度通读 Hermes 源码（agent/ 150+ 文件）并逐项对照 Cyrene，发现 Cyrene 实际已具备上下文压缩/沙箱/记忆系统/错误分类/重试策略/不确定效果守卫/文件变更审查/权限策略等能力（此前被低估）；真正缺失仅 3 项：工具重复失败检测、execute_code 工具、后台 LLM 审查；新增 P3 章节 |
| 2026-09-05 | P3-1 工具重复失败检测实施完成 | 移植 Hermes tool_guardrails.py，新增 ToolCallGuardrailController（exact_failure_block + same_tool_failure_halt + idempotent_no_progress_block）；接入 tool-round.ts before_call/after_call；31 单测 + 全量 1159/1160 通过 |
| 2026-09-05 | P3-2 execute_code 独立代码执行工具实施完成 | 新增 execute-code-tool（薄封装 run_shell：写入临时文件 → 构建运行时命令 → 调用 run_shell → 清理临时文件）；支持 Python/Node.js/Shell 三种语言；运行时不存在时返回 RUNTIME_NOT_FOUND + 友好提示；23 单测 + 全量 1182/1183 通过 |
| 2026-09-05 | P3-3 后台 LLM 审查实施完成 | 新增 llm-reviewer（prompt 构建 + 结果解析 + 审查执行 + 持久化，LLM 调用抽象为 LLMCallFn 不依赖具体 model client）；harness-adapter 新增 setLLMReviewCallback 可注入回调，finalizeReview 之后异步触发审查（默认不启用，保持可逆性）；33 单测 + 全量 1215/1216 通过；**P0-P3 全部 10 项路线图完成** |
| 2026-09-05 | P4 深度审查与 Hermes 二次对标 | P3 三项代码自审确认无明显遗漏；通读 Hermes agent/ 150+ 文件二次对标，发现真正有价值且 Cyrene 遗漏的核心能力仅 2 项：文件安全黑名单 + 流式思维链清理；新增 P4 章节 |
| 2026-09-05 | P4-1 文件安全黑名单实施完成 | 移植 Hermes file_safety.py，新增 file-safety.ts（精确敏感路径+目录前缀+读取拒绝，适配 Windows，纯函数可测试）；fs-tools.ts read_file/write_file 集成安全检查；37 单测 + 全量 1252/1253 通过 |
| 2026-09-05 | P4-2 流式思维链清理实施完成 | 移植 Hermes think_scrubber.py，新增 think-scrubber.ts（状态机+部分标签暂存+块边界规则+5种标签变体+不区分大小写+便捷函数）；39 单测通过；核心模块完成，集成到流式输出管线留作后续优化；**P0-P4 全部 12 项路线图完成** |
| 2026-09-05 | P5-1 think-filter 增强实施完成 | 发现 Cyrene 已有 think-filter 且已集成 runtime.ts 流式管线，决定增强而非替换；新增 5 种标签变体支持（think/thinking/reasoning/thought/REASONING_SCRATCHPAD）+ 孤立关闭标签移除 + 精确部分标签暂存（maxPartialSuffix）；保持接口完全兼容；47 单测（原有28+新增19）+ 全量 1408/1409 通过 |
| 2026-09-05 | P5-2 execute_code 增强实施完成 | LanguageRuntime 新增 fallbackCommand 字段，Python 配置 fallback 到 py（Windows Python Launcher）；自动 fallback 机制（执行异常或运行时不存在错误时自动尝试 fallback）；fallback 成功提示；23 单测通过 + tsc 类型检查通过 |
| 2026-09-05 | P5-3 LLM 审查增强实施完成 | 新增 ReviewStats 类型（总审查数/状态分布/平均质量分/安全问题数/潜在bug数/文件数/时间范围）；新增 listLLMReviews（按时间倒序列出，支持 limit）；新增 getReviewStats（遍历所有审查计算统计指标，平均质量分仅统计 completed）；35 单测（原有33+新增2）通过 + tsc 类型检查通过 |
