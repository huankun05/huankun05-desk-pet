# UI 品牌与开发检查单

**产品中文名**：汐月  
**产品英文名**：Marea  
**设置页 · 智能核心**：**AI 引擎**（Hermes Agent；文档内部代号「智核」）  
**设置页 · 模型**：**模型服务**（原 API 设置）  
**禁止**：用户可见文案中的 Cyrene / live2d-cyrene / CyreneHarness  

设计体系见 [../design/UI-DESIGN.md](../design/UI-DESIGN.md)。

---

## 1. 分层用语

| 层 | 用户可见 | 代码/文档 |
|---|---|---|
| 产品 | 汐月 / Marea | productName `汐月 Marea` |
| 智能核心 | **AI 引擎** | Hermes Agent（文档可写智核） |
| 生命层 | 心核 | LifeKernel |
| 壳 | 应用 / 设置 | Electron |

设置导航文案：**智核**（副标题可写：Hermes Agent）。

---

## 2. 改名检查单（已开发部分）

### 用户可见（优先）

- [ ] 设置导航「AI 引擎」/「模型服务」等通俗名已落地
- [ ] 设置标题/提示去 Cyrene
- [ ] `src/renderer/settings/i18n/zh-CN.json` / `en-US.json`
- [ ] 各窗口 `document.title` / 窗口标题
- [ ] 托盘菜单、安装器文案
- [ ] README 用户向描述

### 打包与包名（第二波）

- [ ] `package.json` name / description
- [ ] `electron-builder.yml` productName / appId / publish
- [ ] 安装路径与快捷方式名
- [ ] 隐私与关于页

### 代码标识（可延后）

- [ ] `CyreneAgent` / `cyrene-*` 模块名  
  用户可见层未完成前，不强制改文件名，避免大爆炸 diff。

---

## 3. 新代码规则

1. 新 UI 禁止写入 Cyrene。  
2. 提及底层 Agent 时：正文写「智核」，括号或文档写 Hermes。  
3. 角色卡名（如昔涟）只出现在角色相关 UI，不替代产品名。  
4. 遵循 UI-DESIGN.md：token、组件、i18n、单主题。

---

## 4. 验收

- [ ] 设置页全文搜索 `Cyrene` = 0（用户可见字符串）
- [ ] 窗口标题为「汐月 · 设置」等
- [ ] 智核面板标题正确
- [ ] tsc / 相关面板手工打开正常
