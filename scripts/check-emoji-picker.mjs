/**
 * Checks the emoji picker's table and analysis.
 *
 * The claims worth defending are "the table is data, not a pile of encoding
 * accidents" and "the counts are the platform's, not ours". So the reference
 * here is not a second implementation of code-point counting: it is the
 * platform itself. `codePointAt` plus the string iterator define what a code
 * point is, `TextEncoder` defines the UTF-8 bytes, Node's `Buffer` is an
 * independent second encoder used to cross-check them, and `encodeURIComponent`
 * is used as a third witness because it throws on a lone surrogate — which is
 * exactly what a mistyped emoji literal produces.
 *
 * A hand-written check would get the family emoji wrong in the same direction
 * as a hand-written tool would, which is why the two are never compared to each
 * other: the numbers below are asserted against U+1F468 U+200D U+1F469 U+200D
 * U+1F467 and its known 8 UTF-16 units and 18 UTF-8 bytes.
 *
 * Usage: node scripts/check-emoji-picker.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const OUT_DIR = '.verify/emoji-picker';
mkdirSync(OUT_DIR, { recursive: true });

const compilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 };

writeFileSync(
  `${OUT_DIR}/emojiTable.mjs`,
  ts.transpileModule(readFileSync('src/tools/emoji-picker/emojiTable.ts', 'utf8'), {
    compilerOptions,
  }).outputText,
);

// Node's ESM resolver does not add file extensions, so the compiled utils are
// pointed at the compiled table explicitly.
const utilsSource = ts
  .transpileModule(readFileSync('src/tools/emoji-picker/emojiPickerUtils.ts', 'utf8'), {
    compilerOptions,
  })
  .outputText.replace("from './emojiTable'", "from './emojiTable.mjs'");
writeFileSync(`${OUT_DIR}/emojiPickerUtils.mjs`, utilsSource);

const T = await import(pathToFileURL(`${OUT_DIR}/emojiTable.mjs`).href);
const M = await import(pathToFileURL(`${OUT_DIR}/emojiPickerUtils.mjs`).href);

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

/** Reports a list of collected problems, printing the first few. */
function checkNoProblems(label, problems) {
  if (problems.length > 0) {
    console.log(`        ${problems.slice(0, 8).join('\n        ')}`);
  }
  check(label, problems.length, 0);
}

const entries = [...M.EMOJI];

console.log('--- 表结构与分类 ---');
{
  check('内置 emoji 数量在「几百个」的范围内（>=300 且 <1000）', entries.length >= 300 && entries.length < 1000, true);
  check('EMOJI_TOTAL 与实际条目数一致', M.EMOJI_TOTAL, entries.length);
  check('分类 id 正好是规范要求的 8 类，且顺序固定', [...T.EMOJI_CATEGORY_IDS], [
    'smileys',
    'people',
    'animals',
    'food',
    'activities',
    'travel',
    'objects',
    'symbols',
  ]);
  check('分类中文名与规范一致', T.EMOJI_CATEGORY_IDS.map((id) => T.EMOJI_CATEGORY_LABELS[id]), [
    '笑脸',
    '人物',
    '动物',
    '食物',
    '活动',
    '旅行',
    '物件',
    '符号',
  ]);

  const empty = M.EMOJI_CATEGORIES.filter((category) => category.entries.length === 0).map((c) => c.id);
  checkNoProblems('每个分类都非空', empty);
  const small = M.EMOJI_CATEGORIES.filter(
    (category) => category.entries.length < 20 && category.entries.length > 0,
  ).map((c) => `${c.id}=${c.entries.length}`);
  checkNoProblems('每个分类至少 20 个条目（否则这个分类没有存在意义）', small);

  check(
    '分类表的条目加起来等于全部条目',
    M.EMOJI_CATEGORIES.reduce((sum, category) => sum + category.entries.length, 0),
    entries.length,
  );
  check(
    '每个条目的分类都在 8 类之内，且与所属分类一致',
    M.EMOJI_CATEGORIES.every((category) =>
      category.entries.every((entry) => entry.category === category.id && T.EMOJI_CATEGORY_IDS.includes(entry.category)),
    ),
    true,
  );
  check('entriesForCategory 与分类表一致', M.entriesForCategory('food').length, M.EMOJI_CATEGORIES[3].entries.length);

  check('界面说明里写明了这是精选子集而非全量', M.EMOJI_SUBSET_NOTE.includes('不是全量'), true);
  check('界面说明里带上了实际条目数', M.EMOJI_SUBSET_NOTE.includes(String(entries.length)), true);
}

console.log('--- 每个 emoji 的码点、码元与字节（以平台 API 为准） ---');
{
  const problems = [];
  const seen = new Map();

  for (const entry of entries) {
    const { char, name, keywords } = entry;
    const where = `${char} ${name}`;

    if (name.trim() === '') problems.push(`${JSON.stringify(char)} 没有中文名`);
    if (keywords.trim() === '') problems.push(`${where} 没有英文关键词`);

    // 1. Code points: the string iterator is the definition.
    const iteratorPoints = [...char].map((piece) => piece.codePointAt(0));
    const analysis = M.analyseEmoji(char);
    if (JSON.stringify(iteratorPoints) !== JSON.stringify(analysis.codePoints)) {
      problems.push(`${where}：码点序列与字符串迭代器不一致`);
    }
    if (analysis.codePointCount !== iteratorPoints.length) {
      problems.push(`${where}：码点数量与迭代器不一致`);
    }

    // 2. Round trip: the code points must rebuild the exact same string.
    if (String.fromCodePoint(...analysis.codePoints) !== char) {
      problems.push(`${where}：码点无法还原为原字符串`);
    }

    // 3. Code units vs code points, computed independently: every code point
    //    above U+FFFF costs two UTF-16 units and one code point.
    const astral = analysis.codePoints.filter((codePoint) => codePoint > 0xffff).length;
    if (analysis.utf16Units !== char.length) {
      problems.push(`${where}：码元数与 .length 不一致`);
    }
    if (analysis.utf16Units !== analysis.codePointCount + astral) {
      problems.push(`${where}：码元数 != 码点数 + 增补平面码点数`);
    }
    for (const piece of char) {
      if (piece.length !== (piece.codePointAt(0) > 0xffff ? 2 : 1)) {
        problems.push(`${where}：码点 ${M.formatCodePoint(piece.codePointAt(0))} 的码元数异常`);
      }
    }

    // 4. No lone surrogates and no surrogate-range code points. Node's
    //    encodeURIComponent throws a URIError on an unpaired surrogate, which is
    //    the cheapest platform witness for "this literal really is valid text".
    const hasSurrogatePoint = analysis.codePoints.some((codePoint) => codePoint >= 0xd800 && codePoint <= 0xdfff);
    if (hasSurrogatePoint) problems.push(`${where}：码点落在代理区`);
    for (let index = 0; index < char.length; index += 1) {
      const unit = char.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = char.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) problems.push(`${where}：第 ${index} 个位置是高代理但没有配对`);
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        const previous = char.charCodeAt(index - 1);
        if (!(previous >= 0xd800 && previous <= 0xdbff)) problems.push(`${where}：第 ${index} 个位置是孤立低代理`);
      }
    }
    try {
      const encoded = encodeURIComponent(char);
      if (decodeURIComponent(encoded) !== char) problems.push(`${where}：encodeURIComponent 往返不一致`);
    } catch {
      problems.push(`${where}：encodeURIComponent 抛错，说明字面量里有孤立代理`);
    }

    // 5. UTF-8 bytes: TextEncoder is the authority, Buffer the second opinion.
    const encoderBytes = [...new TextEncoder().encode(char)];
    const bufferBytes = [...Buffer.from(char, 'utf8')];
    if (JSON.stringify(encoderBytes) !== JSON.stringify(analysis.utf8Bytes)) {
      problems.push(`${where}：UTF-8 字节与 TextEncoder 不一致`);
    }
    if (JSON.stringify(bufferBytes) !== JSON.stringify(encoderBytes)) {
      problems.push(`${where}：Buffer 与 TextEncoder 的 UTF-8 结果不同`);
    }
    if (analysis.utf8ByteCount !== analysis.utf8Bytes.length) {
      problems.push(`${where}：字节数字段与实际字节数不符`);
    }
    if (analysis.utf8Hex !== analysis.utf8Bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')) {
      problems.push(`${where}：十六进制字节串与字节数组不符`);
    }
    if (analysis.utf8Hex.split(' ').length !== analysis.utf8Bytes.length) {
      problems.push(`${where}：十六进制字节串长度不对`);
    }
    if (analysis.utf8ByteCount < analysis.codePointCount) {
      problems.push(`${where}：UTF-8 字节数不可能少于码点数`);
    }

    // 6. The labels shown in the UI must map back to the same code points.
    const labelsOk =
      analysis.codePointLabels.length === analysis.codePointCount &&
      analysis.codePointLabels.every((label, index) => {
        if (!/^U\+[0-9A-F]{4,6}$/.test(label)) return false;
        return parseInt(label.slice(2), 16) === analysis.codePoints[index];
      });
    if (!labelsOk) problems.push(`${where}：U+ 标签与实际码点不符`);

    // 7. ZWJ sequences: well-formed alternation, and the component count is
    //    one more than the number of joiners.
    const points = analysis.codePoints;
    if (points[0] === M.ZWJ || points[points.length - 1] === M.ZWJ) {
      problems.push(`${where}：ZWJ 出现在开头或结尾`);
    }
    for (let index = 1; index < points.length; index += 1) {
      if (points[index] === M.ZWJ && points[index - 1] === M.ZWJ) problems.push(`${where}：连续两个 ZWJ`);
    }
    if (analysis.componentCount !== analysis.zwjCount + 1) problems.push(`${where}：组件数不等于 ZWJ 数加一`);

    // 8. Variation selectors must not lead or double up, and must not follow a
    //    joiner (a joiner needs a base on both sides).
    if (points[0] === 0xfe0f) problems.push(`${where}：变体选择符出现在开头`);
    for (let index = 1; index < points.length; index += 1) {
      if (points[index] === 0xfe0f && (points[index - 1] === 0xfe0f || points[index - 1] === M.ZWJ)) {
        problems.push(`${where}：变体选择符位置非法`);
      }
    }

    // 9. Keycaps have exactly one shape: base, variation selector, U+20E3.
    if (points.includes(0x20e3)) {
      const ok =
        points.length === 3 &&
        points[1] === 0xfe0f &&
        points[2] === 0x20e3 &&
        '0123456789#*'.includes(String.fromCodePoint(points[0]));
      if (!ok) problems.push(`${where}：键帽序列形状不对`);
    }

    // 10. No skin-tone variants, which the UI promises.
    if (points.some((codePoint) => codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)) {
      problems.push(`${where}：包含肤色修饰符，与界面承诺不符`);
    }

    // 11. Composition stability: no decomposed sequence hiding in the table.
    if (char.normalize('NFC') !== char) problems.push(`${where}：NFC 归一化后会改变`);

    if (seen.has(char)) problems.push(`${where}：与「${seen.get(char)}」重复`);
    else seen.set(char, name);
  }

  checkNoProblems(`全部 ${entries.length} 个 emoji 的码点、码元、字节与字面量自洽（平台 API 为准）`, problems);
  check('没有重复的 emoji', seen.size, entries.length);

  const names = entries.map((entry) => entry.name);
  const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
  checkNoProblems('中文名互不重复（同一个名字出现在两个 emoji 上会让人选错）', [...new Set(duplicateNames)]);

  const singlePoint = entries.filter((entry) => M.analyseEmoji(entry.char).codePointCount === 1).length;
  check('表里确实同时有单码点与组合序列', singlePoint > 0 && singlePoint < entries.length, true);
  const zwjEntries = entries.filter((entry) => M.analyseEmoji(entry.char).zwjCount > 0);
  check('表里确实包含 ZWJ 组合序列（否则这项检查没有覆盖到）', zwjEntries.length > 0, true);
}

console.log('--- ZWJ 序列：为什么 emoji 在代码里那么长 ---');
{
  const family3 = '👨‍👩‍👧';
  const info3 = M.analyseEmoji(family3);
  check(
    '家庭 emoji（三人）的码点序列正是 U+1F468 U+200D U+1F469 U+200D U+1F467',
    info3.codePointLabels,
    ['U+1F468', 'U+200D', 'U+1F469', 'U+200D', 'U+1F467'],
  );
  check('它的码点数是 5（不是 1）', info3.codePointCount, 5);
  check('它的 UTF-16 码元数是 8（.length 会给出 8）', info3.utf16Units, 8);
  check('它的 UTF-8 字节数是 18', info3.utf8ByteCount, 18);
  check('它由 3 个 emoji 组成', info3.componentCount, 3);
  check(
    '它的 UTF-8 字节逐个正确',
    info3.utf8Hex,
    'F0 9F 91 A8 E2 80 8D F0 9F 91 A9 E2 80 8D F0 9F 91 A7',
  );

  const family4 = '👨‍👩‍👧‍👦';
  const info4 = M.analyseEmoji(family4);
  check('一家四口是 7 个码点', info4.codePointCount, 7);
  check('一家四口是 11 个 UTF-16 码元', info4.utf16Units, 11);
  check('一家四口是 25 个 UTF-8 字节', info4.utf8ByteCount, 25);
  check('一家四口由 4 个 emoji 组成', info4.componentCount, 4);

  const grin = M.analyseEmoji('😀');
  check('单个 emoji 是 1 个码点', grin.codePointCount, 1);
  check('单个 emoji 在 UTF-16 里占 2 个码元', grin.utf16Units, 2);
  check('单个 emoji 占 4 个 UTF-8 字节', grin.utf8ByteCount, 4);
  check('单个 emoji 的说明文字点出三者一致', M.describeAnalysis(grin).includes('单个码点'), true);
  check('组合序列的说明文字点出 ZWJ', M.describeAnalysis(info3).includes('ZWJ'), true);

  const keycap = M.analyseEmoji('1️⃣');
  check('键帽 1️⃣ 是 3 个码点', keycap.codePointLabels, ['U+0031', 'U+FE0F', 'U+20E3']);
  check('键帽 1️⃣ 占 7 个 UTF-8 字节', keycap.utf8ByteCount, 7);
  check('键帽没有 ZWJ', keycap.zwjCount, 0);
  check('键帽的组件数按 1 处理（没有 ZWJ 可数）', keycap.componentCount, 1);
  check('键帽的说明文字指出它不是单个字符', M.describeAnalysis(keycap).includes('组合序列'), true);

  const heart = M.analyseEmoji('❤️');
  check('带变体选择符的红心是 2 个码点', heart.codePointLabels, ['U+2764', 'U+FE0F']);
  // U+2764 is 3 bytes and U+FE0F is another 3: the invisible variation selector
  // costs as much as the visible heart.
  check('带变体选择符的红心占 6 个 UTF-8 字节（不可见的选择符和红心本身一样占 3 字节）', heart.utf8ByteCount, 6);

  // The naive answer, shown to be wrong: string.split('') cuts surrogate pairs
  // in half, and .length counts units. Both are what a hand-rolled counter
  // reaches for first.
  check('朴素写法 char.length 会把家庭 emoji 数成 8', family3.length, 8);
  check('朴素写法 split("").length 同样是 8（代理对被劈成两半）', family3.split('').length, 8);
  check('正确写法（码点）是 5', [...family3].length, 5);
  check('两种数法确实不同，说明这项检查有区分力', family3.length !== [...family3].length, true);
}

console.log('--- 搜索 ---');
{
  check('空查询返回全部条目', M.searchEmoji('').length, entries.length);
  check('只有空白的查询也返回全部', M.searchEmoji('   ').length, entries.length);

  const chinese = M.searchEmoji('笑');
  check('中文关键词能搜到结果', chinese.length > 0, true);
  check(
    '中文搜索结果都命中名称、关键词或分类名',
    chinese.every((entry) =>
      `${T.EMOJI_CATEGORY_LABELS[entry.category]} ${entry.name} ${entry.keywords}`.includes('笑'),
    ),
    true,
  );
  check(
    '搜索「笑」会命中整个笑脸分类（分类中文名也参与匹配）',
    chinese.length >= M.entriesForCategory('smileys').length,
    true,
  );
  check('中文搜索能搜到咧嘴笑', chinese.some((entry) => entry.char === '😀'), true);

  const english = M.searchEmoji('grin');
  check('英文关键词能搜到咧嘴笑', english.some((entry) => entry.char === '😀'), true);
  check('英文搜索不区分大小写', M.searchEmoji('GRIN').map((e) => e.char), english.map((e) => e.char));
  check(
    '英文搜索结果的关键词里确实含该词',
    english.every((entry) => entry.keywords.toLowerCase().includes('grin')),
    true,
  );

  const andSearch = M.searchEmoji('red heart');
  check('多个关键词是「都要满足」而不是「满足其一」', andSearch.map((entry) => entry.char), ['❤️']);
  check('关键词顺序不影响结果', M.searchEmoji('heart red').map((e) => e.char), ['❤️']);
  check('多余空白不影响结果', M.searchEmoji('  red   heart  ').map((e) => e.char), ['❤️']);

  const emojiSearch = M.searchEmoji('family');
  check('family 能搜到家庭 emoji', emojiSearch.some((entry) => entry.char === '👨‍👩‍👧'), true);

  const byCategory = M.searchEmoji('食物');
  check('按分类中文名可以搜出整个分类', byCategory.length, M.entriesForCategory('food').length);
  check('分类搜索的结果都属于该分类', byCategory.every((entry) => entry.category === 'food'), true);

  check('搜不到时返回空数组而不是全部', M.searchEmoji('zzzznotanemoji'), []);
  check('中文搜不到时也返回空数组', M.searchEmoji('给力'), []);
  check('搜索结果是新数组，改动它不会污染表', M.searchEmoji('') !== M.EMOJI, true);
}

console.log('--- 解析器对坏数据的态度 ---');
{
  const good = { ...T.EMOJI_TABLE };
  check('解析内置表得到的条目数与导出一致', M.parseEmojiTable(good).length, entries.length);
  check(
    '解析结果保持分类顺序',
    M.parseEmojiTable(good).slice(0, 1)[0].category,
    'smileys',
  );

  const badFieldCount = { ...good, smileys: '😀|笑脸' };
  let threw = '';
  try {
    M.parseEmojiTable(badFieldCount);
  } catch (error) {
    threw = String(error.message);
  }
  check('字段数不对时抛错而不是静默丢弃', threw.includes('expected 3 fields'), true);

  const emptyName = { ...good, smileys: '😀||smile' };
  threw = '';
  try {
    M.parseEmojiTable(emptyName);
  } catch (error) {
    threw = String(error.message);
  }
  check('字段为空时抛错', threw.includes('empty field'), true);

  const missingBlock = { ...good, symbols: undefined };
  threw = '';
  try {
    M.parseEmojiTable(missingBlock);
  } catch (error) {
    threw = String(error.message);
  }
  check('缺少分类块时抛错', threw.includes('missing'), true);

  check('空表块被容忍（全空行视为没有条目）', M.parseEmojiTable({ ...good, smileys: '\n\n' }).length, entries.length - M.entriesForCategory('smileys').length);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
