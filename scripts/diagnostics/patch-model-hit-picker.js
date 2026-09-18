const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");
const old = `      const hit = result.models.find((m) => m.id === model);
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
      return;`;
const neu = `      const hit = result.models.find((m) => m.id === model);
      if (!hit) {
        const fallback = result.models[0];
        modelInput.value = fallback.id;
        renderProviderModelPicker(result.models, fallback.id);
        if (fallback.contextWindow && fallback.contextWindow > 0) {
          contextWindowInput.value = String(fallback.contextWindow);
        } else if (catalogValue) {
          contextWindowInput.value = String(catalogValue);
        }
        const ctxNote = fallback.contextWindow
          ? \`，上下文 \${fallback.contextWindow}（约 \${Math.round(fallback.contextWindow / 1000)}K）\`
          : catalogValue
            ? \`，上下文 \${catalogValue}（约 \${Math.round(catalogValue / 1000)}K，目录）\`
            : "";
        setModelAutoHint(
          \`「\${provider}」返回 \${result.models.length} 个模型（见下方列表，可点击选用）。原「\${model}」不在官方列表，已自动选用「\${fallback.id}」\${ctxNote}。\`,
          "ok",
        );
        return;
      }
      renderProviderModelPicker(result.models, hit.id);
      if (hit.contextWindow && hit.contextWindow > 0) {
        contextWindowInput.value = String(hit.contextWindow);
        setModelAutoHint(
          \`已匹配 \${provider} · \${hit.id} · 上下文 \${hit.contextWindow} tokens（约 \${Math.round(hit.contextWindow / 1000)}K，服务商返回）\`,
          "ok",
        );
      } else if (catalogValue) {
        contextWindowInput.value = String(catalogValue);
        setModelAutoHint(
          \`已匹配 \${provider} · \${hit.id} · 上下文 \${catalogValue} tokens（约 \${Math.round(catalogValue / 1000)}K，内置目录）\`,
          "ok",
        );
      } else {
        setModelAutoHint(\`已匹配 \${provider} 中的 \${hit.id}；服务商未返回上下文，请手动填写\`, "err");
      }
      return;`;
if (t.includes(old)) {
  t = t.split(old).join(neu);
  console.log("replaced ok");
} else {
  // fuzzy: find by unique line
  const i = t.indexOf("const hit = result.models.find((m) => m.id === model);");
  console.log("not exact, idx", i);
  if (i > 0) {
    console.log(JSON.stringify(t.slice(i, i + 200)));
  }
}
if (!t.includes("function renderProviderModelPicker")) {
  console.log("WARNING: picker helper missing");
}
fs.writeFileSync(f, t, "utf8");
