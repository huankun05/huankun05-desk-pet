const fs = require("fs");
const path = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
const t = fs.readFileSync(path, "utf8");
console.log("--- import skills ---");
for (const line of t.split("\n")) {
  if (/skills/i.test(line) && /import|initSkills/.test(line)) console.log(line.trim());
}
console.log("--- click bind ---");
const idx = t.lastIndexOf("querySelectorAll");
console.log(t.slice(Math.max(0, idx - 200), idx + 800));
console.log("--- CSS nav ---");
const css = fs.readFileSync("F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.css", "utf8");
const hits = css.split("\n").map((l, i) => ({ i: i + 1, l })).filter((x) => /nav-item|pointer-events|settings-nav__list/.test(x.l));
hits.slice(0, 40).forEach((h) => console.log(h.i, h.l.trim().slice(0, 120)));
