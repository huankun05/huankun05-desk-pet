# 昔涟 路线图（ROADMAP）

**产品**：昔涟 / Cyrene（品牌冻结）· 四模式 · **智核**（官方 Hermes）+ **心核**（LifeKernel）+ **壳**（Electron）  
**更新**：2026-09-22（按代码实况对齐；此前版本停在 2026-09-18）  
**UI 规范**：[../design/UI-DESIGN.md](../design/UI-DESIGN.md)  
**历史路线图**（CyreneHarness 时代，已收口）：[../history/cyrene-harness/2026-09-05-agent-grade-upgrade-plan.md](../history/cyrene-harness/2026-09-05-agent-grade-upgrade-plan.md)

---

## 阶段总览（按代码实况）

| 阶段 | 内容 | 状态 |
|---|---|---|
| **R0 仓库整理** | 归档旧仓、官方 Hermes、文档体系 | **完成** |
| **R1 品牌与 UI 规范** | 昔涟/Cyrene 冻结、设置通俗化、控件层 | **完成（2026-09-18）** |
| **A0 Agent 能力升级** | 并行子 Agent / 迭代预算 / 凭据加密 / 成本 / 轨迹 / 审查 / LSP… | **完成（2026-09-05~07）**，见历史路线图 |
| **P0 Hermes Spike** | gateway health + 壳内设置 | **部分**：health 通过；`HermesClient` 有骨架但**零接线**；设置 panel **未挂到 settings 页** |
| **P1 换脑** | HermesProcMgr + 四模式接 Hermes + ModelRouter | **部分**：proc-mgr 能 spawn/health/启动拉起；**无崩溃自愈**；四模式仍走 CyreneHarness；ModelRouter 未做 |
| **P2 生命层** | LifeKernel + PolicyGate + Live2D 情绪 | 未动工（仅有 relationship-log / tone-injector 等碎片） |
| **P3 记忆** | LifeMemoryProvider + 注入预算 + 角色卡 v0 | 未动工（现实是自研 L0/L1/L2 top-4，与文档模型不同） |
| **P4 工具审批** | Electron MCP + 审批 UI | 未动工 |
| **P5 反思系统** | 技能/行为进化策略 | **窄版已有**：memory-scheduler 每 20 轮 reflect；无 confirm 策略/技能进化 |
| **P6 语音** | 本地 CosyVoice/GPT-SoVITS + 云端 | 部分（多引擎 TTS/ASR 已在，本地差异化未做） |
| **P7 分发** | 安装包内置 AI 引擎 | 未动工 |
| **P8 代码清理** | 移除 legacy harness | 未动工（CyreneHarness **仍是主循环**） |

---

## 近期已落地（2026-09-18 ~ 09-22，原先未入路线图）

| 主题 | 内容 |
|---|---|
| 设置/模型 UX | 模型自动获取（`/v1/models` + 目录）、可搜索下拉、上下文推荐、401 脱敏提示、存储与备份合一 |
| 托盘重启 | 「重启应用」+ 开发态静默 restarter；提示单通道 VBS Popup（3 秒自动关） |
| QQ/NapCat | 启用渠道时自动拉起；CreateNoWindow/Hidden 静默；启停文档 |
| 品牌 | 昔涟/Cyrene 冻结；userData 目录 `live2d-cyrene`；文档同步（部分文件仍残留「汐月/Marea」） |

---

## P0 剩余验收（修正后）

- [x] 官方 Hermes 在 Windows 可启动 gateway  
- [x] `API_SERVER_KEY` + `/health`  
- [ ] 壳内设置页配置引擎 — **IPC/后端已有，`settings/hermes/panel.ts` 未挂进 settings 导航**  
- [ ] 配置模型后 `/v1/chat` + `/v1/runs` SSE 冒烟（`scripts/hermes-p0/smoke.ps1` 可跑，缺模型凭据）  
- [ ] Electron 收到流式 token（`HermesClient.runOnce/onToken` 已写，**全仓零 import**）  
- [ ] 杀进程自动重启（并入 P1；proc-mgr exit 只 `child=null`，无 watchdog）  

---

## 下一步（建议顺序，2026-09-22）

1. **P0 收尾**  
   - 把「AI 引擎」面板挂进设置导航（`initHermesPanel` 接上 `settings.ts` + `index.html`）  
   - 配一个可用云端模型 → `SMOKE_CHAT=1` 跑 chat/runs  
   - 把 `HermesClient` 接到一条最小 SSE 冒烟路径（可先命令面板/日志，不必接四模式）  
2. **P1 托管补全**  
   - proc-mgr 崩溃自愈（指数退避）+ 设置「启动时拉起」UI 可见状态/日志/手动重启  
3. **P1 四模式换脑**  
   - `agui-bridge` 接 Hermes；CyreneHarness 开关或目录隔离（不删文件）  
   - ModelRouter 最小版（按模式选 model）  
4. **体验债（可并行）**  
   - `settings.css` 拆分（12 万+ 字符巨石）  
   - 备份完整性：prompts 迁 userData；聊天/模型 Key 纳入备份策略  
   - 文档/文案品牌残留（ROADMAP/DESIGN/UI-DESIGN 内「汐月/Marea」、zh-CN.json）  
5. **P2 LifeKernel 最小闭环**（换脑稳定后再动）

非目标：摄像头、情绪放宽权限、第二套关系记忆、追 Hermes main、恢复截图热键。

---

## 相关清单

- 设置/启动遗留：[`../design/settings-fix-backlog.md`](../design/settings-fix-backlog.md)  
- UI/品牌收敛：[`../design/UI-DESIGN.md`](../design/UI-DESIGN.md) §8  
- AI 引擎接入：[`../architecture/hermes-integration.md`](../architecture/hermes-integration.md)  
- P0 细节：[`phase-0-hermes-spike.md`](phase-0-hermes-spike.md) · P1：[`phase-1-ai-engine-procmgr.md`](phase-1-ai-engine-procmgr.md)  
- 流程：[`../standards/development-process.md`](../standards/development-process.md)
