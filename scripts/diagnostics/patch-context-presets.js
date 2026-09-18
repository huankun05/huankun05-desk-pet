const fs = require("fs");
const htmlPath = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/index.html";
let h = fs.readFileSync(htmlPath, "utf8");
const oldHtml = `            <label class="field">
              <span data-i18n="api.contextWindow">上下文窗口（Token）</span>
              <input id="context-window-input" type="number" min="4096" step="1" placeholder="256000" autocomplete="off" />
              <span class="form-hint" id="context-window-auto-hint" style="margin-top:4px"></span>
              <span class="form-hint" data-i18n="api.contextWindowHint">单位 Token。131072≈128K，属常见规格；选择/填写模型后自动带出，可手改。</span>
            </label>`;
const newHtml = `            <label class="field">
              <span data-i18n="api.contextWindow">上下文窗口（Token）</span>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px;">
                <select id="context-window-preset" class="setting-select" style="min-width:180px;">
                  <option value="">常用规格…</option>
                  <option value="8192">8K（8192）</option>
                  <option value="32768">32K（32768）</option>
                  <option value="65536">64K（65536）</option>
                  <option value="131072">128K（131072）</option>
                  <option value="200000">200K（200000）</option>
                  <option value="262144">256K（262144）</option>
                  <option value="524288">512K（524288）</option>
                  <option value="1048576">1M（1048576）</option>
                  <option value="__custom__">自定义…</option>
                </select>
                <input id="context-window-input" type="number" min="4096" step="1" placeholder="例如 131072" autocomplete="off" style="min-width:140px;" />
              </div>
              <span class="form-hint" id="context-window-auto-hint" style="margin-top:4px"></span>
              <span class="form-hint" data-i18n="api.contextWindowHint">单位 Token。可选 8K/32K/128K/256K/1M，也可手填；选模型后自动带出。</span>
            </label>`;
if (h.includes(oldHtml)) {
  h = h.replace(oldHtml, newHtml);
  fs.writeFileSync(htmlPath, h, "utf8");
  console.log("html context preset ok");
} else if (h.includes('id="context-window-preset"')) {
  console.log("html already has preset select");
} else {
  const i = h.indexOf('id="context-window-input"');
  console.log("html miss, context-window-input at", i);
  console.log(JSON.stringify(h.slice(i - 80, i + 200)));
}

const stPath = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let st = fs.readFileSync(stPath, "utf8");
if (!st.includes("context-window-preset")) {
  const oldBind = `function bindModelAutoResolve(): void {
  const run = (reason: "select" | "input" | "preset" | "test") => {
    void autoResolveModelMeta(reason);
  };
  modelInput?.addEventListener("change", () => run("input"));
  modelInput?.addEventListener("blur", () => run("select"));
}
bindModelAutoResolve();`;
  const newBind = `function bindModelAutoResolve(): void {
  const run = (reason: "select" | "input" | "preset" | "test") => {
    void autoResolveModelMeta(reason);
  };
  modelInput?.addEventListener("change", () => run("input"));
  modelInput?.addEventListener("blur", () => run("select"));

  const presetSelect = document.getElementById("context-window-preset") as HTMLSelectElement | null;
  const syncPresetFromValue = (val: string) => {
    if (!presetSelect) return;
    const n = String(val).trim();
    const matched = Array.from(presetSelect.options).some(
      (o) => o.value === n && o.value !== "" && o.value !== "__custom__",
    );
    presetSelect.value = matched ? n : n ? "__custom__" : "";
  };
  presetSelect?.addEventListener("change", () => {
    const v = presetSelect.value;
    if (!v) return;
    if (v === "__custom__") {
      contextWindowInput?.focus();
      return;
    }
    contextWindowInput.value = v;
    setModelAutoHint(
      \`已选择常用上下文 \${v} tokens（约 \${Math.round(Number(v) / 1000)}K）\`,
      "ok",
    );
  });
  contextWindowInput?.addEventListener("change", () => {
    syncPresetFromValue(contextWindowInput.value);
  });
}
bindModelAutoResolve();`;
  if (st.includes(oldBind)) {
    st = st.replace(oldBind, newBind);
    fs.writeFileSync(stPath, st, "utf8");
    console.log("settings bind ok");
  } else {
    console.log("bind pattern miss");
  }
} else console.log("settings already has context-window-preset");
