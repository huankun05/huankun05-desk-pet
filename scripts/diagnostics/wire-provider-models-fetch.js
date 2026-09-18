const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");

// After successful testConnection, fetch provider models
const marker = "btn.disabled = false;";
// Find test connection success path - look for setSaveStatus after test
const hook = `
      // 测试成功后从服务商拉取模型列表，自动检查模型名与上下文
      void (async () => {
        try {
          const fetchModels = window.settings?.fetchProviderModels;
          if (!fetchModels) return;
          const result = await fetchModels({ baseUrl, apiKey });
          if (!result.ok || !result.models?.length) {
            const meta = document.getElementById("context-window-auto-hint");
            if (meta && result.error) {
              meta.textContent = tOr("settings.providerModelsFailed", "服务商模型列表获取失败") + ": " + result.error;
            }
            return;
          }
          // 更新 datalist
          modelInputSuggestions.replaceChildren();
          for (const m of result.models) {
            const option = document.createElement("option");
            option.value = m.id;
            modelInputSuggestions.appendChild(option);
          }
          const current = getCurrentModelValue().trim();
          const hit = result.models.find((m) => m.id === current);
          const meta = document.getElementById("context-window-auto-hint");
          if (!hit) {
            if (meta) {
              meta.textContent =
                tOr("settings.modelNotInProviderList", "该模型不在服务商列表中，请核对模型 ID")
                + " · " + tOr("settings.providerModelCount", "服务商共")
                + " " + result.models.length + " " + tOr("settings.providerModelCountUnit", "个");
            }
            return;
          }
          if (hit.contextWindow && hit.contextWindow > 0) {
            contextWindowInput.value = String(hit.contextWindow);
            if (meta) {
              meta.textContent = tOr("settings.contextFromProvider", "上下文窗口来自服务商 API");
            }
          } else if (meta) {
            meta.textContent = tOr("settings.modelInProviderList", "模型已在服务商列表中（接口未返回上下文，可手填或用目录值）");
            fillContextWindowIfEmpty();
          }
        } catch { /* ignore */ }
      })();
`;

// Insert after testConnection success handling - find a unique place
if (!t.includes("SETTINGS_FETCH_PROVIDER_MODELS") && !t.includes("fetchProviderModels")) {
  // Insert into test connection then-block after status success
  const successPatterns = [
    /setSaveStatus\((`[^`]*测试[^`]*`|tOr\([^)]+\))\s*,\s*"is-ok"\)/,
  ];
  // simpler: after result.ok true block
  const idx = t.indexOf("const result = await window.settings!.testConnection");
  if (idx > 0) {
    // find the closing of that try success - look for ok: true handling
    const okIdx = t.indexOf("result.ok", idx);
    if (okIdx > 0) {
      // find first btn.disabled = false after ok
      const after = t.indexOf("btn.disabled = false;", okIdx);
      if (after > 0) {
        t = t.slice(0, after) + hook + t.slice(after);
        console.log("inserted fetch models after test");
      }
    }
  }
}

// fillModelOptions should not wipe provider list if we just fetched - optional leave as is

fs.writeFileSync(f, t, "utf8");
console.log("fetchProviderModels refs", (t.match(/fetchProviderModels/g) || []).length);
