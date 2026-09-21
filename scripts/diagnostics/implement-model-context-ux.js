const fs = require("fs");
const dp = "F:/Work/Create/desk_pet/desk-pet";

// ── HTML ──
const htmlPath = dp + "/src/renderer/settings/index.html";
let h = fs.readFileSync(htmlPath, "utf8");

// 模型名：相对定位容器 + 获取按钮 + 贴框下拉
const modelRe = /<label class="field field--full">[\s\S]*?id="provider-model-list"[\s\S]*?<\/label>/;
const modelNeu = `<label class="field field--full" style="position:relative;">
              <span data-i18n="api.modelName">模型名</span>
              <div style="display:flex;gap:8px;align-items:center;margin-top:6px;position:relative;">
                <div style="position:relative;flex:1 1 240px;min-width:200px;">
                  <input id="model-input" type="text" placeholder="选择厂商或点击右侧获取后选择" autocomplete="off" data-i18n="settings.modelPlaceholderDefault" style="width:100%;min-height:40px;padding:8px 36px 8px 12px;border-radius:10px;border:1px solid var(--ui-input-border,#d2d2d7);background:var(--ui-input-bg,#fff);" />
                  <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:.55;font-size:12px;">▼</span>
                  <!-- 贴着模型名框展开的可搜索下拉 -->
                  <div id="provider-model-dropdown" style="display:none;position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:80;border:1px solid var(--ui-border,#e5e5ea);border-radius:10px;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,.12);overflow:hidden;">
                    <div style="padding:8px;border-bottom:1px solid var(--ui-border,#eee);">
                      <input id="provider-model-search" type="search" placeholder="搜索模型…" style="width:100%;min-height:34px;padding:6px 10px;border-radius:8px;border:1px solid var(--ui-input-border,#d2d2d7);" />
                    </div>
                    <div id="provider-model-list" style="max-height:220px;overflow:auto;padding:4px;"></div>
                  </div>
                </div>
                <button type="button" class="btn-secondary" id="fetch-models-btn" style="min-height:40px;padding:0 16px;white-space:nowrap;flex:none;">获取模型列表</button>
              </div>
            </label>`;

if (modelRe.test(h)) {
  h = h.replace(modelRe, modelNeu);
  console.log("model combobox html ok");
} else console.log("model html miss");

// 上下文：短标签下拉 + 可手填（无 spinner、无 ≈）
const ctxRe = /<label class="field" style="width:100%;">[\s\S]*?context-window-auto-hint[\s\S]*?<\/label>/;
const ctxNeu = `<label class="field" style="width:100%;">
              <div style="display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap;">
                <span style="white-space:nowrap;font-weight:600;min-width:140px;" data-i18n="api.contextWindow">上下文窗口（Token）</span>
                <select id="context-window-k" class="setting-select" style="min-width:150px;min-height:40px;">
                  <option value="">空白（手填）</option>
                  <option value="8192">8K</option>
                  <option value="32768">32K</option>
                  <option value="65536">64K</option>
                  <option value="131072">128K</option>
                  <option value="200000">200K</option>
                  <option value="262144">256K</option>
                  <option value="524288">512K</option>
                  <option value="1048576">1M</option>
                </select>
                <input id="context-window-input" type="text" inputmode="numeric" placeholder="Token 数值（可手填）" autocomplete="off" style="flex:1 1 160px;min-width:140px;min-height:40px;padding:8px 12px;border-radius:10px;border:1px solid var(--ui-input-border,#d2d2d7);background:var(--ui-input-bg,#fff);" />
              </div>
              <span class="form-hint" id="context-window-auto-hint" style="display:none;"></span>
            </label>`;
if (ctxRe.test(h)) {
  h = h.replace(ctxRe, ctxNeu);
  console.log("context html ok");
} else console.log("context html miss");

fs.writeFileSync(htmlPath, h, "utf8");

// ── settings.ts ──
const stPath = dp + "/src/renderer/settings/settings.ts";
let t = fs.readFileSync(stPath, "utf8");

// import toast
if (!t.includes('from "./shared/toast"')) {
  t = t.replace(
    'import { showModal, showHtmlModal, showInputModal } from "./shared/modal";',
    'import { showModal, showHtmlModal, showInputModal } from "./shared/modal";\nimport { showToast } from "./shared/toast";',
  );
}

// notifyModelFetch → toast
t = t.replace(
  /function notifyModelFetch\(title: string, body: string\): void \{[\s\S]*?\n\}/,
  `function notifyModelFetch(title: string, body: string): void {
  const msg = body.replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim();
  const isFail = /失败|error|404|401/i.test(title + body);
  showToast(\`\${title.replace("获取模型列表失败", "获取失败")}: \${msg}\`.slice(0, 160), isFail ? "err" : "ok");
}`,
);

// fetchModelsForCurrentForm: toast 数量
t = t.replace(
  /notifyModelFetch\(\s*"获取模型列表",\s*`已获取 <strong>\$\{result\.models\.length\}<\/strong> 个模型。[\s\S]*?`,\s*\);/,
  `showToast(\`获取到 \${result.models.length} 个模型\`, "ok");`,
);
t = t.replace(
  /notifyModelFetch\("获取模型列表失败", err\);/,
  `showToast(\`获取失败：\${err}\`, "err", 4000);`,
);
t = t.replace(
  /notifyModelFetch\("获取模型列表失败", String\(e\)\.slice\(0, 200\)\);/,
  `showToast(\`获取失败：\${String(e).slice(0, 100)}\`, "err", 4000);`,
);
t = t.replace(
  /notifyModelFetch\("获取模型列表", "请先填写 Base URL。[\s\S]*?\);/,
  `showToast("获取失败：请先填写 Base URL（如 https://api.stepfun.com/v1）", "err", 3500);`,
);
t = t.replace(
  /notifyModelFetch\("获取模型列表", `请先填写「\$\{provider \|\| "当前厂商"\}」的 API Key（需与 \$\{host\} 匹配）.`\);/,
  `showToast(\`获取失败：请先填写「\${provider || "当前厂商"}」的 API Key\`, "err", 3500);`,
);

// dropdown open/close helpers + rewrite render + bind
const rStart = t.indexOf("/** 可搜索模型下拉");
const rEnd = t.indexOf("function updateContextUnitHint");
if (rStart < 0) {
  console.log("render block not found - try function renderProviderModelList");
}
const start = t.indexOf("function renderProviderModelList") > 0 ? t.indexOf("/** 可搜索模型下拉") >= 0 ? t.indexOf("/** 可搜索模型下拉") : t.indexOf("function renderProviderModelList") : t.indexOf("function renderProviderModelList");
const end = t.indexOf("function bindModelAutoResolve");
if (start > 0 && end > start) {
  const neu = `let _providerModelsCache: Array<{ id: string; contextWindow?: number }> = [];

function openModelDropdown(open: boolean): void {
  const drop = document.getElementById("provider-model-dropdown");
  if (drop) drop.style.display = open ? "block" : "none";
}

function renderProviderModelList(filter = ""): void {
  const box = document.getElementById("provider-model-list");
  const drop = document.getElementById("provider-model-dropdown");
  if (!box || !drop) return;
  const q = filter.trim().toLowerCase();
  const list = _providerModelsCache.filter((m) => !q || m.id.toLowerCase().includes(q));
  if (!_providerModelsCache.length) {
    openModelDropdown(false);
    box.innerHTML = "";
    return;
  }
  openModelDropdown(true);
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
        applyContextTokens(Number(ctx));
      } else {
        void autoResolveModelMeta("select");
      }
      openModelDropdown(false);
      showToast(\`已选择模型 \${id}\`, "ok", 2000);
    });
  });
}

/** 写入上下文 Token，并同步短标签下拉 */
function applyContextTokens(tokens: number): void {
  const input = document.getElementById("context-window-input") as HTMLInputElement | null;
  const sel = document.getElementById("context-window-k") as HTMLSelectElement | null;
  if (input) input.value = String(tokens);
  if (sel) {
    const matched = Array.from(sel.options).some((o) => o.value === String(tokens));
    sel.value = matched ? String(tokens) : "";
  }
}

async function fetchModelsForCurrentForm(): Promise<void> {
  const provider = apiState.activeProvider || "";
  const baseUrl = baseUrlInput.value.trim();
  const apiKey = getApiKeyForRequest?.() ?? "";
  if (!baseUrl) {
    showToast("获取失败：请先填写 Base URL（如 https://api.stepfun.com/v1）", "err", 3500);
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
    showToast("正在获取模型列表…", "info", 2000);
    const result = await fetchModels({
      baseUrl,
      apiKey: /ollama|localhost/i.test(provider + baseUrl) && !apiKey ? "ollama" : apiKey,
    });
    if (result.ok && result.models?.length) {
      _providerModelsCache = result.models;
      const search = document.getElementById("provider-model-search") as HTMLInputElement | null;
      if (search) search.value = "";
      renderProviderModelList("");
      const current = getCurrentModelValue().trim();
      const hit = result.models.find((m) => m.id === current);
      if (hit?.contextWindow) applyContextTokens(hit.contextWindow);
      showToast(\`获取到 \${result.models.length} 个模型\`, "ok", 2800);
      return;
    }
    _providerModelsCache = [];
    openModelDropdown(false);
    const raw = String(result.error || "未知错误");
    const err = /<html|DOCTYPE|_next/i.test(raw)
      ? "接口返回网页，请检查 Base URL"
      : raw.slice(0, 100);
    showToast(\`获取失败：\${err}\`, "err", 4000);
  } catch (e) {
    showToast(\`获取失败：\${String(e).slice(0, 100)}\`, "err", 4000);
  }
}

`;
  t = t.slice(0, start) + neu + t.slice(end);
  console.log("model dropdown + fetch rewritten");
}

// bindModelAutoResolve rewrite
const bStart = t.indexOf("function bindModelAutoResolve");
const bEnd = t.indexOf("bindModelAutoResolve();");
if (bStart > 0 && bEnd > bStart) {
  const bindNeu = `function bindModelAutoResolve(): void {
  modelInput?.addEventListener("change", () => void autoResolveModelMeta("input"));
  modelInput?.addEventListener("blur", () => void autoResolveModelMeta("select"));

  document.getElementById("fetch-models-btn")?.addEventListener("click", () => {
    void fetchModelsForCurrentForm();
  });
  document.getElementById("provider-model-search")?.addEventListener("input", (e) => {
    renderProviderModelList((e.target as HTMLInputElement).value);
  });

  // 点击模型框以外 → 收起下拉
  document.addEventListener("click", (e) => {
    const drop = document.getElementById("provider-model-dropdown");
    if (!drop || drop.style.display === "none") return;
    const target = e.target as HTMLElement;
    if (target.closest("#provider-model-dropdown") || target.closest("#fetch-models-btn") || target.closest("#model-input")) {
      return;
    }
    openModelDropdown(false);
  });

  // 上下文：短标签下拉 ↔ 数值框
  const kSelect = document.getElementById("context-window-k") as HTMLSelectElement | null;
  const ctxInput = document.getElementById("context-window-input") as HTMLInputElement | null;
  kSelect?.addEventListener("change", () => {
    const v = kSelect.value;
    if (!v) {
      if (ctxInput) {
        ctxInput.value = "";
        ctxInput.focus();
      }
      return;
    }
    if (ctxInput) ctxInput.value = v;
    void autoResolveModelMeta("select");
  });
  ctxInput?.addEventListener("input", () => {
    const n = ctxInput.value.replace(/[^0-9]/g, "");
    if (ctxInput.value !== n) ctxInput.value = n;
    if (kSelect) {
      const matched = Array.from(kSelect.options).some((o) => o.value === n);
      kSelect.value = matched ? n : "";
    }
  });
}
bindModelAutoResolve();
`;
  t = t.slice(0, bStart) + bindNeu + t.slice(bEnd + "bindModelAutoResolve();".length);
  console.log("bind rewritten");
}

// autoResolve applyContextTokens
t = t.replace(
  /contextWindowInput\.value = String\(v\);\s*updateContextUnitHint\(\);/,
  "applyContextTokens(v);",
);
t = t.replace(
  /contextWindowInput\.value = String\(v\);\s*const presetSelect[\s\S]*?__custom__";\s*\}/,
  "applyContextTokens(v);",
);

// initSettingsPage call bind
if (!t.includes("bindModelAutoResolve(); // idempotent")) {
  t = t.replace(
    "function initSettingsPage(): void {",
    `function initSettingsPage(): void {
  try { bindModelAutoResolve(); } catch (e) { console.error("[Settings] bind", e); } // idempotent
`,
  );
}

fs.writeFileSync(stPath, t, "utf8");
console.log("toast import", t.includes('from "./shared/toast"'));
console.log("openModelDropdown", t.includes("function openModelDropdown"));
console.log("bind calls", (t.match(/bindModelAutoResolve\(\)/g) || []).length);
