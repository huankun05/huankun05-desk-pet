
> **名称冻结（2026-09-18）**：产品 UI/打包统一为 **昔涟 / Cyrene**；**不再改名**。设置功能名保持原样（API 设置、TTS 设置等）；Hermes 在设置中称 **本地引擎**，路径自动探测，无需手填。
# PLAN — 汐月 Marea 产品与工程路线

> **产品名**：汐月 · Marea（数字生命体桌宠；角色卡与产品名分离）  
> **当前方向（2026-09-18）**：壳（Electron）+ **智核**（官方 Hermes）+ **心核**（LifeKernel）。  
> CyreneHarness **不再作为运行时大脑**（历史见 `docs/history/`）。  
> UI/品牌：[`docs/design/UI-DESIGN.md`](docs/design/UI-DESIGN.md) · [`docs/standards/ui-and-branding.md`](docs/standards/ui-and-branding.md)  
> 总架构：[`docs/architecture/DESIGN.md`](docs/architecture/DESIGN.md)  
> 路线图：[`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md)

---

## 产品一句话

有情感、有记忆的桌面角色；Chat / Work / Code / Learn 是四种相处方式，共享同一套大脑与关系记忆。

---

## 已定决策

| 项 | 结论 |
|---|---|
| 大脑 | 官方 Hermes `v2026.9.14`，只扩展不改 core |
| 四模式 | 全部走 Hermes；模型默认云端 |
| 心 | 自研 LifeKernel；安全上 PolicyGate 兜底 |
| 记忆 | Hermes MemoryManager + LifeMemoryProvider；注入有预算 |
| 人设 | 角色卡可换；记忆默认共享 |
| 进化 | 反思系统；行为/风格默认 confirm，可选 auto |
| 语音 | 本地 + 云端；CosyVoice 等差异化 |
| 暂缓 | 摄像头 |

---

## 当前状态（2026-09-18）

| 模块 | 状态 |
|---|---|
| 品牌 | **汐月 · Marea**；设置层名 **AI 引擎 / 模型服务** 等已通俗化 |
| UI 规范 | `docs/design/UI-DESIGN.md`；controls.css + 语义 token 已落地 |
| Electron 壳 / 渠道 / 设置 | 保留可用 |
| AI 引擎（Hermes） | 官方 v2026.9.14；Windows health 通过；**壳内设置页已接** |
| HermesClient | 骨架已写，待模型配置后接 SSE/UI |
| 心核 LifeKernel | 未迁入（旧逻辑在 archives/desk-pet-old） |
| CyreneHarness 运行时 | 待 P1 隔离清理 |

---

## 近期优先级

1. **P0 收尾**：模型配置 + chat/runs SSE  
2. **P1** 进程托管 + 四模式换脑  
3. **P2** LifeKernel  
4. 见 [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md)  

---

## 开发入口

```bash
cd desk-pet
npm run dev
```

- 工程流程：[`DEVELOPMENT.md`](DEVELOPMENT.md)  
- UI/品牌：[`docs/design/UI-DESIGN.md`](docs/design/UI-DESIGN.md)  
- AI 引擎本地脚本：[`scripts/hermes-p0/README.md`](scripts/hermes-p0/README.md)  

---

## 变更日志（计划层）

| 日期 | 变更 |
|---|---|
| 2026-09-18 | 产品名汐月·Marea；设置通俗化；UI 规范与控件层；P0 health/壳内设置 |
| 2026-09-17 | Hermes+心核+壳方向；仓库整理；文档体系 |
| 2026-09-05 | 曾规划保留 CyreneHarness（已被取代） |
| 2026-09-03 | 迁移到 Cyrene-Agent 底座 |

