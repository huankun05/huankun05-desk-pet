# 性能优化分析（desk-pet）

> 分析时间：2026-08-19。目标：提升加载/启动速度、降低运行时 CPU/内存占用。
> 结论先行：**已落地 5 项优化**（代码分割、光标轮询门控、cron 精确调度、跨窗事件同步、依赖瘦身），其余按「影响 × 成本」排序列入后续计划。

## 一、本轮已落地

| 项                               | 位置                                                                           | 收益                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **按窗口代码分割（React.lazy）** | `src/App.tsx`                                                                  | 4 个窗口组件（MainPetApp / ChatPanelWindow / StatusPanelWindow / ControlsOrb）由静态 import 改为 `lazy()`，Vite 自动拆独立 chunk。**实测构建产物**：主 bundle 由单文件 `main 736.94 kB` 拆为 `MainPetApp 301.75 kB` + `ChatPanelWindow 389.23 kB` + `StatusPanelWindow 15.15 kB` 等——每个 webview 只下载/解析自己窗口需要的代码（Live2D、vosk 等重型依赖不再进面板窗） |
| **跨窗同步迁 Tauri 事件**        | `src/services/emotionSync.ts`（新）、`MainPetApp.tsx`、`StatusPanelWindow.tsx` | 状态面板情绪同步由 **2s 轮询**改为监听 `deskpet:emotion-changed` Tauri 事件（主窗实时推送）+ **30s 低频兜底**（防事件失效）；同步更及时、省掉常驻 2s interval。同步逻辑（默认值/字段合并）抽为 `normalizeEmotionState` 复用                                                                                                                                            |
| 主窗光标轮询门控                 | `src/hooks/useWindowManager.ts`                                                | 未开启「悬停淡出」时，每 200ms 一次 `invoke('get_cursor_window_info')`（Rust IPC）整体跳过 → 省 5 次/秒系统调用                                                                                                                                                                                                                                                        |
| cron 精确调度                    | `src/services/cron/manager.ts`                                                 | cron 任务由「每 60s 轮询判断」改为「`nextCronTime()` 算出下次触发点 → `setTimeout` 到点触发 → 自动重排」；无 cron 任务或表达式未来 24h 无匹配时零唤醒                                                                                                                                                                                                                  |
| 依赖瘦身                         | `package.json` / `vite.config.ts`                                              | 移除 6 个零引用依赖（framer-motion / @heroui/react / @tanstack/react-virtual / zustand / react-hot-toast / @iconify-json/solar）与空 `vendor-motion` chunk，双锁文件同步                                                                                                                                                                                               |

## 二、加载/启动速度：瓶颈与建议

| 优先级 | 项                               | 证据                                                               | 建议                                                                                                                     | 状态        |
| ------ | -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ----------- |
| P0     | **vosk 语音识别模型 chunk 巨大** | 构建产物 `vosk-*.js` **5,786 kB（gzip 2,346 kB）**，全项目最大单项 | 已是独立懒加载 chunk（仅唤醒词启用时拉取），仍建议：①唤醒词关闭时完全不 import；②评估换更小的语音识别方案或远端 STT 兜底 | 🔲 后续计划 |
| P0     | **tauriEnv 共享 chunk 417 kB**   | 构建产物 `tauriEnv-*.js` 417 kB（gzip 136 kB）                     | 该 chunk 名来自入口模块但体积异常，检查是否混入了大依赖；考虑拆小                                                        | 🔲 后续计划 |
| P1     | 多窗口重复加载公共代码           | 各窗口共享 vendor-settings（159 kB）/ tauriEnv（417 kB）等         | 已通过代码分割大幅缓解；若仍想极致，可做独立 HTML 入口                                                                   | 🔲 视需求   |
| P1     | vosk 加载时机                    | 记忆与 `useWakeWord` 中 vosk-browser 已懒加载                      | 保持懒加载；「唤醒词开关关闭时完全不初始化」                                                                             | 🔲 后续计划 |
| P2     | 重依赖进主 bundle                | `highlight.js`、`react-markdown` 被急切 import                     | 仅聊天窗用到的 `highlight.js`/`react-markdown` 改动态 `import()`                                                         | 🔲 后续计划 |
| P2     | `vite-plugin-singlefile` 未启用  | devDependencies 有包但 `vite.config.ts` 未用                       | 保持不启用（多 HTML 入口场景单文件化会反向膨胀）                                                                         | —           |

## 三、运行时 CPU / 内存：瓶颈与建议

| 优先级 | 项                               | 证据                                                                                                                                                                     | 建议                                                                                              | 状态                                    |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------- |
| P0     | **统一轮询调度器**               | `proactive/scheduler.ts`、`pipeline/scheduler.ts`、`llmScheduler.ts`、音频 `player.ts`/`recorder.ts`/`vad-service.ts`、`useWatchTogether`、`useVoiceCall` 各持独立定时器 | 用「统一 ticker」合并多个低频轮询（单一 interval + 事件分派）；音频类确认销毁路径 `clearInterval` | 🔲 后续计划（涉及面广，需逐模块回归）   |
| P1     | 光标轮询 200ms（开启悬停淡出时） | `useWindowManager.ts`                                                                                                                                                    | 悬停淡出开启时降频至 300ms；窗口不可见/最小化时不轮询（`document.hidden` 已有）                   | 🔲 后续计划（影响淡出手感，需实机验证） |
| P1     | 跨窗 storage 事件同步            | `useStorageEvent.ts` 等                                                                                                                                                  | 状态面板已迁 Tauri 事件；其余 `storage` 同步可逐步迁移                                            | ✅ 已试点，🔲 其余待铺开                |
| P2     | `localStorage` 无限增长          | 收藏/记忆/配置持续写入                                                                                                                                                   | 设置页加「数据清理」引导（已有 DataPage）；收藏可改 SQLite 侧存储                                 | 🔲 后续计划                             |
| P2     | 日志/事件队列无上限              | `eventBus`、trace 类队列                                                                                                                                                 | 为队列设容量上限 + 丢弃策略                                                                       | 🔲 后续计划                             |

## 四、bundle / 依赖瘦身（已完成）

- 移除 6 个 `src/` 零引用依赖：`framer-motion`、`@heroui/react`、`@tanstack/react-virtual`、`zustand`、`react-hot-toast`、`@iconify-json/solar`。
- 删除 `vite.config.ts` 中对应的空 `vendor-motion` manualChunk。
- 双锁文件（`pnpm-lock.yaml` / `package-lock.json`）已同步，安装体积下降。

## 五、后续优化计划（按优先级）

1. **[P0] vosk chunk 瘦身（5.78 MB）**：唤醒词关闭时不初始化；评估轻量方案或远端 STT 兜底。
2. **[P0] 统一轮询调度器**：合并多个低频轮询为单一 tick，按事件分派，降低空闲 CPU。
3. **[P0] tauriEnv 共享 chunk 417 kB 排查**：确认是否有大依赖误入共享 chunk。
4. **[P1] 光标轮询降频**：悬停淡出开启时 200ms→300ms；不可见时不轮询。
5. **[P1] 跨窗同步全面迁 Tauri 事件**：以 `useStorageEvent` 为试点逐步替换其余 `storage` 同步。
6. **[P2] 聊天窗重依赖动态 import**：`highlight.js`/`react-markdown` 改按需加载。
7. **[P2] 队列上限与 localStorage 治理**：eventBus/trace 队列设上限，收藏迁移存储。
