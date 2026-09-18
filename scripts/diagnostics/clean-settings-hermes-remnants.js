const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");

// remove hermes panel toggle leftovers
t = t.replace(/\n\s*const hermesPanel = document\.getElementById\("hermes-panel"\);/, "");
t = t.replace(/\n\s*if \(hermesPanel\) hermesPanel\.classList\.toggle\("is-hidden", !isHermes\);/, "");
t = t.replace(/\n\s*if \(isHermes\) \{ try \{ void initHermesPanel\(\); \} catch \(e\) \{ console\.error\("\[Hermes\] 初始化失败:", e\); \} \}/, "");
t = t.replace(/const isHermes = section === "hermes";\n/, "");
t = t.replace(/ \|\| isHermes/g, "");
t = t.replace(/!isHermes &&\n\s*/, "");
t = t.replace(/import \{ initHermesPanel \} from "\.\/hermes\/panel";\n/, "");

// remove workFlowAdapt listener + helper if still present
t = t.replace(/\nworkFlowAdaptBtn\?\.addEventListener\([\s\S]*?\n\}\);\n/, "\n");
t = t.replace(/\nfunction buildWorkFlowAdaptBody\(\): string \{[\s\S]*?\n\}\n/, "\n");
t = t.replace(/workFlowAdaptBtn, /g, "");
t = t.replace(/, workFlowAdaptBtn/g, "");

fs.writeFileSync(f, t, "utf8");
console.log("isHermes", (t.match(/isHermes/g) || []).length);
console.log("workFlow", (t.match(/workFlowAdapt/g) || []).length);
console.log("initHermesPanel", (t.match(/initHermesPanel/g) || []).length);
