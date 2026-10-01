/**
 * Checks the NATO / ICAO spelling alphabet.
 *
 * The claims worth defending:
 *
 *   1. The official spellings are Alfa, Juliett and Xray — not the Alpha,
 *      Juliet and X-ray that people write from memory. The whole 26-word
 *      sequence is compared with the ICAO list written out literally below,
 *      independently of the implementation, and the commonly remembered list is
 *      compared too, to show the difference is real and that this check would
 *      catch it.
 *   2. Digits are the English names (One … Nine); WUN, TREE, FOWER, FIFE and
 *      NINER are ICAO *pronunciation* guides, kept in a separate field so they
 *      cannot be mistaken for spellings.
 *   3. The reading direction is lossless for the alphabet: forward then back
 *      returns the letters, and each official word round-trips through a single
 *      character and back.
 *   4. Characters the alphabet does not cover — Chinese above all — are
 *      reported, never guessed at.
 *
 * References used for the table, consulted rather than copied from memory:
 *   - ICAO, "Alphabet – Radiotelephony" (the official 26-word list, including
 *     the Alfa and Juliett spellings):
 *     https://www.icao.int/Pages/AlphabetRadiotelephony.aspx
 *   - NATO, "NATO phonetic alphabet, codes & signals" (the Xray spelling):
 *     https://www.nato.int/nato_static_fl2014/assets/pdf/pdf_2018_01/20180111_nato-alphabet-sign-signal.pdf
 *   - Wikipedia, "NATO phonetic alphabet", which records the variant spellings
 *     (Alpha, Juliet, X-ray) and the numeral pronunciation guides:
 *     https://en.wikipedia.org/wiki/NATO_phonetic_alphabet
 *
 * Usage: node scripts/check-nato-alphabet.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/nato-alphabet/natoUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/nato-alphabet.mjs', compiled);
const M = await import(pathToFileURL('.verify/nato-alphabet.mjs').href);

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

// Written out from the ICAO list, not derived from the implementation.
const ICAO_ALPHABET =
  'Alfa Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike ' +
  'November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey Xray Yankee Zulu';
const ICAO_WORDS = ICAO_ALPHABET.split(' ');
const ICAO_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

console.log('--- 权威参照物：ICAO 官方 26 词字母表 ---');
check('字母表有 26 个词', M.NATO_LETTERS.length, 26);
check('字符是 A–Z 且顺序正确', M.NATO_LETTERS.map((entry) => entry.char).join(''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
check('逐词等于 ICAO 官方列表', M.NATO_LETTERS.map((entry) => entry.word), ICAO_WORDS);
check('officialAlphabet() 与官方串逐字符一致', M.officialAlphabet(), ICAO_ALPHABET);
check('大写官方串有 26 个词', ICAO_WORDS.length, 26);

const byChar = {};
for (const entry of M.NATO_TABLE) byChar[entry.char] = entry;

check('A 的官方词是 Alfa（f，不是 ph）', byChar.A.word, 'Alfa');
check('Alpha 只作为变体出现', byChar.A.variants, ['Alpha']);
check('J 的官方词是 Juliett（双 t）', byChar.J.word, 'Juliett');
check('Juliet 作为变体出现', byChar.J.variants.includes('Juliet'), true);
check('X 的官方词是 Xray（无连字符）', byChar.X.word, 'Xray');
check('X-ray 作为变体出现', byChar.X.variants.includes('X-ray'), true);
check('W 的官方词是 Whiskey（带 e）', byChar.W.word, 'Whiskey');
check(
  '官方词里没有 Alpha / Juliet / X-ray',
  ['Alpha', 'Juliet', 'X-ray'].filter((word) => ICAO_WORDS.includes(word)),
  [],
);

console.log('\n--- 数字：官方用词与 ICAO 读法分列 ---');
const DIGIT_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const DIGIT_READINGS = ['ZE-RO', 'WUN', 'TOO', 'TREE', 'FOW-ER', 'FIFE', 'SIX', 'SEV-EN', 'AIT', 'NIN-ER'];
check('10 个数字', M.NATO_DIGITS.length, 10);
check('数字字符是 0–9 且顺序正确', M.NATO_DIGITS.map((entry) => entry.char).join(''), '0123456789');
check('数字官方用词是英语名称', M.NATO_DIGITS.map((entry) => entry.word), DIGIT_WORDS);
check('ICAO 读法单列一栏', M.NATO_DIGITS.map((entry) => entry.pronunciation), DIGIT_READINGS);
check('读法没有被当成拼写', M.NATO_DIGITS.filter((entry) => entry.word === 'Wun' || entry.word === 'Tree'), []);
check('1 的官方拼写是 One、读法是 WUN', [byChar['1'].word, byChar['1'].pronunciation], ['One', 'WUN']);
check('9 的官方拼写是 Nine、读法是 NIN-ER', [byChar['9'].word, byChar['9'].pronunciation], ['Nine', 'NIN-ER']);
check('完整表有 36 项', M.NATO_TABLE.length, 36);

console.log('\n--- 文本 → 北约读法 ---');
check('ABC', M.textToNato('ABC').output, 'Alfa Bravo Charlie');
check('小写同样输出官方大写词', M.textToNato('abc').output, 'Alfa Bravo Charlie');
check('数字', M.textToNato('123').output, 'One Two Three');
check('混合字母数字', M.textToNato('W8').output, 'Whiskey Eight');
check('空文本输出空串', M.textToNato('').output, '');
check('mappedCount 统计映射成功的字符', M.textToNato('A中B').mappedCount, 2);
check('words 只含映射成功的词', M.textToNato('A中B').words, ['Alfa', 'Bravo']);
check('自定义分隔符', M.textToNato('AB', { separator: ' | ' }).output, 'Alfa | Bravo');
check('整段文本逐字映射', M.textToNato('SOS').output, 'Sierra Oscar Sierra');
checkSamples(
  '每个字母单独映射到官方词',
  ICAO_CHARS,
  (char) => ({
    actual: M.textToNato(char).output,
    expected: ICAO_WORDS[ICAO_CHARS.indexOf(char)],
  }),
);
checkSamples(
  '每个数字单独映射到英语名称',
  M.NATO_DIGITS.map((entry) => entry.char),
  (char) => ({ actual: M.textToNato(char).output, expected: byChar[char].word }),
);

console.log('\n--- 中文等无法映射的字符：报告，不猜 ---');
check('中文无法映射时原样透传（每个字符是一个单位）', M.textToNato('中文').output, '中 文');
check('中文字符被逐个列出', M.textToNato('中文').unmappedChars, ['中', '文']);
check('中文不产生任何词', M.textToNato('中文').words, []);
check('跳过模式会去掉无法映射的字符', M.textToNato('A中B', { unmapped: 'skip' }).output, 'Alfa Bravo');
check('透传模式保留无法映射的字符', M.textToNato('A中B', { unmapped: 'keep' }).output, 'Alfa 中 Bravo');
check('空白不算“无法映射”', M.textToNato('A B').unmappedChars, []);
check('空白不产生词也不产生空档', M.textToNato('A B').output, 'Alfa Bravo');
check('emoji 无法映射', M.textToNato('😀').unmappedChars, ['😀']);
check('带重音的字母无法映射（é）', M.textToNato('é').unmappedChars, ['é']);
check('德语 ß 不会展开成 SS', M.textToNato('ß').unmappedChars, ['ß']);
check('连字 ﬁ 不会展开成 FI', M.textToNato('ﬁ').unmappedChars, ['ﬁ']);
check('重复出现的无法映射字符只报一次', M.textToNato('中中中').unmappedChars, ['中']);
check('字母表没有任何非 ASCII 字符', M.NATO_TABLE.every((entry) => /^[A-Z0-9]$/.test(entry.char)), true);
check('charToWord 对中文返回 null', M.charToWord('中'), null);
check('charToWord 对 ß 返回 null（大写会变成两个字符）', M.charToWord('ß'), null);
check('charToWord 大小写等价', M.charToWord('a').word, M.charToWord('A').word);

console.log('\n--- 北约读法 → 文本 ---');
check('官方词序列', M.natoToText('Alfa Bravo Charlie').text, 'ABC');
check('大小写不敏感', M.natoToText('aLfA bRaVo').text, 'AB');
check('逗号、换行、多余空白都当分隔符', M.natoToText('  Alfa,  Bravo \n Charlie ').text, 'ABC');
check('数字官方词', M.natoToText('One Two Three').text, '123');
check('完整字母表读回 A–Z', M.natoToText(ICAO_ALPHABET).text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
check('完整数字读回 0–9', M.natoToText(DIGIT_WORDS.join(' ')).text, '0123456789');
check('空输入得到空文本', M.natoToText('').text, '');
check('只有分隔符也得到空文本', M.natoToText(' , ; 、 ').text, '');
check('标点被归一化掉（Alfa! → A）', M.natoToText('Alfa!').text, 'A');
check('常见变体 Alpha → A', M.natoToText('Alpha').text, 'A');
check('常见变体 Juliet → J', M.natoToText('Juliet').text, 'J');
check('常见变体 X-ray → X', M.natoToText('X-ray').text, 'X');
check('常见变体 Whisky → W', M.natoToText('Whisky').text, 'W');
check('两词拼写 X ray → X', M.natoToText('X ray').text, 'X');
check('两词拼写大小写无关 x RAY → X', M.natoToText('x RAY').text, 'X');
check('ICAO 读法 Wun → 1', M.natoToText('Wun').text, '1');
check('ICAO 读法 Tree → 3', M.natoToText('Tree').text, '3');
check('ICAO 读法 Fower → 4', M.natoToText('Fower').text, '4');
check('ICAO 读法 Fife → 5', M.natoToText('Fife').text, '5');
check('ICAO 读法 Niner → 9', M.natoToText('Niner').text, '9');
check('ICAO 读法连读', M.natoToText('Wun Too Tree Fower Fife Niner').text, '123459');
check('已是明文的字母数字原样读回', M.natoToText('A1B2').text, 'A1B2');
check('混用官方词与裸字符', M.natoToText('Alfa 1 Bravo 2').text, 'A1B2');
check('未识别的词保留原文', M.natoToText('Alfa Foo Bravo').text, 'AFooB');
check('未识别的词被列出', M.natoToText('Alfa Foo Bravo').unknown, ['Foo']);
check('未识别的词去重', M.natoToText('Foo Alfa Foo').unknown, ['Foo']);
check('unknown: skip 丢弃未识别的词', M.natoToText('Alfa Foo Bravo', { unknown: 'skip' }).text, 'AB');
check('中文输入被当作未识别词保留', M.natoToText('中文').text, '中文');
check('纯标点词被列为未识别', M.natoToText('Alfa --- Bravo').unknown, ['---']);

console.log('\n--- 匹配类型的标注 ---');
check('官方词标记为 official', M.natoToText('Alfa').items[0].kind, 'official');
check('变体标记为 variant', M.natoToText('Alpha').items[0].kind, 'variant');
check('ICAO 读法标记为 pronunciation', M.natoToText('Wun').items[0].kind, 'pronunciation');
check('两词拼写标记为 multi-word', M.natoToText('X ray').items[0].kind, 'multi-word');
check('裸字符标记为 literal', M.natoToText('A').items[0].kind, 'literal');
check('未识别词标记为 unknown', M.natoToText('Hello').items[0].kind, 'unknown');
check('多词拼写只产生一项（两个词被合并）', M.natoToText('X ray').items.length, 1);
check('多词拼写消耗了两个 token', M.natoToText('X ray Bravo').items.length, 2);
check('lookupWord 对空串返回 null', M.lookupWord(''), null);
check('lookupWord 对未知词返回 null', M.lookupWord('Zebra'), null);
check('lookupWord 找到官方词', M.lookupWord('xray').kind, 'official');
check('normalizeWord 去掉连字符与大小写', M.normalizeWord('X-Ray'), 'xray');
check('normalizeWord 去掉两端空白', M.normalizeWord('  Alfa  '), 'alfa');
check('normalizeWord 对中文得到空串', M.normalizeWord('中文'), '');

console.log('\n--- 往返 ---');
checkSamples('官方词 → 文本 → 官方词，逐个字符一致', M.NATO_TABLE, (entry) => ({
  actual: M.textToNato(M.natoToText(entry.word).text).output,
  expected: entry.word,
}));
checkSamples('文本 → 读法 → 文本，字母数字完全一致', ['ABC', 'HELLO', 'SOS', 'W8', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789', 'A1B2C3'], (sample) => ({
  actual: M.natoToText(M.textToNato(sample).output).text,
  expected: sample,
}));
checkSamples('含无法映射字符时，透传模式往返一致', ['A中B', '中文', 'A😀B', '中'], (sample) => ({
  actual: M.natoToText(M.textToNato(sample, { unmapped: 'keep' }).output).text,
  expected: sample,
}));
check(
  '跳过模式往返会丢掉无法映射的字符（这是选择，不是缺陷）',
  M.natoToText(M.textToNato('A中B', { unmapped: 'skip' }).output).text,
  'AB',
);
check(
  '空白无法通过读法还原（字母表里没有“空格”这个词）',
  M.natoToText(M.textToNato('A B').output).text,
  'AB',
);

console.log('\n--- 映射表的一致性与导出 ---');
{
  // Two characters sharing one spelling would make the reading direction
  // ambiguous: the same sequence of words could mean two different strings.
  const owner = new Map();
  let collisions = 0;
  for (const entry of M.NATO_TABLE) {
    const keys = [entry.word, ...entry.variants, entry.pronunciation]
      .filter(Boolean)
      .map((word) => M.normalizeWord(word));
    for (const key of keys) {
      if (owner.has(key) && owner.get(key) !== entry.char) collisions += 1;
      owner.set(key, entry.char);
    }
  }
  check('没有两个字符共用同一种拼写（反向无歧义）', collisions, 0);
  check('每个字母都有官方词', M.NATO_LETTERS.every((entry) => entry.word.length > 0), true);
  check('字母没有读法栏（读法只针对数字）', M.NATO_LETTERS.every((entry) => !entry.pronunciation), true);
  check('Alfa / Juliett / Xray 都有说明', [byChar.A, byChar.J, byChar.X].every((entry) => Boolean(entry.note)), true);

  const tsv = M.tableToTsv();
  const lines = tsv.split('\n');
  check('TSV 行数为表头 + 36', lines.length, 37);
  check('TSV 表头', lines[0], '字符\tICAO 官方用词\t常见变体\tICAO 读法\t说明');
  check('TSV 第一行是 A / Alfa', lines[1].split('\t').slice(0, 4), ['A', 'Alfa', 'Alpha', '']);
  check('TSV 里的 1 是 One / WUN', lines[28].split('\t').slice(0, 4), ['1', 'One', '', 'WUN']);
}

console.log('\n--- 边界：空、超长、异常输入 ---');
{
  const long = 'ABC123'.repeat(8_000); // 48k 字符
  const spelled = M.textToNato(long);
  check('超长文本每个字符都产生一个词', spelled.words.length, 48_000);
  check('超长文本往返一致', M.natoToText(spelled.output).text, long);
  check('超长文本没有无法映射的字符', spelled.unmappedChars.length, 0);
  check('只有空白的长文本输出为空', M.textToNato(' \n\t '.repeat(1000)).output, '');
  check('重复未识别词不撑爆 unknown 列表', M.natoToText('Foo '.repeat(5000)).unknown, ['Foo']);
  check('只有未识别词时也能返回', M.natoToText('Foo', { unknown: 'skip' }).text, '');
}

console.log('\n--- 反证：凭记忆写的字母表是错的 ---');
{
  // The list people write from memory. It differs in exactly three places, and
  // this is the mistake the tool exists to avoid.
  const remembered = [
    'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India',
    'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo',
    'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu',
  ];
  check('反证：凭记忆的列表与 ICAO 官方列表不一致', remembered.join(' ') === ICAO_ALPHABET, false);
  check(
    '反证：不一致的正是 A、J、X 三个词',
    remembered.filter((word, index) => word !== ICAO_WORDS[index]),
    ['Alpha', 'Juliet', 'X-ray'],
  );
  check('本实现用官方拼写 Alfa', M.NATO_LETTERS[0].word, 'Alfa');
  check('本实现用官方拼写 Juliett', M.NATO_LETTERS[9].word, 'Juliett');
  check('本实现用官方拼写 Xray', M.NATO_LETTERS[23].word, 'Xray');

  // A one-line exact-match lookup: correct-looking, and wrong for every real
  // input, because it is case-sensitive and knows no variants.
  const naiveExact = (word) => {
    const index = ICAO_WORDS.indexOf(word);
    return index >= 0 ? String.fromCharCode(65 + index) : null;
  };
  check('反证：大小写敏感的精确匹配认不出 alfa', naiveExact('alfa'), null);
  check('本实现认得出 alfa', M.natoToText('alfa').text, 'A');
  check('反证：精确匹配认不出变体 Alpha', naiveExact('Alpha'), null);
  check('本实现认得出 Alpha', M.natoToText('Alpha').text, 'A');
  check('反证：精确匹配认不出读法 Wun', naiveExact('Wun'), null);
  check('本实现认得出 Wun', M.natoToText('Wun').text, '1');

  // A parser that maps token by token cannot see a two-word spelling.
  const naiveTokenByToken = (input) => input.split(/\s+/).map(naiveExact);
  check('反证：逐词精确匹配把 “X ray” 拆成两个都认不出的词', naiveTokenByToken('X ray'), [null, null]);
  check('本实现把 “X ray” 读成 X', M.natoToText('X ray').text, 'X');

  // Guessing a reading for Chinese would be inventing data. There is no such
  // mapping, so the only honest outputs are "pass through" and "skip".
  check('反证：为中文“猜”一个词会凭空造数据，本实现产出 0 个词', M.textToNato('中文').words.length, 0);
  check('本实现把中文报告为无法映射', M.textToNato('中文').unmappedChars.length, 2);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
