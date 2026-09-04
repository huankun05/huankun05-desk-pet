// Auxiliary 面板 DOM 引用（API 面板的辅助模型子区）
// 从 settings.ts 抽离。ESM 静态导入保证查询在 settings.ts 顶层代码之前执行。

export const auxiliaryDedicatedToggle = document.getElementById("toggle-auxiliary-dedicated") as HTMLInputElement;
export const auxiliaryDedicatedFields = document.getElementById("auxiliary-dedicated-fields") as HTMLElement;
export const auxiliaryBaseUrlInput = document.getElementById("auxiliary-base-url") as HTMLInputElement;
export const auxiliaryApiKeyInput = document.getElementById("auxiliary-api-key") as HTMLInputElement;
export const auxiliaryModelInput = document.getElementById("auxiliary-model") as HTMLInputElement;
