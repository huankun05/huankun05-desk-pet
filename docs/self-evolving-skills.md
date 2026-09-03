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
├── skill-types.ts      # 类型定义（Skill、SkillMetadata、SkillUsageRecord）
├── skill-store.ts      # 存储引擎（SKILL.md 读写、验证、目录管理、使用记录）
├── skill-tools.ts      # 工具实现（skill_list / skill_view / skill_manage）+ 注册
├── curator.ts          # Curator 后台维护（配置、状态转换、备份、Pin、恢复、LLM整合框架）
└── curator-tools.ts    # skill_curator 管理工具（run/status/pin/unpin/restore/config）
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

## 相关文件

- `src/main/self-evolving/skill-types.ts` — 类型定义
- `src/main/self-evolving/skill-store.ts` — 存储引擎
- `src/main/self-evolving/skill-tools.ts` — 工具实现与注册（skill_list / skill_view / skill_manage）
- `src/main/self-evolving/curator.ts` — Curator 后台维护核心
- `src/main/self-evolving/curator-tools.ts` — skill_curator 管理工具
- `src/main/orchestrator/tools/registry/tool-registration.ts` — 工具注册入口（调用 registerSkillTools + registerCuratorTools）
- `src/main/orchestrator/system-prompt-builder.ts` — 系统提示构建（注入技能列表与引导）
- `src/main/application/default-dependencies.ts` — 启动入口（initSkills 后调用 initCurator）
