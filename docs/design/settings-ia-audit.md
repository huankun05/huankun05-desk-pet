
> **名称冻结（2026-09-18）**：产品 UI/打包统一为 **昔涟 / Cyrene**；**不再改名**。设置功能名保持原样（API 设置、TTS 设置等）；Hermes 在设置中称 **本地引擎**，路径自动探测，无需手填。
# 设置信息架构盘点（2026-09-18）

**结论**：品牌改名**暂停**（UI 统一为「昔涟」/ Cyrene 打包名）；设置 **导航与面板一一对应**；**模型服务** 与 **AI 引擎** 去重。

---

## 1. 命名策略（暂停改名）

| 项 | 现状 |
|---|---|
| 产品 UI / 打包 | **昔涟 / Cyrene**（与改名前一致，避免半改不统一） |
| 设置功能名 | 保留通俗名：模型服务、AI 引擎、语音合成…（功能名，非品牌） |
| 正式产品名 | **暂缓**，待一次性全量切换（包名、i18n、文档、安装器） |

---

## 2. 设置导航 ↔ 面板（无遗漏、无孤儿）

| 分组 | 导航 | 面板 data-panel |
|---|---|---|
| 模型与智能 | 模型服务 | api |
| | AI 引擎 | hermes |
| | 高级设置 | api-advanced |
| | Token 用量 | tokens |
| 角色与体验 | 角色与风格 | character-style |
| | 角色专页 | cyrene |
| | 记忆 | memory |
| | 外观设置 | appearance |
| | 偏好设置 | preferences |
| 语音 | 语音合成 | tts |
| | 音乐 | music |
| | 语音识别 | asr |
| 连接与工具 | 消息渠道 | channels |
| | 工具配置 | plugins |
| | 技能管理 | skills |
| | 代码辅助 | lsp |
| 数据与任务 | 备份管理 | backup |
| | 定时任务 | tasks |
| 其他 | 通用设置 | general |
| | 用户信息 | user |
| | 免责声明 | disclaimer |

审计脚本：`scripts/diagnostics/audit-settings-ia.js`（panel-no-nav / nav-no-panel 均为空）。

---

## 3. 去重：模型服务 vs AI 引擎

| 职责 | 模型服务（api） | AI 引擎（hermes） |
|---|---|---|
| 厂商 / API Key / Base URL / 模型名 | **唯一配置处** | 不配置 |
| 上下文窗口、多模态、档案 | 有 | 无 |
| 测试连接 | 有 | 无 |
| Hermes 路径 / HERMES_HOME / uv | 无 | 有 |
| 本地端口 / 访问密钥 | 无 | 有 |
| 健康检查 | 无 | 有 |
| 启动拉起引擎 | 无 | 开关（P1 生效） |
| 模型凭据 | 保存 | **一键从模型服务同步**（不重复填） |

---

## 4. 分区样式（统一带小标题）

- 所有面板使用 `panel-heading` 或 `settings-section__title`
- `settings/styles/controls.css` 统一：小节标题前有品牌色短竖线
- 导航分组标签 `settings-nav__group-label` + 分隔线并存（分组可读）

---

## 5. 热更新（Hot Reload）现状

| 层 | 开发模式 | 生产 |
|---|---|---|
| 渲染层（设置页 UI/CSS/TS） | **Vite HMR**（默认端口 5174，`strictPort: false`） | 需重新构建打包 |
| 设置 HTML/CSS | 改文件后浏览器/设置窗一般会热更新或刷新即生效 | 否 |
| 主进程（IPC、hermes-settings 等） | **无 HMR**，需 `npm run build:main` 并重启 Electron | 打进安装包 |
| preload | 同主进程，需重启 | 否 |
| Hermes gateway 进程 | 不随前端热更新；改 `.env` 后需重启 gateway | 同 |

**实用结论**：改设置页文案/样式 → 保存后多数即时可见；改主进程逻辑 → **必须重启应用**（或按 `npm run dev` 的 build:main+electron 链路）。当前**不支持**主进程完整热替换。

---

## 6. 相关修改（本轮）

- 恢复 nav：角色专页、音乐（消除孤儿面板）
- AI 引擎面板：去重复模型字段，改「从模型服务同步」
- 打包/标题：暂停 Marea，回到 Cyrene/昔涟
- controls.css：统一分区标题样式

