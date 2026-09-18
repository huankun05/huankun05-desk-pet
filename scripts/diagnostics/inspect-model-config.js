const fs = require("fs");
const p = "C:/Users/shangmeng/AppData/Roaming/live2d-cyrene/model-settings.json";
const raw = JSON.parse(fs.readFileSync(p, "utf8"));
const mask = (k) => {
  if (!k || typeof k !== "string") return "(empty)";
  const t = k.replace(/^enc:v1:/, "enc:");
  if (t.length < 12) return "****";
  return `${t.slice(0, 6)}****${t.slice(-4)} (len=${t.length})`;
};
const slim = {
  mode: raw.mode,
  provider: raw.provider,
  baseUrl: raw.baseUrl,
  model: raw.model,
  apiKey: mask(raw.apiKey),
  explicitTransport: raw.explicitTransport,
  defaultModelProfileId: raw.defaultModelProfileId,
  perProvider: Object.fromEntries(
    Object.entries(raw.perProvider || {}).map(([name, v]) => [
      name,
      {
        baseUrl: v.baseUrl,
        model: v.model,
        apiKey: mask(v.apiKey),
        displayName: v.displayName,
        explicitTransport: v.explicitTransport,
      },
    ]),
  ),
  modelProfiles: (raw.modelProfiles || []).map((p) => ({
    id: p.id,
    provider: p.provider,
    displayName: p.displayName,
    baseUrl: p.baseUrl,
    model: p.model,
    apiKey: mask(p.apiKey),
    explicitTransport: p.explicitTransport,
    contextWindowTokens: p.contextWindowTokens,
  })),
};
console.log(JSON.stringify(slim, null, 2));
