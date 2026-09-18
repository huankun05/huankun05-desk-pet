const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");

// 1) applyPreset 末尾追加 autoResolve
if (!t.includes('void autoResolveModelMeta("preset");')) {
  t = t.replace(
    "  apiState.activeProvider = preset.providerName;\n  applyMultimodalUI();\n}",
    `  apiState.activeProvider = preset.providerName;
  applyMultimodalUI();
  // 填完 URL/Key/协议后再自动解析，避免串用上一家 Key
  void autoResolveModelMeta("preset");
}`,
  );
  console.log("applyPreset hook", t.includes('void autoResolveModelMeta("preset");'));
}

// 2) 整体替换 autoResolveModelMeta 函数体
const start = t.indexOf("async function autoResolveModelMeta");
const end = t.indexOf("function bindModelAutoResolve");
if (start > 0 && end > start) {
  const neu = `async function autoResolveModelMeta(reason: "select" | "input" | "preset" | "test"): Promise<void> {
  const provider = apiState.activeProvider;
  const model = getCurrentModelValue().trim();
  const baseUrl = baseUrlInput.value.trim();
  const apiKey = getApiKeyForRequest?.() ?? "";
  if (!provider || !model) {
    setModelAutoHint(tOr("settings.autoMetaNeedModel", "请先选择或填写模型"));
    return;
  }

  let catalogValue: number | null = null;
  try {
    const v = await window.settings?.lookupModelContextWindow?.(provider, model);
    catalogValue = typeof v === "number" && v > 0 ? v : null;
  } catch {
    catalogValue = null;
  }

  const currentCtx = contextWindowInput.value.trim();
  const looksUnset = !currentCtx || currentCtx === "256000" || currentCtx === "0";
  if (catalogValue && (looksUnset || reason === "preset")) {
    contextWindowInput.value = String(catalogValue);
  }

  let host = baseUrl;
  try {
    host = new URL(baseUrl).host;
  } catch { /* keep raw */ }

  const isLocal = /ollama/i.test(provider) || /^http:\\/\\/localhost/i.test(baseUrl);
  const keyOk =
    isLocal ||
    Boolean(
      apiKey &&
        apiKey !== LOCAL_ENDPOINT_AUTH_FALLBACK &&
        !/^\\*+$/.test(apiKey) &&
        apiKey.length >= 8,
    );

  if (!baseUrl) {
    setModelAutoHint(
      catalogValue
        ? \`上下文（内置目录）\${catalogValue} · 请填写「\${provider}」的 Base URL\`
        : \`请填写「\${provider}」的 Base URL\`,
      catalogValue ? "ok" : "err",
    );
    return;
  }
  if (!keyOk) {
    setModelAutoHint(
      catalogValue
        ? \`上下文（内置目录）\${catalogValue} · 「\${provider}」未填 API Key，无法向 \${host} 拉取模型列表\`
        : \`「\${provider}」未填 API Key（须与 \${host} 匹配），请手动填写模型与上下文\`,
      catalogValue ? "ok" : "err",
    );
    return;
  }

  setModelAutoHint(\`正在向 \${provider}（\${host}）获取模型信息…\`);
  try {
    const fetchModels = window.settings?.fetchProviderModels;
    if (!fetchModels) {
      setModelAutoHint(
        catalogValue ? \`上下文（目录）\${catalogValue} · 无列表接口\` : "无法访问服务商接口",
        catalogValue ? "ok" : "err",
      );
      return;
    }
    const result = await fetchModels({ baseUrl, apiKey: isLocal && !apiKey ? "ollama" : apiKey });
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
          \`「\${provider}」共 \${result.models.length} 个模型，无「\${model}」；请核对 ID。上下文\${catalogValue ? \`用目录 \${catalogValue}\` : "请手填"}\`,
          "err",
        );
        return;
      }
      if (hit.contextWindow && hit.contextWindow > 0) {
        contextWindowInput.value = String(hit.contextWindow);
        setModelAutoHint(\`已匹配 \${provider} · \${model} · 上下文 \${hit.contextWindow}（服务商）\`, "ok");
      } else if (catalogValue) {
        contextWindowInput.value = String(catalogValue);
        setModelAutoHint(\`已匹配 \${provider} · \${model} · 上下文 \${catalogValue}（内置目录）\`, "ok");
      } else {
        setModelAutoHint(\`已匹配 \${provider} 中的 \${model}；服务商未返回上下文，请手动填写\`, "err");
      }
      return;
    }

    const errText = String(result.error || "");
    if (/认证失败|401|403|Authentication/i.test(errText)) {
      if (catalogValue) {
        contextWindowInput.value = String(catalogValue);
        setModelAutoHint(
          \`「\${provider}」列表接口拒绝认证（\${host}）：Key 无效/不匹配，或该厂商不支持 /models。已用目录上下文 \${catalogValue}；对话配置未被更改。\`,
          "ok",
        );
      } else {
        setModelAutoHint(
          \`「\${provider}」拒绝认证：请核对厂商与 API Key 是否都属于 \${host}；上下文请手动填写。\`,
          "err",
        );
      }
      return;
    }
    if (catalogValue) {
      contextWindowInput.value = String(catalogValue);
      setModelAutoHint(\`「\${provider}」列表失败：\${errText.slice(0, 80)} · 已用目录 \${catalogValue}\`, "ok");
    } else {
      setModelAutoHint(\`「\${provider}」列表失败：\${errText.slice(0, 100)} · 请手动填写\`, "err");
    }
  } catch (e) {
    if (catalogValue) {
      contextWindowInput.value = String(catalogValue);
      setModelAutoHint(\`「\${provider}」请求异常，已用目录 \${catalogValue}\`, "ok");
    } else {
      setModelAutoHint(\`「\${provider}」请求异常：\${String(e).slice(0, 80)}\`, "err");
    }
  }
}

`;
  t = t.slice(0, start) + neu + t.slice(end);
  fs.writeFileSync(f, t, "utf8");
  console.log("autoResolve replaced");
} else {
  console.log("bounds", start, end);
}

// verify fillModelOptions no longer autoresolves
console.log("fillModelOptions has autoResolve", /function fillModelOptions[\s\S]{0,400}autoResolve/.test(t));
