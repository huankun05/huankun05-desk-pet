# 数据文件管理规范（Data Management）

> 最后更新：2026-08-15
> 原则：**一切运行时生成的数据，只允许写在数据目录内；目录分门别类、文件名规范、可清理、不杂乱。**

## 1. 数据根目录（dataDir）

由 Rust `utils::get_project_data_dir()` 统一解析：

| 环境 | 路径 |
|------|------|
| 开发（`pnpm tauri dev`） | 项目根 `desk-pet/data/` |
| 打包发布 | exe 同级 `data/` |

> 所有文件读写命令（`write_file` / `read_file_content` / `list_directory` / `delete_file` / `write_audio_file` / `read_audio_file`）在 Rust 侧**强制校验路径必须位于 dataDir 内**，越界一律 `Access denied`，杜绝路径穿越。

## 2. 目录职责（一目录一用途）

| 目录 | 内容 | 归属 |
|------|------|------|
| `audio/interact/` | 预制台词音频（TTS 生成的 WAV） | 交互消息 TTS（本次新增） |
| `backups/` | 配置/数据备份（滚动保留最近 N 份） | 备份引擎 |
| `config/` | 运行时配置落盘 | 各模块 |
| `logs/` | 日志文件 | 后端/网关 |
| `memory/` | 记忆引擎数据（sqlite/json） | 记忆模块 |
| `models/` | 本地模型文件（如 vosk） | 感知/唤醒 |
| `mcp/` `plugins/` | MCP 与插件相关数据 | 插件体系 |
| `sessions/` | 会话记录 | 聊天 |
| `temp/` | 临时文件（定期清理） | 通用 |

**规则**：新增功能产生数据时，先在此表登记一个子目录，不得直接往 dataDir 根散落文件（根目录只允许数据库文件与少量清单）。

## 3. 交互台词音频命名规范

- 目录：`audio/interact/`
- 文件名：`<hash8>-<label>.wav`
  - `hash8`：文本的稳定散列（FNV-1a，无符号 32 位 hex 前 8 位）——**同一文本恒定同名，天然去重**
  - `label`：清洗后的文本前缀（≤10 字符，仅保留中英文/数字/下划线/连字符），便于人工识别
  - 示例：`a1b2c3d4-你好我是纳西.wav`
- 实现：`src/services/audio/audioFiles.ts` 的 `audioFileNameOf(text)`
- 采样率：写入时按引擎实际输出（CosyVoice 24kHz）；**读取时从 WAV 头解析**（`parseWavSampleRate`），不依赖额外元数据

## 4. 音频读写链路

```
合成成功（InteractTTS.setCache）
  ├─ 内存 Map（即时播放）
  ├─ IndexedDB（deskpet_interact_tts，重启加速）
  └─ 磁盘镜像 data/audio/interact/<hash8>-<label>.wav（权威存储，可人工查看/清理）
播放时（ensureAudio）：内存 → 磁盘 → 实时合成
```

- **磁盘是权威存储**：IndexedDB 仅作加速缓存；清空缓存（`clearCache`/切模型 `reprewarm`）会同时清 IndexedDB 与磁盘。
- 管理入口：设置 → 模型 → 交互消息 → 「音频资源」区（列表/试听/删除/打开文件夹/清理未引用/重新生成全部）。

## 5. 清理策略

- **交互台词**：删除/重置消息后，用「清理未引用音频」移除不在当前台词集合的文件；切 TTS 模型 `reprewarm` 自动全清重生成。
- **备份**：滚动保留最近 N 份（`backupEngine.ts`）。
- **temp/**：`cleanup_temp` 命令定期清理。
- **原则**：能归类的绝不乱放；能清理的绝不堆积。

## 6. 新增文件读写能力时的检查单

1. 是否走已有命令（`write_file` 文本 / `write_audio_file` 二进制 base64 / `list_directory` / `delete_file`）？
2. 路径是否位于 dataDir 内（Rust 侧已强制）？文件名是否经白名单/清洗（见 `sanitizeLabel`）？
3. 是否在本文档登记了目录职责？
