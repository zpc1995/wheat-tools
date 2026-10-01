/**
 * Checks the Roman numeral converter.
 *
 * The claims worth defending are "1–3999 round-trips exactly" and "nothing
 * non-standard is ever accepted or produced". Both are verified against
 * oracles that are independent of the implementation:
 *
 *   1. A digit-table encoder (thousands / hundreds / tens / units written out
 *      as literal strings). It shares no code and no algorithm with the
 *      implementation's largest-first greedy table, so a mistake in the table
 *      cannot hide in both.
 *   2. A canonical-shape regular expression plus subtractive accumulation,
 *      used as a second decoder. Every string the implementation accepts or
 *      rejects is put to both.
 *   3. The standard spelling rules themselves (no symbol four times in a row,
 *      only I-before-V/X, X-before-L/C, C-before-D/M may subtract), applied as
 *      a scan over every produced string.
 *
 * The exhaustive part matters: spot-checking MCMXCIV proves almost nothing,
 * because the interesting failures live at the subtractive boundaries (4, 9,
 * 40, 90, 400, 900) and at the carry points between them.
 *
 * Usage: node scripts/check-roman-numeral.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/roman-numeral/romanNumeralUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/roman-numeral.mjs', compiled);
const M = await import(pathToFileURL('.verify/roman-numeral.mjs').href);

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

// ---------------------------------------------------------------------------
// Oracle 1: digit-table encoder, written as literal strings.
// ---------------------------------------------------------------------------
const REF_THOUSANDS = ['', 'M', 'MM', 'MMM'];
const REF_HUNDREDS = ['', 'C', 'CC', 'CCC', 'CD', 'D', 'DC', 'DCC', 'DCCC', 'CM'];
const REF_TENS = ['', 'X', 'XX', 'XXX', 'XL', 'L', 'LX', 'LXX', 'LXXX', 'XC'];
const REF_ONES = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

function referenceEncode(value) {
  return (
    REF_THOUSANDS[Math.floor(value / 1000) % 10] +
    REF_HUNDREDS[Math.floor(value / 100) % 10] +
    REF_TENS[Math.floor(value / 10) % 10] +
    REF_ONES[value % 10]
  );
}

// ---------------------------------------------------------------------------
// Oracle 2: canonical shape + subtractive accumulation.
//
// The regular expression is the textbook statement of the standard form: at
// most three M, then at most one of CM/CD/D, at most three C, and so on down.
// Accumulation is the plain left-to-right subtraction rule.
// ---------------------------------------------------------------------------
const CANONICAL = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
const SYMBOL_VALUE = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function referenceDecode(text) {
  if (text === '' || !CANONICAL.test(text)) return null;
  let total = 0;
  for (let i = 0; i < text.length; i += 1) {
    const current = SYMBOL_VALUE[text[i]];
    const next = SYMBOL_VALUE[text[i + 1]];
    total += next !== undefined && current < next ? -current : current;
  }
  return total >= 1 && total <= 3999 ? total : null;
}

/** Main decoder reduced to the same shape as the oracle: number or null. */
function mainDecode(text) {
  const result = M.decodeRoman(text);
  return result.ok ? result.value : null;
}

console.log('--- 已知固定值：编码 ---');
// Values taken from the standard definition; every one of them sits on a
// subtractive boundary or is a often-quoted example.
check('1 = I', M.encodeRoman(1), 'I');
check('4 = IV（第一个减法组合）', M.encodeRoman(4), 'IV');
check('5 = V', M.encodeRoman(5), 'V');
check('9 = IX', M.encodeRoman(9), 'IX');
check('40 = XL', M.encodeRoman(40), 'XL');
check('49 = XLIX（两个减法组合相邻）', M.encodeRoman(49), 'XLIX');
check('90 = XC', M.encodeRoman(90), 'XC');
check('400 = CD', M.encodeRoman(400), 'CD');
check('900 = CM', M.encodeRoman(900), 'CM');
check('1994 = MCMXCIV', M.encodeRoman(1994), 'MCMXCIV');
check('2024 = MMXXIV', M.encodeRoman(2024), 'MMXXIV');
check('3888 = MMMDCCCLXXXVIII（最长写法）', M.encodeRoman(3888), 'MMMDCCCLXXXVIII');
check('3999 = MMMCMXCIX（上界）', M.encodeRoman(3999), 'MMMCMXCIX');

console.log('--- 已知固定值：解码 ---');
check('IV = 4', M.decodeRoman('IV'), { ok: true, value: 4 });
check('MCMXCIV = 1994', M.decodeRoman('MCMXCIV'), { ok: true, value: 1994 });
check('MMXXIV = 2024', M.decodeRoman('MMXXIV'), { ok: true, value: 2024 });
check('MMMDCCCLXXXVIII = 3888', M.decodeRoman('MMMDCCCLXXXVIII'), { ok: true, value: 3888 });
check('MMMCMXCIX = 3999', M.decodeRoman('MMMCMXCIX'), { ok: true, value: 3999 });
check('小写 mcmxciv = 1994', M.decodeRoman('mcmxciv'), { ok: true, value: 1994 });
check('混合大小写 McMxCiv = 1994', M.decodeRoman('McMxCiv'), { ok: true, value: 1994 });
check('前后空白被忽略', M.decodeRoman('  MMXXIV  '), { ok: true, value: 2024 });

console.log('--- 穷举：1..3999 与独立数位表编码器逐个比对 ---');
{
  let mismatches = 0;
  let firstBad = null;
  for (let value = 1; value <= 3999; value += 1) {
    const actual = M.encodeRoman(value);
    const expected = referenceEncode(value);
    if (actual !== expected) {
      mismatches += 1;
      if (firstBad === null) firstBad = { value, actual, expected };
    }
  }
  check('3999 个值的编码与数位表参照实现完全一致', mismatches, 0);
  if (firstBad) console.log(`        首个不一致：${JSON.stringify(firstBad)}`);
}

console.log('--- 穷举往返：编码 → 解码回到原值 ---');
{
  let viaMain = 0;
  let viaReference = 0;
  let firstBad = null;
  for (let value = 1; value <= 3999; value += 1) {
    const text = M.encodeRoman(value);
    if (mainDecode(text) !== value) {
      viaMain += 1;
      if (firstBad === null) firstBad = { value, text, got: mainDecode(text) };
    }
    if (referenceDecode(text) !== value) viaReference += 1;
  }
  check('主实现解码 3999 个编码结果全部回到原值', viaMain, 0);
  check('独立解码实现同样全部回到原值（两者互为验证）', viaReference, 0);
  if (firstBad) console.log(`        首个失败：${JSON.stringify(firstBad)}`);
}

console.log('--- 规范符合性：3999 个输出都必须是标准写法 ---');
{
  // Concrete forbidden shapes, spelled out rather than derived, so this scan
  // does not repeat the implementation's own reasoning.
  const FORBIDDEN = ['IIII', 'XXXX', 'CCCC', 'MMMM', 'VX', 'IL', 'IC', 'ID', 'IM', 'XD', 'XM', 'LC', 'LD', 'LM', 'DM', 'VL', 'VC', 'VD', 'VM'];

  let fourInARow = 0;
  let forbiddenPair = 0;
  let badShape = 0;
  let badChars = 0;
  let tooLong = 0;
  let longest = 0;
  let longestValue = 0;
  for (let value = 1; value <= 3999; value += 1) {
    const text = M.encodeRoman(value);
    if (/([IVXLCDM])\1{3,}/.test(text)) fourInARow += 1;
    if (FORBIDDEN.some((shape) => text.includes(shape))) forbiddenPair += 1;
    if (!CANONICAL.test(text)) badShape += 1;
    if (!/^[IVXLCDM]+$/.test(text)) badChars += 1;
    if (text.length > M.MAX_ROMAN_LENGTH) tooLong += 1;
    if (text.length > longest) {
      longest = text.length;
      longestValue = value;
    }
  }
  check('没有任何输出出现连续 4 个相同符号', fourInARow, 0);
  check('没有任何输出包含非法组合（VX / IL / IC / XM / …）', forbiddenPair, 0);
  check('全部输出匹配标准形状正则（独立校验器）', badShape, 0);
  check('全部输出只含 I V X L C D M', badChars, 0);
  check('没有输出超过长度上限', tooLong, 0);
  check(`最长写法的长度确实是 ${M.MAX_ROMAN_LENGTH}`, longest, M.MAX_ROMAN_LENGTH);
  check('最长写法出现在 3888', longestValue, 3888);
  // The limit the decoder enforces must be the real maximum, not a guess.
  check('MAX_ROMAN_LENGTH 与穷举结果一致', M.MAX_ROMAN_LENGTH, longest);
}

console.log('--- 拆解过程 ---');
{
  check('1994 的拆解是 M + CM + XC + IV', M.formatBreakdown(M.decompose(1994)), 'M + CM + XC + IV');
  check(
    '1994 的拆解表达式',
    `${1994} = ${M.formatBreakdown(M.decompose(1994))}`,
    '1994 = M + CM + XC + IV',
  );
  check('1994 的数值拆解逐项相加等于 1994', M.formatBreakdownValues(M.decompose(1994)), '1000 + 900 + 90 + 4 = 1994');
  check('2024 的拆解', M.formatBreakdown(M.decompose(2024)), 'M + M + X + X + IV');
  check('3888 的拆解共 15 项（3 + 4 + 4 + 4）', M.decompose(3888).length, 15);
  check(
    '3888 的拆解符号序列',
    M.decompose(3888).map((step) => step.symbol),
    ['M', 'M', 'M', 'D', 'C', 'C', 'C', 'L', 'X', 'X', 'X', 'V', 'I', 'I', 'I'],
  );
  check('1 的拆解只有一项', M.formatBreakdown(M.decompose(1)), 'I');
  check('4000 的拆解会抛错而不是编造', (() => {
    try {
      M.decompose(4000);
      return 'no-throw';
    } catch (error) {
      return error instanceof RangeError ? 'RangeError' : String(error);
    }
  })(), 'RangeError');

  // Invariant over the whole domain: the steps sum to the input and spell the
  // answer. A breakdown that does not add up would be worse than none.
  let sumMismatch = 0;
  let spellMismatch = 0;
  for (let value = 1; value <= 3999; value += 1) {
    const steps = M.decompose(value);
    const sum = steps.reduce((total, step) => total + step.value, 0);
    if (sum !== value) sumMismatch += 1;
    if (steps.map((step) => step.symbol).join('') !== M.encodeRoman(value)) spellMismatch += 1;
  }
  check('3999 个拆解的数值之和都等于原值', sumMismatch, 0);
  check('3999 个拆解的符号拼接都等于编码结果', spellMismatch, 0);
}

console.log('--- 非标准（加法式）写法，必须明确区分 ---');
{
  check('4 的加法式是 IIII', M.toAdditiveRoman(4), 'IIII');
  check('9 的加法式是 VIIII', M.toAdditiveRoman(9), 'VIIII');
  check('40 的加法式是 XXXX', M.toAdditiveRoman(40), 'XXXX');
  check('90 的加法式是 LXXXX', M.toAdditiveRoman(90), 'LXXXX');
  check('400 的加法式是 CCCC', M.toAdditiveRoman(400), 'CCCC');
  check('900 的加法式是 DCCCC', M.toAdditiveRoman(900), 'DCCCC');
  check('1994 的加法式是 MDCCCCLXXXXIIII', M.toAdditiveRoman(1994), 'MDCCCCLXXXXIIII');
  check('2024 的加法式是 MMXXIIII', M.toAdditiveRoman(2024), 'MMXXIIII');

  // The additive spelling is only interesting where it differs.
  let differs = 0;
  let subtractiveFormPresent = 0;
  for (let value = 1; value <= 3999; value += 1) {
    const additive = M.toAdditiveRoman(value);
    if (additive !== M.encodeRoman(value)) differs += 1;
    if (/CM|CD|XC|XL|IX|IV/.test(additive)) subtractiveFormPresent += 1;
  }
  check('加法式写法绝不会包含 CM / CD / XC / XL / IX / IV', subtractiveFormPresent, 0);
  check('加法式与标准式不同的数值共 1952 个', differs, 1952);
  check('3888 两种写法相同（它本来就没有减法部分）', M.toAdditiveRoman(3888), M.encodeRoman(3888));

  // 加法式 never has four in a row... except it deliberately does, so a naive
  // "always reject four in a row" rule would reject the documented spelling.
  check('加法式确实会出现连续 4 个相同符号（所以它非标准）', /([IVXLCDM])\1{3,}/.test(M.toAdditiveRoman(4)), true);

  // And the decoder must not accept it.
  check('解码拒绝 IIII（即使它有加法式读法 4）', M.decodeRoman('IIII').ok, false);
  check('解码拒绝 VIIII', M.decodeRoman('VIIII').ok, false);
  check('解码拒绝 XXXX', M.decodeRoman('XXXX').ok, false);
  check('解码拒绝 CCCC', M.decodeRoman('CCCC').ok, false);
}

console.log('--- 非法阿拉伯输入 ---');
{
  const bad = ['', '   ', '0', '00', '0000', '-5', '4000', '3.5', '0.5', 'abc', '1e3', '1,994', '+5', '10000', '9'.repeat(60), 'Ⅷ', '四', '🔢', '1 2', '12a'];
  const unexpected = [];
  for (const input of bad) {
    const result = M.convertArabic(input);
    if (result.ok) unexpected.push(`${JSON.stringify(input)} => ${result.value.roman}`);
  }
  check(`${bad.length} 个非法阿拉伯输入全部被拒绝`, unexpected, []);

  check('null 被拒绝而不是抛错', M.convertArabic(null).ok, false);
  check('undefined 被拒绝而不是抛错', M.convertArabic(undefined).ok, false);
  check('数字类型实参被拒绝（避免 Number("") === 0 这类陷阱）', M.convertArabic(12).ok, false);
  check('空对象被拒绝', M.convertArabic({}).ok, false);

  check('0 的错误说明了"没有表示 0 的符号"', /没有表示 0 的符号/.test(M.convertArabic('0').error), true);
  check('负数的错误说明了原因', /负数没有标准罗马数字写法/.test(M.convertArabic('-5').error), true);
  check('小数被单独识别', /不接受小数/.test(M.convertArabic('3.5').error), true);
  check('4000 的错误提到了 3999 上限', /3999/.test(M.convertArabic('4000').error), true);
  check('4000 的错误提到了 vinculum（加横线）这类替代约定', /vinculum/.test(M.convertArabic('4000').error), true);
  check('超长输入的错误说明它必然超范围', /必然超出范围/.test(M.convertArabic('10000').error), true);

  // Boundary values are accepted, and their neighbours are not.
  check('1 被接受', M.convertArabic('1').ok, true);
  check('3999 被接受', M.convertArabic('3999').ok, true);
  check('3999 的结果', M.convertArabic('3999').value.roman, 'MMMCMXCIX');
  check('3999 + 1 = 4000 被拒绝', M.convertArabic('4000').ok, false);
  check('前导零被当作同一个数', M.convertArabic('007').value.roman, 'VII');
  check('两端空白被忽略', M.convertArabic('  1994  ').value.roman, 'MCMXCIV');
}

console.log('--- 非法罗马输入：必须失败而不是猜 ---');
{
  const bad = ['', '   ', 'IIII', 'ABC', 'VX', 'IL', 'IC', 'ID', 'IM', 'XD', 'XM', 'LC', 'LD', 'LM', 'VL', 'VC', 'VD', 'VM', 'DM', 'MMMM', 'IIX', 'IVI', 'MCMC', 'MIM', 'XXXXXXXXXX', 'X'.repeat(40), 'MCMXCIVX', 'Ⅷ', '四', '🔢', 'M C M'];
  const unexpected = [];
  for (const input of bad) {
    const result = M.decodeRoman(input);
    if (result.ok) unexpected.push(`${JSON.stringify(input)} => ${result.value}`);
  }
  check(`${bad.length} 个非法罗马输入全部被拒绝`, unexpected, []);

  check('null 被拒绝而不是抛错', M.decodeRoman(null).ok, false);
  check('undefined 被拒绝而不是抛错', M.decodeRoman(undefined).ok, false);
  check('数字类型实参被拒绝', M.decodeRoman(1994).ok, false);

  check('IIII 的错误给出标准写法 IV', /标准写法是“IV”/.test(M.decodeRoman('IIII').error), true);
  check('IIII 的错误指出同一符号连续出现 4 次', /连续出现了 4 次/.test(M.decodeRoman('IIII').error), true);
  check('VX 的错误指出它不是合法减法组合', /不是合法的减法组合/.test(M.decodeRoman('VX').error), true);
  check('VX 的错误给出标准写法 V', /标准写法是“V”/.test(M.decodeRoman('VX').error), true);
  check('IL 的错误给出标准写法 XLIX', /标准写法是“XLIX”/.test(M.decodeRoman('IL').error), true);
  check('XM 的错误给出标准写法 CMXC', /标准写法是“CMXC”/.test(M.decodeRoman('XM').error), true);
  check('IC 的错误给出标准写法 XCIX', /标准写法是“XCIX”/.test(M.decodeRoman('IC').error), true);
  check('ABC 的错误指出非罗马字符', /非罗马数字字符/.test(M.decodeRoman('ABC').error), true);
  check('空串的错误提示输入', /请输入/.test(M.decodeRoman('').error), true);
  check('MMMM 的错误说明超出可表示范围', /超出标准罗马数字能表示的范围/.test(M.decodeRoman('MMMM').error), true);
  check('超长输入的错误提到最长 15 位', /最长 15 位/.test(M.decodeRoman('X'.repeat(40)).error), true);
  check('全角罗马数字字符也不被当作合法输入', /非罗马数字字符/.test(M.decodeRoman('Ⅷ').error), true);
}

console.log('--- 与独立解码实现互相验证（枚举短字符串） ---');
{
  // Every string over {I,V,X,L} of length 1..4, plus every string over the full
  // seven symbols of length 1..3. This is where the two decoders are most
  // likely to disagree: malformed shapes that are neither obviously valid nor
  // obviously junk.
  const strings = [];
  const build = (alphabet, maxLength) => {
    const walk = (prefix, remaining) => {
      if (prefix !== '') strings.push(prefix);
      if (remaining === 0) return;
      for (const char of alphabet) walk(prefix + char, remaining - 1);
    };
    walk('', maxLength);
  };
  build('IVXL', 4);
  build('IVXLCDM', 3);

  let disagreements = 0;
  let acceptedByMain = 0;
  let rejectedByBoth = 0;
  let firstBad = null;
  for (const text of strings) {
    const main = mainDecode(text);
    const oracle = referenceDecode(text);
    if (main !== oracle) {
      disagreements += 1;
      if (firstBad === null) firstBad = { text, main, oracle };
    }
    if (main !== null) acceptedByMain += 1;
    if (main === null && oracle === null) rejectedByBoth += 1;
  }
  check(`${strings.length} 个短字符串上两个解码实现完全一致`, disagreements, 0);
  check('其中确实存在被接受的标准写法（样本非平凡）', acceptedByMain > 100, true);
  check('其中确实存在被双方拒绝的写法（样本非平凡）', rejectedByBoth > 100, true);
  if (firstBad) console.log(`        首个不一致：${JSON.stringify(firstBad)}`);

  // Both decoders must reject the entire non-canonical population. Counting the
  // accepted set is a second, structural check: the accepted strings are
  // exactly the 3999 encodings when the alphabet is complete, and a subset of
  // them otherwise — never anything else.
  const canonicalSet = new Set();
  for (let value = 1; value <= 3999; value += 1) canonicalSet.add(M.encodeRoman(value));
  const acceptedNotCanonical = strings.filter((text) => mainDecode(text) !== null && !canonicalSet.has(text));
  check('被接受的短字符串无一例外都是某个标准编码结果', acceptedNotCanonical, []);
}

console.log('--- 为什么"更简单"的写法是错的（对照断言） ---');
{
  // A decoder that only ever adds — the usual first attempt — reads MCMXCIV as
  // 2216 because it has no subtraction rule at all.
  const naiveAddOnly = (text) =>
    text.split('').reduce((total, char) => total + SYMBOL_VALUE[char], 0);
  check('朴素全加法解码 MCMXCIV 得到 2216（错）', naiveAddOnly('MCMXCIV'), 2216);
  check('正确结果是 1994，两者不同（说明减法规则不可省）', naiveAddOnly('MCMXCIV') !== 1994, true);

  // The opposite extreme — accepting any additive reading — would answer 4 for
  // IIII. That is the "guess instead of fail" behaviour being avoided here.
  check('如果接受加法式读法，IIII 会被答成 4', referenceDecode('IIII') === null && naiveAddOnly('IIII') === 4, true);
  check('本实现拒绝 IIII 而不是回答 4', M.decodeRoman('IIII').ok, false);

  // Extending the greedy encoder past its range would produce MMMM for 4000,
  // which the standard rules forbid; refusing is the only honest option.
  const naiveExtend = (value) => 'M'.repeat(value / 1000);
  check('把编码器简单外推到 4000 会得到 MMMM（违反"最多 3 个"的规则）', naiveExtend(4000), 'MMMM');
  check('MMMM 未通过标准形状校验', CANONICAL.test('MMMM'), false);
  check('本实现对外推结果直接抛错', (() => {
    try {
      M.encodeRoman(4000);
      return 'no-throw';
    } catch (error) {
      return error instanceof RangeError ? 'RangeError' : String(error);
    }
  })(), 'RangeError');
}

console.log('--- 数值入口的越界防护 ---');
{
  const cases = [0, -1, 4000, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 3999.5];
  const notThrown = [];
  for (const value of cases) {
    try {
      M.encodeRoman(value);
      notThrown.push(String(value));
    } catch (error) {
      if (!(error instanceof RangeError)) notThrown.push(`${String(value)}: ${String(error)}`);
    }
  }
  check('0 / 负数 / 4000 / 小数 / NaN / Infinity 全部抛 RangeError', notThrown, []);
  check('边界值 1 与 3999 不抛错', [M.encodeRoman(1), M.encodeRoman(3999)], ['I', 'MMMCMXCIX']);
}

console.log('--- convertRoman / convertArabic 的字段一致性 ---');
{
  const upper = M.convertRoman('MCMXCIV');
  check('转换成功', upper.ok, true);
  check('数值', upper.value.value, 1994);
  check('规范化写法', upper.value.roman, 'MCMXCIV');
  check('原始输入被保留', upper.value.original, 'MCMXCIV');
  check('拆解文本', upper.value.breakdown, 'M + CM + XC + IV');
  check('加法式对照', upper.value.additive, 'MDCCCCLXXXXIIII');

  const lower = M.convertRoman('mcmxciv');
  check('小写输入保留原样但结果一致', [lower.value.original, lower.value.roman, lower.value.value], ['mcmxciv', 'MCMXCIV', 1994]);

  const arabic = M.convertArabic('1994');
  check('阿拉伯侧结果与罗马侧互逆', arabic.value.roman, upper.value.roman);
  check('阿拉伯侧拆解一致', arabic.value.breakdown, upper.value.breakdown);
  check('阿拉伯侧数值拆解', arabic.value.breakdownValues, '1000 + 900 + 90 + 4 = 1994');

  // Round trip through both entry points for the whole domain, comparing the
  // two directions against each other rather than against a constant.
  let mismatches = 0;
  for (let value = 1; value <= 3999; value += 1) {
    const forward = M.convertArabic(String(value));
    const backward = M.convertRoman(forward.value.roman);
    if (!backward.ok || backward.value.value !== value) mismatches += 1;
    if (forward.value.roman !== backward.value.roman) mismatches += 1;
  }
  check('3999 组 convertArabic → convertRoman 往返一致', mismatches, 0);

  // Failure objects must not carry a value; a caller that forgets to check
  // `ok` would otherwise read a stale or undefined one.
  const failure = M.convertRoman('IIII');
  check('失败结果只有 ok 与 error 两个字段', Object.keys(failure).sort(), ['error', 'ok']);
  check('失败结果的 ok 为 false', failure.ok, false);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
