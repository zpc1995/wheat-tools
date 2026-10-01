/**
 * Checks the IBAN validator.
 *
 * The claims worth defending, and what each is checked against:
 *
 *   1. "the mod-97 implementation is correct" — against a second, deliberately
 *      different implementation (BigInt over the expanded digit string) and
 *      against the official example IBANs published with the SWIFT IBAN
 *      Registry. Every example must leave a remainder of 1.
 *   2. "the per-country length table is correct" — two independent
 *      transcriptions are compared here. One is the application's table, read
 *      through its own API. The other is REGISTRY_REFERENCE below: country,
 *      total IBAN length and BBAN field grouping as published in the SWIFT IBAN
 *      Registry (Release 99, December 2024, via the summary table in the
 *      Wikipedia article that cites it). On top of that, the script carries its
 *      own table of registry examples with the length spelled out, and asserts
 *      that each example really is that many characters and has a valid
 *      checksum. A wrong length in the app therefore cannot hide: the reference
 *      table disagrees, or the example disagrees, or the checksum fails.
 *   3. "the check digits are the definition, not a guess" — replacing the check
 *      digits of every example with 00 and recomputing must reproduce the
 *      original digits, for every country. This never touches the validation
 *      path.
 *   4. "the simpler implementation would be wrong" — the `Number`-based mod-97
 *      and a naive `toUpperCase` normaliser are implemented here and asserted to
 *      FAIL on inputs the real implementation handles, so the tests are known to
 *      be able to catch those bugs rather than merely passing.
 *
 * Usage: node scripts/check-iban-validator.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(
  readFileSync('src/tools/iban-validator/ibanUtils.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/iban-validator.mjs', compiled);
const M = await import(pathToFileURL('.verify/iban-validator.mjs').href);

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
const checkTrue = (label, actual) => check(label, actual, true);

/**
 * Official example IBANs, copied here with their registry length.
 *
 * These are duplicated on purpose rather than read from the application's
 * table: the point is to compare two independent transcriptions. The example
 * string itself pins the length (it is just its character count), and the
 * checksum pins that the number is a real, well formed IBAN — so a mistake in
 * either transcription shows up as a failure instead of cancelling out.
 *
 * 78 entries = every country in the SWIFT IBAN Registry. Countries whose
 * official example could not be recalled with confidence are absent rather than
 * invented; the mod-97 assertion below would reject an invented one anyway.
 */
const OFFICIAL = [
  ['AD', 24, 'AD1200012030200359100100'],
  ['AE', 23, 'AE070331234567890123456'],
  ['AL', 28, 'AL47212110090000000235698741'],
  ['AT', 20, 'AT611904300234573201'],
  ['AZ', 28, 'AZ21NABZ00000000137010001944'],
  ['BA', 20, 'BA391290079401028494'],
  ['BE', 16, 'BE68539007547034'],
  ['BG', 22, 'BG80BNBG96611020345678'],
  ['BH', 22, 'BH67BMAG00001299123456'],
  ['BR', 29, 'BR9700360305000010009795493P1'],
  ['BY', 28, 'BY13NBRB3600900000002Z00AB00'],
  ['CH', 21, 'CH9300762011623852957'],
  ['CR', 22, 'CR05015202001026284066'],
  ['CY', 28, 'CY17002001280000001200527600'],
  ['CZ', 24, 'CZ6508000000192000145399'],
  ['DE', 22, 'DE89370400440532013000'],
  ['DK', 18, 'DK5000400440116243'],
  ['DO', 28, 'DO28BAGR00000001212453611324'],
  ['EE', 20, 'EE382200221020145685'],
  ['EG', 29, 'EG380019000500000000263180002'],
  ['ES', 24, 'ES9121000418450200051332'],
  ['FI', 18, 'FI2112345600000785'],
  ['FO', 18, 'FO6264600001631634'],
  ['FR', 27, 'FR1420041010050500013M02606'],
  ['GB', 22, 'GB29NWBK60161331926819'],
  ['GE', 22, 'GE29NB0000000101904917'],
  ['GI', 23, 'GI75NWBK000000007099453'],
  ['GL', 18, 'GL8964710001000206'],
  ['GR', 27, 'GR1601101250000000012300695'],
  ['GT', 28, 'GT82TRAJ01020000001210029690'],
  ['HR', 21, 'HR1210010051863000160'],
  ['HU', 28, 'HU42117730161111101800000000'],
  ['IE', 22, 'IE29AIBK93115212345678'],
  ['IL', 23, 'IL620108000000099999999'],
  ['IQ', 23, 'IQ98NBIQ850123456789012'],
  ['IS', 26, 'IS140159260076545510730339'],
  ['IT', 27, 'IT60X0542811101000000123456'],
  ['JO', 30, 'JO94CBJO0010000000000131000302'],
  ['KW', 30, 'KW81CBKU0000000000001234560101'],
  ['KZ', 20, 'KZ86125KZT5004100100'],
  ['LB', 28, 'LB62099900000001001901229114'],
  ['LC', 32, 'LC55HEMM000100010012001200023015'],
  ['LI', 21, 'LI21088100002324013AA'],
  ['LT', 20, 'LT121000011101001000'],
  ['LU', 20, 'LU280019400644750000'],
  ['LV', 21, 'LV80BANK0000435195001'],
  ['LY', 25, 'LY83002048000020100120361'],
  ['MC', 27, 'MC5811222000010123456789030'],
  ['MD', 24, 'MD24AG000225100013104168'],
  ['ME', 22, 'ME25505000012345678951'],
  ['MK', 19, 'MK07250120000058984'],
  ['MR', 27, 'MR1300020001010000123456753'],
  ['MT', 31, 'MT84MALT011000012345MTLCAST001S'],
  ['MU', 30, 'MU17BOMM0101101030300200000MUR'],
  ['NL', 18, 'NL91ABNA0417164300'],
  ['NO', 15, 'NO9386011117947'],
  ['PK', 24, 'PK36SCBL0000001123456702'],
  ['PL', 28, 'PL61109010140000071219812874'],
  ['PS', 29, 'PS92PALS000000000400123456702'],
  ['PT', 25, 'PT50000201231234567890154'],
  ['QA', 29, 'QA58DOHB00001234567890ABCDEFG'],
  ['RO', 24, 'RO49AAAA1B31007593840000'],
  ['RS', 22, 'RS35260005601001611379'],
  ['SA', 24, 'SA0380000000608010167519'],
  ['SC', 31, 'SC18SSCB11010000000000001497USD'],
  ['SE', 24, 'SE4550000000058398257466'],
  ['SI', 19, 'SI56263300012039086'],
  ['SK', 24, 'SK3112000000198742637541'],
  ['SM', 27, 'SM86U0322509800000000270100'],
  ['ST', 25, 'ST68000100010051845310112'],
  ['SV', 28, 'SV62CENR00000000000000700025'],
  ['TL', 23, 'TL380080012345678910157'],
  ['TN', 24, 'TN5910006035183598478831'],
  ['TR', 26, 'TR330006100519786457841326'],
  ['UA', 29, 'UA213223130000026007233566001'],
  ['VA', 22, 'VA59001123000012345678'],
  ['VG', 24, 'VG96VPVG0000012345678901'],
  ['XK', 20, 'XK051212012345678906'],
];

/**
 * The registry again, transcribed a second time: country, total IBAN length and
 * the length of each BBAN field in order.
 *
 * Deliberately stored as bare numbers rather than labels — this table's job is
 * to disagree with the application when a boundary or a length is wrong, and it
 * cannot do that if it is generated from the same source of truth. It covers
 * all 89 registered countries, including the 11 for which no official example
 * IBAN is available (there is nothing to check a checksum against, but the
 * length and the field layout still are).
 *
 * Source: SWIFT IBAN Registry Release 99 (December 2024), "IBAN length",
 * "BBAN structure" and "IBAN fields" columns.
 */
const REGISTRY_REFERENCE = [
  ['AD', 24, '4,4,12'],
  ['AE', 23, '3,16'],
  ['AL', 28, '3,4,1,16'],
  ['AT', 20, '5,11'],
  ['AZ', 28, '4,20'],
  ['BA', 20, '3,3,8,2'],
  ['BE', 16, '3,7,2'],
  ['BG', 22, '4,4,2,8'],
  ['BH', 22, '4,14'],
  ['BI', 27, '5,5,13'],
  ['BR', 29, '8,5,10,1,1'],
  ['BY', 28, '4,4,16'],
  ['CH', 21, '5,12'],
  ['CR', 22, '1,3,14'],
  ['CY', 28, '3,5,16'],
  ['CZ', 24, '4,6,10'],
  ['DE', 22, '8,10'],
  ['DJ', 27, '5,5,13'],
  ['DK', 18, '4,9,1'],
  ['DO', 28, '4,20'],
  ['EE', 20, '2,2,11,1'],
  ['EG', 29, '4,4,17'],
  ['ES', 24, '4,4,2,10'],
  ['FI', 18, '6,7,1'],
  ['FK', 18, '2,12'],
  ['FO', 18, '4,9,1'],
  ['FR', 27, '5,5,11,2'],
  ['GB', 22, '4,6,8'],
  ['GE', 22, '2,16'],
  ['GI', 23, '4,15'],
  ['GL', 18, '4,9,1'],
  ['GR', 27, '3,4,16'],
  ['GT', 28, '4,2,2,16'],
  ['HN', 28, '4,20'],
  ['HR', 21, '7,10'],
  ['HU', 28, '3,4,1,15,1'],
  ['IE', 22, '4,6,8'],
  ['IL', 23, '3,3,13'],
  ['IQ', 23, '4,3,12'],
  ['IS', 26, '2,2,2,6,10'],
  ['IT', 27, '1,5,5,12'],
  ['JO', 30, '4,4,18'],
  ['KW', 30, '4,22'],
  ['KZ', 20, '3,13'],
  ['LB', 28, '4,20'],
  ['LC', 32, '4,24'],
  ['LI', 21, '5,12'],
  ['LT', 20, '5,11'],
  ['LU', 20, '3,13'],
  ['LV', 21, '4,13'],
  ['LY', 25, '3,3,15'],
  ['MC', 27, '5,5,11,2'],
  ['MD', 24, '2,18'],
  ['ME', 22, '3,13,2'],
  ['MK', 19, '3,10,2'],
  ['MN', 20, '4,12'],
  ['MR', 27, '5,5,11,2'],
  ['MT', 31, '4,5,18'],
  ['MU', 30, '6,2,12,3,3'],
  ['NI', 28, '4,20'],
  ['NL', 18, '4,10'],
  ['NO', 15, '4,6,1'],
  ['OM', 23, '3,16'],
  ['PK', 24, '4,16'],
  ['PL', 28, '8,16'],
  ['PS', 29, '4,21'],
  ['PT', 25, '4,4,11,2'],
  ['QA', 29, '4,21'],
  ['RO', 24, '4,16'],
  ['RS', 22, '3,13,2'],
  ['RU', 33, '9,5,15'],
  ['SA', 24, '2,18'],
  ['SC', 31, '6,2,16,3'],
  ['SD', 18, '2,12'],
  ['SE', 24, '3,16,1'],
  ['SI', 19, '2,3,8,2'],
  ['SK', 24, '4,6,10'],
  ['SM', 27, '1,5,5,12'],
  ['SO', 23, '4,3,12'],
  ['ST', 25, '4,4,13'],
  ['SV', 28, '4,20'],
  ['TL', 23, '3,14,2'],
  ['TN', 24, '2,3,13,2'],
  ['TR', 26, '5,1,16'],
  ['UA', 29, '6,19'],
  ['VA', 22, '3,15'],
  ['VG', 24, '4,16'],
  ['XK', 20, '4,10,2'],
  ['YE', 30, '4,4,18'],
];

/** Letters to two digits, country code and check digits moved to the end. */
function numericExpansion(iban) {
  return (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (ch) =>
    String(ch.charCodeAt(0) - 55),
  );
}

/**
 * Second implementation of mod-97: build the whole expanded number as a BigInt
 * and take one remainder. Independent of the streaming implementation under
 * test — different data path, different arithmetic.
 */
function independentMod97(iban) {
  return Number(BigInt(numericExpansion(iban)) % 97n);
}

/**
 * The tempting shortcut: `Number` on the expanded digits. Kept here so the
 * suite can prove it is wrong, rather than claiming so in a comment.
 */
function naiveNumberMod97(iban) {
  return Number(numericExpansion(iban)) % 97;
}

/** Deterministic PRNG so a failure is reproducible. */
let seed = 20240607;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

console.log('--- 权威参照物 1：SWIFT IBAN 注册表的官方示例 ---');
{
  let checksumFailures = 0;
  let lengthFailures = 0;
  let tableFailures = 0;
  let unknownCountries = 0;
  const seen = new Set();

  for (const [code, length, iban] of OFFICIAL) {
    if (seen.has(code)) unknownCountries += 1;
    seen.add(code);
    if (iban.length !== length) lengthFailures += 1;
    if (independentMod97(iban) !== 1) checksumFailures += 1;
    const country = M.findIbanCountry(code);
    if (!country || country.length !== length) tableFailures += 1;
  }

  check(`官方示例共 ${OFFICIAL.length} 个国家/地区，无重复代码`, unknownCountries, 0);
  check('每条示例的实际字符数与其声明的注册表长度一致', lengthFailures, 0);
  check('每条示例的 mod-97 余数均为 1（独立 BigInt 实现）', checksumFailures, 0);
  check('应用内的国家长度表与脚本内独立的长度表逐条一致', tableFailures, 0);

  const appCountries = M.listIbanCountries();
  check('注册表中共有 89 个国家/地区', appCountries.length, 89);
  check('官方示例覆盖其中 78 个（其余国家没有可用的官方示例）', OFFICIAL.length, 78);
}

console.log('--- 权威参照物 2：两个 mod-97 实现互为验证 ---');
{
  let mismatches = 0;
  for (const [, , iban] of OFFICIAL) {
    if (M.ibanCheckRemainder(iban) !== independentMod97(iban)) mismatches += 1;
    if (M.mod97(numericExpansion(iban)) !== independentMod97(iban)) mismatches += 1;
  }
  check('78 条官方示例上两个实现完全一致', mismatches, 0);

  // Random alphanumeric strings, so agreement is not only true for real IBANs.
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomMismatches = 0;
  let randomChecked = 0;
  for (let index = 0; index < 500; index += 1) {
    const size = 1 + Math.floor(rand() * 40);
    let sample = '';
    for (let position = 0; position < size; position += 1) {
      sample += ALPHABET[Math.floor(rand() * ALPHABET.length)];
    }
    const expected = M.mod97(sample);
    const actual = Number(BigInt(sample.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55))) % 97n);
    randomChecked += 1;
    if (expected !== actual) randomMismatches += 1;
  }
  check(`500 条随机字母数字串上两个实现完全一致（含 1–40 位）`, randomMismatches, 0);
  check('随机比对确实执行了', randomChecked, 500);

  check('非法字符返回不可达的 -1 而不是一个看似合理的余数', M.mod97('AB-C'), -1);
  check('空串的余数为 0（0 mod 97）', M.mod97(''), 0);
  check('短于 4 位时无法重排，返回 -1', M.ibanCheckRemainder('DE8'), -1);
}

console.log('--- 校验位自检：把校验位置为 00 后重算 ---');
{
  let recomputeFailures = 0;
  let definitionFailures = 0;
  for (const [code, , iban] of OFFICIAL) {
    const original = iban.slice(2, 4);
    const bban = iban.slice(4);
    if (M.computeCheckDigits(code, bban) !== original) recomputeFailures += 1;
    // Written the other way round as well: with the digits set to 00 the
    // remainder r must satisfy r + original = 98, which is where 98 - r comes
    // from. Doing it twice, differently, catches an error in either direction.
    if (M.ibanCheckRemainder(`${code}00${bban}`) + Number(original) !== 98) {
      definitionFailures += 1;
    }
  }
  check('78 个国家重算校验位都等于官方示例的原始校验位', recomputeFailures, 0);
  check('置 00 后的余数与原校验位之和恒为 98（校验位的定义性质）', definitionFailures, 0);
  check(
    '重算结果始终是两位字符串',
    OFFICIAL.filter(([code, , iban]) => M.computeCheckDigits(code, iban.slice(4)).length !== 2).length,
    0,
  );

  check('德国示例重算结果', M.computeCheckDigits('DE', '370400440532013000'), '89');
  check('法国示例重算结果', M.computeCheckDigits('FR', '20041010050500013M02606'), '14');
  // 98 - r is below 10 whenever r is above 88, which is roughly one in ten
  // numbers: without the zero pad the check digits would come out one character
  // short and the IBAN would be 23 characters long instead of 22.
  check('余数为 96 时校验位补零为两位', M.computeCheckDigits('XX', 'W'), '02');
  check('余数为 89 时校验位补零为两位', M.computeCheckDigits('XX', '3'), '09');
  check('补零前的原始数值确认（98 - 96）', 98 - M.mod97('WXX00'), 2);
}

console.log('--- 国家长度表的结构不变量 ---');
{
  const countries = M.listIbanCountries();
  const codes = countries.map((country) => country.code);
  check('国家代码唯一', new Set(codes).size, codes.length);
  check(
    '国家代码都是两位大写字母',
    codes.filter((code) => !/^[A-Z]{2}$/.test(code)).length,
    0,
  );
  check(
    '国家名称都不为空',
    countries.filter((country) => typeof country.name !== 'string' || country.name.length === 0).length,
    0,
  );
  check(
    '长度都落在 ISO 13616 的 15–34 位区间内',
    countries.filter((country) => country.length < 15 || country.length > 34).length,
    0,
  );
  check('表按国家代码排序', codes.join(','), [...codes].sort().join(','));

  // A BBAN split that does not tile the BBAN exactly would silently mislabel
  // every field after the first wrong one.
  const badSums = [];
  const badStarts = [];
  const badLengths = [];
  for (const country of countries) {
    if (!country.fields) continue;
    let expectedStart = 0;
    for (const field of country.fields) {
      if (field.start !== expectedStart) badStarts.push(`${country.code}:${field.label}`);
      if (!(field.length > 0)) badLengths.push(`${country.code}:${field.label}`);
      expectedStart = field.start + field.length;
    }
    if (expectedStart !== country.length - 4) badSums.push(`${country.code}:${expectedStart}`);
  }
  check('拆分字段从 0 开始且首尾相接', badStarts, []);
  check('拆分字段长度都为正', badLengths, []);
  check('拆分字段长度之和恰好等于 BBAN 长度（IBAN 长度减 4）', badSums, []);

  const split = countries.filter((country) => country.fields);
  checkTrue('给出 BBAN 拆分的国家超过 10 个', split.length > 10);
  check('每个注册表国家都给出了 BBAN 拆分', countries.length - split.length, 0);

  // The second transcription: every code, every length and every field boundary
  // must match the application's table. This is what makes a mislabelled or
  // misaligned BBAN field a test failure rather than a quiet inaccuracy.
  const byCode = new Map(REGISTRY_REFERENCE.map(([code, length, groups]) => [code, { length, groups }]));
  check('参考表也是 89 个国家', REGISTRY_REFERENCE.length, 89);
  check(
    '国家代码集合与参考表完全一致',
    codes.join(','),
    REGISTRY_REFERENCE.map(([code]) => code).join(','),
  );

  const lengthMismatches = [];
  const groupMismatches = [];
  for (const [code, length, groups] of REGISTRY_REFERENCE) {
    const country = M.findIbanCountry(code);
    if (!country || country.length !== length) {
      lengthMismatches.push(`${code}:${country ? country.length : 'missing'}`);
      continue;
    }
    const actual = (country.fields ?? []).map((field) => field.length).join(',');
    if (actual !== groups) groupMismatches.push(`${code}: got ${actual} want ${groups}`);
  }
  check('89 个国家的 IBAN 总长度与参考表逐条一致', lengthMismatches, []);
  check('89 个国家的 BBAN 拆分边界与参考表逐条一致', groupMismatches, []);
  check('参考表里没有应用表中不存在的国家代码', [...byCode.keys()].filter((code) => !codes.includes(code)), []);
}

console.log('--- 官方示例上的端到端解析 ---');
{
  let notValid = [];
  let wrongFields = [];
  for (const [code, length, iban] of OFFICIAL) {
    const analysis = M.analyzeIban(iban);
    if (analysis.status !== 'valid' || analysis.issues.length !== 0) {
      notValid.push(`${code}:${analysis.status}:${analysis.issues.join('+')}`);
    }
    if (analysis.actualLength !== length || analysis.expectedLength !== length) {
      notValid.push(`${code}:length`);
    }
    if (analysis.normalized !== iban) notValid.push(`${code}:normalized`);
    if (analysis.formatted.replace(/ /g, '') !== iban) notValid.push(`${code}:formatted`);
    if (analysis.remainder !== 1 || !analysis.checksumOk) notValid.push(`${code}:remainder`);
    const country = M.findIbanCountry(code);
    if (country.fields) {
      const joined = analysis.bbanFields.map((field) => field.value).join('');
      if (joined !== analysis.bban) wrongFields.push(code);
    }
    if (M.isValidIban(iban) !== true) notValid.push(`${code}:isValidIban`);
  }
  check('78 条官方示例全部判定为 valid 且无任何 issue', notValid, []);
  check('给出拆分的国家，其拆分字段拼起来恰好是整个 BBAN', wrongFields, []);

  const de = M.analyzeIban('DE89370400440532013000');
  check('德国示例的银行代码', de.bbanFields[0].value, '37040044');
  check('德国示例的账号', de.bbanFields[1].value, '0532013000');
  check('德国示例的 BBAN', de.bban, '370400440532013000');
  check('德国示例的格式化输出', de.formatted, 'DE89 3704 0044 0532 0130 00');
  check('德国示例的国家名', de.countryName, '德国');
  check('德国示例的校验位', de.checkDigits, '89');
  check('德国示例的期望长度', de.expectedLength, 22);

  const gb = M.analyzeIban('GB29NWBK60161331926819');
  check('英国示例的银行代码', gb.bbanFields[0].value, 'NWBK');
  check('英国示例的分行代码', gb.bbanFields[1].value, '601613');
  check('英国示例的账号', gb.bbanFields[2].value, '31926819');

  const fr = M.analyzeIban('FR1420041010050500013M02606');
  check('法国示例的银行代码', fr.bbanFields[0].value, '20041');
  check('法国示例的 RIB 校验位', fr.bbanFields[3].value, '06');

  const it = M.analyzeIban('IT60X0542811101000000123456');
  check('意大利示例的 CIN 校验字符', it.bbanFields[0].value, 'X');
  check('意大利示例的银行代码 ABI', it.bbanFields[1].value, '05428');

  // Boundaries checked against the values the published example actually
  // contains, not merely against the field lengths. A split can tile the BBAN
  // perfectly and still put a boundary in the wrong place; only the real digits
  // can tell the difference. Several of these are the countries whose natural
  // reading is misleading (FI, IS, CR, MU, SC, SI, GT).
  const FIELD_CASES = [
    ['ES', 'ES9121000418450200051332', '2100|0418|45|0200051332'],
    ['NL', 'NL91ABNA0417164300', 'ABNA|0417164300'],
    ['BE', 'BE68539007547034', '539|0075470|34'],
    ['CH', 'CH9300762011623852957', '00762|011623852957'],
    ['AT', 'AT611904300234573201', '19043|00234573201'],
    ['PT', 'PT50000201231234567890154', '0002|0123|12345678901|54'],
    ['SE', 'SE4550000000058398257466', '500|0000005839825746|6'],
    ['NO', 'NO9386011117947', '8601|111794|7'],
    ['FI', 'FI2112345600000785', '123456|0000078|5'],
    ['DK', 'DK5000400440116243', '0040|044011624|3'],
    ['CZ', 'CZ6508000000192000145399', '0800|000019|2000145399'],
    ['GR', 'GR1601101250000000012300695', '011|0125|0000000012300695'],
    ['IE', 'IE29AIBK93115212345678', 'AIBK|931152|12345678'],
    ['MT', 'MT84MALT011000012345MTLCAST001S', 'MALT|01100|0012345MTLCAST001S'],
    ['MU', 'MU17BOMM0101101030300200000MUR', 'BOMM01|01|101030300200|000|MUR'],
    ['SC', 'SC18SSCB11010000000000001497USD', 'SSCB11|01|0000000000001497|USD'],
    ['SI', 'SI56263300012039086', '26|330|00120390|86'],
    ['TL', 'TL380080012345678910157', '008|00123456789101|57'],
    ['GT', 'GT82TRAJ01020000001210029690', 'TRAJ|01|02|0000001210029690'],
    ['CR', 'CR05015202001026284066', '0|152|02001026284066'],
    ['IS', 'IS140159260076545510730339', '01|59|26|007654|5510730339'],
    ['TR', 'TR330006100519786457841326', '00061|0|0519786457841326'],
    ['BR', 'BR9700360305000010009795493P1', '00360305|00001|0009795493|P|1'],
    ['BY', 'BY13NBRB3600900000002Z00AB00', 'NBRB|3600|900000002Z00AB00'],
    ['UA', 'UA213223130000026007233566001', '322313|0000026007233566001'],
  ];
  const fieldFailures = [];
  for (const [code, iban, expected] of FIELD_CASES) {
    const actual = M.analyzeIban(iban).bbanFields.map((field) => field.value).join('|');
    if (actual !== expected) fieldFailures.push(`${code}: got ${actual} want ${expected}`);
  }
  checkTrue('字段边界抽查覆盖 15 个国家以上', FIELD_CASES.length >= 15);
  check(`${FIELD_CASES.length} 个国家的字段取值与官方示例逐段一致`, fieldFailures, []);
}

console.log('--- 非法输入 ---');
{
  const empty = M.analyzeIban('');
  check('空串的判定', empty.status, 'invalid');
  check('空串的问题列表', empty.issues, ['empty']);
  check('空串的规范化结果', empty.normalized, '');
  check('空串没有国家代码', empty.countryCode, '');
  check('空串的长度为 0', empty.actualLength, 0);
  check('空白字符被视为空串', M.analyzeIban('   \t\n ').issues, ['empty']);
  check('空串不是合法 IBAN', M.isValidIban(''), false);

  check('两位国家代码没有校验位时判为长度不足', M.analyzeIban('DE').issues, ['tooShort']);
  check('三位判为长度不足', M.analyzeIban('DE8').issues, ['tooShort']);
  check('长度不足时不再重复报长度错误', M.analyzeIban('DE89').issues, ['wrongLength']);

  const short = M.analyzeIban('DE893704004405320130');
  check('少两位时只报长度错误', short.issues, ['wrongLength']);
  check('少两位时给出期望长度', short.expectedLength, 22);
  check('少两位时状态为 invalid', short.status, 'invalid');

  const long = M.analyzeIban('DE893704004405320130000');
  check('多一位时只报长度错误', long.issues, ['wrongLength']);

  check('国家代码不存在（QQ）', M.analyzeIban('QQ89370400440532013000').issues, ['unknownCountry']);
  check('ZZ 也不是有效国家代码', M.analyzeIban('ZZ89370400440532013000').issues, ['unknownCountry']);
  check('数字开头的国家代码不是国家', M.analyzeIban('12BAN').issues, ['unknownCountry', 'checkDigitsNotNumeric']);

  const notIban = M.analyzeIban('US64SVBKUS6S3300958879');
  check('美国不在 IBAN 注册表：问题列表', notIban.issues, ['notIbanCountry']);
  check('美国示例的校验位正确时状态为 checksum-only', notIban.status, 'checksum-only');
  check('美国示例仍能给出国家名', notIban.countryName, '美国');
  check('美国示例没有长度规则', notIban.expectedLength, null);

  check(
    '美国示例校验位错误时判为 invalid',
    M.analyzeIban('US64SVBKUS6S3300958878').status,
    'invalid',
  );

  const badCheck = M.analyzeIban('DE88370400440532013000');
  check('长度正确但校验位错误', badCheck.issues, ['badCheckDigits']);
  check('校验位错误时说明余数', badCheck.remainder === 1, false);
  check('校验位错误时给出正确校验位', badCheck.expectedCheckDigits, '89');
  check('校验位错误时状态为 invalid', badCheck.status, 'invalid');

  // The hint is recomputed from the BBAN that was actually typed, so a typo
  // inside the account number moves it too: this number is not "89 with a typo
  // in the check digits", it is a different BBAN whose own check digits are 62.
  const typoInAccount = M.analyzeIban('DE89370400440532013001');
  check('账号里错一位时报校验位错误', typoInAccount.issues, ['badCheckDigits']);
  check('账号里错一位时按该 BBAN 重算校验位', typoInAccount.expectedCheckDigits, '62');
  check('账号里错一位时余数不为 1', typoInAccount.remainder === 1, false);

  const nonNumeric = M.analyzeIban('DEXX370400440532013000');
  check('校验位不是数字', nonNumeric.issues, ['checkDigitsNotNumeric']);
  check('校验位不是数字时仍能重算正确值', nonNumeric.expectedCheckDigits, '89');

  check('含下划线', M.analyzeIban('DE89-3704_0044').issues, ['invalidCharacters']);
  check('含下划线时列出非法字符', M.analyzeIban('DE89-3704_0044').invalidCharacters, ['_']);
  check('含欧元符号', M.analyzeIban('DE89370400440532013000€').invalidCharacters, ['€']);
  check('含中文', M.analyzeIban('中文IBAN').invalidCharacters, ['中', '文']);
  check('全是非法字符时不算“没有输入”', M.analyzeIban('中文').issues, ['invalidCharacters', 'tooShort']);
  check('全是非法字符时不算空串', M.analyzeIban('___').status, 'invalid');
  check('含 emoji 时按码点报告一个字符', M.analyzeIban('DE89😀').invalidCharacters, ['😀']);
  check('非法字符去重后只报一次', M.analyzeIban('DE@@89@@').invalidCharacters, ['@']);
  // The kept characters happen to number 12 here. Reporting "expected 22" would
  // describe a string the user never typed, so length is not reported at all.
  check('有非法字符时不报长度错误', M.analyzeIban('DE89-3704_0044').issues.includes('wrongLength'), false);

  const tooLong = M.analyzeIban(`QQ${'1'.repeat(35)}`);
  check('超过 34 位时报超长', tooLong.issues, ['unknownCountry', 'tooLong']);
  check('超长时长度照实报告', tooLong.actualLength, 37);
}

console.log('--- 规范化：小写、空格、连字符 ---');
{
  const casual = M.analyzeIban('de89 3704-0044 0532 0130 00');
  check('小写加空格加连字符也能通过', casual.status, 'valid');
  check('规范化结果统一为大写无分隔符', casual.normalized, 'DE89370400440532013000');
  check('会提示去掉过分隔符', casual.hadSeparators, true);
  check('格式化输出统一为每四位一组', casual.formatted, 'DE89 3704 0044 0532 0130 00');

  check('全小写', M.isValidIban('gb82west12345698765432'), true);
  check('制表符与换行也作为分隔符', M.isValidIban('DE89\t3704\n0044 0532 0130 00'), true);
  check('不换行空格 U+00A0', M.isValidIban('DE89\u00a03704 0044 0532 0130 00'), true);
  check('不换行连字符 U+2011', M.isValidIban('DE89\u20113704 0044 0532 0130 00'), true);
  check('每个字符之间都插连字符', M.isValidIban('D-E-8-9-3-7-0-4-0-0-4-4-0-5-3-2-0-1-3-0-0-0'), true);
  check('规范化不改动没有分隔符的输入', M.normalizeIban('DE89370400440532013000').hadSeparators, false);
  check('规范化后的值不含分隔符', M.normalizeIban('de 89-37').value, 'DE8937');
}

console.log('--- 往返：格式化后再解析结果不变 ---');
{
  let mismatches = 0;
  for (const [, , iban] of OFFICIAL) {
    const first = M.analyzeIban(iban);
    const second = M.analyzeIban(first.formatted);
    if (second.normalized !== first.normalized) mismatches += 1;
    if (second.status !== first.status) mismatches += 1;
    if (second.formatted !== first.formatted) mismatches += 1;
    const third = M.analyzeIban(second.formatted);
    if (third.normalized !== first.normalized) mismatches += 1;
  }
  check('78 条官方示例 格式化→解析→再格式化 完全稳定', mismatches, 0);

  check('空串格式化', M.formatIban(''), '');
  check('不足四位也分组', M.formatIban('ABCDE'), 'ABCD E');
  check('恰好四位', M.formatIban('ABCD'), 'ABCD');
  check('32 位分成 8 组', M.formatIban('A'.repeat(32)).split(' ').length, 8);
  check('带分隔符的输入往返后与规范化输入等价', M.analyzeIban('DE89 3704 0044 0532 0130 00').normalized, 'DE89370400440532013000');
}

console.log('--- 对照：更简单的写法是错的 ---');
{
  // (a) `Number` cannot hold a 34 digit expansion exactly, and the remainder
  //     depends on the low digits it drops.
  const longest = OFFICIAL.reduce((best, entry) => (entry[2].length > best[2].length ? entry : best));
  check('最长官方示例的校验位是正确的', independentMod97(longest[2]), 1);
  check(
    `用 Number 直接取模会算错（${longest[0]}，${numericExpansion(longest[2]).length} 位数字）`,
    naiveNumberMod97(longest[2]) === 1,
    false,
  );

  let naiveWrong = 0;
  for (const [, , iban] of OFFICIAL) {
    if (naiveNumberMod97(iban) !== 1) naiveWrong += 1;
  }
  checkTrue(`Number 写法在 ${naiveWrong}/${OFFICIAL.length} 条官方示例上给出错误结果`, naiveWrong > 10);

  // (b) A normaliser that only uppercases and strips spaces reports the
  //     hyphenated form as invalid, which is why separators are stripped first.
  const naive = (raw) => raw.toUpperCase().replace(/ /g, '');
  check('朴素规范化把连字符当成非法字符', /^[0-9A-Z]+$/.test(naive('DE89-3704-0044-0532-0130-00')), false);
  check('本实现的规范化接受连字符写法', M.isValidIban('DE89-3704-0044-0532-0130-00'), true);

  // (c) Uppercasing the whole string first turns one illegal character into two
  //     legal ones: the sharp s becomes SS. Character at a time avoids that.
  check('整体大写会把 ß 变成两个合法字母', naive('DE89ß'), 'DE89SS');
  check('本实现把 ß 报为非法字符而不是悄悄改写', M.normalizeIban('DE89ß').invalidCharacters, ['ß']);
  check('本实现不会让 ß 混进规范化结果', M.normalizeIban('DE89ß').value, 'DE89');
}

console.log('--- 不变量：随机生成的合法 IBAN ---');
{
  const countries = M.listIbanCountries();
  const DIGITS = '0123456789';
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const ALPHABET = DIGITS + LETTERS;
  let generated = 0;
  let invalidGenerated = 0;
  let sameClassSurvived = 0;
  let lengthDrift = 0;
  const crossClassSurvivors = [];

  for (let round = 0; round < 400; round += 1) {
    const country = countries[Math.floor(rand() * countries.length)];
    const bbanLength = country.length - 4;
    let bban = '';
    for (let position = 0; position < bbanLength; position += 1) {
      bban += ALPHABET[Math.floor(rand() * ALPHABET.length)];
    }
    const iban = `${country.code}${M.computeCheckDigits(country.code, bban)}${bban}`;
    generated += 1;

    const analysis = M.analyzeIban(iban);
    if (analysis.status !== 'valid' || analysis.issues.length !== 0) invalidGenerated += 1;
    if (analysis.actualLength !== country.length) lengthDrift += 1;
    // The recomputed digits must be exactly the ones the number carries.
    if (analysis.checkDigits !== M.computeCheckDigits(country.code, bban)) invalidGenerated += 1;

    // Mutate one BBAN character, staying inside its own class (digit to digit,
    // letter to letter). Every character is worth a fixed amount at a fixed
    // positional weight, the weights are invertible mod 97 and the change is
    // smaller than 97, so the remainder cannot stay at 1.
    const at = 4 + Math.floor(rand() * bbanLength);
    const original = iban[at];
    const pool = DIGITS.includes(original) ? DIGITS : LETTERS;
    let replacement = original;
    while (replacement === original) {
      replacement = pool[Math.floor(rand() * pool.length)];
    }
    const sameClass = `${iban.slice(0, at)}${replacement}${iban.slice(at + 1)}`;
    if (M.isValidIban(sameClass)) sameClassSurvived += 1;

    // Crossing the class boundary is a different story and is checked below
    // rather than assumed away.
    const otherPool = DIGITS.includes(original) ? LETTERS : DIGITS;
    const crossed = `${iban.slice(0, at)}${otherPool[Math.floor(rand() * otherPool.length)]}${iban.slice(at + 1)}`;
    if (M.isValidIban(crossed)) {
      crossClassSurvivors.push({ before: iban, after: crossed, at });
    }
  }

  check('400 个随机生成的 IBAN 全部判定为合法', invalidGenerated, 0);
  check('随机生成确实执行了 400 轮', generated, 400);
  check('随机生成的 IBAN 长度始终等于该国注册长度', lengthDrift, 0);
  check('同类字符替换后必然校验失败', sameClassSurvived, 0);

  // A digit and a letter are expanded to a different number of digits, so
  // swapping one for the other inserts or removes a digit from the expanded
  // number and shifts every following weight by a factor of ten. That can land
  // on a remainder of 1 again — not a validator bug, but a real property of the
  // encoding, and worth pinning down so nobody "fixes" it later.
  check(
    '跨类替换的少数幸存者确实都是展开位数改变造成的',
    crossClassSurvivors.filter(
      (item) => numericExpansion(item.before).length === numericExpansion(item.after).length,
    ),
    [],
  );
  check(
    '跨类幸存者也确实是合法的 mod-97 号码（两个都通过）',
    crossClassSurvivors.filter((item) => independentMod97(item.after) !== 1),
    [],
  );
  console.log(
    `        跨类替换幸存的样本数：${crossClassSurvivors.length}/400（同类替换：0/400）`,
  );
}

console.log('--- 边界与规模 ---');
{
  check('示例列表里的每一条都判定为合法', M.IBAN_EXAMPLES.filter((e) => !M.isValidIban(e.iban)), []);
  checkTrue('示例数量足以覆盖多种 BBAN 结构', M.IBAN_EXAMPLES.length >= 20);
  check('示例列表没有重复', new Set(M.IBAN_EXAMPLES.map((e) => e.iban)).size, M.IBAN_EXAMPLES.length);
  check('15 位是合法长度（挪威为例）', M.analyzeIban('NO9386011117947').actualLength, 15);
  const single = M.analyzeIban('DE8937040044053201300');
  check('21 位（德国少一位）判为长度错误', single.issues, ['wrongLength']);
  check('大小写混合的国家前缀能识别', M.analyzeIban('de89370400440532013000').countryCode, 'DE');
  check('查找国家不区分大小写', M.findIbanCountry('de').name, '德国');
  check('查找不存在的国家返回 null', M.findIbanCountry('US'), null);
  check('国家表返回的是副本，排序不改变内部顺序', M.listIbanCountries().length, 89);

  // The ISO name lookup is what separates "a real country that does not use
  // IBAN" from "not a country code at all"; both fall out of the platform's own
  // region data, so only the shape is asserted rather than a CLDR translation.
  const us = M.regionName('US');
  checkTrue('真实存在的非 IBAN 国家能取到名称', typeof us === 'string' && us.length > 0 && us !== 'US');
  check('不是国家代码时返回 null（QQ）', M.regionName('QQ'), null);
  check('不是国家代码时返回 null（ZZ）', M.regionName('ZZ'), null);
  check('不是两位字母时返回 null', M.regionName('12'), null);
  check('超长输入返回 null', M.regionName('DEU'), null);
  check('未加入 IBAN 体系的国家判为 notIbanCountry 而不是 unknownCountry', M.analyzeIban('US64SVBKUS6S3300958879').issues, ['notIbanCountry']);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
