const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");

// 只绑定一次，避免重复 listener → 多条 Toast
if (!t.includes("let _modelUiBound = false")) {
  t = t.replace(
    "function bindModelAutoResolve(): void {",
    `let _modelUiBound = false;

function bindModelAutoResolve(): void {
  if (_modelUiBound) {
    // 已绑定：仅同步单位/状态，不重复 addEventListener
    return;
  }
  _modelUiBound = true;`,
  );
  console.log("bind once flag added");
}

// switchSection 末尾强制标题，避免 i18n 干扰
if (!t.includes("/* force titlebar */")) {
  const idx = t.lastIndexOf("function switchSection");
  const end = t.indexOf("\n}\n", t.indexOf("placeholderPanel.classList.toggle", idx));
  if (end > idx) {
    t =
      t.slice(0, end) +
      `
  /* force titlebar */
  try {
    const lab = NAV_LABELS[section];
    if (lab) {
      sectionTitle.textContent = lab.title;
      sectionHint.textContent = lab.hint;
    }
  } catch { /* ignore */ }
` +
      t.slice(end);
    console.log("force titlebar ok");
  }
}

fs.writeFileSync(f, t, "utf8");
console.log("_modelUiBound", t.includes("_modelUiBound"));
console.log("bind calls", (t.match(/bindModelAutoResolve\(\)/g) || []).length);
