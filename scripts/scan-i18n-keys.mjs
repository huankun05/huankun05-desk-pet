import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SRC_DIR = 'src';
const LOCALES = {
  zh: 'src/i18n/locales/zh-CN.json',
  en: 'src/i18n/locales/en-US.json',
};

const KNOWN_NAMESPACES = new Set([
  'app',
  'menu',
  'toolbar',
  'window',
  'controls',
  'chat',
  'settings',
  'status',
  'bubble',
  'admin',
  'common',
  'time',
  'error',
]);

async function loadJson(path) {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw);
}

function flattenKeys(obj, prefix = '') {
  const keys = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const sub of flattenKeys(v, full)) keys.add(sub);
    } else {
      keys.add(full);
    }
  }
  return keys;
}

async function walk(dir, cb) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, cb);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      cb(path, await readFile(path, 'utf-8'));
    }
  }
}

function looksLikeI18nKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (!/^[a-z][a-z0-9_.-]*$/i.test(key)) return false;
  const first = key.split('.')[0];
  return KNOWN_NAMESPACES.has(first);
}

function extractKeys(content) {
  const keys = [];
  // t('key', ...) or t("key", ...)
  const regex1 = /t\(\s*['"]([^'"]+)['"]/g;
  // i18n.t('key', ...) or i18n.t("key", ...)
  const regex2 = /i18n\.t\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = regex1.exec(content)) !== null) {
    if (looksLikeI18nKey(m[1])) keys.push(m[1]);
  }
  while ((m = regex2.exec(content)) !== null) {
    if (looksLikeI18nKey(m[1])) keys.push(m[1]);
  }
  return keys;
}

async function main() {
  const zh = await loadJson(LOCALES.zh);
  const en = await loadJson(LOCALES.en);
  const zhKeys = flattenKeys(zh);
  const enKeys = flattenKeys(en);

  const usedKeys = new Set();
  const keyUsages = new Map();

  await walk(SRC_DIR, (file, content) => {
    const keys = extractKeys(content);
    const lines = content.split('\n');
    for (const key of keys) {
      usedKeys.add(key);
      if (!keyUsages.has(key)) keyUsages.set(key, []);
      const lineIdx = lines.findIndex((l) => l.includes(`'${key}'`) || l.includes(`"${key}"`));
      keyUsages.get(key).push({ file, line: lineIdx >= 0 ? lineIdx + 1 : 0 });
    }
  });

  const missingZh = [];
  const missingEn = [];
  for (const key of usedKeys) {
    if (!zhKeys.has(key)) missingZh.push(key);
    if (!enKeys.has(key)) missingEn.push(key);
  }

  console.log('=== 中文缺失 key ===');
  if (missingZh.length === 0) console.log('无');
  for (const key of missingZh.sort()) {
    console.log(`- ${key}`);
    for (const u of keyUsages.get(key).slice(0, 3)) console.log(`    ${u.file}:${u.line}`);
  }

  console.log('\n=== English missing keys ===');
  if (missingEn.length === 0) console.log('None');
  for (const key of missingEn.sort()) {
    console.log(`- ${key}`);
    for (const u of keyUsages.get(key).slice(0, 3)) console.log(`    ${u.file}:${u.line}`);
  }

  if (missingZh.length === 0 && missingEn.length === 0) {
    console.log('\n✅ 所有已知命名空间下的 i18n key 在两种语言中均已定义。');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
