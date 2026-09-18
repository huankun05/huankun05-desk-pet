# 程序数据目录说明

**默认唯一数据根目录**：`%APPDATA%\live2d-cyrene`  
（macOS/Linux：`~/.config/live2d-cyrene` 或系统 `appData/live2d-cyrene`）

已冻结产品名 **Cyrene / live2d-cyrene**；主进程启动时强制 `app.setPath("userData", …)`。

**自定义位置**（可选）：

```powershell
# 启动应用前设置环境变量（绝对路径）
$env:CYRENE_USER_DATA_DIR = "D:\Data\deskpet"
npm run dev
```

未设置时一律用默认 `live2d-cyrene`。

---

## 目录里有什么（按用途）

### 应用配置（JSON，均在数据根下）

| 文件 | 内容 |
|---|---|
| `model-settings.json` | **模型服务**：厂商、Base URL、模型名、API Key（部分加密）、多模态、档案 |
| `model-settings.backup.json` | 模型配置的历史副本 |
| `app-settings.json` | **通用/外观/偏好**等应用设置 |
| `channels-settings.json` | 消息渠道（QQ/微信/飞书等） |
| `agent-permission.json` | 权限等级相关 |
| `timeout-settings.json` | 超时 |
| `token-usage.json` | Token 用量统计 |
| `user-profile.json` | 用户信息 |
| `memory.json` | 记忆相关状态 |
| `worldbook-state.json` | Worldbook 激活状态 |
| `scheduled-tasks.json` | 定时任务 |
| `proactive-state.json` | 主动聊天状态 |
| `relationship-log.json` | 关系/互动日志 |
| `lsp-config.json` | 语言服务器配置 |
| `skills-curator.json` | 技能策展状态 |

### 会话与运行记录

| 路径 | 内容 |
|---|---|
| `cyrene-chats/` | **聊天会话**（对话消息等） |
| `cyrene-runs/` | Agent 运行记录（数百条 run 元数据） |
| `cyrene-tasks/` | 任务相关 |
| `checkpoints/` | 运行中断恢复用的检查点 |

### 技能 / 知识 / 媒体

| 路径 | 内容 |
|---|---|
| `skills/` | 用户技能目录 |
| `skills-curator-backups/` | 技能自动整理前的备份 |
| `rag-data/` | RAG/向量相关数据 |
| `scene-embedding-cache.json` / `sticker-embedding-cache.json` | 向量缓存（体积较大） |
| `cyrene-tts-cache/` | 语音缓存 |
| `screenshots/` | 截图（可能很大） |
| `music/` | 音乐相关 |
| `tessdata/` | OCR 数据 |
| `channels/` | 渠道会话数据 |

### 备份（应用内「备份管理」）

| 路径 | 内容 |
|---|---|
| `backups/` | 备份包根目录 |
| 例：`backups/manual-all-2026-09-05T.../` | 一次完整/分类备份 |

备份范围（代码 `backup-manager.ts`）：

- **settings**：`app-settings.json`
- **skills**：`userData/skills`
- **soul / styles / characters**：来自**安装目录/开发目录**下的 `prompts/`（人设与风格，不在 userData）
- 触发：设置页「备份管理」手动备份；部分操作会 `autoBackup(...)`，并保留若干份自动清理

> 注意：聊天会话 `cyrene-chats/`、模型 Key 等**不在**当前备份项默认清单里；重要数据建议额外整目录拷贝。

### Electron/Chromium 缓存（可删，会重建）

`Cache/`、`Code Cache/`、`GPUCache/`、`Dawn*Cache/`、`Network/`、`Local Storage/`、`Session Storage/` 等——**占空间大**，删除不影响业务配置，但可能清掉部分界面本地状态。

---

## 目录是否规范？可以怎么调？

| 方面 | 现状 | 评价 |
|---|---|---|
| 根目录 | 统一 `live2d-cyrene` | 规范 |
| 配置 vs 业务数据 | 配置 JSON 在根，会话/技能分子目录 | 基本清晰 |
| 缓存与数据混放 | Chromium 缓存与业务数据同级 | 可接受；清理时只动 Cache* |
| 人设 prompts | 在**程序目录** `prompts/`，不在 userData | 换机/重装需注意；备份依赖安装路径 |
| 会话/模型是否备份 | 备份默认不含 chats / model-settings Key | **偏弱**，建议手动整目录备份或以后扩备份项 |
| 自定义路径 | 支持 `CYRENE_USER_DATA_DIR` | 可迁到 D 盘等 |

### 建议的「整目录备份」命令

```powershell
Copy-Item "$env:APPDATA\live2d-cyrene" "$env:APPDATA\live2d-cyrene.bak-$(Get-Date -Format yyyyMMdd)" -Recurse
```

### 废弃目录

`%APPDATA%\marea` 已不再使用；内容已移至工作区 `archives/appdata-marea`（可删）。

---

## 相关代码

- 数据根锁定：`src/main/index.ts`
- 备份：`src/main/backup/backup-manager.ts`、设置页「备份管理」
- 模型配置：`src/main/settings/model-settings.ts` → `userData/model-settings.json`
