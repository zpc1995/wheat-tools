/**
 * Correctness checks for the URL codec.
 *
 * `encodeURIComponent` / `encodeURI` / `URL` are the authoritative references,
 * so every conversion is compared against the platform behaviour rather than a
 * hand-written expectation.
 *
 * Usage: node scripts/check-url.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/url-codec/urlUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const M = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
);

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

console.log('--- 编码：对照平台实现 ---');
const samples = [
  '',
  'abc',
  'a b',
  '中文',
  '😀 emoji',
  'a+b=c',
  'a&b=c?d',
  'https://example.com/path?q=1&r=2#frag',
  '/path/with/slashes',
  '100% legit',
  '~!*()\'-._',
  'line\nbreak',
];
for (const sample of samples) {
  const label = JSON.stringify(sample).slice(0, 40);
  check(`component ${label}`, M.encodeText(sample, 'component'), encodeURIComponent(sample));
  check(`uri ${label}`, M.encodeText(sample, 'uri'), encodeURI(sample));
  // Form encoding: identical to component except space → '+'.
  check(
    `form ${label}`,
    M.encodeText(sample, 'form'),
    encodeURIComponent(sample).replace(/%20/g, '+'),
  );
}

console.log('--- 关键差异点 ---');
check('空格在 component 下是 %20', M.encodeText('a b', 'component'), 'a%20b');
check('空格在 form 下是 +', M.encodeText('a b', 'form'), 'a+b');
check('斜杠在 uri 下保留', M.encodeText('a/b', 'uri'), 'a/b');
check('斜杠在 component 下转义', M.encodeText('a/b', 'component'), 'a%2Fb');
check('& 在 uri 下保留', M.encodeText('a&b', 'uri'), 'a&b');
check('& 在 component 下转义', M.encodeText('a&b', 'component'), 'a%26b');

console.log('--- 解码 ---');
check('解码 component', M.decodeText('a%20b').text, 'a b');
check('解码中文', M.decodeText('%E4%B8%AD%E6%96%87').text, '中文');
check('解码 emoji', M.decodeText(encodeURIComponent('😀')).text, '😀');
check('form 解码 + 为空格', M.decodeForm('a+b').text, 'a b');
check('普通解码不把 + 当空格', M.decodeText('a+b').text, 'a+b');
check('错误：孤立百分号', M.decodeText('%').ok, false);
check('错误：不完整转义', M.decodeText('%E4%B8').ok, false);

console.log('--- 查询串解析 ---');
check('基本键值对', M.parseQuery('a=1&b=2'), [
  { key: 'a', value: '1' },
  { key: 'b', value: '2' },
]);
check('去掉前导 ?', M.parseQuery('?a=1'), [{ key: 'a', value: '1' }]);
check('解码键与值', M.parseQuery('a%20b=c%20d'), [{ key: 'a b', value: 'c d' }]);
check('+ 视为空格', M.parseQuery('a=b+c'), [{ key: 'a', value: 'b c' }]);
check('无值参数', M.parseQuery('flag&a=1'), [
  { key: 'flag', value: '' },
  { key: 'a', value: '1' },
]);
check('空串返回空数组', M.parseQuery(''), []);
check('连续 & 被忽略', M.parseQuery('a=1&&b=2').length, 2);
check('值中可含 =', M.parseQuery('a=b=c'), [{ key: 'a', value: 'b=c' }]);
check('中文键值', M.parseQuery('%E4%B8%AD=%E6%96%87'), [{ key: '中', value: '文' }]);

console.log('--- 查询串重建 ---');
check('重建键值对', M.buildQuery([{ key: 'a', value: '1' }, { key: 'b', value: '2' }]), 'a=1&b=2');
check('重建时转义', M.buildQuery([{ key: 'a b', value: 'c&d' }]), 'a%20b=c%26d');
check('跳过空键', M.buildQuery([{ key: '  ', value: 'x' }, { key: 'a', value: '1' }]), 'a=1');
check(
  '往返一致',
  M.buildQuery(M.parseQuery('a=1&b=%E4%B8%AD%E6%96%87&c=a+b')),
  'a=1&b=%E4%B8%AD%E6%96%87&c=a%20b',
);

console.log('--- URL 结构解析 ---');
const parsed = M.parseUrl('https://user@example.com:8443/a/b?x=1&y=%E4%B8%AD#top');
check('协议', parsed.protocol, 'https:');
check('主机含端口', parsed.host, 'example.com:8443');
check('主机名', parsed.hostname, 'example.com');
check('端口', parsed.port, '8443');
check('路径', parsed.pathname, '/a/b');
check('查询串', parsed.search, '?x=1&y=%E4%B8%AD');
check('锚点', parsed.hash, '#top');
check('用户名', parsed.username, 'user');
check('参数已解码', parsed.params[1], { key: 'y', value: '中' });
check('无协议被拒', M.parseUrl('example.com/a').ok, false);
check('空输入被拒', M.parseUrl('  ').ok, false);
check('默认端口为空串', M.parseUrl('https://example.com/').port, '');

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
