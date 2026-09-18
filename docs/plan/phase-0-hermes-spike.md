# P0 Hermes Spike — 状态

**日期**：2026-09-18  
**Hermes**：官方 `v2026.9.14` @ `F:\Work\Create\desk_pet\hermes-agent`  
**HERMES_HOME**：`F:\Work\Create\desk_pet\.runtime\hermes-home`

---

## 验收清单

| 项 | 状态 | 说明 |
|---|---|---|
| Windows 启动 gateway | **通过** | `uv run python cli.py --gateway`；api_server connected |
| `API_SERVER_KEY` + `/health` | **通过** | `200 {"status":"ok","platform":"hermes-agent","version":"0.21.3"}` |
| 端口 | **通过** | `http://127.0.0.1:8642`（日志：API server listening） |
| Electron `/v1/runs` SSE | **未完成** | Client 骨架已写；需模型 provider + UI 接线 |
| 杀进程自动重启 / 会话恢复 | **未完成** | 交给 P1 `HermesProcMgr` |

---

## 关键发现

1. **api_server 需要 `aiohttp`**  
   - 仅 `uv sync --extra mcp` 不够  
   - 必须 `--extra messaging`（含 `aiohttp==3.14.3`）  
   - 症状：`API Server: aiohttp not installed` / `No adapter available for api_server`  
   - 已写入 `scripts/hermes-p0/setup-hermes.ps1`

2. **启动方式（Windows）**  
   ```powershell
   # 环境
   $env:HERMES_HOME = "F:\Work\Create\desk_pet\.runtime\hermes-home"
   # .env 内含 API_SERVER_KEY / API_SERVER_PORT
   cd F:\Work\Create\desk_pet\hermes-agent
   E:\software\Python3.12\Scripts\uv.exe run python cli.py --gateway
   ```

3. **模型**  
   - health **不需要**模型密钥  
   - `/v1/chat/completions`、`/v1/runs` 需要 config.yaml / `.env` 配好 provider  
   - 日志中可见 auxiliary 对 openrouter/nous 的探测失败（无凭据），不影响 health

4. **运行时锁**  
   - `HERMES_HOME` 下 gateway 单实例锁；重复启动会 `runtime lock is already held`  
   - 排查/重启前先停掉旧进程

---

## 脚本与代码

| 路径 | 用途 |
|---|---|
| `scripts/hermes-p0/setup-hermes.ps1` | 建 HOME、.env、uv sync（mcp+messaging） |
| `scripts/hermes-p0/start-gateway.ps1` | 前台启动 |
| `scripts/hermes-p0/start-and-wait-health.ps1` | 后台启动 + 轮询 health |
| `scripts/hermes-p0/smoke.ps1` | health / capabilities |
| `src/main/hermes/hermes-client.ts` | P0 最小客户端（health/chat/runs SSE） |

---

## 壳内设置（已接入）

设置 → **大脑 Hermes**：

- Hermes 源码目录 / HERMES_HOME / uv 路径  
- API host/port / API_SERVER_KEY（可生成）  
- 健康检查  
- Provider / 默认模型  
- 「立即同步模型凭据到 Hermes」：把「API 设置」里的 Key 写入 `HERMES_HOME/.env`，并尽量写 `config.yaml` 的 `model` 段  
- 保存时自动写 `.env`  

实现：`src/main/hermes/hermes-settings*.ts`、`src/renderer/settings/hermes/panel.ts`。

---

## 下一步（P0 收尾 → P1）

1. 在 `.runtime/hermes-home/.env` 或 `config.yaml` 配置一个可用模型（云端）  
2. `SMOKE_CHAT=1` 跑通 chat completions  
3. Node 侧用 `HermesClient.health()` + `runOnce()` 做一次 SSE 冒烟  
4. P1：`HermesProcMgr`（spawn/重启）+ `agui-bridge` 换脑  

配置模型后执行：

```powershell
$env:SMOKE_CHAT=1
.\desk-pet\scripts\hermes-p0\smoke.ps1
```
