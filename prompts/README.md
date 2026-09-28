# prompts/ — 提示词资产索引

昔涟（Cyrene）的全部提示词资产。本目录经 `extraFiles` 随安装包分发，**用户可直接修改**。

## 加载机制

所有文件经 `src/main/prompts/prompt-loader.ts` 的 `loadPromptFile()` 读取，查找顺序为**用户优先**：

1. `<userData>/prompts/`（用户覆盖层，改这里升级不丢）
2. 安装目录 `prompts/`（随包分发的内容）

文件不存在或读取失败时返回空字符串，不会导致崩溃。因此：**想自定义某个文件，把它复制到 `<userData>/prompts/` 下同名路径再改即可**（如 `styles/custom/custom.md`）。

## 四模式系统提示（核心链路）

由 `src/main/orchestrator/mode-prompt-profile.ts` 的 `MODE_FILES` 定义，按模式顺序拼接（`\n\n---\n\n` 分隔）：

| 模式 | 拼接顺序 |
|---|---|
| Chat（日常聊天） | `chat_system.md` → `chat_identity.md` → `soul.md` → `canon_quotes.md` |
| Work（辅助工作） | `work_system.md` → `work_identity.md` → `work_remark.md` → `canon_quotes_lite.md` |
| Code（代码协作） | `code_system.md` → `code_identity.md` → `code_remark.md` → `canon_quotes_lite.md` |
| Learn（学习陪伴） | `learn_system.md` → `learn_identity.md` → `canon_quotes.md` |

Work / Code 模式还会在末尾追加「金发后代」角色委派头像说明（由 `task-character-pool.ts` 生成，非文件）。

各层职责约定：

- **`*_system.md`** — 模式级规则：该模式下如何理解任务、组织信息、交付回复。
- **`*_identity.md`** — 模式级轻人设：几句身份锚定，控制篇幅。
- **`*_remark.md`**（Work/Code）— 模式补充注意事项。
- **`soul.md`** — 完整人格核心（457 行），只在 Chat 模式常驻；工具模式不携带，由 `cyrene_harness.md` 代替。

## 人格与语气

| 文件 | 用途 | 谁在加载 |
|---|---|---|
| `soul.md` | 完整人格核心（习惯、价值观、表达方式） | Chat 链路、语音通话、主动聊天 |
| `canon_quotes.md` | 原作台词全集，语气基准（常驻） | Chat / Learn / 语音通话 / 主动聊天 |
| `canon_quotes_lite.md` | 台词精简版（约 1–2KB） | Work / Code（工具模式省 token） |
| `cyrene_harness.md` | Harness 每轮 LLM 调用携带的**精简执行人设**：只约束表达风格，不污染工具参数 | Work/Learn/Code 的 Harness 循环（`harness/adapter/prompt-builder.ts`） |
| `tool_usage.md` | 工具、Skill 与子代理委托的统一使用规则 | Harness 循环（同上）；Chat 无工具不注入 |

## 语音通话与主动聊天

| 文件 | 用途 | 谁在加载 |
|---|---|---|
| `phone_system.md` / `phone_identity.md` / `phone_style.md` | 语音通话的规则 / 身份 / 电波风格 | `call/call-prompt-builder.ts`（通话另加载 `soul.md` + `canon_quotes.md`） |
| `cita_system.md` | CITA 上下文理解服务的系统提示（指代消解 / 查询改写 / 上下文聚焦） | `services/cita/cita-service.ts` |
| `plan_identity.md` | 计划模式轻人设（**占位**，流程跑通后填写；当前代码未接线） | 暂无 |

## styles/ — 回复风格

`styles/01_default.md` … `05_sweet.md` 五套内置风格 + `styles/custom/custom.md` 自定义模板，由设置中的风格选择（`styleId`）决定加载哪一份，叠加在模式提示之后。自定义风格实际生效文件位于 `<userData>/styles/custom/custom.md`（首次由模板生成）。

主动聊天固定使用 `styles/01_default.md`（`proactive-lifecycle.ts`）。

## worldbook/ — DMAE 世界书

`Cyrene.md`（昔涟本体设定）、`characters.md`、`story.md`、`world.md`、`_glossary.md`。由 `rag/index.ts` 经 `findPromptPath("worldbook")` 整目录加载进 `WorldbookManager`，按**触发词 / 常驻 / 内在价值 / 优先级 / 连带触发**由 DMAE V5.1 调度进上下文（非全量注入）。

条目格式约定（见各文件内条目头）：

```markdown
## 条目标题
- 触发词: 词1, 词2
- 常驻: 否
- 内在价值: 60
- 优先级: 200
- 连带触发词: 无

<正文>
```

修改世界书后无需重启，运行时会热加载。算法细节见 `docs/architecture/memory-context-budget.md` 与 `npm run sim:*` 仿真器。

## 维护约定

- 新增模式提示时，先更新 `MODE_FILES`，再在本文件补一行拼接顺序。
- 台词类内容优先改 `canon_quotes.md`，再同步挑选进 `_lite` 版，保持 lite 在 1–2KB。
- `soul.md` 是人格基线：改动后建议先跑 Chat 模式实际对话验证语气漂移。
