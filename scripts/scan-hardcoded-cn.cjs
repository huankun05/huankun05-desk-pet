// 扫描 settings 渲染层中未抽离的硬编码中文（剥离 tOr 回退 / data-i18n 文本后仍有中文的行）
const fs = require("fs");
const path = require("path");
const ROOT = "src/renderer/settings";

const cn = /[\u4e00-\u9fff]/;
function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (f === "i18n") continue;
      walk(p, out);
    } else if (/\.(ts|html)$/.test(f) && !/\.test\.ts$/.test(f)) {
      scan(p, out);
    }
  }
}
function strip(line) {
  let s = line;
  // tOr("key", "zh") / tOr("key","zh")
  s = s.replace(/\btOr\s*\(\s*['"][^'"]+['"]\s*,\s*['"][^'"]*['"]\s*\)/g, "");
  // data-i18n="key">zh text<  (remove attr + following text content)
  s = s.replace(/data-i18n(?:-aria|-title|-alt)?="[^"]*"[^>]*>([^<]*)</g, "");
  // data-i18n on self-closing / no text
  s = s.replace(/data-i18n(?:-aria|-title|-alt)?="[^"]*"/g, "");
  // HTML 注释
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  return s;
}
function scan(file, out) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!cn.test(line)) return;
    if (!cn.test(strip(line))) return;
    if (/^(?:\/\/|\/\*|\*)/.test(t)) return; // 注释行
    if (/console\.(log|warn|error|info|debug)/.test(line)) return; // 开发日志
    out.push([rel + ":" + (i + 1), line]);
  });
}
const out = [];
walk(ROOT, out);
let total = 0;
const byFile = {};
for (const [pos, line] of out) {
  const file = pos.replace(/:\d+$/, "");
  if (!byFile[file]) byFile[file] = 0;
  byFile[file]++;
  total++;
}
console.log("hardcoded Chinese lines:", total);
for (const rel of Object.keys(byFile).sort((a, b) => byFile[b] - byFile[a])) {
  console.log(byFile[rel] + "\t" + rel);
}
