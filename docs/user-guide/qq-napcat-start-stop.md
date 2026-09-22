# QQ / NapCat 消息渠道 — 启停说明

## 说明

设置里的 **消息渠道 → QQ（NapCat）** 启动的是 **NapCat + 本机 QQ**，不是 LabCat。  
黑框控制台是 QQ.exe 被注入启动时的输出；已改为 **隐藏窗口静默启动**。

## 数据

会话与配置在 `%APPDATA%\live2d-cyrene`（`channels-settings.json`、`cyrene-chats` 等）。  
**停掉服务不会删数据**；下次再启动仍会连上原配置与历史。

## 当前状态（2026-09-22）

- 已 **停止** NapCat / QQ 进程  
- 已把 `qq.napcatAutoStart = false`（应用启动时**不再**自动拉起）  
- QQ 渠道本身仍可 `enabled`，只是不自动开进程  

## 再次启动

**方式 A（推荐，应用内）**

1. 设置 → 消息渠道 → QQ  
2. 打开「启动应用时自动拉起 NapCat」  
3. 点「保存」（或重启应用）  

**方式 B（手动）**

运行 `F:\Work\Create\desk_pet\NapCatShell\launcher-user.bat`（或 `NapCatWinBootMain.exe`），让 NapCat 注入 QQ。

**方式 C（脚本）** 见 `desk-pet/scripts/hermes-p0/` 旁的 NapCat 说明；目录探测：工作区 `NapCatShell`。

## 静默启动

`src/main/channels/adapters/qq/napcat-process.ts` 使用：

`powershell Start-Process … -WindowStyle Hidden`

若仍有黑框，多半是 QQ 自身控制台子系统；可在 QQ 安装目录用 GUI 启动方式拉起（后续可再收）。
