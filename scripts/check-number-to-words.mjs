/**
 * Checks the number-to-words tool.
 *
 * Two independent oracles are used, because both languages have firm rules and
 * a single implementation can be self-consistently wrong:
 *
 *   1. English is re-derived by repeated `BigInt` division by 1000 — an
 *      arithmetic route that shares no code with the implementation's
 *      string-slicing one.
 *   2. Chinese is re-derived position by position and then cleaned up with
 *      regexes (`零{2,}` → `零`, drop `零` before a group unit, drop the leading
 *      `一` of `一十`), which is a different shape of algorithm from the
 *      implementation's group accumulator.
 *
 * Both references are run over 0…20000 and a list of large/tricky values, so an
 * off-by-one in either grouping scheme cannot hide.
 *
 * The floating-point assertions exist because the single most common way to get
 * this wrong is to route the value through `Number` first:
 * `String(0.1 + 0.2)` is `"0.30000000000000004"` and `String(1e21)` is
 * `"1e+21"`, so the checks pin the string-first behaviour explicitly.
 *
 * Usage: node scripts/check-number-to-words.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(
  readFileSync('src/tools/number-to-words/numberToWordsUtils.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/number-to-words.mjs', compiled);
const M = await import(pathToFileURL('.verify/number-to-words.mjs').href);

let passed = 0;
let failed = 0;
/**
 * Stringifies a value for comparison.
 *
 * `JSON.stringify` throws on `BigInt`. That matters more than it looks: the
 * naive `JSON.stringify(actual) === JSON.stringify(expected)` form throws on
 * *both* sides, so a BigInt assertion would report PASS without comparing
 * anything at all. BigInts are tagged as strings here so the comparison is real.
 */
function stable(value) {
  return JSON.stringify(value, (key, item) =>
    typeof item === 'bigint' ? `bigint:${item.toString()}` : item,
  );
}
function check(label, actual, expected) {
  const ok = stable(actual) === stable(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${stable(actual)}\n        expected ${stable(expected)}`),
  );
}

// --- Independent English reference: repeated BigInt division by 1000 -------

const REF_ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const REF_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const REF_SCALES = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion'];

function refUnder1000(value) {
  if (value === 0) return '';
  const words = [];
  const hundreds = Math.trunc(value / 100);
  const rest = value % 100;
  if (hundreds !== 0) words.push(REF_ONES[hundreds] + ' hundred');
  if (rest !== 0) {
    if (rest < 20) words.push(REF_ONES[rest]);
    else {
      const tens = Math.trunc(rest / 10);
      const ones = rest % 10;
      words.push(ones === 0 ? REF_TENS[tens] : REF_TENS[tens] + '-' + REF_ONES[ones]);
    }
  }
  return words.join(' ');
}

function refEnglish(digits) {
  let value = BigInt(digits);
  if (value === 0n) return 'zero';
  const groups = [];
  while (value > 0n) {
    groups.push(Number(value % 1000n));
    value /= 1000n;
  }
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    if (groups[i] === 0) continue;
    const scale = REF_SCALES[i];
    parts.push(scale ? refUnder1000(groups[i]) + ' ' + scale : refUnder1000(groups[i]));
  }
  return parts.join(' ');
}

// --- Independent Chinese reference: position-by-position + regex cleanup ---

const REF_PLAIN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const REF_FIN_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
const REF_PLAIN_PLACES = ['', '十', '百', '千'];
const REF_FIN_PLACES = ['', '拾', '佰', '仟'];
const REF_GROUPS = ['', '万', '亿', '兆', '京', '垓'];

function refChinese(digits, financial) {
  const digitChars = financial ? REF_FIN_DIGITS : REF_PLAIN_DIGITS;
  const placeChars = financial ? REF_FIN_PLACES : REF_PLAIN_PLACES;
  const source = digits.replace(/^0+/, '') || '0';
  if (source === '0') return '零';

  const length = source.length;
  const groupHasValue = [];
  for (let i = 0; i < length; i += 1) {
    const group = Math.trunc((length - 1 - i) / 4);
    if (source[i] !== '0') groupHasValue[group] = true;
  }

  let raw = '';
  for (let i = 0; i < length; i += 1) {
    const digit = Number(source[i]);
    const fromRight = length - 1 - i;
    const group = Math.trunc(fromRight / 4);
    const place = fromRight % 4;
    raw += digit === 0 ? '零' : digitChars[digit] + placeChars[place];
    // The group unit belongs at the group's units digit, but only when the
    // group is not empty: otherwise 一亿零一 would grow a stray 万.
    if (place === 0 && group > 0 && groupHasValue[group]) raw += REF_GROUPS[group];
  }

  let out = raw
    .replace(/零{2,}/g, '零')
    // Padding zeros inside a group sit right before its unit and are redundant:
    // 一千零万 is wrong, 一千万 is right.
    .replace(/零(?=[万亿兆京垓])/g, '')
    .replace(/零+$/g, '');
  if (!financial && out.startsWith('一十')) out = out.slice(1);
  return out;
}

const TRICKY = [];
for (let i = 0; i <= 20000; i += 1) TRICKY.push(String(i));
TRICKY.push(
  '100000', '100001', '100010', '100100', '101000', '110000',
  '1000000', '1000001', '100000000', '100000001', '1000000001',
  '10000000000', '100010000', '1010000000', '123456789', '999999999',
  '1000000000000', '10000000000000000', '100000000000000000000',
  '999999999999999999999', '9007199254740993', '123456789012345678901',
);

console.log('--- 解析：边界与非法输入 ---');
check('空输入被拒绝', M.parseNumericInput('').ok, false);
check('空白输入被拒绝', M.parseNumericInput('   ').ok, false);
check('字母被拒绝', M.parseNumericInput('abc').ok, false);
check('两个小数点被拒绝', M.parseNumericInput('1.2.3').ok, false);
check('千分位逗号被拒绝并给出原因', M.parseNumericInput('1,000').error.includes('逗号'), true);
check('双负号被拒绝', M.parseNumericInput('--1').ok, false);
check('裸指数被拒绝', M.parseNumericInput('1e').ok, false);
check('小数点后紧跟指数字母被拒绝（1e2.5）', M.parseNumericInput('1e2.5').ok, false);
check('超长输入被拒绝', M.parseNumericInput('1'.repeat(201)).error.includes('过长'), true);
check('小数位过多被拒绝', M.parseNumericInput('0.' + '1'.repeat(31)).error.includes('小数位过多'), true);
check('指数过大被拒绝', M.parseNumericInput('1e101').error.includes('指数'), true);

check('前导零被规范化（007 → 7）', M.parseNumericInput('007').canonical, '7');
check('前导零读作 seven 而非零零七', M.englishWordsOf('007').text, 'seven');
check('正号被接受', M.englishWordsOf('+5').text, 'five');
check('首尾空白被裁掉', M.englishWordsOf('  42  ').text, 'forty-two');
check('省略整数部分的小数（.5）', M.parseNumericInput('.5').canonical, '0.5');
check('结尾小数点（5.）按整数处理', M.parseNumericInput('5.').isInteger, true);
check('小数的前导零保留（0.05）', M.parseNumericInput('0.05').fraction, '05');
check('-0 不读作 minus zero', M.englishWordsOf('-0').text, 'zero');
check('-0.5 仍读作 minus', M.englishWordsOf('-0.5').text, 'minus zero point five');

console.log('--- 浮点陷阱：必须先把值当字符串 ---');
check('朴素 String(0.1 + 0.2) 会多出一串 0', String(0.1 + 0.2), '0.30000000000000004');
check('输入 0.3 读作 zero point three', M.englishWordsOf('0.3').text, 'zero point three');
check(
  '把 0.1+0.2 的结果当输入会读出那一串 0（说明为何不能走浮点）',
  M.englishWordsOf(String(0.1 + 0.2)).text === M.englishWordsOf('0.3').text,
  false,
);
check(
  '0.1+0.2 的结果读出来确实是 17 位小数',
  M.englishWordsOf(String(0.1 + 0.2)).text,
  'zero point three zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero four',
);
check('朴素 String(1e21) 是科学计数法', String(1e21), '1e+21');
check('1e21 被展开成完整十进制串', M.parseNumericInput('1e21').canonical, '1000000000000000000000');
check('1e6 读作 one million', M.englishWordsOf('1e6').text, 'one million');
check('1.5e3 读作 one thousand five hundred', M.englishWordsOf('1.5e3').text, 'one thousand five hundred');
check('1.5e-3 展开为 0.0015', M.parseNumericInput('1.5e-3').canonical, '0.0015');
check('1e21 超出范围时明确报错而不是拼出乱码', M.englishWordsOf('1e21').ok, false);
check('1e21 的报错说明范围', M.englishWordsOf('1e21').error.includes('10^21'), true);
check('1e21 不会退化成 "one e twenty-one"', M.englishWordsOf('1e21').text, '');

console.log('--- 英文基数词：规则要点 ---');
check('1000000 是 one million，不是 one thousand thousand', M.englishWordsOf('1000000').text, 'one million');
check('one million 不含 thousand', M.englishWordsOf('1000000').text.includes('thousand'), false);
check('10^12', M.englishWordsOf('1000000000000').text, 'one trillion');
check('10^18', M.englishWordsOf('1000000000000000000').text, 'one quintillion');
check('10^21-1 仍在范围内', M.englishWordsOf('999999999999999999999').ok, true);
check(
  '10^21-1 读到的最高单位是 quintillion（999 quintillion… 的末段是 999，所以不能用 endsWith）',
  M.englishWordsOf('999999999999999999999').text.includes(' quintillion '),
  true,
);
check('10^21 超出范围', M.englishWordsOf('1000000000000000000000').ok, false);
check('23 连字符', M.englishWordsOf('23').text, 'twenty-three');
check('100 是 one hundred', M.englishWordsOf('100').text, 'one hundred');
check('101 是 one hundred one', M.englishWordsOf('101').text, 'one hundred one');
check('1001 是 one thousand one', M.englishWordsOf('1001').text, 'one thousand one');
check('负数', M.englishWordsOf('-42').text, 'minus forty-two');
check('零', M.englishWordsOf('0').text, 'zero');
check('小数逐位读出', M.englishWordsOf('3.14').text, 'three point one four');
check('小数末尾的零保留（1.50）', M.englishWordsOf('1.50').text, 'one point five zero');

console.log('--- 序数词 ---');
check('1 → first', M.englishOrdinalOf('1').text, 'first');
check('2 → second', M.englishOrdinalOf('2').text, 'second');
check('3 → third', M.englishOrdinalOf('3').text, 'third');
check('4 → fourth', M.englishOrdinalOf('4').text, 'fourth');
check('5 → fifth', M.englishOrdinalOf('5').text, 'fifth');
check('8 → eighth', M.englishOrdinalOf('8').text, 'eighth');
check('9 → ninth', M.englishOrdinalOf('9').text, 'ninth');
check('11 → eleventh', M.englishOrdinalOf('11').text, 'eleventh');
check('12 → twelfth', M.englishOrdinalOf('12').text, 'twelfth');
check('13 → thirteenth', M.englishOrdinalOf('13').text, 'thirteenth');
check('20 → twentieth', M.englishOrdinalOf('20').text, 'twentieth');
check('21 → twenty-first', M.englishOrdinalOf('21').text, 'twenty-first');
check('0 → zeroth', M.englishOrdinalOf('0').text, 'zeroth');
check('100 → one hundredth', M.englishOrdinalOf('100').text, 'one hundredth');
check('101 → one hundred first', M.englishOrdinalOf('101').text, 'one hundred first');
check('1000000 → one millionth', M.englishOrdinalOf('1000000').text, 'one millionth');
check('序数词拒绝小数', M.englishOrdinalOf('1.5').ok, false);
check('序数词拒绝负数', M.englishOrdinalOf('-3').ok, false);
check('数字后缀 1st', M.ordinalSuffix('1'), 'st');
check('数字后缀 2nd', M.ordinalSuffix('2'), 'nd');
check('数字后缀 3rd', M.ordinalSuffix('3'), 'rd');
check('数字后缀 4th', M.ordinalSuffix('4'), 'th');
check('数字后缀 11th（不是 11st）', M.ordinalSuffix('11'), 'th');
check('数字后缀 12th', M.ordinalSuffix('12'), 'th');
check('数字后缀 13th', M.ordinalSuffix('13'), 'th');
check('数字后缀 21st', M.ordinalSuffix('21'), 'st');
check('数字后缀 111th', M.ordinalSuffix('111'), 'th');
check('数字后缀 112th', M.ordinalSuffix('112'), 'th');
check('数字后缀 113th', M.ordinalSuffix('113'), 'th');
check('数字后缀 121st', M.ordinalSuffix('121'), 'st');

console.log('--- 货币读法（支票风格） ---');
check('123.45', M.englishCurrencyOf('123.45').text, 'one hundred twenty-three dollars and 45/100');
check('1 用单数 dollar', M.englishCurrencyOf('1').text, 'one dollar and 00/100');
check('2 用复数 dollars', M.englishCurrencyOf('2').text, 'two dollars and 00/100');
check('0 也要写出单位', M.englishCurrencyOf('0').text, 'zero dollars and 00/100');
check('0.05 补零到两位', M.englishCurrencyOf('0.05').text, 'zero dollars and 05/100');
check('1.5 补成 50/100', M.englishCurrencyOf('1.5').text, 'one dollar and 50/100');
check('1000000.01', M.englishCurrencyOf('1000000.01').text, 'one million dollars and 01/100');
check('负数货币', M.englishCurrencyOf('-1.5').text, 'minus one dollar and 50/100');
check('人民币单位', M.englishCurrencyOf('123.45', 'cny').text, 'one hundred twenty-three yuan and 45/100');
check('英镑单位', M.englishCurrencyOf('1.5', 'gbp').text, 'one pound and 50/100');
check('未知币种回落到默认美元', M.englishCurrencyOf('1', 'nope').text, 'one dollar and 00/100');

{
  // 1.005 is the classic binary-rounding trap: it is really 1.00499999999999989
  // in binary, so the double path truncates instead of rounding up.
  const naiveCents = Math.round(1.005 * 100);
  check('朴素浮点路径把 1.005 截成 100 分（错）', naiveCents, 100);
  check('BigInt 路径把 1.005 正确地进位到 101 分', M.roundToCents('1', '005'), { dollars: 1n, cents: 1n });
  check('1.005 读作 one dollar and 01/100', M.englishCurrencyOf('1.005').text, 'one dollar and 01/100');
  check('1.004 向下舍入', M.englishCurrencyOf('1.004').text, 'one dollar and 00/100');
  check('携带巨大金额仍精确', M.englishCurrencyOf('999999999999999999999.99').ok, true);
}

console.log('--- 中文读法：万 / 亿 分组 ---');
check('0 → 零', M.chineseWordsOf('0').text, '零');
check('10 → 十（口语省略一）', M.chineseWordsOf('10').text, '十');
check('12 → 十二', M.chineseWordsOf('12').text, '十二');
check('20 → 二十', M.chineseWordsOf('20').text, '二十');
check('100 → 一百', M.chineseWordsOf('100').text, '一百');
check('101 → 一百零一', M.chineseWordsOf('101').text, '一百零一');
check('110 → 一百一十（不去掉一十）', M.chineseWordsOf('110').text, '一百一十');
check('123 → 一百二十三', M.chineseWordsOf('123').text, '一百二十三');
check('1000 → 一千', M.chineseWordsOf('1000').text, '一千');
check('1010 → 一千零一十', M.chineseWordsOf('1010').text, '一千零一十');
check('10000 → 一万', M.chineseWordsOf('10000').text, '一万');
check('10001 → 一万零一', M.chineseWordsOf('10001').text, '一万零一');
check('10010 → 一万零一十', M.chineseWordsOf('10010').text, '一万零一十');
check('100000 → 十万（不是一十万）', M.chineseWordsOf('100000').text, '十万');
check('1000000 → 一百万', M.chineseWordsOf('1000000').text, '一百万');
check('10000000 → 一千万', M.chineseWordsOf('10000000').text, '一千万');
check('100000000 → 一亿（不是一万万）', M.chineseWordsOf('100000000').text, '一亿');
check('100000000 不含 万万', M.chineseWordsOf('100000000').text.includes('万万'), false);
check('100000001 → 一亿零一', M.chineseWordsOf('100000001').text, '一亿零一');
check('1000000001 → 十亿零一', M.chineseWordsOf('1000000001').text, '十亿零一');
check('10000000000 → 一百亿', M.chineseWordsOf('10000000000').text, '一百亿');
check('100010000 → 一亿零一万', M.chineseWordsOf('100010000').text, '一亿零一万');
check('123456789 → 一亿二千三百四十五万六千七百八十九', M.chineseWordsOf('123456789').text, '一亿二千三百四十五万六千七百八十九');
check('10^12 → 一兆（四位分组）', M.chineseWordsOf('1000000000000').text, '一兆');
check('10^16 → 一京', M.chineseWordsOf('10000000000000000').text, '一京');
check('10^20 → 一垓', M.chineseWordsOf('100000000000000000000').text, '一垓');
check('负数前缀用“负”', M.chineseWordsOf('-123').text, '负一百二十三');
check('小数用点并逐位读', M.chineseWordsOf('3.14').text, '三点一四');
check('中文也拒绝超范围', M.chineseWordsOf('1e21').ok, false);
check(
  '英文一亿与中文一亿不同（分组差异的证据）',
  [M.englishWordsOf('100000000').text, M.chineseWordsOf('100000000').text].join(' | '),
  'one hundred million | 一亿',
);

console.log('--- 中文金融大写 ---');
check('1234 → 壹仟贰佰叁拾肆', M.chineseWordsOf('1234', true).text, '壹仟贰佰叁拾肆');
check('10 → 壹拾（大写不省略）', M.chineseWordsOf('10', true).text, '壹拾');
check('0 → 零', M.chineseWordsOf('0', true).text, '零');
check('10001 → 壹万零壹', M.chineseWordsOf('10001', true).text, '壹万零壹');
check('100000000 → 壹亿', M.chineseWordsOf('100000000', true).text, '壹亿');
check('1e21 也拒绝', M.chineseWordsOf('1e21', true).ok, false);
check('小数同上但用大写数字', M.chineseWordsOf('3.14', true).text, '叁点壹肆');
check('负数', M.chineseWordsOf('-1234', true).text, '负壹仟贰佰叁拾肆');
check(
  '金融大写逐字符对应',
  M.chineseWordsOf('1234567890', true).text,
  '壹拾贰亿叁仟肆佰伍拾陆万柒仟捌佰玖拾',
);
check(
  '普通与金融只差数字与单位字形',
  [M.integerToChineseWords('1234'), M.integerToChineseWords('1234', true)].join(' / '),
  '一千二百三十四 / 壹仟贰佰叁拾肆',
);

console.log(`--- 与独立实现交叉验证（0…20000 及 ${TRICKY.length - 20001} 个大数） ---`);
{
  let englishMismatch = 0;
  let chineseMismatch = 0;
  let financialMismatch = 0;
  for (const digits of TRICKY) {
    const direct = M.integerToEnglishWords(digits)
      .replace(/^(.*) hundred ([a-z-]+)$/, '$1 hundred $2');
    if (direct !== refEnglish(digits)) {
      if (englishMismatch < 3) {
        console.log(`        英文不一致：${digits}\n          实现 ${direct}\n          参照 ${refEnglish(digits)}`);
      }
      englishMismatch += 1;
    }
    const plain = M.integerToChineseWords(digits);
    if (plain !== refChinese(digits, false)) {
      if (chineseMismatch < 3) {
        console.log(`        中文不一致：${digits}\n          实现 ${plain}\n          参照 ${refChinese(digits, false)}`);
      }
      chineseMismatch += 1;
    }
    const financial = M.integerToChineseWords(digits, true);
    if (financial !== refChinese(digits, true)) {
      if (financialMismatch < 3) {
        console.log(`        大写不一致：${digits}\n          实现 ${financial}\n          参照 ${refChinese(digits, true)}`);
      }
      financialMismatch += 1;
    }
  }
  check(`英文与 BigInt 除法参照实现一致（${TRICKY.length} 个取值）`, englishMismatch, 0);
  check(`中文普通读法与逐位+清理参照实现一致（${TRICKY.length} 个取值）`, chineseMismatch, 0);
  check(`中文金融大写与参照实现一致（${TRICKY.length} 个取值）`, financialMismatch, 0);
}

console.log('--- 解析对象的自洽性 ---');
{
  const samples = ['0', '1', '007', '12.50', '-3', '.5', '5.', '1e3', '1e-3', '0.000', '999999999999999999999'];
  let violations = 0;
  for (const raw of samples) {
    const parsed = M.parseNumericInput(raw);
    if (!parsed.ok) {
      violations += 1;
      continue;
    }
    // canonical must round-trip through BigInt without losing the integer part.
    const integerPart = parsed.canonical.replace('-', '').split('.')[0];
    if (BigInt(integerPart) !== BigInt(parsed.integer)) violations += 1;
    // Integer inputs must format without a "point".
    if (parsed.isInteger && M.englishWordsFor(parsed).text.includes(' point ')) violations += 1;
    if (!parsed.isInteger && !M.englishWordsFor(parsed).text.includes(' point ')) violations += 1;
  }
  check('10 个样本的 canonical / isInteger / 输出形状自洽', violations, 0);

  const parsed = M.parseNumericInput('123.45');
  check('isInteger 对小数', parsed.isInteger, false);
  check('sign 对正数', parsed.sign, 1);
  check('sign 对负数', M.parseNumericInput('-1').sign, -1);
  check('isNegativeValue 对 -0 为假', M.isNegativeValue(M.parseNumericInput('-0')), false);
  check('isNegativeValue 对 -0.5 为真', M.isNegativeValue(M.parseNumericInput('-0.5')), true);
  check('范围常量是 10^21', M.MAX_ABS_EXCLUSIVE, 10n ** 21n);
}

console.log('--- 币种表 ---');
check('币种数量', M.CURRENCIES.length, 4);
check('默认币种', M.DEFAULT_CURRENCY_ID, 'usd');
check('币种 id 唯一', new Set(M.CURRENCIES.map((c) => c.id)).size, M.CURRENCIES.length);
check('每个币种都有单复数与辅币名', M.CURRENCIES.every((c) => c.major && c.majorPlural && c.minor && c.label), true);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
