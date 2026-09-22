const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/package.json";
const j = JSON.parse(fs.readFileSync(f, "utf8"));
j.scripts["dev:quick"] =
  'node -e "require(\'fs\').rmSync(\'dist/main/.vite-dev-url.json\',{force:true})" && concurrently -k "vite" "wait-on http://127.0.0.1:5174/react/ && cross-env VITE_DEV=1 electron ."';
fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n", "utf8");
console.log("dev:quick =", j.scripts["dev:quick"].slice(0, 80));
