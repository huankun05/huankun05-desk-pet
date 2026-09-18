# 反思系统（Reflection）设计

**状态**：当前方案  
**定位**：完善并替代笼统的「自进化」——不只长技能，而是**经历 → 评估 → 进化/退化 → 复盘**。

---

## 1. 闭环

```text
经历（单次 Run / 日汇总）
  → 事实：做了什么、工具结果、用户反馈、情绪/好感度变化
  → 评估：有效 / 失败 / 被拒绝 / 无进展
  → 提议：技能、记忆巩固、行为规则、风格笔记、退化项
  → 执行：按策略自动 或 待用户确认
  → 复盘：后续对比效果，决定维持/强化/回滚
```

实现位置：**Electron/旁路服务**（读 trajectory 与统计），**不改 Hermes core**。  
技能写入：走 Hermes 技能目录/接口（agent-created + Curator 兼容）。

---

## 2. 反思对象与默认策略

| 对象 | 默认 | 用户可选 | 说明 |
|---|---|---|---|
| 技能 SKILL.md 创建/修改/归档 | 可自动（对齐 Curator） | confirm / auto / off | 仅 agent-created 可被自动归档 |
| 记忆巩固/压缩/降权 | auto | on / off | 仍受注入预算约束 |
| 行为规则、说话风格 | **confirm** | **auto** / off | 可一键改为自动 |
| 人格/情绪基线 | 事件漂移 only | 不开放 LLM 直接改 | LifeKernel |

设置项示例：

```yaml
reflection:
  skills: auto          # auto | confirm | off
  memory: auto
  behavior: confirm     # confirm | auto | off
  style: confirm
```

---

## 3. 进化与退化

| 方向 | 触发 | 动作 |
|---|---|---|
| 进化 | 同类任务重复成功、用户正反馈 | 新建/加强技能；提高规则权重 |
| 退化 | 长期不用、连续失败或拒绝 | 降权、标记 stale、归档（可恢复） |
| 回滚 | 应用后效果变差 | 恢复上一版技能/规则快照 |

**约束**：

- 不自动删除不可恢复数据  
- 行为/风格变更在 confirm 模式下必须进设置页待办  
- 安全相关（权限、危险命令）**永不**被反思自动放宽  

---

## 4. 与 Hermes 原生能力的关系

| Hermes | 我们 |
|---|---|
| `skill_manage` / Curator / skill_usage | 技能层直接复用 |
| Trajectory 导出 | 反思输入源之一 |
| auxiliary 模型 | 反思可用旁路模型，不抢主会话 |

---

## 5. 数据输入（最小集）

- Run 元数据：mode、模型、token、耗时、terminate 状态  
- 工具：成功/失败/重复失败  
- 用户：显式反馈、是否采纳回复、纠错次数  
- LifeKernel：情绪/好感度变化量  

---

## 6. 验收要点

- [ ] behavior=confirm 时，风格/规则改动必须用户确认后才生效  
- [ ] behavior=auto 时可自动生效，且设置页可改回  
- [ ] 技能自动归档可恢复  
- [ ] 反思不修改 Hermes core 文件  
