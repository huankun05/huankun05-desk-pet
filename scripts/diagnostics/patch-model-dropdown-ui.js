const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");

// Replace renderProviderModelPicker to new dropdown list
const startFn = t.indexOf("function renderProviderModelPicker");
const endFn = t.indexOf("/** 设置页底部提示");
if (startFn > 0 && endFn > startFn) {
  const neu = `/** 可搜索模型下拉（获取模型列表后展开） */
let _providerModelsCache: Array<{ id: string; contextWindow?: number }> = [];

function renderProviderModelList(filter = ""): void {
  const box = document.getElementById("provider-model-list");
  const drop = document.getElementById("provider-model-dropdown");
  if (!box || !drop) return;
  const q = filter.trim().toLowerCase();
  const list = _providerModelsCache.filter((m) => !q || m.id.toLowerCase().includes(q));
  if (!_providerModelsCache.length) {
    drop.style.display = "none";
    box.innerHTML = "";
    return;
  }
  drop.style.display = "block";
  const current = getCurrentModelValue().trim();
  if (!list.length) {
    box.innerHTML = '<div class="form-hint">无匹配模型</div>';
    return;
  }
  box.innerHTML = list
    .map((m) => {
      const active = m.id === current ? "font-weight:700;background:var(--brand-primary-soft,#fff1f6);" : "";
      const ctx = m.contextWindow ? \` · \${Math.round(m.contextWindow / 1000)}K\` : "";
      return \`<button type="button" class="provider-model-item" data-id="\${m.id}" data-ctx="\${m.contextWindow || ""}" style="display:block;width:100%;text-align:left;margin:2px 0;padding:8px 10px;min-height:34px;border:1px solid var(--ui-border,#e5e5ea);border-radius:8px;background:#fff;cursor:pointer;\${active}">\${m.id}<span style="opacity:.7;font-size:12px;">\${ctx}</span></button>\`;
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
        const presetSelect = document.getElementById("context-window-preset") as HTMLSelectElement | null;
        if (presetSelect) {
          const matched = Array.from(presetSelect.options).some((o) => o.value === String(ctx));
          presetSelect.value = matched ? String(ctx) : "__custom__";
        }
        setModelAutoHint(\`已选择 \${id} · 上下文 \${ctx} tokens（约 \${Math.round(Number(ctx) / 1000)}K）\`, "ok");
      } else {
        setModelAutoHint(\`已选择 \${id}\`, "ok");
        void autoResolveModelMeta("select");
      }
      renderProviderModelList((document.getElementById("provider-model-search") as HTMLInputElement)?.value || "");
    });
  });
}

function setModelFetchStatus(text: string, tone?: "ok" | "err"): void {
  const n = document.getElementById("model-fetch-status");
  if (!n) return;
  n.textContent = text;
  n.style.color = tone === "err" ? "#a63a49" : tone === "ok" ? "#0b6b5c" : "";
}

async function fetchModelsForCurrentForm(): Promise<void> {
  const provider = apiState.activeProvider || "";
  const baseUrl = baseUrlInput.value.trim();
  const apiKey = getApiKeyForRequest?.() ?? "";
  const host = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl || "—";
    }
  })();
  if (!baseUrl) {
    setModelFetchStatus("请先填写 Base URL（如 https://api.stepfun.com/v1）", "err");
    return;
  }
  if (!apiKey && !/ollama|localhost/i.test(provider + baseUrl)) {
    setModelFetchStatus(\`请先填写「\${provider || "当前厂商"}」的 API Key（须匹配 \${host}）\`, "err");
    return;
  }
  setModelFetchStatus(\`正在从 \${provider || host}（\${host}）获取模型列表…\`);
  try {
    const fetchModels = window.settings?.fetchProviderModels;
    if (!fetchModels) {
      setModelFetchStatus("当前环境不支持获取模型列表", "err");
      return;
    }
    const result = await fetchModels({
      baseUrl,
      apiKey: /ollama|localhost/i.test(provider + baseUrl) && !apiKey ? "ollama" : apiKey,
    });
    if (result.ok && result.models?.length) {
      _providerModelsCache = result.models;
      modelInputSuggestions.replaceChildren();
      for (const m of result.models) {
        const option = document.createElement("option");
        option.value = m.id;
        modelInputSuggestions.appendChild(option);
      }
      const search = document.getElementById("provider-model-search") as HTMLInputElement | null;
      if (search) search.value = "";
      renderProviderModelList("");
      const current = getCurrentModelValue().trim();
      const hit = result.models.find((m) => m.id === current);
      if (hit?.contextWindow) {
        contextWindowInput.value = String(hit.contextWindow);
        setModelFetchStatus(\`获取成功：\${result.models.length} 个模型 · 当前 \${current} 上下文 \${hit.contextWindow}\`, "ok");
      } else {
        setModelFetchStatus(
          \`获取成功：\${result.models.length} 个模型 · 请在下方列表选择「\${current || "所需型号"}」\`,
          "ok",
        );
      }
      return;
    }
    _providerModelsCache = [];
    renderProviderModelList("");
    const err = String(result.error || "获取失败");
    // 绝不展示 HTML 全文
    const short = /<html|DOCTYPE|_next/i.test(err)
      ? "接口返回网页而非模型数据，请检查 Base URL（StepFun 应为 https://api.stepfun.com/v1）"
      : err.slice(0, 160);
    setModelFetchStatus(\`获取失败：\${short}\`, "err");
  } catch (e) {
    setModelFetchStatus(\`获取失败：\${String(e).slice(0, 120)}\`, "err");
  }
}

`;
  t = t.slice(0, startFn) + neu + t.slice(endFn);
  console.log("picker replaced");
}

// Simplify autoResolve success to not use old renderProviderModelPicker
t = t.replace(/renderProviderModelPicker\(/g, "renderProviderModelList(");
// remove auto-open list from autoResolve - only fetch button opens
t = t.replace(
  /      renderProviderModelList\(result\.models[^\)]*\);/g,
  "      _providerModelsCache = result.models;",
);

// bind fetch button
if (!t.includes("fetch-models-btn")) {
  t = t.replace(
    `  contextWindowInput?.addEventListener("change", () => {
    syncPresetFromValue(contextWindowInput.value);
  });
}`,
    `  contextWindowInput?.addEventListener("change", () => {
    syncPresetFromValue(contextWindowInput.value);
  });

  document.getElementById("fetch-models-btn")?.addEventListener("click", () => {
    void fetchModelsForCurrentForm();
  });
  document.getElementById("provider-model-search")?.addEventListener("input", (e) => {
    renderProviderModelList((e.target as HTMLInputElement).value);
  });
}`,
  );
  console.log("fetch btn bound");
}

// clean autoResolve messages that dump html
t = t.replace(/tOr\("settings\.autoMetaFetchFailed"[^)]+\)[\s\S]{0,80}errText\.slice\(0, 120\)/g,
  'tOr("settings.autoMetaFetchFailed", "服务商接口获取失败，请手动填写模型/上下文")');

fs.writeFileSync(f, t, "utf8");
console.log("done", t.includes("fetchModelsForCurrentForm"), t.includes("fetch-models-btn"));
