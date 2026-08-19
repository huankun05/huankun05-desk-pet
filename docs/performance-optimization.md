# 性能优化分析（desk-pet）

> 分析时间：2026-08-19。目标：提升加载/启动速度、降低运行时 CPU/内存占用。
> 结论先行：**本轮已落地 2 项安全优化**（光标轮询门控、cron 精确调度），其余按「影响 × 成本」排序给出建议，标注实施风险，未动的高风险项等确认后再改。

## 一、本轮已落地

| 项               | 位置                            | 收益                                                                                                                                                               |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 主窗光标轮询门控 | `src/hooks/useWindowManager.ts` | 未开启「悬停淡出」时，每 200ms 一次 `invoke('get_cursor_window_info')`（Rust IPC）整体跳过 → 省 5 次/秒系统调用。锁定/变换态的穿透状态由 effect 依赖重设，不受影响 |
| cron 精确调度    | `src/services/cron/manager.ts`  | cron 任务由「每 60s 轮询判断」改为「`nextCronTime()` 算出下次触发点 → `setTimeout` 到点触发 → 自动重排」；无 cron 任务或表达式未来 24h 无匹配时零唤醒              |

## 二、加载/启动速度：瓶颈与建议

| 优先级 | 项                              | 证据                                                                                                                                               | 建议                                                                                                                                                | 风险                                |
| ------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| P0     | **多窗口重复加载同一 bundle**   | Tauri2 每个 webview（main/settings/chat-panel/status-panel/controls）各自执行一次完整 JS；`vite.config.ts` 仅按 HTML 入口拆 main/settings 两个输入 | 为各面板窗口建立独立最小入口 HTML（如 `chat-panel.html` 只挂聊天组件），配合 `manualChunks` 按窗口懒加载；或对非主窗用 `withGlobalTauri` + 轻量入口 | 中（涉及窗口路由/构建改动，需回归） |
| P1     | vosk 语音识别模型加载时机       | 记忆与 `useWakeWord` 中 vosk-browser 已懒加载                                                                                                      | 保持懒加载；可再加「唤醒词开关关闭时完全不初始化」                                                                                                  | 低                                  |
| P1     | Live2D 首屏                     | `useStartupQueue` 已做 P0-P3 启动队列；模型 ArrayBuffer 已缓存                                                                                     | 保持；可考虑按「桌面可见性」延迟非关键窗口创建                                                                                                      | 低                                  |
| P2     | 重依赖进主 bundle               | `highlight.js`、`react-markdown`、`react-router-dom` 等被急切 import                                                                               | 仅聊天窗用到的 `highlight.js`/`react-markdown` 改动态 `import()`                                                                                    | 低-中                               |
| P2     | `vite-plugin-singlefile` 未启用 | devDependencies 有包但 `vite.config.ts` 未用                                                                                                       | 保持不启用（多 HTML 入口场景单文件化会反向膨胀）                                                                                                    | —                                   |

## 三、运行时 CPU / 内存：瓶颈与建议

| 优先级 | 项                                                    | 证据                                                                                                                                                                                                        | 建议                                                                                                                              | 风险                                  |
| ------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| P0     | **`setInterval`/`setTimeout` 数量**                   | `cron/manager.ts`（已改精确调度）、`proactive/scheduler.ts`、`pipeline/scheduler.ts`、`llmScheduler.ts`、`useWatchTogether`、`useVoiceCall`、音频 `player.ts`/`recorder.ts`/`vad-service.ts` 均持轮询定时器 | 用「统一调度器」合并多个低频轮询（如把多个 1min 级定时器合并为单一定时器 + 事件分派）；音频类确认销毁路径 `clearInterval`         | 中                                    |
| P1     | 光标轮询 200ms（开启悬停淡出时）                      | `useWindowManager.ts:483`                                                                                                                                                                                   | 悬停淡出开启时可降频至 300ms，或仅在光标进入窗口邻近区域时启动轮询（可先做「窗口不可见/最小化时不轮询」，`document.hidden` 已有） | 低-中（影响淡出响应手感，需实机验证） |
| P1     | 跨窗 storage 事件同步（Tauri2 多 webview 下可能失效） | `useStorageEvent.ts`、`StatusPanelWindow.tsx:91` 每 2s `getItem('deskpet_emotion')` 轮询                                                                                                                    | 统一迁移到 Tauri 事件（`emit`/`listen`，项目已有成熟范式）；状态面板情绪改用 `emotion:changed` 监听                               | 中（涉及行为，先小窗验证）            |
| P1     | 久坐提醒监听泄漏                                      | `sedentaryReminder.ts`（本轮已修：`onTerminate` 补 `removeEventListener`）                                                                                                                                  | 已修复                                                                                                                            | —                                     |
| P2     | `localStorage` 无限增长                               | 收藏/记忆/配置持续写入                                                                                                                                                                                      | 设置页加「数据清理」引导（已有 DataPage）；收藏可改 SQLite 侧存储                                                                 | 低                                    |
| P2     | 日志/事件队列无上限                                   | `eventBus`、trace 类队列                                                                                                                                                                                    | 为队列设容量上限 + 丢弃策略                                                                                                       | 低                                    |

## 四、bundle / 依赖瘦身（本轮已完成）

- 移除 6 个 `src/` 零引用依赖：`framer-motion`、`@heroui/react`、`@tanstack/react-virtual`、`zustand`、`react-hot-toast`、`@iconify-json/solar`。
- 删除 `vite.config.ts` 中对应的空 `vendor-motion` manualChunk（构建期少一个空 chunk 告警）。
- 双锁文件（`pnpm-lock.yaml` / `package-lock.json`）已同步，安装体积下降。

## 五、建议后续优先做的三项

1. **按窗口拆入口**（加载速度收益最大）：`index.html`/`settings.html` 之外，为 `chat-panel`、`status-panel`、`controls` 建独立轻量入口，砍掉每个面板重复执行的 React 树与重依赖。
2. **统一轮询调度器**（CPU 收益最大）：把 1min 级/低频轮询合并为单一 tick，按事件分派。
3. **跨窗同步迁移 Tauri 事件**（正确性 + 省掉轮询）：以 `useAppStorageSync`/`useStorageEvent` 为试点，替换为 `emit`/`listen` 后逐步铺开。
