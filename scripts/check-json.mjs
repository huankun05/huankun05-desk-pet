/**
 * check-json.mjs — 严格校验 src 下所有 JSON 文件可解析。
 *
 * 目的：vite 在 dev/build 时会用严格的 JSON 解析器加载 .json（如 i18n locale），
 * 一旦出现尾逗号、缺失逗号、注释等非法语法，pre-transform 直接失败、应用起不来，
 * 而 tsc/eslint/vitest 都不会覆盖这些文件。本脚本做最后一道 JSON 语法护栏。
 *
 * 用法：node scripts/check-json.mjs
 * 退出码：0 = 全部通过；1 = 存在解析失败的文件。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'src';
const errors = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      walk(p);
    } else if (e.name.endsWith('.json')) {
      try {
        JSON.parse(readFileSync(p, 'utf8'));
      } catch (err) {
        errors.push(`${relative('.', p)} :: ${String(err.message).split('\n')[0]}`);
      }
    }
  }
}

walk(ROOT);

if (errors.length === 0) {
  console.log('✓ 所有 src 下 JSON 解析通过');
  process.exit(0);
} else {
  console.error('✗ 以下 JSON 解析失败：');
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
