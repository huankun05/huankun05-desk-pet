# Phase 2 — 生命层（LifeKernel）设计意图

**状态**：未动工（本文档记录动工前的设计意图与现状锚点，防止换脑期间碎片化实现）  
**更新**：2026-09-28  
**上游**：[ROADMAP.md](ROADMAP.md) P2 · [hermes-integration.md](../architecture/hermes-integration.md) §1 目标拓扑

---

## 1. LifeKernel 是什么（与不是什么）

**是**：壳内独立于对话链路的"生命状态层"——维护昔涟对用户的关系状态、情绪基线与行为节律，周期性运转（反思/衰减/沉淀），向 Live2D 表现层与主动聊天提供决策输入。

**不是**：
- 不是对话大脑（那是 P1 Hermes/智核的事）；
- 不是第二套记忆系统（记忆仍是 L0/L1/L2 + DMAE，LifeKernel 只消费记忆，不另建存储）；
- 不是后端服务（无独立进程，壳内模块 + 定时器）。

## 2. 现状锚点（换脑前的散落碎片）

P2 动工前，这些能力散落在各处，LifeKernel 是把它们收拢的**收口**而非新增：

| 碎片 | 位置 | 收拢方式 |
|---|---|---|
| 关系画像 | `src/main/relationship/relationship-log.ts` | 保留为 LifeKernel 的关系输入源 |
| 语气注入 | `src/main/orchestrator/tone-injector.ts` | 保留；情绪基线经它影响表达 |
| 主动聊天的状态判断 | `src/main/proactive/`（policy/routing） | 改为消费 LifeKernel 输出的情绪/节律状态 |
| Live2D 心情/状态 | `src/renderer/live2d/` + runtime-state preview | 展示层，改由 LifeKernel 状态驱动 |
| 反思（窄版） | memory-scheduler 每 20 轮 reflect | 升级为 LifeKernel 反思循环的一部分 |

原则：**先收拢、后增强**。P2 第一个里程碑不是新能力，而是上述碎片有一个共同的状态所有者。

## 3. 最小闭环（P2-0，建议第一个 PR 的形状）

```
LifeKernel（壳内单例）
  输入：会话事件（run 结束/用户反馈）、时间节律、relationship-log
  状态：mood 基线（少量维度，先 1-3 个）、行为节律（活跃时段/打扰偏好）
  输出：runtime-state 快照（现有 runtimeState IPC 通道复用）
  触发：事件驱动 + 低频定时（分钟级），绝不进入对话请求路径
```

验收线：
- [ ] LifeKernel 模块独立目录 `src/main/life/`（或 `life-kernel/`），不 import harness/orchestrator 内部
- [ ] 现有 tone-injector / proactive-policy 至少一个改为消费 LifeKernel 状态（端到端打通一次）
- [ ] 关系/情绪状态落盘进 `<userData>` 并可备份
- [ ] 全部决策确定性可测（无 LLM 调用；LLM 反思属 P2 后期，见 §5）

## 4. 与 PolicyGate 的关系

ROADMAP 里 PolicyGate 与 LifeKernel 同属 P2。边界：LifeKernel 产出"想做什么"（倾向），PolicyGate 决定"现在能不能做"（许可）。P2-0 先不做 PolicyGate——主动聊天的 do-not-disturb 策略已承担其最小职责，收拢进 LifeKernel 后再抽接口。

## 5. 明确延后的（避免范围膨胀）

- LLM 驱动的反思/自进化（依赖 P1 换脑稳定 + 成本预算）
- 记忆层改造（P3 LifeMemoryProvider，与注入预算一起动）
- 情绪驱动 Live2D 动作编排（表现层增强，等状态层稳定）
- 跨设备状态同步

## 6. 依赖与顺序

```
P1 换脑（Chat 已接，Work/Learn/Code 待接）
  └─ P2-0 LifeKernel 最小闭环（可与 P1 并行：不依赖对话引擎，只消费事件）
       └─ P2-1 PolicyGate 抽象
            └─ P2-2 LLM 反思循环
```

P2-0 不阻塞于 P1——这是它先行的理由；但 P2-2 必须等 P1 全量换脑后（反思要调用模型，路由要稳定）。
