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
| P1 | 验证闭环自迭代（改 → 验 → 修） | ⏳ 待做 | verification-runner 强化 + 工具 |
| P1 | 跨会话搜索（FTS/向量 + LLM 摘要） | ⏳ 待做 | 复用 embedding + RAG 管线 |
| P1 | 凭据全量加密（safeStorage） | ⏳ 待做 | settings 层迁移 |
| P2 | 定时任务渠道投递 | ⏳ 待做 | scheduler 增加 deliver 目标 |
| P2 | 成本核算（token × 单价） | ⏳ 待做 | 用量统计扩展 |
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

现状：已有 `verification-runner.ts` + `run-verification-tool.ts`。升级方向：模型改动文件后自动触发验证（测试/构建/LSP 诊断），失败结果回流后自动进入"修复 → 再验证"子循环，设置最大迭代次数防死循环。

### 4.2 跨会话搜索

复用已有 embedding（BGE-M3）+ RAG 索引管线，新增"会话级索引"：对历史会话消息建向量/BM25 索引，提供 `search_history` 工具，返回带来源的摘要；LLM 摘要可在后台异步生成。

### 4.3 凭据全量加密

将 `model-settings.json` / `app-settings.json` / `mcp-servers.json` 中的明文凭据迁移到 Electron `safeStorage`（Windows DPAPI），迁移需向后兼容旧明文读取（首次读入后落盘加密）。

### 4.4 定时任务渠道投递

`ScheduledTask` 增加可选 `deliver` 目标（桌面 / 飞书 / QQ / 微信），结果在 `scheduler-runner` 完成后投递；复用 `proactive` 渠道路由。

---

## 5. 执行记录

| 日期 | 事项 | 结果 |
| --- | --- | --- |
| 2026-09-05 | 规划落盘；P0-1 / P0-2 实施完成 | 并行子 Agent + AGENTS.md 注入已落地，新增 20 个单测用例，全部通过 |
