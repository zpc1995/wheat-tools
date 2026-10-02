/**
 * Checks the text statistics tool.
 *
 * The whole claim of this tool is that four counts which people treat as
 * interchangeable are in fact different. So the assertions do two things:
 *
 *   1. Pin the four counts to hard-coded values for strings where the right
 *      answer is known by hand (`😀` is 1 code point, 2 UTF-16 units, 4 UTF-8
 *      bytes and 1 grapheme cluster).
 *   2. Re-derive every count from a *different* platform source over a corpus:
 *      `[...s].length`, `s.length`, `TextEncoder`, `Intl.Segmenter` — plus a
 *      hand-written UTF-8 byte counter that shares no code with the
 *      implementation. If the implementation drifted, both routes would have to
 *      drift together to hide it.
 *
 * The naive one-liners that this tool exists to correct (`s.length`,
 * `s.split('').length`) are asserted to be wrong on the same inputs, so a
 * regression to them fails loudly instead of passing quietly.
 *
 * Usage: node scripts/check-text-statistics.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(
  readFileSync('src/tools/text-statistics/textStatisticsUtils.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/text-statistics.mjs', compiled);
const M = await import(pathToFileURL('.verify/text-statistics.mjs').href);

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

// --- Independent oracles ---------------------------------------------------

const SEGMENTER = new Intl.Segmenter('und', { granularity: 'grapheme' });

function oracleGraphemes(text) {
  const out = [];
  for (const piece of SEGMENTER.segment(text)) out.push(piece.segment);
  return out;
}

/**
 * UTF-8 length computed from code point ranges by hand.
 *
 * Shares nothing with the implementation, and does not go through
 * `TextEncoder`, so the two agree only if both are right.
 */
function oracleUtf8Bytes(text) {
  let bytes = 0;
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp <= 0x7f) bytes += 1;
    else if (cp <= 0x7ff) bytes += 2;
    else if (cp <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

const CORPUS = [
  '',
  'hello',
  'Hello, World!',
  '中文文本',
  '😀',
  '😀😀',
  'a😀b',
  '\u00e9', // é precomposed
  'e\u0301', // é decomposed
  'e\u0301\u0301', // doubly accented
  '\u4f60\u597d\uff0c\u4e16\u754c\uff01',
  '👨‍👩‍👧‍👦',
  '🇨🇳',
  '👍🏽',
  'a\u200db',
  '👨\u200d👩',
  '🏳️\u200d🌈',
  'x\u200d😀',
  'line1\r\nline2\rline3\nline4',
  'tab\there',
  'a\u0000b',
  '𝄞', // U+1D11E, outside the BMP
  '\u00a0\u3000', // NBSP + ideographic space
];

console.log('--- 四个口径的已知值（手算） ---');
check('😀 码点数', M.countCodePoints('😀'), 1);
check('😀 UTF-16 码元数', M.countUtf16Units('😀'), 2);
check('😀 UTF-8 字节数', M.countUtf8Bytes('😀'), 4);
check('😀 字素簇数', M.countGraphemes('😀'), 1);

check('é(NFC U+00E9) 码点数', M.countCodePoints('\u00e9'), 1);
check('é(NFC) UTF-16 码元数', M.countUtf16Units('\u00e9'), 1);
check('é(NFC) UTF-8 字节数', M.countUtf8Bytes('\u00e9'), 2);
check('é(NFC) 字素簇数', M.countGraphemes('\u00e9'), 1);

check('é(NFD e+U+0301) 码点数', M.countCodePoints('e\u0301'), 2);
check('é(NFD) UTF-16 码元数', M.countUtf16Units('e\u0301'), 2);
check('é(NFD) UTF-8 字节数', M.countUtf8Bytes('e\u0301'), 3);
check('é(NFD) 字素簇数（组合序列算一个）', M.countGraphemes('e\u0301'), 1);

check('👨‍👩‍👧‍👦 码点数', M.countCodePoints('👨‍👩‍👧‍👦'), 7);
check('👨‍👩‍👧‍👦 UTF-16 码元数', M.countUtf16Units('👨‍👩‍👧‍👦'), 11);
check('👨‍👩‍👧‍👦 UTF-8 字节数', M.countUtf8Bytes('👨‍👩‍👧‍👦'), 25);
check('👨‍👩‍👧‍👦 字素簇数（全家算一个）', M.countGraphemes('👨‍👩‍👧‍👦'), 1);

check('🇨🇳 码点数', M.countCodePoints('🇨🇳'), 2);
check('🇨🇳 UTF-16 码元数', M.countUtf16Units('🇨🇳'), 4);
check('🇨🇳 UTF-8 字节数', M.countUtf8Bytes('🇨🇳'), 8);
check('🇨🇳 字素簇数', M.countGraphemes('🇨🇳'), 1);

check('👍🏽 码点数（含肤色修饰符）', M.countCodePoints('👍🏽'), 2);
check('👍🏽 字素簇数', M.countGraphemes('👍🏽'), 1);

console.log('--- 朴素写法在这些输入上是错的 ---');
check('朴素 str.length 把 😀 算成 2', '😀'.length, 2);
check('朴素 split("") 把 😀 算成 2 个“字符”', '😀'.split('').length, 2);
check('朴素 str.length 把 NFD 的 é 算成 2 个字符', 'e\u0301'.length, 2);
check('朴素 str.length 把一家四口算成 11 个字符', '👨‍👩‍👧‍👦'.length, 11);
check(
  'UTF-16 码元数并不等于 UTF-8 字节数（中文 3 字节 / 1 码元）',
  M.countUtf8Bytes('中文') === M.countUtf16Units('中文'),
  false,
);
check(
  'NFC 与 NFD 码点数不同但字素簇数相同',
  [M.countCodePoints('é'), M.countCodePoints('é'.normalize('NFD'))].join(',') +
    '|' +
    [M.countGraphemes('é'), M.countGraphemes('é'.normalize('NFD'))].join(','),
  '1,2|1,1',
);

console.log('--- 与平台 API 交叉验证（19 个语料 × 4 个口径） ---');
{
  let mismatches = 0;
  for (const text of CORPUS) {
    if (M.countCodePoints(text) !== [...text].length) mismatches += 1;
    if (M.countUtf16Units(text) !== text.length) mismatches += 1;
    if (M.countUtf8Bytes(text) !== new TextEncoder().encode(text).length) mismatches += 1;
    if (M.countUtf8Bytes(text) !== oracleUtf8Bytes(text)) mismatches += 1;
    if (M.countGraphemes(text) !== oracleGraphemes(text).length) mismatches += 1;
    if (JSON.stringify(M.graphemeClusters(text)) !== JSON.stringify(oracleGraphemes(text))) {
      mismatches += 1;
    }
  }
  check(`与 [...s].length / s.length / TextEncoder / Intl.Segmenter 逐项一致（${CORPUS.length} 个语料）`, mismatches, 0);
}

console.log('--- 无 Intl.Segmenter 时的降级实现 ---');
{
  let mismatches = 0;
  for (const text of CORPUS) {
    const viaFallback = M.fallbackGraphemeClusters(text);
    if (JSON.stringify(viaFallback) !== JSON.stringify(oracleGraphemes(text))) {
      mismatches += 1;
      console.log(`        降级实现不一致：${JSON.stringify(text)} → ${JSON.stringify(viaFallback)}`);
    }
  }
  check('降级字素切分与 Intl.Segmenter 在全部语料上一致', mismatches, 0);
}

console.log('--- measureText 汇总 ---');
{
  let mismatches = 0;
  for (const text of CORPUS) {
    const m = M.measureText(text);
    if (m.codePoints !== [...text].length) mismatches += 1;
    if (m.utf16Units !== text.length) mismatches += 1;
    if (m.utf8Bytes !== oracleUtf8Bytes(text)) mismatches += 1;
    if (m.graphemes !== oracleGraphemes(text).length) mismatches += 1;
    if (m.codePointsNoWhitespace !== [...text].filter((c) => !/\s/u.test(c)).length) mismatches += 1;
  }
  check('measureText 的每个字段都能被独立来源复算', mismatches, 0);

  const empty = M.measureText('');
  check('空文本全部为 0', empty, {
    codePoints: 0,
    codePointsNoWhitespace: 0,
    utf16Units: 0,
    utf8Bytes: 0,
    graphemes: 0,
    lines: 0,
    nonEmptyLines: 0,
    paragraphs: 0,
    sentences: 0,
  });
  check('不含空白：空格与换行被排除', M.countCodePointsWithoutWhitespace('a b\nc'), 3);
  check('不含空白：NBSP 与全角空格也算空白（\\s 的定义）', M.countCodePointsWithoutWhitespace('a\u00a0\u3000b'), 2);
  check('不含空白：emoji 仍是一个码点', M.countCodePointsWithoutWhitespace('😀 '), 1);
}

console.log('--- 行 / 段落 / 句子 ---');
check('空文本 0 行', M.countLines(''), 0);
check('单行', M.countLines('a'), 1);
check('LF', M.countLines('a\nb'), 2);
check('CRLF 与 CR 同样识别', M.countLines('a\r\nb\rc'), 3);
check('结尾换行产生一个空行', M.countLines('a\n'), 2);
check('非空行数忽略空行', M.countNonEmptyLines('a\n\n  \nb'), 2);

check('空文本 0 段', M.countParagraphs(''), 0);
check('连续两行是一段', M.countParagraphs('a\nb'), 1);
check('空行分段', M.countParagraphs('a\n\nb'), 2);
check('空白行不算新段落', M.countParagraphs('a\n \nb'), 2);
check('多个连续空行仍只分一段', M.countParagraphs('a\n\n\n\nb'), 2);
check('只有空白不算段落', M.countParagraphs(' \n\t\n'), 0);

check('普通句号计数', M.countSentences('Hello.'), 1);
check('两个句子', M.countSentences('Hello. World!'), 2);
check('中文句末标点', M.countSentences('你好。世界！'), 2);
check('没有句末标点的尾部也算一句', M.countSentences('Hello'), 1);
check('空文本 0 句', M.countSentences(''), 0);
check('只有标点 0 句', M.countSentences('...'), 0);
check('问号', M.countSentences('你好？'), 1);
check('省略号连续算一个句子边界', M.countSentences('Wait… ok.'), 2);

console.log('--- 词数：中文按字、西文按词 ---');
check('英文两词', M.countWords('Hello world'), { total: 2, chinese: 0, latin: 2 });
check('中文按字计', M.countWords('你好世界'), { total: 4, chinese: 4, latin: 0 });
check('中英混排', M.countWords('你好 world 世界'), { total: 5, chinese: 4, latin: 1 });
check('中英之间没有空格也不会粘成一个词', M.countWords('你好world'), { total: 3, chinese: 2, latin: 1 });
check('撇号连写算一个词', M.countWords("don't stop"), { total: 2, chinese: 0, latin: 2 });
check('连字符连写算一个词', M.countWords('well-known thing'), { total: 2, chinese: 0, latin: 2 });
check('数字算词', M.countWords('a1 b2'), { total: 2, chinese: 0, latin: 2 });
check('标点不产生词', M.countWords(' , . ! '), { total: 0, chinese: 0, latin: 0 });
check('空文本没有词', M.countWords(''), { total: 0, chinese: 0, latin: 0 });
check('纯日文假名按西文词计（无空格时为一词）', M.countWords('こんにちは'), { total: 1, chinese: 0, latin: 1 });

console.log('--- 阅读时间 ---');
check('300 个汉字 = 60 秒（300 字/分钟）', M.estimateReadingTime(M.countWords('中'.repeat(300))).totalSeconds, 60);
check('200 个英文词 = 60 秒（200 词/分钟）', M.estimateReadingTime(M.countWords('word '.repeat(200))).totalSeconds, 60);
check('空文本阅读时间为 0', M.estimateReadingTime(M.countWords('')).totalSeconds, 0);
check('中英各半分别计算后相加', M.estimateReadingTime(M.countWords('中'.repeat(150) + ' ' + 'w '.repeat(100))).totalSeconds, 60);
check('时长格式：0', M.formatDuration(0), '0 秒');
check('时长格式：45.6 秒', M.formatDuration(45.6), '45.6 秒');
check('时长格式：1 分', M.formatDuration(60), '1 分');
check('时长格式：2 分 5 秒', M.formatDuration(125), '2 分 5 秒');
check('时长格式：1 小时 2 分', M.formatDuration(3720), '1 小时 2 分');
check('时长格式：负数按 0', M.formatDuration(-5), '0 秒');
check(
  '阅读速度常量与说明一致',
  M.READING_SPEED,
  { chineseCharsPerMinute: 300, latinWordsPerMinute: 200 },
);

console.log('--- 行长统计 ---');
{
  const lines = M.analyseLines('bb\n\ncccc\na');
  check('最长行的行号', lines.longest.index, 3);
  check('最长行按码点计长', lines.longest.length, 4);
  check('最长行文本', lines.longest.text, 'cccc');
  check('最短的非空行（跳过空行）', [lines.shortest.index, lines.shortest.length, lines.shortest.text], [4, 1, 'a']);
  check('平均行长（含空行）', lines.average, 1.75);

  const emojiLines = M.analyseLines('😀\nabc');
  check('行长按码点而非码元：😀 计 1', emojiLines.longest.length, 3);
  check('emoji 行的码元数是 2 但不影响长度', '😀'.length, 2);

  const empty = M.analyseLines('');
  check('空文本没有最长行', empty.longest, null);
  check('空文本没有最短行', empty.shortest, null);
  check('空文本平均行长为 0', empty.average, 0);

  const blank = M.analyseLines('\n\n');
  check('全空行时没有最短非空行', blank.shortest, null);
  check('全空行时最长行是空行', blank.longest.length, 0);
}

console.log('--- 字符频率 ---');
{
  const freq = M.charFrequency('aab');
  check('按出现次数降序', freq.map((r) => [r.char, r.count]), [['a', 2], ['b', 1]]);
  check('码点标签', freq[0].label, 'U+0061');
  check('占比', freq.map((r) => Math.round(r.ratio * 1000) / 1000), [0.667, 0.333]);
  check('类别', freq[0].category, '小写字母 (Ll)');

  const emoji = M.charFrequency('😀a😀');
  check('emoji 也按码点统计', emoji[0].char, '😀');
  check('emoji 的次数', emoji[0].count, 2);
  check('emoji 码点标签', emoji[0].label, 'U+1F600');
  check('emoji 类别为符号', emoji[0].category, '符号 (S)');

  check('limit 生效', M.charFrequency('abc', 2).length, 2);
  check('limit 为 0 表示全部', M.charFrequency('abc', 0).length, 3);
  check('空文本没有频率行', M.charFrequency(''), []);

  // Same count → ordered by code point, so the table cannot reshuffle.
  check('次数相同时按码点排序', M.charFrequency('ba').map((r) => r.char), ['a', 'b']);

  const sum = M.charFrequency('aab', 0).reduce((acc, r) => acc + r.ratio, 0);
  check('占比之和为 1（浮点容差内）', Math.abs(sum - 1) < 1e-12, true);

  check('不可见字符的可读替身：换行', M.displayChar('\n'), '\\n');
  check('不可见字符的可读替身：回车', M.displayChar('\r'), '\\r');
  check('不可见字符的可读替身：制表符', M.displayChar('\t'), '\\t');
  check('空格的替身', M.displayChar(' '), '␠');
  check('普通字符原样返回', M.displayChar('A'), 'A');
  check('码点标签补零到 4 位', M.codePointLabel(0x41), 'U+0041');
  check('码点标签上限不受 4 位限制', M.codePointLabel(0x1f600), 'U+1F600');
}

console.log('--- Unicode 类别 ---');
check('大写字母', M.unicodeCategory('A').id, 'uppercase');
check('小写字母', M.unicodeCategory('a').id, 'lowercase');
check('汉字归入其它字母（Lo）', M.unicodeCategory('中').id, 'letter');
check('数字', M.unicodeCategory('5').id, 'number');
check('组合重音符号', M.unicodeCategory('\u0301').id, 'mark');
check('句号归入标点', M.unicodeCategory('。').id, 'punctuation');
check('emoji 归入符号', M.unicodeCategory('😀').id, 'symbol');
check('空格归入空白分隔', M.unicodeCategory(' ').id, 'separator');
check('换行归入控制类', M.unicodeCategory('\n').id, 'control');

{
  const buckets = M.categoryDistribution('aA中 😀');
  const byId = Object.fromEntries(buckets.map((b) => [b.id, b.count]));
  check('类别分布计数', byId, {
    uppercase: 1,
    lowercase: 1,
    letter: 1,
    symbol: 1,
    separator: 1,
  });
  check('类别分布降序排列（同数按表内顺序）', buckets.map((b) => b.id), [
    'uppercase',
    'lowercase',
    'letter',
    'symbol',
    'separator',
  ]);
  const total = buckets.reduce((acc, b) => acc + b.count, 0);
  check('类别分布总数等于码点数', total, M.countCodePoints('aA中 😀'));
  check('类别分布省略空桶', buckets.every((b) => b.count > 0), true);
  check('空文本没有类别分布', M.categoryDistribution(''), []);
}

console.log('--- 与编辑器字数不一致的说明 ---');
{
  const notes = M.editorMismatchNotes();
  check('说明条目数', notes.length, 4);
  check('说明提到 UTF-16 码元数', notes.some((n) => n.includes('UTF-16')), true);
  check('说明提到字素簇', notes.some((n) => n.includes('字素簇')), true);
  check('说明强调四个量不能相加', notes.some((n) => n.includes('相加')), true);
  check('每条说明都非空', notes.every((n) => n.trim().length > 10), true);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
