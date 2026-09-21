const fs = require("fs");
const dp = "F:/Work/Create/desk_pet/desk-pet";

// ── HTML：模型（输入 + 独立箭头）+ 上下文（标签 + 输入 + 右侧下拉） ──
const htmlPath = dp + "/src/renderer/settings/index.html";
let h = fs.readFileSync(htmlPath, "utf8");

const modelRe = /<label class="field field--full"[\s\S]*?id="fetch-models-btn"[\s\S]*?<\/label>/;
const modelNeu = `<label class="field field--full" style="position:relative;">
              <span data-i18n="api.modelName">模型名</span>
              <div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
                <input id="model-input" type="text" placeholder="选择厂商或获取后选择" autocomplete="off" data-i18n="settings.modelPlaceholderDefault" style="flex:1 1 auto;min-width:160px;min-height:40px;padding:8px 12px;border-radius:10px;border:1px solid var(--ui-input-border,#d2d2d7);background:var(--ui-input-bg,#fff);" />
                <button type="button" id="model-list-toggle" class="btn-secondary" title="展开/收起模型列表" aria-label="展开/收起模型列表" style="min-height:40px;min-width:40px;padding:0 10px;flex:none;">▼</button>
                <button type="button" class="btn-secondary" id="fetch-models-btn" style="min-height:40px;padding:0 14px;white-space:nowrap;flex:none;">获取模型列表</button>
              </div>
              <div id="provider-model-dropdown" style="display:none;position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:80;border:1px solid var(--ui-border,#e5e5ea);border-radius:10px;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,.12);overflow:hidden;">
                <div style="padding:8px;border-bottom:1px solid var(--ui-border,#eee);">
                  <input id="provider-model-search" type="search" placeholder="搜索模型…" style="width:100%;min-height:34px;padding:6px 10px;border-radius:8px;border:1px solid var(--ui-input-border,#d2d2d7);" />
                </div>
                <div id="provider-model-list" style="max-height:220px;overflow:auto;padding:4px;"></div>
              </div>
            </label>`;

const ctxRe = /<label class="field" style="width:100%;">[\s\S]*?context-window-auto-hint[\s\S]*?<\/label>/;
const ctxNeu = `<label class="field" style="width:100%;">
              <div style="display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:nowrap;">
                <span style="white-space:nowrap;font-weight:600;min-width:132px;" data-i18n="api.contextWindow">上下文窗口（Token）</span>
                <input id="context-window-input" type="text" inputmode="numeric" placeholder="可手填 Token" autocomplete="off" style="flex:1 1 auto;min-width:140px;min-height:40px;padding:8px 12px;border-radius:10px;border:1px solid var(--ui-input-border,#d2d2d7);background:var(--ui-input-bg,#fff);" />
                <select id="context-window-k" class="setting-select" title="常用上下文规格" style="flex:0 0 auto;min-width:140px;min-height:40px;">
                  <option value="">空白</option>
                  <option value="8192">8K</option>
                  <option value="32768">32K</option>
                  <option value="65536">64K</option>
                  <option value="131072">128K</option>
                  <option value="200000">200K</option>
                  <option value="262144">256K</option>
                  <option value="524288">512K</option>
                  <option value="1048576">1M</option>
                </select>
              </div>
              <span class="form-hint" id="context-window-auto-hint" style="display:none;"></span>
            </label>`;

if (modelRe.test(h)) { h = h.replace(modelRe, modelNeu); console.log("model html ok"); }
else console.log("model miss");
if (ctxRe.test(h)) { h = h.replace(ctxRe, ctxNeu); console.log("ctx html ok"); }
else console.log("ctx miss");
fs.writeFileSync(htmlPath, h, "utf8");

// ── settings.ts ──
const stPath = dp + "/src/renderer/settings/settings.ts";
let t = fs.readFileSync(stPath, "utf8");

if (!t.includes('from "./shared/toast"')) {
  t = t.replace(
    'import { showModal, showHtmlModal, showInputModal } from "./shared/modal";',
    'import { showModal, showHtmlModal, showInputModal } from "./shared/modal";\nimport { showToast } from "./shared/toast";',
  );
}

// 删掉会重复 toast 的 notifyModelFetch，统一走 showToast
t = t.replace(
  /function notifyModelFetch\([\s\S]*?\n\}\n/,
  "",
);

// 从 openModelDropdown 到 bindModelAutoResolve 整段重写
const s0 = t.indexOf("function openModelDropdown");
const s1 = t.search(/function bindModelAutoResolve/);
if (s0 > 0 && s1 > s0) {
  const neu = `/** 本页会话内缓存的模型列表（退出设置窗即销毁） */
let _providerModelsCache: Array<{ id: string; contextWindow?: number }> = [];
let _modelListOpen = false;

function openModelDropdown(open: boolean): void {
  _modelListOpen = open;
  const drop = document.getElementById("provider-model-dropdown");
  const arrow = document.getElementById("model-list-toggle");
  if (drop) drop.style.display = open ? "block" : "none";
  if (arrow) arrow.textContent = open ? "▲" : "▼";
}

function toggleModelDropdown(): void {
  if (!_providerModelsCache.length) {
    showToast("请先点击「获取模型列表」", "info", 2200);
    return;
  }
  openModelDropdown(!_modelListOpen);
  if (_modelListOpen) {
    renderProviderModelList((document.getElementById("provider-model-search") as HTMLInputElement | null)?.value || "");
  }
}

function renderProviderModelList(filter = ""): void {
  const box = document.getElementById("provider-model-list");
  if (!box) return;
  const q = filter.trim().toLowerCase();
  const list = _providerModelsCache.filter((m) => !q || m.id.toLowerCase().includes(q));
  if (!_providerModelsCache.length) {
    openModelDropdown(false);
    box.innerHTML = "";
    return;
  }
  const current = getCurrentModelValue().trim();
  if (!list.length) {
    box.innerHTML = '<div style="padding:10px;color:#888;font-size:13px;">无匹配模型</div>';
    return;
  }
  box.innerHTML = list
    .map((m) => {
      const active = m.id === current;
      return \`<button type="button" class="provider-model-item" data-id="\${m.id}" data-ctx="\${m.contextWindow || ""}" style="display:flex;width:100%;justify-content:space-between;align-items:center;text-align:left;margin:2px 0;padding:9px 10px;min-height:38px;border:1px solid \${active ? "var(--brand-primary,#ff5b8a)" : "transparent"};border-radius:8px;background:\${active ? "var(--brand-primary-soft,#fff1f6)" : "transparent"};cursor:pointer;">
        <span>\${m.id}</span>
        <span style="font-size:12px;opacity:.7;">\${m.contextWindow ? Math.round(m.contextWindow / 1000) + "K" : ""}</span>
      </button>\`;
    })
    .join("");
  box.querySelectorAll<HTMLButtonElement>(".provider-model-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id || "";
      if (!id) return;
      modelInput.value = id;
      const ctx = btn.dataset.ctx;
      if (ctx && Number(ctx) > 0) {
        applyContextTokens(Number(ctx), false);
      } else {
        void autoResolveModelMeta("select");
      }
      openModelDropdown(false);
    });
  });
}

/** tokens=0 或 blank=true → 输入框清空、下拉空白 */
function applyContextTokens(tokens: number, blank = false): void {
  const input = document.getElementById("context-window-input") as HTMLInputElement | null;
  const sel = document.getElementById("context-window-k") as HTMLSelectElement | null;
  if (blank || !tokens) {
    if (input) input.value = "";
    if (sel) sel.value = "";
    return;
  }
  if (input) input.value = String(tokens);
  if (sel) {
    const matched = Array.from(sel.options).some((o) => o.value === String(tokens));
    sel.value = matched ? String(tokens) : "";
  }
}

/** 只弹一条 Toast */
function toastModels(msg: string, type: "ok" | "err" | "info"): void {
  showToast(msg, type, type === "err" ? 4000 : 2600);
}

async function fetchModelsForCurrentForm(): Promise<void> {
  const provider = apiState.activeProvider || "";
  const baseUrl = baseUrlInput.value.trim();
  const apiKey = getApiKeyForRequest?.() ?? "";
  if (!baseUrl) {
    toastModels("获取失败：请先填写 Base URL", "err");
    return;
  }
  if (!apiKey && !/ollama|localhost/i.test(provider + baseUrl)) {
    toastModels(\`获取失败：请先填写「\${provider || "当前厂商"}」的 API Key\`, "err");
    return;
  }
  try {
    const fetchModels = window.settings?.fetchProviderModels;
    if (!fetchModels) {
      toastModels("获取失败：当前环境不支持", "err");
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
      const current = getCurrentModelValue().trim();
      const hit = result.models.find((m) => m.id === current);
      if (hit?.contextWindow) applyContextTokens(hit.contextWindow, false);
      toastModels(\`获取到 \${result.models.length} 个模型\`, "ok");
      return;
    }
    _providerModelsCache = [];
    openModelDropdown(false);
    const raw = String(result.error || "未知错误");
    const err = /<html|DOCTYPE|_next/i.test(raw) ? "接口返回网页，请检查 Base URL" : raw.slice(0, 100);
    toastModels(\`获取失败：\${err}\`, "err");
  } catch (e) {
    toastModels(\`获取失败：\${String(e).slice(0, 100)}\`, "err");
  }
}

`;
  t = t.slice(0, s0) + neu + t.slice(s1);
  console.log("core rewritten");
}

const b0 = t.indexOf("function bindModelAutoResolve");
const b1 = t.indexOf("bindModelAutoResolve();", b0);
if (b0 > 0 && b1 > b0) {
  const bindNeu = `function bindModelAutoResolve(): void {
  modelInput?.addEventListener("change", () => void autoResolveModelMeta("input"));
  modelInput?.addEventListener("blur", () => void autoResolveModelMeta("select"));

  document.getElementById("fetch-models-btn")?.addEventListener("click", () => {
    void fetchModelsForCurrentForm();
  });
  // 箭头与输入框分开：点箭头收起/展开（有缓存才展开）
  document.getElementById("model-list-toggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleModelDropdown();
  });
  document.getElementById("provider-model-search")?.addEventListener("input", (e) => {
    renderProviderModelList((e.target as HTMLInputElement).value);
  });
  // 点模型名输入框：若有缓存则切换展开
  modelInput?.addEventListener("click", (e) => {
    if (_providerModelsCache.length) {
      e.preventDefault();
      toggleModelDropdown();
    }
  });

  document.addEventListener("click", (e) => {
    if (!_modelListOpen) return;
    const target = e.target as HTMLElement;
    if (target.closest("#provider-model-dropdown") || target.closest("#model-list-toggle") || target.closest("#model-input") || target.closest("#fetch-models-btn")) {
      return;
    }
    openModelDropdown(false);
  });

  // 上下文：右侧下拉；手填后下拉清空
  const kSelect = document.getElementById("context-window-k") as HTMLSelectElement | null;
  const ctxInput = document.getElementById("context-window-input") as HTMLInputElement | null;
  kSelect?.addEventListener("change", () => {
    const v = kSelect.value;
    if (!v) {
      if (ctxInput && document.activeElement !== ctxInput) {
        /* 空白：保持输入框现值，仅表示未锁定规格 */
      }
      return;
    }
    applyContextTokens(Number(v), false);
    void autoResolveModelMeta("select");
  });
  ctxInput?.addEventListener("input", () => {
    const n = (ctxInput.value || "").replace(/[^0-9]/g, "");
    if (ctxInput.value !== n) ctxInput.value = n;
    // 手动填写 → 右侧下拉变空白
    if (kSelect) kSelect.value = "";
  });
}
bindModelAutoResolve();
`;
  t = t.slice(0, b0) + bindNeu + t.slice(b1 + "bindModelAutoResolve();".length);
  console.log("bind rewritten");
}

// autoResolve 填上下文时不强制改下拉空白逻辑
t = t.replace(
  /function applyContextTokens[\s\S]*?\n\}/,
  `function applyContextTokens(tokens: number, blank = false): void {
  const input = document.getElementById("context-window-input") as HTMLInputElement | null;
  const sel = document.getElementById("context-window-k") as HTMLSelectElement | null;
  if (blank || !tokens) {
    if (input) input.value = "";
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

// initSettingsPage 已 bind
if (!t.includes("bindModelAutoResolve(); // idempotent")) {
  t = t.replace(
    "function initSettingsPage(): void {",
    `function initSettingsPage(): void {
  try { bindModelAutoResolve(); } catch (e) { console.error("[Settings] bind", e); } // idempotent
`,
  );
}

fs.writeFileSync(stPath, t, "utf8");
console.log("done");
console.log("has toggle btn", fs.readFileSync(htmlPath, "utf8").includes("model-list-toggle"));
console.log("has single toast fn", t.includes("function toastModels"));
