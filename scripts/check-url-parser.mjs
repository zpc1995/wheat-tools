/**
 * Checks the URL analyzer.
 *
 * The authority here is the platform parser itself. Every field the analyzer
 * reports is compared, one by one, against the same field read straight off a
 * freshly constructed `new URL()` for a large and deliberately awkward sample
 * set — userinfo containing `@` and `:`, IPv6 literals, paths that start with
 * `//`, empty and malformed query pieces, IDN hosts, opaque schemes.
 *
 * Two claims get their own adversarial treatment:
 *
 *   1. "The query segment must be decoded with form rules, not
 *      decodeURIComponent." The check computes both and asserts they disagree
 *      on the `+` case, and that the analyzer agrees with `URLSearchParams`.
 *   2. "Splitting a URL with a regular expression is wrong." Small, honest
 *      regex-based parsers are implemented below and run over the same samples;
 *      the check asserts they really do produce different (wrong) answers for
 *      the credential, IPv6 and double-slash cases, so the sample set is proven
 *      to be discriminating rather than merely passing.
 *
 * The hand-written Punycode decoder is checked against the platform's own
 * `domainToUnicode`, which is the independent oracle for that piece.
 *
 * Usage: node scripts/check-url-parser.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, domainToUnicode, domainToASCII } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/url-parser/urlParserUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/url-parser.mjs', compiled);
const M = await import(pathToFileURL('.verify/url-parser.mjs').href);

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

/** The reference fields, read independently off a native URL object. */
function nativeFields(url, base) {
  const parsed = base === undefined ? new URL(url) : new URL(url, base);
  return {
    protocol: parsed.protocol,
    username: parsed.username,
    password: parsed.password,
    host: parsed.host,
    hostname: parsed.hostname,
    port: parsed.port,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    origin: parsed.origin,
    href: parsed.href,
  };
}

/* ------------------------------------------------------------------ */
/* 1. Field-for-field parity with the native parser                    */
/* ------------------------------------------------------------------ */

console.log('--- 与原生 new URL() 逐字段一致 ---');

const SAMPLES = [
  'https://example.com',
  'https://example.com/',
  'http://example.com:80/',
  'https://example.com:443/',
  'https://example.com:8443/',
  'https://example.com:00080/',
  'https://user@name:pass@example.com/path',
  'http://user:p@ss@host.example:8080/p?q=1#f',
  'http://[::1]:8080/x',
  'http://[2001:db8::1]/',
  'http://[2001:db8::1]:8080/a//b?x=1',
  'https://example.com/a//b',
  'https://example.com//double',
  'https://example.com/path?q=a+b&r=a%2Bb',
  'https://example.com/?a&a=&a=1&b=2&b=2',
  'https://example.com/?a=1&&b=2&',
  'https://example.com/?=novaluekey&k=',
  'https://例え.テスト/パス?q=値#片',
  'https://example.com/#/route/deep?x=1',
  'https://example.com/?next=https%3A%2F%2Fevil.com%2Fx',
  'https://example.com/?next=//evil.example/x',
  'mailto:someone@example.com',
  'data:text/plain,hi',
  'tel:+8613800138000',
  'javascript:alert(1)',
  'file:///home/wheet/x.txt',
  'https://example.com/%E4%B8%AD%20%E6%96%87',
  'https://example.com/path%2Fwith%2Fslash',
  'https://xn--fiqs8s.cn/',
  'HTTPS://EXAMPLE.COM/PaTh?Q=1#H',
  'https://example.com./',
  'https://example.com/🎉?q=😀',
  'https://example.com/%E4%',
  'https://example.com/?utm_source=x&utm_medium=y&fbclid=z&keep=1&keep=2',
  'https://example.com/p?' + 'k=' + 'v'.repeat(2000),
];

{
  let mismatches = 0;
  let fieldCount = 0;
  const mismatched = [];
  for (const url of SAMPLES) {
    const actual = M.analyzeUrl(url);
    const expected = nativeFields(url);
    if (!actual.ok) {
      mismatches += 1;
      mismatched.push(`${url} -> ok=false`);
      continue;
    }
    for (const key of Object.keys(expected)) {
      fieldCount += 1;
      if (actual.fields[key] !== expected[key]) {
        mismatches += 1;
        mismatched.push(`${url} .${key}: ${actual.fields[key]} !== ${expected[key]}`);
      }
    }
  }
  check(`${SAMPLES.length} 个样本共 ${fieldCount} 个字段与原生实现完全一致`, mismatches, 0);
  if (mismatched.length > 0) console.log('        ' + mismatched.slice(0, 5).join('\n        '));
}

/* ------------------------------------------------------------------ */
/* 2. Relative inputs resolved against a base                          */
/* ------------------------------------------------------------------ */

console.log('--- 相对地址配合 base ---');

{
  const BASE = 'https://base.example/dir/page?z=1';
  const relatives = ['/a/b?c=d', '?q=1', '#frag', '../up/../here', 'sub/dir', '//other.example/x', 'a:b', ''];

  let mismatches = 0;
  for (const input of relatives) {
    if (input === '') continue;
    let expected = null;
    let threw = false;
    try {
      expected = nativeFields(input, BASE);
    } catch {
      threw = true;
    }
    const actual = M.analyzeUrl(input, BASE);
    if (threw) {
      if (actual.ok) mismatches += 1;
      continue;
    }
    if (!actual.ok) {
      mismatches += 1;
      continue;
    }
    for (const key of Object.keys(expected)) {
      if (actual.fields[key] !== expected[key]) mismatches += 1;
    }
  }
  check('7 个相对地址按 base 解析后与原生实现完全一致', mismatches, 0);

  const absolute = M.analyzeUrl('/a/b?c=d', BASE);
  check('相对地址标记为使用了 base', absolute.usedBase, true);
  check('相对地址的 hostname 来自 base', absolute.fields.hostname, 'base.example');
  check('相对地址的 pathname 被替换', absolute.fields.pathname, '/a/b');
  check('相对地址的 search 被替换', absolute.fields.search, '?c=d');

  const queryOnly = M.analyzeUrl('?q=1', BASE);
  check('只有查询串时保留 base 的路径', queryOnly.fields.pathname, '/dir/page');
  check('只有查询串时替换 base 的查询', queryOnly.fields.search, '?q=1');

  const hashOnly = M.analyzeUrl('#frag', BASE);
  check('只有片段时保留 base 的路径', hashOnly.fields.pathname, '/dir/page');
  check('只有片段时保留 base 的查询', hashOnly.fields.search, '?z=1');
  check('只有片段时替换片段', hashOnly.fields.hash, '#frag');

  const protocolRelative = M.analyzeUrl('//other.example/x', BASE);
  check('协议相对地址继承 base 的协议', protocolRelative.fields.protocol, 'https:');
  check('协议相对地址使用自己的主机', protocolRelative.fields.hostname, 'other.example');

  check('没有 base 时拒绝相对地址', M.analyzeUrl('/a/b').ok, false);
  check('没有 base 时拒绝只有查询串的输入', M.analyzeUrl('?q=1').ok, false);
  check('绝对地址不需要 base', M.analyzeUrl('https://a.example/').ok, true);

  // The platform rejects an invalid base even when the input is absolute; the
  // analyzer must not quietly paper over that and invent a result.
  let platformThrew = false;
  try {
    new URL('https://a.example/', 'not a base');
  } catch {
    platformThrew = true;
  }
  check('非法 base 时原生实现会抛错', platformThrew, true);
  check('非法 base 时本实现同样报错（行为一致，不掩盖）', M.analyzeUrl('https://a.example/', 'not a base').ok, false);
}

/* ------------------------------------------------------------------ */
/* 3. Decoding: which segment gets which rule                          */
/* ------------------------------------------------------------------ */

console.log('--- 逐段解码规则 ---');

{
  const r = M.analyzeUrl('https://example.com/a+b%2Fc?q=a+b&r=a%2Bb#x+y%2Fz');
  const byKey = Object.fromEntries(r.segments.map((s) => [s.key, s]));

  check('路径用百分号解码，+ 保持为 +', byKey.pathname.decoded, '/a+b/c');
  check('路径里的 %2F 解成 /，但不产生新的路径层级', byKey.pathname.decoded.split('/').length, 3);
  check('查询用表单解码，+ 变成空格', byKey.search.decoded, 'q=a b&r=a+b');
  check('片段用百分号解码，+ 保持为 +', byKey.hash.decoded, '#x+y/z');
  check('三段都没有解码错误', r.segments.filter((s) => s.error).length, 0);

  // The claim under test: decodeURIComponent is the wrong tool for a query.
  check('用 decodeURIComponent 处理查询会得到错误结果（反证）', decodeURIComponent('q=a+b'), 'q=a+b');
  check('URLSearchParams 才是查询的权威', new URLSearchParams('q=a+b').get('q'), 'a b');
  check('本实现的查询解码与 URLSearchParams 一致', byKey.search.decoded, [...new URLSearchParams('q=a+b&r=a%2Bb')].map(([k, v]) => `${k}=${v}`).join('&'));

  // Full parity between the raw query scanner and URLSearchParams on the odd
  // shapes: empty pieces, missing equals, repeated keys.
  const searches = ['?a&a=&a=1&b=2&b=2', '?=novaluekey&k=', '?a=1&&b=2&', '?=x', '?%E4%B8%AD=%F0%9F%8E%89', '?a=1=2'];
  let queryMismatches = 0;
  for (const search of searches) {
    const native = [...new URLSearchParams(search)];
    const mine = M.parseQuery(search);
    if (native.length !== mine.length) {
      queryMismatches += 1;
      continue;
    }
    for (let i = 0; i < native.length; i += 1) {
      if (native[i][0] !== mine[i].key) queryMismatches += 1;
      if (native[i][1] !== (mine[i].value ?? '')) queryMismatches += 1;
    }
  }
  check('6 个畸形查询串的键值均与 URLSearchParams 一致', queryMismatches, 0);

  const distinctions = M.parseQuery('?a&a=&a=1&b&b=');
  check('无值键与空值键被区分开', distinctions.map((p) => [p.key, p.hasEquals, p.value]), [
    ['a', false, null],
    ['a', true, ''],
    ['a', true, '1'],
    ['b', false, null],
    ['b', true, ''],
  ]);
  check('原生 URLSearchParams 无法区分这两者（反证）', [...new URLSearchParams('?a&a=')].map(([, v]) => v), ['', '']);
  check('重复键标出首次出现的位置', distinctions.map((p) => p.duplicateOf), [null, 0, 0, null, 3]);

  const malformed = M.analyzeUrl('https://example.com/%E4%');
  check('路径里不完整的百分号转义被报告', malformed.segments.find((s) => s.key === 'pathname').error !== null, true);
  check('不完整转义会产生诊断', malformed.diagnostics.some((d) => d.id === 'malformed-pathname'), true);
  check('解析器仍保留原始文本', malformed.segments.find((s) => s.key === 'pathname').decoded, '/%E4%');
}

/* ------------------------------------------------------------------ */
/* 4. Redundant default ports (invisible to the parsed object)         */
/* ------------------------------------------------------------------ */

console.log('--- 冗余默认端口 ---');

check('http:80 被识别为冗余，且 .port 已被规范化掉', [M.analyzeUrl('http://a.example:80/').redundantPort, M.analyzeUrl('http://a.example:80/').fields.port], [80, '']);
check('https:443 被识别为冗余', M.analyzeUrl('https://a.example:443/').redundantPort, 443);
check('带前导零的 00080 也识别为冗余', M.analyzeUrl('http://a.example:00080/').redundantPort, 80);
check('非默认端口不算冗余', M.analyzeUrl('https://a.example:8443/').redundantPort, null);
check('非默认端口保留在 .port 中', M.analyzeUrl('https://a.example:8443/').fields.port, '8443');
check('websocket 的 80 也算冗余', M.analyzeUrl('ws://a.example:80/x').redundantPort, 80);
check('冗余端口会产生诊断', M.analyzeUrl('https://a.example:443/').diagnostics.some((d) => d.id === 'redundant-port'), true);
check('密码里的冒号不会误判', M.analyzeUrl('https://user:p:80@a.example/').redundantPort, null);
check('用户信息里的 :443 不会被当成端口', M.analyzeUrl('https://a.example:443@evil.example/').redundantPort, null);
check('用户信息里的 :443 确实属于用户信息', M.analyzeUrl('https://a.example:443@evil.example/').fields.hostname, 'evil.example');
check('IPv6 字面量里的冒号不会被当成端口', M.analyzeUrl('http://[2001:db8::1]:8080/').redundantPort, null);
check('IPv6 字面量 + 默认端口仍能识别', M.analyzeUrl('http://[::1]:80/').redundantPort, 80);
check('规范化后的 href 去掉了默认端口', M.analyzeUrl('http://a.example:80/').fields.href, 'http://a.example/');
// Proof that the raw text is the only place this information exists:
check('原生对象的 href 已经丢失了默认端口（反证）', new URL('http://a.example:80/').href, 'http://a.example/');
check('原生对象的 port 也已经为空（反证）', new URL('http://a.example:80/').port, '');
check('独立函数在原始文本上能找到它', M.findRedundantDefaultPort('http://a.example:80/p?q=1#f', 'http:'), 80);

/* ------------------------------------------------------------------ */
/* 5. Regex parsing is wrong: the reverse proofs                       */
/* ------------------------------------------------------------------ */

console.log('--- 反证：用正则拆 URL 会出错 ---');

/** A naive parser: scheme, authority, path, query, fragment; splits userinfo at the FIRST @. */
function naiveParse(url) {
  const match = /^(\w+):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url);
  if (!match) return null;
  const [, protocol, authority, pathname, search = '', hash = ''] = match;
  const at = authority.indexOf('@');
  const userinfo = at >= 0 ? authority.slice(0, at) : '';
  const host = at >= 0 ? authority.slice(at + 1) : authority;
  const colon = userinfo.indexOf(':');
  const username = colon >= 0 ? userinfo.slice(0, colon) : userinfo;
  const password = colon >= 0 ? userinfo.slice(colon + 1) : '';
  const hostColon = host.indexOf(':');
  return {
    protocol: `${protocol}:`,
    username,
    password,
    hostname: hostColon >= 0 ? host.slice(0, hostColon) : host,
    port: hostColon >= 0 ? host.slice(hostColon + 1) : '',
    pathname: pathname === '' ? '/' : pathname,
    search,
    hash,
  };
}

/** A very common naive approach: split the whole string on the two slashes. */
function naiveSplitDoubleSlash(url) {
  const parts = url.split('//');
  return { scheme: `${parts[0]}`, host: (parts[1] ?? '').split('/')[0], rest: parts.slice(1).join('//') };
}

/** Another common one: the path starts at the first slash after the scheme. */
function naiveFirstSlashPath(url) {
  const afterScheme = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  const slash = afterScheme.indexOf('/');
  return slash < 0 ? '' : afterScheme.slice(slash);
}

{
  const credential = 'https://user@name:pass@example.com/path';
  const native = nativeFields(credential);
  const naive = naiveParse(credential);
  check('原生实现把第一个 @ 编码进用户名', native.username, 'user%40name');
  check('原生实现的密码是 pass', native.password, 'pass');
  check('原生实现的主机是 example.com', native.hostname, 'example.com');
  check('正则实现把主机错认成 name（反证成立）', naive.hostname, 'name');
  check('正则实现把端口错认成 pass@example.com（反证成立）', naive.port, 'pass@example.com');
  check('正则实现确实与本实现不一致（反证成立）', naive.hostname !== native.hostname, true);
  check('本实现与原生一致', M.analyzeUrl(credential).fields.hostname, native.hostname);
  check('本实现与原生一致（用户名）', M.analyzeUrl(credential).fields.username, native.username);

  const passwordAt = 'http://user:p@ss@host.example:8080/p';
  const nativeAt = nativeFields(passwordAt);
  const naiveAt = naiveParse(passwordAt);
  check('密码里的 @ 被原生编码为 %40', nativeAt.password, 'p%40ss');
  check('正则实现在密码含 @ 时结论不同（反证成立）', naiveAt.hostname !== nativeAt.hostname, true);
  check('本实现在密码含 @ 时与原生一致', M.analyzeUrl(passwordAt).fields.hostname, 'host.example');

  const ipv6 = 'http://[::1]:8080/x';
  const nativeV6 = nativeFields(ipv6);
  const naiveV6 = naiveParse(ipv6);
  check('原生实现的 IPv6 主机名含方括号', nativeV6.hostname, '[::1]');
  check('原生实现的 IPv6 端口为 8080', nativeV6.port, '8080');
  check('正则实现在 IPv6 上把主机截成 [（反证成立）', naiveV6.hostname, '[');
  check('正则实现在 IPv6 上得不到正确端口（反证成立）', naiveV6.port !== nativeV6.port, true);
  check('本实现在 IPv6 上与原生一致', M.analyzeUrl(ipv6).fields.host, nativeV6.host);
  check('本实现识别出 IPv6 主机', M.analyzeUrl(ipv6).isIpv6Host, true);

  const doubleSlash = 'https://example.com/a//b';
  const naiveRest = naiveSplitDoubleSlash(doubleSlash);
  check('原生实现的路径保留双斜杠', nativeFields(doubleSlash).pathname, '/a//b');
  check('split(//) 得到的剩余部分混进了主机名（反证成立）', naiveRest.rest, 'example.com/a//b');
  check('split(//) 的剩余部分不等于原生路径（反证成立）', naiveRest.rest === nativeFields(doubleSlash).pathname, false);
  check('本实现保留双斜杠路径', M.analyzeUrl(doubleSlash).fields.pathname, '/a//b');

  const leadingDouble = 'https://example.com//double';
  const naiveLeading = naiveSplitDoubleSlash(leadingDouble);
  check('原生实现的路径以双斜杠开头', nativeFields(leadingDouble).pathname, '//double');
  check('split(//) 把前导双斜杠并进了主机段（反证成立）', naiveLeading.rest, 'example.com//double');
  check('split(//) 的剩余部分不等于原生路径（反证成立）', naiveLeading.rest === nativeFields(leadingDouble).pathname, false);
  check('本实现保留前导双斜杠', M.analyzeUrl(leadingDouble).fields.pathname, '//double');

  const querySlash = 'https://example.com/p?next=//evil.example/x';
  const naiveQueryPath = naiveFirstSlashPath(querySlash);
  const nativeQuery = nativeFields(querySlash);
  check('原生实现的路径是 /p', nativeQuery.pathname, '/p');
  check('原生实现的查询里含双斜杠', nativeQuery.search, '?next=//evil.example/x');
  check('按第一个斜杠取路径会把查询当成路径（反证成立）', naiveQueryPath, '/p?next=//evil.example/x');
  check('该反证确实与本实现不同', naiveQueryPath !== nativeQuery.pathname, true);
  check('本实现的路径正确', M.analyzeUrl(querySlash).fields.pathname, '/p');
  check('本实现把 // 记为嵌套 URL 风险', M.analyzeUrl(querySlash).diagnostics.some((d) => d.id === 'nested-url'), true);

  // The naive query decoder: split on & then on =, decode with decodeURIComponent.
  const naiveQueryDecode = (search) =>
    Object.fromEntries(
      search.replace(/^\?/, '').split('&').map((pair) => {
        const [k, v = ''] = pair.split('=');
        return [decodeURIComponent(k), decodeURIComponent(v)];
      }),
    );
  check('朴素的 decodeURIComponent 查询解析给出 q=a+b（反证成立）', naiveQueryDecode('?q=a+b').q, 'a+b');
  check('原生 URLSearchParams 给出 q=a b', new URLSearchParams('?q=a+b').get('q'), 'a b');
  check('本实现给出 q=a b', M.parseQuery('?q=a+b')[0].value, 'a b');
}

/* ------------------------------------------------------------------ */
/* 6. Punycode decoding against the platform oracle                    */
/* ------------------------------------------------------------------ */

console.log('--- Punycode 解码（与平台 domainToUnicode 对照） ---');

{
  const hosts = ['xn--fiqs8s.cn', 'xn--r8jz45g.xn--zckzah', 'xn--bcher-kva.de', 'xn--fa-hia.de', 'xn--fiqs8s', 'www.xn--fiqs8s.cn'];
  let mismatches = 0;
  for (const host of hosts) {
    const mine = M.toUnicodeHostname(host);
    const oracle = domainToUnicode(host);
    if (mine !== oracle) {
      mismatches += 1;
      console.log(`        ${host}: ${mine} !== ${oracle}`);
    }
  }
  check('6 个 Punycode 主机名解码结果与平台 domainToUnicode 一致', mismatches, 0);
  check('中文域名解码', M.toUnicodeHostname('xn--fiqs8s.cn'), '中国.cn');
  check('日文域名解码', M.toUnicodeHostname('xn--r8jz45g.xn--zckzah'), '例え.テスト');
  check('德语变音域名解码', M.toUnicodeHostname('xn--bcher-kva.de'), 'bücher.de');
  check('非 Punycode 主机名返回 null（没有可展示的 Unicode 形式）', M.toUnicodeHostname('example.com'), null);
  check('空主机名返回 null', M.toUnicodeHostname(''), null);
  check('损坏的 xn-- 标签不会崩溃且返回 null', M.toUnicodeHostname('xn--'), null);
  check('混合主机的非 Punycode 标签原样保留', M.toUnicodeHostname('www.xn--fiqs8s.cn'), 'www.中国.cn');
  check('平台 oracle 的往返一致', domainToASCII(domainToUnicode('xn--fiqs8s.cn')), 'xn--fiqs8s.cn');

  const idn = M.analyzeUrl('https://例え.テスト/パス');
  check('IDN 输入被平台转成 Punycode', idn.asciiHostname, 'xn--r8jz45g.xn--zckzah');
  check('IDN 输入的原样形态被记录', idn.rawHostHadNonAscii, true);
  check('IDN 输入会给出针对性诊断', idn.diagnostics.some((d) => d.id === 'idn-input'), true);
  check('IDN 的 Unicode 形式可读回', idn.unicodeHostname, '例え.テスト');

  const punycodeOnly = M.analyzeUrl('https://xn--fiqs8s.cn/');
  check('直接输入 Punycode 会被识别', punycodeOnly.diagnostics.some((d) => d.id === 'punycode'), true);
  check('Punycode 输入解码出中文', punycodeOnly.unicodeHostname, '中国.cn');
}

/* ------------------------------------------------------------------ */
/* 7. Diagnostics                                                      */
/* ------------------------------------------------------------------ */

console.log('--- 诊断 ---');

{
  const ids = (url, base) => M.analyzeUrl(url, base).diagnostics.map((d) => d.id);

  check('明文 http 被警告', ids('http://a.example/').includes('insecure-scheme'), true);
  check('ws 被警告', ids('ws://a.example/').includes('insecure-scheme'), true);
  check('https 不出现明文警告', ids('https://a.example/').includes('insecure-scheme'), false);
  check('javascript: 被判为危险', ids('javascript:alert(1)').includes('dangerous-scheme'), true);
  check('javascript: 的诊断级别是 error', M.analyzeUrl('javascript:alert(1)').diagnostics.find((d) => d.id === 'dangerous-scheme').level, 'error');
  check('含认证信息时警告', ids('https://u:p@a.example/').includes('credentials'), true);
  check('只有用户名时也警告', ids('https://u@a.example/').includes('credentials'), true);
  check('无认证信息时不警告', ids('https://a.example/').includes('credentials'), false);
  check('追踪参数被列出', M.analyzeUrl('https://a.example/?utm_source=x&fbclid=y').trackingKeys, ['utm_source', 'fbclid']);
  check('追踪参数诊断存在', ids('https://a.example/?utm_source=x').includes('tracking'), true);
  check('任意 utm_ 前缀都被识别', M.isTrackingParam('utm_creative_format'), true);
  check('_ga 被识别', M.isTrackingParam('_ga'), true);
  check('普通参数不被误判', M.isTrackingParam('page'), false);
  check('SPA 路由片段被识别', M.analyzeUrl('https://a.example/#/users/1').spaFragment, true);
  check('hash 路由（#!/）被识别', M.analyzeUrl('https://a.example/#!/inbox').spaFragment, true);
  check('普通锚点不算 SPA 路由', M.analyzeUrl('https://a.example/#section-2').spaFragment, false);
  check('空片段不算 SPA 路由', M.analyzeUrl('https://a.example/#').spaFragment, false);
  check('嵌套的绝对 URL 被找出', M.analyzeUrl('https://a.example/?next=https%3A%2F%2Fevil.example%2Fx').nestedUrls.length, 1);
  check('嵌套 URL 的键被记录', M.analyzeUrl('https://a.example/?next=https%3A%2F%2Fevil.example%2Fx').nestedUrls[0].key, 'next');
  check('嵌套 URL 的协议被记录', M.analyzeUrl('https://a.example/?next=https%3A%2F%2Fevil.example%2Fx').nestedUrls[0].protocol, 'https:');
  check('普通值的参数不算嵌套 URL', M.analyzeUrl('https://a.example/?q=hello').nestedUrls.length, 0);
  check('mailto: 被判定为非层级 URL', M.analyzeUrl('mailto:a@b.example').isOpaque, true);
  check('mailto: 的 origin 为 null', M.analyzeUrl('mailto:a@b.example').fields.origin, 'null');
  check('mailto: 给出非层级诊断', ids('mailto:a@b.example').includes('opaque'), true);
  check('file: 不算非层级 URL（它是特殊协议）', M.analyzeUrl('file:///tmp/x').isOpaque, false);
  check('重复键产生诊断', ids('https://a.example/?a=1&a=2').includes('duplicate-params'), true);
  check('无重复键不产生该诊断', ids('https://a.example/?a=1&b=2').includes('duplicate-params'), false);
  check('干净的 https URL 没有任何诊断', M.analyzeUrl('https://a.example/ok?page=2').diagnostics.length, 0);
  check('IPv4 主机被识别', M.analyzeUrl('http://192.0.2.1/').isIpv4Host, true);
  check('IPv6 主机不被误判为 IPv4', M.analyzeUrl('http://[::1]/').isIpv4Host, false);
}

/* ------------------------------------------------------------------ */
/* 8. Tracking removal                                                 */
/* ------------------------------------------------------------------ */

console.log('--- 移除追踪参数 ---');

{
  const dirty = 'https://a.example/p?utm_source=n&keep=1&fbclid=z&keep=2&utm_medium=e#frag';
  const clean = M.removeTrackingParams(dirty);
  check('移除后不再有追踪参数', M.analyzeUrl(clean).trackingKeys, []);
  check('保留的参数顺序不变', [...new URL(clean).searchParams.keys()], ['keep', 'keep']);
  check('保留重复参数的值', new URL(clean).searchParams.getAll('keep'), ['1', '2']);
  check('片段被保留', new URL(clean).hash, '#frag');
  check('路径没有被改动', new URL(clean).pathname, '/p');
  check('干净输入原样返回', M.removeTrackingParams('https://a.example/p?keep=1'), 'https://a.example/p?keep=1');
  check('无法解析的输入原样返回', M.removeTrackingParams('not a url'), 'not a url');
  check('移除后仍是合法的 URL', M.analyzeUrl(clean).ok, true);
  check('只含追踪参数时查询被清空', new URL(M.removeTrackingParams('https://a.example/?utm_source=x')).search, '');
  check('原始数据的加号编码不被重写', M.removeTrackingParams('https://a.example/?keep=a+b&utm_source=x'), 'https://a.example/?keep=a+b');
}

/* ------------------------------------------------------------------ */
/* 9. Boundaries                                                       */
/* ------------------------------------------------------------------ */

console.log('--- 边界 ---');

{
  check('空输入被拒绝', M.analyzeUrl('').ok, false);
  check('只有空白的输入被拒绝', M.analyzeUrl('   ').ok, false);
  check('空输入给出中文错误', M.analyzeUrl('').error.includes('请输入'), true);
  check('无法解析的输入被拒绝', M.analyzeUrl('foo bar').ok, false);
  check('未闭合的 IPv6 方括号被拒绝', M.analyzeUrl('http://[::1').ok, false);
  check('错误信息说明相对地址需要 base', M.analyzeUrl('/a/b').error.includes('base'), true);
  check('缺少主机时被拒绝', M.analyzeUrl('https://').ok, false);

  const long = `https://a.example/${'p'.repeat(5000)}?q=${'v'.repeat(5000)}`;
  const longResult = M.analyzeUrl(long);
  check('超长 URL 仍可解析', longResult.ok, true);
  check('超长路径长度正确', longResult.fields.pathname.length, 5001);
  check('超长查询参数字符串正确', longResult.query[0].value.length, 5000);
  check('超长 URL 与原生实现一致', longResult.fields.pathname, new URL(long).pathname);

  const emoji = M.analyzeUrl('https://a.example/🎉?q=😀#🌈');
  check('emoji 路径被百分号编码', emoji.fields.pathname, '/%F0%9F%8E%89');
  check('emoji 路径可解码回来', emoji.segments.find((s) => s.key === 'pathname').decoded, '/🎉');
  check('emoji 查询值可解码回来', emoji.query[0].value, '😀');
  check('emoji 片段可解码回来', emoji.segments.find((s) => s.key === 'hash').decoded, '#🌈');
  check('emoji 输入与原生一致', emoji.fields.href, new URL('https://a.example/🎉?q=😀#🌈').href);

  const upper = M.analyzeUrl('HTTPS://EXAMPLE.COM/PaTh?Q=1#H');
  check('协议被小写化', upper.fields.protocol, 'https:');
  check('主机名被小写化', upper.fields.hostname, 'example.com');
  check('路径大小写被保留', upper.fields.pathname, '/PaTh');
  check('查询大小写被保留', upper.fields.search, '?Q=1');

  // An HTML entity or a bare percent must not throw.
  check('单独的百分号不抛出', typeof M.analyzeUrl('https://a.example/%').ok, 'boolean');
  check('URL 里的引号被编码', new URL('https://a.example/?q="x"').search, '?q=%22x%22');
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
