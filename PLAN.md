
> **名称冻结（2026-09-18）**：产品 UI/打包统一为 **昔涟 / Cyrene**；**不再改名**。设置功能名保持原样（API 设置、TTS 设置等）；Hermes 在设置中称 **本地引擎**，路径自动探测，无需手填。
# PLAN — 昔涟 Marea 产品与工程路线

> **产品名**：昔涟 / Cyrene（品牌冻结）（数字生命体桌宠；角色卡与产品名分离）  
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

## 当前状态（2026-09-22 按代码实况）

| 模块 | 状态 |
|---|---|
| 品牌 | **昔涟 / Cyrene（品牌冻结）**；设置层名 **AI 引擎 / 模型服务** 已通俗化；部分文档/UI 仍残留「汐月/Marea」 |
| UI 规范 | `docs/design/UI-DESIGN.md`；controls.css + 语义 token 已落地；仍多主题 + `--rb-*` legacy |
| Electron 壳 / 渠道 / 设置 | 可用；模型自动获取/存储备份/托盘重启/QQ 自动拉起 9/18–22 已补 |
| AI 引擎（Hermes） | 官方 v2026.9.14；Windows health 通过；proc-mgr 能 spawn/启动拉起；**无崩溃自愈** |
| 壳内 AI 引擎设置 | IPC/后端已有，**settings 页 panel 尚未挂上**（与旧文档不一致） |
| HermesClient | health/chat/runs SSE 骨架已写，**全仓零接线** |
| 心核 LifeKernel | 未迁入（旧逻辑在 archives/desk-pet-old；现仅有 relationship-log 等碎片） |
| CyreneHarness 运行时 | **仍是主循环**（四模式未换脑）；待 P1 隔离 |

---

## 近期优先级

1. **P0 收尾**：挂上 AI 引擎设置面板 + 模型配置 + chat/runs SSE 冒烟 + HermesClient 接线  
2. **P1** proc-mgr 崩溃自愈/日志 UI + 四模式换脑  
3. **体验债**：settings.css 拆分、备份完整性、品牌残留  
4. **P2** LifeKernel  
5. 详见 [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md)（2026-09-22 已按实况重写）  

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
| 2026-09-22 | ROADMAP/PLAN 按代码实况对齐：修正「设置已接/HermesClient 可用/P1 未动工」等偏差；补 9/18–22 设置/重启/QQ 线 |
| 2026-09-18 | 产品名昔涟·Marea（后冻结为 **昔涟/Cyrene**）；设置通俗化；UI 规范与控件层；P0 health |
| 2026-09-17 | Hermes+心核+壳方向；仓库整理；文档体系 |
| 2026-09-05 | 曾规划保留 CyreneHarness（已被取代）；同日 agent-grade-upgrade P0–P4 完成 |
| 2026-09-03 | 迁移到 Cyrene-Agent 底座 |

