/**
 * Checks the Lorem ipsum generator.
 *
 * The claims worth defending, and the independent oracle used for each:
 *
 * 1. **The classic opening is verbatim.** Compared byte for byte against the
 *    text as it is quoted everywhere, so a typo in `adipiscing`, `consectetur`
 *    or `elit` fails rather than looking plausible.
 * 2. **Every word comes from the declared bank.** The output is tokenised here
 *    (the check owns the tokeniser) and every token is looked up in the bank;
 *    the bank itself is validated for empty entries, duplicates, whitespace and
 *    punctuation.
 * 3. **The requested count is exact.** Words, sentence terminators and
 *    paragraphs are counted by this file, not by the implementation, and
 *    cross-checked against the generator's own stats helper.
 * 4. **The same seed gives the same text.** Two independent generators are fed
 *    the same seed and their output compared; the mirror image — that
 *    `Math.random` would *not* be reproducible — is asserted too, so the check
 *    would fail if the seeding were dropped.
 * 5. **HTML output is balanced.** A stack-based tag matcher written here parses
 *    the markup; a malformed string is fed to the same matcher first to prove
 *    it can fail.
 * 6. **Boundaries do not hang or throw.** 0, 1, negative, fractional and
 *    over-cap counts, including a 10000-word run under a clock budget.
 *
 * Usage: node scripts/check-lorem-ipsum.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/lorem-ipsum/loremUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/lorem-ipsum.mjs', compiled);
const M = await import(pathToFileURL('.verify/lorem-ipsum.mjs').href);

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

/** Options with sensible defaults, so each case states only what it changes. */
function options(overrides = {}) {
  return {
    unit: 'paragraph',
    count: 1,
    language: 'latin',
    classicOpening: false,
    html: false,
    tag: 'p',
    ...overrides,
  };
}

/** Runs the generator with a fresh seeded source. */
function generate(seed, overrides) {
  return M.generateLorem(M.seededRandom(seed), options(overrides));
}

// --- Independent helpers. These are deliberately written here rather than
// --- imported, so the check does not agree with the implementation by
// --- construction.

/**
 * Splits Latin output into word tokens, dropping the punctuation the sentence
 * builder attaches. Commas are stripped from the end of a token only; a comma
 * in the middle would survive and therefore be reported as an unknown word.
 * The result is lowercased because the generator title-cases its words.
 */
function latinTokens(text) {
  return text
    .split(/\s+/)
    .map((token) => token.replace(/[.,]+$/, '').toLowerCase())
    .filter((token) => token !== '');
}

/** Counts sentence terminators: '.' for Latin, '。' for Chinese. */
function terminatorCount(text, language) {
  const terminator = M.sentenceEnd(language);
  let count = 0;
  for (const character of text) if (character === terminator) count += 1;
  return count;
}

/**
 * Strips the wrapper tags, so invariants written for plain text can also run
 * against HTML output.
 *
 * A closing tag followed by a newline becomes a blank line, which keeps two
 * adjacent blocks as two paragraphs; the remaining tags are then deleted. The
 * naive alternatives are both wrong and are asserted against below: deleting
 * every tag glues paragraphs into one, and replacing every tag with a newline
 * leaves a blank line inside each paragraph.
 */
function unwrap(html) {
  return html
    .replace(/<\/[a-z][a-z0-9]*>\n(?=<)/gi, '\n\n')
    .replace(/<\/?[a-z][a-z0-9]*>/gi, '');
}

/**
 * Stack-based tag matcher, with the small HTML subset the generator can emit in
 * mind: lowercase tags, no attributes, no self-closing forms, no text-level
 * markup. Returns the list of problems, empty when the markup is well formed.
 */
function tagProblems(html) {
  const problems = [];
  const stack = [];
  const pattern = /<\/?([a-z][a-z0-9]*)([^>]*)>/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const [raw, name, attributes] = match;
    if (attributes.trim() !== '') problems.push(`标签 ${name} 带属性：${raw}`);
    if (raw.startsWith('</')) {
      if (stack.length === 0) problems.push(`多余的结束标签 ${raw}`);
      else if (stack.pop() !== name) problems.push(`结束标签不匹配 ${raw}`);
    } else {
      stack.push(name);
    }
  }
  if (stack.length > 0) problems.push(`未闭合的标签：${stack.join(', ')}`);
  return problems;
}

/** Counts the `<p>...</p>` blocks, using tag length rather than a regex. */
function countBlocks(html, tag) {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  let blocks = 0;
  for (const line of html.split('\n')) {
    if (line.startsWith(open) && line.endsWith(close)) blocks += 1;
  }
  return blocks;
}

const CHINESE = 'chinese';
const LATIN = 'latin';

console.log('--- 词库完整性 ---');
{
  check('拉丁词库非空', M.LATIN_WORDS.length > 100, true);
  check('中文占位句库非空', M.CHINESE_SENTENCES.length >= 10, true);

  const duplicated = (words) => {
    const seen = new Set();
    const dupes = [];
    for (const word of words) {
      if (seen.has(word)) dupes.push(word);
      seen.add(word);
    }
    return dupes;
  };
  check('拉丁词库没有重复词', duplicated(M.LATIN_WORDS), []);
  check('中文句库没有重复句', duplicated(M.CHINESE_SENTENCES), []);

  // A bank entry with whitespace or a stray terminator would break the counting
  // rules at a distance: a two-word Latin entry makes the word count wrong, and
  // a '.' inside the bank makes the sentence count wrong.
  const badLatin = M.LATIN_WORDS.filter((word) => !/^[a-z]+$/.test(word));
  check('拉丁词库全是纯小写字母（无空格/标点/空词）', badLatin, []);
  check(
    '中文句库里没有 ASCII 空格或拉丁字母',
    M.CHINESE_SENTENCES.filter((sentence) => /\s/.test(sentence) || /[A-Za-z]/.test(sentence)),
    [],
  );
  check(
    '拉丁词库不含标点或空白',
    M.LATIN_WORDS.filter((word) => /[\s.,]/.test(word)),
    [],
  );
  check(
    '中文句库每句都以句号结束且只有一个句号',
    M.CHINESE_SENTENCES.filter(
      (sentence) => !sentence.endsWith('。') || sentence.split('。').length !== 2,
    ),
    [],
  );
  check(
    '中文句库只含汉字与中文标点',
    M.CHINESE_SENTENCES.filter((sentence) => !M.isChineseFiller(sentence)),
    [],
  );
  check(
    '中文句库被切词后能原样拼回（切词不丢字）',
    M.CHINESE_SENTENCES.filter(
      (sentence) =>
        M.cutChineseWords(sentence.replace(/[。，]/g, '')).join('') !== sentence.replace(/[。，]/g, ''),
    ),
    [],
  );

  const classicWords = M.CLASSIC_OPENER.split(' ');
  check('经典开头的每个词都在词库里', M.invalidWords(classicWords.map((w) => w.replace(',', '')), LATIN), []);
  check('经典开头词数推导正确（8 个词）', M.CLASSIC_OPENER_WORD_COUNT, 8);
}

console.log('--- 经典开头逐字正确 ---');
{
  // The canonical string, copied from the widely quoted text. Spelled out here
  // rather than imported, so a typo in the implementation cannot agree with it.
  const CANONICAL = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit';
  check('实现里的常量与权威拼写一致', M.CLASSIC_OPENER, CANONICAL);
  check(
    'adipiscing 拼写（不是 adipis icing / adipisicing）',
    /consectetur adipiscing elit$/.test(CANONICAL),
    true,
  );

  const one = generate(7, { unit: 'sentence', count: 1, classicOpening: true });
  check('1 句 + 经典开头：逐字以经典开头起始', one, `${CANONICAL}.`);
  check('经典开头起始断言（startsWith）', one.startsWith(CANONICAL), true);
  // The classic opening consumes part of the budget instead of being added on
  // top of it: padding it with random words would break the word count, which
  // is exactly what this asserts.
  check('经典开头计入单词预算（1 句 = 8 个词）', latinTokens(one).length, M.CLASSIC_OPENER_WORD_COUNT);
  check('经典开头的词也全部来自词库', M.invalidWords(latinTokens(one), LATIN), []);

  for (const count of [1, 2, 3, 5, 12]) {
    const text = generate(4242, { unit: 'sentence', count, classicOpening: true });
    check(`${count} 句 + 经典开头仍以经典开头起始`, text.startsWith(CANONICAL), true);
    check(`${count} 句 + 经典开头只有 1 个经典开头`, text.split(CANONICAL).length - 1, 1);
  }

  const paragraphs = generate(11, { unit: 'paragraph', count: 3, classicOpening: true });
  check('段落模式 + 经典开头也以经典开头起始', paragraphs.startsWith(CANONICAL), true);
  check('段落模式里经典开头不重复', paragraphs.split(CANONICAL).length - 1, 1);

  const words = generate(3, { unit: 'word', count: 20, classicOpening: true });
  check('单词模式不加经典开头', words.includes('Lorem'), false);

  const chinese = generate(5, { unit: 'sentence', count: 2, language: CHINESE, classicOpening: true });
  check('中文模式忽略经典开头', /[A-Za-z]/.test(chinese), false);

  const off = generate(7, { unit: 'sentence', count: 1, classicOpening: false });
  check('未勾选经典开头时不以它起始', off.startsWith(CANONICAL), false);
}

console.log('--- 确定性：同一随机源 -> 完全相同 ---');
{
  const a = generate(2024, { unit: 'paragraph', count: 4, classicOpening: true });
  const b = generate(2024, { unit: 'paragraph', count: 4, classicOpening: true });
  check('同一 seed 两次生成完全相同（段落）', a, b);
  check('同一 seed 两次生成完全相同（句子）', generate(9, { unit: 'sentence', count: 6 }), generate(9, { unit: 'sentence', count: 6 }));
  check('同一 seed 两次生成完全相同（单词）', generate(9, { unit: 'word', count: 60 }), generate(9, { unit: 'word', count: 60 }));
  check('同一 seed 两次生成完全相同（中文）', generate(9, { language: CHINESE, count: 3 }), generate(9, { language: CHINESE, count: 3 }));
  check('同一 seed 两次生成完全相同（HTML）', generate(9, { count: 3, html: true }), generate(9, { count: 3, html: true }));

  // The seeded source itself must be reproducible, not only its consumer.
  const first = M.seededRandom(12345);
  const second = M.seededRandom(12345);
  const firstValues = [first(), first(), first()];
  const secondValues = [second(), second(), second()];
  check('seededRandom 同种子给出同一序列', firstValues, secondValues);
  check('seededRandom 的值域为 [0, 1)', firstValues.every((v) => v >= 0 && v < 1), true);

  // Different seeds must differ. Several pairs are sampled rather than one,
  // because a single divergent pair could pass by luck.
  const divergent = [];
  for (const [left, right] of [[1, 2], [7, 8], [100, 101], [2024, 2025], [-3, -2], [0, 1]]) {
    const x = generate(left, { unit: 'paragraph', count: 2 });
    const y = generate(right, { unit: 'paragraph', count: 2 });
    divergent.push(x !== y);
  }
  check('六对相邻 seed 都产生不同输出', divergent, [true, true, true, true, true, true]);

  // The contrast that proves seeding is doing the work: a source reading the
  // clock directly cannot be reproducible, so the check above would fail.
  const wallClock = () => Math.random();
  const clockA = M.generateLorem(wallClock, options({ unit: 'word', count: 40 }));
  const clockB = M.generateLorem(wallClock, options({ unit: 'word', count: 40 }));
  check('用 Math.random 作为随机源时两次不同（证明本检查能发现失去确定性）', clockA === clockB, false);

  // Same seed, but a different requested count: the prefix must still match,
  // which is what makes the sequence useful for reproduction.
  const short = generate(555, { unit: 'word', count: 20 });
  const long = generate(555, { unit: 'word', count: 40 });
  check('同一 seed 下长输出的前缀等于短输出', long.startsWith(short), true);
}

console.log('--- 数量语义 ---');
{
  // Words. Verified through the check's own tokeniser, and against the
  // implementation's stats helper as a second opinion.
  for (const requested of [1, 2, 3, 7, 50, 999, 10000]) {
    const text = generate(31, { unit: 'word', count: requested });
    check(`单词模式请求 ${requested} 个词，实际正好 ${requested} 个`, latinTokens(text).length, requested);
    check(`单词模式 ${requested} 个词的统计口径一致`, M.describeLorem(text, LATIN).words, requested);
  }

  // Sentences: exactly one terminator each. With and without the opening, since
  // the opening path is a different branch of the generator.
  for (const requested of [1, 2, 3, 8, 40]) {
    const plain = generate(77, { unit: 'sentence', count: requested });
    check(`句子模式请求 ${requested} 句，正好 ${requested} 个句末句号`, terminatorCount(plain, LATIN), requested);
    check(`句子模式 ${requested} 句的统计口径一致`, M.describeLorem(plain, LATIN).sentences, requested);

    const classic = generate(77, { unit: 'sentence', count: requested, classicOpening: true });
    check(`句子模式 + 经典开头请求 ${requested} 句，正好 ${requested} 个句号`, terminatorCount(classic, LATIN), requested);
  }

  // Paragraphs: counted by splitting on the blank-line separator, here in the
  // check rather than through the helper.
  for (const requested of [1, 2, 3, 9, 30]) {
    const text = generate(13, { unit: 'paragraph', count: requested });
    check(`段落模式请求 ${requested} 段，正好 ${requested} 段`, text.split(/\n\n+/).length, requested);
    check(`段落模式 ${requested} 段的统计口径一致`, M.describeLorem(text, LATIN).paragraphs, requested);

    const classic = generate(13, { unit: 'paragraph', count: requested, classicOpening: true });
    check(`段落模式 + 经典开头请求 ${requested} 段，正好 ${requested} 段`, classic.split(/\n\n+/).length, requested);
  }

  // Chinese sentences carry '。' and no ASCII full stop.
  for (const requested of [1, 4, 15]) {
    const text = generate(88, { unit: 'sentence', count: requested, language: CHINESE });
    check(`中文句子模式请求 ${requested} 句，正好 ${requested} 个句号`, terminatorCount(text, CHINESE), requested);
    check(`中文句子模式 ${requested} 句里没有 ASCII 句号`, text.includes('.'), false);
  }

  check(
    '每段句数落在声明区间内（第 1 段）',
    M.describeLorem(generate(2, { count: 1 }).split(/\n\n/)[0], LATIN).sentences >= M.MIN_SENTENCES_PER_PARAGRAPH &&
      M.describeLorem(generate(2, { count: 1 }).split(/\n\n/)[0], LATIN).sentences <= M.MAX_SENTENCES_PER_PARAGRAPH,
    true,
  );
  {
    let outOfRange = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const paragraph = generate(seed, { count: 1 });
      const sentences = M.describeLorem(paragraph, LATIN).sentences;
      if (sentences < M.MIN_SENTENCES_PER_PARAGRAPH || sentences > M.MAX_SENTENCES_PER_PARAGRAPH) {
        outOfRange += 1;
      }
    }
    check('200 个种子下每段句数都在 3–6 之间', outOfRange, 0);
  }
}

console.log('--- 标点与格式 ---');
{
  let violations = [];
  for (let seed = 0; seed < 120; seed += 1) {
    for (const unit of ['paragraph', 'sentence', 'word']) {
      for (const classicOpening of [false, true]) {
        const text = generate(seed, { unit, count: 3, classicOpening });
        if (text.split('\n').some((line) => /[ \t]{2,}/.test(line))) {
          violations.push(`行内连续空格 seed=${seed} unit=${unit}`);
        }
        if (/\n{3,}/.test(text)) violations.push(`段落间多余空行 seed=${seed} unit=${unit}`);
        if (text !== text.trim()) violations.push(`首尾空白 seed=${seed} unit=${unit}`);
        if (unit !== 'word' && !/^[A-Z]/.test(text)) violations.push(`首字母未大写 seed=${seed} unit=${unit}`);
        if (unit !== 'word' && terminatorCount(text, LATIN) < 1) violations.push(`句末缺句号 seed=${seed}`);
        if (unit === 'word' && /[.,]/.test(text)) violations.push(`单词模式出现标点 seed=${seed}`);
        if (/[^A-Za-z ,.\n]/.test(text)) violations.push(`出现词库外的字符 seed=${seed} unit=${unit}`);
      }
    }
  }
  check('120×3×2 组拉丁输出：无首尾空白、无行内连续空格、无多余空行、首字母大写、句末有句号、无异常字符', violations, []);

  // Chinese: a space is only ever the sentence separator, so every space must
  // sit directly after a '。'. A space anywhere else would mean the words were
  // joined with one, which is not how Chinese is written.
  let chineseViolations = [];
  for (let seed = 0; seed < 60; seed += 1) {
    for (const unit of ['paragraph', 'sentence']) {
      const text = generate(seed, { unit, count: 2, language: CHINESE });
      if (text !== text.trim()) chineseViolations.push(`中文首尾空白 seed=${seed}`);
      if (/\n{3,}/.test(text)) chineseViolations.push(`中文多余空行 seed=${seed}`);
      if (/[ \t]{2,}/.test(text)) chineseViolations.push(`中文连续空格 seed=${seed}`);
      if (terminatorCount(text, CHINESE) < 1) chineseViolations.push(`中文缺句号 seed=${seed}`);
      if (/[A-Za-z]/.test(text)) chineseViolations.push(`中文里混入拉丁字母 seed=${seed}`);
      for (const match of text.matchAll(/[ \t]/g)) {
        const before = text.slice(0, match.index);
        if (!before.endsWith(M.sentenceEnd(CHINESE))) {
          chineseViolations.push(`中文在句内出现空格 seed=${seed} unit=${unit}`);
        }
      }
    }
  }
  check('60×2 组中文输出：空格只出现在句号之后，无首尾空白、无连续空格、以。结束、不含拉丁字母', chineseViolations, []);

  // A comma must be attached to the word before it, never floating alone.
  let floatingCommas = 0;
  for (let seed = 0; seed < 120; seed += 1) {
    const text = generate(seed, { unit: 'paragraph', count: 2 });
    if (/(^|\s),/.test(text)) floatingCommas += 1;
  }
  check('逗号总是紧贴在词尾（120 个种子）', floatingCommas, 0);

  // Every word in the output belongs to the bank: this is the vocabulary
  // correctness claim, checked with the check's own tokeniser.
  let unknown = [];
  for (let seed = 0; seed < 150; seed += 1) {
    const text = generate(seed, { unit: 'paragraph', count: 2, classicOpening: true });
    const bad = M.invalidWords(latinTokens(text), LATIN);
    if (bad.length > 0) unknown.push({ seed, bad });
  }
  check('150 个种子下所有拉丁词都来自词库（无脏数据）', unknown, []);

  let tokensChecked = 0;
  for (let seed = 0; seed < 50; seed += 1) {
    tokensChecked += latinTokens(generate(seed, { unit: 'word', count: 200 })).length;
  }
  check('被校验的单词总数达到预期（10000 个）', tokensChecked, 10000);

  // Chinese output is drawn from the placeholder sentence bank, so every
  // generated sentence must be one of those sentences verbatim — that is what
  // makes it readable Chinese rather than a pile of random characters. Two
  // sentences that end up next to each other across a paragraph boundary are
  // not required to differ, so repeats are only checked *within* a paragraph.
  const chineseBank = new Set(M.CHINESE_SENTENCES);
  let notInBank = [];
  let adjacentRepeats = [];
  for (let seed = 0; seed < 80; seed += 1) {
    for (const unit of ['paragraph', 'sentence']) {
      const text = generate(seed, { unit, count: 2, language: CHINESE });
      const blocks = unit === 'paragraph' ? text.split(/\n{2,}/) : [text];
      for (const block of blocks) {
        const sentences = block.split(/(?<=。)\s*/).filter((part) => part.trim() !== '');
        for (const sentence of sentences) {
          if (!chineseBank.has(sentence.trim())) notInBank.push({ seed, unit, sentence });
        }
        for (let index = 1; index < sentences.length; index += 1) {
          if (sentences[index] === sentences[index - 1]) adjacentRepeats.push({ seed, unit });
        }
      }
    }
  }
  check('80 个种子 × 段落/句子：每句都是句库里的原句', notInBank, []);
  check('同一段内相邻两句不会完全重复', adjacentRepeats, []);

  // Word mode cuts a sentence into chunks and trims the last one, so the result
  // is not required to equal a whole bank sentence; it must however be exactly
  // the requested number of characters and contain nothing outside the bank.
  const chineseCharacters = new Set(
    M.CHINESE_SENTENCES.join('').split('').filter((character) => !'。，'.includes(character)),
  );
  let chineseStray = [];
  let wordCountWrong = [];
  for (const requested of [1, 5, 8, 30, 60, 200, 1000]) {
    for (let seed = 0; seed < 12; seed += 1) {
      const words = generate(seed, { unit: 'word', count: requested, language: CHINESE });
      if (words.length !== requested) wordCountWrong.push({ seed, requested, got: words.length });
      for (const character of words) {
        if (!chineseCharacters.has(character)) chineseStray.push({ seed, requested, character });
      }
    }
  }
  check('中文单词模式：字符数精确等于请求数（84 组）', wordCountWrong, []);
  check('中文单词模式：没有句库之外的字符', chineseStray, []);
  // Only the final chunk may be cut short; every earlier chunk must be a whole
  // word from the bank, so the text never has a word severed in its middle
  // except at the very end where the requested length forces it.
  const wholeChunks = new Set(
    M.CHINESE_SENTENCES.flatMap((sentence) => M.cutChineseWords(sentence)).map((chunk) =>
      chunk.replace(/[。，]/g, ''),
    ),
  );
  let brokenChunks = [];
  for (let seed = 0; seed < 20; seed += 1) {
    const words = generate(seed, { unit: 'word', count: 400, language: CHINESE });
    let rest = words;
    const pieces = [];
    while (rest.length > 0) {
      const match = [...wholeChunks]
        .sort((a, b) => b.length - a.length)
        .find((chunk) => chunk !== '' && rest.startsWith(chunk));
      if (!match) break;
      pieces.push(match);
      rest = rest.slice(match.length);
    }
    // Whatever is left after consuming whole chunks must be short enough to be a
    // single trimmed chunk (at most the longest chunk in the bank).
    if (rest.length > 6) brokenChunks.push({ seed, rest: rest.slice(0, 12) });
  }
  check('中文单词模式：只有最后一小段可能被截断（前文都是完整词）', brokenChunks, []);
  check('中文句库集合大小与数组一致', chineseBank.size, M.CHINESE_SENTENCES.length);
}

console.log('--- 边界 ---');
{
  check('0 段返回空串', generate(1, { unit: 'paragraph', count: 0 }), '');
  check('0 句返回空串', generate(1, { unit: 'sentence', count: 0 }), '');
  check('0 词返回空串', generate(1, { unit: 'word', count: 0 }), '');
  check('负数段按 0 处理', generate(1, { unit: 'paragraph', count: -5 }), '');
  check('负数词按 0 处理', generate(1, { unit: 'word', count: -999 }), '');
  check('极大负数不抛异常', generate(1, { unit: 'word', count: -Number.MAX_SAFE_INTEGER }), '');
  check('NaN 按 0 处理', generate(1, { unit: 'word', count: Number.NaN }), '');
  check('Infinity 按 0 处理（不会试图分配无限内存）', generate(1, { unit: 'word', count: Number.POSITIVE_INFINITY }), '');
  check('小数向下取整', latinTokens(generate(1, { unit: 'word', count: 7.9 })).length, 7);
  check('clampCount 上限', M.clampCount(1e9), M.MAX_COUNT);
  check('clampCount 负数', M.clampCount(-1), 0);
  check('clampCount NaN', M.clampCount(Number.NaN), 0);
  check('MAX_COUNT 是一个合理上限', M.MAX_COUNT >= 10000, true);

  check('1 段 1 句可用', generate(4, { unit: 'sentence', count: 1 }).length > 0, true);
  check('1 个词可用', generate(4, { unit: 'word', count: 1 }), M.wordBank(LATIN).includes(generate(4, { unit: 'word', count: 1 })) ? generate(4, { unit: 'word', count: 1 }) : '');
  {
    const one = generate(4, { unit: 'word', count: 1 });
    check('1 个词确实是一个词库里的词', M.LATIN_WORDS.includes(one), true);
  }

  // The large case must both finish and stay exact. A clock budget catches the
  // quadratic string building that a naive join-in-a-loop would introduce.
  const started = Date.now();
  const big = generate(2024, { unit: 'word', count: 10000 });
  const elapsed = Date.now() - started;
  check('10000 词：数量精确', latinTokens(big).length, 10000);
  check('10000 词：无连续空白', /\s{2,}/.test(big), false);
  check('10000 词：在 5 秒内完成', elapsed < 5000, true);

  const bigParagraphs = generate(2024, { unit: 'paragraph', count: 500 });
  check('500 段：段落数精确', bigParagraphs.split(/\n\n+/).length, 500);
  check('500 段：每段以句号结束', bigParagraphs.split(/\n\n+/).every((p) => p.endsWith('.')), true);

  const clamped = generate(2024, { unit: 'word', count: M.MAX_COUNT + 12345 });
  check(`超过上限按 ${M.MAX_COUNT} 处理（而不是无限生成）`, latinTokens(clamped).length, M.MAX_COUNT);
}

console.log('--- 大小写规则 ---');
{
  check('firstLetterUpper 只动首字母', M.firstLetterUpper('lorem'), 'Lorem');
  check('firstLetterUpper 不破坏已大写的词（锚定匹配）', M.firstLetterUpper('Lorem'), 'Lorem');
  check('firstLetterUpper 不把内部小写字母提前大写', M.firstLetterUpper('LoremIpsum'), 'LoremIpsum');
  // The naive unanchored form is proven wrong here, so the check above is known
  // to be able to fail.
  check('朴素未锚定写法会把 Lorem 变成 LOrem（证明该断言有效）', 'Lorem'.replace(/[a-z]/, (c) => c.toUpperCase()), 'LOrem');
  check('firstLetterUpper 对中文无影响', M.firstLetterUpper('这里是占位'), '这里是占位');
  check('titleCase 逐词大写', M.titleCase('lorem ipsum dolor'), 'Lorem Ipsum Dolor');
  check('titleCase 不改变已是标题式的输入', M.titleCase('Lorem Ipsum'), 'Lorem Ipsum');
  check('普通句子按 titleCase 规则（与实现共用同一规则）', M.normaliseSentenceCase('lorem ipsum, dolor sit', LATIN), 'Lorem Ipsum, Dolor Sit');
}

console.log('--- HTML 模式 ---');
{
  // Prove the matcher can detect damage before trusting it on good output.
  check('标签配平器能发现未闭合', tagProblems('<p>text').length > 0, true);
  check('标签配平器能发现多余闭合', tagProblems('text</p>').length > 0, true);
  check('标签配平器能发现错配', tagProblems('<p>a</div>').length > 0, true);
  check('标签配平器接受正确嵌套', tagProblems('<p>a</p>'), []);

  for (const tag of ['p', 'div']) {
    for (const requested of [1, 3, 8]) {
      const html = generate(64, { unit: 'paragraph', count: requested, html: true, tag });
      check(`HTML <${tag}> ${requested} 段：标签配平`, tagProblems(html), []);
      check(`HTML <${tag}> ${requested} 段：每段恰好一对标签`, [
        html.split(`<${tag}>`).length - 1,
        html.split(`</${tag}>`).length - 1,
      ], [requested, requested]);
      check(`HTML <${tag}> ${requested} 段：块数等于请求数`, countBlocks(html, tag), requested);
      check(`HTML <${tag}> ${requested} 段：去掉标签后段落数不变`, M.describeLorem(unwrap(html), LATIN).paragraphs, requested);
      check(`HTML <${tag}> ${requested} 段：标签内文本以句号结束`, html.split('\n').every((line) => line.endsWith(`.</${tag}>`)), true);
    }
  }

  const sentenceHtml = generate(64, { unit: 'sentence', count: 3, html: true });
  check('HTML 句子模式：标签配平', tagProblems(sentenceHtml), []);
  check('HTML 句子模式：句号数仍为 3', terminatorCount(unwrap(sentenceHtml), LATIN), 3);

  const wordHtml = generate(64, { unit: 'word', count: 25, html: true, tag: 'div' });
  check('HTML 单词模式：标签配平', tagProblems(wordHtml), []);
  check('HTML 单词模式：词数仍为 25', latinTokens(unwrap(wordHtml)).length, 25);

  const plain = generate(64, { unit: 'paragraph', count: 3, html: false });
  check('未勾选 HTML 时不出现标签', /[<>]/.test(plain), false);
  // Compared paragraph by paragraph rather than as one string: unwrapping
  // leaves an extra newline after each tag, which is presentation only and not
  // part of the paragraph content.
  check(
    'HTML 与纯文本的段落内容一致（同种子）',
    M.splitParagraphs(unwrap(generate(64, { unit: 'paragraph', count: 3, html: true }))),
    M.splitParagraphs(plain),
  );
  check(
    'HTML 与纯文本的段落数一致（同种子）',
    M.splitParagraphs(unwrap(generate(64, { unit: 'paragraph', count: 3, html: true }))).length,
    3,
  );
  check(
    'stripHtmlTags 与检查脚本自己的去标签结果一致',
    M.stripHtmlTags('<p>a</p>\n<p>b</p>'),
    unwrap('<p>a</p>\n<p>b</p>'),
  );
  check('stripHtmlTags 保留段落分隔（不把两段粘成一段）', M.splitParagraphs(M.stripHtmlTags('<p>a</p>\n<p>b</p>')).length, 2);
  check('stripHtmlTags 不留多余空行', /\n{3,}/.test(M.stripHtmlTags('<p>a</p>\n<p>b</p>')), false);
  // The two naive implementations, run for contrast so the assertions above are
  // known to be able to fail.
  {
    const simple = '<p>a</p>\n<p>b</p>';
    check(
      '朴素做法一（删掉所有标签）会把两段粘成一段',
      M.splitParagraphs(simple.replace(/<\/?[a-z][a-z0-9]*>/gi, '')).length,
      1,
    );
    const everyTagNewline = simple.replace(/<\/?[a-z][a-z0-9]*>/gi, '\n');
    check(
      '朴素做法二（每个标签都换成换行）会在段内多出空行',
      /\n{3,}/.test(everyTagNewline),
      true,
    );
    check('而正确做法保留 2 段', M.splitParagraphs(M.stripHtmlTags(simple)).length, 2);
  }
}

console.log('--- 不变量：跨参数组合 ---');
{
  // A deterministic sweep rather than random sampling, so a failure names the
  // exact combination instead of a seed that changes between runs.
  const units = ['paragraph', 'sentence', 'word'];
  const languages = [LATIN, CHINESE];
  const counts = [0, 1, 2, 5, 17];
  let violations = [];
  let combinations = 0;

  for (const unit of units) {
    for (const language of languages) {
      for (const count of counts) {
        for (const classicOpening of [false, true]) {
          for (const html of [false, true]) {
            combinations += 1;
            const text = generate(31337, { unit, count, language, classicOpening, html });
            // Unwrapping turns each tag into a newline, so an HTML run has a
            // blank line where plain text has one; the blank-line runs are
            // collapsed before the shared invariants run.
            const body = (html ? unwrap(text) : text).replace(/\n{2,}/g, '\n\n').trim();

            if (count === 0) {
              if (body !== '') violations.push(`${unit}/${language}/0 非空`);
              continue;
            }
            if (html && tagProblems(text).length > 0) violations.push(`${unit}/${language}/${count} 标签不平衡`);
            if (!html && /[<>]/.test(text)) violations.push(`${unit}/${language}/${count} 纯文本含尖括号`);
            if (body.split('\n').some((line) => /[ \t]{2,}/.test(line))) {
              violations.push(`${unit}/${language}/${count} 行内连续空格`);
            }
            if (/\n{3,}/.test(html ? unwrap(text) : text)) {
              violations.push(`${unit}/${language}/${count} 段落间多余空行`);
            }

            const stats = M.describeLorem(body, language);
            if (unit === 'paragraph' && stats.paragraphs !== count) {
              violations.push(`${unit}/${language}/${count} 段落数 ${stats.paragraphs}`);
            }
            if (unit === 'sentence' && stats.sentences !== count) {
              violations.push(`${unit}/${language}/${count} 句子数 ${stats.sentences}`);
            }
            if (unit === 'word' && language === LATIN && stats.words !== count) {
              violations.push(`${unit}/${language}/${count} 词数 ${stats.words}`);
            }
            if (unit === 'word' && language === CHINESE) {
              const characters = body.split('').length;
              if (characters < count) violations.push(`${unit}/${language}/${count} 中文字符数不足`);
            }
            if (unit !== 'word' && terminatorCount(body, language) !== (unit === 'sentence' ? count : M.describeLorem(body, language).sentences)) {
              violations.push(`${unit}/${language}/${count} 句末标点数与句子数不一致`);
            }
            if (language === LATIN && unit !== 'word' && M.invalidWords(latinTokens(body), LATIN).length > 0) {
              violations.push(`${unit}/${language}/${count} 出现词库外的词`);
            }
            if (language === LATIN && unit !== 'word' && !/^[A-Z]/.test(body)) {
              violations.push(`${unit}/${language}/${count} 首字母未大写`);
            }
            if (language === CHINESE && /[A-Za-z]/.test(body)) {
              violations.push(`${unit}/${language}/${count} 中文里混入拉丁字母`);
            }
          }
        }
      }
    }
  }

  check('3×2×5×2×2 = 120 种参数组合全部满足不变量', violations, []);
  check('参数组合确实跑满', combinations, 120);
}

console.log('--- 统计与切分辅助 ---');
{
  check('空文本没有段落', M.splitParagraphs(''), []);
  check('只有空白也算空', M.splitParagraphs('   \n  '), []);
  check('单段', M.splitParagraphs('a').length, 1);
  check('空行分段', M.splitParagraphs('a\n\nb\n\nc').length, 3);
  check('三个换行只算一次分段', M.splitParagraphs('a\n\n\n\nb').length, 2);
  check('拉丁分句', M.splitSentences('A B. C D.', LATIN).length, 2);
  check('中文分句', M.splitSentences('这是占位。那是占位。', CHINESE).length, 2);
  check('空文本没有句子', M.splitSentences('', LATIN), []);
  check('拉丁词计数', M.describeLorem('lorem ipsum dolor', LATIN).words, 3);
  check('统计里的字符数包含空格与标点', M.describeLorem('a b.', LATIN).characters, 4);
  check('invalidWords 能报告词库外的词', M.invalidWords(['lorem', 'zzz'], LATIN), ['zzz']);
  check('invalidWords 对合法词返回空', M.invalidWords(['lorem', 'ipsum'], LATIN), []);
  check('wordBank 两个语言都有内容', [M.wordBank(LATIN).length > 0, M.wordBank(CHINESE).length > 0], [true, true]);
  check('句末标点按语言区分', [M.sentenceEnd(LATIN), M.sentenceEnd(CHINESE)], ['.', '。']);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
