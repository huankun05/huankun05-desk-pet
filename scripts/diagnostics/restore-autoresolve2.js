const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");
if (!t.includes("async function autoResolveModelMeta")) {
  const idx = t.indexOf("function bindModelAutoResolve");
  const neu = `/** 选模型后用目录带出上下文 */
async function autoResolveModelMeta(_reason: "select" | "input" | "preset" | "test"): Promise<void> {
  const provider = apiState.activeProvider;
  const model = getCurrentModelValue().trim();
  if (!provider || !model) return;
  try {
    const v = await window.settings?.lookupModelContextWindow?.(provider, model);
    if (typeof v === "number" && v > 0) {
      const input = document.getElementById("context-window-input") as HTMLInputElement | null;
      const now = input?.value.trim() || "";
      if (!now) applyContextTokens(v);
    }
  } catch {
    /* ignore */
  }
}

`;
  t = t.slice(0, idx) + neu + t.slice(idx);
  fs.writeFileSync(f, t, "utf8");
  console.log("autoResolve restored");
} else console.log("ok already");
console.log("applyContextTokens", t.includes("function applyContextTokens"));
