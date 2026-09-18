const fs = require("fs");
const dp = "F:/Work/Create/desk_pet/desk-pet";

function patch(file, fn) {
  const t = fs.readFileSync(file, "utf8");
  const n = fn(t);
  if (n !== t) {
    fs.writeFileSync(file, n, "utf8");
    console.log("ok", file.split("/").pop());
  } else console.log("skip", file.split("/").pop());
}

// ── 1) 去掉 AI 引擎导航与面板 ──
patch(dp + "/src/renderer/settings/index.html", (t) => {
  t = t.replace(/\s*<button type="button" class="nav-item" data-section="hermes">[\s\S]*?<\/button>/, "");
  t = t.replace(/\s*<section class="settings-panel is-hidden" id="hermes-panel" data-panel="hermes">[\s\S]*?<\/section>/, "\n");
  // 去掉 Work 流程适配按钮整行
  t = t.replace(/\s*<div class="work-flow-adapt-row">[\s\S]*?<\/div>/, "");
  // 上下文提示文案：说明会自动带出
  t = t.replace(
    'data-i18n="api.contextWindowHint">按档案保存；留空按 256000。',
    'data-i18n="api.contextWindowHint">选择/填写模型后自动带出；可手改，保存进档案。',
  );
  return t;
});

patch(dp + "/src/renderer/settings/settings.ts", (t) => {
  // NAV_LABELS 去掉 hermes
  t = t.replace(/\n\s*hermes: \{[^}]+\},/, "");
  // switchSection 去掉 hermes
  t = t.replace(/\n\s*const isHermes = section === "hermes";/, "");
  t = t.replace(/\n\s*const hermesPanel = document\.getElementById\("hermes-panel"\);\n\s*if \(hermesPanel\) hermesPanel\.classList\.toggle\("is-hidden", !isHermes\);\n\s*if \(isHermes\) \{[^}]+\}/, "");
  t = t.replace(/ \|\| isHermes /g, " ");
  t = t.replace(/\n\s*!isHermes &&/, "");
  // workFlowAdapt 导入与监听
  t = t.replace(", workFlowAdaptBtn", "");
  t = t.replace(/\nworkFlowAdaptBtn\?\.addEventListener\([\s\S]*?\n\}\);\n/, "\n");
  t = t.replace(/\nfunction buildWorkFlowAdaptBody\(\): string \{[\s\S]*?\n\}\n/, "\n");

  // 模型变更时自动检查/带出上下文窗口
  // 在 fillContextWindowIfEmpty 后增强
  const oldFill = `function fillContextWindowIfEmpty(): void {
  if (!contextWindowInput.value.trim()) {
    const provider = apiState.activeProvider;
    const model = getCurrentModelValue().trim();
    window.settings?.lookupModelContextWindow?.(provider, model)
      .then((value) => {
        // 查询返回期间用户可能已手填/切换，二次校验再落值
        if (value && !contextWindowInput.value.trim()) {
          contextWindowInput.value = String(value);
        }
      })
      .catch(() => { /* 知识表查询失败静默：保持空，保存时走运行时回退 */ });
  }
}`;
  const newFill = `/** 目录默认值（用于判断是否可以自动覆盖） */
const CATALOG_DEFAULT_CONTEXT = 256000;

function fillContextWindowIfEmpty(forceFromCatalog?: boolean): void {
  const provider = apiState.activeProvider;
  const model = getCurrentModelValue().trim();
  if (!provider || !model) return;
  const current = contextWindowInput.value.trim();
  const looksUnset = !current || current === String(CATALOG_DEFAULT_CONTEXT);
  if (!looksUnset && !forceFromCatalog) return;
  window.settings?.lookupModelContextWindow?.(provider, model)
    .then((value) => {
      if (!value) return;
      const now = contextWindowInput.value.trim();
      const stillUnset = !now || now === String(CATALOG_DEFAULT_CONTEXT) || now === String(value);
      if (forceFromCatalog || stillUnset) {
        contextWindowInput.value = String(value);
        const meta = document.getElementById("context-window-auto-hint");
        if (meta) meta.textContent = tOr("settings.contextAutoFromCatalog", "已按模型目录自动填写");
      }
    })
    .catch(() => { /* 静默 */ });
}

/** 模型名变化时：自动检查目录并带出上下文窗口 */
function bindModelAutoCheck(): void {
  const run = () => fillContextWindowIfEmpty(true);
  modelInput?.addEventListener("change", run);
  modelInput?.addEventListener("blur", run);
  // datalist 选择也走 input
  modelInput?.addEventListener("input", () => {
    const provider = apiState.activeProvider;
    const model = getCurrentModelValue().trim();
    if (!provider || !model) return;
    // 输入过程中仅在目录能命中时提示，不打断手输
    window.settings?.lookupModelContextWindow?.(provider, model)
      .then((value) => {
        const meta = document.getElementById("context-window-auto-hint");
        if (!meta) return;
        if (value) {
          meta.textContent = tOr("settings.modelInCatalog", "模型目录已收录") + " · " + value;
        } else {
          meta.textContent = tOr("settings.modelNotInCatalog", "目录暂无此模型，上下文可手填");
        }
      })
      .catch(() => { /* ignore */ });
  });
}
bindModelAutoCheck();`;
  if (t.includes(oldFill)) {
    t = t.replace(oldFill, newFill);
    console.log("fillContext enhanced");
  } else {
    // fallback: append bind after function
    t = t.replace(
      "function fillContextWindowIfEmpty(): void {",
      `const CATALOG_DEFAULT_CONTEXT = 256000;
function fillContextWindowIfEmpty(): void {`,
    );
  }

  // 预设选择时也触发
  t = t.replace(
    /fillModelOptions\((preset[^)]*)\);/,
    "fillModelOptions($1);\n  fillContextWindowIfEmpty(true);",
  );

  return t;
});

// ── 2) 凭据迁移字体（浅底可读）──
patch(dp + "/src/renderer/settings/settings.css", (t) => {
  t = t.replace(
    /\.credential-migrate-row__hint \{[\s\S]*?\}/,
    `.credential-migrate-row__hint {
  margin: 4px 0 0;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--ui-text-muted, var(--rb-text-muted, #4f4a57));
}`,
  );
  t = t.replace(
    /\.credential-migrate-row__title \{[\s\S]*?\}/,
    `.credential-migrate-row__title {
  display: block;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--ui-text-strong, var(--rb-text-strong, #1d1d1f));
}`,
  );
  t = t.replace(
    /\.credential-migrate-row__status \{[\s\S]*?\}/,
    `.credential-migrate-row__status {
  margin-top: 10px;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--ui-text-default, var(--rb-text-default, #2c2c2e));
}`,
  );
  t = t.replace(
    /\.credential-migrate-row__audit \{/,
    `.credential-migrate-row__audit {
  color: var(--ui-text-default, var(--rb-text-default, #2c2c2e));`,
  );
  // panel 略提对比
  t = t.replace(
    /\.credential-migrate-row \{/,
    `.credential-migrate-row {
  color: var(--ui-text-default, #2c2c2e);`,
  );
  return t;
});

// ── 3) context hint 节点 ──
patch(dp + "/src/renderer/settings/index.html", (t) => {
  if (!t.includes('id="context-window-auto-hint"')) {
    t = t.replace(
      /(<input id="context-window-input"[^>]*\/>)/,
      `$1\n              <span class="form-hint" id="context-window-auto-hint" style="margin-top:4px"></span>`,
    );
  }
  return t;
});

// ── 4) DeepSeek 目录补全常见型号 ──
patch(dp + "/src/main/orchestrator/model-config/model-context-catalog.ts", (t) => {
  t = t.replace(
    '"deepseek（深度求索）": { providerDefault: 131_072, models: { "deepseek-v4-pro": 131_072, "deepseek-v4-flash": 131_072 } },',
    `"deepseek（深度求索）": {
    providerDefault: 131_072,
    models: {
      "deepseek-v4-pro": 131_072,
      "deepseek-v4-flash": 131_072,
      "deepseek-chat": 131_072,
      "deepseek-reasoner": 131_072,
      "deepseek-v3": 131_072,
      "deepseek-v3.1": 131_072,
      "deepseek-r1": 131_072,
    },
  },`,
  );
  return t;
});

// ── 5) i18n hint ──
patch(dp + "/src/renderer/settings/i18n/zh-CN.json", (t) => {
  t = t.replace(
    '"contextWindowHint": "按档案保存；留空按 256000。"',
    '"contextWindowHint": "选择/填写模型后自动带出；可手改，保存进档案。"',
  );
  return t;
});

console.log("done");
