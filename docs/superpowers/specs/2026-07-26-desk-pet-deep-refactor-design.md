# Desk Pet 深度改造方案

> **创建日期**：2026-07-26
> **状态**：待批准
> **目标**：在保留 Desk Pet 核心架构（Tauri+Rust+React+自研Live2D+Core引擎）的基础上，借鉴 AIRI 项目的 UI 设计和动画系统，对 UI、状态管理、性能进行全面改造。

---

## 一、背景与动机

### 1.1 问题现状

用户初次使用 AIRI 后，感受到明显流畅度和美观度差距。经深度代码分析，差距来源于五个层面：

1. **状态更新粒度**：Desk Pet 的 `emotionState` 12 字段打包在一个对象，改一个字段全对象重渲染；AIRI 用 Vue 细粒度响应式，只更新变化部分。
2. **Live2D 动画系统**：Desk Pet 用简单定时器+lerp；AIRI 用三阶段状态机+弹簧物理+CDF 随机分布。
3. **鼠标追踪性能**：Desk Pet 每帧一次 Tauri IPC 调用（60次/秒）；AIRI 用浏览器原生事件。
4. **多窗口同步**：Desk Pet 用 5 个 localStorage 轮询（150ms-3000ms）；AIRI 用事件驱动。
5. **UI 设计打磨**：Desk Pet 内联样式混乱、emoji 图标；AIRI 有完整设计系统。

### 1.2 方案选择

经对比分析：
- **Desk Pet 底层性能潜力更强**（Tauri+Rust，内存占用 3-5 倍优于 Electron）
- **Desk Pet 有差异化竞争力**（Core 引擎四大系统：Brain/Heart/Soul/Time，AIRI 没有）
- **AIRI 的优势在生态广度和 UI 打磨**，可通过借鉴获得

**最终决策**：在 Desk Pet 基础上深度改造，不切换技术栈。

### 1.3 改造原则

```
保留：Tauri 2.0 + Rust + React 19 + 自研 Cubism Live2D + Core 引擎四大系统 + 洋葱 Pipeline
重做：UI 设计系统 + 主题系统（可切换）
重构：状态管理（Zustand 细粒度）+ Live2D 动画系统（借鉴 AIRI）
增强：管理后台功能 + Provider 适配器 + 插件协议
优化：5 大性能瓶颈全部修复
```

---

## 二、九大改造模块

### 模块 1：主题系统（新增）

**目标**：桌宠和管理后台各自独立主题，用户可切换。

**设计**：
- CSS 变量驱动，所有颜色用 `var(--xxx)`
- 内置 3 套主题预设：
  - **极简灰**（AIRI 风）：neutral 灰底 + 单一 primary 色
  - **樱花粉**（现有管理后台）：#FF7FAC 主色 + 玻璃拟态
  - **自定义**：用户选主色色相，HSL 自动生成色阶
- 亮/暗双模式，跟随系统或手动切换
- 动态色相旋转（借鉴 AIRI 的 `@property --chromatic-hue`）
- 桌宠主窗口和管理后台各自存主题偏好（localStorage 独立 key）

**文件**：
- 新增 `src/theme/ThemeProvider.tsx` — 主题 Context + 切换逻辑
- 新增 `src/theme/themes.ts` — 主题预设定义
- 修改 `src/index.css` / `src/admin/index.css` — 全部改用 CSS 变量

---

### 模块 2：状态管理重构（性能 P0）

**目标**：解决 App.tsx 1641 行 + 18 个 useState + emotionState 粗粒度问题。

**设计**：
- 引入 **Zustand** 替代顶层 useState（轻量，不需要 Provider）
- emotionState 拆分为 12 个独立 store slice：
  ```
  useEmotionStore (mood + emotion + intensity)
  useFavorabilityStore (favorability 独立)
  usePersonalityStore (HEXACO 人格)
  useEmotionConfigStore (配置)
  ...
  ```
- 组件用 selector 订阅，只重渲染订阅的字段
- 流式消息缓冲层（借鉴 AIRI）：
  ```
  useChatStreamStore {
    streamingMessage: { content, slices, tool_results }
    appendStreamLiteral(text)
    finalizeStream()
  }
  ```
- App.tsx 拆分为 5-6 个职责组件（PetContainer / ToolbarContainer / ChatContainer / BubbleContainer / PanelManager）

**预期**：减少 60%+ 不必要重渲染，流式输出更流畅。

---

### 模块 3：Live2D 动画系统重写（性能 P1）

**目标**：从简单定时器升级到 AIRI 级别的精致动画。

**设计**（全部借鉴 AIRI，但用 TS+React 实现）：

| 动画 | 当前 | 改造后 |
|------|------|--------|
| **眨眼** | 简单定时器切换表情 | 三阶段状态机（idle→closing→opening）+ easeOutQuad/easeInQuad 缓动 + 随机间隔 CDF 分布 |
| **眼球追踪** | 简单 lerp 跟随鼠标 | 眼跳(Saccade)系统 + CDF 自然随机间隔 + 空闲/追踪双模式 + 范围限制 |
| **表情** | setExpression 覆盖 | 三种混合模式（Add/Multiply/Overwrite）+ Noop 脏检查 + 活跃帧对比 |
| **节拍同步** | 无 | 弹簧物理（stiffness/damping/mass + Semi-implicit Euler 积分） |
| **口型** | 振幅直接设值 | smoothstep 释放曲线 + 攻击/释放分离 |

**渲染优化**：
- 页面不可见时 `document.visibilitychange` 触发降帧（60→15fps）或暂停
- 矩阵对象复用（避免每帧 `new CubismMatrix44()`）

**文件**：
- 重写 `src/lib/live2d/animation/` 目录（新增 blink.ts / saccade.ts / expression-blend.ts / spring-physics.ts）
- 重写 `src/hooks/useLive2D.ts`（拆分为 useBlink / useSaccade / useExpression / useLipSync）

---

### 模块 4：桌宠主窗口 UI 重做

**目标**：借鉴 AIRI 的 controls-island 浮岛设计，替换现有简单工具栏。

**设计**：
- **iOS 抽屉式工具栏**（借鉴 AIRI）：
  - 固定右下角，主按钮 + 展开面板
  - 展开动画：`cubic-bezier(0.32, 0.72, 0, 1)` + `translate-y-8 scale-90 blur-sm` 组合
  - 鼠标离开 1.5s 自动折叠（debounce）
  - 9 宫格按钮：设置/角色/聊天/刷新/居中/主题/置顶/锁定/退出
- **Solar 图标系**替代 emoji（用 `@iconify-json/solar`）
- **8 方向窗口调整句柄**（借鉴 AIRI 的 ResizeHandler）
- **像素级透明检测**优化鼠标穿透（借鉴 AIRI 的 `useCanvasPixelIsTransparentAtPoint`）
- **头顶气泡**保留但样式优化（主题适配）

**文件**：
- 重写 `src/components/Pet/ControlsIsland.tsx`（新文件）
- 修改 `src/App.tsx` 工具栏部分
- 修改 `src/App.css`（或迁移到 Tailwind）

---

### 模块 5：聊天界面 UI 重做

**目标**：借鉴 AIRI 聊天设计，提升消息展示和输入体验。

**设计**：
- **消息变体**：桌面/移动双布局（为未来移动端预留）
  - 用户消息：右对齐，`bg-neutral-100/80`
  - AI 消息：左对齐，`bg-primary-50/80`
- **工具调用块**（新增）：展示 MCP 工具调用的输入/输出/状态
- **输入框增强**：
  - 自动伸缩（`min-h-1lh max-h-10lh`）
  - 多发送模式（Enter / Ctrl+Enter / 双击 Enter）
  - 附件预览区
- **消息操作菜单**：hover 显示复制/删除/重试按钮
- **v-motion 阶梯动画**：消息列表逐条渐入（`delay: index * 50ms`）
- **会话抽屉**：侧滑式会话列表（借鉴 AIRI 的 ChatSessionsDrawer）

**文件**：
- 重写 `src/components/Chat/ChatWindow.tsx`
- 新增 `src/components/Chat/MessageItem.tsx`（拆分用户/AI 消息组件）
- 新增 `src/components/Chat/ToolCallBlock.tsx`
- 新增 `src/components/Chat/SessionsDrawer.tsx`

---

### 模块 6：设置/状态面板 UI 重做

**目标**：极简风布局，主题切换入口。

**设计**（借鉴 AIRI settings 布局）：
- **页面结构**：顶部 TitleBar + PageHeader（sticky，副标题浮在主标题上方）+ 内容区
- **Section 折叠组件**：可折叠的设置分组（Collapsible + 垂直过渡动画）
- **iOS 风格 Toggle**：`peer-checked` + `translate-x-full` 滑动开关
- **主题切换入口**：设置页顶部，主色选择器 + 亮/暗切换
- **状态面板**：保留情绪色条、好感度进度条，但改用主题变量

**文件**：
- 重写 `src/components/Settings/SettingsPanel.tsx`
- 重写 `src/components/Status/StatusPanel.tsx`
- 新增 `src/components/ui/Collapsible.tsx` / `Toggle.tsx` / `PageHeader.tsx`

---

### 模块 7：管理后台重构（4 痛点全解决）

**目标**：功能补齐 + 交互优化 + 信息清晰 + 性能提升。

#### 7.1 功能缺失补齐
- **感知配置页**增强：摄像头选择、手势映射可视化、校准工具
- **MCP 调试页**增强：工具列表、调用测试、日志查看
- **知识库管理**：RAG 文档上传、分块预览、检索测试
- **Provider 配置**：支持更多类型（借鉴 AIRI 的 40+ 适配器模式）
- **插件市场**：插件启用/禁用/配置一站式

#### 7.2 交互体验优化
- 表单填写引导（步骤式配置向导）
- 按钮反馈增强（loading 态、成功/失败 toast）
- 操作确认弹窗（危险操作二次确认）
- 快捷键支持（保存 Ctrl+S、搜索 Ctrl+K）

#### 7.3 信息展示清晰化
- Dashboard 数据可视化增强（图表、趋势线）
- 状态徽章统一规范（success/warning/danger/accent）
- 空状态设计（EmptyState 组件优化）
- 实时数据更新（WebSocket 替代轮询）

#### 7.4 性能问题修复
- KeepAlive 优化（限制缓存页面数量，LRU 淘汰）
- 路由级懒加载（已有，扩展到所有页面）
- 长列表虚拟滚动（@tanstack/react-virtual）
- 图片/资源懒加载

**文件**：
- 重构 `src/admin/pages/` 下所有页面
- 新增 `src/admin/components/VirtualList.tsx`
- 增强现有基础组件

---

### 模块 8：性能优化清单（UI 和性能一起做）

| 优先级 | 优化项 | 文件 | 预期收益 |
|--------|--------|------|---------|
| **P0** | 鼠标追踪 IPC 降频（60→15fps） | `src/hooks/useLive2D.ts` | CPU 占用显著降 |
| **P0** | emotionState 拆分（Zustand） | `src/hooks/useEmotion.ts` | 减少 60% 重渲染 |
| **P0** | storage 事件替代 5 个轮询 | `src/App.tsx` | 减少唤醒和状态更新 |
| **P1** | Live2D 动画系统重写 | `src/lib/live2d/` | 流畅度大幅提升 |
| **P1** | 页面不可见降帧 | `useLive2D.ts` | 后台节省资源 |
| **P1** | 消息流式更新优化（缓冲层） | `App.tsx` + 新 store | 流式输出更顺 |
| **P2** | App.tsx 拆分（1641→多组件） | `App.tsx` | 可维护性 + 性能 |
| **P2** | 矩阵对象复用 | `src/lib/live2d/` | 减少 GC 压力 |
| **P2** | 虚拟滚动（长列表） | `ChatWindow` + 管理后台 | 大数据量流畅 |

---

### 模块 9：UI 设计系统建立

**目标**：统一设计 token，告别内联样式混乱。

**设计**：
- **颜色 token**：`--bg-base / --bg-surface / --bg-glass / --text-primary / --text-secondary / --accent / --border`
- **字体 token**：`--font-sans (Inter + Noto Sans SC) / --font-mono (JetBrains Mono)`
- **间距 token**：`--space-1 (4px) ~ --space-8 (32px)`
- **圆角 token**：`--radius-sm (8px) / --radius-md (12px) / --radius-lg (16px) / --radius-full`
- **动画曲线 token**：`--ease-ios (cubic-bezier(0.32, 0.72, 0, 1)) / --ease-out-quad / --duration-fast (150ms) / --duration-normal (250ms)`
- **基础组件库**：Button / Card / Toggle / Collapsible / Tooltip / Modal / Toast（统一封装）

**文件**：
- 新增 `src/ui/tokens.css`（设计 token 定义）
- 新增 `src/ui/components/`（基础组件库）
- 迁移所有内联样式到 Tailwind class + CSS 变量

---

## 三、实施阶段和顺序

| 阶段 | 内容 | 预期 | 依赖 |
|------|------|------|------|
| **阶段 1：基础设施** | 模块 9（设计系统）+ 模块 1（主题系统）+ 模块 2（状态管理）+ 模块 8 P0 性能优化 | 地基打好，后续改造顺畅 | 无 |
| **阶段 2：Live2D 动画** | 模块 3（动画系统重写）+ 模块 8 P1 性能优化 | 桌宠动起来流畅自然 | 阶段 1 |
| **阶段 3：核心 UI** | 模块 4（主窗口）+ 模块 5（聊天）+ 模块 6（设置/状态） | 用户可见的 UI 全部焕然一新 | 阶段 1 |
| **阶段 4：管理后台** | 模块 7（4 痛点全解决）+ 模块 8 P2 性能优化 | 后台功能完善、体验好 | 阶段 1 |

**阶段 2 和 3 可并行**（动画和 UI 互不依赖）。

---

## 四、技术选型确认

| 技术 | 用途 | 引入方式 |
|------|------|---------|
| **Zustand** | 状态管理 | `pnpm add zustand` |
| **@iconify/react** + **@iconify-json/solar** | 图标系 | `pnpm add @iconify/react @iconify-json/solar` |
| **@tanstack/react-virtual** | 虚拟滚动 | `pnpm add @tanstack/react-virtual` |
| **framer-motion**（已有） | 动画 | 无需新增 |
| **Tailwind CSS v4**（已有） | 样式 | 无需新增 |

---

## 五、保留的核心资产（不改动）

以下内容是 Desk Pet 的差异化竞争力，改造中**不改动**：

1. **Tauri 2.0 + Rust 后端** — 性能优势，窗口管理、托盘、全局快捷键、Win32 API
2. **Core 引擎四大系统**（Python 后端）：
   - Brain（记忆 + Ebbinghaus 遗忘曲线 + Librarian 检索）
   - Heart（PAD 三维情感 + 激素系统）
   - Soul（HEXACO 人格 + 人格漂移）
   - Time（昼夜节律 + 重逢机制 + 周年纪念）
3. **自研 Cubism SDK v5 移植** — 零框架依赖（但动画系统重写）
4. **洋葱模型 10 Stage Pipeline** — Memory/Context/ContentSafety/LLM/EmotionFinalize/ThinkParse/TTS/PersonalityInject/BehaviorDecorate/IdleDetect
5. **感知服务** — MediaPipe 手势/面部识别独立 WebSocket 模块
6. **Provider 抽象层** — Chat/TTS/STT 三类 Provider（扩展但不重写）
7. **MCP 工具集成** — JSON-RPC over stdio
8. **插件系统** — 5 个内置插件（番茄/问候/喝水/久坐/护眼）
9. **国际化** — i18next（zh-CN + en-US）
10. **工程化** — ESLint + Prettier + Husky + Vitest + Playwright + CI

---

## 六、风险与应对

| 风险 | 应对 |
|------|------|
| 改造期间功能不可用 | 分阶段提交，每阶段结束有可用版本 |
| Live2D 动画重写难度高 | 先实现眨眼+眼跳两个核心，节拍同步可选 |
| Zustand 迁移遗漏 | 用 ESLint 规则禁止 App.tsx 新增 useState |
| 主题系统兼容性 | 保留现有内联样式作为 fallback，渐进迁移 |
| 管理后台重构工作量大 | 优先解决 4 痛点，功能补齐分批进行 |

---

## 七、验收标准

每个阶段完成后的验收标准：

### 阶段 1 验收
- [ ] Zustand store 建立，emotionState 拆分完成
- [ ] 主题系统可用，至少 3 套预设可切换
- [ ] 设计 token 定义完成，基础组件库可用
- [ ] 鼠标 IPC 降频到 15fps，CPU 占用下降
- [ ] storage 事件替代轮询，无定时器残留

### 阶段 2 验收
- [ ] 眨眼动画三阶段状态机工作正常
- [ ] 眼跳系统自然随机
- [ ] 表情混合模式（Add/Multiply/Overwrite）可用
- [ ] 页面不可见时降帧生效
- [ ] 主观感受：桌宠"活"起来，眼神自然

### 阶段 3 验收
- [ ] 工具栏改为 iOS 抽屉式，自动折叠
- [ ] 聊天界面消息变体、工具调用块、输入框增强
- [ ] 设置/状态面板极简风，主题切换入口可用
- [ ] 所有 emoji 图标替换为 Solar 图标
- [ ] 主观感受：UI 像 AIRI 一样精致

### 阶段 4 验收
- [ ] 管理后台 4 痛点全部解决（功能/交互/展示/性能）
- [ ] 虚拟滚动在长列表生效
- [ ] KeepAlive LRU 淘汰工作正常
- [ ] 主观感受：后台功能完善、操作顺手
