# Hermes 集成：进程 · 工具 · 插件边界 · 分发

**状态**：当前方案  
**官方源**：`https://github.com/NousResearch/hermes-agent`  
**锁定版本**：`v2026.9.14`（本地已检出于工作区 `hermes-agent/`）  
**旧 fork**：`archives/hermes-agent-fork-elementh/`（只读，不作基准）

> **实现进度（2026-09-24）**：本文 §1 描述**目标拓扑**，与当前代码有差距。  
> 已落地：`proc-mgr.ts`（spawn / health / 启动拉起，**无崩溃自愈**）、  
> `hermes-client.ts` + `hermes-client-factory.ts`（HTTP + SSE 消费，经 `HERMES_RUN_SMOKE` IPC 暴露给设置页冒烟按钮）、  
> 「本地引擎」设置面板（health / 端点 / 自动拉起 / 凭据同步）。  
> 未落地：LifeKernel、PolicyGate、ModelRouter、McpElectronServer、ReflectionService；  
> 四模式主循环仍走 CyreneHarness（详见 `../plan/ROADMAP.md`）。

---

## 1. 进程拓扑

```text
Electron Main
  ├─ LifeKernel
  ├─ PolicyGate
  ├─ ModelRouter
  ├─ HermesProcMgr     spawn / 健康检查 / 崩溃重启
  ├─ HermesClient      HTTP + SSE
  ├─ McpElectronServer 桌宠工具
  ├─ Channels / TTS / Embedding
  └─ ReflectionService
        │
        │  localhost + API_SERVER_KEY
        ▼
Hermes Gateway (Python)
  ├─ api_server  /v1/chat/completions · /v1/runs · approval · health
  ├─ conversation_loop
  ├─ tools + MCP client
  ├─ MemoryManager + LifeMemoryProvider
  └─ auxiliary_client
```

- **对接协议**：优先使用 Hermes 现成 `gateway/platforms/api_server.py`，不先写 desktop channel  
- 关键端点：`POST /v1/runs`、`GET /v1/runs/{id}/events`（SSE）、`POST /v1/runs/{id}/approval`、`GET /health`  
- 生命周期：Electron 为 supervisor；`HERMES_HOME` 指向应用数据目录  

---

## 2. 模型路由

| 层 | 实现 |
|---|---|
| 主循环 | Electron `ModelRouter` → `/v1/runs` 携带 model/provider |
| 旁路 | Hermes `auxiliary_client` 配置 `auxiliary.*` |
| 默认 | 云端；Chat 因记忆/上下文不默认本地小模型 |

---

## 3. 工具与 MCP

| 来源 | 接入 |
|---|---|
| Hermes 内置 | `enabled_toolsets` |
| Electron 桌宠工具 | MCP server（stdio 或 localhost） |
| 审批 | Hermes guardrails + `/v1/runs/{id}/approval` → Electron UI |
| 安全 | PolicyGate：情绪不可放宽 L2 |

Cyrene 历史 TS 工具：能映射 Hermes 内置的不重复提供；特色能力进 MCP。

---

## 4. 插件边界（不改 core）

**允许**：

- MemoryProvider 插件（LifeMemoryProvider）  
- MCP server/client 配置  
- `HERMES_HOME` 下 skills/config  
- Electron 侧反思、路由、审批 UI  

**避免**：

- 直接 patch `agent/`、`gateway/` 核心逻辑  
- 私有 API 长期依赖  

**若必须改 core**：独立 fork 分支 + 文档记录 diff + 升级窗口合并；默认不做。

官方更新策略：跟 **patch tag**，不追 main；升级前跑集成冒烟。

---

## 5. 分发与安装

| 阶段 | 方案 |
|---|---|
| A（先落地） | 包内安装脚本 / uv + 锁定源码；启动时确保 gateway 可 spawn |
| B（增强） | 评估 PyInstaller/嵌入式 Python sidecar |

- Windows：官方支持原生安装（`install.ps1` 思路）；路径可配置  
- macOS/Linux：install.sh 同等策略  
- 数据与程序分离：`HERMES_HOME` ≠ 安装目录  

---

## 6. 日志与可调试性

- 跨进程结构化 JSON 日志  
- Hermes stderr/stdout 落盘到应用 logs  
- Run id 贯穿 Electron ↔ Hermes  

---

## 7. 验收要点

- [x] Windows 上 gateway 可启动，`/health` 可用（实测 `{"status":"ok","version":"0.21.3"}`）  
- [x] `/v1/runs` SSE 流式 token 可达 Electron（`HermesClient.runOnce/onToken` 已接线并有单测；**尚未接四模式/渲染层**）  
- [ ] 杀进程后可自动重启且会话可恢复（proc-mgr 无 watchdog，属 P1）  
- [ ] 仓库内无未记录的 Hermes core 修改  
