# 汐月 Marea 总架构设计（DESIGN）

**状态**：当前方案（2026-09-18）  
**产品**：汐月 · Marea（数字生命体桌宠；角色卡可换）  
**分层**：**智核**（官方 Hermes）· **心核**（LifeKernel）· **壳**（Electron）  
**取代**：`docs/history/architecture-index-2026-09-17.html` 中的草案表述  

Chat / Work / Code / Learn 是与用户相处的四种方式，共享同一套智核与关系记忆。

---

## 1. 三层结构：大脑 · 心 · 壳

```text
┌──────────────────────────────────────────────────────────┐
│ 壳 · Electron（Cyrene 底座保留）                           │
│  Live2D · 聊天/设置 · 审批 UI · 渠道 · 托盘 · TTS/ASR      │
└────────────────────────┬─────────────────────────────────┘
                         │ IPC
┌────────────────────────▼─────────────────────────────────┐
│ 心 · LifeKernel（自研 TS，Electron Main）                  │
│  情绪/人格/好感度/互动沉淀 · 状态注入 · PolicyGate 安全底线  │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTP + SSE（localhost）
┌────────────────────────▼─────────────────────────────────┐
│ 大脑 · Hermes（官方 NousResearch/hermes-agent）            │
│  四模式会话 · 工具/MCP · 记忆 · 技能 · 反思数据源           │
└──────────────────────────────────────────────────────────┘
```

| 层 | 职责 | 不做什么 |
|---|---|---|
| **大脑 Hermes** | 把事办成：推理、工具、长任务、记忆读写接口 | 不负责角色皮/声音/表情 |
| **心 LifeKernel** | 她是谁、心情如何、和用户的关系；向大脑注入状态摘要 | 不改工具权限、不替代安全审批 |
| **壳 Electron** | 呈现与系统接入：Live2D、UI、渠道、语音、MCP 工具服务 | 不再跑 CyreneHarness 主循环 |

**互相影响**：

- 事件 → 心：对话/任务成败、互动、时长 → 更新情绪/好感度  
- 心 → 大脑：每轮注入短状态摘要（语气/关系/近期关注）  
- 心 → 壳：表情、动作、TTS 语气参数  
- 大脑 → 心：Run 结果回写  
- **安全**：Work/Code 下情绪只影响措辞与表现，**不能**放宽 L2 权限或跳过审批（PolicyGate）

---

## 2. 四模式

| 模式 | 关系 | 「像人」强度 | 「能办事」强度 | 模型默认 |
|---|---|---|---|---|
| Chat | 陪伴 | 高 | 低–中 | 云端（记忆+上下文） |
| Learn | 陪读 | 中高 | 中 | 云端 |
| Work | 共事 | 中 | 高 | 云端强模型 |
| Code | 结对 | 中 | 最高 | 云端最强可用 |

- 四模式**全部走 Hermes**（单一大脑，避免双循环人格分裂）  
- 模式是会话标签 + 提示/工具/权限绑定组，**不是**四套记忆库  

---

## 3. 模型路由

| 任务类型 | 路由 |
|---|---|
| 四模式主循环 | 云端为主（ModelRouter 按模式/复杂度/预算选 provider+model） |
| 压缩、摘要、检索改写、Curator | Hermes `auxiliary_client`（可更便宜或本地） |
| 断网降级 | 可选本地 Ollama，不作为主路径 |

情绪**不参与**选模型。本地小模型上下文与工具能力通常不够支撑 Chat 全量记忆注入。

---

## 4. 角色卡与记忆

- **角色卡**可替换：身份、说话风格、Worldbook、Live2D、声音  
- **身份/性格**与 Live2D 绑定在同一张卡上  
- **关系记忆默认共享**（可带可选 `character_id`）  
- 昔涟 Worldbook → 转为第一张角色卡，**不再**作为第二套关系记忆  

详见：[character-cards.md](character-cards.md)、[memory-context-budget.md](memory-context-budget.md)

---

## 5. 工具 / MCP / 技能 / 反思

| 能力 | 方案 |
|---|---|
| 通用工具 | Hermes 内置 tools |
| 桌宠能力 | Electron 侧 **MCP server**（Live2D、通知、渠道发送、TTS 等） |
| 技能 | Hermes skills 目录 + Curator |
| 反思/进化 | 独立**反思系统**（见 reflection-system.md）；行为/风格默认待确认，可改自动 |

**Hermes 改动边界**：优先插件 / MemoryProvider / MCP / 配置；**不改 core**，便于拉官方更新。  
本地参考：官方仓 `hermes-agent/` 已检出 **v2026.9.14**。

---

## 6. 进程与数据流（摘要）

```text
用户 / 渠道 / 定时器
    → Electron 壳
    → LifeKernel（更新状态）
    → ModelRouter 选型
    → HermesClient：POST /v1/runs + SSE
    → Hermes 执行（工具 + MCP + 记忆）
    → 结果回写 LifeKernel + UI/Live2D/TTS
```

- Hermes：`API_SERVER_KEY` + gateway API（`/v1/runs`、approval、health）  
- `HERMES_HOME`：应用数据目录（与安装目录分离，升级不丢记忆）  
- 分发：阶段 A 安装脚本/uv+源码随包；阶段 B 再评估 sidecar  

详见：[hermes-integration.md](hermes-integration.md)

---

## 7. 明确不做 / 暂缓

| 项 | 状态 |
|---|---|
| 摄像头感知 | 暂不迁入 |
| CyreneHarness 作为运行时大脑 | **废弃**（代码隔离后清理） |
| 第二套关系记忆 DMAE | **不做**（人设 Worldbook 可用简化激活） |
| 情绪驱动危险操作 | **禁止**（PolicyGate） |

---

## 8. 相关文档

- [memory-context-budget.md](memory-context-budget.md)  
- [reflection-system.md](reflection-system.md)  
- [character-cards.md](character-cards.md)  
- [hermes-integration.md](hermes-integration.md)  
- [../PLAN.md](../PLAN.md) · [../DEVELOPMENT.md](../DEVELOPMENT.md)  
- [../standards/development-process.md](../standards/development-process.md)  
