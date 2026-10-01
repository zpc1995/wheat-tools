/**
 * Checks the list format converter.
 *
 * Oracles, in decreasing order of independence:
 *
 *   1. **`JSON.parse`** (the platform) for every JSON array the tool generates.
 *   2. **The `yaml` package** for every YAML sequence it generates: the
 *      serializer is ours, the reader is the standard implementation, so the
 *      two disagreeing is a real bug in the output rather than a shared idea.
 *   3. **CPython's `sqlite3`, `html.parser` and `html.unescape`** — the SQL
 *      fragment is executed, the HTML is parsed by a real HTML parser and the
 *      escaping is compared with SQLite's own `quote()`. These cross-checks
 *      skip themselves with a note when python3 is unavailable.
 *   4. **A second, differently written HTML tokenizer** in this file, so the
 *      HTML assertions still have an independent reader without python3.
 *   5. **Round trips**: for every format, items -> text -> items must return the
 *      same items, for random items containing the characters each format is
 *      supposed to escape.
 *
 * The naive implementations this tool exists to avoid are also implemented here
 * and asserted to be broken, so the suite has teeth.
 *
 * Usage: node scripts/check-list-converter.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/list-converter/listConverterUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/list-converter.mjs', compiled);
const M = await import(pathToFileURL('.verify/list-converter.mjs').href);

// The same library the implementation parses YAML with, used here as the
// authority on what the generated YAML means.
const YAML = await import('yaml');

let passed = 0;
let failed = 0;
let skipped = 0;
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
function skip(label) {
  skipped += 1;
  console.log(`SKIP  ${label}`);
}

const serialize = (items, format, options) => M.serializeList(items, format, options);
const parse = (text, format) => M.parseList(text, format).items;
const parseError = (text, format) => M.parseList(text, format).error;

// ---------------------------------------------------------------------------
// Deterministic pseudo-random source.
// ---------------------------------------------------------------------------
let seed = 987654321;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function pick(list) {
  return list[Math.floor(rand() * list.length)];
}

// Characters with a special meaning in at least one of the formats, plus text
// that must survive byte-wise.
const ALPHABET = [
  'a', 'b', 'Z', '1', '42', '007', 'true', 'null', '中', '小麦', '😀',
  ' ', '  ', ',', ';', '|', '\t', '"', "'", '\\', '&', '<', '>', ':', '#',
  '-', '- item', '1. item', '<li>', '&amp;', '\n', '\r\n', '\r', '', 'a,b',
  'it\'s', ' say "hi" ', '\u00a0',
];
const WITHOUT_CR = ALPHABET.filter((value) => !value.includes('\r'));
const WITHOUT_NEWLINE = ALPHABET.filter((value) => !value.includes('\n') && !value.includes('\r'));

function randomItems(alphabet, maxCount = 5) {
  const count = Math.floor(rand() * (maxCount + 1));
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const length = Math.floor(rand() * 4);
    let value = '';
    for (let part = 0; part < length; part += 1) value += pick(alphabet);
    items.push(value);
  }
  return items;
}

console.log('--- JSON：以 JSON.parse 为权威参照物 ---');
{
  check('紧凑输出', M.itemsToJson(['a', 'b'], 0), '["a","b"]');
  check('缩进输出', M.itemsToJson(['a'], 2), '[\n  "a"\n]');
  check('空数组', M.itemsToJson([], 0), '[]');
  check('双引号转义', M.itemsToJson(['say "hi"'], 0), '["say \\"hi\\""]');
  check('换行转义', M.itemsToJson(['a\nb'], 0), '["a\\nb"]');
  check('反斜杠转义', M.itemsToJson(['a\\b'], 0), '["a\\\\b"]');
  check('emoji 不需要转义（但仍是合法 JSON）', M.itemsToJson(['😀'], 0), '["😀"]');

  const corpus = [
    [],
    ['a'],
    [''],
    ['a,b', 'c'],
    ['say "hi"', "it's"],
    ['line1\nline2'],
    ['反斜杠 \\ 与制表符 \t'],
    ['中文', '😀', '\u0000'],
    ['<li>&amp;</li>'],
  ];
  let parseFailures = 0;
  for (const items of corpus) {
    const text = M.itemsToJson(items, 0);
    try {
      if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(items)) parseFailures += 1;
    } catch {
      parseFailures += 1;
    }
  }
  check(`语料库 ${corpus.length} 例生成的 JSON 都能被 JSON.parse 还原`, parseFailures, 0);

  let randomFailures = 0;
  for (let round = 0; round < 200; round += 1) {
    const items = randomItems(ALPHABET);
    const text = M.itemsToJson(items, round % 2 === 0 ? 0 : 2);
    try {
      if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(items)) randomFailures += 1;
    } catch {
      randomFailures += 1;
    }
  }
  check('200 组随机项生成的 JSON 都能被 JSON.parse 还原', randomFailures, 0);

  check('解析 JSON 数组', parse('["a","b"]', 'json'), ['a', 'b']);
  check('解析带转义的 JSON', parse('["say \\"hi\\"", "a\\nb"]', 'json'), ['say "hi"', 'a\nb']);
  check('数字与布尔转成字符串', parse('[1, true, null]', 'json'), ['1', 'true', '']);
  check('顶层不是数组会报错', parseError('{"a":1}', 'json') !== null, true);
  check('非法 JSON 会报错', parseError('[1,', 'json') !== null, true);
  check('数组里有对象会报错', parseError('[{"a":1}]', 'json') !== null, true);
}

console.log('--- 逗号 / 分号 / 空格 / 制表符分隔 ---');
{
  check('逗号分隔解析', parse('a, b, c', 'comma'), ['a', 'b', 'c']);
  check('空字段被忽略', parse('a,,b', 'comma'), ['a', 'b']);
  check('只有空白的字段被忽略', parse('a, ,b', 'comma'), ['a', 'b']);
  check('带引号的字段保留分隔符', parse('"a,b",c', 'comma'), ['a,b', 'c']);
  check('双双引号还原', parse('"say ""hi""",c', 'comma'), ['say "hi"', 'c']);
  check('引号内的空格保留', parse('" a ", b ', 'comma'), [' a ', 'b']);
  check('换行也算分隔符', parse('a,b\nc', 'comma'), ['a', 'b', 'c']);
  check('引号内的换行保留', parse('"a\nb",c', 'comma'), ['a\nb', 'c']);
  check('分号分隔', parse('a; b; c', 'semicolon'), ['a', 'b', 'c']);
  check('空格分隔', parse('a b c', 'space'), ['a', 'b', 'c']);
  check('连续空格不产生空项', parse('a  b', 'space'), ['a', 'b']);
  check('空格分隔里的空项写成空引号', parse('a "" b', 'space'), ['a', '', 'b']);
  check('制表符分隔', parse('a\tb\tc', 'tab'), ['a', 'b', 'c']);
  check('空输入是空列表', parse('', 'comma'), []);
  check('未闭合的引号报错', parseError('"a', 'comma') !== null, true);

  check('生成逗号分隔', serialize(['a', 'b'], 'comma'), 'a,b');
  check('含逗号的项加引号', serialize(['a,b', 'c'], 'comma'), '"a,b",c');
  check('含引号的项加引号并翻倍', serialize(['say "hi"'], 'comma'), '"say ""hi"""');
  check('含换行的项加引号', serialize(['a\nb'], 'comma'), '"a\nb"');
  check('首尾空白加引号', serialize([' a '], 'comma'), '" a "');
  check('空项写成空引号', serialize([''], 'comma'), '""');
  check('空格分隔的生成', serialize(['a', 'b'], 'space'), 'a b');
  check('含空格的项在空格分隔里加引号', serialize(['a b', 'c'], 'space'), '"a b" c');
  check('制表符分隔的生成', serialize(['a', 'b'], 'tab'), 'a\tb');

  for (const format of ['comma', 'semicolon', 'space', 'tab']) {
    let mismatches = 0;
    let samples = 0;
    for (let round = 0; round < 200; round += 1) {
      const items = randomItems(ALPHABET);
      const back = parse(serialize(items, format), format);
      samples += 1;
      if (JSON.stringify(back) !== JSON.stringify(items)) {
        mismatches += 1;
        if (mismatches === 1) {
          console.log(`        ${format}: ${JSON.stringify(items)} -> ${JSON.stringify(serialize(items, format))} -> ${JSON.stringify(back)}`);
        }
      }
    }
    check(`${format}：${samples} 组随机项往返一致`, mismatches, 0);
  }
}

console.log('--- SQL IN 列表 ---');
{
  check('全部加引号', M.itemsToSql(['a', 'b'], 'string'), "('a', 'b')");
  check('单引号翻倍（SQL 标准）', M.itemsToSql(["it's"], 'string'), "('it''s')");
  check('空列表是空括号', M.itemsToSql([], 'string'), '()');
  check('空字符串是空字面量', M.itemsToSql([''], 'string'), "('')");
  check('数字模式不加引号', M.itemsToSql(['1', '2.5'], 'auto'), '(1, 2.5)');
  check('数字模式仍给文本加引号', M.itemsToSql(['1', 'abc'], 'auto'), "(1, 'abc')");
  check('科学计数法算数字', M.itemsToSql(['1e3'], 'auto'), '(1e3)');
  check('前导零仍算数字', M.itemsToSql(['007'], 'auto'), '(007)');
  check('+ 号开头算数字', M.itemsToSql(['+5'], 'auto'), '(+5)');
  check('看起来像版本的文本加引号', M.itemsToSql(['1.2.3'], 'auto'), "('1.2.3')");

  check('解析带 IN 前缀', parse("IN ('a','b')", 'sql'), ['a', 'b']);
  check('解析小写 in', parse("in ( 'a' , 'b' )", 'sql'), ['a', 'b']);
  check('解析裸括号列表', parse("('a','b')", 'sql'), ['a', 'b']);
  check('解析不带括号的列表', parse("'a', 'b'", 'sql'), ['a', 'b']);
  check('解析末尾的分号', parse("('a','b');", 'sql'), ['a', 'b']);
  check('解析数字（不加引号）', parse('(1, 2)', 'sql'), ['1', '2']);
  check('解析翻倍的单引号', parse("('it''s')", 'sql'), ["it's"]);
  check('解析空列表', parse('()', 'sql'), []);
  check('解析带换行的值', parse("('a\nb')", 'sql'), ['a\nb']);
  check('未闭合的字符串报错', parseError("('a)", 'sql') !== null, true);

  for (const quoting of ['string', 'auto']) {
    let mismatches = 0;
    for (let round = 0; round < 200; round += 1) {
      const items = randomItems(ALPHABET);
      const back = parse(M.itemsToSql(items, quoting), 'sql');
      if (JSON.stringify(back) !== JSON.stringify(items)) {
        mismatches += 1;
        if (mismatches === 1) {
          console.log(`        ${quoting}: ${JSON.stringify(items)} -> ${M.itemsToSql(items, quoting)} -> ${JSON.stringify(back)}`);
        }
      }
    }
    check(`SQL 引号模式 ${quoting}：200 组随机项往返一致`, mismatches, 0);
  }
}

console.log('--- Markdown / 有序列表 / 每行一项 ---');
{
  check('Markdown 生成', serialize(['a', 'b'], 'markdown'), '- a\n- b');
  check('Markdown 空项写成裸标记', serialize(['', 'a'], 'markdown'), '-\n- a');
  check('Markdown 多行项用缩进续行', serialize(['a\nb'], 'markdown'), '- a\n  b');
  check('Markdown 项内的行首空格保留', serialize(['a\n  b'], 'markdown'), '- a\n    b');
  check('有序列表生成', serialize(['a', 'b'], 'ordered'), '1. a\n2. b');
  check('有序列表编号连续', serialize(['a', 'b', 'c'], 'ordered').split('\n').map((l) => l.slice(0, 2)), ['1.', '2.', '3.']);
  check('有序列表到两位数时续行缩进对齐', serialize(['a\nb'], 'ordered'), '1. a\n   b');

  check('解析 Markdown 列表', parse('- a\n- b', 'markdown'), ['a', 'b']);
  check('解析星号标记', parse('* a\n* b', 'markdown'), ['a', 'b']);
  check('解析多行项', parse('- a\n  b', 'markdown'), ['a\nb']);
  check('不把缩进的项内标记当成新项', parse('- a\n  - b', 'markdown'), ['a\n- b']);
  check('解析有序列表', parse('1. a\n2. b', 'ordered'), ['a', 'b']);
  check('解析 ) 编号', parse('1) a\n2) b', 'ordered'), ['a', 'b']);
  check('解析两位编号的续行', parse('9. a\n10. b\n    c', 'ordered'), ['a', 'b\nc']);
  check('空项（裸标记）', parse('-\n- a', 'markdown'), ['', 'a']);
  check('没有标记时按每行一项处理', parse('a\nb', 'markdown'), ['a', 'b']);

  check('每行一项生成', serialize(['a', 'b'], 'lines'), 'a\nb');
  check('每行一项解析', parse('a\nb\n', 'lines'), ['a', 'b']);
  check('末尾换行不产生空项', parse('a\nb\n\n', 'lines'), ['a', 'b']);
  check('每行一项会归一化 CRLF', parse('a\r\nb', 'lines'), ['a', 'b']);
  check('每行一项把项内换行写成多行（该格式没有转义）', parse(serialize(['a\nb'], 'lines'), 'lines'), ['a', 'b']);

  for (const format of ['markdown', 'ordered']) {
    let mismatches = 0;
    for (let round = 0; round < 200; round += 1) {
      const items = randomItems(WITHOUT_CR);
      const back = parse(serialize(items, format), format);
      if (JSON.stringify(back) !== JSON.stringify(items)) {
        mismatches += 1;
        if (mismatches === 1) {
          console.log(`        ${format}: ${JSON.stringify(items)} -> ${JSON.stringify(serialize(items, format))} -> ${JSON.stringify(back)}`);
        }
      }
    }
    check(`${format}：200 组随机项（不含 \\r）往返一致`, mismatches, 0);
  }
  check('Markdown 会把项内的 \\r 归一化为 \\n（文档化的行为）', parse('- a\r\n  b', 'markdown'), ['a\nb']);

  let lineMismatches = 0;
  for (let round = 0; round < 200; round += 1) {
    const items = randomItems(WITHOUT_NEWLINE);
    // A trailing empty item has no representation in this format: it is
    // byte-identical to the line terminator. The documented expectation is that
    // it disappears, so the comparison drops it too.
    const expected = items.slice();
    while (expected.length > 0 && expected[expected.length - 1] === '') expected.pop();
    const back = parse(serialize(items, 'lines'), 'lines');
    if (JSON.stringify(back) !== JSON.stringify(expected)) lineMismatches += 1;
  }
  check('每行一项：200 组不含换行的项往返一致（末尾空项除外）', lineMismatches, 0);
  check(
    '每行一项：末尾的空项无法表示（没有转义可用，文档化的限制）',
    parse(serialize(['a', ''], 'lines'), 'lines'),
    ['a'],
  );
}

console.log('--- HTML ---');
{
  check('转义 & 与尖括号', M.escapeHtmlText('<a & b>'), '&lt;a &amp; b&gt;');
  check('转义双引号', M.escapeHtmlText('say "hi"'), 'say &quot;hi&quot;');
  check('转义单引号', M.escapeHtmlText("it's"), 'it&#39;s');
  check('转义回车（否则会被解析器归一化）', M.escapeHtmlText('a\rb'), 'a&#13;b');
  check('换行原样保留', M.escapeHtmlText('a\nb'), 'a\nb');
  check('要转义的字符只处理一次（&lt; 不会被二次转义）', M.escapeHtmlText('&lt;'), '&amp;lt;');
  check('反转义命名实体', M.unescapeHtmlText('&lt;a&gt; &amp; &quot;q&quot; &#39;s&#39;'), '<a> & "q" \'s\'');
  check('反转义数字实体', M.unescapeHtmlText('&#20013;&#x6587;'), '中文');
  check('未知实体原样保留', M.unescapeHtmlText('&unknown; &amp;'), '&unknown; &');
  check('反转义只做一遍（&amp;lt; 变成 &lt; 而不是 <）', M.unescapeHtmlText('&amp;lt;'), '&lt;');

  check('生成 ul', serialize(['a', 'b'], 'html'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  check(
    '生成 ol',
    serialize(['a', 'b'], 'html', { sqlQuoting: 'string', htmlOrdered: true, indent: 0 }),
    '<ol>\n<li>a</li>\n<li>b</li>\n</ol>',
  );
  check('空列表', serialize([], 'html'), '<ul>\n</ul>');
  check('项内的标记被转义', serialize(['<b>&</b>'], 'html'), '<ul>\n<li>&lt;b&gt;&amp;&lt;/b&gt;</li>\n</ul>');

  check('解析 ul', parse('<ul><li>a</li><li>b</li></ul>', 'html'), ['a', 'b']);
  check('解析大写标签', parse('<UL><LI>a</LI></UL>', 'html'), ['a']);
  check('标签属性被忽略', parse('<ul class="x"><li id="y">a</li></ul>', 'html'), ['a']);
  check('省略的 </li> 也能解析', parse('<ul><li>a<li>b</ul>', 'html'), ['a', 'b']);
  check('项内实体被还原', parse('<ul><li>&lt;b&gt;</li></ul>', 'html'), ['<b>']);
  check('项内换行保留', parse('<ul><li>a\nb</li></ul>', 'html'), ['a\nb']);
  check('项内的其他标签被去掉', parse('<ul><li>a<b>c</b></li></ul>', 'html'), ['ac']);
  check('没有 li 时是空列表', parse('<p>nothing</p>', 'html'), []);

  // An independent reader: a tag tokenizer rather than the implementation's
  // lookahead regex, with its own entity table.
  function referenceHtmlItems(html) {
    const tokens = [];
    let i = 0;
    while (i < html.length) {
      const lt = html.indexOf('<', i);
      if (lt === -1) {
        tokens.push({ type: 'text', value: html.slice(i) });
        break;
      }
      if (lt > i) tokens.push({ type: 'text', value: html.slice(i, lt) });
      const gt = html.indexOf('>', lt);
      if (gt === -1) {
        tokens.push({ type: 'text', value: html.slice(lt) });
        break;
      }
      const raw = html.slice(lt + 1, gt).trim();
      const closing = raw.startsWith('/');
      const name = raw.replace(/^\//, '').split(/[\s/]/)[0].toLowerCase();
      tokens.push({ type: 'tag', name, closing });
      i = gt + 1;
    }
    const items = [];
    let current = null;
    for (const token of tokens) {
      if (token.type === 'tag') {
        if (token.name === 'li' && !token.closing) {
          if (current !== null) items.push(current);
          current = '';
        } else if (token.name === 'li' && token.closing) {
          if (current !== null) {
            items.push(current);
            current = null;
          }
        }
        continue;
      }
      if (current !== null) current += token.value;
    }
    if (current !== null) items.push(current);
    const table = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
    return items.map((value) =>
      value.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g, (whole, dec, hex, name) => {
        if (dec !== undefined) return String.fromCodePoint(Number(dec));
        if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
        return Object.prototype.hasOwnProperty.call(table, name) ? table[name] : whole;
      }),
    );
  }

  let mismatches = 0;
  let samples = 0;
  for (let round = 0; round < 200; round += 1) {
    const items = randomItems(ALPHABET);
    const html = serialize(items, 'html');
    samples += 1;
    if (JSON.stringify(referenceHtmlItems(html)) !== JSON.stringify(items)) {
      mismatches += 1;
      if (mismatches === 1) {
        console.log(`        ${JSON.stringify(items)} -> ${JSON.stringify(html)}`);
        console.log(`        本实现：${JSON.stringify(parse(html, 'html'))}`);
        console.log(`        独立解析器：${JSON.stringify(referenceHtmlItems(html))}`);
      }
    }
    if (JSON.stringify(parse(html, 'html')) !== JSON.stringify(items)) mismatches += 1;
  }
  check(`200 组随机项生成的 HTML 被独立解析器读回原列表`, mismatches, 0);
}

console.log('--- YAML（用 yaml 库作权威参照物） ---');
{
  check('普通文本不加引号', M.yamlScalar('hello'), 'hello');
  check('中文不加引号', M.yamlScalar('小麦'), '小麦');
  check('看起来像布尔要加引号', M.yamlScalar('true'), '"true"');
  check('看起来像 null 要加引号', M.yamlScalar('null'), '"null"');
  check('看起来像数字要加引号', M.yamlScalar('123'), '"123"');
  check('十六进制要加引号', M.yamlScalar('0x1f'), '"0x1f"');
  check('日期要加引号', M.yamlScalar('2024-01-01'), '"2024-01-01"');
  check('含冒号要加引号', M.yamlScalar('a: b'), '"a: b"');
  check('含井号要加引号', M.yamlScalar('a #b'), '"a #b"');
  check('首尾空白要加引号', M.yamlScalar(' a '), '" a "');
  check('换行用转义而不是折行', M.yamlScalar('a\nb'), '"a\\nb"');
  check('空字符串用引号', M.yamlScalar(''), '""');
  check('生成块序列', serialize(['a', 'b'], 'yaml'), '- a\n- b');

  let yamlFailures = 0;
  let samples = 0;
  for (let round = 0; round < 300; round += 1) {
    const items = randomItems(ALPHABET);
    const text = serialize(items, 'yaml');
    samples += 1;
    let parsed;
    try {
      parsed = YAML.parse(text);
    } catch (cause) {
      yamlFailures += 1;
      if (yamlFailures === 1) console.log(`        yaml 库拒绝了生成的输出：${JSON.stringify(text)}（${cause.message}）`);
      continue;
    }
    // An empty document is the empty list; that mapping is the tool's contract
    // and is asserted separately.
    const value = parsed === null ? [] : parsed;
    if (JSON.stringify(value) !== JSON.stringify(items)) {
      yamlFailures += 1;
      if (yamlFailures === 1) {
        console.log(`        ${JSON.stringify(items)} -> ${JSON.stringify(text)} -> ${JSON.stringify(parsed)}`);
      }
    }
    if (JSON.stringify(parse(text, 'yaml')) !== JSON.stringify(items)) yamlFailures += 1;
  }
  check(`${samples} 组随机项生成的 YAML 被 yaml 库读回原列表（含类型不被隐式转换）`, yamlFailures, 0);

  check('解析 YAML 块序列', parse('- a\n- b', 'yaml'), ['a', 'b']);
  check('解析带引号的标量', parse('- "true"\n- \'a b\'', 'yaml'), ['true', 'a b']);
  check('取消引号里的转义', parse('- "a\\nb"', 'yaml'), ['a\nb']);
  check('解析折叠写法', parse('- a\n  b', 'yaml'), ['a b']);
  check('空列表', parse('', 'yaml'), []);
  check('顶层是映射时报错', parseError('a: 1', 'yaml') !== null, true);
  check('含嵌套结构时报错', parseError('- a: 1', 'yaml') !== null, true);
}

console.log('--- 跨格式转换链 ---');
{
  const items = ['苹果', '含,逗号', 'say "hi"', "it's", '<b>&</b>', 'a b', '😀'];
  const viaJson = parse(serialize(items, 'json'), 'json');
  const viaSql = parse(M.itemsToSql(viaJson, 'string'), 'sql');
  const viaMarkdown = parse(serialize(viaSql, 'markdown'), 'markdown');
  const back = parse(serialize(viaMarkdown, 'lines'), 'lines');
  check('换行 -> JSON -> SQL -> Markdown -> 换行 回到原列表', back, items);

  const chain2 = parse(serialize(parse(serialize(items, 'yaml'), 'yaml'), 'html'), 'html');
  check('YAML -> HTML 的跨格式链也回到原列表', chain2, items);
}

console.log('--- 清洗选项 ---');
{
  const run = (items, options) => M.normalizeItems(items, options);
  const none = { trim: false, dropEmpty: false, dedupe: false, sort: false };
  check('去空白', run([' a ', 'b'], { ...none, trim: true }), ['a', 'b']);
  check('忽略空项（配合去空白）', run(['a', ' ', 'b'], { ...none, trim: true, dropEmpty: true }), ['a', 'b']);
  check('去重保留首次出现', run(['b', 'a', 'b'], { ...none, dedupe: true }), ['b', 'a']);
  check('去空白后再去重', run([' a', 'a '], { ...none, trim: true, dedupe: true }), ['a']);
  check('排序', run(['b', 'c', 'a'], { ...none, sort: true }), ['a', 'b', 'c']);
  check('排序带数字感知', run(['item10', 'item2'], { ...none, sort: true }), ['item2', 'item10']);
  check('不做任何处理时保持原样', run([' b ', 'a'], none), [' b ', 'a']);
  check('组合：去空白 + 忽略空项 + 去重 + 排序', run([' b ', 'a', ' b', ''], { trim: true, dropEmpty: true, dedupe: true, sort: true }), ['a', 'b']);
}

console.log('--- 输入格式识别 ---');
{
  check('空文本', M.detectFormat(''), 'lines');
  check('JSON 数组', M.detectFormat('["a", "b"]'), 'json');
  check('不是数组的 JSON 不会被识别为 JSON 数组', M.detectFormat('{"a": 1}') !== 'json', true);
  check('SQL IN', M.detectFormat("IN ('a', 'b')"), 'sql');
  check('裸括号也是 SQL', M.detectFormat("('a', 'b')"), 'sql');
  check('HTML 列表', M.detectFormat('<ul><li>a</li></ul>'), 'html');
  check('有序列表', M.detectFormat('1. a\n2. b'), 'ordered');
  check('Markdown / YAML 列表', M.detectFormat('- a\n- b'), 'markdown');
  check('制表符分隔', M.detectFormat('a\tb'), 'tab');
  check('分号分隔', M.detectFormat('a; b'), 'semicolon');
  check('逗号分隔', M.detectFormat('a, b'), 'comma');
  check('空格分隔', M.detectFormat('a b c'), 'space');
  check('每行一项', M.detectFormat('a\nb\nc'), 'lines');
  check('单个词', M.detectFormat('hello'), 'lines');
  check('版本号不会被当成有序列表', M.detectFormat('3.14'), 'lines');
  check('日期不会被当成有序列表', M.detectFormat('2024-01-01'), 'lines');
}

console.log('--- 反证：朴素写法是错的 ---');
{
  // 1. Joining with the delimiter loses any item that contains it.
  const commaItems = ['a,b', 'c'];
  const naiveComma = commaItems.join(',');
  check('朴素用逗号拼接会得到歧义文本', naiveComma, 'a,b,c');
  check('朴素按逗号切分得到 3 项而不是 2 项', naiveComma.split(',').length, 3);
  check('本实现加引号后能还原', parse(serialize(commaItems, 'comma'), 'comma'), commaItems);

  const spaceItems = ['a b', 'c'];
  check('朴素用空格拼接同样有歧义', spaceItems.join(' ').split(' ').length, 3);
  check('本实现加引号后能还原', parse(serialize(spaceItems, 'space'), 'space'), spaceItems);

  // 2. JSON without escaping is not JSON.
  const quoteItem = ['say "hi"'];
  const naiveJson = `[${quoteItem.map((item) => `"${item}"`).join(',')}]`;
  let naiveJsonThrew = false;
  try {
    JSON.parse(naiveJson);
  } catch {
    naiveJsonThrew = true;
  }
  check('朴素拼接出的 JSON 不是合法 JSON', naiveJsonThrew, true);
  check('本实现的输出是合法 JSON 且能还原', JSON.parse(M.itemsToJson(quoteItem, 0)), quoteItem);

  // 3. SQL: backslash escaping is not the standard and not portable.
  check('朴素的反斜杠转义不是标准写法', `'${"it's".replace(/'/g, "\\'")}'`, "'it\\'s'");
  check('本实现把单引号写成两个', M.itemsToSql(["it's"], 'string'), "('it''s')");

  // 4. HTML: escaping < and > but not & double-decodes on the way back.
  const naiveHtml = (value) => value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  check('朴素只转义尖括号，&lt; 会被再次解码', M.unescapeHtmlText(naiveHtml('&lt;')), '<');
  check('本实现同时转义 &，能原样还原', M.unescapeHtmlText(M.escapeHtmlText('&lt;')), '&lt;');

  // 5. YAML: a plain scalar that looks like a boolean stops being a string.
  check('朴素写 - true 会被 YAML 读成布尔', YAML.parse('- true')[0], true);
  check('本实现加引号，读回来仍是字符串', YAML.parse(serialize(['true'], 'yaml'))[0], 'true');
}

// ---------------------------------------------------------------------------
// Cross-checks against CPython.
// ---------------------------------------------------------------------------
console.log('--- 独立参照物：Python sqlite3 与 html.parser ---');
const pythonAvailable = spawnSync('python3', ['-c', 'print(1)'], { encoding: 'utf8' }).status === 0;
if (!pythonAvailable) {
  skip('python3 不可用，跳过 SQLite / html.parser / html.unescape 的交叉验证');
} else {
  function runPython(script, payload) {
    const result = spawnSync('python3', ['-c', script], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(result.stderr || `python 退出码 ${result.status}`);
    return JSON.parse(result.stdout);
  }

  // --- SQL ---
  const SQL_QUOTE = `
import sys, json, sqlite3
data = json.load(sys.stdin)
con = sqlite3.connect(":memory:")
out = []
for item in data["items"]:
    out.append(con.execute("SELECT quote(?)", (item,)).fetchone()[0])
json.dump(out, sys.stdout, ensure_ascii=False)
`;
  const sqlItems = ['a', "it's", "two '' quotes", 'a,b', 'a\nb', '反斜杠 \\ 不是转义', '中文', '😀', ''];
  const sqliteLiterals = runPython(SQL_QUOTE, { items: sqlItems });
  let sqlMismatches = 0;
  sqlItems.forEach((item, index) => {
    if (M.escapeSqlString(item) !== sqliteLiterals[index]) {
      sqlMismatches += 1;
      if (sqlMismatches === 1) {
        console.log(`        ${JSON.stringify(item)}：本实现 ${M.escapeSqlString(item)}，SQLite quote() ${sqliteLiterals[index]}`);
      }
    }
  });
  check(`${sqlItems.length} 个字符串的字面量与 SQLite 自己的 quote() 一致`, sqlMismatches, 0);

  const SQL_SELECT = `
import sys, json, sqlite3
data = json.load(sys.stdin)
con = sqlite3.connect(":memory:")
con.execute("CREATE TABLE t (v TEXT)")
con.executemany("INSERT INTO t VALUES (?)", [(x,) for x in data["items"]])
try:
    rows = [r[0] for r in con.execute("SELECT v FROM t WHERE v IN " + data["fragment"])]
    result = {"ok": True, "rows": rows}
except Exception as exc:
    result = {"ok": False, "error": type(exc).__name__ + ": " + str(exc)}
json.dump(result, sys.stdout, ensure_ascii=False)
`;
  const selectItems = Array.from(new Set(['a', "it's", 'plain', '多行\n值', 'emoji 😀', 'a,b', "quote''s"])).filter((item) => !item.includes('\u0000'));
  const selected = runPython(SQL_SELECT, { items: selectItems, fragment: M.itemsToSql(selectItems, 'string') });
  check('SQLite 接受了本实现生成的 IN 列表', selected.ok, true);
  if (selected.ok) {
    const got = [...selected.rows].sort();
    const want = [...selectItems].sort();
    check('SQLite 用该 IN 列表选出的行与列表内容一致', got, want);
  }

  // A backslash-escaped literal is what SQLite rejects, which is why the
  // standard's doubling is the only form the tool emits.
  const naive = runPython(SQL_SELECT, {
    items: ["it's"],
    fragment: "('it\\'s')",
  });
  check('朴素的反斜杠转义被 SQLite 拒绝', naive.ok, false);

  // --- HTML ---
  const HTML_PARSE = `
import sys, json
from html.parser import HTMLParser

class ListReader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items = []
        self.current = None
    def handle_starttag(self, tag, attrs):
        if tag == "li":
            if self.current is not None:
                self.items.append(self.current)
            self.current = ""
    def handle_endtag(self, tag):
        if tag == "li" and self.current is not None:
            self.items.append(self.current)
            self.current = None
    def handle_data(self, data):
        if self.current is not None:
            self.current += data

data = json.load(sys.stdin)
out = []
for html in data["documents"]:
    reader = ListReader()
    reader.feed(html)
    reader.close()
    if reader.current is not None:
        reader.items.append(reader.current)
    out.append(reader.items)
json.dump(out, sys.stdout, ensure_ascii=False)
`;
  const htmlDocuments = [];
  const expectedItems = [];
  for (let round = 0; round < 60; round += 1) {
    const items = randomItems(ALPHABET);
    htmlDocuments.push(serialize(items, 'html'));
    expectedItems.push(items);
  }
  const parsedByPython = runPython(HTML_PARSE, { documents: htmlDocuments });
  let htmlMismatches = 0;
  expectedItems.forEach((items, index) => {
    if (JSON.stringify(parsedByPython[index]) !== JSON.stringify(items)) {
      htmlMismatches += 1;
      if (htmlMismatches === 1) {
        console.log(`        ${JSON.stringify(items)}`);
        console.log(`        Python：${JSON.stringify(parsedByPython[index])}`);
      }
    }
  });
  check(`${htmlDocuments.length} 份生成的 HTML 被 Python 的 html.parser 读回原列表`, htmlMismatches, 0);

  const HTML_UNESCAPE = `
import sys, json, html
data = json.load(sys.stdin)
json.dump([html.unescape(html.escape(x, quote=True)) for x in data["items"]], sys.stdout, ensure_ascii=False)
`;
  const escapeItems = ['<b>', '&amp;', '&lt;', '"quoted"', "it's", 'a & b', '中文 😀', 'a\nb'];
  const roundTripped = runPython(HTML_UNESCAPE, { items: escapeItems });
  check('Python 的 html.escape/unescape 往返不受影响（对照）', roundTripped, escapeItems);
  let htmlEscapeMismatches = 0;
  for (const item of escapeItems) {
    // Our escaper must produce text that Python's parser decodes back to the
    // original — the entity set differs slightly (&#39; vs &#x27;), so the
    // comparison is on the decoded value, not the bytes.
    const decoded = runPython('import sys, json, html\ndata = json.load(sys.stdin)\njson.dump(html.unescape(data["text"]), sys.stdout)', {
      text: M.escapeHtmlText(item),
    });
    if (decoded !== item) {
      htmlEscapeMismatches += 1;
      if (htmlEscapeMismatches === 1) {
        console.log(`        ${JSON.stringify(item)} -> ${M.escapeHtmlText(item)} -> ${JSON.stringify(decoded)}`);
      }
    }
  }
  check(`${escapeItems.length} 个项经本实现转义后被 Python 的 html.unescape 还原`, htmlEscapeMismatches, 0);
}

console.log(
  `\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}` +
    (skipped ? `, ${skipped} skipped` : ''),
);
process.exit(failed === 0 ? 0 : 1);
