const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");

// Add picker helper before setModelAutoHint
if (!t.includes("function renderProviderModelPicker")) {
  const helper = `
/** 服务商模型下拉：点击可选用 */
function renderProviderModelPicker(
  models: Array<{ id: string; contextWindow?: number }>,
  currentModel: string,
): void {
  const box = document.getElementById("provider-model-picker");
  if (!box) return;
  if (!models.length) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  box.style.display = "block";
  box.innerHTML = models
    .map((m) => {
      const active = m.id === currentModel ? "font-weight:700;" : "";
      const ctx = m.contextWindow ? \` · \${m.contextWindow}\` : "";
      return \`<button type="button" class="btn-secondary provider-model-item" data-id="\${m.id}" data-ctx="\${m.contextWindow || ""}" style="display:block;width:100%;text-align:left;margin:2px 0;min-height:30px;\${active}">\${m.id}\${ctx}</button>\`;
    })
    .join("");
  box.querySelectorAll<HTMLButtonElement>(".provider-model-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id || "";
      if (!id) return;
      modelInput.value = id;
      const ctx = btn.dataset.ctx;
      if (ctx && Number(ctx) > 0) {
        contextWindowInput.value = String(ctx);
        setModelAutoHint(\`已选择服务商模型 \${id} · 上下文 \${ctx}\`, "ok");
      } else {
        setModelAutoHint(\`已选择服务商模型 \${id}\`, "ok");
        void autoResolveModelMeta("select");
      }
      renderProviderModelPicker(models, id);
    });
  });
}

`;
  t = t.replace("/** 设置页底部提示：模型/上下文自动获取状态 */", helper + "/** 设置页底部提示：模型/上下文自动获取状态 */");
  console.log("helper inserted");
}

// Replace the section after successful fetch to use picker + auto-select
const oldHit = `      const hit = result.models.find((m) => m.id === model);
      if (!hit) {
        setModelAutoHint(
          \`「\${provider}」共 \${result.models.length} 个模型，无「\${model}」；请核对 ID。上下文\${catalogValue ? \`用目录 \${catalogValue}\` : "请手填"}\`,
          "err",
        );
        return;
      }`;

// try read current file content for hit block
const idx = t.indexOf("const hit = result.models.find((m) => m.id === model);");
console.log("hit idx", idx);

if (idx > 0) {
  const start = idx;
  const endMarker = "return;\n      }";
  // find the if (!hit) block end after start
  const blockStart = t.indexOf("const hit = result.models.find", start);
  // from hit to "if (hit.contextWindow" or after !hit return
  const after = t.slice(blockStart, blockStart + 1200);
  console.log("snippet", after.slice(0, 500).replace(/\n/g, "\\n"));
}

fs.writeFileSync(f, t, "utf8");
