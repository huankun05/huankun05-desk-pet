const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/main/services/appRestart.ts";
let t = fs.readFileSync(f, "utf8");
const idx = t.indexOf("writeFileSync(scriptPath, lines.join(");
const end = t.indexOf(");", idx);
if (idx >= 0 && end > idx) {
  t =
    t.slice(0, idx) +
    'writeFileSync(scriptPath, lines.join(String.fromCharCode(10)), "utf8")' +
    t.slice(end + 2);
  fs.writeFileSync(f, t, "utf8");
  console.log("fixed join");
} else {
  console.log("not found", idx, end);
}
const snippet = t.slice(idx, idx + 80);
console.log(JSON.stringify(snippet));
