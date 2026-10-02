/**
 * Checks the phone number parser and formatter.
 *
 * The claims worth defending are:
 *
 *   1. The output is real E.164 — verified against the formal pattern from
 *      ITU-T Recommendation E.164 and against publicly documented numbers:
 *      Ofcom's drama ranges (020 7946 0xxx, 07700 900xxx), the NANP fictional
 *      555-01xx range in the 202 (Washington DC) area code, and the standard
 *      international renderings of Berlin, Paris and Tokyo numbers.
 *   2. Round trips are stable, so no format loses information.
 *   3. The naive normalisations really are wrong: stripping every non-digit
 *      destroys the `+` that marks the country code, and stripping a leading
 *      zero destroys Italy's national numbers, which keep it.
 *   4. Validity is pattern based, not "anything between 10 and 15 digits".
 *
 * Usage: node scripts/check-phone-parser.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(
  readFileSync('src/tools/phone-parser/phoneUtils.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/phone-parser.mjs', compiled);
const M = await import(pathToFileURL('.verify/phone-parser.mjs').href);

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
function checkTrue(label, actual) {
  check(label, actual === true, true);
}

/**
 * Expands a country pattern into one concrete national number that matches it.
 *
 * This is a deliberately tiny regexp reader, not a general one: it only has to
 * handle the constructs the country table uses (`\d`, character classes with
 * ranges, capturing and non-capturing groups, alternation, `{n}` and `{n,m}`).
 * Its job is to prove every rule in the table is *reachable* — a rule whose
 * digit count or template is wrong would otherwise sit there unnoticed.
 *
 * Digits expand to `5` rather than `0` so a generated number cannot accidentally
 * begin with `00` and be read as an international dialling prefix.
 */
function firstAlternative(src) {
  let depth = 0;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '[') {
      i += 1;
      while (i < src.length && src[i] !== ']') {
        if (src[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === '|' && depth === 0) return src.slice(0, i);
  }
  return src;
}

function classRepresentative(body) {
  const inner = body.startsWith('^') ? body.slice(1) : body;
  if (inner.startsWith('\\')) return inner[1] === 'd' ? '5' : inner[1];
  return inner[0] ?? '5';
}

function expandSequence(src) {
  const first = firstAlternative(src);
  let out = '';
  let i = 0;
  while (i < first.length) {
    const ch = first[i];
    let atom = '';
    if (ch === '\\') {
      atom = first[i + 1] === 'd' ? '5' : first[i + 1];
      i += 2;
    } else if (ch === '[') {
      let j = i + 1;
      let body = '';
      while (first[j] !== ']') {
        if (first[j] === '\\') {
          body += first[j + 1];
          j += 2;
        } else {
          body += first[j];
          j += 1;
        }
      }
      atom = classRepresentative(body);
      i = j + 1;
    } else if (ch === '(') {
      let depth = 1;
      let j = i + 1;
      while (j < first.length && depth > 0) {
        const c = first[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '(') depth += 1;
        else if (c === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
        j += 1;
      }
      let inner = first.slice(i + 1, j);
      if (inner.startsWith('?:')) inner = inner.slice(2);
      atom = expandSequence(inner);
      i = j + 1;
    } else {
      atom = ch;
      i += 1;
    }

    const rest = first.slice(i);
    const quantifier = /^\{(\d+)(?:,(\d+))?\}/.exec(rest);
    if (quantifier) {
      atom = atom.repeat(Number(quantifier[1]));
      i += quantifier[0].length;
    } else if (rest.startsWith('?')) {
      i += 1;
    } else if (rest.startsWith('*')) {
      atom = '';
      i += 1;
    } else if (rest.startsWith('+')) {
      i += 1;
    }
    out += atom;
  }
  return out;
}

function sampleForPattern(pattern) {
  return expandSequence(pattern.replace(/^\^/, '').replace(/\$$/, ''));
}

function countCaptures(pattern) {
  let count = 0;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '[') {
      i += 1;
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === '(' && pattern[i + 1] !== '?') count += 1;
  }
  return count;
}

/**
 * Publicly documented reference numbers.
 *
 * `type` is asserted too, because a formatter that gets the digits right but
 * labels a Ofcom drama mobile as a landline is still wrong.
 */
const REFERENCES = [
  {
    label: '中国手机（题目给定示例）',
    input: '+86 138 0013 8000',
    iso: 'CN',
    e164: '+8613800138000',
    international: '+86 138 0013 8000',
    national: '138 0013 8000',
    type: 'mobile',
  },
  {
    label: '美国华盛顿特区（NANP 555-01xx 为保留的虚构号段，202 是特区区号）',
    input: '+1 202 555 0147',
    iso: 'US',
    e164: '+12025550147',
    international: '+1 202 555 0147',
    national: '(202) 555-0147',
    type: 'unknown',
  },
  {
    label: '英国伦敦（Ofcom 保留 020 7946 0xxx 供影视作品使用）',
    input: '+44 20 7946 0958',
    iso: 'GB',
    e164: '+442079460958',
    international: '+44 20 7946 0958',
    national: '020 7946 0958',
    type: 'fixed',
  },
  {
    label: '英国手机（Ofcom 保留 07700 900xxx 供影视作品使用）',
    input: '07700 900123',
    iso: 'GB',
    e164: '+447700900123',
    international: '+44 7700 900123',
    national: '07700 900123',
    type: 'mobile',
  },
  {
    label: '德国柏林',
    input: '+49 30 12345678',
    iso: 'DE',
    e164: '+493012345678',
    international: '+49 30 12345678',
    national: '030 12345678',
    type: 'fixed',
  },
  {
    label: '法国巴黎',
    input: '+33 1 23 45 67 89',
    iso: 'FR',
    e164: '+33123456789',
    international: '+33 1 23 45 67 89',
    national: '01 23 45 67 89',
    type: 'unknown',
  },
  {
    label: '日本东京',
    input: '+81 3 1234 5678',
    iso: 'JP',
    e164: '+81312345678',
    international: '+81 3 1234 5678',
    national: '03 1234 5678',
    type: 'fixed',
  },
  {
    label: '意大利罗马（E.164 中保留国内号码前导 0 的著名例子）',
    input: '+39 06 6982 1234',
    iso: 'IT',
    e164: '+390669821234',
    international: '+39 06 6982 1234',
    national: '06 6982 1234',
    type: 'fixed',
  },
];

console.log('--- 权威参照：公开且稳定的号码及其标准写法 ---');
{
  let problems = 0;
  const messages = [];
  for (const ref of REFERENCES) {
    const r = M.parsePhone(ref.input, { defaultCountry: ref.iso });
    if (!r.ok) {
      problems += 1;
      messages.push(`${ref.label}: ${r.error}`);
      continue;
    }
    const fields = [
      ['国家/地区', r.country.iso, ref.iso],
      ['E.164', r.outputs.e164, ref.e164],
      ['国际格式', r.outputs.international, ref.international],
      ['国内格式', r.outputs.national, ref.national],
      ['号码类型', r.type, ref.type],
    ];
    for (const [field, actual, expected] of fields) {
      if (actual !== expected) {
        problems += 1;
        messages.push(`${ref.label} ${field}: 得到 ${actual}，期望 ${expected}`);
      }
    }
  }
  check(`${REFERENCES.length} 个参照号码的国家、E.164、国际/国内格式、类型全部一致`, problems, 0);
  if (messages.length) console.log(messages.join('\n'));
}

console.log('--- E.164 形式约束（ITU-T E.164：最多 15 位） ---');
check('E164_PATTERN 接受 15 位上限内的正式形式', M.E164_PATTERN.test('+123456789012345'), true);
check('E164_PATTERN 拒绝 16 位', M.E164_PATTERN.test('+1234567890123456'), false);
check('E164_PATTERN 拒绝前导 0 的国家码', M.E164_PATTERN.test('+0123456789'), false);
check('E164_PATTERN 要求加号', M.E164_PATTERN.test('8613800138000'), false);
check('E164_PATTERN 拒绝空串', M.E164_PATTERN.test(''), false);
check('E.164 长度上限常量', M.MAX_E164_DIGITS, 15);
{
  const samples = M.COUNTRIES.flatMap((country) => country.samples);
  let violations = 0;
  for (const sample of samples) {
    const r = M.parsePhone(sample);
    if (!r.ok || !M.E164_PATTERN.test(r.outputs.e164)) violations += 1;
    if (r.ok && r.outputs.e164.slice(1).length > M.MAX_E164_DIGITS) violations += 1;
  }
  check(
    `已收录的全部 ${samples.length} 个样本输出的 E.164 都满足 ^\\+[1-9]\\d{1,14}$ 且不超过 15 位`,
    violations,
    0,
  );
}

console.log('--- 往返一致：任一格式 → 解析 → 再格式化 ---');
{
  const cases = REFERENCES.map((ref) => [ref.input, ref.iso]);
  for (const country of M.COUNTRIES) {
    for (const sample of country.samples) cases.push([sample, country.iso]);
  }

  let violations = 0;
  const messages = [];
  for (const [input, iso] of cases) {
    const r = M.parsePhone(input, { defaultCountry: iso });
    if (!r.ok) {
      violations += 1;
      messages.push(`${input}: ${r.error}`);
      continue;
    }
    const forms = [
      ['E.164', r.outputs.e164],
      ['国际格式', r.outputs.international],
      ['国内格式', r.outputs.national],
      ['tel URI', r.outputs.telUri],
    ];
    for (const [name, form] of forms) {
      const again = M.parsePhone(form, { defaultCountry: r.country.iso });
      if (!again.ok) {
        violations += 1;
        messages.push(`${input} 的${name} ${form} 无法再解析：${again.error}`);
      } else if (again.outputs.e164 !== r.outputs.e164) {
        violations += 1;
        messages.push(`${input} 的${name} ${form} 往返后变成 ${again.outputs.e164}`);
      }
    }
    if (r.outputs.digits !== r.outputs.e164.slice(1)) {
      violations += 1;
      messages.push(`${input} 的纯数字形式与 E.164 不一致`);
    }
  }
  check(`${cases.length} 个号码 × 4 种输出形式全部往返一致`, violations, 0);
  if (messages.length) console.log(messages.slice(0, 40).join('\n'));
}

console.log('--- 反证：朴素实现会在哪里出错 ---');
{
  /** The tempting "just keep the digits" normalisation. */
  function naiveStrip(input) {
    return input.replace(/[^0-9]/g, '');
  }

  const international = '+44 20 7946 0958';
  const naiveDigits = naiveStrip(international);
  check('朴素去掉所有非数字后的结果', naiveDigits, '442079460958');
  check(
    '该纯数字串已无法作为国内号码解析（默认英国）——"+" 承载的信息被丢掉了',
    M.parsePhone(naiveDigits, { defaultCountry: 'GB' }).ok,
    false,
  );
  check(
    '该纯数字串按默认中国解析同样失败',
    M.parsePhone(naiveDigits, { defaultCountry: 'CN' }).ok,
    false,
  );
  check('本实现保留 "+" 并给出正确 E.164', M.parsePhone(international).outputs.e164, '+442079460958');
  check('00 与 "+" 等价', M.parsePhone('0044 20 7946 0958').outputs.e164, '+442079460958');
  check(
    '朴素去掉非数字对 +86 输入同样致命',
    M.parsePhone(naiveStrip('+86 138 0013 8000'), { defaultCountry: 'CN' }).ok,
    false,
  );

  const rome = M.parsePhone('+39 06 6982 1234');
  check('意大利国内有效号码原样保留前导 0', rome.nationalNumber, '0669821234');
  checkTrue('意大利国内有效号码以 0 开头', rome.nationalNumber.startsWith('0'));
  const zeroLess = rome.nationalNumber.replace(/^0+/, '');
  check('朴素去掉前导 0 后在国内格式下已不合法', M.parsePhone(zeroLess, { defaultCountry: 'IT' }).ok, false);
  check('朴素拼出的 +39669821234 也不合法', M.parsePhone('+39669821234').ok, false);

  const london = M.parsePhone('020 7946 0958', { defaultCountry: 'GB' });
  check('对照：英国的长途冠码 0 会被剥离并记录', london.trunkPrefixStripped, '0');
  check('对照：剥离后 E.164 不含多余的 0', london.outputs.e164, '+442079460958');
  const moscow = M.parsePhone('8 912 345 67 89', { defaultCountry: 'RU' });
  check('俄罗斯的长途冠码 8 同样被剥离', moscow.trunkPrefixStripped, '8');
  check('剥离后的俄罗斯 E.164', moscow.outputs.e164, '+79123456789');
}

console.log('--- 长度校验：不是"10 到 15 位都收" ---');
check('中国手机 11 位有效', M.parsePhone('+8613800138000').ok, true);
check('中国 12 位号码无效', M.parsePhone('+86138001380001').ok, false);
check('中国 13 位号码无效', M.parsePhone('+8612345678901').ok, false);
check('中国手机长度集合', M.findCountryByIso('CN').lengths, [5, 10, 11]);
check('英国长度集合含 7 / 9 / 10 三种', M.findCountryByIso('GB').lengths, [7, 9, 10]);
check('美国 10 位有效', M.parsePhone('+12025550147').ok, true);
check('美国 9 位无效', M.parsePhone('+1202555014').ok, false);
check('美国 11 位（去掉国家码后超过 10 位）无效', M.parsePhone('+120255501471').ok, false);
check('英国 10 位有效', M.parsePhone('+442079460958').ok, true);
check('英国 11 位无效', M.parsePhone('+4420794609581').ok, false);
check('中国座机 10 位有效（北京）', M.parsePhone('+861012345678').ok, true);
check('中国座机 11 位有效（三位区号 + 8 位本地号）', M.parsePhone('+8631112345678').ok, true);
check('长度不符时错误信息包含"长度"', M.parsePhone('+86138001380001').error.includes('长度'), true);

console.log('--- 边界输入 ---');
check('空串', M.parsePhone('').ok, false);
check('只有空格', M.parsePhone('   ').ok, false);
check('纯字母', M.parsePhone('abcdef').ok, false);
check('只有一个加号', M.parsePhone('+').ok, false);
check('加号加 0（非法国家码）', M.parsePhone('+0123456789').ok, false);
check('只有 00', M.parsePhone('00').ok, false);
check('两个加号', M.parsePhone('++8613800138000').ok, false);
check('加号不在开头', M.parsePhone('86+13800138000').ok, false);
check('含非法字符（星号）', M.parsePhone('13800138000*12').ok, false);
check('只有国家码', M.parsePhone('+86').ok, false);
check('国际前缀后没有数字', M.parsePhone('+  ').ok, false);
check('连续分隔符不影响解析', M.parsePhone('138--0013--8000').outputs.e164, '+8613800138000');
check('括号与点号也能解析', M.parsePhone('(202) 555.0147', { defaultCountry: 'US' }).outputs.e164, '+12025550147');
check('超过 15 位总数的输入被拒', M.parsePhone(`+86${'1'.repeat(15)}`).ok, false);
checkTrue('超长提示里说明了 15 位上限', M.parsePhone(`+86${'1'.repeat(15)}`).error.includes('15'));
check('国内格式带长途冠码（中国）', M.parsePhone('013800138000', { defaultCountry: 'CN' }).outputs.e164, '+8613800138000');
check('国内格式不带长途冠码（中国）', M.parsePhone('13800138000', { defaultCountry: 'CN' }).outputs.e164, '+8613800138000');
check('默认国家不在收录范围时报错', M.parsePhone('13800138000', { defaultCountry: 'ZZ' }).ok, false);
check('未收录国家码 +998 被拒', M.parsePhone('+998901234567').ok, false);
checkTrue('未收录提示明确写出"未收录"', M.parsePhone('+998901234567').error.includes('未收录'));
check('未收录国家码 +995 被拒', M.parsePhone('+995555123456').ok, false);
check('未收录国家码 +380 被拒', M.parsePhone('+380441234567').ok, false);

console.log('--- 分机号 ---');
{
  const cases = [
    ['+86 138 0013 8000 ext. 123', '13800138000', '123'],
    ['+86 138 0013 8000x123', '13800138000', '123'],
    ['+86 138 0013 8000 x 123', '13800138000', '123'],
    ['+86 138 0013 8000 转 888', '13800138000', '888'],
    ['+86 138 0013 8000 分机：12', '13800138000', '12'],
    ['tel:+86-138-0013-8000;ext=99', '13800138000', '99'],
    ['+1 202 555 0147 ext 4001', '2025550147', '4001'],
  ];
  let problems = 0;
  const messages = [];
  for (const [input, nsn, extension] of cases) {
    const r = M.parsePhone(input);
    if (!r.ok) {
      problems += 1;
      messages.push(`${input}: ${r.error}`);
      continue;
    }
    if (r.nationalNumber !== nsn) {
      problems += 1;
      messages.push(`${input}: 国内有效号码 ${r.nationalNumber}，期望 ${nsn}`);
    }
    if (r.extension !== extension) {
      problems += 1;
      messages.push(`${input}: 分机号 ${r.extension}，期望 ${extension}`);
    }
  }
  check(`${cases.length} 种分机号写法（ext / x / 转 / 分机 / ;ext=）全部识别正确`, problems, 0);
  if (messages.length) console.log(messages.join('\n'));

  const withExt = M.parsePhone('+86 138 0013 8000 ext. 123');
  check('分机号写进 tel URI', withExt.outputs.telUri, 'tel:+86-138-0013-8000;ext=123');
  check('分机号写进国际格式', withExt.outputs.international, '+86 138 0013 8000 ext. 123');
  check('分机号写进国内格式', withExt.outputs.national, '138 0013 8000 ext. 123');
  check('E.164 不含分机号', withExt.outputs.e164, '+8613800138000');
  check('只有分机号时会被拒绝', M.parsePhone('x123').ok, false);
  check('分机标记后没有数字时按非法字符处理', M.parsePhone('13800138000 x').ok, false);
}

console.log('--- 号码类型：只在有公开依据时才给结论 ---');
check('丹麦 8 位号码不区分手机与固话', M.parsePhone('+4532123456').type, 'unknown');
check('NANP 手机与固话在号码上不可区分', M.parsePhone('+12025550147').type, 'unknown');
check('NANP 免费号可以判定', M.parsePhone('+18005550147').type, 'tollFree');
check('NANP 900 付费号判为服务号', M.parsePhone('+19005550147').type, 'service');
check('墨西哥 10 位号码不给手机/固话结论', M.parsePhone('+525512345678').type, 'unknown');
check('印度 080 号段与手机号段重叠时不给结论', M.parsePhone('+918012345678').type, 'unknown');
check('印度 98765 开头的 10 位号码判为手机', M.parsePhone('+919876543210').type, 'mobile');
check('中国手机号段判定', M.parsePhone('+8613800138000').type, 'mobile');
check('中国 800 判为免费号', M.parsePhone('+868001234567').type, 'tollFree');
check('中国 400 判为服务号', M.parsePhone('+864001234567').type, 'service');
check('中国 10086 判为服务号', M.parsePhone('+8610086').type, 'service');
check('英国 07700 900123 判为手机', M.parsePhone('+447700900123').type, 'mobile');
check('英国 020 判为固话', M.parsePhone('+442079460958').type, 'fixed');
check('意大利前导 0 号码判为固话', M.parsePhone('+390669821234').type, 'fixed');
{
  const typed = M.COUNTRIES.flatMap((country) =>
    country.formats.filter((r) => r.type).map((r) => [country.iso, r]),
  );
  const withoutBasis = typed.filter(([, r]) => !r.basis || r.basis.length < 6);
  check(`全部 ${typed.length} 条带类型结论的规则都写明了依据`, withoutBasis.length, 0);
  const unknownCountries = M.COUNTRIES.filter((country) =>
    country.formats.some((r) => !r.type),
  );
  checkTrue(
    `有 ${unknownCountries.length} 个国家/地区保留了至少一种"不做类型判断"的号码形态`,
    unknownCountries.length >= 5,
  );
  checkTrue('丹麦在无类型结论的名单中', unknownCountries.some((c) => c.iso === 'DK'));
}

console.log('--- 结构一致性：模式、长度集合、模板占位符 ---');
{
  let problems = 0;
  const messages = [];
  const seenIso = new Set();

  for (const country of M.COUNTRIES) {
    if (seenIso.has(country.iso)) {
      problems += 1;
      messages.push(`重复的 ISO 代码 ${country.iso}`);
    }
    seenIso.add(country.iso);

    const declared = [...country.lengths].sort((a, b) => a - b);
    const fromSamples = [
      ...new Set(
        country.samples.map((sample) => {
          const r = M.parsePhone(sample, { defaultCountry: country.iso });
          return r.ok ? r.nationalNumber.length : -1;
        }),
      ),
    ].sort((a, b) => a - b);
    if (JSON.stringify(declared) !== JSON.stringify(fromSamples)) {
      problems += 1;
      messages.push(`${country.iso}: lengths ${declared} 与样本覆盖的长度 ${fromSamples} 不一致`);
    }

    for (const sample of country.samples) {
      const r = M.parsePhone(sample, { defaultCountry: country.iso });
      if (!r.ok) {
        problems += 1;
        messages.push(`${country.iso}: 样本 ${sample} 解析失败 ${r.error}`);
      } else if (r.country.iso !== country.iso) {
        problems += 1;
        messages.push(`${country.iso}: 样本 ${sample} 落到了 ${r.country.iso}`);
      }
    }

    for (const r of country.formats) {
      if (!r.pattern.startsWith('^') || !r.pattern.endsWith('$')) {
        problems += 1;
        messages.push(`${country.iso}: 模式未两端锚定 ${r.pattern}`);
      }
      if (r.type && !r.basis) {
        problems += 1;
        messages.push(`${country.iso}: ${r.pattern} 声明类型却没写依据`);
      }
      const captures = countCaptures(r.pattern);
      for (const [name, template] of [['intl', r.intl], ['national', r.national]]) {
        const used = [...template.matchAll(/\$(\d)/g)].map((m) => Number(m[1]));
        if (used.length !== captures) {
          problems += 1;
          messages.push(
            `${country.iso}: ${name} 模板 ${template} 有 ${used.length} 个占位符，模式有 ${captures} 个捕获组`,
          );
        }
      }

      const probe = sampleForPattern(r.pattern);
      const parsed = M.parsePhone(probe, { defaultCountry: country.iso });
      if (!parsed.ok) {
        problems += 1;
        messages.push(`${country.iso}: 模式 ${r.pattern} 生成的探针 ${probe} 无法解析：${parsed.error}`);
      } else if (!country.lengths.includes(parsed.nationalNumber.length)) {
        problems += 1;
        messages.push(
          `${country.iso}: 探针 ${probe} 长度 ${parsed.nationalNumber.length} 不在 lengths ${country.lengths} 中`,
        );
      }
    }
  }

  check(`全部 ${M.COUNTRIES.length} 个收录国家/地区的模式、长度集合与模板自洽`, problems, 0);
  if (messages.length) console.log(messages.slice(0, 40).join('\n'));
}

console.log('--- 共用国家码（+1 / +7） ---');
{
  const us = M.parsePhone('+12025550147');
  check('+1 标记为共用国家码', us.ambiguous, true);
  check('+1 的候选国家', us.candidates.map((c) => c.iso), ['US', 'CA']);
  checkTrue('+1 给出共用说明', typeof us.sharedNote === 'string' && us.sharedNote.includes('共用'));
  check('+1 默认落到美国（202 为华盛顿特区区号）', us.country.iso, 'US');
  check('显式指定加拿大时落到加拿大', M.parsePhone('+1 416 555 0147', { defaultCountry: 'CA' }).country.iso, 'CA');

  const kz = M.parsePhone('+77071234567');
  check('+7 哈萨克斯坦手机（7xx）落到哈萨克斯坦', kz.country.iso, 'KZ');
  check('+7 的候选国家', kz.candidates.map((c) => c.iso), ['RU', 'KZ']);
  check('+7 也标记为共用国家码', kz.ambiguous, true);
  check('+7 俄罗斯手机（9xx）落到俄罗斯', M.parsePhone('+79123456789').country.iso, 'RU');
  check('不共用的国家码不带共用说明', M.parsePhone('+8613800138000').sharedNote, null);
}

console.log('--- 批量模式 ---');
{
  const batchText = [
    '+86 138 0013 8000',
    '',
    '020 7946 0958',
    '+1 202 555 0147',
    'not a phone',
    '+998 90 123 4567',
    '+39 06 6982 1234',
  ].join('\n');

  const rows = M.parseBatch(batchText, { defaultCountry: 'GB' });
  check('空行被跳过且保留原始行号', rows.map((row) => row.line), [1, 3, 4, 5, 6, 7]);
  check('批量统计', M.summariseBatch(rows), { total: 6, ok: 4, failed: 2 });
  check('失败的行号', rows.filter((row) => !row.result.ok).map((row) => row.line), [5, 6]);
  checkTrue('未收录国家码在批量结果里也写明"未收录"', rows[4].result.error.includes('未收录'));

  const tsv = M.batchToTsv(rows);
  check('TSV 行数（表头 + 数据行）', tsv.split('\n').length, 7);
  check(
    'TSV 表头',
    tsv.split('\n')[0],
    '行号\t输入\t状态\t国家/地区\tE.164\t国际格式\t国内格式\t类型\t说明',
  );
  check('TSV 成功行的 E.164 列', tsv.split('\n')[1].split('\t')[4], '+8613800138000');
  check('TSV 失败行的状态列', tsv.split('\n')[5].split('\t')[2], '失败');
  check('空文本得到空结果', M.parseBatch('').length, 0);
}

console.log('--- 便捷 API 与界面示例 ---');
{
  let problems = 0;
  for (const sample of M.SAMPLE_NUMBERS) {
    const r = M.parsePhone(sample, { defaultCountry: 'GB' });
    if (!r.ok) {
      problems += 1;
      console.log(`        示例 ${sample} 解析失败：${r.error}`);
    }
  }
  check(`界面上 ${M.SAMPLE_NUMBERS.length} 个一键示例都能解析`, problems, 0);
  check('toE164 便捷函数', M.toE164('+86 138 0013 8000'), '+8613800138000');
  check('toE164 对非法输入返回 null', M.toE164('nope'), null);
  check('toE164 尊重默认国家', M.toE164('020 7946 0958', { defaultCountry: 'GB' }), '+442079460958');
}

console.log('--- 覆盖范围 ---');
check('收录国家/地区数量', M.COUNTRIES.length, 39);
checkTrue(
  '题目点名的国家全部收录',
  ['CN', 'US', 'GB', 'DE', 'FR', 'JP', 'IT'].every((iso) => Boolean(M.findCountryByIso(iso))),
);
check('复用国家码的查询（+1）', M.countriesForCallingCode('1').map((c) => c.iso), ['US', 'CA']);
check('复用国家码的查询（+7）', M.countriesForCallingCode('7').map((c) => c.iso), ['RU', 'KZ']);
check('未收录的国家码不返回任何国家', M.findCallingCodeMatch('998901234567'), null);
checkTrue(
  '国家码按最长前缀匹配：+886 不会被 +88 之类的短码抢走',
  M.parsePhone('+886912345678').country.iso === 'TW',
);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
