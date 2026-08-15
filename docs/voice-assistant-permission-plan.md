# 语音助手「行动模式」+ 权限管理体系 · 实施方案计划（v2）

> 目标：在 desk_pet 现有「唤醒词 → 语音助手 → Chat Pipeline → 工具循环」链路上，叠加一套**权限/能力（Capability）管理体系**与**人性化设置 UI**，让语音不仅能聊天，还能像小爱同学一样**被授权后执行本地操作**（打开应用、存文件到桌面、联网搜集资料、执行命令等），同时做到**知情同意、可审计、可紧急中止**。
>
> **v2 主要变更（按用户反馈）**：① 授权模型升级为「始终允许 / 每次询问 / 拒绝 + 仅一次（运行时）」四态；② 中高危能力**首次触发弹确认卡**，让用户当场选「仅一次 / 永久 / 每次确认 / 拒绝」；③ 设置页**按风险等级分组、默认全部折叠**，点击展开看已同意项；④ 高危操作**红色醒目警示 + 参数级确认**；⑤ 全量**审计日志**（麦克风/相机/命令/打开应用等一切使用留痕）；⑥ 补全系统能力分层、危险命令黑名单、紧急停止、撤销预览、智能提权建议等缺失项。

---

## 一、调研结论（业界怎么做）

| 来源 | 关键做法 | 我们可借鉴 |
|------|----------|-----------|
| **小爱同学（小米 Agent 化）** | 代码式语义表示 + 多 Agent 协同；意图+槽位；连续多轮对话 | 唤醒后进入「行动模式」，LLM 用 function calling 规划多步任务，本身就是多轮工具循环 |
| **PersonaForge（consent-first Windows 语音 Agent）** | 语音→意图→动作→语音；**风险分级**；中高风险弹 consent；**审计日志**（链式哈希防篡改）；**紧急停止快捷键**；本地优先 | 直接沿用：风险分级 + 确认卡 + 审计 + Kill Switch |
| **Claude Code / Codex（终端 AI 工具授权）** | 每次工具调用按策略把关：**Allow always / Allow once / Reject / 每次询问**；高危命令展示原文并要求确认 | 我们的授权四态 + 确认卡按钮设计直接对标 |
| **Microsoft Agentic Windows / Copilot Actions** | 默认 opt-in；**每次操作需授权**；删除/改系统设置多次确认；可见进度、可暂停/撤销 | 敏感操作二次确认；能力粒度授权；撤销预览 |
| **腾讯云语音桌面助手 Demo** | Ollama + Windows-MCP；**每次操作需用户授权**；为 Agent 建权限受限沙盒 | 权限闸门放在工具执行前 |
| **百度语音助手架构** | 五层；NLU 意图+槽位；对话状态机；隐私（本地声纹、TLS） | 本地处理、不上传 |

**提炼的设计原则**：
1. **知情同意优先（consent-first）**：任何有副作用的操作，未经授权不执行。
2. **风险分级 + 分级授权 + 醒目警示**：低危默认允许，中危每次询问，高危始终询问且红色警示 + 二次确认。
3. **四级授权（对标终端 AI 工具）**：始终允许 / 每次询问 / 拒绝（持久态）+ 仅一次（运行时一次性）。
4. **本地优先、可审计、可中止**：所有动作留痕，一键中止。
5. **能力可粒度管理**：逐项开关 + 选择授权模式，且随时可改；非一刀切。
6. **避免脆弱的 UI 自动化**：不靠"模拟点击 App 内部按钮"，优先用应用命令行/URL Scheme/系统媒体键。

---

## 二、现状盘点（我们已有什么 / 缺什么）

**✅ 已经具备（直接复用，不必重造）**
- `useWakeWord`：唤醒词检测（如"汐月"）→ 触发 `useVoiceAssistant`。
- `useVoiceAssistant`：录音(VAD 静音自动停) → STT → `sendMessage` 进 Chat Pipeline。
- `ToolLoopRunner`（`services/pipeline/tool-loop.ts`）：多轮 function-calling 循环，调用 `toolRegistry.execute`。
- 内建工具（`services/tools/builtins.ts`）：`web_search`、`save_to_desktop`、`write_file`/`read_file`/`list_directory`、`open_url`、`screenshot`、`read_clipboard`、`system_info`。
- 设置页新增模式已固化：三处注册 + i18n（见 MEMORY「设置页 + i18n」）。

**❌ 缺失（本次要做）**
1. **权限/能力管理体系**：工具只有 `enabled` 开关，**没有 consent 闸门**；无授权、无确认、无审计。
2. **本地操作类工具**：`open_app`、`run_command`、`media_control` 缺失。
3. **人性化的权限设置页**：无「隐私与权限」管理入口、无分级折叠、无审计视图。
4. **语音确认 / 紧急停止 / 审计日志 UX**：缺失。

> 结论：核心工作量不在"让语音能干活"，而在"给干活加上安全可控的授权层 + 配套设置"。

---

## 三、总体架构设计

在 `ToolLoopRunner` 调用 `toolRegistry.execute` 之前插入 **PermissionManager（权限网关）**，与 UI 解耦（事件总线）。

```
┌─────────────┐  唤醒词   ┌────────────────┐  STT  ┌──────────────────┐
│ useWakeWord │─────────▶│useVoiceAssistant│──────▶│  Chat Pipeline   │
└─────────────┘          └────────────────┘        │  (LLM + 工具循环) │
                                                    └────────┬─────────┘
                                                             │ 想调用工具 call
                                                             ▼
                                       ┌─────────────────────────────────┐
                                       │  PermissionManager（本地单例）   │
                                       │ ① call.name → Capability        │
                                       │ ② 查系统能力(麦克风等)是否就绪    │
                                       │ ③ 查授权策略(always/ask/deny)    │
                                       │ ④ ask→请求同意；高危→红警+参数确认│
                                       │ ⑤ deny→友好回绝                 │
                                       │ ⑥ 执行前写审计日志               │
                                       └───┬───────────────────┬────────┘
                                      允许 │                   │ 拒绝/未授权
                                           ▼                   ▼
                                 ┌──────────────────┐  ┌──────────────────┐
                                 │ toolRegistry     │  │ 友好回绝消息      │
                                 │ .execute(tool)   │  │ → LLM 自然回应    │
                                 └────────┬─────────┘  └──────────────────┘
                                          │ 执行结果 + 审计落盘
                                          ▼
                                 ┌──────────────────────────────────────────┐
                                 │ 审计日志 (本地 jsonl) + 紧急停止 Kill Switch │
                                 └──────────────────────────────────────────┘

      同意请求经事件总线跨窗推送 → ConsentGate 组件（主窗+聊天面板）
      显示「确认卡」(允许一次/始终允许/每次询问/拒绝) 并 TTS 播报"要我帮你…吗？"
```

**解耦点**：`PermissionManager.requestConsent()` 返回 `Promise<Decision>`；它 `emit('permission:request', payload)`，`ConsentGate` 订阅并弹卡，用户选择后 `emit('permission:resolve', {requestId, decision})` 反向 resolve。权限逻辑与 React 渲染解耦，工具循环无需直接碰 DOM。

---

## 四、权限模型设计（v2 核心）

### 4.1 双层能力分类

**A. 系统能力（System Capabilities）** —— 应用自身运转所需的 OS 权限，由操作系统授予；设置页只**展示其授权状态**（是否被授予），不在此层管控"助手能否执行动作"。
| 系统能力 | 说明 | 用途 |
|----------|------|------|
| `sys.microphone` | 麦克风 | STT 语音识别必需 |
| `sys.camera` | 摄像头 | 未来视觉/拍照类（预留） |
| `sys.screen_capture` | 屏幕录制 | 截屏工具底层 |
| `sys.file_access` | 文件系统读写 | 存桌面/写文件底层 |
| `sys.network` | 网络访问 | 联网搜索/LLM 通信 |

**B. 操作能力（Action Capabilities）** —— 助手被授权后替你执行的动作，受 PermissionManager 管控（下表即设置页"操作能力"分组内容）。
| Capability | 工具 | 风险 | 默认授权 | 说明 |
|------------|------|------|----------|------|
| `web_search` | `web_search` | 低 | 始终允许 | 只读联网查询 |
| `read_clipboard` | `read_clipboard` | 低 | 始终允许 | 读本地剪贴板 |
| `system_info` | `system_info` | 低 | 始终允许 | 只读系统信息 |
| `open_url` | `open_url` | 中 | 每次询问 | 打开外部网页 |
| `screenshot` | `screenshot` | 中 | 每次询问 | 截屏（含隐私） |
| `save_to_desktop` | `save_to_desktop` | 中 | 每次询问 | 桌面落盘文件 |
| `write_file` | `write_file` | 中 | 每次询问 | 写任意文件 |
| `open_app` | `open_app`（新） | 中 | 每次询问 | 启动本地应用 |
| `media_control` | `media_control`（新） | 中 | 每次询问 | 系统媒体键 |
| `run_command` | `run_command`（新） | **高** | 每次询问+红警 | 执行 shell 命令 |

### 4.2 风险等级与配色
- 🟢 **低危 (Low)**：只读/无害操作，绿色，默认始终允许。
- 🟡 **中危 (Medium)**：有副作用但可逆，黄色，默认每次询问。
- 🔴 **高危 (High)**：不可逆 / 隐私敏感 / 系统级，红色整条醒目，默认每次询问 + 强制二次确认，**不默认给予"始终允许"**。

### 4.3 授权状态模型（四态 + 默认策略）
**持久化策略（每个能力一项，存本地）**：
- `always` **始终允许** —— 直接执行，不再询问。
- `ask` **每次询问** —— 每次调用弹确认卡。
- `deny` **拒绝（永久）** —— 禁用并友好回绝（对应"不再询问/拒绝"）。

**运行时一次性决策（不持久化）**：
- `once` **仅一次** —— 本次调用允许，之后仍按策略（ask）继续询问；对应确认卡按钮"允许一次"。
- `session` **本次会话允许** —— 当前会话内该能力不再询问；对应确认卡按钮"本次会话允许"。
- **🔓 本次会话全部允许（一键默认允许）**：总开关区提供一个"信任本会话"开关。开启后，`PermissionManager` 在本次会话内**跳过所有 ask 确认**（直接按 allow 执行），彻底消除频繁弹窗——对标 Claude Code 的 "Plan/AcceptEdits" 式信任模式。
  - **安全底线**：即便开启"本次会话全部允许"，**内置危险命令黑名单的二次确认仍然保留**（如 `rm -rf`/`format`/注册表写），可在设置中关闭此底线。
  - 范围限定为"本次会话"：应用重启或手动关闭开关即失效，不持久化，避免永久放权。

> 说明：用户首次看到的弹窗选项是 **[允许一次] [始终允许] [每次询问] [拒绝]**。其中"每次询问"即把持久策略设为 `ask`（以后每次再弹）；"仅一次"本次放行、不改持久策略；"本次会话允许"为本会话内放行。另有全局"本次会话全部允许"开关做一键免确认。

**默认策略（按风险，呼应"有些默认允许"）**：
- 低危 → `always`
- 中危 → `ask`（首次触发弹窗让用户选）
- 高危 → `ask` + 红警（且默认不给 `always`，需用户显式提升）

### 4.4 首次询问与确认卡（ConsentGate）
- 首次遇到某中/高危能力（无持久策略 或 策略=`ask`）→ 弹确认卡，按钮：
  **[允许一次] [始终允许] [每次询问] [拒绝]**
  白话文案："助手想打开「网易云音乐」，要我继续吗？"
- **高危额外**：参数级展示（要执行的命令原文 / 目标路径 / 目标应用）以**红色高亮**，并强制**二次确认勾选**才放行。
- **语音通道**：TTS 播报同样内容，支持语音应答（"允许"/"拒绝"/"这次就行"）作为可选项。

### 4.5 高危二次确认 + 危险命令黑名单
- `run_command` 命中危险关键词（`rm -rf` / `del` / `format` / `reg add` / `reg delete` / `mkfs` / `shutdown` / `taskkill` / `:(){` 等）→ 强制二次确认；默认 `deny`，须用户显式改为 `ask` 并确认。
- 维护**内置黑名单 + 用户可配置白名单**（设置页可增删放行项）。

### 4.6 审计日志模型
- 每条记录字段：时间戳、能力/工具名、动作描述（如"使用麦克风(STT)"、"执行命令: `dir C:\`"、"打开应用: 网易云"）、决策（允许/仅一次/拒绝）、触发来源（语音唤醒 / 手动）、可选参数摘要。
- 本地存储 `data/permission_audit.jsonl`（滚动保留），**绝不联网**。
- **保留时长用户可选**（设置页下拉条）：`一周 / 一个月 / 三个月 / 永久`（默认**一个月**），到期自动滚动清理旧记录。
- 设置页可查看 / 按能力+等级筛选 / 导出 CSV / 清空（需二次确认）。

---

## 五、人性化设置页设计（新增「隐私与权限」）

新增顶级分区 `/settings/privacy`，严格沿用现有三处注册模式 + i18n。

**页面构成**：
1. **总开关区**：语音操作总开关、敏感操作二次确认、**🔓 本次会话全部允许（一键默认允许，限本次会话）**、操作审计日志、紧急停止快捷键（显示+可改）。
2. **按风险等级分组的折叠面板（默认全部折叠）**：
   - 三个分组：**🟢 低危 / 🟡 中危 / 🔴 高危**，点击分组标题展开 → 列出该等级下所有能力。
   - 每条能力显示：图标 + 名称 + 白话说明 + **授权模式分段控件（始终允许 / 每次询问 / 拒绝）** + 最近使用时间 + 使用次数。
   - 🔴 高危分组标题与条目用**红色醒目**；展开后高危条目额外显示"⚠️ 高风险操作"标签。
   - 用户可随时改任意一条的授权方式（每次询问 ⇄ 始终允许 ⇄ 拒绝），立即生效并写审计。
3. **系统能力区**：单独展示 `sys.microphone` 等 OS 授权状态（已授予/未授予/未知），引导去系统设置开启；与"操作能力"授权区分清楚。
4. **审计日志区**：列表 + 筛选（按能力/等级/时间）+ **保留时长下拉（一周/一个月/三个月/永久，默认一个月）** + 导出 CSV + 清空（二次确认）。
5. **隐私声明卡**：本地优先、语音与操作不上传、可随时撤销授权。
6. **重置**：单条恢复默认 + 全局恢复默认（二次确认）。

**确认卡（ConsentGate）视觉**：出现在聊天面板气泡区，半透明卡显示「助手想：打开网易云音乐并播放《晴天》」+【允许一次】【始终允许】【每次询问】【拒绝】；高危时卡面红色描边 + 命令/路径原文 + 二次确认勾选；同时 TTS 播报确认语。

---

## 六、补充设计点（缺失补全清单）

在用户反馈基础上，额外补全以下必要项，使方案完整：

| # | 补充项 | 说明 |
|---|--------|------|
| 1 | **系统能力 vs 操作能力分离** | 区分"应用能不能用麦克风"(OS 权限) 与"助手能不能执行动作"(我们的 consent)，避免概念混淆 |
| 2 | **危险命令内置黑名单 + 用户白名单** | `run_command` 安全护栏，阻断 `rm -rf`/`format`/注册表等，用户可加白 |
| 3 | **紧急停止 Kill Switch** | 全局快捷键（默认 `Ctrl+Shift+X`，可改）+ 语音"停下/取消" → 中断当前工具循环 |
| 4 | **语音确认通道** | TTS 播报确认语 + 支持语音应答"允许/拒绝"，全程免手 |
| 5 | **重置 / 恢复默认** | 单条 + 全局，二次确认，防止误锁死 |
| 6 | **审计日志隐私** | 本地-only、不联网、可清空、可导出 |
| 7 | **智能提权建议（进阶）** | 同一能力被"允许一次" ≥ N 次，提示"是否改为始终允许"，减少重复点击 |
| 8 | **撤销预览** | 写/删文件前显示目标路径 + 大小，确认后再执行 |
| 9 | **首次运行权限向导** | 首次进入"行动模式"弹一页说明三类风险与推荐默认，一键采纳/自定义 |
| 10 | **i18n 双语言** | zh-CN + en-US 同步 |

---

## 七、新增动作工具规格

### `open_app`（打开本地应用）
- 参数：`app_name`（必填，模糊匹配"网易云"→真实名）、`action?`（应用特定指令/URL Scheme）。
- 实现：Rust `open_app` 命令 → 查**应用目录**解析真实名 → Tauri `open` / PowerShell `Start-Process`。
- **应用目录**：PowerShell `Get-StartApps` + 扫描开始菜单/Program Files 构建本地可发现列表，模糊匹配让"打开网易云"命中。
- **务实边界**：只做"启动应用"；"在网易云里搜某首歌"优先用该 App 的 URL Scheme/命令行参数，不模拟点击内部 UI。

### `run_command`（执行命令，高危）
- 参数：`command`、`cwd?`。Rust `run_shell_command`（PowerShell）。始终 `ask` + 破坏性二次确认（见 4.5 黑名单）。

### `media_control`（系统媒体键，中危，可选 Phase）
- 参数：`action`（play/pause/next/prev）。PowerShell 发送媒体键事件（或 `nircmd`）。让"播放/下一首"无需进具体 App。

---

## 八、语音交互 UX 流程

1. 唤醒词 → 进入聆听 → STT → 进 Chat Pipeline。
2. 若 LLM 规划调用工具（即"行动"），`PermissionManager` 逐工具把关：
   - 低危且 `always` → 静默执行。
   - 中/高危或 `ask` → 弹确认卡（按 4.4）+ TTS 确认语，等用户选（或语音应答）。
   - 高危 → 红色警示 + 参数级确认 + 危险命令黑名单拦截。
3. 工具结果回传 LLM 继续多轮，直到完成 → TTS 播报结果。
4. **紧急停止**：全局快捷键 / 语音"停下" → 置位 pipeline `onAbort`，立即中断。

**示例（落地路径）**：
- 「帮我去收集关于人工智能最前沿的新闻，写成 markdown 放桌面」
  → `web_search`(低危,静默) → `save_to_desktop`(中危,首次弹确认) → 允许 → 完成。
- 「打开网易云播放《晴天》」
  → `open_app("网易云")` 授权打开；播放走 `media_control` 或 App URL Scheme。

---

## 九、分阶段实施计划（更新）

| 阶段 | 内容 | 关键文件 | 产出 |
|------|------|----------|------|
| **P0 权限网关（核心）** | `PermissionManager` 单例：双层能力定义、风险分级、四态授权查询、首次询问事件总线、系统能力检查、审计写入；包装 `toolRegistry.execute`；`ToolLoopRunner` 改用之 | `src/services/permission/*`(新)、`tool-loop.ts`、`registry.ts` | 工具执行前必经授权；拒绝/审计可用 |
| **P1 设置页** | `/settings/permissions`：总开关 + **按风险折叠分组(默认折叠)** + 系统能力区 + 审计日志查看/筛选/导出/清空 + 重置 + i18n | `routes.tsx`、`settingsTree`、`pages/permissions/*`、`zh-CN.json`/`en-US.json` | 可逐项授权、随时改模式的人性化界面 |
| **P2 新工具** | `open_app` + 应用目录（Rust）；`run_command`（Rust + 黑名单）；可选 `media_control` | `builtins.ts`、Rust `lib.rs`/`commands.rs`、`capabilities/default.json` | 本地操作能力补齐 |
| **P3 语音 UX** | `ConsentGate` 确认卡 UI 已在 P0/P1 落地（四按钮 + 高危红警 + 参数级确认，主窗+聊天面板）；本阶段补 **TTS 确认语播报、语音应答、紧急停止快捷键、首次运行权限向导** | `ConsentGate.tsx`、`useGlobalShortcuts.ts`、向导组件 | 知情同意 + 可中止闭环 |
| **P4 打磨** | 高危二次确认 + PIN（可选）、撤销预览、智能提权建议、限流、文档 `docs/voice-permission.md`、`settings:check` 全绿 | 各阶段文件 + 文档 | 可交付 |
| **P5 唤醒可视层（后续探讨）** | 唤醒后在屏幕**上方中央"刘海"位置**渲染**声纹/声波波浪动画**；实时显示 STT 语音转文字字幕；与现有唤醒链路（`useWakeWord`）对接 | `WakeOverlay.tsx`(新)、动画组件 | 唤醒有视觉反馈、说话可见字幕 |

> 建议优先级：**P0 → P1 → P2 → P3 → P4**（核心闭环），**P5 唤醒可视层作为后续独立阶段**，待核心授权闭环跑通后再细聊视觉与交互细节。
> P0+P1 即可让"搜新闻存桌面"带上授权闭环，是最小可用切片。

---

## 九·补、实施状态（截至 2026-08-15）

### ✅ P0 权限网关（已完成）
- `src/services/permission/types.ts`：定义 `RiskLevel` / `AuthMode` / `ConsentDecision` / `RetentionPeriod` / `CapabilityDef` / `AuditEntry` 等类型。
- `src/services/permission/capabilities.ts`：`ACTION_CAPABILITIES`（11 项：低危 web_search/read_clipboard/system_info 默认 always；中危 open_url/screenshot/save_to_desktop/write_file/open_app/media_control 默认 ask；高危 run_command 默认 ask+红警）、`SYSTEM_CAPABILITIES`（麦克风/摄像头/录屏/文件/网络）、`DANGEROUS_COMMAND_PATTERNS` 黑名单、按工具名映射 `getCapabilityByTool()`、危险命令检测 `checkDanger()`。
- `src/services/permission/PermissionManager.ts`：单例，localStorage 持久化（启用开关 / 各能力策略 / 本次会话信任 / 审计开关+日志 / 保留时长 / 命令白名单）；核心 `authorize()` 走「启用→会话信任(危险命令仍强制)→策略 always/deny/ask→emit permission:request 经事件总线→等待 permission:resolve，120s 超时默认拒绝」；`recordAudit`（上限 2000）；`getUsageStats`；`resetSessionTrustOnLaunch`（启动清会话信任）；`resetAll`。
- `src/services/eventBus.ts`：EventMap 新增 `permission:request` / `permission:resolve`。
- `src/services/tools/registry.ts`：`execute()` 内统一调用 `permissionManager.authorize()`（**单一闸口**，同时覆盖前端 pipeline 与 Gateway `tool:execute` 两条路径）；未授权返回友好回绝文本（非 isError，LLM 自然回应）。
- `src/services/tools/executor.ts`：`registerGatewayToolExecutor(sendResult)` 订阅 `tool:execute` → 走 gated `toolRegistry.execute` → 回传结果；`MainPetApp` 与 `ChatPanelWindow` 共用。

### ✅ P1 设置页（已完成）
- `src/settings/routes.tsx`：新增 loader `'/settings/privacy'` + 顶级入口「隐私与权限」（order 5）。
- `src/settings/pages/privacy/PermissionsIndex.tsx`：总开关区（启用 / 🔓 本次会话全部允许 / 记录日志）、按风险等级**默认折叠**分组（每项 SegmentedControl 始终允许/每次询问/拒绝 + 最近使用 + 次数）、系统能力区（OS 控制徽章）、审计日志区（**保留时长下拉：一周/一个月/三个月/永久，默认一个月** + 搜索 + 风险筛选 + 导出 CSV + 清空）、隐私声明、恢复默认（二次确认）。
- `src/components/ConsentGate.tsx`：订阅 `permission:request`，排队渲染确认卡（`createPortal` 挂 `document.body`，z-99999），四按钮 [允许一次/始终允许/每次询问/拒绝]，高危红边 + 参数摘要 + "我已知晓风险"勾选；主窗与聊天面板均挂载。
- i18n：`zh-CN.json` / `en-US.json` 新增 `settings.privacy.*` 全量命名空间；授权方式 / 保留时长选项改为 `t()` 动态取值（中英双语）。
- **验证**：`tsc --noEmit` 0 错；`npm run settings:check` 全绿（37 路径 / 38 loader / 9 Index）。

### 🟡 P2–P5（待实现）
- **P2 新工具**：`open_app`（应用目录模糊匹配 + Rust `open_app` 命令）、`run_command`（Rust `run_shell_command` + 黑名单）、`media_control`（系统媒体键）。权限闸口已就位，装上工具即可被管控。
- **P3 语音 UX**：ConsentGate **UI 已在 P0/P1 落地**（四按钮+高危红警+参数确认），但 **TTS 确认语播报、语音应答、紧急停止快捷键、首次运行权限向导** 仍待实现。
- **P4 打磨**：高危二次确认 + PIN（可选）、撤销预览、智能提权建议、限流、本文档定型。
- **P5 唤醒可视层**：屏幕上方中央「刘海」位声纹波浪动画 + 实时 STT 字幕（独立阶段，待核心闭环跑通后细聊）。

> 已落地的 P0/P1 已能让「搜新闻存桌面」等动作带完整授权闭环；`open_app`/`run_command`/`media_control` 三个工具补齐后即达成验收标准 2–3。

---

## 十、风险与边界

- **本地优先、不上传**：权限与审计全留本地，符合隐私原则。
- **不碰脆弱 UI 自动化**：不模拟点击第三方 App 内部控件；优先命令行/URL Scheme/系统媒体键。
- **破坏性操作必须多确认**：`run_command` 含删除/格式化/注册表等关键词强制二次确认，默认 `deny`。
- **避免权限疲劳**：低危默认允许，只有真正有副作用的才每次问；确认卡文案白话、可一键允许。
- **可撤销**：任何授权可在设置页改回；审计日志可追溯；全局可重置。
- **防锁死**：高危默认不给 `always` 但提供显式提升路径；重置按钮兜底。

---

## 十一、验收标准

1. 唤醒说「帮我把今天 AI 前沿新闻整理成 markdown 放桌面」→ 自动 `web_search`+`save_to_desktop`，首次弹确认卡（仅一次/始终允许/每次询问/拒绝），允许后桌面出现文件，且审计可见。
2. 说「打开网易云音乐」→ `open_app` 启动（需授权）；说「播放/下一首」→ `media_control` 生效。
3. 说「运行 `dir` 命令」→ `run_command` 弹高危确认（红色 + 命令原文）；输入破坏性命令额外二次确认 + 黑名单拦截。
4. 设置页「隐私与权限」：按风险等级**默认折叠**，展开可见每条能力的授权模式、最近使用、次数；高危红色；可随时改某条为每次询问/始终允许/拒绝。
5. 系统能力区正确显示麦克风等 OS 授权状态。
6. 审计日志可见麦克风/相机/命令/打开应用等一切使用记录，支持筛选/导出/清空。
7. 任意时刻按紧急停止（或说"停下"）可中断正在执行的工具链。
8. `npm run settings:check` 全绿，tsc 0 错。
9. 开启「本次会话全部允许」后，中低危操作不再弹确认（高危黑名单二次确认仍保留）；**重启 App 该开关自动失效**（不持久化）。
10. **（后续 P5，本期不实现）** 唤醒后屏幕上方中央"刘海"位出现声纹波浪动画，并实时显示所说内容的转文字字幕。

---

*注：本方案完全基于现有代码调研（唤醒链路、ToolLoopRunner、builtins 工具、设置页模式），不引入与现有架构冲突的新范式，优先复用而非重写。v2 按用户反馈升级授权模型与设置页交互。*
