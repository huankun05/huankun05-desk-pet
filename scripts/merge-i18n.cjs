// 合并脚本：把 i18n-missing.json 的 zh 回退 + i18n-partials/*.json 的 en 翻译
// 合并进 zh-CN.json / en-US.json（扁平 key -> 嵌套结构）。
// 用法：node scripts/merge-i18n.cjs
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve("src/renderer/settings");
const ZH = path.join(ROOT, "i18n/zh-CN.json");
const EN = path.join(ROOT, "i18n/en-US.json");
const MISSING = path.join(__dirname, "i18n-missing.json");
const PARTIALS = path.join(__dirname, "i18n-partials");

const zhDict = JSON.parse(fs.readFileSync(ZH, "utf8"));
const enDict = JSON.parse(fs.readFileSync(EN, "utf8"));

function setPath(dict, key, value) {
  const parts = key.split(".");
  let cur = dict;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

let zhAdded = 0;
let enAdded = 0;

// 1. zh 回退（非空）来自 i18n-missing.json
// 注意：值保留原文，不做 trim()——前缀/后缀 key 依赖首尾空格参与拼接。
const missing = JSON.parse(fs.readFileSync(MISSING, "utf8")).missing;
for (const [key, zh] of Object.entries(missing)) {
  if (key.startsWith("__en__")) continue;
  if (!zh || !zh.trim()) continue;
  setPath(zhDict, key, zh);
  zhAdded++;
}

// 2. zh 手动补充（i18n-partials/zh-manual.json）
const manualZh = path.join(PARTIALS, "zh-manual.json");
if (fs.existsSync(manualZh)) {
  const manual = JSON.parse(fs.readFileSync(manualZh, "utf8"));
  for (const [key, zh] of Object.entries(manual)) {
    if (!zh || !zh.trim()) continue;
    setPath(zhDict, key, zh);
    zhAdded++;
  }
}

// 3. en 部分文件（en-*.json，扁平 key -> 英文）
if (fs.existsSync(PARTIALS)) {
  for (const f of fs.readdirSync(PARTIALS)) {
    if (!/^en-.*\.json$/.test(f)) continue;
    const partial = JSON.parse(fs.readFileSync(path.join(PARTIALS, f), "utf8"));
    for (const [key, en] of Object.entries(partial)) {
      if (!en || !en.trim()) continue;
      setPath(enDict, key, en);
      enAdded++;
    }
  }
}

fs.writeFileSync(ZH, JSON.stringify(zhDict, null, 2) + "\n", "utf8");
fs.writeFileSync(EN, JSON.stringify(enDict, null, 2) + "\n", "utf8");
console.log(`Merged ${zhAdded} zh keys, ${enAdded} en keys.`);
