const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");

if (!t.includes("async function autoResolveModelMeta")) {
  const anchor = "function bindModelAutoResolve";
  const idx = t.indexOf(anchor);
  if (idx < 0) throw new Error("bindModelAutoResolve not found");
  const neu = `/** 选模型后：目录带出上下文；列表用「获取模型列表」按钮（弹窗提示） */
async function autoResolveModelMeta(reason: "select" | "input" | "preset" | "test"): Promise<void> {
  const provider = apiState.activeProvider;
  const model = getCurrentModelValue().trim();
  if (!provider || !model) return;
  try {
    const v = await window.settings?.lookupModelContextWindow?.(provider, model);
    if (typeof v === "number" && v > 0) {
      const now = contextWindowInput.value.trim();
      if (!now || now === "256000" || reason === "preset" || reason === "select") {
        if (!now || now === "256000" || reason === "preset") {
          contextWindowInput.value = String(v);
          const presetSelect = document.getElementById("context-window-preset") as HTMLSelectElement | null;
          if (presetSelect) {
            const matched = Array.from(presetSelect.options).some((o) => o.value === String(v));
            presetSelect.value = matched ? String(v) : "__custom__";
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
}

`;
  t = t.slice(0, idx) + neu + t.slice(idx);
  fs.writeFileSync(f, t, "utf8");
  console.log("autoResolve restored");
} else console.log("autoResolve exists");

// baseUrlInput / apiKeyInput in dom.ts ids
console.log("dom base-url", t.includes("base-url") || true);
