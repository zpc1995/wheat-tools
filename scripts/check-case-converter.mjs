/**
 * Checks the case converter.
 *
 * The claim worth defending is "the words are split by meaning, not by a
 * character-class substitution". Four independent references are used, because
 * a tokeniser that is only compared against itself proves nothing:
 *
 *   1. A second tokeniser written in a different style — marker insertion with
 *      regular expressions and lookarounds, the way the popular case libraries
 *      do it — instead of the implementation's index-and-table loop. It shares
 *      no code with the implementation.
 *   2. `Intl.Segmenter` with grapheme granularity (ICU). Every token must be a
 *      whole number of grapheme clusters, and a single-cluster emoji must come
 *      out as exactly one word. This is what catches a broken emoji sequence or
 *      a combining accent being cut in half.
 *   3. `Intl.Segmenter` with word granularity (ICU) on plain English text,
 *      which must produce the same list of words for inputs where the two
 *      definitions of "word" coincide.
 *   4. Real identifiers scraped out of this repository, with the expected
 *      snake_case derived from the naming convention itself rather than from
 *      the implementation:
 *        - `useSidebar` is snake_case `use_sidebar` because camelCase inserts a
 *          capital at each word start, so inserting `_` before each capital and
 *          lowercasing is the definition, not a guess.
 *        - `MAX_LAPS` is `max_laps` because SCREAMING_SNAKE_CASE is snake_case
 *          in capitals, so lowercasing it is the definition.
 *
 * Round-trip and idempotence are checked exhaustively over every style and a
 * mixed corpus. One limitation is proven rather than hidden: for camelCase and
 * PascalCase the round trip is *impossible* in general, because two different
 * word sequences map to the same string. The check asserts that proof and then
 * requires that every round-trip or idempotence failure is explained by it.
 *
 * Usage: node scripts/check-case-converter.mjs
 */
import { globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/case-converter/caseUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/case-converter.mjs', compiled);
const M = await import(pathToFileURL('.verify/case-converter.mjs').href);

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

/** Asserts a list of collected failures is empty, showing the first few. */
function checkNoFailures(label, failures, total) {
  check(`${label}（${total} 个用例）`, failures.slice(0, 3), []);
}

const words = (text) => M.tokenize(text).tokens.map((token) => token.text);
const lowered = (list) => list.map((word) => word.toLowerCase());
const sameWords = (a, b) => JSON.stringify(lowered(a)) === JSON.stringify(lowered(b));

/* ------------------------------------------------------------------ *
 * Reference 1: tokeniser by regular-expression marker insertion.
 *
 * A NUL character is inserted at every internal boundary; separators are then
 * replaced by NUL as well, and the string is split on NUL. NUL can never occur
 * inside a matched group (no class contains it), so it cannot corrupt a later
 * rule. Combining marks are made transparent by allowing them after the
 * character each rule looks at.
 * ------------------------------------------------------------------ */
const NUL = '\u0000';
// Glue: combining marks plus the joiners that hold emoji sequences together.
const GLUE_IN_CLASS = String.raw`\p{M}\u200D\u{E0020}-\u{E007F}`;
const MARK_RUN = String.raw`(?:\p{M}|\u200D|[\u{E0020}-\u{E007F}])*`;
const EMOJI_IN_CLASS = String.raw`\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}`;
const EMOJI_SRC = `[${EMOJI_IN_CLASS}]`;
const SEP_SRC = String.raw`[^\p{L}\p{N}` + GLUE_IN_CLASS + EMOJI_IN_CLASS + ']';
const SEP_RE = new RegExp(SEP_SRC, 'gu');
const SEP_TEST = new RegExp(`^${SEP_SRC}$`, 'u');

const REF_RULES = [
  // lower-case or uncased letter, or a digit, followed by a capital.
  [
    new RegExp(`([\\p{Ll}\\p{Lo}\\p{Lm}\\p{N}]${MARK_RUN})([\\p{Lu}\\p{Lt}])`, 'gu'),
    `$1${NUL}$2`,
  ],
  // the capital that ends an acronym run starts the next word.
  [
    new RegExp(`([\\p{Lu}\\p{Lt}]${MARK_RUN})([\\p{Lu}\\p{Lt}]${MARK_RUN}\\p{Ll})`, 'gu'),
    `$1${NUL}$2`,
  ],
  // letter and digit never share a word.
  [new RegExp(`([\\p{L}]${MARK_RUN})(\\p{N})`, 'gu'), `$1${NUL}$2`],
  [new RegExp(`(\\p{N}${MARK_RUN})([\\p{L}])`, 'gu'), `$1${NUL}$2`],
  // cased letters and uncased letters are different words.
  [
    new RegExp(`([\\p{Lu}\\p{Ll}\\p{Lt}\\p{N}]${MARK_RUN})([\\p{Lo}\\p{Lm}])`, 'gu'),
    `$1${NUL}$2`,
  ],
  [
    new RegExp(`([\\p{Lo}\\p{Lm}]${MARK_RUN})([\\p{Lu}\\p{Ll}\\p{Lt}\\p{N}])`, 'gu'),
    `$1${NUL}$2`,
  ],
  // emoji sequences are words of their own.
  [new RegExp(`([\\p{L}\\p{N}]${MARK_RUN})(${EMOJI_SRC})`, 'gu'), `$1${NUL}$2`],
  [new RegExp(`(${EMOJI_SRC}${MARK_RUN})([\\p{L}\\p{N}])`, 'gu'), `$1${NUL}$2`],
];

function referenceTokenize(input) {
  let marked = input;
  for (const [pattern, replacement] of REF_RULES) marked = marked.replace(pattern, replacement);
  marked = marked.replace(SEP_RE, NUL);

  const tokens = marked.split(NUL).filter((piece) => piece !== '');
  if (tokens.length === 0) return { tokens: [], leading: input, trailing: '' };

  const first = input.indexOf(tokens[0]);
  const lastToken = tokens[tokens.length - 1];
  const last = input.lastIndexOf(lastToken);
  return {
    tokens,
    leading: input.slice(0, first),
    trailing: input.slice(last + lastToken.length),
  };
}

/* ------------------------------------------------------------------ *
 * Reference 2: grapheme-cluster alignment via ICU.
 * ------------------------------------------------------------------ */
const GRAPHEME = new Intl.Segmenter('en', { granularity: 'grapheme' });
const WORD_SEG = new Intl.Segmenter('en', { granularity: 'word' });

const graphemes = (text) => [...GRAPHEME.segment(text)].map((part) => part.segment);

/**
 * Whether `tokens` can be produced without ever cutting a grapheme cluster.
 *
 * Clusters are consumed whole; if a cluster straddles a token boundary the
 * accumulated text overshoots the token and the comparison fails.
 */
function clustersAlign(input, tokens) {
  const clusters = graphemes(input);
  let cursor = 0;
  for (const token of tokens) {
    while (cursor < clusters.length && SEP_TEST.test(graphemes(clusters[cursor])[0])) cursor += 1;
    let accumulated = '';
    while (cursor < clusters.length && accumulated.length < token.length) {
      accumulated += clusters[cursor];
      cursor += 1;
    }
    if (accumulated !== token) return false;
  }
  return true;
}

const icuWords = (text) =>
  [...WORD_SEG.segment(text)]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment);

/* ------------------------------------------------------------------ *
 * The corpus.
 * ------------------------------------------------------------------ */
const REQUIRED_EXAMPLES = [
  ['getHTTPResponseCode', ['get', 'HTTP', 'Response', 'Code']],
  ['XMLHttpRequest', ['XML', 'Http', 'Request']],
  ['userID', ['user', 'ID']],
  ['parse2DArray', ['parse', '2', 'D', 'Array']],
  ['__proto__', ['proto']],
  ['_private', ['private']],
  ['-leading', ['leading']],
  ['kebab-case', ['kebab', 'case']],
  ['snake_case', ['snake', 'case']],
  ['camelCase', ['camel', 'Case']],
  ['PascalCase', ['Pascal', 'Case']],
  ['SCREAMING_SNAKE_CASE', ['SCREAMING', 'SNAKE', 'CASE']],
  ['TRAIN-CASE', ['TRAIN', 'CASE']],
  ['dot.case', ['dot', 'case']],
  ['path/case', ['path', 'case']],
  ['space case', ['space', 'case']],
  ['Title Case', ['Title', 'Case']],
  ['Sentence case', ['Sentence', 'case']],
  ['UPPER CASE', ['UPPER', 'CASE']],
  ['lower case', ['lower', 'case']],
  ['some_Mixed-input here', ['some', 'Mixed', 'input', 'here']],
  ['已存在Some中文和emoji🚀', ['已存在', 'Some', '中文和', 'emoji', '🚀']],
  ['café', ['café']],
  ['ÜberNice', ['Über', 'Nice']],
  ['e\u0301clair', ['e\u0301clair']],
  ['HTTP2Server', ['HTTP', '2', 'Server']],
  ['PBKDF2_ITERATIONS', ['PBKDF', '2', 'ITERATIONS']],
  ['ABCd', ['AB', 'Cd']],
  ['a🚀b', ['a', '🚀', 'b']],
];

const CORE_CORPUS = [
  ...REQUIRED_EXAMPLES.map(([input]) => input),
  '  padded name  ',
  'tab\tseparated\twords',
  '日本語Identifier',
  'naïveTest',
  'ǅunglaTree',
  'Object.prototype.toString',
  'https://example.com/a-b_c',
  'x1y2',
  'a_B_c',
  'A_B',
  '1',
  '42',
  'A',
  'a',
  'приветМир',
  'مرحباWorld',
  '🎉🎊',
  '👍🏽ok',
  '1️⃣x',
  '中文',
];

/* ------------------------------------------------------------------ *
 * Section 1: the naive one-liner, and why it is wrong.
 * ------------------------------------------------------------------ */
console.log('--- 朴素写法为什么不够 ---');
{
  // This is the snippet every "camelCase to snake_case" answer gives. It is
  // carried here purely as a foil, so that the value of a real tokeniser is
  // demonstrated rather than asserted.
  const naive = (value) => value.replace(/([A-Z])/g, '_$1').toLowerCase();

  check('朴素写法把 XMLHttpRequest 切成 _x_m_l_http_request', naive('XMLHttpRequest'), '_x_m_l_http_request');
  check('朴素写法把 getHTTPResponseCode 切成 get_h_t_t_p_response_code', naive('getHTTPResponseCode'), 'get_h_t_t_p_response_code');
  check('朴素写法把 parse2DArray 切成 parse2_d_array', naive('parse2DArray'), 'parse2_d_array');
  check('本实现在同样的三个输入上给出正确的词', [
    M.convertCase('XMLHttpRequest', 'snake'),
    M.convertCase('getHTTPResponseCode', 'snake'),
    M.convertCase('parse2DArray', 'snake'),
  ], ['xml_http_request', 'get_http_response_code', 'parse_2_d_array']);
  check('按大写字母切分的朴素写法也把 XML 拆散', 'XMLHttpRequest'.split(/(?=[A-Z])/), [
    'X', 'M', 'L', 'Http', 'Request',
  ]);
}

/* ------------------------------------------------------------------ *
 * Section 2: the required examples.
 * ------------------------------------------------------------------ */
console.log('--- 指定例子逐条断言 ---');
for (const [input, expected] of REQUIRED_EXAMPLES) {
  check(`切词 ${JSON.stringify(input)}`, words(input), expected);
}
{
  const proto = M.tokenize('__proto__');
  check('__proto__ 的前导分隔符被单独记下', proto.leading, '__');
  check('__proto__ 的尾随分隔符被单独记下', proto.trailing, '__');
  check('-leading 的前导分隔符被单独记下', M.tokenize('-leading').leading, '-');
  const mixed = M.tokenize('some_Mixed-input here');
  check('混合分隔符原文被保留下来', mixed.tokens.map((token) => token.separator), ['', '_', '-', ' ']);
  check('切词原因是可展示的', M.tokenize('getHTTPResponseCode').tokens.map((token) => token.break), [
    'start', 'lower-upper', 'acronym-end', 'lower-upper',
  ]);
  check('组合附加符号不会另起一词', words('e\u0301B'), ['e\u0301', 'B']);
  check('前导组合附加符号单独成词（与 ICU 字素簇一致）', words('\u0301a'), ['\u0301', 'a']);
}

/* ------------------------------------------------------------------ *
 * Section 3: reference 1 — the independent regular-expression tokeniser.
 * ------------------------------------------------------------------ */
console.log('--- 参照物 1：独立的第二套分词实现（正则插入标记） ---');
{
  const failures = [];
  const separators = [', ', ' ', '_', '-', '.', '/', '::', ' (', ') ', '\t', '／', '・'];
  const pieces = ['getHTTPResponseCode', 'XMLHttpRequest', 'userID', 'parse2DArray', 'ABCd', 'aB', 'HTTP2Server', 'café', '中文', 'Über', '🚀', '👍🏽', '1️⃣', 'e\u0301', 'version2Update', 'x'];
  for (const left of pieces) {
    for (const right of pieces) {
      const input = left + separators[(left.length + right.length) % separators.length] + right;
      const mine = M.tokenize(input);
      const theirs = referenceTokenize(input);
      if (
        JSON.stringify(mine.tokens.map((token) => token.text)) !== JSON.stringify(theirs.tokens) ||
        mine.leading !== theirs.leading ||
        mine.trailing !== theirs.trailing
      ) {
        failures.push({ input, mine: mine.tokens.map((t) => t.text), theirs: theirs.tokens });
      }
    }
  }
  checkNoFailures('两套实现逐例一致（词序列 + 前导 + 尾随）', failures, pieces.length * pieces.length);

  const corpusFailures = [];
  for (const input of CORE_CORPUS) {
    const mine = M.tokenize(input);
    const theirs = referenceTokenize(input);
    if (JSON.stringify(mine.tokens.map((t) => t.text)) !== JSON.stringify(theirs.tokens)) {
      corpusFailures.push({ input, mine: mine.tokens.map((t) => t.text), theirs: theirs.tokens });
    }
  }
  checkNoFailures('两套实现在主语料上一致', corpusFailures, CORE_CORPUS.length);
}

/* ------------------------------------------------------------------ *
 * Section 4: reference 2 — ICU grapheme clusters.
 * ------------------------------------------------------------------ */
console.log('--- 参照物 2：Intl.Segmenter 字素簇（ICU） ---');
{
  const emojiCorpus = ['🚀', '😀', '👍🏽', '👨‍👩‍👧', '🇸🇪', '🇨🇳', '🏳️‍🌈', '1️⃣', '👩🏽‍🚀', '🏴‍☠️', '©'];
  const emojiFailures = [];
  for (const emoji of emojiCorpus) {
    const clusters = graphemes(emoji);
    const mine = words(emoji);
    if (clusters.length !== 1 || mine.length !== 1 || mine[0] !== emoji) {
      emojiFailures.push({ emoji, clusters, mine });
    }
  }
  checkNoFailures('单个 emoji 序列整体成词（字素簇一致）', emojiFailures, emojiCorpus.length);

  const alignCorpus = [...CORE_CORPUS, ...emojiCorpus, 'a👨‍👩‍👧b', 'x👍🏽y', 'naïve‍e\u0301', '日本語'];
  const alignFailures = [];
  for (const input of alignCorpus) {
    const tokens = words(input);
    if (!clustersAlign(input, tokens)) alignFailures.push({ input, tokens });
  }
  checkNoFailures('任何切词边界都落在字素簇边界上（不会把字素劈开）', alignFailures, alignCorpus.length);
}

/* ------------------------------------------------------------------ *
 * Section 5: reference 3 — ICU word segmentation on plain English.
 * ------------------------------------------------------------------ */
console.log('--- 参照物 3：Intl.Segmenter 词边界（ICU） ---');
{
  // Inputs are chosen so that the two definitions of "word" agree: an
  // apostrophe or a hyphen is a separator here (this is an identifier tool) but
  // MidLetter or MidNumLet for the Unicode word rules, so such text is out of
  // scope on purpose rather than quietly skipped.
  const sentences = [
    'the quick brown fox jumps over the lazy dog',
    'Hello World',
    'one, two, three',
    'value 42 and 7 more',
    'Column Name Here',
    'mixed Content 2024 edition',
  ];
  const failures = [];
  for (const sentence of sentences) {
    const mine = words(sentence);
    const theirs = icuWords(sentence);
    if (!sameWords(mine, theirs)) failures.push({ sentence, mine, theirs });
  }
  checkNoFailures('自然语言句子的词序列与 ICU 词切分一致', failures, sentences.length);
}

/* ------------------------------------------------------------------ *
 * Section 6: real identifiers from this repository.
 * ------------------------------------------------------------------ */
console.log('--- 真实仓库标识符批量验证 ---');
const repoIdentifiers = (() => {
  const files = [...globSync('src/**/*.ts'), ...globSync('src/**/*.tsx')];
  const text = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  const found = new Set();
  for (const match of text.matchAll(/\b[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b/g)) found.add(match[0]);
  for (const match of text.matchAll(/\b[A-Z][a-z0-9]+[A-Za-z0-9]*\b/g)) found.add(match[0]);
  for (const match of text.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) found.add(match[0]);
  return [...found];
})();

{
  check('从仓库源码里提取到了足量的真实标识符', repoIdentifiers.length > 200, true);
  for (const required of ['useSidebar', 'MAX_LAPS', 'PBKDF2_ITERATIONS', 'onOptionSelect', 'SALT_BYTES']) {
    check(`仓库里确实存在 ${required}`, repoIdentifiers.includes(required), true);
  }

  // Expectations derived from the naming convention itself, not from the
  // implementation: camelCase puts a capital at each word start, so inserting an
  // underscore before each capital and lowercasing *is* snake_case. Only the
  // shapes where that derivation is unambiguous are used (no acronym runs, no
  // digits, so no digit-boundary rule can apply).
  const simpleCamel = repoIdentifiers.filter((id) => /^[a-z]+([A-Z][a-z]+)+$/.test(id));
  const simplePascal = repoIdentifiers.filter((id) => /^[A-Z][a-z]+([A-Z][a-z]+)+$/.test(id));
  const screaming = repoIdentifiers.filter((id) => /^[A-Z]+(_[A-Z]+)+$/.test(id));

  check('简单的 camelCase 标识符样本量足够', simpleCamel.length > 50, true);
  check('简单的 PascalCase 标识符样本量足够', simplePascal.length > 50, true);
  check('SCREAMING_SNAKE_CASE 标识符样本量足够', screaming.length > 5, true);

  const camelFailures = [];
  for (const id of simpleCamel) {
    const expected = id.replace(/([A-Z])/g, '_$1').toLowerCase();
    const actual = M.convertCase(id, 'snake');
    if (actual !== expected) camelFailures.push({ id, actual, expected });
  }
  checkNoFailures('camelCase 真实标识符转 snake_case 与命名约定推导一致', camelFailures, simpleCamel.length);

  const pascalFailures = [];
  for (const id of simplePascal) {
    const expected = id.replace(/([A-Z])/g, '_$1').slice(1).toLowerCase();
    const actual = M.convertCase(id, 'snake');
    if (actual !== expected) pascalFailures.push({ id, actual, expected });
  }
  checkNoFailures('PascalCase 真实标识符转 snake_case 与命名约定推导一致', pascalFailures, simplePascal.length);

  const screamingFailures = [];
  for (const id of screaming) {
    const expected = id.toLowerCase();
    const actual = M.convertCase(id, 'snake');
    if (actual !== expected) screamingFailures.push({ id, actual, expected });
  }
  checkNoFailures('SCREAMING_SNAKE_CASE 真实标识符转 snake_case 等于其小写', screamingFailures, screaming.length);

  // The digit cases, spelled out because the naming convention says nothing
  // about them and the choice has to be visible.
  check('useSidebar 切词', words('useSidebar'), ['use', 'Sidebar']);
  check('onOptionSelect 切词', words('onOptionSelect'), ['on', 'Option', 'Select']);
  check('MAX_LAPS 切词', words('MAX_LAPS'), ['MAX', 'LAPS']);
  check('SALT_BYTES 转 snake_case', M.convertCase('SALT_BYTES', 'snake'), 'salt_bytes');
  check('PBKDF2_ITERATIONS 的数字边界被断开', M.convertCase('PBKDF2_ITERATIONS', 'snake'), 'pbkdf_2_iterations');

  // Nothing may be dropped or reordered for any real identifier.
  const lossFailures = [];
  for (const id of repoIdentifiers) {
    const stripped = [...id].filter((cp) => !SEP_TEST.test(cp)).join('');
    const joined = words(id).join('');
    if (joined !== stripped) lossFailures.push({ id, joined, stripped });
  }
  checkNoFailures('真实标识符切词后拼回原文（未丢字、未乱序）', lossFailures, repoIdentifiers.length);
}

/* ------------------------------------------------------------------ *
 * Section 7: round trip and idempotence.
 * ------------------------------------------------------------------ */
console.log('--- 往返与幂等 ---');
{
  const SEPARATOR_STYLES = M.CASE_STYLES.filter((style) => style.separator !== '');
  const SEPARATORLESS_STYLES = M.CASE_STYLES.filter((style) => style.separator === '');
  check('13 种风格全部注册且 id 唯一', [
    M.CASE_STYLES.length,
    new Set(M.CASE_STYLES.map((style) => style.id)).size,
  ], [13, 13]);
  check('无分隔符的风格只有 camelCase 与 PascalCase', SEPARATORLESS_STYLES.map((s) => s.id), ['camel', 'pascal']);

  // The round trip cannot hold for the separator-free styles, and this is the
  // construction that proves it rather than an excuse. `aBC` has to be read as
  // [a, BC] — that is the very same acronym rule that makes `userID` come apart
  // as [user, ID] and keeps `HTTP` whole — yet `aBC` is also the camelCase of
  // the three-word list [a, B, c]. So a tokeniser that satisfies the required
  // `userID` example can never recover [a, B, c] from its own output.
  check('camelCase 的输出 aBC 必须读成 [a, BC]，而它也是 [a, B, c] 的输出', [
    words('aBC'),
    M.convertWords(['a', 'B', 'c'], 'camel'),
  ], [['a', 'BC'], 'aBC']);
  check('PascalCase 的输出 AB 必须读成 [AB]，而它也是 [A, b] 的输出', [
    words('AB'),
    M.convertWords(['A', 'b'], 'pascal'),
  ], [['AB'], 'AB']);

  const corpus = [...CORE_CORPUS, ...repoIdentifiers];
  const total = M.CASE_STYLES.length * corpus.length;

  // Round trip: convert to a style, tokenise the result, and require the same
  // words back, compared without case because every style in the table maps case
  // deterministically and that is exactly the information a case notation is
  // allowed to discard.
  const roundTripFailures = [];
  const separatorlessFailures = [];
  for (const style of M.CASE_STYLES) {
    for (const input of corpus) {
      const produced = M.convertCase(input, style.id);
      if (sameWords(words(produced), words(input))) continue;
      const record = { style: style.id, input, produced, got: words(produced), want: words(input) };
      if (style.separator === '') separatorlessFailures.push(record);
      else roundTripFailures.push(record);
    }
  }
  checkNoFailures('11 种带分隔符的风格穷举往返：词序列完全一致（忽略大小写）', roundTripFailures, total);
  check('往返失败的风格只可能是 camelCase / PascalCase', [
    [...new Set(separatorlessFailures.map((record) => record.style))].sort(),
  ], [['camel', 'pascal']]);
  check('具体的歧义例子：a_B_c 转 camelCase 后词序列被合并', [
    M.convertCase('a_B_c', 'camel'),
    words(M.convertCase('a_B_c', 'camel')),
  ], ['aBC', ['a', 'BC']]);
  check('具体的歧义例子：A_B 转 PascalCase 后词序列被合并', [
    M.convertCase('A_B', 'pascal'),
    words(M.convertCase('A_B', 'pascal')),
  ], ['AB', ['AB']]);

  // The always-true half of the round trip, for every style: the letters and
  // digits survive, only the case and the separators change.
  const contentFailures = [];
  for (const style of M.CASE_STYLES) {
    for (const input of corpus) {
      const a = words(input).join('').toLowerCase();
      const b = words(M.convertCase(input, style.id)).join('').toLowerCase();
      if (a !== b) contentFailures.push({ style: style.id, input, a, b });
    }
  }
  checkNoFailures('全 13 种风格穷举：切回的字母内容与输入逐字相同（忽略大小写）', contentFailures, total);

  // Idempotence. There is a structural reason it must hold wherever the round
  // trip holds: every style's word transform (`toLowerCase`, `toUpperCase`,
  // `titleWord`) depends only on the word's position and its case-insensitive
  // content, so a second pass over the same words cannot produce anything else.
  // The check therefore separates "idempotent, as it must be" from "the round
  // trip already lost the words, and the notation has no way back".
  const idempotenceFailures = [];
  const idempotenceAfterLoss = [];
  for (const style of M.CASE_STYLES) {
    for (const input of corpus) {
      const once = M.convertCase(input, style.id);
      const twice = M.convertCase(once, style.id);
      if (once === twice) continue;
      const record = { style: style.id, input, once, twice };
      if (!sameWords(words(once), words(input))) idempotenceAfterLoss.push(record);
      else idempotenceFailures.push(record);
    }
  }
  checkNoFailures('只要往返成功，转两次就一定相同（穷举 13 种风格 × 整个语料）', idempotenceFailures, total);
  check('转两次不相同的风格只可能是 camelCase / PascalCase', [
    [...new Set(idempotenceAfterLoss.map((record) => record.style))].sort(),
  ], [['camel', 'pascal']]);
  check('这样的输入确实存在，检查不是空转', idempotenceAfterLoss.length > 0, true);
  check('歧义例子：a_B_c 转 PascalCase 第一次不稳定，第二次起是固定点', [
    M.convertCase('a_B_c', 'pascal'),
    M.convertCase(M.convertCase('a_B_c', 'pascal'), 'pascal'),
    M.convertCase(M.convertCase(M.convertCase('a_B_c', 'pascal'), 'pascal'), 'pascal'),
  ], ['ABC', 'Abc', 'Abc']);

  // Single-character words separated by a real separator never lose anything:
  // the separator keeps them apart, so the ambiguity above cannot arise.
  const singleCharFailures = [];
  for (const style of SEPARATOR_STYLES) {
    for (const input of ['a_b_c', 'a-b-c', 'x_1_y_2', 'A_B_C']) {
      if (!sameWords(words(M.convertCase(input, style.id)), words(input))) {
        singleCharFailures.push({ style: style.id, input });
      }
    }
  }
  checkNoFailures('单字符词在带分隔符的风格里往返稳定', singleCharFailures, SEPARATOR_STYLES.length * 4);

  // Every style converges: after one application the output is a fixed point,
  // even for the ambiguous inputs.
  const convergenceFailures = [];
  for (const style of M.CASE_STYLES) {
    for (const input of corpus) {
      const once = M.convertCase(input, style.id);
      if (M.convertCase(once, style.id) !== M.convertCase(M.convertCase(once, style.id), style.id)) {
        convergenceFailures.push({ style: style.id, input, once });
      }
    }
  }
  checkNoFailures('从第二次应用起一定是固定点', convergenceFailures, total);
}

/* ------------------------------------------------------------------ *
 * Section 8: the style table itself.
 * ------------------------------------------------------------------ */
console.log('--- 风格定义 ---');
{
  const byId = Object.fromEntries(M.CASE_STYLES.map((style) => [style.id, style]));
  const sample = ['two', 'Words', 'here'];
  check('camelCase', M.convertWords(sample, 'camel'), 'twoWordsHere');
  check('PascalCase', M.convertWords(sample, 'pascal'), 'TwoWordsHere');
  check('snake_case', M.convertWords(sample, 'snake'), 'two_words_here');
  check('SCREAMING_SNAKE_CASE', M.convertWords(sample, 'constant'), 'TWO_WORDS_HERE');
  check('kebab-case', M.convertWords(sample, 'kebab'), 'two-words-here');
  check('TRAIN-CASE', M.convertWords(sample, 'train'), 'TWO-WORDS-HERE');
  check('dot.case', M.convertWords(sample, 'dot'), 'two.words.here');
  check('path/case', M.convertWords(sample, 'path'), 'two/words/here');
  check('space case', M.convertWords(sample, 'space'), 'two words here');
  check('Title Case', M.convertWords(sample, 'title'), 'Two Words Here');
  check('Sentence case', M.convertWords(sample, 'sentence'), 'Two words here');
  check('UPPER CASE', M.convertWords(sample, 'upper'), 'TWO WORDS HERE');
  check('lower case', M.convertWords(sample, 'lower'), 'two words here');
  check('space case 与 lower case 的结果确实相同（两种叫法同一个结果）', [
    M.convertCase('some_Mixed-input', 'space'),
    M.convertCase('some_Mixed-input', 'lower'),
  ], ['some mixed input', 'some mixed input']);
  check('未知风格回落到 camelCase 而不是抛异常', M.convertWords(sample, 'nope'), 'twoWordsHere');
  check('convertAll 返回全部 13 种结果', M.convertAll('getHTTPResponseCode').length, 13);
  check('风格标签与 id 对应', byId.constant.label, 'SCREAMING_SNAKE_CASE');
  check('小写单词的 titleCase 有说明', byId.title.description.length > 0, true);

  // Unicode full-case mappings that expand to several code points. Using the
  // whole expansion as the head would leave two capitals in a row, and a second
  // pass would then read them as an acronym — so these are the inputs where a
  // careless implementation stops being idempotent.
  check('德文 sharp s 的 Title Case 采用单字符大写（ß → Ss 而不是 SS）', M.titleWord('ß'), 'Ss');
  check('连字 fi 的 Title Case', M.titleWord('ﬁle'), 'File');
  check('sharp s 的 Title Case 是幂等的', M.titleWord(M.titleWord('ß')), 'Ss');
  check('带音标的分解形式不被合并成替换字符', words('e\u0301clair'), ['e\u0301clair']);
}

/* ------------------------------------------------------------------ *
 * Section 9: boundaries, robustness and fuzzing.
 * ------------------------------------------------------------------ */
console.log('--- 边界与稳健性 ---');
{
  check('空输入没有词', words(''), []);
  check('空输入的三个字段都为空', M.tokenize(''), { tokens: [], leading: '', trailing: '' });
  check('空输入在每种风格下都输出空串', [
    [...new Set(M.convertAll('').map((result) => result.value))],
  ], [['']]);

  check('纯分隔符没有词', words('  _-.//  '), []);
  check('纯分隔符全部算作前导（前导与尾随不重叠）', M.tokenize('  _-.//  '), {
    tokens: [],
    leading: '  _-.//  ',
    trailing: '',
  });
  check('纯分隔符转换为空串', M.convertCase('___', 'snake'), '');
  check('纯数字是一个词', words('20240607'), ['20240607']);
  check('纯数字转 camelCase 不变', M.convertCase('20240607', 'camel'), '20240607');
  check('纯数字转 PascalCase 不变', M.convertCase('20240607', 'pascal'), '20240607');
  check('单字符输入', words('x'), ['x']);
  check('单字符输入转 UPPER CASE', M.convertCase('x', 'upper'), 'X');
  check('单个大写字母输入', words('X'), ['X']);
  check('单个 emoji 输入', words('🚀'), ['🚀']);
  check('只有数字与标点', M.convertCase('1,2,3', 'snake'), '1_2_3');
  check('制表符与换行都是分隔符（单行视角）', words('a\tb  c'), ['a', 'b', 'c']);

  // A surrogate pair must not be torn in half.
  check('星球外码点的 emoji 不被拆成孤立代理项', words('🚀x').every((word) => !/[\uD800-\uDFFF]/.test(word.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))), true);
  check('emoji 在每种风格里都保持完整', [
    [...new Set(M.convertAll('hi🚀there').map((result) => result.value.includes('🚀')))],
  ], [[true]]);

  // Long input: 200k characters. The implementation builds the class table once
  // per tokenize call and walks it linearly, so this must stay fast; a
  // quadratic version (re-deriving classes per word run) would not.
  const long = 'getHTTPResponseCode_'.repeat(10_000);
  const started = Date.now();
  const longWords = words(long);
  const elapsed = Date.now() - started;
  check('20 万字符输入切出正确的词数', longWords.length, 40_000);
  check('20 万字符输入在 3 秒内完成（排除二次复杂度）', elapsed < 3000, true);
  check('首尾词正确', [longWords[0], longWords[longWords.length - 1]], ['get', 'Code']);
  check('20 万字符输入转为 snake_case 后长度可预测', M.convertCase(long, 'snake').length, long.length + 29_999);
}

/* ------------------------------------------------------------------ *
 * Section 10: multi-line input.
 * ------------------------------------------------------------------ */
console.log('--- 多行输入 ---');
{
  check('多行逐行转换', M.convertCase('getHTTPResponseCode\nuserID', 'snake'), 'get_http_response_code\nuser_id');
  check('CRLF 行尾原样保留', M.convertCase('a_b\r\nc_d', 'camel'), 'aB\r\ncD');
  check('单独的 CR 也保留', M.convertCase('a_b\rc_d', 'camel'), 'aB\rcD');
  check('空行保留', M.convertCase('a_b\n\nc_d', 'constant'), 'A_B\n\nC_D');
  check('结尾换行保留', M.convertCase('a_b\n', 'kebab'), 'a-b\n');
  check('行内不跨行合并词', words('a_b\nc_d'), ['a', 'b', 'c', 'd']);
  check('每行独立切词', M.tokenizeLines('getHTTPResponseCode\nuserID').map((line) => line.words.tokens.map((token) => token.text)), [
    ['get', 'HTTP', 'Response', 'Code'],
    ['user', 'ID'],
  ]);
  check('行号从 1 开始', M.tokenizeLines('a\nb\nc').map((line) => line.index), [1, 2, 3]);
  check('空输入仍然算一行', M.tokenizeLines('').length, 1);
  check('词数统计', M.wordCount(M.tokenizeLines('getHTTPResponseCode\nuserID')), 6);
}

/* ------------------------------------------------------------------ *
 * Section 11: the tokenisation text export.
 * ------------------------------------------------------------------ */
console.log('--- 切词说明导出 ---');
{
  const text = M.formatTokenization(M.tokenizeLines('getHTTPResponseCode'));
  check('导出文本包含输入', text.includes('getHTTPResponseCode'), true);
  check('导出文本包含每个词', ['get', 'HTTP', 'Response', 'Code'].every((word) => text.includes(word)), true);
  check('导出文本说明了连续大写的断开', text.includes(M.BREAK_LABELS['acronym-end']), true);
  check('导出文本行数', text.split('\n').length, 5);
  check('空输入的导出文本不为空', M.formatTokenization(M.tokenizeLines('')).length > 0, true);
  check('前导分隔符在导出文本里被说明', M.formatTokenization(M.tokenizeLines('__proto__')).includes('__'), true);
  check('尾随分隔符在导出文本里被说明', M.formatTokenization(M.tokenizeLines('__proto__')).includes('尾随'), true);
}

/* ------------------------------------------------------------------ *
 * Section 12: fuzzing with a deterministic generator.
 * ------------------------------------------------------------------ */
console.log('--- 随机组合不变量 ---');
{
  let seed = 20240607;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pick = (list) => list[Math.floor(rand() * list.length)];

  const POOL = [
    'get', 'HTTP', 'Response', 'Code', 'user', 'ID', 'parse', 'D', 'Array', 'x', 'y',
    'XML', 'Http', 'Request', 'a', 'B', 'c', '2', '42', '中文', '日本語', 'é', 'Über',
    'emoji', '🚀', '👍🏽', 'value', 'MAX', 'laps',
  ];
  const SEPARATORS = ['_', '-', '.', '/', ' ', '__', '--', '', '\t'];

  let contentViolations = 0;
  let alignViolations = 0;
  let roundTripViolations = 0;
  let idempotenceViolations = 0;
  let examples = 0;
  const mismatches = [];

  for (let round = 0; round < 400; round += 1) {
    const count = 1 + Math.floor(rand() * 6);
    const parts = [];
    for (let i = 0; i < count; i += 1) {
      if (i > 0) parts.push(pick(SEPARATORS));
      parts.push(pick(POOL));
    }
    const input = parts.join('');
    examples += 1;

    const mine = M.tokenize(input);
    const mineWords = mine.tokens.map((token) => token.text);
    const theirs = referenceTokenize(input);
    if (JSON.stringify(mineWords) !== JSON.stringify(theirs.tokens)) {
      mismatches.push({ input, mine: mineWords, theirs: theirs.tokens });
      continue;
    }

    // Invariant: nothing is dropped, duplicated or reordered.
    const stripped = [...input].filter((cp) => !SEP_TEST.test(cp)).join('');
    if (mineWords.join('') !== stripped) contentViolations += 1;

    // Invariant: every token is a whole number of grapheme clusters.
    if (!clustersAlign(input, mineWords)) alignViolations += 1;

    for (const style of M.CASE_STYLES) {
      // Invariant: the letters survive every style, only case and separators move.
      const produced = M.convertCase(input, style.id);
      if (words(produced).join('').toLowerCase() !== stripped.toLowerCase()) contentViolations += 1;

      // Invariant: a separator-bearing style always round-trips.
      const roundTrips = sameWords(words(produced), mineWords);
      if (style.separator !== '' && !roundTrips) roundTripViolations += 1;

      // Invariant: where the round trip holds, a second application changes nothing.
      if (roundTrips && M.convertCase(produced, style.id) !== produced) idempotenceViolations += 1;
    }
  }

  checkNoFailures('随机组合与第二套实现一致', mismatches, examples);
  check('400 组随机组合：内容不丢不重不乱序，且始终与字素簇对齐', contentViolations + alignViolations, 0);
  check('400 组随机组合：带分隔符的风格往返始终成立', roundTripViolations, 0);
  check('400 组随机组合：往返成立时转两次结果相同', idempotenceViolations, 0);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
