/**
 * Checks the text ↔ binary conversion.
 *
 * What is being defended here is one claim: "binary" means the **UTF-8 bytes**,
 * not the characters' code points. Everything below is arranged around making
 * that claim falsifiable, and around an authority that is not this code.
 *
 * Authorities used:
 *
 *   - `TextEncoder` (the WHATWG UTF-8 encoder) — every byte the implementation
 *     produces is compared with it over a curated corpus and thousands of
 *     pseudo-random strings, including unpaired surrogates.
 *   - `TextDecoder('utf-8', { fatal: true })` — the strict decoder's
 *     accept / reject decision is compared on thousands of random byte
 *     sequences, which covers overlong forms, surrogate code points and
 *     code points past U+10FFFF.
 *   - Known values that can be written down from the UTF-8 definition itself:
 *     "A" = 01000001, "中" = 11100100 10111000 10101101,
 *     "😀" = 11110000 10011111 10011000 10000000.
 *
 * The tempting-but-wrong implementations are run against the same assertions at
 * the end, to show these checks would catch the mistake rather than merely
 * passing. A suite that cannot fail proves nothing.
 *
 * Usage: node scripts/check-text-to-binary.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/text-to-binary/binaryUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/text-to-binary.mjs', compiled);
const M = await import(pathToFileURL('.verify/text-to-binary.mjs').href);

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

/** Runs one assertion per sample and reports only the first disagreement. */
function checkSamples(label, samples, transform) {
  let mismatches = 0;
  let firstBad = null;
  for (const sample of samples) {
    const { actual, expected } = transform(sample);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      mismatches += 1;
      if (firstBad === null) firstBad = { sample, actual, expected };
    }
  }
  check(`${label}（${samples.length} 个样本）`, mismatches, 0);
  if (firstBad) {
    console.log(
      `        首个不一致样本 ${JSON.stringify(firstBad.sample)}\n` +
        `        got      ${JSON.stringify(firstBad.actual)}\n` +
        `        expected ${JSON.stringify(firstBad.expected)}`,
    );
  }
}

const platformEncode = (text) => Array.from(new TextEncoder().encode(text));
const platformDecode = (bytes) => new TextDecoder('utf-8').decode(Uint8Array.from(bytes));
const strictPlatformAccepts = (bytes) => {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
    return true;
  } catch {
    return false;
  }
};

// Deterministic pseudo-random numbers, so a failure can be reproduced exactly.
let seed = 0x2f6e2b1;
function rand() {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 0x1_0000_0000;
}

console.log('--- 已知值：手写下来的 UTF-8 ---');
check('A（ASCII，1 字节）', M.textToBinary('A', 'byte').binary, '01000001');
check('A 的字节', M.textToBinary('A', 'byte').bytes, [0x41]);
check('中（BMP，3 字节）', M.textToBinary('中', 'byte').binary, '11100100 10111000 10101101');
check('中 的字节', M.textToBinary('中', 'byte').bytes, [0xe4, 0xb8, 0xad]);
check(
  '😀（BMP 以外，4 字节）',
  M.textToBinary('😀', 'byte').binary,
  '11110000 10011111 10011000 10000000',
);
check('😀 的字节', M.textToBinary('😀', 'byte').bytes, [0xf0, 0x9f, 0x98, 0x80]);
check('é（2 字节）', M.textToBinary('é', 'byte').bytes, [0xc3, 0xa9]);
check('€（3 字节）', M.textToBinary('€', 'byte').bytes, [0xe2, 0x82, 0xac]);
check('U+10FFFF（4 字节，Unicode 最大码位）', M.textToBinary('\u{10ffff}', 'byte').bytes, [
  0xf4, 0x8f, 0xbf, 0xbf,
]);
check('U+0000（1 字节的 0）', M.textToBinary('\u0000', 'byte').binary, '00000000');
check('换行 LF', M.textToBinary('\n', 'byte').binary, '00001010');
check('BOM U+FEFF', M.textToBinary('\ufeff', 'byte').bytes, [0xef, 0xbb, 0xbf]);
check('孤立高代理项按平台的替换字符 U+FFFD 编码', M.encodeUtf8('\ud800'), [0xef, 0xbf, 0xbd]);
check('“Hi” 的十六进制', M.textToBinary('Hi').hex, '48 69');
check('“Hi” 的十进制字节', M.textToBinary('Hi').decimal, '72 105');

console.log('\n--- 权威参照物 1：与 TextEncoder 逐字节比对 ---');
const CORPUS = [
  '',
  'A',
  'a',
  '0',
  ' ',
  '\t',
  '\r\n',
  'Hello, World!',
  'The quick brown fox jumps over the lazy dog.',
  '中',
  '中文',
  '中文测试',
  '你好，世界',
  '😀',
  '😀😃😄',
  '👨‍👩‍👧',
  '🇨🇳',
  'café',
  'naïve',
  'ÄÖÜß',
  'Ελληνικά',
  'Русский',
  'العربية',
  'עברית',
  'हिन्दी',
  'ไทย',
  '日本語',
  '한국어',
  '∑∫√',
  '\u0000',
  '\u0007',
  '\u007f',
  '\u0080',
  '\u07ff',
  '\u0800',
  '\ud7ff',
  '\ue000',
  '\ufffd',
  '\uffff',
  '\u{10000}',
  '\u{1f600}',
  '\u{10ffff}',
  'a\u0301',
  'e\u0301\u0327',
  'line1\nline2\r\nline3',
  'tab\there',
  '\ud800',
  '\udfff',
  'a\ud800b\udc00c',
  '😀中A\u0000é',
];
checkSamples('encodeUtf8 与 TextEncoder 逐字节一致', CORPUS, (sample) => ({
  actual: M.encodeUtf8(sample),
  expected: platformEncode(sample),
}));

// Random strings across the whole code point range, excluding surrogates.
const randomStrings = [];
for (let i = 0; i < 3000; i += 1) {
  const length = Math.floor(rand() * 24);
  let text = '';
  for (let k = 0; k < length; k += 1) {
    const roll = rand();
    let codePoint;
    if (roll < 0.35) codePoint = 0x20 + Math.floor(rand() * 0x5f);
    else if (roll < 0.55) codePoint = 0xa0 + Math.floor(rand() * 0x1f60);
    // Stop at U+D7FF: the surrogate block U+D800–U+DFFF is not a code point
    // and String.fromCodePoint would happily build a lone surrogate from it,
    // which would turn this generator into a malformed-input test by accident.
    else if (roll < 0.75) codePoint = 0x2000 + Math.floor(rand() * 0xb800);
    else if (roll < 0.9) codePoint = 0xe000 + Math.floor(rand() * 0x2000);
    else codePoint = 0x10000 + Math.floor(rand() * 0x100000);
    text += String.fromCodePoint(codePoint);
  }
  randomStrings.push(text);
}
checkSamples('encodeUtf8 与 TextEncoder 在随机字符串上一致', randomStrings, (sample) => ({
  actual: M.encodeUtf8(sample),
  expected: platformEncode(sample),
}));

console.log('\n--- 往返：文本 → 二进制 → 文本 ---');
checkSamples('UTF-8 编码 → 8 位二进制 → 解析 → 解码，逐字符一致', CORPUS, (sample) => {
  const bytes = M.encodeUtf8(sample);
  const restored = M.binaryToText(M.bytesToBinary(bytes, 'byte'));
  return { actual: restored.ok ? restored.text : null, expected: platformDecode(bytes) };
});
checkSamples('合法文本（不含孤立代理项）往返完全无损', randomStrings, (sample) => {
  const result = M.binaryToText(M.bytesToBinary(M.encodeUtf8(sample), 'byte'));
  return { actual: result.ok ? result.text : null, expected: sample };
});

console.log('\n--- 权威参照物 2：严格解码与 TextDecoder(fatal) 判定一致 ---');
const TARGETED_BYTES = [
  [],
  [0x41],
  [0x7f],
  [0x80],
  [0xbf],
  [0xc0, 0x80], // overlong NUL
  [0xc1, 0xbf], // overlong
  [0xc2, 0x80],
  [0xc3, 0xa9],
  [0xc3], // truncated 2-byte
  [0xe0, 0x80, 0x80], // overlong
  [0xe0, 0x9f, 0xbf], // overlong
  [0xe0, 0xa0, 0x80],
  [0xe2, 0x82, 0xac],
  [0xe4, 0xb8], // truncated 3-byte
  [0xe4, 0xb8, 0xad],
  [0xed, 0xa0, 0x80], // surrogate U+D800
  [0xed, 0xbf, 0xbf], // surrogate U+DFFF
  [0xef, 0xbf, 0xbd], // replacement character, valid
  [0xf0, 0x90, 0x80, 0x80],
  [0xf0, 0x9f, 0x98], // truncated 4-byte
  [0xf0, 0x9f, 0x98, 0x80],
  [0xf4, 0x8f, 0xbf, 0xbf], // U+10FFFF, valid
  [0xf4, 0x90, 0x80, 0x80], // U+110000, out of range
  [0xf5, 0x80, 0x80, 0x80], // invalid lead
  [0xf8, 0x88, 0x80, 0x80, 0x80], // 5-byte form, never valid
  [0xfe],
  [0xff],
  [0xc0, 0xaf], // overlong slash, a classic path-traversal payload
];
checkSamples('接受 / 拒绝的判定与 TextDecoder(fatal) 一致', TARGETED_BYTES, (bytes) => ({
  actual: M.decodeUtf8(bytes).ok,
  expected: strictPlatformAccepts(bytes),
}));
checkSamples('接受时解出的文本与 TextDecoder 一致', TARGETED_BYTES, (bytes) => ({
  actual: M.decodeUtf8(bytes).ok ? M.decodeUtf8(bytes).text : null,
  expected: strictPlatformAccepts(bytes) ? platformDecode(bytes) : null,
}));

const randomByteSeqs = [];
for (let i = 0; i < 5000; i += 1) {
  const length = Math.floor(rand() * 10);
  const bytes = [];
  for (let k = 0; k < length; k += 1) bytes.push(Math.floor(rand() * 256));
  randomByteSeqs.push(bytes);
}
checkSamples('随机字节序列的判定与 TextDecoder(fatal) 一致', randomByteSeqs, (bytes) => ({
  actual: M.decodeUtf8(bytes).ok,
  expected: strictPlatformAccepts(bytes),
}));
let textMismatches = 0;
for (const bytes of randomByteSeqs) {
  const ours = M.decodeUtf8(bytes);
  if (!ours.ok) continue;
  if (ours.text !== platformDecode(bytes)) textMismatches += 1;
}
check('随机字节序列解出的文本也一致', textMismatches, 0);
check(
  '过长编码被拒绝，理由指向 overlong',
  M.decodeUtf8([0xc0, 0x80]).error.includes('过长编码'),
  true,
);
check(
  '代理区码位被拒绝，理由指向代理区',
  M.decodeUtf8([0xed, 0xa0, 0x80]).error.includes('代理区'),
  true,
);
check(
  '超出 U+10FFFF 被拒绝，理由给出码位',
  M.decodeUtf8([0xf4, 0x90, 0x80, 0x80]).error.includes('10FFFF'),
  true,
);
check(
  '被截断的序列被拒绝，理由说明剩余字节数',
  M.decodeUtf8([0xe4, 0xb8]).error.includes('截断'),
  true,
);

console.log('\n--- 分隔方式 ---');
const ABC = [0x41, 0x42, 0x43];
check('无分隔', M.bytesToBinary(ABC, 'none'), '010000010100001001000011');
check('每 8 位一组', M.bytesToBinary(ABC, 'byte'), '01000001 01000010 01000011');
check('每行 8 字节：8 字节正好一行', M.bytesToBinary(Array(8).fill(0x41), 'group8').split('\n').length, 1);
check(
  '每行 8 字节：第 9 个字节换行',
  M.bytesToBinary(Array(9).fill(0x41), 'group8').split('\n').length,
  2,
);
check(
  '每行 8 字节：末行只有 1 组',
  M.bytesToBinary(Array(9).fill(0x41), 'group8').split('\n')[1],
  '01000001',
);
check(
  '三种分隔方式解析回完全相同的字节',
  ['none', 'byte', 'group8'].map((mode) => M.binaryToBytes(M.bytesToBinary(ABC, mode)).bytes),
  [ABC, ABC, ABC],
);
check(
  '每个字节恰好 8 位（无分隔时长度是 8 的倍数）',
  M.bytesToBinary(M.encodeUtf8('中文😀é'), 'none').length % 8,
  0,
);
check('十六进制为大写两位', M.bytesToHex([0x0a, 0xff, 0x00]), '0A FF 00');
check('十进制以空格分隔', M.bytesToDecimal([0x0a, 0xff, 0x00]), '10 255 0');

console.log('\n--- 宽松解析与明确报错 ---');
check('忽略空格', M.binaryToBytes('0100 0001'), { ok: true, bytes: [0x41] });
check('忽略换行与制表符', M.binaryToBytes('\n01000001\t\r\n'), { ok: true, bytes: [0x41] });
check('忽略全角空格（\\s 覆盖 Unicode 空白）', M.binaryToBytes('01000001\u3000'), {
  ok: true,
  bytes: [0x41],
});
check('空输入是 0 个字节，不是错误', M.binaryToBytes(''), { ok: true, bytes: [] });
check('只有空白也是 0 个字节', M.binaryToBytes(' \n\t '), { ok: true, bytes: [] });
check('空输入得到空文本', M.binaryToText(''), {
  ok: true,
  text: '',
  bytes: [],
  hex: '',
  decimal: '',
  byteCount: 0,
  charCount: 0,
  utf16Length: 0,
});
check('字符 2 被拒绝', M.binaryToBytes('01000002').ok, false);
check('字母被拒绝', M.binaryToBytes('0100a001').ok, false);
check('中文字符被拒绝而不是被忽略', M.binaryToBytes('01000001中').ok, false);
check(
  '报错指出第几位、是哪个字符',
  M.binaryToBytes('0100x001').error.includes('第 5 个二进制位') &&
    M.binaryToBytes('0100x001').error.includes('x'),
  true,
);
check('位数不是 8 的倍数被拒绝', M.binaryToBytes('010000011').ok, false);
check(
  '报错说明总位数与还差多少位',
  M.binaryToBytes('0100').error.includes('4') &&
    M.binaryToBytes('0100').error.includes('不是 8 的倍数'),
  true,
);
check('7 位被拒绝（少 1 位）', M.binaryToBytes('0100000').ok, false);
check('9 位被拒绝（多 1 位）', M.binaryToBytes('010000011').error.includes('多出 1 位'), true);
check('非法 UTF-8 字节序列在第二步被拒绝', M.binaryToText('11111111').ok, false);
check(
  '非法 UTF-8 的报错来自解码器而不是解析器',
  M.binaryToText('11111111').error.includes('UTF-8'),
  true,
);

console.log('\n--- 字节数 vs 字符数 ---');
check('“中”是 1 个字符', M.describeText('中').charCount, 1);
check('“中”是 3 个字节', M.describeText('中').byteCount, 3);
check('“😀”是 1 个字符', M.describeText('😀').charCount, 1);
check('“😀”是 4 个字节', M.describeText('😀').byteCount, 4);
check('“😀”的 UTF-16 码元是 2（JavaScript 的 .length）', M.describeText('😀').utf16Length, 2);
check('“A”是 1 字节 1 字符 1 码元', M.describeText('A'), {
  byteCount: 1,
  charCount: 1,
  utf16Length: 1,
});
check('“👨‍👩‍👧”是 5 个码点（含两个零宽连接符）', M.countCharacters('👨‍👩‍👧'), 5);
check('“👨‍👩‍👧”是 18 个字节', M.describeText('👨‍👩‍👧').byteCount, 18);
check('“中文😀”是 3 字符 10 字节', M.describeText('中文😀'), {
  byteCount: 10,
  charCount: 3,
  utf16Length: 4,
});
check('空文本统计全为 0', M.describeText(''), {
  byteCount: 0,
  charCount: 0,
  utf16Length: 0,
});
check('孤立代理项算 1 个码元 1 个码点', M.describeText('\ud800'), {
  byteCount: 3,
  charCount: 1,
  utf16Length: 1,
});

console.log('\n--- 逐字节表 ---');
check('单行内容', M.byteRows([0x41]).rows[0], {
  index: 1,
  binary: '01000001',
  hex: '41',
  decimal: 65,
});
check('序号从 1 开始且连续', M.byteRows([1, 2, 3]).rows.map((row) => row.index), [1, 2, 3]);
check('未超上限时不标记截断', M.byteRows([1, 2, 3]).truncated, false);
check('超过上限时截断', M.byteRows(M.encodeUtf8('中'.repeat(300))).rows.length, M.MAX_TABLE_BYTES);
check('超过上限时标记截断', M.byteRows(M.encodeUtf8('中'.repeat(300))).truncated, true);
check('上限本身不截断', M.byteRows(new Array(M.MAX_TABLE_BYTES).fill(0)).truncated, false);

console.log('\n--- 边界：空、超长、极值 ---');
check('空文本编码为 0 字节', M.textToBinary('').bytes, []);
check('空文本的二进制是空串', M.textToBinary('').binary, '');
check('空白文本不是空字节', M.textToBinary('  ', 'none').bytes, [0x20, 0x20]);
check('一个字节的 0x00 会显示，不会被当成空', M.textToBinary('\u0000').binary, '00000000');
{
  const long = '中a😀'.repeat(20_000); // 80k 码点，160k 字节
  check('超长文本与 TextEncoder 仍然逐字节一致', M.encodeUtf8(long).length, platformEncode(long).length);
  let mismatch = -1;
  const ours = M.encodeUtf8(long);
  const theirs = platformEncode(long);
  for (let i = 0; i < ours.length; i += 1) {
    if (ours[i] !== theirs[i]) {
      mismatch = i;
      break;
    }
  }
  check('超长文本逐字节比对无差异', mismatch, -1);
  const restored = M.binaryToText(M.bytesToBinary(ours, 'group8'));
  check('超长文本往返逐字符一致', restored.ok ? restored.text === long : false, true);
  check('超长文本字节数', M.describeText(long).byteCount, 160_000);
}
{
  // Every single-byte value as a binary string, parsed back. This is the
  // smallest loop that covers all 256 byte values.
  const all = Array.from({ length: 256 }, (_, i) => i);
  check(
    '256 个字节值各自往返正确',
    M.binaryToBytes(M.bytesToBinary(all, 'none')).bytes,
    all,
  );
}

console.log('\n--- 反证：更简单的写法为什么是错的 ---');
{
  // 1) "one character = one code point, padded to 8 bits"
  // U+4E2D in base two is 100111000101101 — 15 bits, so this cannot even be
  // split into whole bytes, let alone match the three bytes UTF-8 produces.
  check('反证：按码位写的“中”是 15 位而不是 24 位', M.naiveCodePointBinary('中').length, 15);
  check(
    '反证：按码位写的“中”凑不成整字节',
    M.naiveCodePointBinary('中').length % 8 === 0,
    false,
  );
  check('正确实现给出 3 个字节', M.encodeUtf8('中').length, 3);
  check(
    '反证：码位写法与 UTF-8 结果不同',
    M.naiveCodePointBinary('中') === M.bytesToBinary(M.encodeUtf8('中'), 'byte'),
    false,
  );
  check('反证：码位写法的“😀”超过 8 位（21 位）', M.naiveCodePointBinary('😀').length > 8, true);
  check(
    '反证：UTF-8 的“😀”是 4 个恰好 8 位的组',
    M.bytesToBinary(M.encodeUtf8('😀'), 'byte').split(' ').every((group) => group.length === 8),
    true,
  );

  // 2) "one UTF-16 code unit = one byte" via charCodeAt
  const naiveCharCode = (text) =>
    Array.from({ length: text.length }, (_, i) => text.charCodeAt(i).toString(2).padStart(8, '0')).join(' ');
  check('反证：charCodeAt 把“😀”写成 2 段', naiveCharCode('😀').split(' ').length, 2);
  check('正确实现是 4 个字节', M.encodeUtf8('😀').length, 4);
  check(
    '反证：charCodeAt 对“中”给出 1 段，正确实现是 3 个字节',
    naiveCharCode('中').split(' ').length === M.encodeUtf8('中').length,
    false,
  );

  // 3) decoding by treating each byte as a UTF-16 code unit
  check(
    '反证：把字节当码元解码得不到“中”',
    String.fromCharCode(...M.encodeUtf8('中')) === '中',
    false,
  );
  check('正确解码得到“中”', M.decodeUtf8(M.encodeUtf8('中')).text, '中');

  // 4) a permissive decoder silently accepts an overlong encoding
  const naiveBytesAsChars = (bytes) => String.fromCharCode(...bytes);
  check('反证：朴素解码把 0xC0 0x80 当两个字符接受', naiveBytesAsChars([0xc0, 0x80]).length, 2);
  check('正确实现拒绝同样的字节', M.decodeUtf8([0xc0, 0x80]).ok, false);
  check('平台的 fatal 解码器同样拒绝', strictPlatformAccepts([0xc0, 0x80]), false);
  check(
    '反证：非 fatal 的 TextDecoder 会把它们变成替换字符（所以不能拿它当“成功”）',
    platformDecode([0xc0, 0x80]) === '\u0000',
    false,
  );

  // 5) a parser that only strips spaces cannot read the wrapped layout
  const group8 = M.bytesToBinary(Array(16).fill(0x41), 'group8');
  check('反证：只去空格的朴素解析读不了换行布局', /^[01]*$/.test(group8.replace(/ /g, '')), false);
  check('宽松解析读得了同一份输出', M.binaryToBytes(group8).ok, true);
  check('宽松解析读出的字节数正确', M.binaryToBytes(group8).bytes.length, 16);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
