# 用户数据目录（已冻结）

**唯一数据目录**：`%APPDATA%\live2d-cyrene`（Windows）  
对应 macOS/Linux：`app.getPath("appData")/live2d-cyrene`

## 依据

- 产品名**不再改名**（昔涟 / Cyrene）
- `package.json` name = `live2d-cyrene`
- `electron-builder` appId = `com.cyrene.live2d`，productName = `Cyrene`
- 主进程 `src/main/index.ts` 启动时强制：

```ts
app.setName("live2d-cyrene");
app.setPath("userData", path.join(app.getPath("appData"), "live2d-cyrene"));
```

开发版与安装版（若重装）读写**同一份**用户数据。

## 废弃目录

| 路径 | 状态 |
|---|---|
| `%APPDATA%\marea` | **废弃**（曾因短暂改包名产生，不再使用） |
| `%APPDATA%\live2d-cyrene` | **唯一有效** |

`marea` 无需迁移：其中有效配置（模型等）在 `live2d-cyrene` 里已有更完整副本。  
确认无用后可手动删除：

```powershell
Remove-Item "$env:APPDATA\marea" -Recurse -Force
```

## 目录内主要内容

模型设置、会话、任务、技能、渠道、备份、RAG、日志等（见应用内设置与 `cyrene-chats` / `skills` 等子目录）。
