# 汐月/昔涟 设置与模型服务 — 现状（2026-09-21）

产品 UI 名仍为 **昔涟 / Cyrene**（品牌冻结）。技术层：Electron 壳 + Hermes（智核/AI 引擎）+ LifeKernel（心）。

## 模型服务（设置）

| 控件 | 行为 |
|---|---|
| 模型名 | 输入框；获取成功后旁侧出现 ▼，可搜索点选 |
| 获取模型列表 | Toast：`获取到 N 个模型` / `获取失败：原因`（仅一条） |
| 模型列表 | 本页缓存；▼ 收起/展开；点外收起 |
| 上下文窗口 | 单输入框 + 右侧 ▼（8K/32K/…/1M + 手填清空） |

- 配置与厂商 Key 仍在「模型服务」档案中维护  
- 获取走 OpenAI 兼容 `GET {base}/v1/models`；anthropic 路径自动回退  
- 官方列表无当前 ID 时 Toast 提示，并可下拉选择官方型号  

## 存储与备份

- 数据根：`%APPDATA%\live2d-cyrene`（`CYRENE_USER_DATA_DIR` 可改）  
- 占用分析、缓存清理、备份创建/恢复/删除均在设置「存储与备份」  
- 侧栏不再有独立「备份管理」页  

## 开发启动

```powershell
cd F:\Work\Create\desk_pet\desk-pet
npm run dev
# 或
powershell -File scripts\diagnostics\restart-dev-full.ps1
```

主进程改动后需 `build:main` + 重启 Electron。

## 相关文档

- `docs/design/UI-DESIGN.md` — UI 规范  
- `docs/design/settings-ia-audit.md` — 设置 IA  
- `docs/design/settings-fix-backlog.md` — 后续项  
- `docs/standards/user-data-layout.md` — 数据目录  
- `docs/plan/ROADMAP.md` / `PLAN.md` — 路线  
