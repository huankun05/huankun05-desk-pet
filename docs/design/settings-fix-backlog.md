# 设置页与启动相关 — 待后续修复清单

更新：2026-09-18

## 已修复（本轮）

| 项 | 说明 |
|---|---|
| 设置导航点不动 | 重复 import / 未声明 `workFlowAdaptBtn` / `./skills` 误解析到 css |
| 备份入口重复 | 侧栏合并为 **存储与备份**（storage）；独立「备份管理」不再占导航 |
| 模型/上下文自动获取 | 选模型后：目录 + 服务商 `/v1/models`；失败显示原因 |
| 启动失败弹窗 | 开发模式下改为中文步骤提示，不再只甩调用栈 |

## 记入后续（更深 / 不在本轮）

| 优先级 | 问题 | 说明 |
|---|---|---|
| P1 | 设置页 `settings.css` 巨石 | 12 万+ 字符，需按面板拆分 |
| P1 | 生产 vs 开发 userData | 已冻结 live2d-cyrene；dev/正式混用同一数据待评估 |
| P1 | AI 引擎进程托管完整接线 | 设置项已收拢；spawn/重启/日志在 UI 可见性 |
| P2 | 备份完整性 | prompts（人设）在程序目录；聊天/模型 Key 依赖 storage 备份类别 |
| P2 | NapCat 窗口 | windowsHide 已开；QQ 自身 UI、手动启动残留进程仍可能「有窗口」 |
| P2 | 品色主题仅 pearl-white | tokens 里遗留多套色；UI-DESIGN 已规定单主题 |
| P3 | 代码标识符 Cyrene* | 用户可见层已用产品名；文件名迁移延后 |
| P3 | Work/Code 工具链与 Hermes 对齐 | P1 换脑尚未做完 |
| P3 | 音乐/ASR 等面板类型错误 | tsc 非 main 范围内的 renderer 历史类型问题 |

## 模型自动获取行为（现行）

1. 选择厂商/档案/修改模型名 → `autoResolveModelMeta`  
2. 有 Base URL + API Key → 请求 `GET {base}/v1/models`  
   - 成功：刷新下拉；无此 ID → **提示核对**；有上下文 → **自动填入**  
   - 失败 → **提示获取失败，可手动填写**  
3. 无 Key 或接口不返回上下文 → 内置目录 `model-context-catalog`  
4. 目录也没有 → **提示手动填写上下文 Token**

相关代码：`src/renderer/settings/settings.ts`、`src/main/orchestrator/vendors/fetch-provider-models.ts`
