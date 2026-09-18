const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/index.html";
let t = fs.readFileSync(f, "utf8");
t = t.split("<title >").join("<title>");
t = t.split('class="nav-item__label" >').join('class="nav-item__label">');
fs.writeFileSync(f, t, "utf8");
console.log("title-space", (t.match(/<title >/g) || []).length);
console.log("label-space", (t.match(/nav-item__label" >/g) || []).length);
