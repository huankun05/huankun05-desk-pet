const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");
const lines = t.split(/\r?\n/);
let cacheSeen = 0;
let uiSeen = 0;
let autoSeen = 0;
const out = lines.map((line) => {
  if (/^let _providerModelsCache/.test(line)) {
    cacheSeen += 1;
    return cacheSeen === 1 ? line : "";
  }
  if (/^let _modelUiBound/.test(line)) {
    uiSeen += 1;
    return uiSeen === 1 ? line : "";
  }
  if (/^async function autoResolveModelMeta/.test(line)) {
    autoSeen += 1;
    return autoSeen === 1 ? line : "";
  }
  return line;
});
// remove duplicate function bodies for autoResolve if autoSeen>1 - crude: if still duplicates, keep first block
t = out.join("\n");
// if autoResolve function appears twice, delete second full function
let first = t.indexOf("async function autoResolveModelMeta");
let second = t.indexOf("async function autoResolveModelMeta", first + 1);
if (second > 0) {
  const end = t.indexOf("\n}\n", second);
  if (end > second) {
    t = t.slice(0, second) + t.slice(end + 3);
  }
}
fs.writeFileSync(f, t, "utf8");
console.log(
  "cache",
  (t.match(/let _providerModelsCache/g) || []).length,
  "uiBound",
  (t.match(/let _modelUiBound/g) || []).length,
  "auto",
  (t.match(/async function autoResolveModelMeta/g) || []).length,
);
