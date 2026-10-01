/**
 * Checks usage ranking and the category limit.
 *
 * The sidebar's 「常用工具」 section is the user's own shortcut list, so its
 * ordering has to be exactly "most opened first", capped at the configured
 * number. Both are asserted here rather than eyeballed.
 *
 * Usage: node scripts/check-usage.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/usage.ts', 'utf8');
// The module imports React hooks; only the pure helpers are exercised here, so
// the import is stubbed out rather than pulling React into the test.
const stubbed = source.replace(
  /import \{([^}]*)\} from 'react';/,
  'const useCallback = (fn) => fn; const useEffect = () => {}; const useMemo = (f) => f(); const useState = (v) => [typeof v === "function" ? v() : v, () => {}];',
);

const compiled = ts.transpileModule(stubbed, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/usage.mjs', compiled);
const M = await import(pathToFileURL('.verify/usage.mjs').href);

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}

const stats = (opens, lastUsedAt = {}) => ({
  opens,
  lastUsedAt,
  recent: [],
  favorites: [],
});

console.log('--- 按使用次数排序 ---');
check(
  '次数多的在前',
  M.rankByUsage(['a', 'b', 'c'], stats({ a: 1, b: 9, c: 5 })),
  ['b', 'c', 'a'],
);
check(
  '次数的数量级正确（不是字典序）',
  M.rankByUsage(['a', 'b'], stats({ a: 10, b: 9 })),
  ['a', 'b'],
);
check(
  '未使用过的排在最后',
  M.rankByUsage(['a', 'b', 'c'], stats({ b: 2 })),
  ['b', 'a', 'c'],
);
check('全部未使用时保持原顺序', M.rankByUsage(['a', 'b', 'c'], stats({})), ['a', 'b', 'c']);

console.log('--- 次数相同时按最近使用 ---');
check(
  '相同次数时最近的在前',
  M.rankByUsage(['a', 'b', 'c'], stats({ a: 3, b: 3, c: 3 }, { a: 100, b: 300, c: 200 })),
  ['b', 'c', 'a'],
);
check(
  '次数优先于最近使用',
  M.rankByUsage(['a', 'b'], stats({ a: 1, b: 5 }, { a: 999, b: 1 })),
  ['b', 'a'],
);
check(
  '次数为 0 与缺失视为相同',
  M.rankByUsage(['a', 'b'], stats({ a: 0 }, { a: 1, b: 2 })),
  ['b', 'a'],
);

console.log('--- 上限 ---');
{
  const ids = Array.from({ length: 25 }, (_, i) => `t${i}`);
  const opens = Object.fromEntries(ids.map((id, i) => [id, 25 - i]));
  check('不传上限时返回全部', M.rankByUsage(ids, stats(opens)).length, 25);
  check('上限 10 只返回 10 个', M.rankByUsage(ids, stats(opens), 10).length, 10);
  check(
    '截取的是使用次数最高的 10 个',
    M.rankByUsage(ids, stats(opens), 10).slice(0, 3),
    ['t0', 't1', 't2'],
  );
  check(
    '第 10 名是次数第 10 高的',
    M.rankByUsage(ids, stats(opens), 10)[9],
    't9',
  );
  check('上限大于数量时返回全部', M.rankByUsage(ids.slice(0, 3), stats({}), 10).length, 3);
}
check('上限 0 返回空数组', M.rankByUsage(['a', 'b'], stats({ a: 1 }), 0), []);

console.log('--- 列表可少于上限 ---');
check('只有 2 个工具时返回 2 个', M.rankByUsage(['a', 'b'], stats({ a: 1 }), 10).length, 2);
check('空列表安全', M.rankByUsage([], stats({ a: 1 }), 10), []);

console.log('--- 分类配置 ---');
{
  const categoriesSource = readFileSync('src/tools/categories.ts', 'utf8');
  const limitMatch = /id: 'common'[^}]*limit:\s*(\d+)/.exec(categoriesSource);
  check('常用工具上限为 10', limitMatch ? Number(limitMatch[1]) : null, 10);
  check(
    '常用工具是虚拟分类',
    /id: 'common'[^}]*virtual:\s*true/.test(categoriesSource),
    true,
  );
}
{
  // The sidebar must actually pass that limit through, otherwise the cap would
  // exist only in the config.
  const sidebar = readFileSync('src/app/LauncherSidebar.tsx', 'utf8');
  check(
    '侧边栏使用了分类里的上限',
    /categoryMeta\('common'\)\.limit/.test(sidebar),
    true,
  );
}

console.log('--- 输入清洗 ---');
check('不会修改传入数组', (() => {
  const input = ['a', 'b'];
  M.rankByUsage(input, stats({ b: 1 }));
  return input;
})(), ['a', 'b']);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
