// 检查 settings 渲染层引用的所有 i18n key 是否都在词典中（zh + en 必须都存在）
// 覆盖：data-i18n / data-i18n-aria / data-i18n-title / data-i18n-alt / tOr() / t()
// 动态拼接 key（如 "backup.category." + x、`tts.senseaudio.voiceGroup.` 前缀）无法静态解析，单独列出提示
const fs = require("fs");
const path = require("path");
const ROOT = "src/renderer/settings";

const zh = require("../src/renderer/settings/i18n/zh-CN.json");
const en = require("../src/renderer/settings/i18n/en-US.json");

function lookup(dict, key) {
  const parts = key.split(".");
  let cur = dict;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) cur = cur[p];
    else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
}

const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (f === "i18n") continue;
      walk(p);
    } else if (/\.(ts|html)$/.test(f) && !/\.test\.ts$/.test(f)) {
      files.push(p);
    }
  }
})(ROOT);

const refs = {}; // key -> [{file, line}]
const dynamic = []; // 动态拼接 key 提示
const KEY_RE = /(['"])([a-zA-Z][\w.-]*?)\1/;

function addRef(key, file, line, kind) {
  if (!key || /[\+\$]/.test(key) || key.endsWith(".")) {
    // 含 + / $ / 尾部带点的属于动态拼接（如 "backup.category." + x）
    dynamic.push(`${kind} ${file}:${line}: ${key}`);
    return;
  }
  (refs[key] ||= []).push({ file, line, kind });
}

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const n = i + 1;
    // data-i18n 系列属性
    for (const m of line.matchAll(/data-i18n(?:-aria|-title|-alt)?="([^"]+)"/g)) {
      addRef(m[1].trim(), rel, n, "attr");
    }
    // tOr("key", ...) —— 双引号
    for (const m of line.matchAll(/\btOr\s*\(\s*"([^"]+)"/g)) {
      addRef(m[1].trim(), rel, n, "tOr");
    }
    // tOr('key', ...) —— 单引号
    for (const m of line.matchAll(/\btOr\s*\(\s*'([^']+)'/g)) {
      addRef(m[1].trim(), rel, n, "tOr");
    }
    // t("key") / t('key') —— 排除 tOr（先用替换把 tOr(...) 移除）
    const noTOr = line.replace(/\btOr\s*\(/g, "tXXX(");
    for (const m of noTOr.matchAll(/\bt\s*\(\s*"([^"]+)"/g)) {
      addRef(m[1].trim(), rel, n, "t");
    }
    for (const m of noTOr.matchAll(/\bt\s*\(\s*'([^']+)'/g)) {
      addRef(m[1].trim(), rel, n, "t");
    }
  });
}

const missingZh = [];
const missingEn = [];
for (const key of Object.keys(refs).sort()) {
  if (!lookup(zh, key)) missingZh.push(key);
  if (!lookup(en, key)) missingEn.push(key);
}

console.log("referenced keys:", Object.keys(refs).length);
console.log("dynamic (skipped):", dynamic.length);
console.log("missing in zh:", missingZh.length);
for (const k of missingZh) console.log("  zh MISS " + k);
console.log("missing in en:", missingEn.length);
for (const k of missingEn) console.log("  en MISS " + k);
if (dynamic.length) {
  console.log("--- dynamic key usages (manual check) ---");
  for (const d of dynamic) console.log("  " + d);
}
