# P1 · AI 引擎进程托管 + 四模式换脑

**目标**：可用性/鲁棒性 — 设置里勾选后自动拉起 Hermes；聊天链路不再依赖 CyreneHarness。

## 范围

1. **HermesProcMgr**（`src/main/hermes/proc-mgr.ts`）
   - 读设置：sourceDir / homeDir / uvPath / apiPort / apiServerKey
   - spawn：`uv run python cli.py --gateway`（工作目录 sourceDir）
   - 环境：`HERMES_HOME`、`API_SERVER_*`
   - 健康：轮询 `/health`；失败指数退避重启
   - 停止：应用退出时优雅结束（注意 gateway 可能 detached，需文档化）
2. **设置联动**：「启动应用时拉起」开关真实生效
3. **HermesClient**：主进程统一持有；health/runs 可用
4. **agui-bridge**：Work/Code/Learn（及可选 Chat）走 Hermes；事件映射 AGUI
5. **ModelRouter** 最小版：按模式选 model
6. **隔离**：CyreneHarness 引用改为开关或目录隔离，不删文件

## 验收

- [ ] 应用启动后 AI 引擎页「检查健康」为在线（若已配好密钥/依赖）
- [ ] 杀掉 gateway 进程后自动拉起
- [ ] 一条 Chat/Work 流式回复来自 Hermes SSE
- [ ] tsc + 相关 vitest 通过

## 非目标

- LifeKernel、记忆预算、MCP 全量、打包 sidecar
