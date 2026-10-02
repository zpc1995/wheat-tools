/**
 * Checks the string obfuscator.
 *
 * The claims worth defending are:
 *
 *   1. **Round trip.** For every transform and every combination of them,
 *      obfuscating and then reverting returns the original character for
 *      character. This is verified with the original supplied as the
 *      disambiguator, plus, where the transform is genuinely one to one, with no
 *      original at all. It runs over a hand picked corpus (Chinese, emoji,
 *      combining marks, Arabic, full width, already obfuscated text) and
 *      thousands of pseudo random strings, and over all 128 subsets of the
 *      seven transforms.
 *
 *   2. **Unicode correctness, proved by counterexample.** Reversal is asserted
 *      to work on grapheme clusters, and the naive UTF-16 code unit reversal is
 *      run alongside to show what it breaks: `😀` becomes two lone surrogates
 *      and `e` + U+0301 loses its combining mark. Chinese survives code unit
 *      reversal, which is exactly why the naive version looks acceptable until
 *      it meets an emoji.
 *
 *   3. **Independent references.** The homoglyph table is compared against a
 *      code point list written out here by hand, every entry is asserted to be a
 *      different code point from the Latin letter it imitates, and NFKC is used
 *      as an independent oracle: it must *not* fold any homoglyph (that is why
 *      they are dangerous) while it must fold every full width form this tool
 *      produces (that is the cross check for the full width transform).
 *
 *   4. **Ambiguity is real.** `1` is asserted to have several possible origins
 *      rather than one, and the naive reversion is shown to corrupt a literal
 *      digit.
 *
 * Usage: node scripts/check-string-obfuscator.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/string-obfuscator/stringObfuscatorUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/string-obfuscator.mjs', compiled);
const M = await import(pathToFileURL('.verify/string-obfuscator.mjs').href);

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
const isTrue = (label, value) => check(label, Boolean(value), true);

/** A lone surrogate, i.e. a broken UTF-16 sequence. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const isBroken = (text) => LONE_SURROGATE.test(text);

// Deterministic pseudo random source, so a failure is reproducible.
let seed = 20240917;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const CONFIGS = {
  leet: { id: 'leet' },
  homoglyph: { id: 'homoglyph', direction: 'toLookalike' },
  homoglyphBack: { id: 'homoglyph', direction: 'toLatin' },
  fullwidth: { id: 'fullwidth', direction: 'toFull' },
  fullwidthBack: { id: 'fullwidth', direction: 'toHalf' },
  alternating: { id: 'alternating' },
  prefix: { id: 'prefix' },
  zeroWidth: { id: 'zeroWidth' },
  reverse: { id: 'reverse' },
};

/**
 * The corpus. Every entry is here for a reason: emoji for surrogate pairs, the
 * combining sequence for grapheme clustering, Arabic for right to left, full
 * width for the NFKC cross check, a backslash and a zero width character for the
 * "already contains the marker" edge case.
 */
const CORPUS = [
  '',
  ' ',
  '   \t\n',
  'hello world',
  'Hello, World! 123',
  'aeiostbgl',
  '1234567890',
  '汉字与标点，。！？',
  '😀😃😎',
  'e\u0301 a\u0300 n\u0303',
  '👨‍👩‍👧‍👦',
  '👩🏽‍🚀',
  '🇨🇳🇺🇸',
  'مرحبا بالعالم',
  'Здравствуйте',
  'привет',
  'αβγδε',
  'ＡＢＣ１２３',
  '　全角空格',
  'already 0bfusc4ted',
  'zero\u200Bwidth',
  'back\\slash',
  'e\u0301\u0327',
  'ß İ ǅ',
  'ﬁﬂ①',
  'Ω≈ç√∫',
  'a\u200Cb\u200Dc\uFEFFd',
  'mixed 汉字 😀 e\u0301 123 ＦＵＬＬ',
];

const RANDOM_POOL = [
  'a', 'A', 'z', 'Z', 'b', 'i', 'l', 'o', 'O', 's', 't', 'e', 'g',
  '0', '1', '4', '5', '7', '8', '9', '2',
  ' ', '\\', '\n', '\t', '.', ',', '-',
  '中', '文', '汉', '字', '，', '。',
  '😀', '😃', '👨‍👩‍👧‍👦', '🇨🇳',
  'e\u0301', 'a\u0300',
  '\u200B', '\u200C', '\u200D', '\uFEFF',
  '\u0430', '\u0435', '\u043E', '\u0440', '\u0441', '\u0445', '\u0456', '\u0432',
  '\u03B1', '\u03BF', '\u03BA', '\u03C1', '\u039D', '\u0392',
  '\uFF21', '\uFF41', '\uFF10', '\u3000', '\uFF0C', '\u3001',
  'م', 'ر', 'ح', 'ب', 'ا',
  'ß', 'İ', 'ǅ', 'ﬀ',
];

function randomString(maxLength) {
  const length = Math.floor(rand() * maxLength);
  let out = '';
  for (let i = 0; i < length; i += 1) out += RANDOM_POOL[Math.floor(rand() * RANDOM_POOL.length)];
  return out;
}

/** Applies one step and reverts it with the original, asserting exactness. */
function roundTrip(label, config, text) {
  const forward = M.applyStep(config, text);
  const back = M.invertStep(config, forward.output, text);
  if (back.output !== text) {
    failed += 1;
    console.log(
      `FAIL  ${label}\n        input    ${JSON.stringify(text)}\n` +
        `        forward  ${JSON.stringify(forward.output)}\n        back     ${JSON.stringify(back.output)}`,
    );
    return;
  }
  if (!back.verified) {
    failed += 1;
    console.log(`FAIL  ${label} 未通过重新正向变换验证：${JSON.stringify(text)}`);
    return;
  }
  passed += 1;
}

/** Applies a whole pipeline and reverts it with the original, asserting exactness. */
function pipelineRoundTrip(label, configs, text) {
  const forward = M.applyPipeline(configs, text);
  const back = M.revertPipeline(configs, forward.output, text);
  if (back.output !== text || !back.verified) {
    failed += 1;
    console.log(
      `FAIL  ${label}\n        input    ${JSON.stringify(text)}\n` +
        `        forward  ${JSON.stringify(forward.output)}\n        back     ${JSON.stringify(back.output)}\n` +
        `        verified ${back.verified}`,
    );
    return;
  }
  passed += 1;
}

// ---------------------------------------------------------------------------
console.log('--- 码位与字素簇工具 ---');
check('U+0061 的标签', M.codePointLabel(0x61), 'U+0061');
check('U+1F600 的标签补足四位以上', M.codePointLabel(0x1f600), 'U+1F600');
check('U+200B 的标签', M.codePointLabel(0x200b), 'U+200B');
check('😀 是一个码位', M.codePointCount('😀'), 1);
check('😀 是两个 UTF-16 码元（这正是不能按码元切分的原因）', '😀'.length, 2);
check('e + U+0301 是一个字素簇', M.graphemeCount('e\u0301'), 1);
check('e + U+0301 是两个码位', M.codePointCount('e\u0301'), 2);
check('家庭 emoji 是一个字素簇', M.graphemeCount('👨‍👩‍👧‍👦'), 1);
check('家庭 emoji 是七个码位', M.codePointCount('👨‍👩‍👧‍👦'), 7);
check('空串没有字素簇', M.graphemeCount(''), 0);
check('空格的可打印替身', M.charDisplay(' '), '␠');
check('零宽空格的名称', M.charName('\u200b'), 'ZERO WIDTH SPACE');
check('插入项的"原字符"显示', M.charDisplay(''), '（空）');

// ---------------------------------------------------------------------------
console.log('--- leet：正向替换 ---');
check('a e i o s t b g 的替换结果', M.applyStep(CONFIGS.leet, 'aeiostbg').output, '43105789');
check('大写同样替换（L 也会变成 1）', M.applyStep(CONFIGS.leet, 'HELLO').output, 'H3110');
check(
  '整个小写字母表（没有映射的字母原样保留）',
  M.applyStep(CONFIGS.leet, 'abcdefghijklmnopqrstuvwxyz').output,
  '48cd3f9h1jk1mn0pqr57uvwxyz',
);
check('i 与 l 都映射到 1（这就是歧义的来源）', [M.LEET_FORWARD.i, M.LEET_FORWARD.l], ['1', '1']);
check('o 与 O 都映射到 0', [M.applyChar(CONFIGS.leet, 'o', 0), M.applyChar(CONFIGS.leet, 'O', 0)], ['0', '0']);
{
  // Independent copy of the map, written out from the description rather than
  // read back from the implementation.
  const EXPECTED_LEET = { a: '4', b: '8', e: '3', g: '9', i: '1', l: '1', o: '0', s: '5', t: '7' };
  check('leet 正向表与硬编码清单一致', Object.entries(M.LEET_FORWARD).sort(), Object.entries(EXPECTED_LEET).sort());
  check('leet 正向表恰好九条', Object.keys(M.LEET_FORWARD).length, 9);
}

console.log('--- leet：还原确实不唯一（不是实现漏了） ---');
{
  const one = M.LEET_REVERSE['1'];
  check('1 的候选个数', one.length, 5);
  check('1 的候选集合', [...one].sort(), ['1', 'I', 'i', 'L', 'l'].sort());
  isTrue('1 的候选不止一个', one.length > 1);
  isTrue('1 的候选包含 i', one.includes('i'));
  isTrue('1 的候选包含 l', one.includes('l'));
  const zero = M.LEET_REVERSE['0'];
  check('0 的候选集合', [...zero].sort(), ['0', 'O', 'o'].sort());
  isTrue('0 的候选包含 o 与 O', zero.includes('o') && zero.includes('O'));

  // The reverse table must stay consistent with the forward table: every letter
  // that maps to a digit has to be a candidate for that digit.
  let drift = 0;
  for (const [letter, digit] of Object.entries(M.LEET_FORWARD)) {
    if (!M.LEET_REVERSE[digit].includes(letter)) drift += 1;
    if (!M.LEET_REVERSE[digit].includes(letter.toUpperCase())) drift += 1;
  }
  check('每个正向字母都在对应数字的候选里', drift, 0);

  const single = M.enumerateLeetCandidates('1');
  check('枚举 1 的组合数', single.total, 5);
  check('枚举 1 列出的条数', single.candidates.length, 5);
  check('枚举 1 未被截断', single.truncated, false);
  check('枚举 11 的组合数（乘法增长）', M.enumerateLeetCandidates('11').total, 25);
  const limited = M.enumerateLeetCandidates('11', 3);
  check('限制条数时只列出 3 条', limited.candidates.length, 3);
  check('限制条数时总数仍然真实', limited.total, 25);
  check('限制条数时标记为截断', limited.truncated, true);
  check('空串有一个组合', M.enumerateLeetCandidates('').total, 1);

  const inverted = M.invertStep(CONFIGS.leet, '1');
  check('无原文时 1 的歧义条数', inverted.ambiguities.length, 1);
  check('无原文时 1 的候选条数', inverted.ambiguities[0].candidates.length, 5);
  check('无原文时被标记为不确定', inverted.uncertain, true);

  // The naive answer is not just "not guaranteed"; it is wrong on ordinary text.
  const literal = M.invertStep(CONFIGS.leet, '123');
  check('无原文时 123 会被改成 i2e（证明朴素还原会改坏原有数字）', literal.output, 'i2e');
  isTrue('无原文时 123 的结果确实不等于原文', literal.output !== '123');
  isTrue('i2e 重新正向变换确实是 123（所以它是一个合法原像，但不是原文）', literal.reapplies);
}

console.log('--- leet：带原文的往返 ---');
for (const text of CORPUS) roundTrip('leet 往返', CONFIGS.leet, text);
{
  let bad = 0;
  for (let i = 0; i < 3000; i += 1) {
    const text = randomString(24);
    const forward = M.applyStep(CONFIGS.leet, text);
    const back = M.invertStep(CONFIGS.leet, forward.output, text);
    if (back.output !== text || !back.verified) bad += 1;
  }
  check('3000 条随机字符串的 leet 往返全部逐字符一致', bad, 0);
}

// ---------------------------------------------------------------------------
console.log('--- 零宽字符：插入、还原与不可靠性 ---');
{
  const forward = M.applyStep(CONFIGS.zeroWidth, 'ab');
  check('两个字符插入了两个零宽字符', M.countZeroWidth(forward.output), 2);
  check('插入后的码位数', M.codePointCount(forward.output), 4);
  check('插入的字符循环使用前两个', [...forward.output].filter((c) => M.ZERO_WIDTH_CHARS.includes(c)), [
    '\u200b',
    '\u200c',
  ]);
  check(
    '四个零宽字符都会用到',
    [...new Set(M.applyStep(CONFIGS.zeroWidth, 'abcd').output)].filter((c) => M.ZERO_WIDTH_CHARS.includes(c)).length,
    4,
  );
  check('零宽字符集合', M.ZERO_WIDTH_CHARS.map((c) => M.codePointLabel(c.codePointAt(0))), [
    'U+200B',
    'U+200C',
    'U+200D',
    'U+FEFF',
  ]);

  // The reason this transform breaks search: the visible text is unchanged but
  // the string is not.
  const hidden = M.applyStep(CONFIGS.zeroWidth, 'ab').output;
  check('插入零宽字符后 indexOf 找不到原来的片段', hidden.indexOf('ab'), -1);
  check('插入零宽字符后 includes 为假', hidden.includes('ab'), false);
  check('插入零宽字符后码元长度变了', hidden.length, 4);
  // ZWSP and BOM stand alone as clusters; ZWNJ and ZWJ are "Extend" characters
  // that attach to the preceding cluster, so counting clusters is not a way to
  // count the inserted characters. That is why the tool counts code points.
  check('插入两个零宽字符后的字素簇个数', M.graphemeCount(hidden), 3);
  check('统计隐藏字符要用码位而不是字素簇', M.countZeroWidth(hidden), 2);

  // The reason it is unreliable: a platform that filters them removes the whole
  // obfuscation silently.
  check('平台过滤掉零宽字符后混淆完全消失', hidden.replace(/[\u200B-\u200D\uFEFF]/g, ''), 'ab');

  // The naive code unit insertion breaks the surrogate pair.
  const naiveInsert = '😀'.split('').join('\u200B');
  isTrue('按码元插入零宽字符会把代理对拆坏', isBroken(naiveInsert));
  isTrue('本实现按字素簇插入，结果不是坏掉的 UTF-16', !isBroken(M.applyStep(CONFIGS.zeroWidth, '😀').output));
  check('😀 插入零宽字符后的码位数', M.codePointCount(M.applyStep(CONFIGS.zeroWidth, '😀').output), 2);

  let noOriginalBad = 0;
  for (const text of CORPUS) {
    const forward2 = M.applyStep(CONFIGS.zeroWidth, text);
    const back2 = M.invertStep(CONFIGS.zeroWidth, forward2.output);
    // Without an original this is exact only when the input had no zero width
    // characters of its own.
    if (M.countZeroWidth(text) === 0 && back2.output !== text) noOriginalBad += 1;
  }
  check('无原文时，本身不含零宽字符的语料全部精确还原', noOriginalBad, 0);

  const withOwn = M.applyStep(CONFIGS.zeroWidth, 'a\u200Bb').output;
  check(
    '无原文时会删掉原文里本来就有的零宽字符（这是固有限制）',
    M.invertStep(CONFIGS.zeroWidth, withOwn).output,
    'ab',
  );
  check(
    '带原文时连原有的零宽字符一起还原',
    M.invertStep(CONFIGS.zeroWidth, withOwn, 'a\u200Bb').output,
    'a\u200Bb',
  );

  let bad = 0;
  for (let i = 0; i < 1500; i += 1) {
    const text = randomString(20);
    const forward2 = M.applyStep(CONFIGS.zeroWidth, text);
    const back2 = M.invertStep(CONFIGS.zeroWidth, forward2.output, text);
    if (back2.output !== text || !back2.verified) bad += 1;
  }
  check('1500 条随机字符串的零宽往返全部一致（含原文已含零宽字符的情况）', bad, 0);

  isTrue('界面警告提到了搜索会被破坏', M.TRANSFORM_META.zeroWidth.warning.includes('搜索'));
  isTrue('界面警告提到了复制粘贴会被破坏', M.TRANSFORM_META.zeroWidth.warning.includes('复制'));
  isTrue('界面警告提到了平台会过滤', M.TRANSFORM_META.zeroWidth.warning.includes('过滤'));
}

// ---------------------------------------------------------------------------
console.log('--- 同形字：码位正确性 (独立硬编码参照) ---');
{
  // Written out by hand from the Unicode charts. This is the independent
  // reference: if the implementation table drifts, this catches it.
  const EXPECTED = [
    ['a', 0x0430], ['e', 0x0435], ['o', 0x043e], ['p', 0x0440], ['c', 0x0441], ['x', 0x0445],
    ['y', 0x0443], ['i', 0x0456], ['s', 0x0455], ['j', 0x0458], ['h', 0x04bb],
    ['A', 0x0410], ['B', 0x0412], ['E', 0x0415], ['H', 0x041d], ['I', 0x0406], ['K', 0x041a],
    ['M', 0x041c], ['O', 0x041e], ['P', 0x0420], ['C', 0x0421], ['T', 0x0422], ['X', 0x0425],
    ['Y', 0x0423],
    ['o', 0x03bf], ['a', 0x03b1], ['e', 0x03b5], ['i', 0x03b9], ['k', 0x03ba], ['v', 0x03bd],
    ['p', 0x03c1], ['t', 0x03c4], ['u', 0x03c5], ['x', 0x03c7],
    ['A', 0x0391], ['B', 0x0392], ['E', 0x0395], ['H', 0x0397], ['I', 0x0399], ['K', 0x039a],
    ['M', 0x039c], ['N', 0x039d], ['O', 0x039f], ['P', 0x03a1], ['T', 0x03a4], ['Y', 0x03a5],
    ['X', 0x03a7],
  ];
  check('同形字表条数', M.HOMOGLYPH_TABLE.length, EXPECTED.length);

  const actualPairs = M.HOMOGLYPH_TABLE.map((entry) => [entry.latin, entry.lookalike.codePointAt(0)]);
  const key = (pair) => `${pair[0]}:${pair[1].toString(16)}`;
  check(
    '同形字表与硬编码的码位清单完全一致',
    actualPairs.map(key).sort(),
    EXPECTED.map(key).sort(),
  );

  let equalToLatin = 0;
  let foldedByNfkc = 0;
  let notBmp = 0;
  let latinNotAscii = 0;
  for (const entry of M.HOMOGLYPH_TABLE) {
    if (entry.lookalike === entry.latin) equalToLatin += 1;
    // NFKC must not fold a homoglyph back. If it did, the obfuscation would be
    // undone by any normalisation step and the warning would be wrong.
    if (entry.lookalike.normalize('NFKC') === entry.latin) foldedByNfkc += 1;
    if ((entry.lookalike.codePointAt(0) ?? 0) <= 0x7f) notBmp += 1;
    if ((entry.latin.codePointAt(0) ?? 0) > 0x7f) latinNotAscii += 1;
  }
  check('每个同形字都不等于它模仿的拉丁字母', equalToLatin, 0);
  check('NFKC 不会把任何一个同形字折叠回拉丁字母', foldedByNfkc, 0);
  check('每个同形字都在 ASCII 之外', notBmp, 0);
  check('每个被模仿的目标都是 ASCII 拉丁字母', latinNotAscii, 0);

  check(
    '同形字不重复（反向映射因此唯一）',
    new Set(M.HOMOGLYPH_TABLE.map((entry) => entry.lookalike)).size,
    M.HOMOGLYPH_TABLE.length,
  );

  // Every Latin letter in the table must have exactly one preferred replacement,
  // otherwise the forward pass silently skips it.
  const latins = [...new Set(M.HOMOGLYPH_TABLE.map((entry) => entry.latin))];
  let missingPreferred = 0;
  let multiplePreferred = 0;
  for (const latin of latins) {
    const preferred = M.HOMOGLYPH_TABLE.filter((entry) => entry.latin === latin && entry.preferred);
    if (preferred.length === 0) missingPreferred += 1;
    if (preferred.length > 1) multiplePreferred += 1;
    if (M.preferredLookalike(latin) === null) missingPreferred += 1;
  }
  check('每个拉丁字母都有正向替换目标', missingPreferred, 0);
  check('每个拉丁字母只有一个正向替换目标', multiplePreferred, 0);

  // Independent spot checks straight from the charts.
  check('西里尔 а 的码位', M.HOMOGLYPH_TABLE.find((e) => e.lookalike === '\u0430').lookalike.codePointAt(0), 0x0430);
  check('西里尔 х 的码位', '\u0445'.codePointAt(0), 0x0445);
  check('希腊 ο 的码位', '\u03bf'.codePointAt(0), 0x03bf);
  isTrue('拉丁 a 与西里尔 а 不是同一个字符', 'a' !== '\u0430');
  isTrue('NFKC 不会把西里尔 а 变成 a', '\u0430'.normalize('NFKC') !== 'a');
  isTrue('NFKC 会把全角 Ａ 变成 A（与同形字形成对照）', '\uff21'.normalize('NFKC') === 'A');
}

console.log('--- 同形字：替换与搜索失配 ---');
{
  check('六个被点名的字母', M.applyStep(CONFIGS.homoglyph, 'aeopcx').output, '\u0430\u0435\u043e\u0440\u0441\u0445');
  const disguised = M.applyStep(CONFIGS.homoglyph, 'abcx').output;
  check('替换后不再等于原串', disguised === 'abcx', false);
  check('替换后 indexOf 找不到原串（这既是目的也是风险）', disguised.indexOf('abcx'), -1);
  check('NFKC 规范化也救不回来', disguised.normalize('NFKC').indexOf('abcx'), -1);
  check('码位确实变了', M.applyStep(CONFIGS.homoglyph, 'a').output.codePointAt(0), 0x0430);

  check(
    '同形到拉丁的反向替换',
    M.applyStep(CONFIGS.homoglyphBack, '\u0430b\u0441').output,
    'abc',
  );
  // Genuine Cyrillic text is collateral damage: this is a real risk, not a bug.
  // Only the characters in the table change; the rest of the word stays put.
  const cyrillic = M.applyStep(CONFIGS.homoglyphBack, 'привет').output;
  isTrue('真正的西里尔文本会被反向替换改坏', cyrillic !== 'привет');
  check('其中被替换的字符（р 与 е 换了，其余保留）', cyrillic, 'пpивeт');

  // Several lookalikes share one Latin target, so the inverse is ambiguous.
  const back = M.invertStep(CONFIGS.homoglyphBack, 'a');
  isTrue('同形到拉丁的反向方向是歧义的', back.uncertain);
  check('a 的所有可能来源个数', back.ambiguities[0].candidates.length, 3);
  isTrue('候选里同时有西里尔与希腊', back.ambiguities[0].candidates.includes('\u0430') && back.ambiguities[0].candidates.includes('\u03b1'));
  isTrue('候选里也有拉丁 a 本身', back.ambiguities[0].candidates.includes('a'));

  // The original resolves which lookalike it was.
  check('原文是希腊 α 时能还原', M.invertStep(CONFIGS.homoglyphBack, 'a', '\u03b1').output, '\u03b1');
  check('原文是西里尔 а 时能还原', M.invertStep(CONFIGS.homoglyphBack, 'a', '\u0430').output, '\u0430');
  check('原文是拉丁 a 时保持拉丁', M.invertStep(CONFIGS.homoglyphBack, 'a', 'a').output, 'a');
  check('无原文时退化为首选同形字', M.invertStep(CONFIGS.homoglyphBack, 'a').output, M.preferredLookalike('a'));

  let bad = 0;
  for (let i = 0; i < 1500; i += 1) {
    const text = randomString(20);
    for (const config of [CONFIGS.homoglyph, CONFIGS.homoglyphBack]) {
      const forward = M.applyStep(config, text);
      const revert = M.invertStep(config, forward.output, text);
      if (revert.output !== text || !revert.verified) bad += 1;
    }
  }
  check('1500 条随机字符串在两个同形字方向上都精确往返', bad, 0);

  isTrue('界面警告提到了搜索匹配会被破坏', M.TRANSFORM_META.homoglyph.warning.includes('搜索'));
}

// ---------------------------------------------------------------------------
console.log('--- 大小写交替 ---');
{
  check('hello world 的交替结果', M.applyStep(CONFIGS.alternating, 'hello world').output, 'hElLo wOrLd');
  check('alternating 的交替结果', M.applyStep(CONFIGS.alternating, 'alternating').output, 'aLtErNaTiNg');
  const forward = M.applyStep(CONFIGS.alternating, 'HeLLo');
  check('大小写信息被覆盖', forward.output, 'hElLo');
  const naive = M.invertStep(CONFIGS.alternating, forward.output);
  check('无原文时只能全部小写', naive.output, 'hello');
  check('无原文时被标记为不确定', naive.uncertain, true);
  isTrue('无原文时的小写结果不等于原文', naive.output !== 'HeLLo');
  check('带原文时逐字符还原', M.invertStep(CONFIGS.alternating, forward.output, 'HeLLo').output, 'HeLLo');

  // Case mappings that change length would break positional inversion, so the
  // step leaves them alone.
  const tricky = M.applyStep(CONFIGS.alternating, 'İß').output;
  check('长度会变化的字符（İ ß）保持原样', tricky, 'İß');
  check('带原文时也能还原它们', M.invertStep(CONFIGS.alternating, tricky, 'İß').output, 'İß');
  isTrue('İ 的小写确实会变成两个码位（所以必须避开）', 'İ'.toLowerCase().length === 2);

  let bad = 0;
  for (let i = 0; i < 1500; i += 1) {
    const text = randomString(20);
    const forward2 = M.applyStep(CONFIGS.alternating, text);
    const back = M.invertStep(CONFIGS.alternating, forward2.output, text);
    if (back.output !== text || !back.verified) bad += 1;
  }
  check('1500 条随机字符串的大小写交替精确往返', bad, 0);
}

// ---------------------------------------------------------------------------
console.log('--- 反转：字素簇 vs UTF-16 码元（反证） ---');
{
  const reverse = (text) => M.applyStep(CONFIGS.reverse, text).output;

  check('😀 反转后仍是完整的 😀', reverse('😀'), '😀');
  const naiveEmoji = '😀'.split('').reverse().join('');
  check('按码元反转 😀 得到两个孤立的代理', naiveEmoji, '\uDE00\uD83D');
  isTrue('按码元反转的结果是坏掉的 UTF-16', isBroken(naiveEmoji));
  isTrue('本实现的结果不是坏掉的 UTF-16', !isBroken(reverse('😀')));

  check('e + U+0301 反转后组合字符仍跟着 e', reverse('e\u0301'), 'e\u0301');
  check('按码元反转会把组合字符丢到前面', 'e\u0301'.split('').reverse().join(''), '\u0301e');
  isTrue('按码元反转的结果确实不等于原串', 'e\u0301'.split('').reverse().join('') !== 'e\u0301');
  check('按码位反转同样会孤立组合字符', Array.from('e\u0301').reverse().join(''), '\u0301e');

  check('汉字反转（码元与字素簇在这里一致）', reverse('汉字'), '字汉');
  check('按码元反转汉字也是对的（所以只看中文不会发现这个坑）', '汉字'.split('').reverse().join(''), '字汉');
  check('家庭 emoji 反转后不变（它是单个字素簇）', reverse('👨‍👩‍👧‍👦'), '👨‍👩‍👧‍👦');
  isTrue('家庭 emoji 按码元反转会被拆坏', '👨‍👩‍👧‍👦'.split('').reverse().join('') !== '👨‍👩‍👧‍👦');
  check('国旗 emoji 是单个字素簇', M.graphemeCount('🇨🇳'), 1);
  check('国旗 emoji 反转后不变', reverse('🇨🇳'), '🇨🇳');
  check('阿拉伯语按码位反转', reverse('مرحبا'), 'ابحرم');
  check('预组合重音字母反转', reverse('naïve'), 'evïan');

  check('反转是自身的逆操作', M.invertStep(CONFIGS.reverse, reverse('汉字😀e\u0301')).output, '汉字😀e\u0301');
  check('反转没有逐字符改动', M.applyStep(CONFIGS.reverse, 'abc').edits.length, 0);
  isTrue('反转给出了整体说明', M.applyStep(CONFIGS.reverse, 'abc').summary.length > 0);

  let bad = 0;
  for (const text of CORPUS) {
    if (reverse(text) !== [...M.toGraphemes(text)].reverse().join('')) bad += 1;
    if (reverse(reverse(text)) !== text) bad += 1;
    if (M.graphemeCount(reverse(text)) !== M.graphemeCount(text)) bad += 1;
  }
  check('语料上反转与独立的字素簇参照实现一致，且两次反转回到原样', bad, 0);

  let unstable = 0;
  for (let i = 0; i < 2000; i += 1) {
    const text = randomString(16);
    const once = reverse(text);
    const twice = reverse(once);
    if (isBroken(once) || isBroken(twice)) bad += 1;
    const naive = M.invertStep(CONFIGS.reverse, once);
    // Without the original it must never claim to have verified a result that is
    // not the original, and it must flag anything that is not even a preimage.
    if (naive.output !== text && naive.verified) bad += 1;
    if (naive.output !== once && !naive.reapplies && !naive.uncertain) bad += 1;
    // With the original it must always be exact.
    if (M.invertStep(CONFIGS.reverse, once, text).output !== text) bad += 1;
    if (twice !== text) unstable += 1;
  }
  check('2000 条随机字符串：反转不谎称已验证，带原文时始终精确还原', bad, 0);
  isTrue('随机语料里确实出现了反转后字素簇边界变化的输入（覆盖到了这个边界）', unstable > 0);
  // Concrete, reproducible instance of that boundary: a string that starts with
  // an orphan combining mark is segmented differently once reversed, so two
  // different inputs produce the same output and only the original can tell
  // them apart.
  check('以孤立组合字符开头时反转不是对合', reverse(reverse('\u0301a')), 'a\u0301');
  check('无原文时给出的是合法原像但未必是原文', M.invertStep(CONFIGS.reverse, reverse('\u0301a')).output, 'a\u0301');
  check('无原文时不会声称已验证', M.invertStep(CONFIGS.reverse, reverse('\u0301a')).verified, false);
  check('带原文时仍然逐字符还原', M.invertStep(CONFIGS.reverse, reverse('\u0301a'), '\u0301a').output, '\u0301a');
  check('以孤立连接符开头时同理', M.invertStep(CONFIGS.reverse, reverse('\u200Da'), '\u200Da').output, '\u200Da');
}

// ---------------------------------------------------------------------------
console.log('--- 全半角：与 NFKC 交叉验证 ---');
{
  const toFull = (text) => M.applyStep(CONFIGS.fullwidth, text).output;
  const toHalf = (text) => M.applyStep(CONFIGS.fullwidthBack, text).output;

  // NFKC is the independent oracle: it maps full width forms back to ASCII, so
  // every character this step produces must fold to the character it came from.
  let nfkcMismatch = 0;
  let halfMismatch = 0;
  for (let code = 0x21; code <= 0x7e; code += 1) {
    const ascii = String.fromCharCode(code);
    const full = toFull(ascii);
    if (full.normalize('NFKC') !== ascii) nfkcMismatch += 1;
    if (toHalf(full) !== ascii) halfMismatch += 1;
    if (toHalf(String.fromCharCode(code + 0xfee0)) !== ascii) halfMismatch += 1;
  }
  check('94 个可打印 ASCII 字符的全角形式都能被 NFKC 折回原字符', nfkcMismatch, 0);
  check('94 个可打印 ASCII 字符的全部角→半角还原正确', halfMismatch, 0);

  check('空格变成表意空格', toFull(' '), '\u3000');
  check('NFKC 把表意空格折回普通空格', '\u3000'.normalize('NFKC'), ' ');
  check('表意空格变回普通空格', toHalf('\u3000'), ' ');
  check('全角 Ａ 变回 A', toHalf('\uff21'), 'A');
  check('全角 ！ 变回 !', toHalf('\uff01'), '!');
  check('半角 ~ 变成全角 ～', toFull('~'), '\uff5e');
  check('全角 ～ 变回 ~', toHalf('\uff5e'), '~');

  check('中文与中文标点在半角化时，全角逗号会变成 ASCII 逗号', toHalf('中文，。'), '中文,。');
  check('句号 U+3002 不在转换范围内', toHalf('。'), '。');
  check('中文本身不受全角化影响', toFull('中文，。'), '中文，。');

  // The transform is deliberately narrower than NFKC. NFKC does much more, and
  // a tool that silently did all of it would surprise people.
  check('带圈数字不被本实现转换', toHalf('①'), '①');
  check('但 NFKC 会把它变成 1（说明本实现有意更窄）', '①'.normalize('NFKC'), '1');
  check('连字不被本实现转换', toHalf('ﬁ'), 'ﬁ');
  check('但 NFKC 会把它展开成 fi', 'ﬁ'.normalize('NFKC'), 'fi');
  check('半角片假名标点不被本实现转换', toHalf('\uff61'), '\uff61');
  check('NFKC 会把它折成 。', '\uff61'.normalize('NFKC'), '。');

  check('全角化是幂等的', toFull(toFull('abc')), toFull('abc'));
  check('半角化是幂等的', toHalf(toHalf('ＡＢＣ')), toHalf('ＡＢＣ'));

  // Without the original the conversion cannot be undone exactly when the input
  // already contained characters in the target form.
  check('全角化再半角化，原文里的全角字符会被顺手改掉', toHalf(toFull('\uff21')), 'A');
  isTrue('所以这个结果不等于原文', toHalf(toFull('\uff21')) !== '\uff21');
  check(
    '带原文时能还原（半角化的逆操作，原文说明这一位本来就是全角）',
    M.invertStep(CONFIGS.fullwidthBack, toHalf(toFull('\uff21')), '\uff21').output,
    '\uff21',
  );

  let domainBad = 0;
  for (let i = 0; i < 1500; i += 1) {
    let asciiOnly = '';
    const length = Math.floor(rand() * 16);
    for (let k = 0; k < length; k += 1) {
      asciiOnly += String.fromCharCode(0x20 + Math.floor(rand() * 0x5f));
    }
    if (toHalf(toFull(asciiOnly)) !== asciiOnly) domainBad += 1;
  }
  check('1500 条纯 ASCII 随机串上"半角→全角→半角"精确回到原样', domainBad, 0);

  let bad = 0;
  for (let i = 0; i < 1500; i += 1) {
    const text = randomString(20);
    for (const config of [CONFIGS.fullwidth, CONFIGS.fullwidthBack]) {
      const forward = M.applyStep(config, text);
      const revert = M.invertStep(config, forward.output, text);
      if (revert.output !== text || !revert.verified) bad += 1;
    }
  }
  check('1500 条随机字符串在两个方向上精确往返', bad, 0);
}

// ---------------------------------------------------------------------------
console.log('--- 逐字插入标记 ---');
{
  check('ab 前面各插入一个反斜杠', M.applyStep(CONFIGS.prefix, 'ab').output, '\\a\\b');
  const combining = M.applyStep(CONFIGS.prefix, 'e\u0301').output;
  check('标记插在字素簇之前，而不是 e 与组合字符之间', combining, '\\e\u0301');
  check('插入后仍是一个字素簇跟随标记', M.graphemeCount(combining), 2);
  const emoji = M.applyStep(CONFIGS.prefix, '😀').output;
  check('标记插在完整 emoji 之前', emoji, '\\😀');
  isTrue('插入后代理对没有被拆坏', !isBroken(emoji));

  check('空串不插入任何东西', M.applyStep(CONFIGS.prefix, '').output, '');
  check('插入项记录为"空字符到反斜杠"', M.applyStep(CONFIGS.prefix, 'ab').edits[0].fromCode, null);
  check('插入项的码位', M.applyStep(CONFIGS.prefix, 'ab').edits[0].toCode, 0x5c);

  const withSlash = M.applyStep(CONFIGS.prefix, 'a\\b').output;
  check('原文含反斜杠时的输出', withSlash, '\\a\\\\\\b');
  check('无原文时无法区分原有反斜杠，结果被多删', M.invertStep(CONFIGS.prefix, withSlash).output, 'ab');
  check('带原文时精确还原', M.invertStep(CONFIGS.prefix, withSlash, 'a\\b').output, 'a\\b');
  check('朴素地删除全部反斜杠同样会删掉原有的', withSlash.split('\\').join(''), 'ab');

  let bad = 0;
  for (let i = 0; i < 1500; i += 1) {
    const text = randomString(20);
    const forward = M.applyStep(CONFIGS.prefix, text);
    const back = M.invertStep(CONFIGS.prefix, forward.output, text);
    if (back.output !== text || !back.verified) bad += 1;
  }
  check('1500 条随机字符串（含大量反斜杠）精确往返', bad, 0);

  let noOriginalBad = 0;
  for (const text of CORPUS) {
    if (text.includes('\\')) continue;
    if (M.invertStep(CONFIGS.prefix, M.applyStep(CONFIGS.prefix, text).output).output !== text) {
      noOriginalBad += 1;
    }
  }
  check('无原文时，不含反斜杠的语料精确还原', noOriginalBad, 0);
}

// ---------------------------------------------------------------------------
console.log('--- 码位对照表 ---');
{
  const leetEdits = M.applyStep(CONFIGS.leet, 'a').edits;
  check('leet 记录了一处改动', leetEdits.length, 1);
  check('改动前的字符与码位', [leetEdits[0].from, leetEdits[0].fromCode], ['a', 0x61]);
  check('改动后的字符与码位', [leetEdits[0].to, leetEdits[0].toCode], ['4', 0x34]);
  check('说明文字非空', leetEdits[0].note.length > 0, true);

  const homoglyphEdits = M.applyStep(CONFIGS.homoglyph, 'a').edits;
  check('同形字记录了新码位 U+0430', homoglyphEdits[0].toCode, 0x430);
  check('全角 A 记录了新码位 U+FF21', M.applyStep(CONFIGS.fullwidth, 'A').edits[0].toCode, 0xff21);
  check('全角 a 记录了新码位 U+FF41', M.applyStep(CONFIGS.fullwidth, 'a').edits[0].toCode, 0xff41);
  check('交替只记录真正改变大小写的字符', M.applyStep(CONFIGS.alternating, 'ab').edits.length, 1);

  const prefixEdits = M.applyStep(CONFIGS.prefix, 'ab').edits;
  check('插入标记记录两处', prefixEdits.length, 2);
  check('插入位置的码位下标', prefixEdits.map((edit) => edit.index), [0, 1]);
  check('插入项的新码位都是反斜杠', prefixEdits.map((edit) => edit.toCode), [0x5c, 0x5c]);

  const zeroEdits = M.applyStep(CONFIGS.zeroWidth, 'ab').edits;
  check('零宽插入记录两处', zeroEdits.length, 2);
  check('插入的是循环中的前两个零宽字符', zeroEdits.map((edit) => edit.toCode), [0x200b, 0x200c]);

  // Every edit must be internally consistent, and the number of edits must equal
  // an independently counted number of differing positions.
  let inconsistent = 0;
  let countMismatch = 0;
  for (const text of CORPUS) {
    for (const config of [
      CONFIGS.leet,
      CONFIGS.homoglyph,
      CONFIGS.homoglyphBack,
      CONFIGS.fullwidth,
      CONFIGS.fullwidthBack,
      CONFIGS.alternating,
      CONFIGS.prefix,
      CONFIGS.zeroWidth,
      CONFIGS.reverse,
    ]) {
      const step = M.applyStep(config, text);
      for (const edit of step.edits) {
        if (edit.fromCode !== null && edit.from.codePointAt(0) !== edit.fromCode) inconsistent += 1;
        if (edit.toCode !== null && edit.to.codePointAt(0) !== edit.toCode) inconsistent += 1;
      }
      if (['leet', 'homoglyph', 'homoglyphBack', 'fullwidth', 'fullwidthBack', 'alternating'].includes(config.id)) {
        const before = M.toCodePoints(text);
        const after = M.toCodePoints(step.output);
        let changed = 0;
        for (let i = 0; i < before.length; i += 1) if (before[i] !== after[i]) changed += 1;
        if (changed !== step.edits.length) countMismatch += 1;
      }
    }
  }
  check('对照表里每个码位都与字符本身一致', inconsistent, 0);
  check('逐位变换的记录条数等于独立数出的不同位置数', countMismatch, 0);
}

// ---------------------------------------------------------------------------
console.log('--- 组合：必须按相反顺序还原 ---');
{
  const configs = [CONFIGS.leet, CONFIGS.fullwidth];
  const forward = M.applyPipeline(configs, 'a');
  check('leet 先把 a 变成 4，全角化再把它变成 ４', forward.output, '\uff14');
  check('中间结果被记录下来', forward.steps.map((step) => step.output), ['4', '\uff14']);

  const correct = M.revertPipeline(configs, forward.output, 'a');
  check('按相反顺序还原回到原文', correct.output, 'a');
  check('整体被标记为已验证', correct.verified, true);
  check('还原顺序就是正向顺序的反向', M.revertOrder(configs), [
    '全半角转换（半角 → 全角）',
    'leet 替换',
  ]);

  // The counterexample: undoing the steps in the apply order instead. The leet
  // inverse cannot see a full width digit, so the answer comes out wrong.
  const wrong = M.invertStep(CONFIGS.fullwidth, M.invertStep(CONFIGS.leet, forward.output).output).output;
  check('按正向顺序还原得到的是 4，不是 a（证明顺序不能反）', wrong, '4');
  isTrue('错误顺序的结果确实不等于原文', wrong !== 'a');

  // Exhaustive: every one of the 128 subsets of the seven transforms.
  const singles = M.PIPELINE_ORDER.map((id) => M.defaultConfig(id));
  const subsetSamples = ['a1', 'Hello 汉字 e\u0301 😀 4', 'a\\b\u200Bc', 'مرحبا x'];
  let bad = 0;
  let subsets = 0;
  for (let mask = 0; mask < 1 << singles.length; mask += 1) {
    const subset = singles.filter((_, index) => (mask & (1 << index)) !== 0);
    subsets += 1;
    for (const text of subsetSamples) {
      const applied = M.applyPipeline(subset, text);
      const reverted = M.revertPipeline(subset, applied.output, text);
      if (reverted.output !== text) bad += 1;
      if (subset.length > 0 && !reverted.verified) bad += 1;
    }
  }
  check('七个变换的全部 128 个子集都精确往返（4 组语料）', bad, 0);
  check('确实遍历了 128 个子集', subsets, 128);

  // Randomised combinations, to catch order dependent interactions the four
  // samples might miss.
  let randomBad = 0;
  for (let i = 0; i < 600; i += 1) {
    const subset = singles.filter(() => rand() < 0.5);
    const text = randomString(18);
    const applied = M.applyPipeline(subset, text);
    const reverted = M.revertPipeline(subset, applied.output, text);
    if (reverted.output !== text) randomBad += 1;
    if (subset.length > 0 && !reverted.verified) randomBad += 1;
  }
  check('600 组随机变换子集与随机文本都精确往返', randomBad, 0);

  // Every step's recorded input must equal the previous step's output.
  let chained = 0;
  const applied = M.applyPipeline(singles, 'Hello 汉字 e\u0301 😀');
  for (let i = 1; i < applied.steps.length; i += 1) {
    if (applied.steps[i].input !== applied.steps[i - 1].output) chained += 1;
  }
  check('每一步的输入等于上一步的输出（顺序可核对）', chained, 0);

  // Without the original, the combination of the genuinely reversible steps is
  // still exact on a clean input.
  const reversible = [
    M.defaultConfig('fullwidth'),
    M.defaultConfig('prefix'),
    M.defaultConfig('zeroWidth'),
    M.defaultConfig('reverse'),
  ];
  let noOriginalBad = 0;
  for (let mask = 0; mask < 1 << reversible.length; mask += 1) {
    const subset = reversible.filter((_, index) => (mask & (1 << index)) !== 0);
    const text = 'plain ascii 123';
    const out = M.applyPipeline(subset, text).output;
    if (M.revertPipeline(subset, out).output !== text) noOriginalBad += 1;
  }
  check('全半角 + 标记 + 零宽 + 反转的组合，在纯 ASCII 输入上无原文也精确还原', noOriginalBad, 0);

  // Reverting text that does not match the original must degrade, not lie.
  const mismatch = M.revertPipeline([CONFIGS.leet], 'abcd', 'zzzz');
  check('原文对不上时不做已验证声明', mismatch.verified, false);
  isTrue('原文对不上时仍然给出结果而不是抛错', typeof mismatch.output === 'string');
}

// ---------------------------------------------------------------------------
console.log('--- 边界 ---');
{
  const all = M.PIPELINE_ORDER.map((id) => M.defaultConfig(id));
  const edges = ['', ' ', '\n\t \r', 'abc', '😀😀', '中文', 'مرحبا', 'e\u0301', 'a\\b', '\u200Bx', 'ＡＢ', '1234567890'];

  let emptyBad = 0;
  for (const single of all) {
    if (M.applyStep(single, '').output !== '') emptyBad += 1;
    if (M.invertStep(single, '').output !== '') emptyBad += 1;
  }
  check('空串对每一种变换都是空串（正反两个方向）', emptyBad, 0);

  let edgeBad = 0;
  for (const text of edges) {
    const applied = M.applyPipeline(all, text);
    const reverted = M.revertPipeline(all, applied.output, text);
    if (reverted.output !== text) edgeBad += 1;
  }
  check('边界输入在全部七种变换叠加下精确往返', edgeBad, 0);
  check('空串在全部七种变换叠加下仍是空串', M.applyPipeline(all, '').output, '');
  check('空串还原仍是空串', M.revertPipeline(all, '', '').output, '');

  // Whitespace only: nothing but the markers, zero widths and reversal apply.
  const whitespace = M.applyPipeline(all, '   ');
  isTrue('纯空白输入也能往返', M.revertPipeline(all, whitespace.output, '   ').output === '   ');

  // Long input, to catch accidental recursion or quadratic string building.
  const long = 'a'.repeat(50000);
  const longForward = M.applyPipeline([CONFIGS.leet, CONFIGS.reverse], long);
  check('五万字符的 leet 结果长度不变', longForward.steps[0].output.length, 50000);
  check('五万字符的组合往返一致', M.revertPipeline([CONFIGS.leet, CONFIGS.reverse], longForward.output, long).output, long);

  const longZero = M.applyStep(CONFIGS.zeroWidth, long).output;
  check('五万字符插入零宽后码位翻倍', M.codePointCount(longZero), 100000);
  check('五万字符的零宽往返一致', M.invertStep(CONFIGS.zeroWidth, longZero, long).output, long);

  const longUnicode = '汉字😀e\u0301'.repeat(5000);
  const longUnicodeForward = M.applyPipeline(all, longUnicode);
  check(
    '两万五千个字素簇（含 emoji 与组合字符）叠加全部变换后精确往返',
    M.revertPipeline(all, longUnicodeForward.output, longUnicode).output,
    longUnicode,
  );

  // Already obfuscated input: it must survive as data, not be special cased.
  let alreadyBad = 0;
  for (const text of ['а4\u200B1', '\uFF21\uFF41', '\\a\\b', '0bfusc4ted']) {
    const applied = M.applyPipeline(all, text);
    if (M.revertPipeline(all, applied.output, text).output !== text) alreadyBad += 1;
  }
  check('已经被混淆过的输入依然可以精确往返', alreadyBad, 0);

  // Rigorous: every step must survive the whole corpus with the original.
  let corpusBad = 0;
  for (const text of CORPUS) {
    for (const single of all) {
      const forward = M.applyStep(single, text);
      const back = M.invertStep(single, forward.output, text);
      if (back.output !== text || !back.verified) corpusBad += 1;
    }
  }
  check('语料 × 七种变换（含两个方向的往返）全部精确一致', corpusBad, 0);
}

// ---------------------------------------------------------------------------
console.log('--- 反证：几种"看起来更简单"的写法都是错的 ---');
{
  // Naive reversal on a surrogate pair.
  isTrue('按码元反转 😀 会坏', '😀'.split('').reverse().join('') !== '😀');
  // Naive splitting on a combining sequence.
  isTrue('按码元反转 e + U+0301 会坏', 'e\u0301'.split('').reverse().join('') !== 'e\u0301');
  // Naive zero width removal on text that already had zero width characters.
  isTrue(
    '无条件删除零宽字符会删掉原文本来就有的',
    '\u200Ba'.replace(/[\u200B-\u200D\uFEFF]/g, '') !== '\u200Ba',
  );
  // Naive marker removal.
  isTrue('无条件删除反斜杠会删掉原文本来就有的', 'a\\b'.split('\\').join('') !== 'a\\b');
  // Naive un-leet.
  isTrue('把 1 一律换成 i 会改坏数字', '123'.replace(/1/g, 'i') !== '123');
  // NFKC does not rescue homoglyphs.
  isTrue('NFKC 不能还原同形字', '\u0430bc'.normalize('NFKC') !== 'abc');
  // But NFKC does fold full width, which is the cross check above.
  isTrue('NFKC 能折叠全角', '\uff21'.normalize('NFKC') === 'A');
  // Lowercasing does not undo alternating case.
  isTrue('小写不能还原被覆盖的大小写', 'hElLo'.toLowerCase() !== 'hElLo');
}

// ---------------------------------------------------------------------------
console.log('--- 元数据与界面文案 ---');
{
  check('管线顺序有七个变换', M.PIPELINE_ORDER.length, 7);
  check('管线顺序没有重复', new Set(M.PIPELINE_ORDER).size, 7);
  let metaProblems = 0;
  for (const id of M.PIPELINE_ORDER) {
    const meta = M.TRANSFORM_META[id];
    if (!meta || meta.id !== id) metaProblems += 1;
    else if (!meta.label || !meta.summary || !meta.note) metaProblems += 1;
  }
  check('每个变换都有标签、摘要与说明', metaProblems, 0);
  check('默认不启用任何变换', M.configsFor(M.DEFAULT_OPTIONS).length, 0);
  check(
    '全部打开时按固定顺序排列',
    M.configsFor({
      leet: true,
      homoglyph: 'toLookalike',
      fullwidth: 'toFull',
      alternating: true,
      prefix: true,
      zeroWidth: true,
      reverse: true,
    }).map((config) => config.id),
    M.PIPELINE_ORDER,
  );
  isTrue(
    '两个方向的同形字在界面上有不同名称',
    M.stepLabel(CONFIGS.homoglyph) !== M.stepLabel(CONFIGS.homoglyphBack),
  );
  isTrue('leet 的说明点明了 1 与 0 的歧义', M.TRANSFORM_META.leet.note.includes('1') && M.TRANSFORM_META.leet.note.includes('0'));
  isTrue('同形字说明点明了无法搜索匹配', M.TRANSFORM_META.homoglyph.note.includes('搜索'));
  check('示例文本非空', M.SAMPLE_INPUT.length > 0, true);
  isTrue('输入上限是有限的', Number.isFinite(M.MAX_INPUT_CHARS) && M.MAX_INPUT_CHARS > 0);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
