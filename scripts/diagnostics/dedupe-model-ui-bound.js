const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");
const lines = t.split(/\r?\n/);
let seen = false;
const out = lines.map((line) => {
  if (/^let _modelUiBound = false;$/.test(line)) {
    if (seen) return "";
    seen = true;
  }
  return line;
});
t = out.join("\n");
fs.writeFileSync(f, t, "utf8");
console.log("modelUiBound count", (t.match(/let _modelUiBound/g) || []).length);
console.log("bindModelAutoResolve count", (t.match(/function bindModelAutoResolve/g) || []).length);
console.log("autoResolve count", (t.match(/async function autoResolveModelMeta/g) || []).length);
