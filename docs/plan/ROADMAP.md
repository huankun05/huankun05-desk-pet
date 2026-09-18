# 汐月 Marea 路线图（ROADMAP）

**产品**：汐月 · Marea · 四模式 · **AI 引擎**（Hermes）+ **心核**（LifeKernel）+ **壳**（Electron）  
**整理基准日**：2026-09-18  
**Hermes**：官方 `v2026.9.14`  
**UI 规范**：[../design/UI-DESIGN.md](../design/UI-DESIGN.md)

---

## 阶段总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| **R0 仓库整理** | 归档旧仓、官方 Hermes、文档体系 | **完成** |
| **R1 品牌与 UI 规范** | 汐月/Marea、AI 引擎命名、token/控件层、设置分类 | **完成（2026-09-18）** |
| **P0 Hermes Spike** | Windows gateway + health；壳内设置；Client 骨架 | **进行中**：health/设置已通；待模型 + SSE |
| **P1 换脑** | HermesProcMgr + 四模式接 Hermes + ModelRouter | 待动工（下一步） |
| **P2 生命层** | LifeKernel + PolicyGate + Live2D 情绪 | 待动工 |
| **P3 记忆** | LifeMemoryProvider + 注入预算 + 角色卡 v0 | 待动工 |
| **P4 工具审批** | Electron MCP + 审批 UI | 待动工 |
| **P5 反思系统** | 技能/行为进化策略 | 待动工 |
| **P6 语音** | 本地 CosyVoice/GPT-SoVITS + 云端 | 待动工 |
| **P7 分发** | 安装包内置 AI 引擎 | 待动工 |
| **P8 代码清理** | 移除 legacy harness | 待动工 |

---

## P0 剩余验收

- [x] 官方 Hermes 在 Windows 可启动 gateway  
- [x] `API_SERVER_KEY` + `/health`  
- [x] 壳内设置页配置引擎  
- [ ] 配置模型后 `/v1/chat` + `/v1/runs` SSE  
- [ ] Electron 收到流式 token（HermesClient）  
- [ ] 杀进程自动重启（并入 P1）  

---

## 下一步（建议顺序）

1. **P0 收尾**：在「模型服务」填 Key → AI 引擎页同步 → 冒烟 chat/runs  
2. **P1**：`HermesProcMgr`（启动/健康/崩溃重启）+ 设置「启动时拉起」生效  
3. **P1**：`agui-bridge` 四模式接 Hermes；旧 Harness 隔离  
4. **P2**：LifeKernel 最小闭环  

非目标：摄像头、情绪放宽权限、第二套关系记忆、追 Hermes main。  

流程：[../standards/development-process.md](../standards/development-process.md)
