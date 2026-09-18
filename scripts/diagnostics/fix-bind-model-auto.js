const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");
const a = t.indexOf("function bindModelAutoResolve");
const b = t.indexOf("bindModelAutoResolve();", a);
if (a < 0 || b < 0) {
  console.log("not found", a, b);
  process.exit(0);
}
const neu = `function bindModelAutoResolve(): void {
  const run = (reason: "select" | "input" | "preset" | "test") => {
    void autoResolveModelMeta(reason);
  };
  modelInput?.addEventListener("change", () => run("input"));
  modelInput?.addEventListener("blur", () => run("select"));
}
`;
t = t.slice(0, a) + neu + t.slice(b + "bindModelAutoResolve();".length);
fs.writeFileSync(f, t, "utf8");
console.log("monkeypatch removed", !t.includes("fillModelOptions as unknown"));
console.log("applyPreset hook", t.includes('void autoResolveModelMeta("preset");'));
