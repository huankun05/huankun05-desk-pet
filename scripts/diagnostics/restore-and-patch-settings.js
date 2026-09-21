const { execSync } = require("child_process");
const fs = require("fs");
const cwd = "F:/Work/Create/desk_pet/desk-pet";
const f = cwd + "/src/renderer/settings/settings.ts";

// 1) 恢复完整可用的 settings.ts
const good = execSync("git show 78a7da1:src/renderer/settings/settings.ts", { cwd, encoding: "utf8", maxBuffer: 10e6 });
fs.writeFileSync(f, good, "utf8");
let t = fs.readFileSync(f, "utf8");

// 2) 注入 toast
if (!t.includes('from "./shared/toast"')) {
  t = t.replace(
    'import { showModal, showHtmlModal, showInputModal } from "./shared/modal";',
    'import { showModal, showHtmlModal, showInputModal } from "./shared/modal";\nimport { showToast } from "./shared/toast";',
  );
}

// 3) 替换模型/上下文交互：从 openModelDropdown 或 let _providerModelsCache 到 bindModelAutoResolve
let start = t.indexOf("/** 本页会话内缓存的模型列表");
if (start < 0) start = t.indexOf("function openModelDropdown");
if (start < 0) start = t.indexOf("let _providerModelsCache");
const end = t.indexOf("function bindModelAutoResolve");
if (start < 0 || end < 0) {
  console.log("cannot find model block", start, end);
  process.exit(1);
}

const neu = `/** 本页缓存的模型列表：获取成功后才有 */
let _providerModelsCache: Array<{ id: string; contextWindow?: number }> = [];
let _modelListOpen = false;
let _ctxListOpen = false;
let _modelUiBound = false;

const CONTEXT_PRESETS: Array<{ label: string; value: number }> = [
  { label: "8K", value: 8192 },
  { label: "32K", value: 32768 },
  { label: "64K", value: 65536 },
  { label: "128K", value: 131072 },
  { label: "200K", value: 200000 },
  { label: "256K", value: 262144 },
  { label: "512K", value: 524288 },
  { label: "1M", value: 1048576 },
];

function openModelDropdown(open: boolean): void {
  _modelListOpen = open && _providerModelsCache.length > 0;
  const drop = document.getElementById("provider-model-dropdown");
  const arrow = document.getElementById("model-list-toggle");
  if (drop) drop.style.display = _modelListOpen ? "block" : "none";
  if (arrow) {
    arrow.style.display = _providerModelsCache.length ? "" : "none";
    arrow.textContent = _modelListOpen ? "▲" : "▼";
  }
}

function toggleModelDropdown(): void {
  if (!_providerModelsCache.length) return;
  openModelDropdown(!_modelListOpen);
  if (_modelListOpen) {
    renderProviderModelList(
      (document.getElementById("provider-model-search") as HTMLInputElement | null)?.value || "",
    );
  }
}

function renderProviderModelList(filter = ""): void {
  const box = document.getElementById("provider-model-list");
  if (!box) return;
  if (!_providerModelsCache.length) {
    openModelDropdown(false);
    box.innerHTML = "";
    return;
  }
  const q = filter.trim().toLowerCase();
  const list = _providerModelsCache.filter((m) => !q || m.id.toLowerCase().includes(q));
  const current = getCurrentModelValue().trim();
  if (!list.length) {
    box.innerHTML = '<div style="padding:10px;color:#888;font-size:13px;">无匹配模型</div>';
    return;
  }
  box.innerHTML = list
    .map((m) => {
      const active = m.id === current;
      return \`<button type="button" class="provider-model-item" data-id="\${m.id}" data-ctx="\${m.contextWindow || ""}" style="display:flex;width:100%;justify-content:space-between;align-items:center;text-align:left;margin:2px 0;padding:9px 10px;min-height:38px;border:1px solid \${active ? "var(--brand-primary,#ff5b8a)" : "transparent"};border-radius:8px;background:\${active ? "var(--brand-primary-soft,#fff1f6)" : "transparent"};cursor:pointer;"><span>\${m.id}</span><span style="font-size:12px;opacity:.7;">\${m.contextWindow ? Math.round(m.contextWindow / 1000) + "K" : ""}</span></button>\`;
    })
    .join("");
  box.querySelectorAll<HTMLButtonElement>(".provider-model-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id || "";
      if (!id) return;
      modelInput.value = id;
      const ctx = btn.dataset.ctx;
      if (ctx && Number(ctx) > 0) applyContextTokens(Number(ctx));
      else void autoResolveModelMeta("select");
      openModelDropdown(false);
    });
  });
}

function openContextPresetDropdown(open: boolean): void {
  _ctxListOpen = open;
  const drop = document.getElementById("context-preset-dropdown");
  const arrow = document.getElementById("context-preset-toggle");
  if (drop) drop.style.display = open ? "block" : "none";
  if (arrow) arrow.textContent = open ? "▲" : "▼";
  if (open) renderContextPresetList();
}

function renderContextPresetList(): void {
  const box = document.getElementById("context-preset-dropdown");
  if (!box) return;
  const current = (document.getElementById("context-window-input") as HTMLInputElement | null)?.value.trim() || "";
  box.innerHTML =
    CONTEXT_PRESETS.map((p) => {
      const active = current === String(p.value);
      return \`<button type="button" class="ctx-preset-item" data-value="\${p.value}" style="display:flex;width:100%;justify-content:space-between;padding:9px 12px;min-height:38px;border:none;border-bottom:1px solid var(--ui-border,#f0f0f0);background:\${active ? "var(--brand-primary-soft,#fff1f6)" : "transparent"};cursor:pointer;text-align:left;"><span>\${p.label}</span><span style="opacity:.65;font-size:12px;">\${p.value}</span></button>\`;
    }).join("") +
    '<button type="button" class="ctx-preset-item" data-value="" style="display:block;width:100%;padding:9px 12px;min-height:38px;border:none;background:transparent;cursor:pointer;text-align:left;">手填 / 清空</button>';
  box.querySelectorAll<HTMLButtonElement>(".ctx-preset-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById("context-window-input") as HTMLInputElement | null;
      if (input) input.value = btn.dataset.value || "";
      openContextPresetDropdown(false);
    });
  });
}

function applyContextTokens(tokens: number, blank = false): void {
  const input = document.getElementById("context-window-input") as HTMLInputElement | null;
  if (input) input.value = blank || !tokens ? "" : String(tokens);
}

async function autoResolveModelMeta(_reason: string): Promise<void> {
  const provider = apiState.activeProvider;
  const model = getCurrentModelValue().trim();
  if (!provider || !model) return;
  try {
    const v = await window.settings?.lookupModelContextWindow?.(provider, model);
    if (typeof v === "number" && v > 0) {
      const input = document.getElementById("context-window-input") as HTMLInputElement | null;
      if (!input?.value.trim()) applyContextTokens(v);
    }
  } catch {
    /* ignore */
  }
}

async function fetchModelsForCurrentForm(): Promise<void> {
  const provider = apiState.activeProvider || "";
  const baseUrl = baseUrlInput.value.trim();
  const apiKey = getApiKeyForRequest?.() ?? "";
  if (!baseUrl) {
    showToast("获取失败：请先填写 Base URL", "err", 3500);
    return;
  }
  if (!apiKey && !/ollama|localhost/i.test(provider + baseUrl)) {
    showToast(\`获取失败：请先填写「\${provider || "当前厂商"}」的 API Key\`, "err", 3500);
    return;
  }
  try {
    const fetchModels = window.settings?.fetchProviderModels;
    if (!fetchModels) {
      showToast("获取失败：当前环境不支持", "err");
      return;
    }
    const result = await fetchModels({
      baseUrl,
      apiKey: /ollama|localhost/i.test(provider + baseUrl) && !apiKey ? "ollama" : apiKey,
    });
    if (result.ok && result.models?.length) {
      _providerModelsCache = result.models;
      const search = document.getElementById("provider-model-search") as HTMLInputElement | null;
      if (search) search.value = "";
      openModelDropdown(true);
      renderProviderModelList("");
      const hit = result.models.find((m) => m.id === getCurrentModelValue().trim());
      if (hit?.contextWindow) applyContextTokens(hit.contextWindow);
      showToast(\`获取到 \${result.models.length} 个模型\`, "ok", 2600);
      return;
    }
    _providerModelsCache = [];
    openModelDropdown(false);
    const raw = String(result.error || "未知错误");
    const err = /<html|DOCTYPE|_next/i.test(raw) ? "接口返回网页，请检查 Base URL" : raw.slice(0, 100);
    showToast(\`获取失败：\${err}\`, "err", 4000);
  } catch (e) {
    showToast(\`获取失败：\${String(e).slice(0, 100)}\`, "err", 4000);
  }
}

`;

t = t.slice(0, start) + neu + t.slice(end);

// 4) 重写 bindModelAutoResolve
const b0 = t.indexOf("function bindModelAutoResolve");
const b1 = t.indexOf("bindModelAutoResolve();", b0);
if (b0 < 0 || b1 < 0) {
  console.log("bind markers missing");
  process.exit(1);
}
const bindNeu = `function bindModelAutoResolve(): void {
  if (_modelUiBound) return;
  _modelUiBound = true;

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
  modelInput?.addEventListener("click", () => {
    if (_providerModelsCache.length) toggleModelDropdown();
  });
  document.getElementById("context-preset-toggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextPresetDropdown(!_ctxListOpen);
  });
  document.getElementById("context-window-input")?.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    const n = (el.value || "").replace(/[^0-9]/g, "");
    if (el.value !== n) el.value = n;
    if (_ctxListOpen) renderContextPresetList();
  });
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (_modelListOpen && !target.closest("#provider-model-dropdown") && !target.closest("#model-list-toggle") && !target.closest("#model-input") && !target.closest("#fetch-models-btn")) {
      openModelDropdown(false);
    }
    if (_ctxListOpen && !target.closest("#context-preset-dropdown") && !target.closest("#context-preset-toggle") && !target.closest("#context-window-input")) {
      openContextPresetDropdown(false);
    }
  });
  openModelDropdown(false);
}
`;
t = t.slice(0, b0) + bindNeu + t.slice(b1 + "bindModelAutoResolve();".length);

// 5) applyPreset 末尾保证调用 autoResolve
if (!t.includes('void autoResolveModelMeta("preset");')) {
  t = t.replace(
    "  apiState.activeProvider = preset.providerName;\n  applyMultimodalUI();\n}",
    `  apiState.activeProvider = preset.providerName;
  applyMultimodalUI();
  void autoResolveModelMeta("preset");
}`,
  );
}

// 6) initSettingsPage 确保存在且调用 bind
if (!t.includes("function initSettingsPage")) {
  t = t.replace(
    "if (document.readyState === \"loading\") {",
    `function initSettingsPage(): void {
  try { bindModelAutoResolve(); } catch (e) { console.error("[Settings] bind", e); }
  void initSettingsI18n().then(() => {
    applySettingsI18n();
    switchSection(currentSection);
  });
}

if (document.readyState === "loading") {`,
  );
}

fs.writeFileSync(f, t, "utf8");
const checks = ["function applyPreset", "function editProfile", "function loadConfig", "function getApiKeyForRequest", "function updateEndpointPreview", "function bindModelAutoResolve", "function fetchModelsForCurrentForm", "function initSettingsPage", "function openModelDropdown"];
for (const c of checks) console.log(c, t.includes(c));
console.log("dup cache", (t.match(/let _providerModelsCache/g) || []).length);
console.log("dup autoResolve", (t.match(/async function autoResolveModelMeta/g) || []).length);
console.log("dup bind", (t.match(/function bindModelAutoResolve/g) || []).length);
