const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..', 'src', 'renderer', 'settings');
const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
const zh = JSON.parse(fs.readFileSync(path.join(base, 'i18n', 'zh-CN.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(base, 'i18n', 'en-US.json'), 'utf8'));

const keys = new Set();
for (const m of html.matchAll(/data-i18n(?:-aria|-title|-alt)?="([^"]+)"/g)) keys.add(m[1]);

function missingIn(dict) {
  const missing = [];
  for (const k of keys) {
    let cur = dict;
    for (const p of k.split('.')) {
      if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
      else { cur = undefined; break; }
    }
    if (typeof cur !== 'string') missing.push(k);
  }
  return missing;
}

const mZh = missingIn(zh);
const mEn = missingIn(en);
console.log('referenced:', keys.size);
console.log('missing in zh-CN.json:', mZh.length);
console.log(mZh.join('\n'));
console.log('---');
console.log('missing in en-US.json:', mEn.length);
console.log(mEn.join('\n'));
