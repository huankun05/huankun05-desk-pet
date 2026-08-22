# Known Warnings & Follow-up Roadmap

Tracks non-code-blocking issues and the remaining phases of the voice-assistant
permission system. Updated as items are triaged.

## 1. Recently fixed

- **stderr UTF-8 crash**: `service.rs` — replaced `reader.lines()` (strict UTF-8)
  with `read_until(b'\n')` + a `decode_stderr` helper (UTF-8 first, GBK via
  `encoding_rs` fallback, lossy UTF-8 last). Python services on Chinese Windows
  emit GBK stderr bytes; the old path threw `stream did not contain valid UTF-8`
  and closed the pipe. Now captured cleanly.
- **Chinese mojibake in logs**: same `decode_stderr` change now recovers Chinese
  text instead of `from_utf8_lossy` mangling GBK bytes.
- **10 dead_code warnings**: 9 functions marked `#[allow(dead_code)]`;
  `get_logs`/`logs` wired into the new `get_service_logs` Tauri command.
- **7 compile errors in `local_tools.rs`**: `IAudioEndpointVolume` path
  (`Win32::Media::Audio::Endpoints` + Cargo feature), missing `write_clipboard`,
  `SendInput`/`LockWorkStation`/`LoadXml` signatures.
- **智能模式（auto）人设/历史随意图自适应** (commit `646c924`, 未推送):
  原 `_classify_intent` 只挑工具、人设/历史永远回落聊天档。现升级为结构化
  返回 `{intent, tools, confidence, source}`（规则快路径纯聊天→chat / 强工作词→work
  + LLM 分类判 intent + 降级 chat/work 人设），`_handle_chat` 用 `intent` 选
  `MODE_CONFIGS` 人设与历史长度，tools 仍按消息精挑；chat/work 显式档保留为兜底。
  前端 `ChatModesPage` 文案同步。详见 `CHANGELOG.md` [Unreleased]。

## 2. Known warnings (non-blocking)

| #   | Source               | Warning                                                                              | Impact                                                | Suggested fix                                                           | Priority |
| --- | -------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------- | -------- |
| 1   | pnpm                 | `global bin directory not in PATH` (from `pnpm add -g pnpm`)                         | None — `pnpm tauri dev` still works (v11.17.0)        | Run `pnpm setup` to add bin to PATH, or ignore                          | Low      |
| 2   | hermes-gateway       | SQLite 3.49.1 WAL-reset corruption bug; auto switches to `journal_mode=DELETE`       | None (auto-mitigated)                                 | `hermes update` to upgrade embedded SQLite >= 3.51.3, or pin SQLite     | Low      |
| 3   | torch / transformers | `FutureWarning` (weight_norm, `torch.cuda.amp.autocast`), `UserWarning` (flash-attn) | Log noise only                                        | Add `warnings.filterwarnings` suppression in server entry, or bump deps | Low      |
| 4   | PowerShell console   | Chinese shown as mojibake in attached console                                        | Display only — app-internal logs now decode correctly | `chcp 65001` / use Windows Terminal (UTF-8)                             | Low      |

> Note on #4: the Rust side already decodes GBK correctly. Any remaining console
> mojibake is the _terminal_ code page (GBK) rendering UTF-8 text, not a code bug.

## 1b. ESLint frontend warnings (2026-08-19) — ✅ 已全部清零

The frontend is TypeScript-strict + ESLint. 92 warnings were found; after cleanup
74 remained and were **fully resolved on 2026-08-19** (`npm run lint` = 0 warning /
0 error, commit `0342ad7`). Breakdown of what was fixed:

| #   | Warning pattern                        | Count | Resolution                                                                             |
| --- | -------------------------------------- | ----- | -------------------------------------------------------------------------------------- |
| 1   | `no-explicit-any`                      | 25    | Replaced with typed interfaces / `as unknown as` / `Record<string, X>`                 |
| 2   | `react-hooks/set-state-in-effect`      | 19    | Wrapped in async-IIFE / lazy init                                                      |
| 3   | `react-refresh/only-export-components` | 12    | Extracted `favorites.ts` / `interactionConfig.ts`; targeted disables for coupled hooks |
| 4   | `exhaustive-deps`                      | 4     | Added missing deps                                                                     |
| 5/6 | `no-unused-vars`                       | 14    | Removed dead imports / variables                                                       |

## 3. Follow-up roadmap — permission system

- **P3**: TTS consent speech / voice response / emergency-stop / first-run wizard.
- **P4**: high-risk + PIN / undo preview / smart escalation / rate-limit.
- **P5**: wake sound-wave layer + live STT subtitles.

## 3b. Follow-up roadmap — 语音助手收尾（#19 后，2026-08-22 新增）

> 全部本地提交（最新 `7d86716`），未推送。供逐项测试对照完成度。

- **#19 已完成（待实测）**: 唤醒词近似音/灵敏度三档/回应个性化（`99644ae`）、唤醒表情动作+刘海字幕声波层（`75008c4`，视觉待实测微调）、Kill Switch Ctrl+Shift+X + 快捷键提示（`7d86716`）。`tool:abort` 事件已 emit，待 #33 接入工具循环。
- **#20**: 主动消息 TTS 开关（主动消息是否朗读）—— ✅ 已落地（默认关，BehaviorConfig.proactiveTts，待实测）。
- **#21**: 预制台词管理（用户可编辑/新增互动台词）。✅ 已实现（`models/InteractionPage.tsx`，端到端生效）。
- **#22**: 一起看插件（自动截屏 + 视觉分析 + 角色反应）。✅ 已实现（`useWatchTogether` + `services/scenes/watchTogether.ts`；`Ctrl+Shift+S` 触发，设置页可配间隔/提示词/视觉检测）。
- **#23**: 大脑合并后失效功能回归探查（最后做）。⏸ **已搁置，后续再做**。
- **#33**: 子 Agent + 任务队列（`tool:abort` 接入工具循环、流式 TTS 中断）。
- **#34**: 流式 TTS 对比测试（各引擎首包延迟/自然度）。
- **对比差距**：声纹识别明确不做（`server/voiceprint/` 空壳）；刘海字幕视觉对标小爱"灵动进度条"待实测；多设备跨端唤醒、纯离线指令集暂不做。
- **测试入口文档**：详见 `docs/feature-completion-checklist.md`（逐模块勾选清单）。

## 4. Follow-up roadmap — plugin marketplace (数据源待建)

插件市场页（`/settings/extensions/marketplace`）UI 已完成，但 registry 数据源尚未创建：

- **待办 1（阻塞）**: 创建 GitHub 公开仓库 `huankun05/desk-pet-registry`，上传 `registry.json`（结构见 `src/services/market/types.ts` 的 `RegistryIndex`：`{ plugins: RegistryPlugin[], mcpPresets: RegistryMcpPreset[] }`）。当前 `fetchRegistry` 请求 `https://raw.githubusercontent.com/huankun05/desk-pet-registry/main/registry.json` 返回 404。
- **待办 2**: 按 `RegistryPlugin` 字段把现有内置插件（久坐提醒、语音助手等，见 `src/services/skills/plugins/`）录入 registry.json。
- **待办 3**: 可选——增加 registry 版本号/变更检测、离线缓存策略、安装统计上报（现有 `fetchIssueStats` 已接 GitHub Issue reactions）。

## 4b. Follow-up roadmap — docs 定期清理 (2026-08-21 新增)

`docs/` 下存在一次性调研/任务产物，落地后应定期清理，避免误导后续维护：

- **原则**：只维护"仍在演进的活文档"（如本文件、CHANGELOG、emotion/performance/tts/permission 计划）；**过时的临时任务文档不更新、定期归档**。
- **待办 1（候选归档）**：`architecture-investigation.md`（2026-08-18 架构调研，已标 ✅ 已完成、架构已落地）——属一次性结论，可移入 `docs/archive/`。
- **待办 2（方式）**：清理采用**移入 `docs/archive/` 归档**（非硬删，保留历史追溯）；执行前先 `git mv` 备份、确认无其它文件引用后再提交。
- **待办 3（触发）**：用户明确说"清理"时，或定期维护窗口执行；不自动删。

## 5. Build-environment note

`cargo check` / `tauri dev` can be very slow (~15–20 min) because the Tauri
build script registers the entire `../server` tree (GB model weights) as
`rerun-if-changed`, and Windows Defender real-time scan touches every file.
Add Defender exclusions for both `../server` and `../dist` to fix. The dev
machine already has exclusions, so local builds finish in seconds.
