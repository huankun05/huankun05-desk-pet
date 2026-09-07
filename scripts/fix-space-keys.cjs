// 修复：合并脚本曾对值做 trim()，导致前缀/后缀 key 的首尾空格丢失。
// 规则：zh 恢复为源码原文；en 按 zh 的首尾空格位置镜像恢复。
const fs = require("fs");
const path = require("path");
const ROOT = "src/renderer/settings";

const usage = {};
function add(key, zh, src) {
  if (!key) return;
  key = key.trim();
  if (!usage[key]) usage[key] = { zh: null, sources: [] };
  if (zh && !usage[key].zh) usage[key].zh = zh;
  if (src && !usage[key].sources.includes(src)) usage[key].sources.push(src);
}
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (f === "i18n") continue;
      walk(p);
    } else if (/\.(ts|html)$/.test(f) && !/\.test\.ts$/.test(f)) scan(p);
  }
}
function scan(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const text = fs.readFileSync(file, "utf8");
  const re = /\btOr\s*\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]*)\3\s*\)/g;
  let m;
  while ((m = re.exec(text))) add(m[2], m[4], rel);
}
walk(ROOT);

const zhDict = JSON.parse(fs.readFileSync("src/renderer/settings/i18n/zh-CN.json", "utf8"));
const enDict = JSON.parse(fs.readFileSync("src/renderer/settings/i18n/en-US.json", "utf8"));
function get(dict, key) {
  let cur = dict;
  for (const p of key.split(".")) {
    if (cur && typeof cur === "object" && p in cur) cur = cur[p];
    else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
}
function setPath(dict, key, value) {
  const parts = key.split(".");
  let cur = dict;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function mirror(raw, value) {
  const lead = /^\s*/.exec(raw)[0];
  const tail = /\s*$/.exec(raw)[0];
  return lead + (value || "").trim() + tail;
}

const affected = Object.keys(usage).sort().filter((k) => usage[k].zh && /^\s|\s$/.test(usage[k].zh));
let zhFixed = 0;
let enFixed = 0;
for (const k of affected) {
  const raw = usage[k].zh;
  const curZh = get(zhDict, k);
  const curEn = get(enDict, k);
  if (curZh !== undefined && curZh !== raw) {
    setPath(zhDict, k, raw);
    zhFixed++;
  }
  if (curEn !== undefined) {
    const fixedEn = mirror(raw, curEn);
    if (fixedEn !== curEn) {
      setPath(enDict, k, fixedEn);
      enFixed++;
    }
  }
}
fs.writeFileSync("src/renderer/settings/i18n/zh-CN.json", JSON.stringify(zhDict, null, 2) + "\n", "utf8");
fs.writeFileSync("src/renderer/settings/i18n/en-US.json", JSON.stringify(enDict, null, 2) + "\n", "utf8");
console.log(`Fixed ${zhFixed} zh keys, ${enFixed} en keys.`);
