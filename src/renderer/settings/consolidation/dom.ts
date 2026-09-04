// Consolidation 面板 DOM 引用（API 面板的技能自整理子区）
// 从 settings.ts 抽离。ESM 静态导入保证查询在 settings.ts 顶层代码之前执行。

export const consolidationToggle = document.getElementById("toggle-consolidation") as HTMLInputElement;
