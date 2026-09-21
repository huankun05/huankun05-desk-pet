const fs = require("fs");
const dp = "F:/Work/Create/desk_pet/desk-pet";

// ── HTML：上下文合并为一个输入框 + 可选规格 + 右侧单位 ──
const htmlPath = dp + "/src/renderer/settings/index.html";
let h = fs.readFileSync(htmlPath, "utf8");
const re = /<label class="field" style="width:100%;">[\s\S]*?context-window-auto-hint[\s\S]*?<\/label>/;
const neu = `<label class="field" style="width:100%;">
              <div style="display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap;">
                <span style="white-space:nowrap;font-weight:600;min-width:140px;" data-i18n="api.contextWindow">上下文窗口（Token）</span>
                <input id="context-window-input" type="number" list="context-window-presets" min="4096" step="1" placeholder="点击选择或直接输入" autocomplete="off" style="flex:1 1 200px;min-width:180px;min-height:40px;padding:8px 12px;border-radius:10px;border:1px solid var(--ui-input-border,#d2d2d7);background:var(--ui-input-bg,#fff);" />
                <datalist id="context-window-presets">
                  <option value="8192"></option>
                  <option value="32768"></option>
                  <option value="65536"></option>
                  <option value="131072"></option>
                  <option value="200000"></option>
                  <option value="262144"></option>
                  <option value="524288"></option>
                  <option value="1048576"></option>
                </datalist>
                <span id="context-window-unit" class="form-hint" style="margin:0;white-space:nowrap;min-width:100px;text-align:right;">单位 Token · 可选可填</span>
              </div>
              <span class="form-hint" id="context-window-auto-hint" style="display:none;"></span>
            </label>`;
if (re.test(h)) {
  h = h.replace(re, neu);
  console.log("context combobox html ok");
} else console.log("context html miss");

fs.writeFileSync(htmlPath, h, "utf8");

// ── settings.ts：初始化时绑定；单位右侧刷新；去掉 preset select ──
const stPath = dp + "/src/renderer/settings/settings.ts";
let t = fs.readFileSync(stPath, "utf8");

// rewrite bindModelAutoResolve
const bStart = t.indexOf("function bindModelAutoResolve");
const bEnd = t.indexOf("/** 载入档案到编辑表单。 */");
if (bStart > 0 && bEnd > bStart) {
  t =
    t.slice(0, bStart) +
    `function updateContextUnitHint(): void {
  const unit = document.getElementById("context-window-unit");
  if (!unit) return;
  const raw = contextWindowInput.value.trim();
  const n = Number(raw);
  if (!raw) {
    unit.textContent = "单位 Token · 可选可填";
    return;
  }
  if (!Number.isFinite(n) || n <= 0) {
    unit.textContent = "单位 Token";
    return;
  }
  const k = n / 1024;
  const kText = k >= 1000 ? \`\${(k / 1000).toFixed(k >= 10000 ? 0 : 1)}M\` : \`\${Math.round(k)}K\`;
  unit.textContent = \`≈ \${kText} · Token\`;
}

function bindModelAutoResolve(): void {
  const run = (reason: "select" | "input" | "preset" | "test") => {
    void autoResolveModelMeta(reason);
    updateContextUnitHint();
  };
  modelInput?.addEventListener("change", () => run("input"));
  modelInput?.addEventListener("blur", () => run("select"));

  contextWindowInput?.addEventListener("input", () => updateContextUnitHint());
  contextWindowInput?.addEventListener("change", () => {
    updateContextUnitHint();
  });

  // 获取模型列表：必须有反应（弹窗 + 下拉）
  const btn = document.getElementById("fetch-models-btn");
  btn?.addEventListener("click", () => {
    console.log("[Settings] fetch-models-btn click");
    void fetchModelsForCurrentForm();
  });
  document.getElementById("provider-model-search")?.addEventListener("input", (e) => {
    renderProviderModelList((e.target as HTMLInputElement).value);
  });
  updateContextUnitHint();
}

// 自动填充后同步右侧单位
const _autoResolveOrig = autoResolveModelMeta;
autoResolveModelMeta = async function wrapped(reason) {
  await _autoResolveOrig(reason);
  updateContextUnitHint();
};

bindModelAutoResolve();

` +
    t.slice(bEnd);
  console.log("bind rewritten");
}

// ensure initSettingsPage also calls bind (idempotent)
if (!t.includes("bindModelAutoResolve(); // idempotent")) {
  t = t.replace(
    "function initSettingsPage(): void {",
    `function initSettingsPage(): void {
  try { bindModelAutoResolve(); } catch (e) { console.error("[Settings] bind model ui", e); } // idempotent
`,
  );
}

// autoResolve: write number + unit, no preset select
t = t.replace(
  `          contextWindowInput.value = String(v);
          const presetSelect = document.getElementById("context-window-preset") as HTMLSelectElement | null;
          if (presetSelect) {
            const matched = Array.from(presetSelect.options).some((o) => o.value === String(v));
            presetSelect.value = matched ? String(v) : "__custom__";
          }`,
  `          contextWindowInput.value = String(v);
          updateContextUnitHint();`,
);

fs.writeFileSync(stPath, t, "utf8");
console.log("bind called", (t.match(/bindModelAutoResolve\(\)/g) || []).length);
console.log("has updateContextUnitHint", t.includes("updateContextUnitHint"));
