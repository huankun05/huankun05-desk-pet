const fs = require("fs");
const htmlPath = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/index.html";
let t = fs.readFileSync(htmlPath, "utf8");
const start = t.indexOf('id="backup-panel"');
if (start >= 0) {
  const sectionStart = t.lastIndexOf("<section", start);
  const sectionEnd = t.indexOf("</section>", start) + "</section>".length;
  t = t.slice(0, sectionStart) + t.slice(sectionEnd);
  fs.writeFileSync(htmlPath, t, "utf8");
  console.log("backup-panel removed");
} else console.log("no backup-panel");
console.log("still has backup-panel?", t.includes('id="backup-panel"'));

// bundle + test fetch-provider-models
const { execFileSync } = require("child_process");
const out = "F:/Work/Create/desk_pet/desk-pet/scripts/diagnostics/fpm-test.cjs";
execFileSync(
  "E:/software/Nodejs/node.exe",
  [
    "E:/software/Nodejs/node_modules/esbuild/bin/esbuild",
    "src/main/orchestrator/vendors/fetch-provider-models.ts",
    "--bundle",
    "--platform=node",
    `--outfile=${out}`,
  ],
  { cwd: "F:/Work/Create/desk_pet/desk-pet", stdio: "inherit" },
);
const m = require(out);
console.log("urls anthropic", m.candidateModelsUrls("https://api.deepseek.com/anthropic"));
console.log("urls v1", m.candidateModelsUrls("https://api.deepseek.com/v1"));
m.fetchProviderModels({
  baseUrl: "https://api.deepseek.com/anthropic",
  apiKey: "sk-FAKEKEYABCDEFGHIJK",
  fetchImpl: async () => ({
    ok: false,
    status: 401,
    text: async () =>
      JSON.stringify({
        error: { message: "Authentication Fails, Your api key: sk-FAKEKEYABCDEFGHIJK is invalid" },
      }),
  }),
}).then((r) => console.log("auth fail msg:", r.ok, r.error));
