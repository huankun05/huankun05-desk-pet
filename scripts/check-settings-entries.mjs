/**
 * check-settings-entries.mjs — 校验设置页二级入口没有漏配、也没有孤儿页。
 *
 * 背景：设置模块存在「三份必须手工同步的清单」：
 *   1. routes.tsx 的 pageComponentLoaders —— 路径 → 组件的懒加载映射；
 *   2. routes.tsx 的 settingsTree —— 驱动路由、标题栏与全局搜索索引；
 *   3. 各分区的 *Index.tsx —— 手写的入口卡片列表（用户实际点击的地方）。
 * 三者任一不同步，tsc/eslint/vitest 都不会报错，只能靠人肉发现：
 *   - 有 tree、无 Index 卡片  → 页面能通过 URL 访问也能被搜到，但界面上看不到入口；
 *   - 有 loader、无 tree      → 孤儿页面：不在搜索索引、无正规导航，通常是被遗忘的重复实现。
 *
 * 本脚本做双向差集检查：
 *   A) settingsTree 声明的二级路径，必须至少被一个 Index 页引用；
 *   B) pageComponentLoaders 注册的二级路径，必须在 settingsTree 中声明。
 *
 * 用法：node scripts/check-settings-entries.mjs
 * 退出码：0 = 全部通过；1 = 存在漏配或孤儿页。
 *
 * 若某个路径确实属于例外（例如仅由其他页面内部跳转进入），
 * 把它加进对应的 ALLOWLIST 并写明原因。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROUTES_FILE = 'src/settings/routes.tsx';
const PAGES_DIR = 'src/settings/pages';

/** A) 允许没有 Index 入口卡片的路径（key = 路径，value = 原因） */
const ALLOWLIST_NO_ENTRY = {};

/** B) 允许只有 loader、不在 settingsTree 中声明的路径（key = 路径，value = 原因） */
const ALLOWLIST_ORPHAN = {
  // 角色外观（镜像/显隐）已合并到 /settings/models/live2d 页面内作为 Section
  // 保留 loader 以支持旧书签/深链访问，不再出现在导航树中
  '/settings/appearance/display': 'merged into Live2DPage',
};

const routesSrc = readFileSync(ROUTES_FILE, 'utf8');

// settingsTree 中的二级路径：path: '/settings/<分区>/<页面>'
const declared = [
  ...new Set(
    [...routesSrc.matchAll(/path:\s*'(\/settings\/[a-z0-9-]+\/[a-z0-9-]+)'/g)].map((m) => m[1]),
  ),
];

// pageComponentLoaders 中的二级路径：'/settings/<分区>/<页面>': () => import(...)
const registered = [
  ...new Set(
    [...routesSrc.matchAll(/'(\/settings\/[a-z0-9-]+\/[a-z0-9-]+)':\s*\(\)\s*=>/g)].map(
      (m) => m[1],
    ),
  ),
];

// 汇总所有 *Index.tsx 的内容
const indexFiles = [];
let indexSrc = '';
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
    } else if (/Index\.tsx$/.test(e.name)) {
      indexFiles.push(relative('.', p));
      indexSrc += readFileSync(p, 'utf8');
    }
  }
}
walk(PAGES_DIR);

// A) 有 tree 声明，但没有任何 Index 页提供入口卡片
const missingEntry = declared.filter((p) => !ALLOWLIST_NO_ENTRY[p] && !indexSrc.includes(p));

// B) 有 loader 注册，但没在 settingsTree 中声明（孤儿页面）
const orphans = registered.filter((p) => !ALLOWLIST_ORPHAN[p] && !declared.includes(p));

let failed = false;

if (missingEntry.length > 0) {
  failed = true;
  console.error('✗ 以下路径在 settingsTree 中已声明，但没有任何 Index 页提供入口：');
  for (const p of missingEntry) console.error('  ' + p);
  console.error(
    '\n请在对应分区的 *Index.tsx 中补上入口卡片，或加入脚本内 ALLOWLIST_NO_ENTRY 并注明原因。\n',
  );
}

if (orphans.length > 0) {
  failed = true;
  console.error('✗ 以下路径注册了组件 loader，但未在 settingsTree 中声明（孤儿页面）：');
  for (const p of orphans) console.error('  ' + p);
  console.error(
    '\n孤儿页不在搜索索引中、也没有正规导航入口，通常是被遗忘的重复实现。\n' +
      '请将其补进 settingsTree，或删除该页面及其 loader，或加入脚本内 ALLOWLIST_ORPHAN 并注明原因。\n',
  );
}

if (failed) {
  process.exit(1);
}

console.log(
  `✓ 设置入口检查通过（${declared.length} 个二级路径 / ${registered.length} 个 loader / ${indexFiles.length} 个 Index 页）`,
);
process.exit(0);
