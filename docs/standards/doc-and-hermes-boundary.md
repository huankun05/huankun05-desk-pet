# 文档与 Hermes 插件边界（标准）

## 文档标准

| 类型 | 位置 | 要求 |
|---|---|---|
| 总架构 | `docs/architecture/DESIGN.md` | 与决策一致，过时必须改 |
| 专题 | `docs/architecture/*.md` | 单一主题、含验收 |
| 计划 | `docs/plan/`、`PLAN.md` | 阶段状态可勾选 |
| 流程 | `docs/standards/` | 强制项写「必须/禁止」 |
| 历史 | `docs/history/` | 只读，注明日期与已取代关系 |
| 用户 | `docs/user-guide/` | 面向使用，不写未实现功能为已完成 |

文档用中文；代码标识符保留英文。日期用 `YYYY-MM-DD`。

---

## Hermes 插件边界

**必须遵守：升级官方 Hermes 时，我方改动应可剥离。**

### 允许的扩展点

1. **MemoryProvider 插件**（LifeMemoryProvider）  
2. **MCP**：Electron 工具 server；Hermes 作 client  
3. **配置**：`HERMES_HOME` 下 config、skills、auxiliary  
4. **进程外服务**：反思、路由、审批 UI（Electron）  
5. **数据导入导出**脚本（不嵌进 core 逻辑）  

### 禁止（除非书面决策）

1. 修改 `hermes-agent/agent/**`、`gateway/**` 行为逻辑并长期维护  
2. 依赖未文档化的内部函数签名  
3. 在 core 内写死本产品角色/路径  

### 例外流程

若必须改 core：

- 独立分支 `fork/hermes-patch-<topic>`  
- 记录 diff 目的与上游 issue  
- `docs/architecture/hermes-integration.md` 登记  
- 升级时优先尝试改为插件实现  

---

## 仓库卫生清单（PR/收工前）

- [ ] 无 `tmp-*.cjs` / `.tmp-*` 新增残留  
- [ ] 无密钥与用户运行数据  
- [ ] 文档索引 `docs/README.md` 仍有效  
- [ ] `PLAN.md` 状态已更新  
