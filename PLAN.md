# 🐱 Desktop Pet - 智能桌面助手

## 技术栈

- **前端**: React 19 + TypeScript + Vite 7
- **桌面框架**: Tauri 2.0
- **Live2D**: Cubism SDK v5 原生 WebGL2
- **AI**: OpenAI-compatible API + Hermes Gateway
- **感知**: MediaPipe（手部 21 点 / 面部 468 点）+ OpenCV + WebSocket 实时流
- **Python 服务**: FastAPI + Uvicorn，单 venv 统一管理
- **TTS**: Edge TTS / GPT-SoVITS / CosyVoice V3（纳西妲微调）
- **STT**: FunASR + SenseVoice

---

## 项目现状（2026-08-18）

| 维度 | 状态 |
|------|------|
| 核心系统 | Hermes Core (hermes_core/) + desk-pet 扩展（emotion/soul/time/memory/voice） |
| 大脑调度 | ServiceLifecycle 统一管理 TTS/STT/Embedding/LLM 全生命周期 |
| 前端功能 | 系统托盘 ✅ / 番茄钟 ✅ / 每日问候 ✅ / 技能系统(5个) ✅ / 感知降级 ✅ |
| 安全加固 | DPAPI 加密 + Token 鉴权 + ErrorBoundary ✅ |
| 测试/CI | Vitest(136) ✅ / GitHub Actions CI ✅ / Playwright 配置 ✅ |
| 工程化 | TypeScript strict ✅ / Rust 模块化 ✅ / ESLint + Prettier + Husky ✅ / Lint 警告清理（92→74） ✅ |
| Tauri 打包 | 🔲 Phase 5 待实现 |
| 虚拟环境 | 统一为 `./venv`（主 venv），CosyVoice 依赖已回归 |
| 语音服务 | TTS (CosyVoice/Edge/GPT-SoVITS) / STT (FunASR/SenseVoice) / Embedding (Ollama) 全部走大脑 |

---

## Phase 进度总览

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | 基础交互（Live2D / 对话 / 情感 / 互动 / 持久化） | ✅ 完成 |
| Phase 2 | Function Calling + 内容安全 + 截图/剪贴板 | ✅ 完成 |
| Phase 3 | MCP + 服务管理 + Ollama + 精简重构 | ✅ 完成 |
| Phase 4 | 上下文压缩 + 人格系统 + 洋葱管道 + 情绪优化 + 性能 + 工具循环 | ✅ 完成 |
| Phase 4e | 感知服务整合 + 项目瘦身 + 文档合并 | ✅ 完成 |
| Phase 5 | i18n ✅ / Tauri 打包 🔲 | 🔴 待续 |
| Phase 6 | 工程化体系（安全 / 测试 / CI） | ✅ 完成 |
| Phase 7 | 新功能（等级 / 小游戏 / 换装 / 知识库 / 微件 / 音效） | 🟡 部分 |
| Phase 7A | AstrBot 借鉴（定时任务 / 技能 / 工具 / 备份 / 行为系统） | ✅ 完成 |
| Phase 8 | 核心系统移植（Heart / Brain / Soul / Time） | ✅ 完成 |
| Phase 9 | 语音实时性优化（流式 TTS + VAD + 引擎扩展） | ✅ 完成 |
| Phase 11 | 差异化体验优化（RAG / 行为系统 / 人设热切换 / 感知降级） | ✅ 完成 |
|| Phase 12 | 记忆-情绪耦合 + 主动行为情绪驱动 + 内在状态后端持久化 + 情绪可视化增强 | 🟡 进行中 |

---

## 待办 Roadmap

### P0 阻塞项

| # | 任务 | 说明 | 状态 |
|---|------|------|------|
| 1 | Tauri 打包发布 | 生成 .exe Windows 安装包（nsis/msi） | 🔲 待实现 |
| 2 | CosyVoice CUDA 加速 | onnxruntime CUDAExecutionProvider 可用性修复 | 🟡 进行中 |

### P1 近期任务

| # | 任务 | 说明 | 状态 |
|---|------|------|------|
| 3 | 宠物等级系统 | 互动累积经验值 → 升级解锁表情/动画 | 🔲 待实现 |
| 4 | 知识库系统 | PDF/EPUB/URL 解析 + 向量检索 | 🔲 待实现 |
| 5 | Agent 系统 | 多后端支持 + 工具执行循环 | 🔲 待实现 |
| 6 | CHANGELOG.md | 按 semver 记录变更历史 | ✅ 已创建 |
| 7 | 配置 Schema | config.schema.json → Admin 自动生成配置表单 | 🔲 待实现 |
| 12a | 主动消息生成 | LLM 优先 + 前端台词池 fallback | 🟡 进行中 |
| 12b | boredom/loneliness idle 增长 | 无互动随时间上升 | 🟡 进行中 |
| 12c | 回忆情绪叠加 | 30% × importance PAD 叠加 + 10s 指数衰减回原状态，前端表情/状态叠加接入 | 🟡 进行中 |
| 12d | 运行时验证 | InteractionPage.tsx 后端消息热更新、未读徽标实际行为 | 🟡 进行中 |

---

| # | 任务 | 说明 | 状态 |
|---|------|------|------|
| 8 | 多宠物共存 | 同时渲染多个 Live2D 角色 | 🔲 远期 |
| 9 | 语音唤醒 | "嘿，纳西妲" 触发对话 | 🔲 远期 |
| 10 | 桌面微件 | 天气/CPU/内存小卡片 | 🔲 远期 |
| 11 | 移动端同步 | 手机 Web App 远程查看宠物状态 | 🔲 远期 |

---

## 环境说明

- **Python venv**: `./venv`（主 venv，统一管理所有 Python 依赖）
- **CUDA 共存**: CUDA 12.1 安装在 `E:/software/cuda12.1`，启动 CosyVoice 时局部注入 PATH
- **模型权重**: `server/cosyvoice/models/`、`server/CosyVoice/`（不进 Git）
- **`.gitignore`**: 排除 `venv/`、`src-tauri/target/`、`dist/`、模型权重、临时输出文件

---

## 项目结构

```
desk-pet/
├── venv/                    # 主 Python venv（torch 2.5.1+cu121、onnxruntime、FastAPI 等）
├── src/                     # 前端（React + TypeScript）
│   ├── services/            # 纯逻辑服务层
│   ├── admin/               # 管理后台
│   ├── hooks/               # React Hooks
│   └── i18n/                # 国际化
├── src-tauri/               # Rust 后端（Tauri + 服务管理）
├── server/                  # Python AI 服务
│   ├── hermes_core/         # Hermes 核心 + desk-pet 扩展（一个整体）
│   │   ├── hermes_state.py # Hermes 会话存储 + FTS5
│   │   ├── emotion/         # 情绪/表情/激素系统
│   │   ├── soul/            # 人格/漂移
│   │   ├── time/            # 昼夜/纪念日
│   │   ├── memory/          # 记忆碎片系统
│   │   ├── voice_services.py # 语音服务启动器
│   │   └── __init__.py      # 统一导出所有能力
│   ├── core/                # 兼容层（旧 import 路径转发到 hermes_core/）
│   ├── modules/             # VAD/ASR/LLM/TTS/Emotion 模块
│   ├── perception/          # 感知服务（MediaPipe + WebSocket）
│   ├── cosyvoice_server.py  # CosyVoice V3 HTTP 服务（port 8003）
│   └── data/                # 数据库文件
│       ├── hermes_state.db  # 会话历史 + FTS5
│       └── core.db          # 记忆碎片 + 情绪 + 人格
├── docs/
│   ├── architecture-investigation.md  # 架构统一方案（基于 Hermes 再开发）
│   ├── known-warnings-and-roadmap.md  # 已知 warning 和后续路线图
│   ├── tts-backend.md                 # TTS 后端架构
│   ├── data-management.md             # 数据存储策略
│   └── voice-assistant-permission-plan.md  # 语音助手权限计划
├── DEVELOPMENT.md           # 工程规范文档
└── PLAN.md                  # 本文件
```

---

## 参考文档

- [DEVELOPMENT.md](DEVELOPMENT.md) — 工程规范、架构设计、编码规范
- [docs/known-warnings-and-roadmap.md](docs/known-warnings-and-roadmap.md) — 已知 warning 和后续路线图
- [docs/tts-backend.md](docs/tts-backend.md) — TTS 后端架构
- [docs/data-management.md](docs/data-management.md) — 数据存储策略
- [docs/voice-assistant-permission-plan.md](docs/voice-assistant-permission-plan.md) — 语音助手权限计划
