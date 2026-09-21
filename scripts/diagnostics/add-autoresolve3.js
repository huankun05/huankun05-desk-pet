const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");
if (t.includes("async function autoResolveModelMeta")) {
  console.log("already exists");
  process.exit(0);
}
const idx = t.indexOf("let _providerModelsCache");
const neu = `/** 目录带出上下文（仅当输入框为空） */
async function autoResolveModelMeta(_reason: string): Promise<void> {
  const provider = apiState.activeProvider;
  const model = getCurrentModelValue().trim();
  if (!provider || !model) return;
  try {
    const v = await window.settings?.lookupModelContextWindow?.(provider, model);
    if (typeof v === "number" && v > 0) {
      const input = document.getElementById("context-window-input") as HTMLInputElement | null;
      if (!input?.value.trim()) applyContextTokens(v, false);
    }
  } catch {
    /* ignore */
  }
}

`;
t = t.slice(0, idx) + neu + t.slice(idx);
fs.writeFileSync(f, t, "utf8");
console.log("added", t.includes("async function autoResolveModelMeta"));
