# 昔涟 路线图（ROADMAP）

**产品**：昔涟 / Cyrene（品牌冻结）· 四模式 · **智核**（官方 Hermes）+ **心核**（LifeKernel）+ **壳**（Electron）  
**更新**：2026-09-28（v1.2.0 基线 + 对话回路 e2e；2026-09-24 「本地引擎」面板挂载 + HermesClient 接线）  
**UI 规范**：[../design/UI-DESIGN.md](../design/UI-DESIGN.md)  
**历史路线图**（CyreneHarness 时代，已收口）：[../history/cyrene-harness/2026-09-05-agent-grade-upgrade-plan.md](../history/cyrene-harness/2026-09-05-agent-grade-upgrade-plan.md)

---

## 阶段总览（按代码实况）

| 阶段 | 内容 | 状态 |
|---|---|---|
| **R0 仓库整理** | 归档旧仓、官方 Hermes、文档体系 | **完成** |
| **R1 品牌与 UI 规范** | 昔涟/Cyrene 冻结、设置通俗化、控件层 | **完成（2026-09-18）** |
| **A0 Agent 能力升级** | 并行子 Agent / 迭代预算 / 凭据加密 / 成本 / 轨迹 / 审查 / LSP… | **完成（2026-09-05~07）**，见历史路线图 |
| **P0 Hermes Spike** | gateway health + 壳内设置 | **近完成**：health 通过；「本地引擎」面板已挂进设置导航；`HermesClient` 经 `hermes-client-factory` 接线 + 冒烟 IPC/按钮；剩模型凭据实跑 |
| **P1 换脑** | HermesProcMgr + 四模式接 Hermes + ModelRouter | **部分**：proc-mgr 能 spawn/health/启动拉起；**无崩溃自愈**；四模式仍走 CyreneHarness；ModelRouter 未做 |
| **P2 生命层** | LifeKernel + PolicyGate + Live2D 情绪 | 未动工（仅有 relationship-log / tone-injector 等碎片） |
| **P3 记忆** | LifeMemoryProvider + 注入预算 + 角色卡 v0 | 未动工（现实是自研 L0/L1/L2 top-4，与文档模型不同） |
| **P4 工具审批** | Electron MCP + 审批 UI | 未动工 |
| **P5 反思系统** | 技能/行为进化策略 | **窄版已有**：memory-scheduler 每 20 轮 reflect；无 confirm 策略/技能进化 |
| **P6 语音** | 本地 CosyVoice/GPT-SoVITS + 云端 | 部分（多引擎 TTS/ASR 已在，本地差异化未做） |
| **P7 分发** | 安装包内置 AI 引擎 | 未动工 |
| **P8 代码清理** | 移除 legacy harness | 未动工（CyreneHarness **仍是主循环**） |

---

## 近期已落地（2026-09-18 ~ 09-24，原先未入路线图）

| 主题 | 内容 |
|---|---|
| 设置/模型 UX | 模型自动获取（`/v1/models` + 目录）、可搜索下拉、上下文推荐、401 脱敏提示、存储与备份合一 |
| 托盘重启 | 「重启应用」+ 开发态静默 restarter；提示单通道 VBS Popup（3 秒自动关） |
| QQ/NapCat | 启用渠道时自动拉起；CreateNoWindow/Hidden 静默；启停文档 |
| 品牌 | 昔涟/Cyrene 冻结；userData 目录 `live2d-cyrene`；settings i18n `appTitle`/`nav.brand` 清零（部分文件仍残留「汐月/Marea」） |
| **本地引擎面板** | 「本地引擎」进设置导航：health 检查、端点展示、启动时拉起开关、凭据同步；IPC 六件套 + preload 桥 |
| **HermesClient 接线** | `hermes-client-factory.ts` 按有效设置构造 client；`runHermesSmoke()` 分步冒烟；`HERMES_RUN_SMOKE` IPC + 设置页「运行冒烟测试」按钮；17 个单测 |
| **质量基建（2026-09-28）** | v1.2.0 基线 tag + CHANGELOG 版本切分；`e2e/chat-loop.spec.ts`（mock OpenAI 服务 + `CYRENE_USER_DATA_DIR` 隔离，Chat 模式经 agui-bridge 全链路回归，换脑前后的行为对比基线）；设置窗关键路径 e2e；`prompts/README.md` 资产索引 |

---

## P0 剩余验收（修正后）

- [x] 官方 Hermes 在 Windows 可启动 gateway  
- [x] `API_SERVER_KEY` + `/health`  
- [x] 壳内设置页配置引擎 — 「本地引擎」面板已挂进设置导航（nav + panel + initHermesPanel）
- [ ] 配置模型后 `/v1/chat` + `/v1/runs` SSE 冒烟（`scripts/hermes-p0/smoke.ps1` 可跑，缺模型凭据）
- [x] Electron 收到流式 token — `HermesClient` 已接线：`hermes-client-factory.ts` 按有效设置构造 client，`HERMES_RUN_SMOKE` IPC + 设置页「运行冒烟测试」按钮；`runOnce/onToken` 有 12 个单测覆盖（含跨块 SSE）
- [ ] 杀进程自动重启（并入 P1；proc-mgr exit 只 `child=null`，无 watchdog）  

---

## 下一步（建议顺序，2026-09-24）

1. **P0 最后一项**  
   - 在「模型服务」配一个可用云端模型 → 「本地引擎」点「立即同步模型服务凭据」→ 点「运行冒烟测试」，应看到 `✓ health` + `✓ chat`
2. **P1 托管补全**  
   - proc-mgr 崩溃自愈（指数退避）+ 设置「启动时拉起」UI 可见状态/日志/手动重启
3. **P1 四模式换脑**  
   - `agui-bridge` 接 Hermes（已有 `hermes-client-factory` 可复用）；CyreneHarness 开关或目录隔离（不删文件）  
   - ModelRouter 最小版（按模式选 model）
4. **体验债（可并行）**  
   - `settings.css` 拆分（12 万+ 字符巨石）  
   - 巨型文件拆分：`renderer/settings/settings.ts`（2739 行，旧栈巨石）、`ChatPage.tsx`（2135）、`preload/index.ts`（941，IPC 桥与 `shared/ipc-channels.ts` 手写同步）  
   - 设置中心 React 化：旧原生 DOM settings 栈与 `renderer/react/` 双轨并存，建议作为 P1 伴生任务与换脑共用回归基建（e2e 已覆盖设置窗关键路径）  
   - 备份完整性：prompts 迁 userData；聊天/模型 Key 纳入备份策略  
   - 文档/文案品牌残留（ROADMAP/DESIGN/UI-DESIGN 内「汐月/Marea」、zh-CN.json 内的角色名场景）
5. **P2 LifeKernel 最小闭环**（换脑稳定后再动）

非目标：摄像头、情绪放宽权限、第二套关系记忆、追 Hermes main、恢复截图热键。

---

## 相关清单

- 设置/启动遗留：[`../design/settings-fix-backlog.md`](../design/settings-fix-backlog.md)  
- UI/品牌收敛：[`../design/UI-DESIGN.md`](../design/UI-DESIGN.md) §8  
- AI 引擎接入：[`../architecture/hermes-integration.md`](../architecture/hermes-integration.md)  
- P0 细节：[`phase-0-hermes-spike.md`](phase-0-hermes-spike.md) · P1：[`phase-1-ai-engine-procmgr.md`](phase-1-ai-engine-procmgr.md)  
- 流程：[`../standards/development-process.md`](../standards/development-process.md)
