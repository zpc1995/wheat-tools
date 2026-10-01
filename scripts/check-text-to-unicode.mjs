/**
 * Checks the text <-> Unicode escape converter.
 *
 * The claim worth defending is "a character is a code point, not a UTF-16 code
 * unit". Everything else in the tool follows from getting that right, so the
 * checks are built around three independent oracles:
 *
 *   1. The platform. `codePointAt` / `fromCodePoint` and `TextEncoder` define
 *      what a code point and a UTF-8 byte sequence *are*; the implementation's
 *      own surrogate arithmetic and RFC 3629 encoder are compared against them,
 *      bytes for bytes, over the whole Unicode range rather than on a handful of
 *      favours.
 *   2. Known fixed values from the Unicode standard: A = U+0041,
 *      中 = U+4E2D (e4 b8 ad), 😀 = U+1F600 (d83d de00, f0 9f 98 80),
 *      𝄞 = U+1D11E (d834 dd1e, f0 9d 84 9e).
 *   3. Round trips. Every style is escaped and unescaped again with every
 *      combination of options over mixed Chinese / ASCII / emoji / control
 *      samples and over randomly generated code point strings. Nothing is
 *      asserted from the implementation's own output; the original text is.
 *
 * The surrogate trap is countered explicitly: the naive "split the string and
 * read charCodeAt" version is implemented here, asserted to produce the wrong
 * `U+D83D U+DE00` list for 😀, and shown to be undecodable — a counter-proof
 * that this suite would catch the mistake rather than merely pass.
 *
 * Usage: node scripts/check-text-to-unicode.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/text-to-unicode/textToUnicodeUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/text-to-unicode.mjs', compiled);
const M = await import(pathToFileURL('.verify/text-to-unicode.mjs').href);

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

const options = (style, extra = {}) => ({
  style,
  escapeAscii: false,
  uppercase: true,
  padTo4: true,
  ...extra,
});
const escape = (text, style, extra) => M.escapeText(text, options(style, extra)).output;
const unescape = (text) => M.unescapeText(text);
const utf8 = (text) => Array.from(new TextEncoder().encode(text));

console.log('--- 权威参照物：平台实现与已知固定值 ---');
check('平台参照：😀 的码位', '😀'.codePointAt(0), 0x1f600);
check('平台参照：😀 在 JS 里占 2 个码元', '😀'.length, 2);
check('平台参照：😀 的两个码元', ['😀'.charCodeAt(0), '😀'.charCodeAt(1)], [0xd83d, 0xde00]);
check('平台参照：fromCodePoint 还原 😀', String.fromCodePoint(0x1f600), '😀');
check('平台参照：TextEncoder 对 中 给出 e4 b8 ad', utf8('中'), [0xe4, 0xb8, 0xad]);
check('平台参照：TextEncoder 对 😀 给出 4 字节 f0 9f 98 80', utf8('😀'), [0xf0, 0x9f, 0x98, 0x80]);
check('平台参照：TextEncoder 对 𝄞 给出 f0 9d 84 9e', utf8('𝄞'), [0xf0, 0x9d, 0x84, 0x9e]);
check('已知固定值：A = U+0041', M.describeText('A')[0].codePoint, 0x41);
check('已知固定值：中 = U+4E2D', M.describeText('中')[0].codePoint, 0x4e2d);
check('已知固定值：𝄞 = U+1D11E', M.describeText('𝄞')[0].codePoint, 0x1d11e);
check('已知固定值：𝄞 的 UTF-16 码元 d834 dd1e', M.describeText('𝄞')[0].codeUnits, [0xd834, 0xdd1e]);

console.log('--- 逐字符信息与平台一致 ---');
{
  const samples = ['', 'A', 'é', '中', '😀', '𝄞', 'a😀b中𝄞', '你好，世界！😀'];
  let mismatches = 0;
  for (const sample of samples) {
    // Independent split using the platform's own code point iterator.
    const expected = [];
    for (let index = 0; index < sample.length; ) {
      const codePoint = sample.codePointAt(index);
      expected.push(codePoint);
      index += codePoint > 0xffff ? 2 : 1;
    }
    const actual = M.describeText(sample).map((info) => info.codePoint);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches += 1;

    // The UTF-8 column must equal what the platform would transmit.
    const bytes = M.describeText(sample).flatMap((info) => info.utf8);
    if (JSON.stringify(bytes) !== JSON.stringify(utf8(sample))) mismatches += 1;
  }
  check('describeText 的码位与 codePointAt、UTF-8 与 TextEncoder 在 8 个样本上一致', mismatches, 0);
}
{
  // Exhaustive sweep: every legal code point. Batched into chunks so the
  // platform encoder is called a thousand times rather than a million.
  const encoder = new TextEncoder();
  let chars = [];
  let checkedCount = 0;
  let mismatches = 0;
  const flush = () => {
    if (chars.length === 0) return;
    const expected = Array.from(encoder.encode(chars.join('')));
    const actual = chars.flatMap((char) => M.utf8Bytes(char.codePointAt(0)));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches += 1;
    checkedCount += chars.length;
    chars = [];
  };
  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
    chars.push(String.fromCodePoint(codePoint));
    if (chars.length >= 1024) flush();
  }
  flush();
  check(`utf8Bytes 在全部 ${checkedCount} 个合法码位上与 TextEncoder 逐字节一致`, mismatches, 0);
  check('扫描确实覆盖了整个 Unicode 范围（1114112 减去 2048 个代理）', checkedCount, 0x110000 - 0x800);
}
{
  let mismatches = 0;
  for (let unit = 0xd800; unit <= 0xdfff; unit += 1) {
    const expected = utf8(String.fromCharCode(unit));
    if (JSON.stringify(M.utf8Bytes(unit)) !== JSON.stringify(expected)) mismatches += 1;
  }
  check('孤立代理的 UTF-8 与 TextEncoder 一致（都替换为 EF BF BD）', mismatches, 0);
  check('孤立代理确实被替换而不是原样编码', M.utf8Bytes(0xd83d), [0xef, 0xbf, 0xbd]);
}

console.log('--- 转义：已知输出 ---');
check('默认不改写 ASCII', escape('A', 'js'), 'A');
check('可选转义 ASCII', escape('A', 'js', { escapeAscii: true }), '\\u0041');
check('中 的 JS 转义', escape('中', 'js'), '\\u4E2D');
check('小写十六进制', escape('中', 'js', { uppercase: false }), '\\u4e2d');
check('😀 的 JS 转义是一对代理转义', escape('😀', 'js'), '\\uD83D\\uDE00');
check('😀 的 ES6 转义是一个码点', escape('😀', 'es6'), '\\u{1F600}');
check('😀 的 U+ 记法只有一个码位', escape('😀', 'codepoint'), 'U+1F600');
check('😀 的 HTML 十进制实体', escape('😀', 'html-decimal'), '&#128512;');
check('😀 的 HTML 十六进制实体', escape('😀', 'html-hex'), '&#x1F600;');
check('𝄞 的 JS 转义', escape('𝄞', 'js'), '\\uD834\\uDD1E');
check('𝄞 的 U+ 记法', escape('𝄞', 'codepoint'), 'U+1D11E');
check('U+ 记法可小写', escape('中', 'codepoint', { uppercase: false }), 'U+4e2d');
check('补零到 4 位', escape('A', 'codepoint', { escapeAscii: true }), 'U+0041');
check('关闭补零后不补', escape('A', 'codepoint', { escapeAscii: true, padTo4: false }), 'U+41');
check('JS 风格永远 4 位（这是它的语法）', escape('A', 'js', { escapeAscii: true, padTo4: false }), '\\u0041');
check('码位列表列出全部字符', escape('A中', 'list'), 'U+0041 U+4E2D');
check('码位列表里的空格也写成 U+0020', escape('A B', 'list'), 'U+0041 U+0020 U+0042');
check('转义计数只数被转义的码位', M.escapeText('A中😀', options('js')).escapedCount, 2);
check('码位计数不是 UTF-16 长度', M.escapeText('A中😀', options('js')).codePointCount, 3);
check('全部转义时计数等于码位数', M.escapeText('A中', options('js', { escapeAscii: true })).escapedCount, 2);
check('空文本转义为空', M.escapeText('', options('js')), {
  output: '',
  codePointCount: 0,
  escapedCount: 0,
});

console.log('--- 反转义：已知输出 ---');
check('\\u4E2D 还原为 中', unescape('\\u4E2D').text, '中');
check('小写输入同样接受', unescape('\\u4e2d').text, '中');
check('\\u{1F600} 还原为 😀', unescape('\\u{1F600}').text, '😀');
check('U+1F600 还原为 😀', unescape('U+1F600').text, '😀');
check('u+4e2d 小写也接受', unescape('u+4e2d').text, '中');
check('&#128512; 还原为 😀', unescape('&#128512;').text, '😀');
check('&#x1F600; 还原为 😀', unescape('&#x1F600;').text, '😀');
check('&#X4E2D; 大写 X 也接受', unescape('&#X4E2D;').text, '中');
check('代理对两条转义合成一个字符', unescape('\\uD83D\\uDE00'), {
  ok: true,
  text: '😀',
  escapeCount: 2,
  surrogatePairCount: 1,
});
check('辅助平面字符在结果里只占 1 个码位', M.describeText(unescape('\\uD83D\\uDE00').text).length, 1);
check(
  '混合风格一次解码',
  unescape('\\u4F60\\u597D \\uD83D\\uDE00 U+1D11E &#x4E2D; &#128512;').text,
  '你好 😀 𝄞 中 😀',
);
check('没有转义的普通文本原样返回', unescape('plain text 普通文本').text, 'plain text 普通文本');
check('反斜杠后的普通字符保持字面', unescape('C:\\path\\to').text, 'C:\\path\\to');
check('两条反斜杠还原为一条', unescape('a\\\\b').text, 'a\\b');
check('空输入不报错', unescape(''), { ok: true, text: '', escapeCount: 0, surrogatePairCount: 0 });
check('空输入的转义也是空', escape('', 'list'), '');
check('码位列表的空格是分隔符（不产生多余空格）', unescape('U+0041 U+0042').text, 'AB');
check('码位列表用换行分隔也可以', unescape('U+0041\nU+0042').text, 'AB');
check('转义与普通文本相邻时空格保留', unescape('hello U+1F600').text, 'hello 😀');
check('✅ 码位列表里的 U+0020 才是真正的空格', unescape('U+4E2D U+0020 U+0041').text, '中 A');

console.log('--- 代理对陷阱的反证 ---');
{
  // The naive version this tool exists to avoid: walk the string by index and
  // read each UTF-16 code unit as if it were a character.
  const naiveCodePointList = (text) =>
    text
      .split('')
      .map((char) => 'U+' + char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'))
      .join(' ');

  check('错误写法把 😀 拆成两个「码位」', naiveCodePointList('😀'), 'U+D83D U+DE00');
  check('正确写法是 1 个码位 U+1F600', escape('😀', 'list'), 'U+1F600');
  check('两者确实不同（本断言证明该检查能抓到拆码元的实现）', naiveCodePointList('😀') === escape('😀', 'list'), false);

  const wrongDecoded = unescape(naiveCodePointList('😀'));
  check('错误的码位列表根本无法解码回去', wrongDecoded.ok, false);
  check(
    '报错点明是代理问题，而不是静默产出替换字符',
    wrongDecoded.ok ? '' : wrongDecoded.message.includes('代理'),
    true,
  );

  const rightDecoded = unescape(escape('😀', 'list'));
  check('正确的码位列表可以解码回 😀', rightDecoded.ok ? rightDecoded.text : null, '😀');
  check('码元数量与码位数量确实不同', '😀'.length === M.describeText('😀').length, false);

  // The same mistake one level down: encoding each UTF-16 code unit as if it
  // were a code point produces CESU-8, which no decoder accepts.
  const naiveUtf8 = (text) => {
    const bytes = [];
    for (let index = 0; index < text.length; index += 1) {
      const unit = text.charCodeAt(index);
      if (unit < 0x80) bytes.push(unit);
      else if (unit < 0x800) bytes.push(0xc0 | (unit >> 6), 0x80 | (unit & 0x3f));
      else bytes.push(0xe0 | (unit >> 12), 0x80 | ((unit >> 6) & 0x3f), 0x80 | (unit & 0x3f));
    }
    return bytes;
  };
  check('按码元朴素编码 😀 得到 6 字节 CESU-8', naiveUtf8('😀'), [0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80]);
  check('标准 UTF-8 是 4 字节', M.describeText('😀')[0].utf8, [0xf0, 0x9f, 0x98, 0x80]);
  check('两者长度不同', naiveUtf8('😀').length === M.describeText('😀')[0].utf8.length, false);
}

console.log('--- 往返：全部风格 × 全部选项 × 混合样本 ---');
{
  const samples = [
    '',
    'A',
    'Hello, World!',
    '中文测试',
    '你好，世界！😀𝄞',
    '😀😀😀',
    'A中😀𝄞z',
    'e\u0301 é',
    '空格 与\t制表\n换行',
    '\\u0041 &#65; U+0041',
    'C:\\Users\\u0041',
    'Ā0',
    '中A',
    '中 中',
    '中 x 中',
    '&',
    '&#',
    '&#65',
    'U+',
    'u+4E2D',
    'U+110000',
    '\u00a0nbsp\u3000全角空格',
    '𝄞𝄞',
    'a\u0000b',
  ];

  const failures = [];
  let combinations = 0;
  for (const style of M.ESCAPE_STYLES) {
    for (const escapeAscii of [false, true]) {
      for (const uppercase of [false, true]) {
        for (const padTo4 of [false, true]) {
          combinations += 1;
          for (const sample of samples) {
            const out = M.escapeText(sample, { style, escapeAscii, uppercase, padTo4 }).output;
            const back = M.unescapeText(out);
            if (!back.ok || back.text !== sample) {
              failures.push(
                `${style}/ascii=${escapeAscii}/upper=${uppercase}/pad=${padTo4} ` +
                  `${JSON.stringify(sample)} -> ${JSON.stringify(out)} -> ` +
                  (back.ok ? JSON.stringify(back.text) : back.message),
              );
            }
          }
        }
      }
    }
  }
  check(`共 ${combinations} 种风格与选项组合`, combinations, 48);
  check(`${samples.length} 个样本 × ${combinations} 种组合全部逐字符还原`, failures.slice(0, 4), []);
}

console.log('--- 往返：随机码位字符串 ---');
{
  // Deterministic pseudo-random so a failure is reproducible.
  let seed = 20241007;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  let failures = 0;
  let runs = 0;
  let supplementary = 0;
  for (let round = 0; round < 150; round += 1) {
    let text = '';
    const length = 1 + Math.floor(rand() * 20);
    for (let index = 0; index < length; index += 1) {
      let codePoint = Math.floor(rand() * 0x110000);
      // Lone surrogates are not text and get their own section below.
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) codePoint = 0x20;
      if (codePoint > 0xffff) supplementary += 1;
      text += String.fromCodePoint(codePoint);
    }

    for (const style of M.ESCAPE_STYLES) {
      for (const escapeAscii of [false, true]) {
        const out = M.escapeText(text, {
          style,
          escapeAscii,
          uppercase: rand() < 0.5,
          padTo4: rand() < 0.5,
        }).output;
        const back = M.unescapeText(out);
        runs += 1;
        if (!back.ok || back.text !== text) failures += 1;
      }
    }
  }
  check(`150 组随机码位文本共 ${runs} 次往返全部一致`, failures, 0);
  check('随机样本里确实包含辅助平面字符', supplementary > 0, true);
}

console.log('--- 孤立代理：明确报错，不静默替换 ---');
{
  const loneCases = [
    '\\uD83D',
    '\\uDE00',
    '\\uD83D\\uD83D',
    '\\uD83Dabc',
    '\\uD83D\\u0041',
    '\\uD800',
    '\\uDFFF',
    '\\u{D800}',
    'U+D800',
    '&#55296;',
    '&#xD800;',
    '&#xDFFF;',
  ];
  const notRejected = [];
  const notExplained = [];
  for (const input of loneCases) {
    const result = unescape(input);
    if (result.ok) notRejected.push(input);
    else if (!result.message.includes('代理')) notExplained.push(`${input}: ${result.message}`);
  }
  check('全部 12 个孤立代理写法都被拒绝', notRejected, []);
  check('每条错误信息都点明代理问题', notExplained, []);
  check('拒绝时给出出错位置', unescape('\\uD83D').index, 0);

  // Escaping is permissive: it must not throw away information about a lone
  // surrogate that came in, but the result is not decodable — by design.
  const lone = 'a\uD83Db';
  check('孤立代理仍可被转义（不丢信息）', escape(lone, 'js'), 'a\\uD83Db');
  check('把它转义回来会明确报错', unescape(escape(lone, 'js')).ok, false);
  check(
    'describeText 标出孤立代理',
    M.describeText(lone).map((info) => info.loneSurrogate),
    [false, true, false],
  );
  check('summary 统计孤立代理数量', M.summariseText(lone).loneSurrogateCount, 1);
  check('hasLoneSurrogate 可以直接问', M.hasLoneSurrogate(lone), true);
}

console.log('--- 非法输入 ---');
{
  const cases = [
    ['\\uZZZZ', '十六进制'],
    ['\\u12', '4 位'],
    ['\\u', '4 位'],
    ['\\u{', '花括号'],
    ['\\u{}', '十六进制'],
    ['\\u{1F600', '花括号'],
    ['\\u{110000}', '超出'],
    ['\\u{FFFFFFFF}', '超出'],
    ['U+110000', '超出'],
    ['U+FFFFFFFF', '超出'],
    ['&#1114112;', '超出'],
    ['&#x110000;', '超出'],
    ['&#xZZ;', '格式错误'],
    ['&#65', '格式错误'],
  ];
  const accepted = [];
  const unexplained = [];
  for (const [input, keyword] of cases) {
    const result = unescape(input);
    if (result.ok) accepted.push(`${input} -> ${JSON.stringify(result.text)}`);
    else if (!result.message.includes(keyword)) unexplained.push(`${input}: ${result.message}`);
  }
  check('全部 14 个非法输入都被拒绝', accepted, []);
  check('错误信息包含预期的关键说明', unexplained, []);

  check('空输入是合法输入，得到空文本', unescape('').text, '');
  check('空输入不算转义', unescape('').escapeCount, 0);
  check('只有 U+ 但没有十六进制位时按字面处理', unescape('U+').text, 'U+');
  check('超出范围的转义后面紧跟合法内容也仍然报错', unescape('\\u{110000}\\u0041').ok, false);
}

console.log('--- 与平台实现的一致性收尾 ---');
check(
  'UTF-8 字节总数与 TextEncoder 一致',
  M.summariseText('你好😀𝄞abc').utf8ByteCount,
  utf8('你好😀𝄞abc').length,
);
check('码位/码元统计', M.summariseText('A中😀'), {
  codePointCount: 3,
  codeUnitCount: 4,
  utf8ByteCount: 1 + 3 + 4,
  surrogatePairCount: 1,
  loneSurrogateCount: 0,
});
check('码位十六进制补足 4 位', M.describeText('A')[0].codePointHex, 'U+0041');
check('辅助平面码位不补零截断', M.describeText('😀')[0].codePointHex, 'U+1F600');
check('UTF-16 列用空格分开两个码元', M.describeText('😀')[0].utf16Hex, 'D83D DE00');
check('UTF-8 列用空格分开四个字节', M.describeText('😀')[0].utf8Hex, 'F0 9F 98 80');

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
