const fs = require("fs");
const dp = "F:/Work/Create/desk_pet/desk-pet";

// ── HTML：模型行 + 上下文行布局 ──
const htmlPath = dp + "/src/renderer/settings/index.html";
let h = fs.readFileSync(htmlPath, "utf8");

// 模型行：去掉 datalist 原生列表样式干扰；去掉行下长提示位
h = h.replace(
  /<label class="field field--full">[\s\S]*?id="model-fetch-status"[\s\S]*?<\/label>/,
  `<label class="field field--full">
              <span data-i18n="api.modelName">模型名</span>
              <div class="model-row" style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
                <input id="model-input" type="text" placeholder="选择厂商后自动填入，可手填" autocomplete="off" data-i18n="settings.modelPlaceholderDefault" style="flex:1 1 240px;min-width:200px;min-height:40px;padding:8px 12px;border-radius:10px;border:1px solid var(--ui-input-border,#d2d2d7);background:var(--ui-input-bg,#fff);" />
                <button type="button" class="btn-secondary" id="fetch-models-btn" style="min-height:40px;padding:0 16px;white-space:nowrap;">获取模型列表</button>
              </div>
              <!-- 自定义模型下拉（不用原生 datalist） -->
              <div id="provider-model-dropdown" class="provider-model-dropdown" style="display:none;margin-top:8px;border:1px solid var(--ui-border,#e5e5ea);border-radius:12px;background:#fff;box-shadow:0 4px 16px rgba(0,0,0,.06);overflow:hidden;">
                <div style="padding:8px 10px;border-bottom:1px solid var(--ui-border,#eee);">
                  <input id="provider-model-search" type="search" placeholder="搜索模型…" style="width:100%;min-height:36px;padding:6px 10px;border-radius:8px;border:1px solid var(--ui-input-border,#d2d2d7);" />
                </div>
                <div id="provider-model-list" style="max-height:240px;overflow:auto;padding:6px;"></div>
              </div>
              <input id="model-input-suggestions" type="hidden" />
            </label>`,
);

// 上下文行：提示右移；下拉加宽
h = h.replace(
  /<label class="field">[\s\S]*?api\.contextWindowHint">[^<]*<\/span>\s*<\/label>/,
  `<label class="field" style="width:100%;">
              <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:4px;width:100%;">
                <span data-i18n="api.contextWindow" style="white-space:nowrap;font-weight:600;">上下文窗口（Token）</span>
                <select id="context-window-preset" class="setting-select" style="flex:0 1 320px;min-width:260px;max-width:100%;min-height:40px;">
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
                <input id="context-window-input" type="number" min="4096" step="1" placeholder="131072" autocomplete="off" style="flex:0 0 140px;width:140px;min-height:40px;" />
                <span class="form-hint" data-i18n="api.contextWindowHint" style="flex:1 1 220px;min-width:160px;text-align:right;margin:0;">单位 Token。可手填；选模型后自动带出。</span>
              </div>
              <span class="form-hint" id="context-window-auto-hint" style="display:none;"></span>
            </label>`,
);

fs.writeFileSync(htmlPath, h, "utf8");
console.log("html model/context ok", h.includes("fetch-models-btn"), h.includes("text-align:right"));

// ── settings.ts：获取结果用弹窗，不用表单内长绿字 ──
const stPath = dp + "/src/renderer/settings/settings.ts";
let t = fs.readFileSync(stPath, "utf8");

// hide context-window-auto-hint usage via toast instead
t = t.replace(
  /function setModelAutoHint\(text: string, tone\?: "ok" \| "err"\): void \{[\s\S]*?\n\}/,
  `function setModelAutoHint(text: string, tone?: "ok" | "err"): void {
  // 不在表单内展示长文案；仅作调试/无障碍备忘，视觉上不占位
  const meta = document.getElementById("context-window-auto-hint");
  if (meta) {
    meta.textContent = text;
    meta.style.display = "none";
  }
  void tone;
}

/** 获取模型：弹窗提示，不占用表单 */
function notifyModelFetch(title: string, body: string): void {
  try {
    void showHtmlModal({
      title,
      icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      htmlBody: \`<div style="font-size:14px;line-height:1.7;">\${body}</div>\`,
    });
  } catch {
    window.alert(\\\`\\\${title}\\\\n\\\\n\\\${body}\\\`);
  }
}

function setModelFetchStatus(text: string, tone?: "ok" | "err"): void {
  const n = document.getElementById("model-fetch-status");
  if (n) {
    n.textContent = "";
    n.style.display = "none";
  }
  void text;
  void tone;
}`,
);

// Replace fetchModelsForCurrentForm result handling to use notifyModelFetch
const fetchStart = t.indexOf("async function fetchModelsForCurrentForm");
const fetchEnd = t.indexOf("function bindModelAutoResolve");
if (fetchStart > 0 && fetchEnd > fetchStart) {
  const neu = `async function fetchModelsForCurrentForm(): Promise<void> {
  const provider = apiState.activeProvider || "";
  const baseUrl = baseUrlInput.value.trim();
  const apiKey = getApiKeyForRequest?.() ?? "";
  const host = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl || "";
    }
  })();
  if (!baseUrl) {
    notifyModelFetch("获取模型列表", "请先填写 Base URL。<br/>例如 StepFun：<code>https://api.stepfun.com/v1</code>");
    return;
  }
  if (!apiKey && !/ollama|localhost/i.test(provider + baseUrl)) {
    notifyModelFetch("获取模型列表", \`请先填写「\${provider || "当前厂商"}」的 API Key（需与 \${host} 匹配）。\`);
    return;
  }
  try {
    const fetchModels = window.settings?.fetchProviderModels;
    if (!fetchModels) {
      notifyModelFetch("获取模型列表", "当前环境不支持获取模型列表。");
      return;
    }
    const result = await fetchModels({
      baseUrl,
      apiKey: /ollama|localhost/i.test(provider + baseUrl) && !apiKey ? "ollama" : apiKey,
    });
    if (result.ok && result.models?.length) {
      _providerModelsCache = result.models;
      const current = getCurrentModelValue().trim();
      const hit = result.models.find((m) => m.id === current);
      if (hit?.contextWindow) {
        contextWindowInput.value = String(hit.contextWindow);
      } else if (!contextWindowInput.value.trim() || contextWindowInput.value === "256000") {
        // 保持当前值或留给用户选
      }
      const search = document.getElementById("provider-model-search") as HTMLInputElement | null;
      if (search) search.value = "";
      renderProviderModelList("");
      notifyModelFetch(
        "获取模型列表",
        \`已获取 <strong>\${result.models.length}</strong> 个模型。\${current ? \`当前「\${current}」\${hit ? "已在列表中" : "不在列表中，请在下拉中选择"}。\` : "请在下拉中选择模型。"}\`,
      );
      return;
    }
    _providerModelsCache = [];
    renderProviderModelList("");
    const raw = String(result.error || "获取失败");
    const err = /<html|DOCTYPE|_next/i.test(raw)
      ? "接口返回网页而非模型数据。请检查 Base URL（StepFun 应为 https://api.stepfun.com/v1）。"
      : raw.slice(0, 200);
    notifyModelFetch("获取模型列表失败", err);
  } catch (e) {
    notifyModelFetch("获取模型列表失败", String(e).slice(0, 200));
  }
}

`;
  t = t.slice(0, fetchStart) + neu + t.slice(fetchEnd);
  console.log("fetchModels rewritten");
}

// custom dropdown item styles
t = t.replace(
  /box\.innerHTML = list\s*\.map\([\s\S]*?\)\s*\.join\(""\);/,
  `box.innerHTML = list
    .map((m) => {
      const active = m.id === current;
      const ctx = m.contextWindow ? \` · \${Math.round(m.contextWindow / 1000)}K\` : "";
      return \`<button type="button" class="provider-model-item" data-id="\${m.id}" data-ctx="\${m.contextWindow || ""}" style="display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;text-align:left;margin:2px 0;padding:10px 12px;min-height:40px;border:1px solid \${active ? "var(--brand-primary,#ff5b8a)" : "var(--ui-border,#e5e5ea)"};border-radius:10px;background:\${active ? "var(--brand-primary-soft,#fff1f6)" : "#fff"};cursor:pointer;">
        <span style="font-weight:\${active ? 700 : 500};">\${m.id}</span>
        <span style="font-size:12px;opacity:.75;">\${ctx || "—"}</span>
      </button>\`;
    })
    .join("");`,
);

fs.writeFileSync(stPath, t, "utf8");
console.log("settings patched", t.includes("notifyModelFetch"));
