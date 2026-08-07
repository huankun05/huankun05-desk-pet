# Desk Pet 插件市场系统设计方案

> 日期: 2026-07-29
> 状态: 已确认
> 注册表仓库: https://github.com/huankun05/desk-pet-registry
> 分支保护: ✅ 已设置（PR审核 + 代码所有者审核）
> CI扫描: ✅ 已配置（audit-plugin.yml）

## 1. 目标

将 Desk Pet 从「功能硬编码」架构转为「插件可扩展」架构：

- 用户可从市场浏览、搜索、一键安装插件和 MCP 预设
- LLM 对话中自动发现并调用可用 MCP 工具（已有闭环）
- 内置功能（如一起刷抖音）可被替换/卸载/从市场更新
- Skills 插件和 MCP 预设统一在一个市场中管理

## 2. 当前实现状态

| 模块 | 状态 | 说明 |
|------|------|------|
| MCP 通信 | ✅ 完整 | Rust 子进程 + stdio JSON-RPC + bridge → ToolRegistry → LLM tool-loop |
| MCP 管理 UI | ✅ 完整 | McpPage CRUD + 连接/断开 + 工具列表展示 |
| Skills/Plugins 框架 | ⚠️ 骨架 | DeskPetPlugin 基类 + PluginRegistry + PluginImporter(zip/json) |
| Skills 内置插件 | ⚠️ 仅提醒类 | 喝水/护眼/久坐/番茄/问候 |
| PluginsPage UI | ⚠️ 基础 | 列表/开关/配置，无市场/安装 |
| 一起刷抖音 | ❌ 硬编码 | useWatchTogether + watchTogether.ts 写死 |
| 插件市场 | ❌ 不存在 | 无远端注册表/市场UI/一键安装 |

## 3. 架构设计

### 3.1 分层架构

```
┌─────────────────────────────────────────┐
│              设置 UI 层                  │
│  PluginMarketPage │ McpPresetsPage      │
├─────────────────────────────────────────┤
│           市场/安装服务层                │
│  MarketplaceService │ PluginInstaller   │
│  RegistryClient     │ StatsClient       │
├─────────────────────────────────────────┤
│          插件运行时层（已有）             │
│  PluginRegistry │ PluginContext         │
│  McpManager     │ McpBridge            │
├─────────────────────────────────────────┤
│          存储/通信层                     │
│  createStorage   │ GitHub API          │
│  localStorage    │ Tauri invoke        │
└─────────────────────────────────────────┘
```

### 3.2 注册表格式

托管在 GitHub 仓库 `desk-pet/registry` 的 `registry.json`：

```jsonc
{
  "version": 1,
  "updated": "2026-07-29T00:00:00Z",
  "plugins": [
    {
      "id": "watch-together",
      "name": "一起看",
      "version": "1.0.0",
      "description": "和宠物一起刷短视频，AI 实时评论",
      "icon": "📺",
      "author": "desk-pet",
      "homepage": "https://github.com/desk-pet/plugin-watch-together",
      "category": "feature",        // feature | behavior | tool | mcp-preset
      "permissions": ["screenshot", "vision-model", "tts"],
      "runtime": "js+mcp",          // js | js+mcp | mcp-only
      "downloadUrl": "https://github.com/desk-pet/plugin-watch-together/releases/download/v1.0.0/plugin.zip",
      "size": 15360,
      "minAppVersion": "0.1.0"
    }
  ],
  "mcpPresets": [
    {
      "id": "mcp-filesystem",
      "name": "文件系统",
      "description": "读写本地文件系统",
      "icon": "📁",
      "category": "mcp-preset",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "{{path}}"],
      "argsTemplate": [
        { "key": "path", "label": "允许访问的目录", "type": "string", "default": "~" }
      ],
      "homepage": "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem"
    },
    {
      "id": "mcp-web-search",
      "name": "网页搜索",
      "description": "Brave Web Search API",
      "icon": "🔍",
      "category": "mcp-preset",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "envRequired": ["BRAVE_API_KEY"],
      "homepage": "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search"
    }
  ]
}
```

### 3.3 统计评分系统

利用 GitHub Issues + Reactions + 独立评分：

- **下载计数**：注册表 JSON 中维护 `downloads` 字段（每次安装后 +1）
- **收藏数**：Issue 的 ❤️ Reaction 数
- **评分（1-5分）**：注册表 JSON 中维护 `rating` 字段（加权平均）
- **评分人数**：注册表 JSON 中维护 `ratingCount` 字段
- **用户反馈**：Issue 评论
- 通过 GitHub API 读取 Issue Reactions 作为收藏/推荐数据

评分更新机制：
1. 用户在市场页面提交评分 → 更新 registry.json 中对应插件的 rating/ratingCount
2. 通过 PR 合并更新（CI 校验评分格式）

### 3.4 插件运行沙箱

| 类型 | 运行环境 | 能力 | 示例 |
|------|----------|------|------|
| `js` | WebView JS 沙箱 | PluginContext API（say/showBubble/scheduleJob/saveData/loadData） | 喝水提醒、护眼提醒 |
| `js+mcp` | JS 沙箱 + 可选 MCP Server | PluginContext API + MCP tool 调用 | 一起刷抖音（JS 调用 MCP 截屏/视觉分析） |
| `mcp-only` | 仅 MCP Server 进程 | 通过 MCP bridge → ToolRegistry → LLM tool-loop | 文件系统、网页搜索 |

权限声明（`permissions` 数组）：
- `screenshot` - 截屏能力
- `vision-model` - 视觉模型调用
- `tts` - 语音合成
- `network` - 网络请求
- `filesystem` - 文件系统访问
- `notification` - 系统通知

安装时展示权限列表，用户审批后才启用。

### 3.5 插件包格式

`.deskpet-plugin.zip` 内容：

```
├── manifest.json        # 插件元信息 + 权限声明
├── main.js              # 插件主入口（JS 沙箱）
├── config.schema.json   # 配置项 schema（可选）
├── mcp-config.json      # 附带的 MCP Server 配置（可选，js+mcp/mcp-only 类型）
├── icon.png             # 插件图标（可选）
└── README.md            # 说明文档（可选）
```

`manifest.json` 示例：

```json
{
  "id": "watch-together",
  "name": "一起看",
  "version": "1.0.0",
  "description": "和宠物一起刷短视频",
  "author": "desk-pet",
  "icon": "📺",
  "category": "feature",
  "permissions": ["screenshot", "vision-model", "tts"],
  "runtime": "js+mcp",
  "minAppVersion": "0.1.0",
  "main": "main.js",
  "configSchema": "config.schema.json",
  "mcpConfig": "mcp-config.json",
  "shortcut": "Ctrl+Shift+S",
  "entryPoint": "WatchTogetherPanel"
}
```

## 4. UI 设计

### 4.1 插件市场页面

路由：`/settings/market`

布局：
- 顶部搜索栏 + 分类标签（全部/功能/行为/工具/MCP预设）
- 瀑布流卡片列表，每张卡片：
  - 图标 + 名称 + 版本 + 作者
  - 简介（一行）
  - 下载量 + 评分（从 GitHub Reactions 读取）
  - 安装/已安装按钮
- 点击卡片 → 详情页（权限列表 + README + 评分 + 反馈）

### 4.2 MCP 预设快捷添加

在现有 McpPage 顶部添加「推荐 MCP 服务器」区块：
- 展示市场中的 mcp-preset 列表
- 一键添加（预填 command + args，用户只需补充 API Key 等必填参数）
- 已添加的显示「已配置」标记

### 4.3 已安装管理

现有 PluginsPage 增强：
- 增加「从市场安装」入口按钮
- 显示插件来源（内置/市场/本地导入）
- 市场插件显示「检查更新」和「卸载」

## 5. 核心模块实现

### 5.1 `services/market/client.ts` — 注册表客户端

```typescript
interface RegistryIndex {
  version: number;
  updated: string;
  plugins: RegistryPlugin[];
  mcpPresets: RegistryMcpPreset[];
}

// 从 GitHub 获取注册表
async function fetchRegistry(): Promise<RegistryIndex>

// 获取统计评分（GitHub Reactions）
async function fetchPluginStats(issueNumber: number): Promise<PluginStats>

// 搜索/过滤
function filterPlugins(registry: RegistryIndex, query: string, category: string): RegistryPlugin[]
```

### 5.2 `services/market/installer.ts` — 插件安装器

```typescript
// 下载并安装插件
async function installPlugin(plugin: RegistryPlugin): Promise<InstallResult>

// 卸载插件
async function uninstallPlugin(pluginId: string): Promise<void>

// 检查更新
async function checkUpdates(): Promise<UpdateInfo[]>

// 更新插件
async function updatePlugin(pluginId: string): Promise<void>
```

安装流程：
1. 下载 .deskpet-plugin.zip 到临时目录
2. 校验 manifest.json 完整性
3. 检查 permissions 是否与已授权一致（新权限需用户审批）
4. 解压到 `data/plugins/{plugin-id}/` 目录
5. 注册到 PluginRegistry
6. 如有 mcp-config.json，添加到 MCP 配置
7. 记录安装来源和版本到 `data/market/installed.json`
8. 发送 👍 Reaction 到对应 GitHub Issue（统计下载量）

### 5.3 `services/market/stats.ts` — 统计评分客户端

```typescript
interface PluginStats {
  downloads: number;    // 👍 Reaction 数
  favorites: number;    // ❤️ Reaction 数
  recommendations: number; // 🎉 Reaction 数
  feedbackCount: number; // 评论数
}

// 读取 GitHub Issue Reactions
async function fetchStats(repo: string, issueNumber: number): Promise<PluginStats>

// 记录安装（+1 👍）
async function recordInstall(repo: string, issueNumber: number): Promise<void>
```

### 5.4 `services/market/storage.ts` — 已安装记录

```typescript
interface InstalledRecord {
  id: string;
  version: string;
  source: 'market' | 'local' | 'builtin';
  installedAt: string;
  registryIssueNumber?: number; // GitHub Issue 编号（用于统计）
}

// 持久化到 data/market/installed.json
```

## 6. 一起刷抖音插件化改造

### 6.1 改造步骤

1. 将 `useWatchTogether.ts` + `watchTogether.ts` 的核心逻辑提取为插件主入口 `main.js`
2. 保留快捷键注册机制，但改为从插件 manifest 读取
3. 截屏+视觉分析通过 MCP tool 调用（已有 `mcp_call_tool`）
4. MultimodalPage 中的配置项改为插件的 config.schema
5. 插件安装后注册快捷键 `Ctrl+Shift+S`，卸载后注销

### 6.2 插件 manifest

```json
{
  "id": "watch-together",
  "name": "一起看",
  "version": "1.0.0",
  "category": "feature",
  "permissions": ["screenshot", "vision-model", "tts"],
  "runtime": "js+mcp",
  "shortcut": "Ctrl+Shift+S",
  "entryPoint": "WatchTogetherPanel"
}
```

## 7. Skills 插件增强

现有 5 个内置提醒插件保持不变，但增加：

1. **Skills 市场标签**：市场 UI 中 `behavior` 分类展示可安装的 Skills
2. **插件导出**：PluginsPage 增加「导出为插件包」按钮，将本地配置/代码打包为 `.deskpet-plugin.zip`
3. **自写插件入口**：设置中增加「创建插件」向导，引导用户编写 `main.js` + `manifest.json`

## 8. 实现优先级

| 阶段 | 内容 | 依赖 |
|------|------|------|
| P1 | 注册表格式定义 + GitHub 仓库初始化 | 无 |
| P2 | `market/client.ts` + `market/storage.ts` | P1 |
| P3 | 插件市场 UI（PluginMarketPage） | P2 |
| P4 | `market/installer.ts` + 安装流程 | P2 |
| P5 | MCP 预设市场（McpPage 集成） | P2, P4 |
| P6 | 统计评分（`market/stats.ts` + UI 集成） | P2 |
| P7 | 一起刷抖音插件化改造 | P4 |
| P8 | Skills 增强（导出/自写向导） | P4 |
| P9 | 已安装管理增强（更新/卸载/来源标记） | P4 |

## 9. 安全考虑

- 所有市场插件必须声明 `permissions`，安装时展示并需用户确认
- JS 沙箱中插件只能通过 `PluginContext` API 访问能力，不能直接访问文件系统/网络
- MCP Server 子进程通过 Rust 侧管理，进程隔离
- 下载的插件包需校验 manifest 完整性和签名（后续可加）
- 注册表 JSON 通过 HTTPS 获取，防篡改

## 10. 已确定的决定

1. **注册表仓库**：`huankun05/desk-pet-registry`（GitHub Public）
2. **分支保护**：强制 PR 审核 + 代码所有者审核（已配置）
3. **CI 扫描**：audit-plugin.yml 自动校验（已配置）
4. **评分系统**：5分制评分 + 下载数 + 收藏数
5. **自动更新**：设置中提供开关，用户可选择是否自动检查更新；同时支持手动检查
6. **插件运行**：混合沙箱（JS + 可选 MCP）
7. **MVP 范围**：插件市场核心 + MCP预设市场 + 一起刷抖音插件化 + 统计评分 + Skills增强

## 11. 开放问题

1. **离线场景**：无网络时市场不可用，已安装插件正常工作
2. **评分实时性**：评分更新通过 PR 合并，非实时
