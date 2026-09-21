const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");

const start = t.indexOf("function bindModelAutoResolve");
const end = t.indexOf("bindModelAutoResolve();", start);
if (start < 0 || end < 0) {
  console.log("bind not found");
  process.exit(1);
}

const neu = `let _modelUiBound = false;

function bindModelAutoResolve(): void {
  if (_modelUiBound) return;
  _modelUiBound = true;

  const kSelect = document.getElementById("context-window-k") as HTMLSelectElement | null;
  const ctxInput = document.getElementById("context-window-input") as HTMLInputElement | null;

  /** 下拉只显示「规格标签」；手填时不显示任何 K 值（保持空白） */
  function setKSelectBlank(): void {
    if (kSelect) kSelect.value = "";
  }

  function syncKSelectFromTokens(tokens: number): void {
    if (!kSelect) return;
    if (!tokens || !Number.isFinite(tokens)) {
      setKSelectBlank();
      return;
    }
    const matched = Array.from(kSelect.options).some((o) => o.value === String(tokens));
    // 仅当数值恰好等于某档规格时才回显该档；否则下拉保持空白
    kSelect.value = matched ? String(tokens) : "";
  }

  modelInput?.addEventListener("change", () => void autoResolveModelMeta("input"));
  modelInput?.addEventListener("blur", () => void autoResolveModelMeta("select"));

  document.getElementById("fetch-models-btn")?.addEventListener("click", () => {
    void fetchModelsForCurrentForm();
  });
  document.getElementById("model-list-toggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleModelDropdown();
  });
  document.getElementById("provider-model-search")?.addEventListener("input", (e) => {
    renderProviderModelList((e.target as HTMLInputElement).value);
  });
  modelInput?.addEventListener("click", (e) => {
    if (_providerModelsCache.length) {
      e.preventDefault();
      toggleModelDropdown();
    }
  });
  document.addEventListener("click", (e) => {
    if (!_modelListOpen) return;
    const target = e.target as HTMLElement;
    if (
      target.closest("#provider-model-dropdown") ||
      target.closest("#model-list-toggle") ||
      target.closest("#model-input") ||
      target.closest("#fetch-models-btn")
    ) {
      return;
    }
    openModelDropdown(false);
  });

  // ── 上下文：默认下拉空白；选规格才填数；手填则下拉变空白 ──
  kSelect?.addEventListener("change", () => {
    const v = kSelect.value;
    if (!v) {
      // 选中「空白」：不改输入框，只表示不锁定规格
      return;
    }
    applyContextTokens(Number(v), false);
    void autoResolveModelMeta("select");
  });

  ctxInput?.addEventListener("input", () => {
    const n = (ctxInput.value || "").replace(/[^0-9]/g, "");
    if (ctxInput.value !== n) ctxInput.value = n;
    // 手动修改 → 下拉不显示任何 K 值
    setKSelectBlank();
  });

  // 初始化：默认下拉空白（输入框已有自动带出值时也先空白，避免误导）
  if (kSelect && !kSelect.dataset.userTouched) {
    setKSelectBlank();
  }
}
`;

t = t.slice(0, start) + neu + t.slice(end + "bindModelAutoResolve();".length);

// applyContextTokens：写入数值后同步下拉（匹配才显示 K）
t = t.replace(
  /function applyContextTokens\(tokens: number, blank = false\): void \{[\s\S]*?\n\}/,
  `function applyContextTokens(tokens: number, blank = false): void {
  const input = document.getElementById("context-window-input") as HTMLInputElement | null;
  const sel = document.getElementById("context-window-k") as HTMLSelectElement | null;
  if (blank || !tokens) {
    if (input && blank) input.value = "";
    if (sel) sel.value = "";
    return;
  }
  if (input) input.value = String(tokens);
  if (sel) {
    const matched = Array.from(sel.options).some((o) => o.value === String(tokens));
    sel.value = matched ? String(tokens) : "";
  }
}`,
);

fs.writeFileSync(f, t, "utf8");
console.log("bind rewritten");
console.log("setKSelectBlank", t.includes("setKSelectBlank"));
