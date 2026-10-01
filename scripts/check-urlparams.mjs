/**
 * Checks the URL query editor.
 *
 * The cases that matter are the ones a naive implementation loses: repeated
 * keys, ordering, valueless keys and re-encoding (which breaks signed URLs).
 *
 * Usage: node scripts/check-urlparams.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/url-params/urlParamsUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/urlParamsUtils.mjs', compiled);
const M = await import(pathToFileURL('.verify/urlParamsUtils.mjs').href);

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

const pairs = (url) => {
  const r = M.parseUrl(url);
  return 'error' in r ? r.error : r.rows.map((row) => [row.key, row.value]);
};

console.log('--- 解析 ---');
check('基本键值', pairs('https://a.com?x=1&y=2'), [['x', '1'], ['y', '2']]);
check('无查询串', pairs('https://a.com/path'), []);
check('空查询串', pairs('https://a.com/path?'), []);
check('空输入报错', typeof M.parseUrl('   ').error, 'string');
{
  const r = M.parseUrl('https://a.com?x=1#frag');
  check('片段被分离', r.hash, '#frag');
  check('片段不影响查询解析', r.rows.map((x) => x.key), ['x']);
  check('base 正确', r.base, 'https://a.com');
}
{
  // A `#` inside the query must not be mistaken for the fragment.
  const r = M.parseUrl('https://a.com?q=a#b&x=1');
  check('查询中的 # 视为片段起点（符合规范）', r.rows.map((x) => [x.key, x.value]), [['q', 'a']]);
}
check('百分号解码', pairs('https://a.com?name=%E4%B8%AD%E6%96%87'), [['name', '中文']]);
check('加号解码为空格', pairs('https://a.com?q=hello+world'), [['q', 'hello world']]);
check('无值键被保留', pairs('https://a.com?debug'), [['debug', '']]);
check('空值键被保留', pairs('https://a.com?limit='), [['limit', '']]);

console.log('--- 重复键与顺序（对象模型会丢数据的地方）---');
{
  const r = M.parseUrl('https://a.com?tag=a&tag=b&tag=c');
  check('重复键全部保留', r.rows.length, 3);
  check('重复键值正确', r.rows.map((x) => x.value), ['a', 'b', 'c']);
  check('重复键被标记', r.rows.every((x) => x.duplicate), true);
}
check('顺序被保留', pairs('https://a.com?z=1&a=2&m=3'), [['z', '1'], ['a', '2'], ['m', '3']]);
check(
  '重复键与非重复键共存',
  pairs('https://a.com?a=1&b=2&a=3'),
  [['a', '1'], ['b', '2'], ['a', '3']],
);

console.log('--- 重建 ---');
{
  const r = M.parseUrl('https://a.com?x=1&y=2');
  check('重建一致', M.buildUrl(r, r.rows), 'https://a.com?x=1&y=2');
}
{
  const r = M.parseUrl('https://a.com?x=1&y=2#frag');
  check('片段被保留', M.buildUrl(r, r.rows), 'https://a.com?x=1&y=2#frag');
}
{
  const r = M.parseUrl('https://a.com');
  check('无参数时不加问号', M.buildUrl(r, r.rows), 'https://a.com');
}
{
  const r = M.parseUrl('https://a.com?debug');
  check('无值键默认保留为无值', M.buildUrl(r, r.rows), 'https://a.com?debug');
}
{
  const r = M.parseUrl('https://a.com?limit=');
  check('空值键保留等号', M.buildUrl(r, r.rows), 'https://a.com?limit=');
}
{
  const r = M.parseUrl('https://a.com?a=1');
  const rows = [...r.rows, M.makeParam('b', 'x y')];
  check('新增参数被编码', M.buildUrl(r, rows), 'https://a.com?a=1&b=x%20y');
}
{
  const r = M.parseUrl('https://a.com?tag=a&tag=b');
  check('重复键重建后仍是重复键', M.buildUrl(r, r.rows), 'https://a.com?tag=a&tag=b');
}
{
  const r = M.parseUrl('https://a.com?q=%E4%B8%AD%E6%96%87');
  check('中文被重新编码', M.buildUrl(r, r.rows), 'https://a.com?q=%E4%B8%AD%E6%96%87');
}
{
  const r = M.parseUrl('https://a.com?q=a%2Bb');
  check('编码后的加号不被当成空格', r.rows[0].value, 'a+b');
  check('并重新编码为 %2B', M.buildUrl(r, r.rows), 'https://a.com?q=a%2Bb');
}
{
  const r = M.parseUrl('https://a.com?empty=&full=1');
  const withoutEmptyKey = [...r.rows, M.makeParam('', 'ignored')];
  check('空键默认被丢弃', M.buildUrl(r, withoutEmptyKey), 'https://a.com?empty=&full=1');
}

console.log('--- 不重新编码（签名 URL 需要）---');
{
  // Re-encoding would change bytes a signature covers, so raw mode must be
  // byte-exact for what was typed.
  const r = M.parseUrl('https://a.com?X-Signature=aB3%2FdE%2Bf%3D%3D&Expires=1');
  const raw = M.buildUrl(r, r.rows, { ...M.DEFAULT_BUILD_OPTIONS, encode: false });
  check('原始编码被保留', raw, 'https://a.com?X-Signature=aB3%2FdE%2Bf%3D%3D&Expires=1');
}
{
  // `+` decodes to a space, so re-encoding would emit %20 and change the bytes.
  // Raw mode must reproduce the original `+` — this is the whole point.
  const r = M.parseUrl('https://a.com?q=hello+world');
  const raw = M.buildUrl(r, r.rows, { ...M.DEFAULT_BUILD_OPTIONS, encode: false });
  check('+ 在原始模式下保持不变', raw, 'https://a.com?q=hello+world');
}
{
  const r = M.parseUrl('https://a.com?a=%20&b=+');
  const raw = M.buildUrl(r, r.rows, { ...M.DEFAULT_BUILD_OPTIONS, encode: false });
  check('%20 与 + 各自保持原样', raw, 'https://a.com?a=%20&b=+');
}
{
  // Editing a value must win over the stale original encoding.
  const r = M.parseUrl('https://a.com?q=old%20value');
  const edited = r.rows.map((row) => ({ ...row, value: 'new value' }));
  const raw = M.buildUrl(r, edited, { ...M.DEFAULT_BUILD_OPTIONS, encode: false });
  check('原始模式下编辑生效', raw, 'https://a.com?q=new value');
}
{
  const r = M.parseUrl('https://a.com?q=untouched%20value');
  const raw = M.buildUrl(r, r.rows, { ...M.DEFAULT_BUILD_OPTIONS, encode: false });
  check('未编辑时保留原始编码而非解码值', raw, 'https://a.com?q=untouched%20value');
}

console.log('--- 结构拆解 ---');
{
  const b = M.breakdown('https://user:pass@api.example.com:8443/v1/items?a=1#top');
  check('协议', b.protocol, 'https:');
  check('用户名', b.username, 'user');
  check('主机', b.host, 'api.example.com');
  check('端口', b.port, '8443');
  check('路径', b.path, '/v1/items');
  check('片段', b.fragment, '#top');
  check('标记为绝对地址', b.absolute, true);
}
{
  const b = M.breakdown('?a=1');
  check('非绝对地址不抛错', b.absolute, false);
  check('非绝对地址给出路径部分', b.path, '');
}

console.log('--- 参数对比 ---');
{
  const a = M.parseUrl('https://x.com?a=1&b=2&c=3');
  const b = M.parseUrl('https://x.com?a=1&b=9&d=4');
  const diff = M.diffParams(a.rows, b.rows);
  check('仅 A 有的键', diff.onlyInA.map((r) => r.key), ['c']);
  check('仅 B 有的键', diff.onlyInB.map((r) => r.key), ['d']);
  check('变化项', diff.changed, [{ key: 'b', from: '2', to: '9' }]);
  check('相同项', diff.same, ['a']);
}
{
  // Repeated keys must compare as a unit, not as separate entries.
  const a = M.parseUrl('https://x.com?tag=a&tag=b');
  const b = M.parseUrl('https://x.com?tag=a&tag=c');
  const diff = M.diffParams(a.rows, b.rows);
  check('重复键整体比较', diff.changed.length, 1);
  check('重复键变化内容', diff.changed[0], { key: 'tag', from: 'a, b', to: 'a, c' });
}
{
  const a = M.parseUrl('https://x.com?tag=a&tag=b');
  const diff = M.diffParams(a.rows, a.rows);
  check('相同输入无差异', [diff.onlyInA.length, diff.onlyInB.length, diff.changed.length], [0, 0, 0]);
  check('相同输入相同项', diff.same, ['tag']);
}

console.log('--- 跟踪参数清理 ---');
{
  const r = M.parseUrl('https://x.com/p?id=42&utm_source=wb&utm_medium=s&fbclid=z&keep=1');
  const { rows, removed } = M.stripTracking(r.rows);
  check('移除数量', removed, 3);
  check('保留非跟踪参数', rows.map((x) => x.key), ['id', 'keep']);
}
check(
  '跟踪参数清单含常见项',
  ['utm_source', 'fbclid', 'gclid', 'ref'].every((p) => M.TRACKING_PARAMS.includes(p)),
  true,
);
{
  const r = M.parseUrl('https://x.com?ID=1&Keep=2');
  const { removed } = M.stripTracking(r.rows);
  check('无跟踪参数时不误删', removed, 0);
}

console.log('--- 输入的容错 ---');
check('只粘贴查询串', M.normaliseInput('a=1&b=2'), 'https://example.invalid/?a=1&b=2');
check('以 ? 开头', M.normaliseInput('?a=1'), 'https://example.invalid/?a=1');
check('完整地址不变', M.normaliseInput('https://a.com?x=1'), 'https://a.com?x=1');
check('路径开头不变', M.normaliseInput('/api/v1?x=1'), '/api/v1?x=1');
check('空串不变', M.normaliseInput('  '), '');

console.log('--- 统计 ---');
{
  const r = M.parseUrl('https://x.com?a=1&a=2&b=&c=3');
  const built = M.buildUrl(r, r.rows);
  const stats = M.collectStats(r.rows, built);
  check('总数', stats.total, 4);
  check('重复键组数', stats.duplicates, 1);
  check('空值数', stats.emptyValues, 1);
  check('查询串长度与实际一致', stats.queryLength, built.length - built.indexOf('?') - 1);
}
{
  const stats = M.collectStats([], 'https://x.com');
  check('无参数时长度为 0', stats.queryLength, 0);
}

console.log('--- 示例数据 ---');
{
  let allOk = true;
  for (const sample of M.URL_EDITOR_SAMPLES) {
    const r = M.parseUrl(sample.url);
    if ('error' in r) {
      allOk = false;
      console.log('  示例解析失败:', sample.url);
      continue;
    }
    const rebuilt = M.buildUrl(r, r.rows);
    if (!rebuilt.startsWith(r.base)) {
      allOk = false;
      console.log('  示例重建异常:', sample.url, '→', rebuilt);
    }
  }
  check('全部示例可解析且可重建', allOk, true);
  check('示例都带说明', M.URL_EDITOR_SAMPLES.every((s) => s.note), true);
}

console.log('--- 往返一致性（对可安全编码的输入）---');
{
  const cases = [
    'https://a.com?x=1&y=2',
    'https://a.com?tag=a&tag=b',
    'https://a.com?debug&limit=',
    'https://a.com?name=%E4%B8%AD%E6%96%87&x=1',
    'https://a.com/path?a=1#frag',
    'https://a.com?a=%2B%2F%3D',
    'https://a.com',
  ];
  let ok = true;
  for (const url of cases) {
    const first = M.parseUrl(url);
    if ('error' in first) { ok = false; console.log('  解析失败:', url); continue; }
    const rebuilt = M.buildUrl(first, first.rows);
    const second = M.parseUrl(rebuilt);
    if ('error' in second) { ok = false; console.log('  重建后解析失败:', rebuilt); continue; }
    const same = JSON.stringify(first.rows.map((r) => [r.key, r.value, r.valueless]))
      === JSON.stringify(second.rows.map((r) => [r.key, r.value, r.valueless]));
    if (!same) { ok = false; console.log('  往返不一致:', url, '→', rebuilt); }
  }
  check('解析 → 重建 → 再解析 结果一致', ok, true);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
