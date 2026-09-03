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
src/main/skills/
├── skill-types.ts      # 类型定义（Skill、SkillMetadata、SkillUsageRecord）
├── skill-store.ts      # 存储引擎（SKILL.md 读写、验证、目录管理、使用记录）
└── skill-tools.ts      # 工具实现（skill_list / skill_view / skill_manage）+ 注册
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
| 技能工具 | skill_view / skill_manage | skill_list / skill_view / skill_manage |
| 使用跟踪 | skill_usage.py | .usage.json |
| Curator 后台维护 | ✅ 完整实现 | ⏳ P3 阶段 |
| LLM 整合 | ✅ 可选 | ⏳ P4 阶段 |
| 安全扫描 | ✅ skills_guard | ⏳ 后续 |
| 审批门控 | ✅ write_approval | ⏳ 后续 |
| 系统提示注入 | ✅ | ✅ |

## 后续路线图

### P2：使用跟踪增强 + 自动生成引导
- 技能使用成功后自动记录 useCount
- 优化系统提示，更明确地引导 Agent 在完成任务后创建技能
- 技能创建后自动通知用户

### P3：Curator 后台维护
- 空闲时自动运行（距上次运行 >7天 + 空闲 >2小时）
- 自动状态转换：30天未用 → stale，90天未用 → archived
- 备份与回滚（每次运行前 tar.gz 备份）
- Pin / Unpin 保护
- CLI / 设置 UI 管理

### P4：LLM 整合（可选，默认关闭）
- 用辅助模型审查技能库
- 合并相似技能为 umbrella 技能
- 修补过时技能
- 配置项控制开关

## 相关文件

- `src/main/skills/skill-types.ts` — 类型定义
- `src/main/skills/skill-store.ts` — 存储引擎
- `src/main/skills/skill-tools.ts` — 工具实现与注册
- `src/main/orchestrator/tools/registry/tool-registration.ts` — 工具注册入口（调用 registerSkillTools）
- `src/main/orchestrator/system-prompt-builder.ts` — 系统提示构建（注入技能列表）
