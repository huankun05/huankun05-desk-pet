const fs = require("fs");
const dp = "F:/Work/Create/desk_pet/desk-pet";

// ── StepFun preset ──
const presetsPath = dp + "/src/renderer/settings/api/presets.ts";
let presets = fs.readFileSync(presetsPath, "utf8");
if (!presets.includes("StepFun")) {
  presets = presets.replace(
    `    {
      providerName: "豆包（火山方舟）",`,
    `    {
      providerName: "StepFun（阶跃星辰）",
      shortName: "StepFun",
      baseUrl: "https://api.stepfun.com/v1",
      transport: "openai",
      mainModels: ["step-3.7-flash", "step-3.5-flash", "step-2-16k", "step-1-8k", "step-1v"],
      iconUrl: "../icons/providers/deepseek.svg",
      websiteUrl: "https://platform.stepfun.com/",
    },
    {
      providerName: "豆包（火山方舟）",`,
  );
  fs.writeFileSync(presetsPath, presets, "utf8");
  console.log("StepFun preset added");
} else console.log("StepFun exists");

// ── HTML: 模型行改造 ──
const htmlPath = dp + "/src/renderer/settings/index.html";
let h = fs.readFileSync(htmlPath, "utf8");
const oldBlock = h.match(/<label class="field field--full">[\s\S]*?provider-model-picker[\s\S]*?<\/label>/);
if (oldBlock) {
  const neu = `<label class="field field--full">
              <span data-i18n="api.modelName">模型名</span>
              <div style="display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap;">
                <input id="model-input" type="text" placeholder="选厂商后自动填入，可手填覆盖" autocomplete="off" list="model-input-suggestions" data-i18n="settings.modelPlaceholderDefault" style="flex:1;min-width:200px;" />
                <datalist id="model-input-suggestions"></datalist>
                <button type="button" class="btn-secondary" id="fetch-models-btn" style="min-height:36px;white-space:nowrap;">获取模型列表</button>
              </div>
              <div id="provider-model-dropdown" style="display:none;margin-top:8px;border:1px solid var(--ui-border,#e5e5ea);border-radius:10px;padding:8px;max-height:260px;overflow:auto;">
                <input id="provider-model-search" type="text" placeholder="搜索模型…" style="width:100%;min-height:34px;margin-bottom:6px;padding:6px 10px;border-radius:8px;border:1px solid var(--ui-input-border,#d2d2d7);background:var(--ui-input-bg,#fff);" />
                <div id="provider-model-list"></div>
              </div>
              <span class="form-hint" id="model-fetch-status" style="margin-top:4px;display:block;"></span>
            </label>`;
  h = h.replace(oldBlock[0], neu);
  fs.writeFileSync(htmlPath, h, "utf8");
  console.log("model row replaced");
} else console.log("model block miss");

// context select 宽度
h = fs.readFileSync(htmlPath, "utf8");
h = h.replace(
  'id="context-window-preset" class="setting-select" style="min-width:180px;"',
  'id="context-window-preset" class="setting-select" style="flex:1;min-width:220px;max-width:100%;"',
);
h = h.replace(
  'id="context-window-input" type="number" min="4096" step="1" placeholder="例如 131072" autocomplete="off" style="min-width:140px;"',
  'id="context-window-input" type="number" min="4096" step="1" placeholder="例如 131072" autocomplete="off" style="flex:0 0 140px;width:140px;"',
);
h = h.replace(
  '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px;">\n                <select id="context-window-preset"',
  '<div style="display:flex;gap:8px;flex-wrap:nowrap;align-items:center;margin-top:4px;width:100%;">\n                <select id="context-window-preset"',
);
fs.writeFileSync(htmlPath, h, "utf8");
console.log("context layout tweaked", h.includes("provider-model-dropdown"), h.includes("fetch-models-btn"));
