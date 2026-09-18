const fs = require("fs");
const t = fs.readFileSync("F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/index.html", "utf8");
const open = (t.match(/<section/g) || []).length;
const close = (t.match(/<\/section>/g) || []).length;
console.log("section open", open, "close", close);
console.log("nav-item buttons", (t.match(/class="nav-item"/g) || []).length);
const sections = [...t.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]);
const panels = [...t.matchAll(/data-panel="([^"]+)"/g)].map((m) => m[1]);
const uniq = (a) => [...new Set(a)];
console.log("nav", uniq(sections).join(","));
console.log("panel", uniq(panels).join(","));
console.log("nav-no-panel", uniq(sections).filter((s) => !panels.includes(s)).join(","));
console.log("panel-no-nav", uniq(panels).filter((p) => !sections.includes(p)).join(","));

// check switchSection references vs NAV
const st = fs.readFileSync("F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts", "utf8");
const navKeys = [...st.matchAll(/^\s{2}([a-zA-Z0-9"-]+):\s*\{\s*emoji:/gm)].map((m) => m[1].replace(/^"|"$/g, ""));
console.log("NAV_LABELS keys", navKeys.join(","));
console.log("nav missing NAV_LABELS", uniq(sections).filter((s) => !navKeys.includes(s)).join(","));
// try compile settings.ts standalone for syntax
console.log("initStoragePanel import", st.includes('from "./storage/panel"'));
console.log("click bind count", (st.match(/querySelectorAll\("\.nav-item"\)/g) || []).length);
