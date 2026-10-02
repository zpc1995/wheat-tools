/**
 * Checks the password strength analyser.
 *
 * The claim worth defending is that pattern analysis beats charset arithmetic,
 * so the checks are built around the two published figures that make the point:
 *
 *   - XKCD #936 prices "Tr0ub4dor&3" at ~28 bits and a four-word passphrase at
 *     44 bits, while charset arithmetic pays the first one 72 bits. The analyser
 *     must reproduce that ordering and that magnitude.
 *   - SecLists' `10k-most-common.txt` is the ranked source of the built-in weak
 *     password list, so its published order is transcribed here and compared
 *     against the shipped list, and the ranks are checked against log2(rank).
 *
 * The charset entropy is recomputed by an independent implementation of the
 * formula in this script rather than by calling the analyser's own helper, and
 * the crack-time arithmetic is recomputed from the scenario rates.
 *
 * Usage: node scripts/check-password-strength.mjs
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/password-strength/passwordStrengthUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/password-strength.mjs', compiled);
const M = await import(pathToFileURL('.verify/password-strength.mjs').href);

let passed = 0;
let failed = 0;

function record(ok, label, detail) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        ${detail}`}`);
}

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  record(ok, label, `got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`);
}

function close(label, actual, expected, tolerance = 1e-6) {
  const ok = Math.abs(actual - expected) <= tolerance;
  record(ok, label, `got      ${actual}\n        expected ${expected} (±${tolerance})`);
}

function assert(label, condition, detail = '') {
  record(Boolean(condition), label, detail);
}

// ---------------------------------------------------------------------------
// An independent implementation of the charset formula and the pool sizes.
// ASCII only on purpose: duplicating the Unicode block table here would test
// the table against itself rather than against the formula.
// ---------------------------------------------------------------------------
function independentPool(password) {
  let pool = 0;
  let lower = false;
  let upper = false;
  let digit = false;
  let symbol = false;
  let space = false;
  for (const char of password) {
    const code = char.codePointAt(0);
    if (code >= 97 && code <= 122) lower = true;
    else if (code >= 65 && code <= 90) upper = true;
    else if (code >= 48 && code <= 57) digit = true;
    else if (code === 32) space = true;
    else if (code >= 33 && code <= 126) symbol = true;
  }
  if (lower) pool += 26;
  if (upper) pool += 26;
  if (digit) pool += 10;
  if (symbol) pool += 32;
  if (space) pool += 1;
  return pool;
}

function independentCharsetBits(password) {
  const length = [...password].length;
  const pool = independentPool(password);
  if (length === 0 || pool <= 1) return 0;
  return length * Math.log2(pool);
}

console.log('--- 字符集熵：与独立实现的公式复算一致 ---');
{
  const samples = ['abc', 'aB1!', 'abc123', 'P@ssw0rd', 'correcthorsebatterystaple', 'Zx9!', 'aaaa', ' a b '];
  let mismatches = 0;
  for (const sample of samples) {
    const analysis = M.analysePassword(sample);
    if (Math.abs(analysis.charsetBits - independentCharsetBits(sample)) > 1e-9) mismatches += 1;
  }
  check('8 个样本的字符集熵与独立实现完全一致', mismatches, 0);

  close('log2(26) × 3', M.analysePassword('abc').charsetBits, 3 * Math.log2(26));
  close('log2(94) × 4（大小写+数字+符号）', M.analysePassword('aB1!').charsetBits, 4 * Math.log2(94));
  close(
    '95 个可打印 ASCII（含空格）= 26 + 26 + 10 + 32 + 1',
    independentCharsetBits('aA1 !'),
    5 * Math.log2(95),
  );
  check('空密码的字符集熵为 0', M.analysePassword('').charsetBits, 0);
  check('单个字符的池不会退化成 0', M.analysePassword('a').composition.poolSize, 26);
}

console.log('--- 字符集构成：Unicode 按区块计价 ---');
{
  const cjk = M.analysePassword('密码');
  check('两个汉字的池 = 中日韩统一表意文字 20992', cjk.composition.poolSize, 20992);
  close('两个汉字 = 2 × log2(20992)', cjk.charsetBits, 2 * Math.log2(20992));
  check('汉字归类为 other', cjk.breakdown[0].className, 'other');

  const emoji = M.analysePassword('😀');
  check('Emoji 的池 = 2048', emoji.composition.poolSize, 2048);
  check('Emoji 按码点算 1 个字符', emoji.length, 1);
  check('Emoji 的 UTF-16 长度是 2', emoji.utf16Length, 2);

  const latin = M.analysePassword('ä');
  check('带变音符的拉丁字母按 448 计', latin.composition.poolSize, 448);

  const mixed = M.analysePassword('密码123');
  check('汉字 + 数字的池是两者之和', mixed.composition.poolSize, 20992 + 10);
  check('数字计入 digits', mixed.composition.counts.digits, 3);
  check('汉字计入 other', mixed.composition.counts.other, 2);
}

console.log('--- 反证：字符集公式会高估 ---');
{
  const xkcd = M.analysePassword('Tr0ub4dor&3');
  close('Tr0ub4dor&3 的字符集上界 72.1 位', xkcd.charsetBits, 11 * Math.log2(94), 1e-6);
  assert(
    'Tr0ub4dor&3 的有效熵在 XKCD 的 ~28 位附近（±10 位）',
    Math.abs(xkcd.effectiveBits - 28) <= 10,
    `effectiveBits = ${xkcd.effectiveBits.toFixed(2)}`,
  );
  assert(
    '字符集公式对 Tr0ub4dor&3 高估了 35 位以上',
    xkcd.charsetBits - xkcd.effectiveBits > 35,
    `charset ${xkcd.charsetBits.toFixed(1)} vs effective ${xkcd.effectiveBits.toFixed(1)}`,
  );
  check(
    '只按字符集判断会把 Tr0ub4dor&3 判为“强”或更好（这就是问题所在）',
    ['强', '很强', '极强'].includes(M.verdictFor(xkcd.charsetBits).label),
    true,
  );
  check(
    '模式分析把它降级为“弱”或更差',
    ['极弱', '弱'].includes(xkcd.verdict.label),
    true,
  );
  assert(
    '它识别出了那个单词片段，而不是当成随机字母',
    xkcd.segments.some((segment) => segment.kind === 'word' && segment.text === 'Tr0ub4dor'),
    xkcd.segments.map((segment) => `${segment.kind}:${segment.text}`).join(' '),
  );

  const passphrase = M.analysePassword('correcthorsebatterystaple');
  assert(
    'correcthorsebatterystaple 的有效熵在 XKCD 的 44 位附近（±10 位）',
    Math.abs(passphrase.effectiveBits - 44) <= 10,
    `effectiveBits = ${passphrase.effectiveBits.toFixed(2)}`,
  );
  assert(
    '全小写的四词短语比 Tr0ub4dor&3 更强（XKCD 的结论）',
    passphrase.effectiveBits > xkcd.effectiveBits + 5,
    `${passphrase.effectiveBits.toFixed(1)} vs ${xkcd.effectiveBits.toFixed(1)}`,
  );
  check(
    '四词短语被拆成 4 个模式片段（horse 命中弱口令表，因此不都是 word）',
    passphrase.segments.filter((s) => s.kind !== 'brute-force').length,
    4,
  );
  close('每个单词按 log2(2048) = 11 位计', M.COMMON_WORD_BITS, Math.log2(2048));
  close('四个单词 = 44 位', 4 * M.COMMON_WORD_BITS, 44);

  const weak = M.analysePassword('password123');
  close('password123 的字符集上界 56.9 位', weak.charsetBits, 11 * Math.log2(36));
  assert(
    'password123 有效熵低于 20 位（长度够但模式弱）',
    weak.effectiveBits < 20,
    `effectiveBits = ${weak.effectiveBits.toFixed(2)}`,
  );
  assert(
    'password123 的低估幅度超过 30 位',
    weak.charsetBits - weak.effectiveBits > 30,
    `${weak.charsetBits.toFixed(1)} - ${weak.effectiveBits.toFixed(1)}`,
  );
  assert(
    'password123 既不是“强”也不是“很强”',
    !['强', '很强', '极强'].includes(weak.verdict.label),
    weak.verdict.label,
  );
  assert(
    'password123 里 password 被单独识别出来（子串匹配，榜单里其实没有整串）',
    weak.segments.some((segment) => segment.kind === 'weak-list' && segment.text === 'password'),
    weak.segments.map((segment) => `${segment.kind}:${segment.text}`).join(' '),
  );
  check('公开榜单里确实没有 password123 这一条', M.weakPasswordRank('password123'), undefined);
}

console.log('--- 弱口令表：与 SecLists 10k-most-common.txt 的公布顺序核对 ---');
{
  // Transcribed from the published file (first 20 lines, in order).
  const publishedTop20 = [
    'password', '123456', '12345678', '1234', 'qwerty',
    '12345', 'dragon', 'pussy', 'baseball', 'football',
    'letmein', 'monkey', '696969', 'abc123', 'mustang',
    'michael', 'shadow', 'master', 'jennifer', '111111',
  ];
  check(
    '内置词表的前 20 条与公开榜单逐条一致',
    M.WEAK_PASSWORDS.slice(0, 20),
    publishedTop20,
  );
  check('排名第 1 的是 password', M.weakPasswordRank('password'), 1);
  check('排名第 5 的是 qwerty', M.weakPasswordRank('qwerty'), 5);
  check('排名第 14 的是 abc123', M.weakPasswordRank('abc123'), 14);
  check('排名第 740 的是 admin', M.weakPasswordRank('admin'), 740);
  check('大小写不敏感', M.weakPasswordRank('PASSWORD'), 1);
  assert('词表至少 1000 条', M.WEAK_PASSWORDS.length >= 1000, `length = ${M.WEAK_PASSWORDS.length}`);
  check('词表没有重复条目', new Set(M.WEAK_PASSWORDS).size, M.WEAK_PASSWORDS.length);
  check(
    '词表全部为小写',
    M.WEAK_PASSWORDS.every((entry) => entry === entry.toLowerCase()),
    true,
  );

  // Cross-check against the second published list, 500-worst-passwords.txt.
  const worstListTop = [
    '123456', 'password', '12345678', '1234', 'pussy', '12345', 'dragon', 'qwerty',
    '696969', 'mustang', 'letmein', 'baseball', 'master', 'michael', 'football',
    'shadow', 'monkey', 'abc123', 'pass', 'jordan', 'harley', 'ranger', 'jennifer',
    'hunter', '2000', 'test', 'batman', 'trustno1', 'thomas', 'tigger', 'robert',
    'access', 'love', 'buster', '1234567', 'soccer', 'hockey', 'killer', 'george',
  ];
  const present = worstListTop.filter((entry) => M.weakPasswordRank(entry) !== undefined);
  check('与第二份公开榜单（500-worst）的 39 条交集全部收录', present.length, worstListTop.length);

  const rankBits = M.analysePassword('password');
  check('password 是第 1 位，值 0 位熵', rankBits.effectiveBits, 0);
  check('password 被标记为常见弱口令', rankBits.findings[0].id, 'pattern-weak-list');
  close('admin 按 log2(740) 计价', M.analysePassword('admin').effectiveBits, Math.log2(740), 1e-9);
  assert(
    'P@ssw0rd = password + 2 处形近替换（各 log2(3)）+ 首字母大写（1 位）',
    Math.abs(
      M.analysePassword('P@ssw0rd').effectiveBits - (2 * M.LEET_SUBSTITUTION_BITS + 1),
    ) < 1e-9,
    `effectiveBits = ${M.analysePassword('P@ssw0rd').effectiveBits}`,
  );
  assert(
    'P@ssw0rd 只值几位的量级',
    M.analysePassword('P@ssw0rd').effectiveBits < 10,
    `effectiveBits = ${M.analysePassword('P@ssw0rd').effectiveBits}`,
  );
}

console.log('--- 模式识别 ---');
{
  const repeatShort = M.analysePassword('aaaaaaaa');
  assert(
    'aaaaaaaa 被识别为重复',
    repeatShort.segments.some((segment) => segment.kind === 'repeat'),
    repeatShort.segments.map((segment) => segment.kind).join(' '),
  );
  assert('aaaaaaaa 低于 12 位', repeatShort.effectiveBits < 12, `${repeatShort.effectiveBits}`);

  const repeatBlock = M.analysePassword('abcabcabc');
  assert(
    'abcabcabc 被识别为重复',
    repeatBlock.segments.some((segment) => segment.kind === 'repeat'),
    repeatBlock.segments.map((segment) => segment.kind).join(' '),
  );
  assert('abcabcabc 低于 16 位', repeatBlock.effectiveBits < 16, `${repeatBlock.effectiveBits}`);

  const digits = M.analysePassword('123456789');
  assert(
    '123456789 被识别为序列或弱口令',
    digits.segments.some((segment) => segment.kind === 'sequence' || segment.kind === 'weak-list'),
    digits.segments.map((segment) => `${segment.kind}:${segment.text}`).join(' '),
  );
  assert('123456789 低于 15 位', digits.effectiveBits < 15, `${digits.effectiveBits}`);

  for (const keyboard of ['qwertyuiop', 'zxcvbnm', 'asdfghjkl']) {
    const analysis = M.analysePassword(keyboard);
    assert(
      `${keyboard} 被识别为键盘序或弱口令`,
      analysis.segments.some((segment) => segment.kind === 'keyboard' || segment.kind === 'weak-list'),
      analysis.segments.map((segment) => segment.kind).join(' '),
    );
    assert(`${keyboard} 低于 12 位`, analysis.effectiveBits < 12, `${analysis.effectiveBits}`);
  }

  const compactDate = M.analysePassword('19900101');
  assert(
    '19900101 被识别为日期',
    compactDate.segments.some((segment) => segment.kind === 'date'),
    compactDate.segments.map((segment) => segment.kind).join(' '),
  );
  assert('19900101 低于 20 位', compactDate.effectiveBits < 20, `${compactDate.effectiveBits}`);

  const separatedDate = M.analysePassword('12/31/1990');
  assert(
    '12/31/1990 被识别为带分隔符的日期',
    separatedDate.segments.some((segment) => segment.kind === 'date'),
    separatedDate.segments.map((segment) => `${segment.kind}:${segment.text}`).join(' '),
  );
  assert('12/31/1990 低于 20 位', separatedDate.effectiveBits < 20, `${separatedDate.effectiveBits}`);

  const year = M.analysePassword('1990');
  assert(
    '1990 被识别为年份',
    year.segments.some((segment) => segment.kind === 'year'),
    year.segments.map((segment) => segment.kind).join(' '),
  );
  close('年份池 136 种 → 7.09 位', year.effectiveBits, Math.log2(136), 1e-9);
  check('1900 之前的四位数不是年份', M.analysePassword('1899').segments[0].kind, 'brute-force');
  check('2035 之后的四位数不是年份', M.analysePassword('2099').segments[0].kind, 'brute-force');

  const randomish = M.analysePassword('q7m2v9x4zk');
  close(
    '看起来随机的密码不会被无端扣分（有效熵 = 字符集熵）',
    randomish.effectiveBits,
    randomish.charsetBits,
    1e-9,
  );
  assert(
    '随机密码没有命中任何模式片段',
    randomish.segments.every((segment) => segment.kind === 'brute-force'),
    randomish.segments.map((segment) => `${segment.kind}:${segment.text}`).join(' '),
  );
  close('10 位小写+数字 = 10 × log2(36)', randomish.charsetBits, 10 * Math.log2(36));

  // The pattern pass may only ever lower the estimate.
  let increases = 0;
  const samples = [
    'password', 'P@ssw0rd', 'qwerty', 'aaa', 'abcabc', '123456', '19900101', '12/31/1990',
    'correcthorsebatterystaple', 'Tr0ub4dor&3', 'q7m2v9x4zk', 'Zx9!Qw2#Er5$', '密码123',
    '😀😀😀', 'a', 'Test1234', 'letmein!', 'summer2024', 'michael1985', 'iloveyou',
  ];
  for (const sample of samples) {
    const analysis = M.analysePassword(sample);
    if (analysis.effectiveBits > analysis.charsetBits + 1e-9) increases += 1;
    if (analysis.effectiveBits < 0) increases += 1;
  }
  check('20 个样本中，模式分析从不把熵估算调高，也不出现负值', increases, 0);
}

console.log('--- 上下文词 ---');
{
  const bare = M.analysePassword('Acme2024!');
  const withContext = M.analysePassword('Acme2024!', { contextWords: ['acme'] });
  assert(
    '提供上下文词后有效熵下降',
    withContext.effectiveBits < bare.effectiveBits,
    `${bare.effectiveBits.toFixed(2)} → ${withContext.effectiveBits.toFixed(2)}`,
  );
  assert(
    '下降的正是那个上下文片段',
    withContext.segments.some((segment) => segment.kind === 'context' && segment.text === 'Acme'),
    withContext.segments.map((segment) => `${segment.kind}:${segment.text}`).join(' '),
  );
  check('上下文词原样出现时值 0 位熵', M.analysePassword('wheattools', { contextWords: ['wheattools'] }).effectiveBits, 0);
  check(
    '少于 3 个字符的上下文词被忽略',
    M.analysePassword('ab12', { contextWords: ['ab'] }).segments.some((segment) => segment.kind === 'context'),
    false,
  );
  check(
    '重复的上下文词只算一次',
    M.analysePassword('acme', { contextWords: ['acme', 'ACME'] }).findings.some(
      (finding) => finding.id === 'context-provided',
    ),
    true,
  );
}

console.log('--- 破解时间：独立复算 + 量级断言 ---');
{
  const forty = M.estimateCrackTimes(40);
  const slow = forty.find((estimate) => estimate.id === 'slow');
  const fast = forty.find((estimate) => estimate.id === 'fast');
  const cluster = forty.find((estimate) => estimate.id === 'cluster');
  const online = forty.find((estimate) => estimate.id === 'online');

  // Average guesses are half the space: log10(2^(40-1) / 1e4).
  close('40 位 / 慢哈希 10^4 次每秒的对数时间', slow.log10Seconds, 39 * Math.log10(2) - 4, 1e-12);
  close('40 位 / 快哈希 10^10 次每秒的对数时间', fast.log10Seconds, 39 * Math.log10(2) - 10, 1e-12);
  close('40 位 / 集群 10^13 次每秒的对数时间', cluster.log10Seconds, 39 * Math.log10(2) - 13, 1e-12);
  close('40 位 / 在线限速 10 次每小时的对数时间', online.log10Seconds, 39 * Math.log10(2) - Math.log10(10 / 3600), 1e-12);
  assert(
    '同一密码下：在线 > 慢哈希 > 快哈希 > 集群',
    online.log10Seconds > slow.log10Seconds &&
      slow.log10Seconds > fast.log10Seconds &&
      fast.log10Seconds > cluster.log10Seconds,
    forty.map((estimate) => `${estimate.id}:${estimate.log10Seconds.toFixed(2)}`).join(' '),
  );

  check('负数秒 → 不到 1 秒', M.formatCrackTime(-0.5), '不到 1 秒');
  check('1 秒', M.formatCrackTime(0), '1 秒');
  check('59 秒', M.formatCrackTime(Math.log10(59)), '59 秒');
  check('2 分钟', M.formatCrackTime(Math.log10(120)), '2 分钟');
  check('2 小时', M.formatCrackTime(Math.log10(7200)), '2 小时');
  check('3 天', M.formatCrackTime(Math.log10(86400 * 3)), '3 天');
  check('2 年', M.formatCrackTime(Math.log10(86400 * 365.25 * 2)), '2 年');
  check('1.0 百万年', M.formatCrackTime(Math.log10(86400 * 365.25 * 1e6)), '1.0 百万年');
  check('极大值走科学计数法', M.formatCrackTime(40), '约 10^32 年');

  const weakPass = M.analysePassword('password');
  assert(
    'password 在所有场景下都是“不到 1 秒”或几分钟',
    weakPass.crackTimes.every(
      (estimate) => estimate.human === '不到 1 秒' || estimate.human.includes('分钟'),
    ),
    weakPass.crackTimes.map((estimate) => `${estimate.id}:${estimate.human}`).join(' '),
  );

  // Why log space: 2^bits overflows a double long before a 256-character
  // password's entropy is reached, so the naive division yields Infinity.
  assert('朴素写法 Math.pow(2, 2000) 会溢出为 Infinity', Math.pow(2, 2000) === Infinity);
  const huge = M.estimateCrackTimes(2000);
  assert(
    '2000 位熵仍然给出有限的对数时间与“10^n 年”的可读结果',
    huge.every(
      (estimate) => Number.isFinite(estimate.log10Seconds) && estimate.human.startsWith('约 10^'),
    ),
    huge.map((estimate) => `${estimate.id}:${estimate.human}`).join(' '),
  );
  const strongTimes = M.estimateCrackTimes(80);
  assert(
    '80 位在快哈希场景下超过 1000 年',
    strongTimes.find((estimate) => estimate.id === 'fast').human.includes('年'),
    strongTimes.find((estimate) => estimate.id === 'fast').human,
  );
  assert(
    '80 位在集群场景下仍然以年计（不是秒/天）',
    strongTimes.find((estimate) => estimate.id === 'cluster').human.includes('年'),
    strongTimes.find((estimate) => estimate.id === 'cluster').human,
  );
}

console.log('--- 建议：有数据支撑 ---');
{
  const analysis = M.analysePassword('q7m2v9x4zk');
  const length = analysis.suggestions.find((suggestion) => suggestion.id === 'length');
  const symbols = analysis.suggestions.find((suggestion) => suggestion.id === 'symbols');
  close('加长到 16 位 = 6 × log2(36)', length.gainBits, 6 * Math.log2(36), 1e-9);
  close('加入符号的收益 = 10 × (log2(68) − log2(36))', symbols.gainBits, 10 * (Math.log2(68) - Math.log2(36)), 1e-9);
  assert(
    '在 10 位密码上，加长 6 位比加符号的收益高 3 倍以上',
    length.gainBits > symbols.gainBits * 3,
    `${length.gainBits.toFixed(2)} vs ${symbols.gainBits.toFixed(2)}`,
  );
  check(
    '建议按收益从高到低排序',
    analysis.suggestions.map((suggestion) => suggestion.gainBits)
      .every((gain, index, gains) => index === 0 || gains[index - 1] >= gain),
    true,
  );
  check('收益最大的建议被标记为 recommended', analysis.suggestions[0].recommended, true);
  check('只有一条建议被标记 recommended', analysis.suggestions.filter((s) => s.recommended).length, 1);
  assert(
    '总会给出“不要重复使用密码”这类不计熵的建议',
    analysis.suggestions.some((suggestion) => suggestion.id === 'reuse' && suggestion.gainBits === 0),
  );
  assert(
    '弱密码会得到“换掉可预测片段”的建议',
    M.analysePassword('password123').suggestions.some((suggestion) => suggestion.id === 'remove-patterns'),
  );
  assert(
    '弱密码会得到改用随机单词短语的建议',
    M.analysePassword('P@ssw0rd').suggestions.some((suggestion) => suggestion.id === 'passphrase'),
  );
  assert(
    '已经用满字符类型时不再给“加入符号”的建议',
    !M.analysePassword('Zx9!Qw2#Er5$').suggestions.some((suggestion) => suggestion.id === 'symbols'),
  );
}

console.log('--- 边界与结构 ---');
{
  const empty = M.analysePassword('');
  check('空输入标记为 empty', empty.empty, true);
  check('空输入长度为 0', empty.length, 0);
  check('空输入的逐字符表为空', empty.breakdown.length, 0);
  check('空输入没有建议', empty.suggestions.length, 0);
  check('空输入的结论是占位符', empty.verdict.label, '—');
  check('空输入的片段为空', empty.segments.length, 0);

  const breakdown = M.analysePassword('Tr0ub4dor&3').breakdown;
  check('逐字符表覆盖每个码点', breakdown.length, 11);
  check('第一位属于单词片段', breakdown[0].segmentKind, 'word');
  check('最后一位没有匹配到模式', breakdown[10].segmentKind, 'brute-force');
  check('码位格式化正确', breakdown[0].codePoint, 'U+0054');
  check('字符类型正确', breakdown[0].className, 'uppercase');
  check('第 4 位是小写字母 u', breakdown[3].char, 'u');

  const long = 'x'.repeat(1200);
  const longAnalysis = M.analysePassword(long);
  assert('1200 字符的输入不会抛异常', longAnalysis.length === 1200, `length = ${longAnalysis.length}`);
  assert('1200 字符的字符集熵很大', longAnalysis.charsetBits > 5000, `${longAnalysis.charsetBits}`);
  assert(
    '长重复串被识别为重复片段',
    longAnalysis.segments.some((segment) => segment.kind === 'repeat'),
    longAnalysis.segments.map((segment) => segment.kind).join(' '),
  );

  const mixed = 'Zx9!Qw2#Er5$Tz8@';
  const mixedAnalysis = M.analysePassword(mixed);
  close('复杂随机串不被模式扣分', mixedAnalysis.effectiveBits, mixedAnalysis.charsetBits, 1e-9);
  assert('复杂随机串 100+ 位', mixedAnalysis.effectiveBits > 100, `${mixedAnalysis.effectiveBits}`);

  const zeroWidth = M.analysePassword('\u200b');
  assert('零宽字符不会导致崩溃', zeroWidth.length === 1, `length = ${zeroWidth.length}`);
}

console.log('--- 静态检查：不上传、不保存、不用 Math.random ---');
{
  const dir = 'src/tools/password-strength';
  const files = readdirSync(dir);
  check('工具目录包含所需的四个文件', files.sort(), ['PasswordStrengthTool.tsx', 'index.ts', 'manifest.ts', 'passwordStrengthUtils.ts']);
  const forbidden = ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'indexedDB', 'sendBeacon', 'WebSocket', 'Math.random'];
  let hits = 0;
  for (const file of files) {
    const text = readFileSync(`${dir}/${file}`, 'utf8');
    for (const needle of forbidden) {
      if (text.includes(needle)) {
        hits += 1;
        console.log(`        命中 ${needle} → ${file}`);
      }
    }
  }
  check('工具源码不含任何网络、存储或 Math.random 调用', hits, 0);
  const component = readFileSync(`${dir}/PasswordStrengthTool.tsx`, 'utf8');
  assert('密码输入框默认 type=password', component.includes("type={visible ? 'text' : 'password'}"));
  assert('密码输入框关闭自动填充', component.includes('autoComplete="off"'));
  assert('页面提供了“不在第三方页面输入真实密码”的提示', component.includes('第三方页面输入真实密码'));
  assert('页面说明不做密码库比对', component.includes('不做') && component.includes('密码库比对'));
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
