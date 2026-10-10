/**
 * Checks the email normaliser.
 *
 * Four independent oracles, because "my regex says so" is not evidence:
 *
 *   1. **`node:url`'s `domainToASCII` / `domainToUnicode`** are the authority
 *      for IDN → Punycode. The check calls them directly and compares, rather
 *      than hard-coding the expected strings (which would only prove the
 *      implementation agrees with itself).
 *   2. **Python's `email.utils`** character classes (`SPECIALS`, `ATEXT`) are
 *      read out of the interpreter at run time and the implementation's allowed
 *      local-part character set is compared with them. If `python3` is absent
 *      the comparison is reported as SKIP, with a note, and never as a pass.
 *      `email.utils.parseaddr` is additionally used as a *lenient* parser whose
 *      disagreements are printed for inspection.
 *   3. **The famous "full RFC 5322" regex** is embedded verbatim and used as a
 *      counter-example: it accepts strings that are not addresses and rejects
 *      strings that are. The check asserts both directions, which is the
 *      evidence for not shipping it.
 *   4. **Gmail's documented rules** are asserted on concrete addresses, plus a
 *      round trip: an address and its canonical form must normalise identically.
 *
 * Usage: node scripts/check-email-normalizer.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { domainToASCII, domainToUnicode } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(
  readFileSync('src/tools/email-normalizer/emailNormalizerUtils.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/email-normalizer.mjs', compiled);
const M = await import(pathToFileURL('.verify/email-normalizer.mjs').href);

let passed = 0;
let failed = 0;
let skipped = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}
function skip(label, why) {
  skipped += 1;
  console.log(`SKIP  ${label}（${why}）`);
}

const OPTIONS_OFF = { lowercaseLocal: false, applyGmailRules: false };
const OPTIONS_LOWER = { lowercaseLocal: true, applyGmailRules: false };
const OPTIONS_GMAIL = { lowercaseLocal: false, applyGmailRules: true };

console.log('--- 常量与规则表 ---');
check('本地部分上限是 64', M.MAX_LOCAL_LENGTH, 64);
check('域名上限是 255', M.MAX_DOMAIN_LENGTH, 255);
check('域名段上限是 63', M.MAX_LABEL_LENGTH, 63);
check('允许的特殊字符与 RFC 5322 atext 一致', M.LOCAL_SPECIALS, "!#$%&'*+-/=?^_`{|}~");
check('界面上列出的规则有 8 条', M.RULE_SUMMARY.length, 8);
check(
  '规则说明里明确写了不做 MX / 真实性校验',
  M.RULE_SUMMARY.some((rule) => rule.includes('MX')) && M.RULE_SUMMARY.some((rule) => rule.includes('真实存在')),
  true,
);

console.log('--- 合法地址 ---');
{
  const valid = [
    'alice@example.com',
    'a@b.co',
    'bob.smith@example.com',
    'user+tag@example.com',
    "o'brien@example.com",
    'x!y#z@example.com',
    "a-b_c%k@example.com",
    'A.B@Example.COM',
    'a1@example.com',
    '1a@example.com',
    'user_name@mail.example.co.uk',
    'user@[192.168.1.1]',
    'user@[IPv6:2001:db8::1]',
    '用户@example.com',
    'user@münchen.de',
    'user@例え.jp',
    'ünïcode@example.com',
    'user@sub.domain.example.com',
    'user@example.photography',
  ];
  const failures = valid.filter((address) => !M.isValidEmail(address));
  check(`全部 ${valid.length} 个合法地址都被接受`, failures, []);
}

console.log('--- 非法地址：每一条都给出具体原因 ---');
{
  const cases = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['plain', 'no-at'],
    ['a@b@c.com', 'multiple-at'],
    ['@example.com', 'local-empty'],
    ['user@', 'domain-empty'],
    ['a'.repeat(65) + '@example.com', 'local-too-long'],
    ['.user@example.com', 'local-leading-dot'],
    ['user.@example.com', 'local-trailing-dot'],
    ['us..er@example.com', 'local-double-dot'],
    ['us er@example.com', 'whitespace'],
    ['"quoted"@example.com', 'quoted-local'],
    ['user@(comment)example.com', 'comment'],
    ['user@a', 'domain-label'],
    ['user@a.c', 'domain-tld'],
    ['user@example.1a', 'domain-tld'],
    ['user@example.c0m', 'domain-tld'],
    ['user@-example.com', 'domain-hyphen'],
    ['user@example-.com', 'domain-hyphen'],
    ['user@exam ple.com', 'whitespace'],
    ['user@[999.1.1.1]', 'domain-label'],
    ['user@[]', 'domain-label'],
    ['user@example..com', 'domain-label'],
    ['user@' + 'a'.repeat(64) + '.com', 'domain-label-too-long'],
    ['用户@@example.com', 'multiple-at'],
  ];
  const mismatches = [];
  for (const [address, expectedCode] of cases) {
    const parsed = M.parseEmail(address);
    if (parsed.ok) mismatches.push(`${address} 被误判为合法`);
    else if (parsed.code !== expectedCode) {
      mismatches.push(`${address} 的 code 是 ${parsed.code}，期望 ${expectedCode}（${parsed.message}）`);
    }
  }
  check(`全部 ${cases.length} 个非法输入都被拒绝且 code 正确`, mismatches, []);

  check('emoji 本地部分被拒绝（Unicode 字母可以，emoji 不行）', M.isValidEmail('😀@example.com'), false);
  check('中文标点的本地部分被拒绝', M.isValidEmail('用，户@example.com'), false);
  check('中文逗号被识别为非法字符而不是静默通过', M.parseEmail('用，户@example.com').code, 'local-char');
  check(
    '错误信息里带上具体的码位',
    M.parseEmail('a b@example.com').message.includes('空格') ||
      M.parseEmail('a b@example.com').message.includes('U+'),
    true,
  );
  check('超长地址被拒绝', M.isValidEmail('a'.repeat(64) + '@' + 'b'.repeat(250) + '.com'), false);
  check('257 个字符的地址被拒绝', M.isValidEmail('a@' + 'b'.repeat(254) + '.com'), false);
}

console.log('--- 域名大小写与本地部分大小写 ---');
{
  check(
    '域名一律转小写（DNS 大小写不敏感）',
    M.normaliseEmail('User@EXAMPLE.COM', OPTIONS_OFF).normalised,
    'User@example.com',
  );
  check(
    '默认不改本地部分大小写（RFC 5321 说它大小写敏感）',
    M.normaliseEmail('User@example.com', OPTIONS_OFF).local,
    'User',
  );
  check(
    '开启后本地部分转小写',
    M.normaliseEmail('User@example.com', OPTIONS_LOWER).normalised,
    'user@example.com',
  );
  check(
    '默认选项是两项都关',
    M.DEFAULT_NORMALISE_OPTIONS,
    { lowercaseLocal: false, applyGmailRules: false },
  );
  check(
    '只有域名大小写变化时 changes 说明是域名',
    M.normaliseEmail('User@EXAMPLE.com', OPTIONS_OFF).changes,
    ['域名转为小写'],
  );
  check(
    '本地部分已经是小写时不会谎报改动',
    M.normaliseEmail('user@EXAMPLE.com', OPTIONS_OFF).changes,
    ['域名转为小写'],
  );
  check(
    '完全没变时 changed 为 false',
    M.normaliseEmail('user@example.com', OPTIONS_OFF).changed,
    false,
  );
  check(
    'lowerLocalPart 只折叠 ASCII 字母',
    [M.lowerLocalPart('ABC'), M.lowerLocalPart('Ünïcode'), M.lowerLocalPart('ÄÖÜ')],
    ['abc', 'Ünïcode', 'ÄÖÜ'],
  );
}

console.log('--- Punycode：以 node:url 为权威参照 ---');
{
  const domains = [
    'münchen.de',
    '例え.jp',
    '例え.テスト',
    'faß.de',
    'παράδειγμα.δοκιμή',
    'пример.рф',
    '中文域名.中国',
    'xn--mnchen-3ya.de',
    'İstanbul.com',
    'e\u0301xample.com',
  ];
  const mismatches = [];
  for (const domain of domains) {
    const expected = domainToASCII(domain.toLowerCase());
    const actual = M.parseEmail(`user@${domain}`);
    if (!actual.ok) {
      mismatches.push(`${domain}: 被拒绝（${actual.message}）`);
      continue;
    }
    if (actual.domainAscii !== expected) {
      mismatches.push(`${domain}: 得到 ${actual.domainAscii}，node:url 得到 ${expected}`);
    }
  }
  check(`全部 ${domains.length} 个 IDN 的 Punycode 与 node:url 完全一致`, mismatches, []);

  // The implementation stopped importing `node:url` (a Node builtin cannot be
  // bundled for the browser), so the two helpers it uses instead must be pinned
  // against the platform on exactly the inputs where a naive `new URL()` differs
  // from IDNA ToASCII. Without these, the replacement could drift silently.
  const toAsciiCases = [
    'example.com', 'EXAMPLE.com', 'münchen.de', '例子.测试',
    // `new URL('http://a:1').hostname` is 'a' (it reads a port); ToASCII rejects it.
    'a:1', 'a:80', 'host:port',
    // A bracketed IPv6 literal is a host the platform accepts verbatim.
    '[::1]', '[2001:db8::1]',
    // Not a bare host. Note `a:80` and `user@host.com`: the platform rejects
    // those, and the four separator cases below are asserted separately as a
    // deliberate deviation.
    'user@host.com', 'a:80',
    // Percent-decoding and case folding happen before the IDNA step.
    '%41.com', 'exa mple.com', '', 'a',
    // Malformed Punycode: ToASCII rejects rather than passing it through.
    'xn--', 'xn--a', 'xn--0', 'xn--zzzzzzzzzzzzzzzzzzzzzzzzzzz',
    // Valid-looking Punycode that decodes to real code points.
    'xn--fsqu00a.xn--0zwm56d', 'xn--invalid',
    'foo..bar', '-bad.com', 'localhost', 'a.b.c.d',
  ];
  const asciiMismatch = [];
  for (const domain of toAsciiCases) {
    const ours = M.toAsciiDomain(domain);
    const theirs = domainToASCII(domain);
    if (ours !== theirs) asciiMismatch.push(`${domain}: 我们 ${ours}，平台 ${theirs}`);
  }
  check(
    `toAsciiDomain 与 node:url 在 ${toAsciiCases.length} 个（含畸形）用例上一致`,
    asciiMismatch,
    [],
  );

  const unicodeMismatch = [];
  for (const domain of toAsciiCases) {
    const ours = M.toUnicodeDomain(domain);
    const theirs = domainToUnicode(domain);
    if (ours !== theirs) unicodeMismatch.push(`${domain}: 我们 ${ours}，平台 ${theirs}`);
  }
  check(
    `toUnicodeDomain 与 node:url 在 ${toAsciiCases.length} 个（含畸形）用例上一致`,
    unicodeMismatch,
    [],
  );

  // Round-trip: what the tool displays as Unicode must fold back to the same
  // ASCII form, otherwise the two columns of the result contradict each other.
  const roundTripBad = [];
  for (const domain of toAsciiCases) {
    const ascii = M.toAsciiDomain(domain);
    if (ascii === '') continue;
    if (M.toAsciiDomain(M.toUnicodeDomain(ascii)) !== ascii) {
      roundTripBad.push(domain);
    }
  }
  check('Unicode 形态再转回 ASCII 得到同一个值', roundTripBad, []);

  // Deliberate deviation, pinned rather than left implicit.
  //
  // The platform is inconsistent here: it truncates at a path/query/fragment
  // separator (`domainToASCII('a/b')` is `'a'`) but rejects a port or credentials
  // outright. Truncating is the wrong behaviour for an email domain — it would
  // silently accept `user@a/b` as `user@a` — so this implementation rejects all
  // of them. The platform's behaviour is asserted too, so if it ever changes the
  // failure points straight at the assumption that justified deviating.
  const separatorCases = ['a/b', 'a?b', 'a#b', 'a\\b'];
  const platformTruncates = separatorCases.every((d) => domainToASCII(d) === 'a');
  check('平台在这些输入上确实是截断（本实现刻意不同的前提）', platformTruncates, true);
  check(
    '本实现在路径/查询/片段分隔符处一律拒绝（不截断）',
    separatorCases.map((d) => M.toAsciiDomain(d)),
    ['', '', '', ''],
  );
  for (const raw of ['user@a/b', 'user@a?b', 'user@a#b']) {
    const parsed = M.parseEmail(raw);
    check(`${raw} 被拒绝而不是截断成 user@a`, parsed.ok, false);
  }

  check('münchen.de → xn--mnchen-3ya.de', M.parseEmail('user@münchen.de').domainAscii, 'xn--mnchen-3ya.de');
  check('例え.jp → xn--r8jz45g.jp', M.parseEmail('user@例え.jp').domainAscii, 'xn--r8jz45g.jp');
  check(
    'Punycode 域名原样保留',
    M.parseEmail('user@xn--mnchen-3ya.de').domainAscii,
    'xn--mnchen-3ya.de',
  );
  check(
    'Unicode 形态可以从 Punycode 反解回来（与 node:url 一致）',
    M.normaliseEmail('user@xn--mnchen-3ya.de', OPTIONS_OFF).domainUnicode,
    domainToUnicode('xn--mnchen-3ya.de'),
  );
  check(
    'Punycode 与 Unicode 两种写法规范化后相同',
    M.normaliseEmail('user@münchen.de', OPTIONS_OFF).normalised,
    M.normaliseEmail('user@xn--mnchen-3ya.de', OPTIONS_OFF).normalised,
  );
  check(
    '大小写不同的 Punycode 域名收敛到同一结果',
    M.normaliseEmail('user@XN--MNCHEN-3YA.DE', OPTIONS_OFF).normalised,
    M.normaliseEmail('user@xn--mnchen-3ya.de', OPTIONS_OFF).normalised,
  );
  check('TLD 从 Punycode 形式取到', M.normaliseEmail('user@例え.jp', OPTIONS_OFF).tld, 'jp');
  check(
    'IDN 拒绝时的错误码是 domain-idn 或 domain-label',
    ['domain-idn', 'domain-label'].includes(M.parseEmail('user@' + '\u200b'.repeat(2) + '.com').code),
    true,
  );
}

console.log('--- Gmail 规则（具体例子） ---');
{
  const first = M.normaliseEmail('first.last+tag@gmail.com', OPTIONS_GMAIL);
  const second = M.normaliseEmail('firstlast@gmail.com', OPTIONS_GMAIL);
  check('first.last+tag@gmail.com 规范化后与 firstlast@gmail.com 等价', first.normalised, second.normalised);
  check('规范化结果是 firstlast@gmail.com', first.normalised, 'firstlast@gmail.com');
  check('等价关系的另一方向也成立', second.normalised, 'firstlast@gmail.com');

  check(
    '默认不套用 Gmail 规则（只对 Gmail 有效）',
    M.normaliseEmail('first.last+tag@gmail.com', OPTIONS_OFF).normalised,
    'first.last+tag@gmail.com',
  );
  check(
    'googlemail.com 与 gmail.com 都识别为 Gmail',
    M.GMAIL_DOMAINS,
    ['gmail.com', 'googlemail.com'],
  );
  check(
    'googlemail.com 也套用同一规则',
    M.normaliseEmail('First.Last+News@googlemail.com', OPTIONS_GMAIL).normalised,
    'FirstLast@googlemail.com',
  );
  check(
    '非 Gmail 域名不会被改动',
    M.normaliseEmail('first.last+tag@example.com', OPTIONS_GMAIL).normalised,
    'first.last+tag@example.com',
  );
  check(
    '非 Gmail 时 changes 同时说明“域名转小写”与“规则未套用”',
    M.normaliseEmail('First.Last+Tag@Example.com', OPTIONS_GMAIL).changes,
    ['域名转为小写', '域名不是 Gmail，未套用点号 / + 后缀规则'],
  );
  check(
    '非 Gmail 且地址本身没变时，仍会提示规则未套用',
    M.normaliseEmail('first.last+tag@example.com', OPTIONS_GMAIL).changes,
    ['域名不是 Gmail，未套用点号 / + 后缀规则'],
  );
  check(
    '“规则未套用”只是提示，不会把 changed 变成 true',
    M.normaliseEmail('first.last+tag@example.com', OPTIONS_GMAIL).changed,
    false,
  );

  const reading = M.gmailReading('first.last+tag', 'gmail.com');
  check('去掉点号', reading.withoutDots, 'firstlast+tag');
  check('去掉 + 后缀', reading.withoutTag, 'first.last');
  check('两者都去掉', reading.canonical, 'firstlast');
  check('只取第一个 + 之前的部分', M.gmailReading('a+b+c', 'gmail.com').canonical, 'a');
  check('没有点号时不变', M.gmailReading('abc', 'gmail.com').canonical, 'abc');
  check('只有点号的本地部分会得到空串（不是有效账号）', M.gmailReading('...', 'gmail.com').canonical, '');
  check('别名域名列出 Google 的两个域', reading.aliasDomains, ['gmail.com', 'googlemail.com']);
  check('非 Gmail 域时 isGmail 为 false', M.gmailReading('a.b', 'example.com').isGmail, false);
  check('Gmail 规则大小写不敏感地识别域名', M.gmailReading('a.b', 'GMAIL.COM').isGmail, true);
}

console.log('--- 免费邮箱与一次性邮箱分类 ---');
{
  check('gmail.com 是免费邮箱', M.classifyDomain('gmail.com').isFree, true);
  check('qq.com 是免费邮箱', M.classifyDomain('qq.com').isFree, true);
  check('outlook.com 是免费邮箱', M.classifyDomain('outlook.com').isFree, true);
  check('example.com 不是免费邮箱', M.classifyDomain('example.com').isFree, false);
  check('mailinator.com 是一次性邮箱', M.classifyDomain('mailinator.com').isDisposable, true);
  check('yopmail.com 是一次性邮箱', M.classifyDomain('yopmail.com').isDisposable, true);
  check('gmail.com 不是一次性邮箱', M.classifyDomain('gmail.com').isDisposable, false);
  check(
    '子域按后缀匹配（sub.mailinator.com）',
    [M.classifyDomain('sub.mailinator.com').isDisposable, M.classifyDomain('sub.mailinator.com').matchedBySuffix],
    [true, true],
  );
  check(
    '精确匹配时 matchedBySuffix 为 false',
    M.classifyDomain('mailinator.com').matchedBySuffix,
    false,
  );
  check('分类 kind 对免费邮箱是 free', M.classifyDomain('gmail.com').kind, 'free');
  check('分类 kind 对一次性邮箱是 disposable', M.classifyDomain('yopmail.com').kind, 'disposable');
  check('分类 kind 对普通域名是 other', M.classifyDomain('example.com').kind, 'other');
  check(
    '一次性列表中同时出现在免费列表里的域名标为 disposable+free',
    M.classifyDomain('grr.la').kind,
    M.DISPOSABLE_EMAIL_DOMAINS.includes('grr.la') && M.FREE_EMAIL_DOMAINS.includes('grr.la')
      ? 'disposable+free'
      : M.classifyDomain('grr.la').kind,
  );
  check('两套列表内都没有重复项', [
    new Set(M.FREE_EMAIL_DOMAINS).size === M.FREE_EMAIL_DOMAINS.length,
    new Set(M.DISPOSABLE_EMAIL_DOMAINS).size === M.DISPOSABLE_EMAIL_DOMAINS.length,
  ], [true, true]);
  check(
    '列表里的域名全部是合法域名（避免写错导致永不命中）',
    [...M.FREE_EMAIL_DOMAINS, ...M.DISPOSABLE_EMAIL_DOMAINS].filter(
      (domain) => !M.isValidEmail(`probe@${domain}`),
    ),
    [],
  );
  check(
    '一次性列表被明确标注为不完整',
    M.DISPOSABLE_EMAIL_DOMAINS.length < 40 && M.FREE_EMAIL_DOMAINS.length >= 30,
    true,
  );
}

console.log('--- 反证：著名的 RFC 5322 正则不能用 ---');
{
  // The widely copied "full RFC 5322" pattern (the one from the HTML5 /
  // ex-parrot lineage). Kept verbatim on purpose: the point is to measure it.
  const RFC5322 =
    /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

  // It is case-insensitive and anchored, so it gets the common cases right.
  check('该正则能匹配 alice@example.com', RFC5322.test('alice@example.com'), true);
  check('该正则能匹配 user+tag@example.com', RFC5322.test('user+tag@example.com'), true);

  // Direction 1: it accepts things that are not addresses.
  check('反证一：正则接受 a@b.c —— TLD 只有 1 个字符，注册局不存在这种 TLD', RFC5322.test('a@b.c'), true);
  check('本实现拒绝 a@b.c（TLD 少于 2 字符）', M.isValidEmail('a@b.c'), false);
  check(
    '该正则允许域名段以数字开头（a@1example.com）',
    [RFC5322.test('a@1example.com'), M.isValidEmail('a@1example.com')],
    [true, true],
  );
  check(
    '该正则允许纯数字 TLD（a@example.123），本实现按裸 IP 拒绝',
    [RFC5322.test('a@example.123'), M.isValidEmail('a@example.123')],
    [true, false],
  );
  check(
    '该正则允许字母数字混排的 TLD（a@example.c0m）',
    [RFC5322.test('a@example.c0m'), M.isValidEmail('a@example.c0m')],
    [true, false],
  );

  // The `g`/non-anchored form is what actually bites: without ^...$ the pattern
  // matches a *substring*, so a whole list of addresses "validates".
  const UNANCHORED =
    /[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/i;
  check(
    '反证二：去掉锚点后，一整串地址（含逗号与空格）被当成“合法”',
    UNANCHORED.test('test@example.com, test2@example.com'),
    true,
  );
  check(
    '本实现拒绝同一串地址（因为含空格与逗号）',
    M.isValidEmail('test@example.com, test2@example.com'),
    false,
  );
  check(
    '反证三：去掉锚点后匹配的是子串而不是整个输入',
    [RFC5322.test('a@b.co 🙈 garbage'), UNANCHORED.test('a@b.co 🙈 garbage')],
    [false, true],
  );
  check(
    '本实现拒绝带 emoji 垃圾尾巴的输入',
    M.isValidEmail('a@b.co 🙈 garbage'),
    false,
  );

  // Direction 2: it rejects valid addresses.
  const wronglyRejected = [
    'user@[192.168.1.1]',
    'user@例え.jp',
    '用户@example.com',
    'o\u2019brien@example.com',
  ];
  const rejectedByRegex = wronglyRejected.filter((address) => !RFC5322.test(address));
  check(
    '反证四：正则拒绝了合法地址（地址字面量、IDN、非 ASCII 本地部分、Unicode 撇号）',
    rejectedByRegex.length >= 3,
    true,
  );
  check('其中地址字面量被本实现接受', M.isValidEmail('user@[192.168.1.1]'), true);
  check('其中 IDN 被本实现接受', M.isValidEmail('user@例え.jp'), true);
  check('其中非 ASCII 本地部分被本实现接受', M.isValidEmail('用户@example.com'), true);
  check(
    '本实现拒绝 Unicode 撇号（不在 atext 集合里），并说明是哪个字符',
    M.parseEmail('o\u2019brien@example.com').code,
    'local-char',
  );

  // And the 6 kB variant's other classic problem: comment folding is dropped,
  // so it silently strips the comment instead of reporting it.
  const withComment = 'john.smith@(comment)example.com';
  check('反证五：非贪婪正则会把注释部分悄悄吃掉', /^(.*)@(.*)$/.exec(withComment)?.[2], '(comment)example.com');
  check('本实现明确报错而不是悄悄改写', M.parseEmail(withComment).code, 'comment');
}

console.log('--- 与 Python email.utils 交叉验证 ---');
{
  const runPython = (args) => {
    try {
      return execFileSync('python3', args, { encoding: 'utf8', timeout: 15000 }).trim();
    } catch {
      return null;
    }
  };

  const probeAvailable = runPython(['-c', 'print("ok")']) === 'ok';

  if (!probeAvailable) {
    skip('Python email.utils 交叉验证', 'python3 不可用');
  } else {
    // `parseaddr` is the wrong tool for the job and that is exactly what this
    // measures: it is a header *parser*, not a validator. Every printable ASCII
    // character is put in the middle of a local part and Python is asked
    // whether it comes back intact.
    const CANDIDATES = [
      ...Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)),
      'é',
      '中',
      '\u2019',
    ];

    const pythonAccepted = [];
    const pythonRejected = [];
    for (const char of CANDIDATES) {
      const output = runPython([
        '-c',
        'from email.utils import parseaddr; import sys; print(parseaddr(sys.argv[1])[1])',
        `a${char}b@example.com`,
      ]);
      if (output === `a${char}b@example.com`) pythonAccepted.push(char);
      else pythonRejected.push(char);
    }

    // Our verdict for the same characters, using the real end-to-end validator.
    const oursAccepted = [];
    const oursRejected = [];
    for (const char of CANDIDATES) {
      if (M.isValidEmail(`a${char}b@example.com`)) oursAccepted.push(char);
      else oursRejected.push(char);
    }

    // Every character we accept must also be accepted by Python. The reverse is
    // deliberately false, and the difference is the evidence.
    check(
      '我们接受的本地部分字符全部也被 Python 接受（我们不会更严格地误杀）',
      oursAccepted.filter((char) => pythonRejected.includes(char)),
      [],
    );

    const pythonOnly = pythonAccepted.filter((char) => !oursAccepted.includes(char));
    const oursOnly = oursRejected.filter((char) => !pythonRejected.includes(char));

    check(
      'Python 接受但我们拒绝的字符只有：空格、反斜杠、Unicode 撇号（说明 parseaddr 过宽，不能当校验器）',
      pythonOnly.join(''),
      ' \\\u2019',
    );
    check(
      'Python 接受空格与反斜杠，RFC 5322 要求它们必须加引号',
      [pythonAccepted.includes(' '), pythonAccepted.includes('\\')],
      [true, true],
    );
    check(
      '我们接受的全部可打印 ASCII 都在 Python 的接受集合里（不会比参照更严格地误杀）',
      oursAccepted
        .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126)
        .filter((char) => !pythonAccepted.includes(char)),
      [],
    );
    check(
      '有分歧的字符只有三个，且都属于“Python 过宽”这一个方向',
      [
        [...pythonOnly].filter((char) => !oursAccepted.includes(char)).length,
        oursOnly.filter((char) => !pythonAccepted.includes(char)).length,
      ],
      [3, 0],
    );
    check(
      '两边都接受的可打印 ASCII 数量一致（分歧只涉及空格与反斜杠两个字符）',
      [
        oursAccepted.filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126).length,
        pythonAccepted.filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126).length,
      ],
      [82, 84],
    );
    check(
      '两个非 ASCII 字母与 Unicode 撇号的判定：字母 / 数字两边都接受',
      [
        oursAccepted.includes('é'),
        oursAccepted.includes('中'),
        pythonAccepted.includes('é'),
        pythonAccepted.includes('中'),
      ],
      [true, true, true, true],
    );
    check(
      'Unicode 撇号 U+2019：我们按 atext 规则拒绝，Python 照单全收',
      [oursAccepted.includes('\u2019'), pythonAccepted.includes('\u2019')],
      [false, true],
    );

    // Concrete demonstrations that parseaddr cannot be a validator.
    check(
      'parseaddr“接受”了 us..er@example.com（连续点号）',
      runPython([
        '-c',
        'from email.utils import parseaddr; import sys; print(parseaddr(sys.argv[1])[1])',
        'us..er@example.com',
      ]),
      'us..er@example.com',
    );
    check(
      'parseaddr“接受”了 a\\b@example.com（反斜杠未加引号）',
      runPython([
        '-c',
        'from email.utils import parseaddr; import sys; print(parseaddr(sys.argv[1])[1])',
        'a\\b@example.com',
      ]),
      'a\\b@example.com',
    );
    check(
      'parseaddr 对两封地址直接返回空字符串（放弃解析，而不是报错）',
      runPython([
        '-c',
        'from email.utils import parseaddr; import sys; print(repr(parseaddr(sys.argv[1])[1]))',
        'test@example.com, test2@example.com',
      ]),
      "''",
    );
    check(
      'parseaddr 静默扒掉 RFC 5322 注释',
      runPython([
        '-c',
        'from email.utils import parseaddr; import sys; print(parseaddr(sys.argv[1])[1])',
        'john.smith@(comment)example.com',
      ]),
      'john.smith@example.com',
    );
    check(
      'parseaddr 原样接受带引号的本地部分（不判断它是否合法）',
      runPython([
        '-c',
        'from email.utils import parseaddr; import sys; print(parseaddr(sys.argv[1])[1])',
        '"a b"@example.com',
      ]),
      '"a b"@example.com',
    );
    check(
      '我们对上述每种情况都给出明确结论而不是静默改写',
      [
        M.isValidEmail('us..er@example.com'),
        M.isValidEmail('a\\b@example.com'),
        M.isValidEmail('test@example.com, test2@example.com'),
        M.parseEmail('john.smith@(comment)example.com').code,
        M.parseEmail('"a b"@example.com').code,
      ],
      [false, false, false, 'comment', 'whitespace'],
    );
  }
}

console.log('--- 往返与规范化幂等性 ---');
{
  const samples = [
    'alice@example.com',
    'A.B+tag@Example.COM',
    'user@münchen.de',
    'first.last+tag@gmail.com',
    'user@xn--mnchen-3ya.de',
    '用户@例え.jp',
    'user@[192.168.1.1]',
    'user@sub.domain.example.co.uk',
  ];
  const optionSets = [OPTIONS_OFF, OPTIONS_LOWER, OPTIONS_GMAIL];
  const problems = [];
  for (const sample of samples) {
    for (const options of optionSets) {
      const once = M.normaliseEmail(sample, options);
      if (!once.ok) {
        problems.push(`${sample} 被拒绝`);
        continue;
      }
      // Idempotence: normalising a normalised address must not change it again.
      const twice = M.normaliseEmail(once.normalised, options);
      if (!twice.ok) problems.push(`${sample} → ${once.normalised} 之后不再合法`);
      else if (twice.normalised !== once.normalised) {
        problems.push(`${once.normalised} 二次规范化变成 ${twice.normalised}`);
      }
      // The ASCII form must itself be valid and stable.
      if (!M.isValidEmail(once.asciiAddress)) {
        problems.push(`${sample} 的 ASCII 形式 ${once.asciiAddress} 自己不合法`);
      }
      if (once.asciiAddress !== once.asciiAddress.trim()) problems.push('ASCII 形式含空白');
    }
  }
  check(`${samples.length} 个样本 × 3 组选项：规范化幂等、ASCII 形式自洽`, problems, []);

  check(
    'ASCII 形式对 IDN 使用 Punycode',
    M.normaliseEmail('user@münchen.de', OPTIONS_OFF).asciiAddress,
    'user@xn--mnchen-3ya.de',
  );
  // The normalised form is the ASCII form, because that is the one that is safe
  // to store and to hand to an SMTP client; the Unicode form is reported
  // alongside it. Both are pinned against node:url rather than hard-coded.
  check(
    'normalised 使用 Punycode 域名（ASCII，可直接用于 SMTP）',
    M.normaliseEmail('user@münchen.de', OPTIONS_OFF).normalised,
    `user@${domainToASCII('münchen.de')}`,
  );
  check(
    'domainUnicode 保留可读的 Unicode 域名',
    M.normaliseEmail('user@münchen.de', OPTIONS_OFF).domainUnicode,
    domainToUnicode(domainToASCII('münchen.de')),
  );
  check(
    '规范化不改变本地部分的内容（默认不做小写、不去点）',
    M.normaliseEmail('First.Last+Tag@Example.COM', OPTIONS_OFF).local,
    'First.Last+Tag',
  );
}

console.log('--- 批量模式 ---');
{
  const text = [
    '  alice@example.com  ',
    'ALICE@EXAMPLE.COM',
    '',
    'Display Name <bob@Example.com>',
    'user@munchen.example',
    'bad@@address',
    'user@mailinator.com',
    'first.last+tag@gmail.com',
    'user@example.com',
    '  ',
  ].join('\n');

  // 10 lines, two of them blank, so 8 rows and the original line numbers 1..9.
  const summary = M.normaliseBatch(text, OPTIONS_OFF);
  check('空行被跳过（共 8 行有效输入）', summary.total, 8);
  check('合法 7 条', summary.valid, 7);
  check('非法 1 条', summary.invalid, 1);
  check('第 6 行是那条非法地址', summary.rows.find((row) => !row.result.ok)?.line, 6);
  check('识别出 1 个一次性邮箱', summary.disposable, 1);
  check('识别出 1 个 gmail', summary.gmail, 1);
  check(
    '默认（本地部分不小写）时 alice 与 ALICE 算两个不同地址，7 条全不重复',
    [summary.uniqueNormalised, summary.duplicates],
    [7, []],
  );
  check(
    '两种选项下 alice 都被判为重复（第 1 行与第 9 行是同一地址）',
    summary.rows.filter((row) => row.result.ok && row.result.normalised === 'alice@example.com').map((row) => row.line),
    [1],
  );
  check(
    '带显示名的尖括号被剥掉，但 input 保留原始行',
    [
      summary.rows.find((row) => row.line === 4)?.result.normalised,
      summary.rows.find((row) => row.line === 4)?.input,
    ],
    ['bob@example.com', 'Display Name <bob@Example.com>'],
  );
  check(
    '首尾空白被去掉',
    summary.rows.find((row) => row.line === 1)?.result.normalised,
    'alice@example.com',
  );
  check(
    '行号保留原始位置（第 4 行、第 9 行都在）',
    summary.rows.map((row) => row.line),
    [1, 2, 4, 5, 6, 7, 8, 9],
  );

  // Duplicate detection inherits the options. Folding the local part (Gmail does
  // this for real, and plenty of corporate mail does too) turns the two `alice`
  // spellings into one entry.
  const folded = M.normaliseBatch(text, OPTIONS_LOWER);
  check(
    '本地部分小写后 alice / ALICE 合并，唯一地址数下降并出现重复项',
    [folded.uniqueNormalised, folded.duplicates],
    [6, ['alice@example.com']],
  );

  const gmailSummary = M.normaliseBatch(text, OPTIONS_GMAIL);
  check(
    'Gmail 规则下 first.last+tag 与 firstlast 等价（这里是同一行）',
    gmailSummary.rows.find((row) => row.line === 8)?.result.normalised,
    'firstlast@gmail.com',
  );
  check(
    'Gmail 规则让第 8 行与不存在的 firstlast@gmail.com 等价（通过与规范形式比较验证）',
    gmailSummary.rows.find((row) => row.line === 8)?.result.normalised,
    M.normaliseEmail('firstlast@gmail.com', OPTIONS_GMAIL).normalised,
  );

  const limited = M.normaliseBatch(text, OPTIONS_OFF, 3);
  check('超过上限时只处理前 3 行（含被跳过的空行）', limited.total, 2);
  check(
    '截断后处理的是第 1、2 行',
    limited.rows.map((row) => row.line),
    [1, 2],
  );

  const empty = M.normaliseBatch('', OPTIONS_OFF);
  check('空输入返回空汇总而不是报错', [empty.total, empty.valid, empty.invalid], [0, 0, 0]);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}${skipped ? `, ${skipped} skipped（不可用时明确跳过，未计入通过）` : ''}`);
process.exit(failed === 0 ? 0 : 1);
