# DEVELOPMENT — 工程规范

> 完整流程：[`docs/standards/development-process.md`](docs/standards/development-process.md)  
> Hermes 边界：[`docs/architecture/hermes-integration.md`](docs/architecture/hermes-integration.md)

---

## 必读

1. 先读 [`PLAN.md`](PLAN.md) 与 [`docs/architecture/DESIGN.md`](docs/architecture/DESIGN.md)  
2. 动工走标准流程：发现问题 → 方案 → 审查 → 实现 → 测试 → 文档 → 清理 → 提交  
3. **禁止**修改 Hermes core（除非书面例外）  
4. **禁止**用情绪/反思自动放宽工具权限  

---

## 环境（当前壳）

- Windows 10/11 64-bit（主目标）  
- Node.js 24 + npm 10+  
- 视构建需要：Rust MSVC、VS Build Tools  
- Hermes：官方仓 `../hermes-agent`（工作区）或用户安装；`HERMES_HOME` 指向应用数据  

```bash
cd desk-pet
npm install        # 或项目当前使用的包管理命令
npm run dev
```

细节以 `README.md` 为准（方向切换后可能仍含 Cyrene 表述，实施 P1 时更新）。

---

## 常用检查

```bash
npx tsc -p tsconfig.main.json --noEmit
npm test           # vitest
npm run test:e2e   # playwright（需要时）
```

Hermes 对接后增加：gateway health、`/v1/runs` 冒烟。

---

## 目录约定

| 路径 | 用途 |
|---|---|
| `src/main` | Electron 主进程 |
| `src/renderer` | 渲染进程 UI |
| `prompts/` | 角色/提示（将演进为 characters 角色卡） |
| `docs/architecture` | 当前架构 |
| `docs/plan` | 阶段计划 |
| `docs/history` | 历史只读 |
| `scripts/diagnostics` | 诊断脚本；禁止长期 `tmp-*` |
| `../hermes-agent` | 官方 Hermes（工作区） |
| `../archives` | 旧仓与历史参考 |
| `../NapCatShell` | QQ/NapCat 运行时（在用） |

---

## Git

- 在 `desk-pet/` 内操作  
- 提交信息说明动机  
- 不提交密钥、运行数据、构建产物  
- 用户未要求不 push  

---

## 代码风格（摘要）

- TypeScript strict  
- 主进程模块边界清晰：channel / orchestrator / memory / life / hermes-client  
- 新能力优先独立模块 + 单测，避免巨石文件  
- 注释只写非显然的「为什么」  
