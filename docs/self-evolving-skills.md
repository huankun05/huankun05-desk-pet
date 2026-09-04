# 自进化技能系统（Self-Evolving Skill System）

> 移植自 Hermes Agent 的自进化机制，让 Cyrene 能从成功经验中沉淀可复用流程，越用越聪明。

## 概述

自进化技能系统是 Agent 的**程序性记忆**：捕获"如何完成特定类型任务"的可复用流程。Agent 完成复杂任务后，自动把成功方法沉淀为技能；下次遇到类似任务时，直接复用已验证的流程，避免重复摸索。

核心闭环：
```
完成复杂任务 → 沉淀技能（skill_manage create）
     ↑                            ↓
  长期未用 ← Curator 归档 ← 跟踪使用情况 ← 使用技能（skill_view）
```

## 架构

```
src/main/self-evolving/
├── skill-types.ts      # 类型定义（Skill、SkillMetadata、SkillUsageRecord、SkillSource）
├── skill-store.ts      # 存储引擎（SKILL.md 读写、验证、目录管理、使用记录、source 字段解析）
├── skill-tools.ts      # 工具实现（skill_list / skill_view / skill_manage）+ 注册
├── curator.ts          # Curator 后台维护（配置、状态转换、备份、Pin、恢复、LLM整合调用、阈值触发）
├── curator-tools.ts    # skill_curator 管理工具（run/status/pin/unpin/restore/config）
└── consolidation.ts    # LLM 整合核心（伞技能合并：审查→识别相似组→生成伞技能→原技能打归档标签→备份）
```

### 存储结构

技能存储在用户数据目录下的 `skills/` 文件夹：

```
<userData>/skills/
├── my-skill/
│   └── SKILL.md              # 技能定义（YAML frontmatter + Markdown 步骤）
├── deploy-to-server/
│   └── SKILL.md
└── .usage.json               # 技能使用记录（查看/使用/修改次数、时间、pin 状态）
```

### SKILL.md 格式

```markdown
---
name: deploy-to-server
description: 部署项目到阿里云服务器的标准流程
category: devops
createdBy: agent
createdAt: 2026-09-03T10:00:00.000Z
updatedAt: 2026-09-03T10:00:00.000Z
---

# 部署到服务器

## 触发条件
需要将本地项目部署到生产服务器时。

## 步骤
1. 本地构建：npm run build
2. 打包：tar -czf dist.tar.gz dist/
3. 上传：scp dist.tar.gz user@server:/tmp/
4. 服务器解压并重启服务

## 注意事项
- 部署前确认配置文件已更新
- 大文件上传前先压缩
```

**必填字段**：`name`、`description`
**可选字段**：`category`、`version`、`tags`、`createdBy`、`createdAt`、`updatedAt`

## 工具说明

### 1. skill_list — 列出所有技能

- **用途**：查看当前有哪些已保存的可复用技能
- **参数**：无
- **返回**：技能列表（名称 + 描述 + 分类 + 创建者）
- **何时用**：开始任务前，查看是否有相关技能可以复用

### 2. skill_view — 查看单个技能

- **用途**：读取某个技能的完整 SKILL.md 内容（操作步骤、注意事项等）
- **参数**：`name`（必填，技能名称）
- **返回**：技能完整内容
- **何时用**：要用 skill_list 找到的某个技能，需要看具体步骤

### 3. skill_manage — 管理技能

- **用途**：创建、编辑、删除技能
- **参数**：
  - `action`（必填）：`create` / `edit` / `delete`
  - `name`（必填）：技能名称
  - `content`（create/edit 时必填）：完整的 SKILL.md 内容
- **何时创建技能**：
  - 完成了复杂任务（5+ 次工具调用），流程可复用
  - 克服了错误，找到了正确方法
  - 用户纠正了你的做法，新方法有效
  - 发现了非平凡的工作流
  - 用户明确要求"记住这个流程"
- **何时编辑技能**：
  - 使用技能时发现步骤过时/错误
  - 发现了遗漏的步骤或陷阱
  - 操作系统特定的失败需要补充说明

## 系统提示注入

技能列表会自动注入到系统提示的"当前可用工具"之后，作为"已保存技能（程序性记忆）"部分。Agent 在每次对话开始时都能看到有哪些技能可用，并被引导：
1. 开始任务前先用 `skill_list` 查看
2. 有相关技能时用 `skill_view` 读取具体步骤
3. 完成复杂任务后用 `skill_manage create` 沉淀新技能

## 验证机制

- **名称验证**：只能包含小写字母、数字、连字符、下划线、点，必须以字母或数字开头，最长 64 字符
- **内容验证**：必须以 YAML frontmatter 开头，包含 `name` 和 `description` 字段，frontmatter 之后必须有内容
- **重复检查**：创建时检查名称是否已存在
- **Pin 保护**：被 pin 的技能不能删除（Curator 阶段实现）

## 使用记录

每个技能的使用情况记录在 `.usage.json` 中：
- `viewCount`：查看次数
- `useCount`：使用次数
- `patchCount`：修改次数
- `lastViewedAt` / `lastUsedAt` / `lastPatchedAt`：最后操作时间
- `pinned`：是否被 pin（保护不被自动归档）
- `status`：active / stale / archived（Curator 阶段使用）
- `createdBy`：user / agent

## 与 Hermes 的对比

| 特性 | Hermes | Cyrene（当前实现） |
|------|--------|-------------------|
| 技能存储 | SKILL.md + 子目录 | SKILL.md（子目录预留） |
| 技能工具 | skill_view / skill_manage | skill_list / skill_view / skill_manage / skill_curator |
| 使用跟踪 | skill_usage.py | .usage.json |
| Curator 后台维护 | ✅ 完整实现 | ✅ P3 已实现（自动状态转换 + 备份 + Pin + 恢复） |
| LLM 整合 | ✅ 可选 | ✅ P4 框架已实现（配置开关 + 调用接口，实际 LLM 审查后续深化） |
| 安全扫描 | ✅ skills_guard | ⏳ 后续 |
| 审批门控 | ✅ write_approval | ⏳ 后续 |
| 系统提示注入 | ✅ | ✅ |

## P2：使用跟踪增强 + 自动生成引导

### 系统提示优化
技能系统引导始终注入系统提示（即使没有技能也让 Agent 知道有这个能力），包含：
- 完整工作流：开始任务前查技能 → 有相关技能就读取 → 完成任务后沉淀
- 明确的创建时机：5+ 工具调用的复杂任务、克服报错、用户纠正后新方法有效、非平凡工作流、用户明确要求
- 好技能标准：触发条件 + 编号步骤 + 常见陷阱 + 验证方法

### 日志记录
所有技能操作（创建/更新/删除）都记录到日志，便于追踪自进化行为。

## P3：Curator 后台维护

### 架构
```
src/main/self-evolving/
├── curator.ts          # Curator 核心（配置、状态转换、备份、Pin、恢复）
└── curator-tools.ts    # skill_curator 管理工具
```

### 核心功能

**自动状态转换（确定性，无 LLM 成本）：**
- 30 天未使用 → 标记 `stale`
- 90 天未使用 → 归档到 `.archive/` 目录（可恢复）
- 被 `pin` 的技能跳过所有自动转换

**触发方式：**
- 应用启动时检查（距上次运行 > intervalHours 则自动运行）
- 手动触发：`skill_curator` 工具的 `run` action（支持 force / dryRun）

**备份与回滚：**
- 每次运行前自动备份技能目录到 `.curator_backups/`
- 保留最近 5 份备份（可配置）

**配置（skills-curator.json）：**
```json
{
  "enabled": true,
  "intervalHours": 168,
  "staleAfterDays": 30,
  "archiveAfterDays": 90,
  "backupKeep": 5,
  "consolidate": false
}
```

### skill_curator 工具 Actions
- `run` — 手动触发运行（force / dryRun）
- `status` — 查看状态（启用情况、上次运行、归档数量）
- `pin` / `unpin` — 保护/取消保护技能
- `list-archived` — 列出已归档技能
- `restore` — 从归档恢复技能
- `config` — 查看/修改配置

## P4：LLM 整合（框架版本）

### 功能
用辅助模型审查技能库，识别相似技能（建议合并为 umbrella 技能）和过时技能（建议修补）。

### 当前状态
- ✅ 配置开关：`curator.consolidate`（默认 false）
- ✅ 调用接口：Curator 运行时自动触发 LLM 整合
- ✅ 框架实现：`runLLMConsolidation()` 函数，记录日志并返回审查统计
- ⏳ 后续深化：接入 Cyrene LLM 客户端，实际调用辅助模型进行审查，生成合并/修补建议并执行

### 启用方式
```bash
# 通过 skill_curator 工具启用
skill_curator action=config consolidate=true
```

## 技能来源（Skill Source）

每个技能都有 `source` 字段，标记技能的来源，决定自整理/归档等自动操作的保护级别：

| source | 说明 | Curator 自动归档 | LLM 整合 |
|--------|------|-----------------|----------|
| `self-grown` | Agent 自己沉淀的（默认） | ✅ 可以 | ✅ 可以合并 |
| `forked` | 从外部技能 fork 出的本地定制版 | ✅ 可以 | ✅ 可以合并 |
| `umbrella` | 自整理合并生成的伞技能 | ✅ 可以 | ✅ 可以合并 |
| `external` | 外部引入的（预装/市场/GitHub下载） | ❌ 不自动归档 | ❌ 不合并 |

- `source` 字段存储在 SKILL.md 的 YAML frontmatter 中
- 创建技能时如果未指定 `source`，默认自动补充 `source: self-grown`
- 外部引入的技能需要手动在 SKILL.md 中添加 `source: external` 和 `sourceUrl: <GitHub/市场链接>`

## 外部技能安装

支持从 GitHub URL 或直接的 SKILL.md URL 安装外部技能，安装后自动标记 `source: external` 和 `sourceUrl`。

**使用方式**（通过 skill_manage 工具）：
```
skill_manage action=install url=https://raw.githubusercontent.com/user/repo/main/skills/my-skill/SKILL.md
```

**安装流程**：
1. 从 URL 下载 SKILL.md 内容
2. 解析技能名称和描述
3. 检查是否已存在（已存在则拒绝安装）
4. 自动补充 `source: external` 和 `sourceUrl: <URL>`（如果用户没指定）
5. 创建技能目录并保存 SKILL.md
6. 记录使用情况（createdBy: user）

**支持的 URL 格式**：
- `raw.githubusercontent.com` 的原始文件 URL
- 任何直接返回 SKILL.md 文本内容的 URL

**注意**：
- 外部技能安装后标记为 `source: external`，Curator 不会自动归档，也不会参与 LLM 整合
- 如需修改外部技能，建议先 fork（复制为本地定制版），再修改
- 目前只支持单个 SKILL.md 文件的安装，不支持包含 references/templates/scripts 等附件的完整技能包（后续扩展）

## 辅助模型配置（Auxiliary Model）

用于记忆压缩、会话摘要、技能自整理（合并相似技能）等后台辅助任务。

**配置位置**：模型与API 设置 → 辅助模型（全局）

**两种模式**：
1. **跟随主模型（默认）**：所有后台辅助任务复用主对话模型，零配置
2. **独立配置**：单独配置一个便宜快的模型（如 DeepSeek flash / 本地小模型），用于后台任务

**配置字段**（`model-settings.json` 的 `auxiliary`）：
```json
{
  "auxiliary": {
    "mode": "inherit-main",  // 或 "dedicated"
    "baseUrl": "https://api.openai.com/v1",  // dedicated 时
    "apiKey": "sk-...",  // dedicated 时
    "model": "deepseek-v4-flash"  // dedicated 时
  }
}
```

**加载函数**：`loadAuxiliaryConfig()` — 自动解析配置，dedicated 模式下如果配置不完整会回退到主模型。

**支持的 API 协议**：OpenAI 兼容（/chat/completions）和 Anthropic 兼容（/v1/messages），根据 baseUrl 和 explicitTransport 自动判断。

## 伞技能合并（LLM 整合 / Consolidation）

用辅助模型审查自成长技能，识别功能高度相似/重叠的技能组，合并成"伞技能"（umbrella skill），原技能打归档标签（不删除，用户可手动清理）。

### 合并流程

```
1. 过滤技能：只看 source=self-grown/forked/umbrella + 有使用记录的技能
2. 备份：合并前自动备份整个技能目录
3. 审查：用辅助模型生成合并建议（JSON 格式：哪些技能合并成什么伞技能）
4. 执行：对每个合并建议
   a. 读取原技能内容
   b. 用辅助模型生成伞技能的 SKILL.md（抽象公共流程 + 保留特例）
   c. 创建伞技能（source=umbrella）
   d. 原技能打归档标签（status=archived + mergedInto=伞技能名）
5. 记录日志
```

### 保守合并策略

- 只合并"功能领域相同 + 描述高度相似 + 步骤重叠度高"的技能
- 描述模糊、拿不准的一律不合并
- 每个合并组至少 2 个技能
- 至少一个技能有实际使用记录（没被用过的暂不合并）
- 合并前自动备份，原技能打归档标签不删除

### 触发机制

- **定期触发**：随 Curator 定期运行（intervalHours，默认 7 天）
- **阈值门槛**：活跃技能数达到 `consolidateMinSkills`（默认 5）才运行整合，低于阈值跳过
- **手动触发**：通过 `skill_curator action=run` 手动触发
- **开关**：`curator.consolidate`（默认 false，需手动启用）

### 配置字段（`skills-curator.json`）

```json
{
  "consolidate": false,           // 是否启用 LLM 整合
  "consolidateMinSkills": 5       // 最低技能数门槛
}
```

### 核心文件

- `src/main/self-evolving/consolidation.ts` — LLM 整合核心（审查、生成建议、生成伞技能、执行合并）
- `src/main/self-evolving/curator.ts` — Curator 调用 LLM 整合 + 阈值检查
- `src/main/settings/model-settings.ts` — 辅助模型配置（AuxiliaryModelConfig + loadAuxiliaryConfig）

## 已知问题与注意事项

### 1. 技能目录共享（与 Cyrene 原有技能系统共用存储目录）

**现状**：自进化技能系统和 Cyrene 原有技能系统共用同一个存储目录（`userData/skills/`）。该目录下目前有 40+ 个 Cyrene 原有的内置技能（如 `as-api-and-interface-design`、`ecc-code-tour`、`sp-brainstorming` 等）。

**影响**：
- Agent 用 `skill_list` 会看到**所有技能**（包括原有的和自进化创建的）
- Agent 用 `skill_view` 可以读取原有技能的内容（这是可以的）
- **风险**：Agent 理论上可以用 `skill_manage delete` 删除系统内置技能

**当前缓解措施**：
- 系统提示引导 Agent 创建新技能，而非修改现有技能
- 即使误删，Curator 有备份机制，且内置技能可以通过快照重新安装

**后续优化**：在 `skill_manage` 中添加保护，检测到是系统内置技能（有 `.snapshot-installed` 标记或在 bundled manifest 中）时拒绝删除/修改，只允许操作 Agent 自己创建的技能。

### 2. 两个技能系统的关系

| | Cyrene 原有技能系统 | 自进化技能系统（新） |
|---|---|---|
| **定位** | 预定义的能力包（官方内置） | Agent 从经验中沉淀的流程 |
| **调用方式** | `invoke_skill` 执行指令 | `skill_view` 查看内容 |
| **管理方式** | 快照安装/更新 | `skill_manage` 创建/编辑/删除 |
| **维护** | 官方更新 | Curator 自动维护（stale/归档） |
| **存储** | 共用 `userData/skills/` 目录 | 共用 `userData/skills/` 目录 |

两个系统**互补共存**，没有冲突。后续可考虑深度集成（如自进化创建的技能也能通过 `invoke_skill` 调用）。

### 3. LLM 整合为框架版本

P4 的 LLM 整合目前是**框架版本**：
- ✅ 配置开关 `curator.consolidate`（默认关闭）
- ✅ Curator 运行时自动触发 LLM 审查接口
- ✅ `runLLMConsolidation()` 函数框架，记录日志并返回审查统计
- ⏳ 后续深化：接入 Cyrene LLM 客户端，实际调用辅助模型进行审查，生成合并/修补建议并执行

启用 LLM 整合前请确保已接入辅助模型配置，否则只会记录日志不会实际审查。

## 后续路线图

### 安全增强
- 技能内容安全扫描（防止恶意命令注入）
- 技能创建/修改审批门控（高风险技能需用户确认）

### LLM 整合深化
- 接入辅助模型配置（auxiliary.curator）
- 实现相似技能聚类与合并建议
- 实现过时技能识别与修补建议
- 支持用户确认后自动执行合并/修补

### 与 Cyrene 原有技能系统集成
- 当前自进化技能系统独立于 Cyrene 原有技能系统（invoke_skill / read_skill_reference）
- 后续可考虑深度集成：自进化创建的技能也能通过 invoke_skill 调用

## 备份与恢复

技能自进化系统的所有危险操作（合并、更新、删除）前都会自动备份。

**备份功能**：
- `skill_manage action=backup` — 手动备份当前所有技能
- `skill_manage action=list-backups` — 列出所有备份（含时间、大小、技能数量）
- `skill_manage action=restore name=<备份名>` — 从备份恢复（恢复前自动备份当前状态）
- `skill_manage action=delete-backup name=<备份名>` — 删除指定备份

**自动备份时机**：
- 伞技能合并前自动备份
- 外部技能更新前自动备份
- 从备份恢复前自动备份当前状态

**备份位置**：`userData/skills-curator-backups/skills-<timestamp>/`

## 技能使用反馈机制

Agent 使用技能后可以反馈成功/失败，用于跟踪技能质量和影响 Curator 归档/合并优先级。

**使用方式**：
- `skill_manage action=success name=<技能名>` — 反馈使用成功
- `skill_manage action=failure name=<技能名>` — 反馈使用失败

**记录字段**（SkillUsageRecord）：
- `successCount` — 成功使用次数
- `failureCount` — 失败使用次数
- `lastSuccessAt` — 最后成功使用时间
- `lastFailureAt` — 最后失败使用时间

**影响**：
- 成功率低（失败 > 成功）的技能优先考虑合并或重构
- 合并建议中包含使用统计信息，辅助 LLM 判断

## 系统内置技能保护

Cyrene 原有的内置技能自动标记为 `protected: true`，禁止删除，Curator 不自动归档。

**保护规则**：
- 没有 `source` 字段的技能（Cyrene 原有内置技能）自动标记为 `protected: true` + `source: external`
- `protected: true` 的技能无法通过 `skill_manage action=delete` 删除
- 如需修改内置技能，用 `skill_manage action=edit` 直接编辑
- 如需替换，先 fork（复制为本地定制版）再修改

## 技能热切换

技能创建/编辑/删除后**无需重启应用**，下次对话自动生效。

**实现原理**：
- `listSkills()` / `getSkill()` 每次都从文件系统实时读取，无缓存
- `system-prompt-builder` 每次构建系统提示时都调用 `listSkills()` 获取最新技能列表
- 工具列表（skill_list/skill_view/skill_manage）在启动时注册，但技能内容是动态读取的

## 外部技能包安装（GitHub 仓库）

支持从 GitHub 仓库 URL 安装完整技能包（含 SKILL.md + references/templates/scripts 等附件）。

**支持的 URL 格式**：
1. GitHub 仓库目录 URL：`https://github.com/user/repo/tree/branch/path/to/skill`
2. GitHub raw URL：`https://raw.githubusercontent.com/user/repo/branch/path/to/skill/SKILL.md`
3. 直接 SKILL.md URL：任何直接返回 SKILL.md 文本的 URL

**安装流程**（GitHub 仓库 URL）：
1. 解析 URL，提取 user/repo/branch/path
2. 调用 GitHub API 获取目录树（`/repos/{user}/{repo}/git/trees/{branch}?recursive=1`）
3. 过滤目标路径下的所有文件
4. 用 raw.githubusercontent.com 下载所有文件
5. 保存到技能目录（SKILL.md + 附件保持原目录结构）
6. 自动标记 `source: external` + `sourceUrl`

**回退机制**：如果 GitHub API 调用失败（速率限制等），回退到直接下载 SKILL.md。

## 外部技能更新检查与更新

对于 `source=external` 且有 `sourceUrl` 的技能，可以检查更新并更新到最新版本。

**使用方式**：
- `skill_manage action=check-update name=<技能名>` — 检查是否有更新
- `skill_manage action=update name=<技能名>` — 更新到最新版本（更新前自动备份）

**更新比较逻辑**：
- 下载远程 SKILL.md，与本地内容比较
- 忽略 frontmatter 中的 `source` / `sourceUrl` / `updatedAt` 字段
- 忽略换行符差异（CRLF/LF）
- 内容不同则判定为有更新

**更新流程**：
1. 自动备份当前技能（复制到备份目录）
2. 删除旧技能
3. 用 sourceUrl 重新安装（下载最新版本）
4. 如果安装失败，旧版本已备份，可手动恢复

## 技能管理 UI 面板

设置页面新增"技能管理"面板，提供可视化的技能管理界面，无需通过大模型工具调用即可管理技能。

**入口**：设置 → 技能管理（侧边栏导航）

**功能**：
1. **技能列表**：卡片式展示所有技能（名称、描述、来源标签、操作按钮）
2. **查看详情**：点击"查看"打开模态框，显示 SKILL.md 完整内容和元数据
3. **编辑技能**：点击"编辑"打开编辑器，修改后保存
4. **删除技能**：点击"删除"（系统内置受保护技能无法删除）
5. **检查更新**：点击"检查更新"，有更新时提示是否更新（更新前自动备份）
6. **安装外部技能**：输入 GitHub 仓库 URL 或 SKILL.md raw URL，点击"安装技能"
7. **备份管理**：点击"立即备份"打开备份管理模态框，可查看所有备份、恢复、删除
8. **刷新列表**：点击"刷新列表"重新加载技能

**相关文件**：
- `src/renderer/settings/skills/index.ts` — 渲染进程逻辑
- `src/renderer/settings/skills/skills.css` — 样式
- `src/main/skills/skills-ipc.ts` — 主进程 IPC handler
- `src/preload/index.ts` — preload API 暴露（window.skills）

## 相关文件

- `src/main/self-evolving/skill-types.ts` — 类型定义
- `src/main/self-evolving/skill-store.ts` — 存储引擎
- `src/main/self-evolving/skill-tools.ts` — 工具实现与注册（skill_list / skill_view / skill_manage）
- `src/main/self-evolving/curator.ts` — Curator 后台维护核心
- `src/main/self-evolving/curator-tools.ts` — skill_curator 管理工具
- `src/main/orchestrator/tools/registry/tool-registration.ts` — 工具注册入口（调用 registerSkillTools + registerCuratorTools）
- `src/main/orchestrator/system-prompt-builder.ts` — 系统提示构建（注入技能列表与引导）
- `src/main/application/default-dependencies.ts` — 启动入口（initSkills 后调用 initCurator）
