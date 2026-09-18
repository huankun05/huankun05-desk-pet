const fs = require("fs");
const dp = "F:/Work/Create/desk_pet/desk-pet";

// ── 1) 合并备份入口：侧栏只保留「存储与备份」，去掉独立「备份管理」 ──
const htmlPath = dp + "/src/renderer/settings/index.html";
let html = fs.readFileSync(htmlPath, "utf8");
html = html.replace(
  /\s*<button type="button" class="nav-item" data-section="backup">[\s\S]*?<\/button>/,
  "",
);
// 备份面板改为 storage 的附属：不单独占 nav；保留 panel DOM 供脚本
html = html.replace(
  'id="backup-panel" data-panel="backup"',
  'id="backup-panel" data-panel="backup" hidden',
);
if (!html.includes("storage-nav-note")) {
  html = html.replace(
    "<h1>存储与备份</h1>",
    '<h1>存储与备份</h1>\n              <p class="settings-section__hint">数据目录、缓存清理与备份统一在此，不再另设「备份管理」页。</p>',
  );
}
fs.writeFileSync(htmlPath, html, "utf8");
console.log("html nav backup merged");

// ── 2) settings.ts：NAV 与 switchSection ──
const stPath = dp + "/src/renderer/settings/settings.ts";
let st = fs.readFileSync(stPath, "utf8");

// NAV_LABELS: backup 保留但可不出现在 nav；补 tokens/disclaimer 标题兜底
if (!st.includes("title: t(\"nav.tokens\")")) {
  // already may exist
}
// remove backup from placeholder checks is fine
// add music if missing
if (!st.includes("music: { emoji:")) {
  st = st.replace(
    "  storage: {",
    '  music: { emoji: "🎵", title: "音乐", hint: "音乐与氛围音" },\n  storage: {',
  );
}

// ── 3) 自动获取模型 / 上下文 ──
const autoBlock = `
/** 设置页底部提示：模型/上下文自动获取状态 */
function setModelAutoHint(text: string, tone?: "ok" | "err"): void {
  const meta = document.getElementById("context-window-auto-hint");
  if (!meta) return;
  meta.textContent = text;
  meta.style.color = tone === "err" ? "#a63a49" : tone === "ok" ? "#0b6b5c" : "";
}

/**
 * 选择/填写模型后自动处理：
 * 1) 本地目录查上下文窗口（有则填，失败提示）
 * 2) 若已配置 Base URL + API Key，尝试服务商 /v1/models 刷新列表并校验
 */
async function autoResolveModelMeta(reason: "select" | "input" | "preset" | "test"): Promise<void> {
  const provider = apiState.activeProvider;
  const model = getCurrentModelValue().trim();
  const baseUrl = baseUrlInput.value.trim();
  const apiKey = getApiKeyForRequest?.() ?? "";
  if (!provider || !model) {
    setModelAutoHint(tOr("settings.autoMetaNeedModel", "请先选择或填写模型"));
    return;
  }

  // A. 目录上下文
  const currentCtx = contextWindowInput.value.trim();
  const looksUnset = !currentCtx || currentCtx === "256000" || currentCtx === "0";
  let catalogValue: number | null = null;
  try {
    const v = await window.settings?.lookupModelContextWindow?.(provider, model);
    catalogValue = typeof v === "number" && v > 0 ? v : null;
  } catch {
    catalogValue = null;
  }

  // B. 服务商模型列表（需要已填 URL+Key）
  if (baseUrl && (apiKey || provider?.includes("ollama") || provider?.includes("Ollama"))) {
    setModelAutoHint(tOr("settings.autoMetaFetching", "正在从服务商获取模型信息…"));
    try {
      const fetchModels = window.settings?.fetchProviderModels;
      if (!fetchModels) {
        setModelAutoHint(tOr("settings.autoMetaNoApi", "无法访问服务商接口，请手动填写上下文 Token"), "err");
      } else {
        const result = await fetchModels({ baseUrl, apiKey: apiKey || "ollama" });
        if (result.ok && result.models?.length) {
          modelInputSuggestions.replaceChildren();
          for (const m of result.models) {
            const option = document.createElement("option");
            option.value = m.id;
            modelInputSuggestions.appendChild(option);
          }
          const hit = result.models.find((m) => m.id === model);
          if (!hit) {
            setModelAutoHint(
              tOr("settings.autoMetaNotInProvider", "服务商列表中无此模型 ID，请核对或手动填写") +
                \` · \${tOr("settings.autoMetaCount", "共")} \${result.models.length}\`,
              "err",
            );
          } else if (hit.contextWindow && hit.contextWindow > 0) {
            contextWindowInput.value = String(hit.contextWindow);
            setModelAutoHint(tOr("settings.autoMetaFromProvider", "上下文来自服务商 API"), "ok");
          } else if (catalogValue) {
            contextWindowInput.value = String(catalogValue);
            setModelAutoHint(tOr("settings.autoMetaFromCatalog", "服务商未返回上下文，已用内置目录值"), "ok");
          } else {
            setModelAutoHint(
              tOr("settings.autoMetaNoContext", "服务商未提供上下文长度，请手动填写 Token"),
              "err",
            );
          }
          return;
        }
        setModelAutoHint(
          tOr("settings.autoMetaFetchFailed", "服务商接口获取失败，请手动填写模型/上下文") +
            (result.error ? \`：\${String(result.error).slice(0, 80)}\` : ""),
          "err",
        );
      }
    } catch (e) {
      setModelAutoHint(
        tOr("settings.autoMetaFetchFailed", "服务商接口获取失败，请手动填写模型/上下文") +
          \`：\${String(e).slice(0, 80)}\`,
        "err",
      );
    }
  }

  // C. 仅目录（未配 Key 或拉取失败后）
  if (catalogValue) {
    const now = contextWindowInput.value.trim();
    if (!now || now === "256000" || reason === "preset" || reason === "select") {
      if (!now || now === "256000") {
        contextWindowInput.value = String(catalogValue);
      }
      setModelAutoHint(
        tOr("settings.autoMetaFromCatalog", "上下文来自内置目录") + \`：\${catalogValue}\`,
        "ok",
      );
    }
    return;
  }
  if (looksUnset) {
    setModelAutoHint(
      tOr("settings.autoMetaUnknownModel", "目录无此模型，且未配置服务商 API，请手动填写上下文"),
      "err",
    );
  }
}

function bindModelAutoResolve(): void {
  const run = (reason: "select" | "input" | "preset" | "test") => {
    void autoResolveModelMeta(reason);
  };
  modelInput?.addEventListener("change", () => run("input"));
  modelInput?.addEventListener("blur", () => run("select"));
  // 选厂商/档案后
  if (!String(fillModelOptions).includes("autoResolveModelMeta")) {
    const original = fillModelOptions;
    (fillModelOptions as unknown as typeof fillModelOptions) = function patched(
      preset: Parameters<typeof original>[0],
      preferred?: Parameters<typeof original>[1],
    ): void {
      original(preset, preferred);
      run("preset");
    } as typeof fillModelOptions;
  }
}
bindModelAutoResolve();
`;

if (!st.includes("autoResolveModelMeta")) {
  // insert after fillContextWindowIfEmpty function end
  const anchor = `/** 载入档案到编辑表单。 */`;
  if (st.includes(anchor)) {
    st = st.replace(anchor, autoBlock + "\n" + anchor);
    console.log("autoResolve inserted");
  } else {
    console.log("anchor missing for autoResolve");
  }
}

// 删掉旧的 bindModelAutoCheck 若残留
st = st.replace(/\nfunction bindModelAutoCheck[\s\S]*?\nbindModelAutoCheck\(\);\n/, "\n");

// ── 4) 启动失败文案 ──
const appPath = dp + "/src/main/application/application.ts";
let appTs = fs.readFileSync(appPath, "utf8");
appTs = appTs.replace(
  `const message = error instanceof Error ? \`\${error.message}\\n\\n\${error.stack ?? ""}\` : String(error);
      try {
        deps.dialog.showErrorBox("Cyrene 启动失败", message);`,
  `const raw = error instanceof Error ? \`\${error.message}\` : String(error);
      const isDevUrl =
        /ERR_CONNECTION_REFUSED|did-fail-load|localhost:\\d+/i.test(raw) && process.env.VITE_DEV === "1";
      const message = isDevUrl
        ? [
            "开发服务器未就绪或端口已变。",
            "",
            "处理步骤：",
            "1. 以管理员身份在项目目录执行 scripts\\\\diagnostics\\\\restart-dev-full.ps1",
            "2. 或手动：npm run dev 后等待 Vite 就绪再打开应用",
            "3. 确认 dist/main/.vite-dev-url.json 与实际 Vite 端口一致",
            "",
            "技术细节：",
            raw.slice(0, 400),
          ].join("\\n")
        : error instanceof Error
          ? \`\${error.message}\\n\\n\${(error.stack ?? "").slice(0, 800)}\`
          : String(error);
      try {
        deps.dialog.showErrorBox("应用启动失败", message);`,
);

// ── 5) i18n/nav 文案 ──
const zhPath = dp + "/src/renderer/settings/i18n/zh-CN.json";
let zh = fs.readFileSync(zhPath, "utf8");
if (!zh.includes('"nav.storage"')) {
  zh = zh.replace('"nav": {', '"nav": {\n    "storage": "存储与备份",');
}
zh = zh.replace('"backup": "备份管理"', '"backup": "存储与备份"');
fs.writeFileSync(zhPath, zh, "utf8");

fs.writeFileSync(stPath, st, "utf8");
fs.writeFileSync(appPath, appTs, "utf8");
console.log("done");
