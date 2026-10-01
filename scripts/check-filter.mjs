/**
 * Checks the list-filter matching rules.
 *
 * A filter that surprises the user is worse than none, so the semantics (case
 * insensitivity, AND across terms, per-field matching) are pinned here.
 *
 * Usage: node scripts/check-filter.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(
  readFileSync('src/components/ListFilter.tsx', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/ListFilter.mjs', compiled);
const M = await import(pathToFileURL('.verify/ListFilter.mjs').href);

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

console.log('--- 词条切分 ---');
check('空查询无词条', M.queryTerms('   '), []);
check('单个词', M.queryTerms('email'), ['email']);
check('多词按空白切分', M.queryTerms('a b  c'), ['a', 'b', 'c']);
check('统一小写', M.queryTerms('EmAiL'), ['email']);
check('中文不切分', M.queryTerms('邮箱'), ['邮箱']);

console.log('--- 匹配 ---');
const row = ['邮箱', '基础邮箱匹配', '^[\\w.+-]+@[\\w-]+\\.[\\w.]+$'];
check('空查询全部匹配', M.matchesQuery('', row), true);
check('单字段命中', M.matchesQuery('邮箱', row), true);
// The row must actually contain the word for this to test anything; the Chinese
// fields alone would make the assertion pass for the wrong reason.
check('忽略大小写', M.matchesQuery('EMAIL', ['Email 邮箱', '基础匹配']), true);
check('大小写混合查询也命中', M.matchesQuery('EmAiL', ['email']), true);
check('原行不含 email 时确实不匹配', M.matchesQuery('EMAIL', row), false);
check('命中第三字段', M.matchesQuery('\\w', row), true);
check('不匹配时返回 false', M.matchesQuery('zzz', row), false);

console.log('--- 多词是「与」而非「或」 ---');
check('两个词都命中', M.matchesQuery('邮箱 基础', row), true);
check('顺序无关', M.matchesQuery('基础 邮箱', row), true);
check('一个词不命中则整体不命中', M.matchesQuery('邮箱 zzz', row), false);
check('要求同一条目同时满足', M.matchesQuery('axb', ['a', 'b']), false);
{
  // Per-field matching must not create false positives across the boundary.
  check('跨字段拼接不产生假匹配', M.matchesQuery('xy', ['x', 'y']), false);
  check('同一字段内连续才算', M.matchesQuery('xy', ['xy']), true);
}

console.log('--- 字段处理 ---');
check('undefined 字段被跳过', M.matchesQuery('a', ['a', undefined]), true);
check('全 undefined 时不匹配非空查询', M.matchesQuery('a', [undefined, undefined]), false);
check('全 undefined 时空查询仍匹配', M.matchesQuery('', [undefined]), true);
check('空字符串字段不报错', M.matchesQuery('a', ['']), false);

console.log('--- 真实场景（正则速查表）---');
{
  const groups = [
    { title: '字符类', entries: [
      { pattern: '\\d', meaning: '数字，等价 [0-9]' },
      { pattern: '\\w', meaning: '字母、数字或下划线' },
      { pattern: '[\\u4e00-\\u9fa5]', meaning: '常用汉字' },
    ]},
    { title: '量词', entries: [
      { pattern: 'a+', meaning: '1 次或多次' },
      { pattern: 'a{2,4}', meaning: '2 到 4 次' },
    ]},
  ];

  const search = (q) =>
    groups.flatMap((g) => g.entries.filter((e) => M.matchesQuery(q, [e.pattern, e.meaning, g.title])));

  check('搜「数字」命中数量类', search('数字').length >= 2, true);
  check('搜「量词」命中该组全部', search('量词').length, 2);
  check('搜「\\\\d」只命中该模式', search('\\d').length, 1);
  check('搜「汉字」命中中文类', search('汉字').length, 1);
  check('搜不存在的词为空', search('zzzz').length, 0);
  check('中文单字也能搜', search('次').length >= 2, true);
}

console.log('--- 单位换算列表场景 ---');
{
  const units = [
    { id: 'm', label: '米 m' },
    { id: 'km', label: '千米 km' },
    { id: 'mi', label: '英里 mi' },
    { id: 'kg', label: '千克 kg' },
  ];
  const search = (q) => units.filter((u) => M.matchesQuery(q, [u.label, u.id]));
  check('按 id 搜', search('km').map((u) => u.id), ['km']);
  check('按中文搜', search('英里').map((u) => u.id), ['mi']);
  check('按单位符号搜', search('kg').map((u) => u.id), ['kg']);
  check('空查询返回全部', search('').length, 4);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
