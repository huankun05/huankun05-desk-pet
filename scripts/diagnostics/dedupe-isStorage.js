const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");
// dedupe isStorage
t = t.replace(/  const isStorage = section === "storage";\n  const isStorage = section === "storage";/, '  const isStorage = section === "storage";');
fs.writeFileSync(f, t, "utf8");
const matches = (t.match(/const isStorage/g) || []).length;
console.log("isStorage count", matches);
