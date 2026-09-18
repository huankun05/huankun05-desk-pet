# desk-pet P0 · Hermes 本地运行时

## 用途

在 Windows 上把官方 Hermes gateway + API server 跑起来，供 Electron `HermesClient` 对接。

## 约定路径

| 项 | 路径 |
|---|---|
| Hermes 源码 | `F:\Work\Create\desk_pet\hermes-agent`（官方 v2026.9.14） |
| HERMES_HOME | `F:\Work\Create\desk_pet\.runtime\hermes-home` |
| API 默认端口 | `8642`（可用 `API_SERVER_PORT` 覆盖） |

## 首次安装（PowerShell）

```powershell
# 在工作区根执行
.\desk-pet\scripts\hermes-p0\setup-hermes.ps1
```

脚本会：创建 `HERMES_HOME`、生成 `.env`（含 `API_SERVER_KEY`）、用 uv 在 `hermes-agent` 建 venv 并安装依赖。

## 启动 gateway

```powershell
.\desk-pet\scripts\hermes-p0\start-gateway.ps1
```

## 冒烟

```powershell
.\desk-pet\scripts\hermes-p0\smoke.ps1
```

检查：`/health` → 可选 `/v1/chat/completions` → 可选 `/v1/runs` SSE。

## 模型

- 仅 health：**不需要**模型密钥  
- 真正对话/run：在 `HERMES_HOME\.env` 或 `config.yaml` 配置 provider（OpenRouter / 小米 MiMo / Ollama 等）  
- 前端变量：`API_SERVER_KEY`、`HERMES_API_BASE_URL`（默认 `http://127.0.0.1:8642`）

## 边界

- **不要改** `hermes-agent` 源码 core  
- 运行数据写在 `.runtime/hermes-home`，与安装目录分离  
