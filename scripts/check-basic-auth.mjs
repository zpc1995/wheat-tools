/**
 * Checks the Basic auth header builder / parser.
 *
 * The oracles, in order of authority:
 *
 *   1. **RFC 7617's own examples.** Section 2 gives `Aladdin` / `open sesame` →
 *      `QWxhZGRpbjpvcGVuIHNlc2FtZQ==`; Section 2.1 gives user `test`, password
 *      `123` plus U+00A3, with the exact octet sequence
 *      `74 65 73 74 3A 31 32 33 C2 A3` → `dGVzdDoxMjPCow==`.
 *   2. **Node's `Buffer`, the browser's `btoa`, and a hand-written Base64
 *      encoder** — three implementations that must all agree with this one.
 *   3. **Round trips**: build a header, parse it back, and compare against the
 *      credentials that went in.
 *
 * The claims that are easy to state and easy to get wrong are asserted directly:
 * that `btoa` throws on non-ASCII input (so the TextEncoder step is not
 * optional), that the UTF-8 and ISO-8859-1 encodings of the same credentials
 * differ, that a colon in the user-id silently shifts the password boundary, and
 * that a header whose octets are valid UTF-8 *cannot* be told apart from the
 * same octets meant as ISO-8859-1.
 *
 * Usage: node scripts/check-basic-auth.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/basic-auth/basicAuthUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/basic-auth.mjs', compiled);
const M = await import(pathToFileURL('.verify/basic-auth.mjs').href);

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok
        ? ''
        : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}

// ---------------------------------------------------------------------------
// A hand-written Base64 encoder, independent of Buffer, btoa and the module.
// ---------------------------------------------------------------------------
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function refBase64(bytes) {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += B64_ALPHABET[(triple >> 18) & 0x3f];
    out += B64_ALPHABET[(triple >> 12) & 0x3f];
    out += index + 1 < bytes.length ? B64_ALPHABET[(triple >> 6) & 0x3f] : '=';
    out += index + 2 < bytes.length ? B64_ALPHABET[triple & 0x3f] : '=';
  }
  return out;
}

const utf8Bytes = (text) => [...Buffer.from(text, 'utf8')];
const bufferBase64 = (text) => Buffer.from(text, 'utf8').toString('base64');

// ---------------------------------------------------------------------------
console.log('--- RFC 7617 第 2 节的示例 ---');
// ---------------------------------------------------------------------------
{
  const built = M.encodeBasicAuth('Aladdin', 'open sesame');
  check('user-pass 拼接', built.userPass, 'Aladdin:open sesame');
  check('Base64 与 RFC 7617 第 2 节一致', built.base64, 'QWxhZGRpbjpvcGVuIHNlc2FtZQ==');
  check(
    'Authorization 头与 RFC 7617 第 2 节一致',
    built.header,
    'Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==',
  );
  check('ok', built.ok, true);
  check('无 errors', built.errors, []);
  check('无 warnings（纯 ASCII、非空）', built.warnings, []);
  check('与 Node Buffer 一致', built.base64, Buffer.from('Aladdin:open sesame').toString('base64'));
  check('与 btoa 一致', built.base64, btoa('Aladdin:open sesame'));
  check('与手写 Base64 实现一致', built.base64, refBase64(utf8Bytes('Aladdin:open sesame')));
  check('常量与实现一致', M.RFC_7617_EXAMPLE_BASE64, built.base64);
  check('示例常量保持原值', [M.RFC_7617_EXAMPLE_USERNAME, M.RFC_7617_EXAMPLE_PASSWORD], ['Aladdin', 'open sesame']);
}

// ---------------------------------------------------------------------------
console.log('--- RFC 7617 第 2.1 节的示例（非 ASCII 密码）---');
// ---------------------------------------------------------------------------
{
  // "The user's name is test, and the password is the string 123 followed by the
  // Unicode character U+00A3 (POUND SIGN)."
  const built = M.encodeBasicAuth('test', '123\u00a3');
  check('user-pass', built.userPass, 'test:123\u00a3');
  check(
    'UTF-8 字节序列与 RFC 7617 第 2.1 节一致',
    built.bytes,
    [0x74, 0x65, 0x73, 0x74, 0x3a, 0x31, 0x32, 0x33, 0xc2, 0xa3],
  );
  check('Base64 与 RFC 7617 第 2.1 节一致', built.base64, 'dGVzdDoxMjPCow==');
  check('十六进制展示', M.bytesToHex(built.bytes), '74 65 73 74 3A 31 32 33 C2 A3');
  check('与 Buffer 一致', built.base64, bufferBase64('test:123\u00a3'));
  check('与手写实现一致', built.base64, refBase64(utf8Bytes('test:123\u00a3')));
  check('非 ASCII 会给出警告', built.warnings, ['non-ascii']);
  check('非 ASCII 不是错误', built.ok, true);

  // The same credentials in ISO-8859-1: one octet instead of two.
  const latin1 = M.encodeBasicAuth('test', '123\u00a3', { charset: 'iso-8859-1' });
  check(
    'ISO-8859-1 下字节序列短一个',
    latin1.bytes,
    [0x74, 0x65, 0x73, 0x74, 0x3a, 0x31, 0x32, 0x33, 0xa3],
  );
  check(
    'ISO-8859-1 的 Base64 与 UTF-8 不同（charset 真的会影响结果）',
    latin1.base64 === built.base64,
    false,
  );
  check('ISO-8859-1 结果与 Buffer 参照一致', latin1.base64, Buffer.from([0x74, 0x65, 0x73, 0x74, 0x3a, 0x31, 0x32, 0x33, 0xa3]).toString('base64'));
}

// ---------------------------------------------------------------------------
console.log('--- btoa 不能直接吃非 ASCII（所以必须先转字节）---');
// ---------------------------------------------------------------------------
{
  let thrown = null;
  try {
    btoa('中文');
  } catch (error) {
    thrown = error;
  }
  check('btoa("中文") 抛错', thrown !== null, true);
  check('错误类型是 InvalidCharacterError', thrown?.name, 'InvalidCharacterError');

  let thrownLatin1 = null;
  try {
    btoa('\u00e9'); // U+00E9 is fine for btoa: it is one byte.
  } catch (error) {
    thrownLatin1 = error;
  }
  check('btoa 接受 U+00E9（恰好是一字节）', thrownLatin1, null);

  const built = M.encodeBasicAuth('用户', '密码');
  check('本实现能处理中文用户名', built.ok, true);
  check('中文凭据与 Buffer 一致', built.base64, bufferBase64('用户:密码'));
  check('中文凭据可解析回来', M.parseAuthorizationHeader(built.header).username, '用户');
  check('中文密码可解析回来', M.parseAuthorizationHeader(built.header).password, '密码');
}

// ---------------------------------------------------------------------------
console.log('--- Base64：三种独立实现互相验证 ---');
// ---------------------------------------------------------------------------
{
  const samples = [
    '', 'a', 'ab', 'abc', 'abcd', ':', '::', 'user:', ':pass',
    'Aladdin:open sesame', 'test:123\u00a3', 'user:pass:with:colons',
    '中文:密码', '😀:emoji', 'ÿþ:latin1', 'a'.repeat(100), '中'.repeat(50),
  ];

  let mismatches = 0;
  let comparisons = 0;
  for (const sample of samples) {
    comparisons += 1;
    const bytes = utf8Bytes(sample);
    const ours = M.bytesToBase64(bytes);
    if (ours !== bufferBase64(sample)) mismatches += 1;
    if (ours !== refBase64(bytes)) mismatches += 1;
  }
  check(`${comparisons} 个样本：本实现 = Buffer = 手写实现`, mismatches, 0);

  // Deterministic pseudo-random samples, including astral characters.
  const pool = ['a', 'Z', '0', ':', ' ', '\t', '中', '文', 'é', '£', 'ñ', '😀', '𝄞', '\u00a0', "'", '"', '\\', '-', '_'];
  let seed = 76172015;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  let randomMismatches = 0;
  for (let index = 0; index < 500; index += 1) {
    let sample = '';
    const length = 1 + Math.floor(rand() * 12);
    for (let position = 0; position < length; position += 1) {
      sample += pool[Math.floor(rand() * pool.length)];
    }
    const bytes = utf8Bytes(sample);
    if (M.bytesToBase64(bytes) !== bufferBase64(sample)) randomMismatches += 1;
    if (M.bytesToBase64(bytes) !== refBase64(bytes)) randomMismatches += 1;
    // And btoa over the same octets, which is the third path.
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    if (M.bytesToBase64(bytes) !== btoa(binary)) randomMismatches += 1;
  }
  check('500 个随机字符串（含 emoji 与代理对）：三种实现完全一致', randomMismatches, 0);
}

// ---------------------------------------------------------------------------
console.log('--- 往返：生成 → 解析 ---');
// ---------------------------------------------------------------------------
{
  const cases = [
    ['Aladdin', 'open sesame'],
    ['', ''],
    ['', 'password'],
    ['username', ''],
    ['user', 'pass'],
    ['user', 'pass:with:colons'],
    ['中文用户名', '中文密码'],
    ['😀', '🔐'],
    ['a b', 'c d'],
    ['quote\'s', 'dou"ble'],
    ['tab\tinside', 'newline\ninside'],
    ['\u00a0', '\u00a0'],
  ];

  let roundTripFailures = 0;
  for (const [username, password] of cases) {
    const built = M.encodeBasicAuth(username, password);
    const parsed = M.parseAuthorizationHeader(built.header);
    if (!parsed.ok) roundTripFailures += 1;
    else if (parsed.username !== username || parsed.password !== password) roundTripFailures += 1;
  }
  check(`${cases.length} 组边界凭据往返一致`, roundTripFailures, 0);

  const empty = M.encodeBasicAuth('', '');
  check('空用户名 + 空密码 = ":"', empty.userPass, ':');
  check('空凭据的 Base64', empty.base64, 'Og==');
  check('空凭据与 Buffer 一致', empty.base64, Buffer.from(':').toString('base64'));
  check('空用户名有警告', empty.warnings.includes('empty-username'), true);
  check('空密码有警告', empty.warnings.includes('empty-password'), true);
  check('空凭据仍然可用（RFC 未禁止）', empty.ok, true);

  // 200 random round trips, this time through the module only.
  let randomSeed = 424242;
  const random = () => {
    randomSeed = (randomSeed * 1103515245 + 12345) % 2147483648;
    return randomSeed / 2147483648;
  };
  const fragments = ['a', 'b', '中', '密', '😀', 'é', '£', ' ', ':', '-', '.', '@', '\\', '"', "'", '~', '𝄞'];
  let randomRoundTripFailures = 0;
  for (let index = 0; index < 200; index += 1) {
    let username = '';
    let password = '';
    for (let count = 0; count < Math.floor(random() * 5); count += 1) {
      username += fragments[Math.floor(random() * fragments.length)];
    }
    for (let count = 0; count < Math.floor(random() * 5); count += 1) {
      password += fragments[Math.floor(random() * fragments.length)];
    }
    // A colon in the user-id is invalid by definition and is tested separately.
    username = username.replace(/:/g, '');
    const parsed = M.parseAuthorizationHeader(M.encodeBasicAuth(username, password).header);
    if (parsed.username !== username || parsed.password !== password) randomRoundTripFailures += 1;
  }
  check('200 组随机凭据往返一致', randomRoundTripFailures, 0);
}

// ---------------------------------------------------------------------------
console.log('--- 用户名校验：冒号与控制字符 ---');
// ---------------------------------------------------------------------------
{
  const built = M.encodeBasicAuth('a:b', 'pass');
  check('用户名含冒号时报错', built.errors, ['colon-in-username']);
  check('用户名含冒号时 ok 为 false', built.ok, false);
  check('仍然给出 Base64（便于对照服务端行为）', built.base64.length > 0, true);

  // The failure is not hypothetical: the server splits at the first colon, so the
  // real username becomes "a" and the password becomes "b:pass".
  const parsed = M.parseAuthorizationHeader(built.header);
  check('服务端会读到用户名 "a"', parsed.username, 'a');
  check('服务端会读到密码 "b:pass"', parsed.password, 'b:pass');

  const control = M.encodeBasicAuth('us\ter', 'pass');
  check('控制字符给出警告（RFC 7617 禁止）', control.warnings.includes('control-characters'), true);
  check('控制字符不阻止生成', control.ok, true);
  check('控制字符仍然往返一致', M.parseAuthorizationHeader(control.header).username, 'us\ter');

  check('换行也算控制字符', M.encodeBasicAuth('u\n', 'p').warnings.includes('control-characters'), true);
  check('普通文本没有控制字符警告', M.encodeBasicAuth('user', 'pass').warnings, []);
}

// ---------------------------------------------------------------------------
console.log('--- ISO-8859-1 的边界 ---');
// ---------------------------------------------------------------------------
{
  const ok = M.encodeBasicAuth('user', 'caf\u00e9', { charset: 'iso-8859-1' });
  check('Latin-1 可表示的字符正常编码', ok.bytes, [0x75, 0x73, 0x65, 0x72, 0x3a, 0x63, 0x61, 0x66, 0xe9]);
  check('Latin-1 结果与 Buffer 参照一致', ok.base64, Buffer.from([0x75, 0x73, 0x65, 0x72, 0x3a, 0x63, 0x61, 0x66, 0xe9]).toString('base64'));

  const bad = M.encodeBasicAuth('user', '中文', { charset: 'iso-8859-1' });
  check('Latin-1 无法表示中文时报错', bad.errors, ['latin1-unrepresentable']);
  check('Latin-1 无法表示时 ok 为 false', bad.ok, false);
  check('Latin-1 无法表示时没有 Base64', bad.base64, '');
  check('Latin-1 无法表示时没有头', bad.header, '');

  const emoji = M.encodeBasicAuth('user', '😀', { charset: 'iso-8859-1' });
  check('Latin-1 无法表示 emoji', emoji.errors, ['latin1-unrepresentable']);

  check('UTF-8 下同样的中文没有问题', M.encodeBasicAuth('user', '中文').ok, true);
}

// ---------------------------------------------------------------------------
console.log('--- 解析：输入形态与容错 ---');
// ---------------------------------------------------------------------------
{
  const token = 'QWxhZGRpbjpvcGVuIHNlc2FtZQ==';

  check('标准头', M.parseAuthorizationHeader(`Authorization: Basic ${token}`).username, 'Aladdin');
  check('小写 scheme', M.parseAuthorizationHeader(`authorization: basic ${token}`).username, 'Aladdin');
  check('大小写混合与多余空格', M.parseAuthorizationHeader(`  AUTHORIZATION :   BaSiC    ${token}  `).username, 'Aladdin');
  check('没有 Authorization 前缀', M.parseAuthorizationHeader(`Basic ${token}`).username, 'Aladdin');
  check('裸 token', M.parseAuthorizationHeader(token).username, 'Aladdin');
  check('裸 token 时 scheme 为 null', M.parseAuthorizationHeader(token).scheme, null);
  check('Proxy-Authorization 前缀', M.parseAuthorizationHeader(`Proxy-Authorization: Basic ${token}`).username, 'Aladdin');
  check('缺少 padding 也能解析', M.parseAuthorizationHeader('Basic ' + token.replace(/=+$/, '')).username, 'Aladdin');
  check('头里的换行与制表符被忽略', M.parseAuthorizationHeader(`Basic\n\t${token}`).username, 'Aladdin');

  const digest = M.parseAuthorizationHeader('Digest username="x"');
  check('Digest 报 unknown-scheme', digest.issue, 'unknown-scheme');
  check('Digest 保留 scheme 原样', digest.scheme, 'Digest');
  check('Digest 不 ok', digest.ok, false);

  check('空输入', M.parseAuthorizationHeader('   ').issue, 'empty');
  check('非法字符', M.parseAuthorizationHeader('Basic @@@@').issue, 'invalid-base64');
  check('长度不可能是 Base64', M.parseAuthorizationHeader('Basic Q').issue, 'invalid-base64');
  check('等号位置错误', M.parseAuthorizationHeader('Basic QQ=Q').issue, 'invalid-base64');
  check('只有等号', M.parseAuthorizationHeader('Basic ====').issue, 'invalid-base64');

  // A user-pass always contains a colon, so this case needs a hand-made token.
  const noColon = btoa('nocolon');
  const noColonParsed = M.parseAuthorizationHeader(`Basic ${noColon}`);
  check('缺少冒号时报 missing-colon', noColonParsed.issue, 'missing-colon');
  check('缺少冒号时仍回显解出的文本', [noColonParsed.username, noColonParsed.password], ['nocolon', null]);

  const parsed = M.parseAuthorizationHeader(`Authorization: Basic ${token}`);
  check('base64 字段回显（不含 scheme）', parsed.base64, token);
  check('userPass 字段', parsed.userPass, 'Aladdin:open sesame');
  check('纯 ASCII 标记', parsed.asciiOnly, true);
  check('纯 ASCII 时按 UTF-8 报告（两者一致）', parsed.byteEncoding, 'utf-8');
  check('无控制字符', parsed.hasControlCharacters, false);
  check('字节回显', parsed.bytes.length, 19);
}

// ---------------------------------------------------------------------------
console.log('--- 解析：charset 只能猜（这正是界面要说明的歧义）---');
// ---------------------------------------------------------------------------
{
  const utf8 = M.encodeBasicAuth('test', '123\u00a3');
  const parsedUtf8 = M.parseAuthorizationHeader(utf8.header);
  check('UTF-8 版本被识别为 UTF-8', parsedUtf8.byteEncoding, 'utf-8');
  check('UTF-8 版本解出正确密码', parsedUtf8.password, '123\u00a3');

  const latin1 = M.encodeBasicAuth('test', '123\u00a3', { charset: 'iso-8859-1' });
  const parsedLatin1 = M.parseAuthorizationHeader(latin1.header);
  check('Latin-1 版本的字节不是合法 UTF-8，因此识别为 ISO-8859-1', parsedLatin1.byteEncoding, 'iso-8859-1');
  check('Latin-1 版本仍然解出正确密码', parsedLatin1.password, '123\u00a3');
  check('两个版本的 Base64 不同', utf8.base64 === latin1.base64, false);

  // The unavoidable case: Latin-1 octets that also happen to be valid UTF-8.
  // 'Ã©' is U+00C3 U+00A9 in Latin-1 = bytes C3 A9 = a valid UTF-8 'é'.
  const ambiguous = M.encodeBasicAuth('u', '\u00c3\u00a9', { charset: 'iso-8859-1' });
  const parsedAmbiguous = M.parseAuthorizationHeader(ambiguous.header);
  check('歧义样本被判为 UTF-8（无法分辨）', parsedAmbiguous.byteEncoding, 'utf-8');
  check('歧义样本解出的密码与原文不同（这就是歧义的代价）', parsedAmbiguous.password, '\u00e9');
  check('歧义样本原文是 Ã©', ambiguous.userPass.endsWith('\u00c3\u00a9'), true);
}

// ---------------------------------------------------------------------------
console.log('--- Base64 解码的严格性 ---');
// ---------------------------------------------------------------------------
{
  check('QQ== 解出一个字节', M.base64ToBytes('QQ=='), [0x41]);
  check('QQ 缺少 padding 也接受', M.base64ToBytes('QQ'), [0x41]);
  check('空串解出空字节', M.base64ToBytes(''), []);
  check('空白被忽略', M.base64ToBytes(' Q Q = = '), [0x41]);
  check('单个 Q 非法', M.base64ToBytes('Q'), null);
  check('四个等号非法', M.base64ToBytes('===='), null);
  check('非法字符', M.base64ToBytes('QQ!='), null);
  check('QQ=Q 非法', M.base64ToBytes('QQ=Q'), null);
  check('URL 安全字母表不被接受（Basic 用的是标准字母表）', M.base64ToBytes('_-'), null);
  check('Og== 是 ":"', M.base64ToBytes('Og=='), [0x3a]);

  let canonicalFailures = 0;
  for (const [username, password] of [
    ['a', 'b'], ['', ''], ['Aladdin', 'open sesame'], ['中', '文'], ['😀', 'x'],
  ]) {
    const built = M.encodeBasicAuth(username, password);
    const bytes = M.base64ToBytes(built.base64);
    if (bytes === null || M.bytesToBase64(bytes) !== built.base64) canonicalFailures += 1;
  }
  check('解码再编码回到原值（标准字母表、无多余 padding）', canonicalFailures, 0);
}

// ---------------------------------------------------------------------------
console.log('--- curl / fetch / Node 片段 ---');
// ---------------------------------------------------------------------------
{
  const commands = M.buildCurlCommands('Aladdin', 'open sesame', 'https://example.com/secret');
  check(
    'curl --user 形式',
    commands.userFlag,
    `curl --user 'Aladdin:open sesame' 'https://example.com/secret'`,
  );
  check(
    'curl --header 形式（含 RFC 7617 的 Base64）',
    commands.headerFlag,
    `curl --header 'Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==' 'https://example.com/secret'`,
  );

  const quoted = M.buildCurlCommands('it\'s', 'pa\'s', 'https://x/');
  check(
    '单引号被正确转义（否则命令会被截断或注入）',
    quoted.userFlag,
    `curl --user 'it'\\''s:pa'\\''s' 'https://x/'`,
  );
  check('shellQuote 的转义形式', M.shellQuote("it's"), `'it'\\''s'`);
  check('shellQuote 保留普通文本', M.shellQuote('plain text'), `'plain text'`);

  check(
    '没有 URL 时用示例地址',
    M.buildCurlCommands('a', 'b', '   ').userFlag,
    `curl --user 'a:b' 'https://example.com/'`,
  );

  const noHeader = M.buildCurlCommands('user', '中文', 'https://x/', { charset: 'iso-8859-1' });
  check('Latin-1 无法编码时不给 --header 形式', noHeader.headerFlag, '');

  const utf8Fetch = M.buildFetchSnippet('用户', '密码', 'https://api.example.com/');
  check('fetch 片段使用 TextEncoder', utf8Fetch.includes('new TextEncoder().encode(credentials)'), true);
  check('fetch 片段不用裸 btoa(credentials)', utf8Fetch.includes('btoa(credentials)'), false);
  check('fetch 片段包含目标地址', utf8Fetch.includes('"https://api.example.com/"'), true);
  check('fetch 片段是可执行的 JS（包含 btoa 调用）', utf8Fetch.includes('btoa(binary)'), true);

  const latin1Fetch = M.buildFetchSnippet('u', 'p', 'https://x/', { charset: 'iso-8859-1' });
  check(
    'ISO-8859-1 的 fetch 片段改用 charCodeAt（UTF-8 片段会编码错）',
    latin1Fetch.includes('charCodeAt(0)'),
    true,
  );

  const nodeSnippet = M.buildNodeSnippet('Aladdin', 'open sesame');
  check('Node 片段使用 Buffer', nodeSnippet.includes('Buffer.from("Aladdin:open sesame", "utf8")'), true);
  check('Node 片段与 RFC 示例一致', nodeSnippet.includes('toString("base64")'), true);

  const apostropheSnippet = M.buildFetchSnippet("it's", 'p', 'https://x/');
  check('片段里的凭据被 JSON 转义（不会破坏引号）', apostropheSnippet.includes(`"it's:p"`), true);
}

// ---------------------------------------------------------------------------
console.log('--- 密码里的冒号只影响第一处 ---');
// ---------------------------------------------------------------------------
{
  const built = M.encodeBasicAuth('user', 'a:b:c');
  const parsed = M.parseAuthorizationHeader(built.header);
  check('用户名为第一个冒号之前', parsed.username, 'user');
  check('密码保留其余冒号', parsed.password, 'a:b:c');
  check('往返一致', `${parsed.username}:${parsed.password}`, 'user:a:b:c');

  const many = M.encodeBasicAuth('user', '::::');
  check('多个冒号的密码', M.parseAuthorizationHeader(many.header).password, '::::');
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
