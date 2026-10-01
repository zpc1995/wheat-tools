/**
 * Checks the JSON <-> CSV converter.
 *
 * Oracles, in decreasing order of independence:
 *
 *   1. **RFC 4180's own examples** plus vectors derived directly from the
 *      grammar in section 2 of the RFC.
 *   2. **Python's `csv` module** (CPython's C implementation). Every generated
 *      CSV file is re-parsed by `csv.reader` and compared row by row, and
 *      random rows are written by `csv.writer` and compared byte for byte with
 *      our output — which pins down "minimal quoting" against an implementation
 *      that has nothing to do with ours. The cross-check skips itself with an
 *      explicit note when python3 is unavailable.
 *   3. **`JSON.parse` / `JSON.stringify`** (the platform) for the JSON half.
 *   4. **Round trips**: parse -> serialize -> parse must be identical, for
 *      random rows over all delimiters, both line endings and the BOM option.
 *
 * The naive implementations this tool exists to avoid are also *implemented
 * here* and asserted to be wrong, so the suite would notice if the real
 * implementation regressed into one of them.
 *
 * Usage: node scripts/check-json-csv.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/json-csv/jsonCsvUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/json-csv.mjs', compiled);
const M = await import(pathToFileURL('.verify/json-csv.mjs').href);

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

const parse = (text, delimiter = ',') => M.parseCsv(text, { delimiter }).rows;

// ---------------------------------------------------------------------------
// Deterministic pseudo-random source, so a failure is reproducible.
// ---------------------------------------------------------------------------
let seed = 20240607;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function pick(list) {
  return list[Math.floor(rand() * list.length)];
}

// A field alphabet that deliberately contains every character with a special
// meaning in CSV, plus non-ASCII text that must survive byte-wise.
const FIELD_ALPHABET = [
  'a', 'b', 'Z', '0', '9', '中', '文', '😀', ' ', '  ', ',', ';', '|', '\t',
  '"', '""', '\n', '\r\n', '\r', '\\', 'e', '', 'a,b', ' "q" ',
];
function randomField() {
  const length = Math.floor(rand() * 4);
  let out = '';
  for (let index = 0; index < length; index += 1) out += pick(FIELD_ALPHABET);
  return out;
}
function randomRows(maxRows = 4, maxFields = 4) {
  const count = 1 + Math.floor(rand() * maxRows);
  const rows = [];
  for (let r = 0; r < count; r += 1) {
    const fields = 1 + Math.floor(rand() * maxFields);
    const row = [];
    for (let f = 0; f < fields; f += 1) row.push(randomField());
    rows.push(row);
  }
  return rows;
}

console.log('--- RFC 4180 的例子与由规则直接推导的向量 ---');
{
  // Example 1 of section 2: two records terminated by CRLF.
  check(
    '示例 1（CRLF 结尾的两条记录）',
    parse('aaa,bbb,ccc\r\nzzz,yyy,xxx\r\n'),
    [['aaa', 'bbb', 'ccc'], ['zzz', 'yyy', 'xxx']],
  );
  // Example 2: the final CRLF is optional.
  check(
    '示例 2（最后一条记录不带 CRLF）',
    parse('aaa,bbb,ccc\r\nzzz,yyy,xxx'),
    [['aaa', 'bbb', 'ccc'], ['zzz', 'yyy', 'xxx']],
  );
  // Example 3: a field containing CRLF, quoted.
  check(
    '示例 3（字段内含 CRLF，用引号括起）',
    parse('"aaa","b\r\nbb","ccc"'),
    [['aaa', 'b\r\nbb', 'ccc']],
  );
  // The RFC spells out that `b""bb` denotes `b"bb`.
  check('引号内的双引号写成两个（b""bb 表示 b"bb）', parse('aaa,"b""bb",ccc'), [['aaa', 'b"bb', 'ccc']]);
  check('字段含逗号必须加引号', parse('"a,b",c'), [['a,b', 'c']]);
  check('字段含换行必须加引号', parse('"a\nb",c'), [['a\nb', 'c']]);

  const opts = { delimiter: ',', lineEnding: 'lf' };
  check('生成的字段含逗号时加引号', M.serializeCsv([['a,b']], opts), '"a,b"');
  check('生成的字段含引号时加引号并把引号翻倍', M.serializeCsv([['say "hi"']], opts), '"say ""hi"""');
  check('生成的字段含换行时加引号', M.serializeCsv([['a\nb']], opts), '"a\nb"');
  check('普通字段不加多余的引号', M.serializeCsv([['a', 'b']], opts), 'a,b');
  check('空字段不加引号（分隔符本身就表示空字段）', M.serializeCsv([['a', '', 'b']], opts), 'a,,b');
}

console.log('--- 边界 ---');
{
  check('空输入没有记录', parse(''), []);
  check('只有一个换行是一条零字段记录（CPython 也这么读）', parse('\n'), [[]]);
  check('CRLF 同理', parse('\r\n'), [[]]);
  check('单个字段', parse('a'), [['a']]);
  check('一个分隔符产生两个空字段', parse(','), [['', '']]);
  check('三个空字段', parse(',,'), [['', '', '']]);
  check('中间的空字段保留', parse('a,,b'), [['a', '', 'b']]);
  check('只有一对引号是一个空字段，而不是零字段记录', parse('""'), [['']]);
  check('中间的空行是一条零字段记录', parse('a\n\nb'), [['a'], [], ['b']]);
  check('末尾的空行也保留（生成时会写成显式的空记录）', parse('a,b\n\n\n'), [['a', 'b'], [], []]);
  check('CRLF 与 LF 混用也能解析', parse('a,b\r\nc,d\ne,f'), [['a', 'b'], ['c', 'd'], ['e', 'f']]);
  check('单独的 CR 也是换行', parse('a\rb'), [['a'], ['b']]);
  check('首尾空格是数据，必须保留', parse(' a , b '), [[' a ', ' b ']]);
  check('引号内的首尾空格保留', parse('" a "," b "'), [[' a ', ' b ']]);
  check('未闭合的引号报错而不是猜', M.parseCsv('"abc', { delimiter: ',' }).error !== null, true);
  check('报错时返回空行列表', M.parseCsv('"abc', { delimiter: ',' }).rows, []);
  check('制表符分隔', parse('a\tb\tc', '\t'), [['a', 'b', 'c']]);
  check('分号分隔', parse('a;b;c', ';'), [['a', 'b', 'c']]);
  check('竖线分隔（字段内的逗号不再是分隔符）', parse('a,b|c', '|'), [['a,b', 'c']]);
  check('BOM 被剥离，不会混进第一个表头', parse('\uFEFFid,name\n1,2'), [['id', 'name'], ['1', '2']]);
  check(
    'BOM 混进引号内时是数据（只有文件开头才是 BOM）',
    parse('"\uFEFFid",name'),
    [['\uFEFFid', 'name']],
  );
  check('引号中间的引号在未加引号的字段里是字面量', parse('a"b,c'), [['a"b', 'c']]);
  check('闭合引号后紧跟的字符被追加（与 Excel / Python 一致）', parse('"a"b,c'), [['ab', 'c']]);
  check('空字段与空白字段不同', parse('a, ,b'), [['a', ' ', 'b']]);
}

console.log('--- 生成 ---');
{
  check('LF 行尾', M.serializeCsv([['a', 'b'], ['c', 'd']], { delimiter: ',', lineEnding: 'lf' }), 'a,b\nc,d');
  check(
    'CRLF 行尾',
    M.serializeCsv([['a', 'b'], ['c', 'd']], { delimiter: ',', lineEnding: 'crlf' }),
    'a,b\r\nc,d',
  );
  check(
    '可以选择在末尾补一个结束符',
    M.serializeCsv([['a']], { delimiter: ',', lineEnding: 'lf', trailingNewline: true }),
    'a\n',
  );
  check(
    'BOM 是可选的，且只出现在最前面',
    M.serializeCsv([['a']], { delimiter: ',', lineEnding: 'lf', bom: true }),
    '\uFEFFa',
  );
  check('空行列表生成空串', M.serializeCsv([], { delimiter: ',', lineEnding: 'lf' }), '');
  check(
    '制表符分隔的输出',
    M.serializeCsv([['a', 'b'], ['c', 'd']], { delimiter: '\t', lineEnding: 'lf' }),
    'a\tb\nc\td',
  );
  check(
    '字段内的制表符在逗号分隔时无需引号',
    M.serializeCsv([['a\tb']], { delimiter: ',', lineEnding: 'lf' }),
    'a\tb',
  );
  check(
    '字段内的逗号在制表符分隔时无需引号',
    M.serializeCsv([['a,b']], { delimiter: '\t', lineEnding: 'lf' }),
    'a,b',
  );
  // `[""]` and `[]` are different records and must not generate the same text.
  check('只有一个空字段的记录写成 ""（否则与空行混淆）', M.serializeCsv([['']], { delimiter: ',', lineEnding: 'lf' }), '""');
  check('零字段记录写成空行', M.serializeCsv([[]], { delimiter: ',', lineEnding: 'lf' }), '\n');
  check('末尾的零字段记录需要自己的结束符', M.serializeCsv([['a'], []], { delimiter: ',', lineEnding: 'lf' }), 'a\n\n');
}

console.log('--- 往返：parse -> serialize -> parse ---');
{
  let mismatches = 0;
  let samples = 0;
  const endings = ['lf', 'crlf'];
  const delimiters = [',', '\t', ';', '|'];
  for (const delimiter of delimiters) {
    for (const lineEnding of endings) {
      for (const bom of [false, true]) {
        for (let round = 0; round < 60; round += 1) {
          const rows = randomRows();
          samples += 1;
          const text = M.serializeCsv(rows, { delimiter, lineEnding, bom });
          const back = M.parseCsv(text, { delimiter }).rows;
          if (JSON.stringify(back) !== JSON.stringify(rows)) mismatches += 1;
        }
      }
    }
  }
  check(`随机 ${samples} 组行在 4 种分隔符 x 2 种行尾 x BOM 开关下往返一致`, mismatches, 0);

  // The cases the random generator reaches only by luck: empty records, empty
  // fields and a trailing blank line, which is where a naive generator collapses
  // two different rows into the same bytes.
  const awkward = [
    [['']],
    [[]],
    [['a'], []],
    [['a'], [''], []],
    [['a', ''], ['', 'b']],
    [['', '']],
    [[], []],
  ];
  let awkwardMismatches = 0;
  for (const rows of awkward) {
    for (const delimiter of delimiters) {
      for (const lineEnding of endings) {
        const text = M.serializeCsv(rows, { delimiter, lineEnding });
        const back = M.parseCsv(text, { delimiter }).rows;
        if (JSON.stringify(back) !== JSON.stringify(rows)) {
          awkwardMismatches += 1;
          console.log(`        ${JSON.stringify(rows)} -> ${JSON.stringify(text)} -> ${JSON.stringify(back)}`);
        }
      }
    }
  }
  check(`空记录 / 空字段的 ${awkward.length} 组特殊行在 8 种组合下往返一致`, awkwardMismatches, 0);

  // Serialising a file we generated must reproduce it byte for byte: the output
  // is already minimal, so parsing must not add or remove a single character.
  let byteMismatches = 0;
  let byteSamples = 0;
  for (let round = 0; round < 300; round += 1) {
    const rows = randomRows();
    const lineEnding = round % 2 === 0 ? 'lf' : 'crlf';
    const delimiter = delimiters[round % delimiters.length];
    const text = M.serializeCsv(rows, { delimiter, lineEnding });
    byteSamples += 1;
    const regenerated = M.serializeCsv(M.parseCsv(text, { delimiter }).rows, { delimiter, lineEnding });
    if (regenerated !== text) byteMismatches += 1;
  }
  check(`${byteSamples} 个已生成文件重新解析后逐字符一致`, byteMismatches, 0);

  // For arbitrary well-formed input, parse -> serialize -> parse must be stable
  // even where the input is not minimal (redundant quotes, CRLF, trailing blank
  // lines): the second generation is the canonical form of the same data.
  const corpus = [
    'aaa,bbb,ccc\r\nzzz,yyy,xxx\r\n',
    '"aaa","b\r\nbb","ccc"',
    'a\n\nb',
    '\n',
    '""',
    ' a , b ',
    'a,b\n\n\n',
    '"a"b,c',
    'a"b,c',
    '\uFEFFid,name\r\n1,2',
  ];
  let stable = 0;
  for (const text of corpus) {
    const once = M.parseCsv(text, { delimiter: ',' }).rows;
    const twice = M.parseCsv(M.serializeCsv(once, { delimiter: ',', lineEnding: 'lf' }), {
      delimiter: ',',
    }).rows;
    if (JSON.stringify(once) === JSON.stringify(twice)) stable += 1;
  }
  check(`语料库 ${corpus.length} 例的 parse -> serialize -> parse 稳定`, stable, corpus.length);
}

console.log('--- 反证：朴素写法是错的 ---');
{
  // 1. split(','). The classic.
  const quoted = '"a,b",c';
  check('朴素 split(",") 把带引号的字段切成 3 段', quoted.split(',').length, 3);
  check('朴素 split(",") 得到的字段是错的', quoted.split(','), ['"a', 'b"', 'c']);
  check('本实现把它正确解析为 2 个字段', parse(quoted), [['a,b', 'c']]);

  // 2. replace(/"/g, '""') on its own: escaping without the surrounding quotes.
  const naiveEscape = (field) => field.replace(/"/g, '""');
  const trickyField = 'say "hi"';
  const naiveOnly = naiveEscape(trickyField);
  check('只翻倍引号、不加外层引号得到的文本不是原字段', parse(naiveOnly)[0][0] === trickyField, false);
  check('正确写法会加上外层引号', M.serializeCsv([[trickyField]], { delimiter: ',', lineEnding: 'lf' }), '"say ""hi"""');
  check('正确写法能还原', parse(M.serializeCsv([[trickyField]], { delimiter: ',', lineEnding: 'lf' })), [[trickyField]]);

  const commaField = 'a,b';
  check('只翻倍引号对含逗号的字段毫无作用（仍然被切开）', parse(naiveEscape(commaField)), [['a', 'b']]);
  check('正确写法把它变成一个字段', parse(M.serializeCsv([[commaField]], { delimiter: ',', lineEnding: 'lf' })), [[commaField]]);

  // 3. Splitting on newlines before parsing fields. A quoted field may contain
  //    the record separator, so the record structure has to be found while
  //    respecting quotes.
  const multiline = 'a,"x\ny"';
  check('朴素按行切分会把一条记录拆成两条', multiline.split('\n').length, 2);
  check('本实现知道换行在引号内，只有一条记录', parse(multiline), [['a', 'x\ny']]);
}

console.log('--- JSON -> CSV ---');
{
  const base = { delimiter: ',', lineEnding: 'lf', hasHeader: true, nested: 'flatten' };

  check(
    '键取并集，缺失的键留空',
    M.jsonToCsv('[{"a":1,"b":"x"},{"b":"y","c":true}]', base).text,
    'a,b,c\n1,x,\n,y,true',
  );
  check(
    '表头顺序是键首次出现的顺序',
    M.jsonToCsv('[{"b":1,"a":2}]', base).columns,
    ['b', 'a'],
  );
  check('列数统计', M.jsonToCsv('[{"a":1,"b":"x"},{"b":"y","c":true}]', base).columns.length, 3);
  check('记录数统计', M.jsonToCsv('[{"a":1,"b":"x"},{"b":"y","c":true}]', base).rowCount, 2);
  check('可以不带表头', M.jsonToCsv('[{"a":1}]', { ...base, hasHeader: false }).text, '1');
  check('数字与布尔按原样写', M.jsonToCsv('[{"n":1.5,"b":false,"z":null}]', base).text, 'n,b,z\n1.5,false,');
  check('null 写成空单元格（单列表会写成显式的 ""，以便与空行区分）', M.jsonToCsv('[{"a":null}]', base).text, 'a\n""');
  check('单个对象自动包成数组', M.jsonToCsv('{"a":1}', base).text, 'a\n1');
  check('空数组生成空文本', M.jsonToCsv('[]', base).text, '');
  check('空输入生成空文本', M.jsonToCsv('  ', base).text, '');
  check('非法 JSON 报错', M.jsonToCsv('{oops', base).error !== null, true);
  check('非法 JSON 不产出文本', M.jsonToCsv('{oops', base).text, '');
  check(
    '原始类型数组变成单列 value',
    M.jsonToCsv('["a","b"]', base).text,
    'value\na\nb',
  );
  check('二维数组按原样写出', M.jsonToCsv('[[1,2],[3,4]]', base).text, '1,2\n3,4');

  // Nested handling: the choice the UI has to explain.
  const nestedJson = '[{"id":1,"user":{"name":"小麦","age":3},"tags":["a","b"]}]';
  check(
    '扁平化：点号路径成为列名',
    M.jsonToCsv(nestedJson, base).columns,
    ['id', 'user.name', 'user.age', 'tags'],
  );
  check(
    '扁平化：数组写成 JSON 文本（下标路径会和真实键混淆）',
    M.jsonToCsv(nestedJson, base).text,
    'id,user.name,user.age,tags\n1,小麦,3,"[""a"",""b""]"',
  );
  check(
    'JSON 文本模式：只保留第一层键',
    M.jsonToCsv(nestedJson, { ...base, nested: 'json' }).columns,
    ['id', 'user', 'tags'],
  );
  {
    const text = M.jsonToCsv(nestedJson, { ...base, nested: 'json' }).text;
    const back = M.csvToJson(text, { delimiter: ',', hasHeader: true, indent: 0 });
    const value = JSON.parse(back.text);
    check('JSON 文本模式：user 单元格本身是合法 JSON', JSON.parse(value[0].user).name, '小麦');
    check('JSON 文本模式：tags 单元格本身是合法 JSON', JSON.parse(value[0].tags), ['a', 'b']);
    check('JSON 文本模式：数字列仍然是可用的字符串', value[0].id, '1');
  }
  check(
    '空对象在扁平化时不留下列',
    M.jsonToCsv('[{}]', base).text,
    '',
  );
  check(
    '空对象在 JSON 文本模式下留下空单元格',
    M.jsonToCsv('[{"a":{}}]', base).text,
    'a\n{}',
  );

  // Chinese and emoji must survive byte-wise; the BOM is what makes Excel read
  // them as UTF-8 rather than as the local code page.
  check(
    '中文与 emoji 原样写出',
    M.jsonToCsv('[{"名称":"小麦","emoji":"😀"}]', base).text,
    '名称,emoji\n小麦,😀',
  );
  check(
    'BOM 让 Excel 知道这是 UTF-8',
    M.jsonToCsv('[{"名称":"小麦"}]', { ...base, bom: true }).text,
    '\uFEFF名称\n小麦',
  );
  check(
    'CRLF 行尾',
    M.jsonToCsv('[{"a":1},{"a":2}]', { ...base, lineEnding: 'crlf' }).text,
    'a\r\n1\r\n2',
  );
}

console.log('--- CSV -> JSON ---');
{
  const base = { delimiter: ',', hasHeader: true, indent: 0 };
  const parseJson = (text, options = base) => {
    const result = M.csvToJson(text, options);
    return { error: result.error, value: result.error ? null : JSON.parse(result.text) };
  };

  check('带表头转成对象数组', parseJson('a,b\n1,2').value, [{ a: '1', b: '2' }]);
  check('不带表头转成二维数组', parseJson('a,b\n1,2', { ...base, hasHeader: false }).value, [
    ['a', 'b'],
    ['1', '2'],
  ]);
  check('空输入是空数组', parseJson('').value, []);
  check('只有表头时是空数组', parseJson('a,b').value, []);
  check(
    '带引号的字段原样进入 JSON',
    parseJson('name,note\n"带,逗号",普通').value,
    [{ name: '带,逗号', note: '普通' }],
  );
  check(
    '字段内的换行保留',
    parseJson('a,b\n"x\ny",z').value,
    [{ a: 'x\ny', b: 'z' }],
  );
  check('双双引号还原成一个引号', parseJson('a\n"say ""hi"""').value, [{ a: 'say "hi"' }]);
  check('重复表头被改名而不是互相覆盖', parseJson('a,a\n1,2').value, [{ a: '1', a_2: '2' }]);
  check('空表头得到位置名', parseJson(',b\n1,2').value, [{ column1: '1', b: '2' }]);
  check('短行补空字符串', parseJson('a,b,c\n1,2').value, [{ a: '1', b: '2', c: '' }]);
  check('多出来的单元格不丢，用位置名保留', parseJson('a,b\n1,2,3').value, [
    { a: '1', b: '2', column3: '3' },
  ]);
  check('输入里的 BOM 被剥离', parseJson('\uFEFFa\n1').value, [{ a: '1' }]);
  check('制表符分隔的输入', parseJson('a\tb\n1\t2', { ...base, delimiter: '\t' }).value, [
    { a: '1', b: '2' },
  ]);
  check('缩进 2 时是格式化输出', M.csvToJson('a\n1', { ...base, indent: 2 }).text, '[\n  {\n    "a": "1"\n  }\n]');
  check('中文与 emoji 原样保留', parseJson('名称,emoji\n小麦,😀').value, [{ 名称: '小麦', emoji: '😀' }]);
  check('未闭合引号会报错', M.csvToJson('a\n"x', base).error !== null, true);
  check('每一条输出的 JSON 都能被 JSON.parse 接受', (() => {
    const inputs = ['a,b\n1,2', '"x,y"\n1,2', 'a\n"多行\n值"', '', 'a,a\n1,2', '\uFEFFa\n1'];
    return inputs.every((text) => {
      const result = M.csvToJson(text, base);
      if (result.error) return false;
      try {
        JSON.parse(result.text);
        return true;
      } catch {
        return false;
      }
    });
  })(), true);
}

console.log('--- JSON <-> CSV 联合往返 ---');
{
  // Header names are drawn from a safe alphabet so the round trip is exact:
  // anonymous or duplicated headers are intentionally renamed by csvToJson.
  let mismatches = 0;
  let samples = 0;
  for (let round = 0; round < 120; round += 1) {
    const width = 1 + Math.floor(rand() * 4);
    const columns = [];
    for (let index = 0; index < width; index += 1) columns.push(`c${index}`);
    const height = 1 + Math.floor(rand() * 4);
    const records = [];
    for (let r = 0; r < height; r += 1) {
      const record = {};
      for (const column of columns) record[column] = randomField();
      records.push(record);
    }
    const lineEnding = round % 2 === 0 ? 'lf' : 'crlf';
    const delimiter = [',', '\t', ';', '|'][round % 4];
    const forward = M.jsonToCsv(JSON.stringify(records), {
      delimiter,
      lineEnding,
      hasHeader: true,
      nested: 'flatten',
    });
    if (forward.error) {
      mismatches += 1;
      continue;
    }
    const back = M.csvToJson(forward.text, { delimiter, hasHeader: true, indent: 0 });
    if (back.error) {
      mismatches += 1;
      continue;
    }
    const again = M.jsonToCsv(back.text, { delimiter, lineEnding, hasHeader: true, nested: 'flatten' });
    samples += 1;
    if (again.text !== forward.text) mismatches += 1;
  }
  check(`${samples} 组随机记录 JSON -> CSV -> JSON -> CSV 完全一致`, mismatches, 0);
}

console.log('--- 明确不做：不读写 Excel 文件 ---');
{
  check(
    '工具没有导出任何 xlsx / excel 相关函数',
    Object.keys(M).filter((name) => /xlsx|excel|spreadsheet/i.test(name)),
    [],
  );
}

// ---------------------------------------------------------------------------
// Cross-check against CPython's csv module.
//
// `csv.reader` is a C implementation of the same RFC with its own quirks; when
// it and this parser agree on random input, neither is inventing a dialect.
// ---------------------------------------------------------------------------
console.log('--- 独立参照物：Python csv 模块 ---');
const pythonAvailable = spawnSync('python3', ['-c', 'print(1)'], { encoding: 'utf8' }).status === 0;
if (!pythonAvailable) {
  skip('python3 不可用，跳过与 CPython csv 模块的交叉验证');
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

  const READER = `
import sys, json, csv, io
data = json.load(sys.stdin)
out = []
for case in data:
    try:
        rows = list(csv.reader(io.StringIO(case["text"], newline=""), delimiter=case["delimiter"]))
    except Exception as exc:
        rows = {"error": str(exc)}
    out.append(rows)
json.dump(out, sys.stdout, ensure_ascii=False)
`;

  const WRITER = `
import sys, json, csv, io
data = json.load(sys.stdin)
out = []
for case in data:
    buf = io.StringIO(newline="")
    writer = csv.writer(buf, delimiter=case["delimiter"], lineterminator=case["ending"])
    writer.writerows(case["rows"])
    out.append(buf.getvalue())
json.dump(out, sys.stdout, ensure_ascii=False)
`;

  // No normalisation is needed: the parser and CPython agree that a blank line
  // is a record with zero fields, and neither drops trailing blank records.
  const normalise = (rows) => rows;

  const cases = [];
  for (let round = 0; round < 200; round += 1) {
    const rows = randomRows();
    const delimiter = [',', '\t', ';', '|'][round % 4];
    const lineEnding = round % 2 === 0 ? 'lf' : 'crlf';
    cases.push({
      text: M.serializeCsv(rows, { delimiter, lineEnding }),
      delimiter,
      rows,
    });
  }
  for (const text of [
    '\n',
    '\n\n',
    'a\n\nb',
    'a,b\n\n\n',
    '""',
    '""\n""',
    ',',
    'a"b,c',
    '"a"b,c',
    ' a , b ',
    '"a\r\nb",c',
    'a\rb',
    '',
  ]) {
    cases.push({ text, delimiter: ',', rows: [] });
  }

  let parseMismatches = 0;
  const pythonRows = runPython(READER, cases);
  cases.forEach((item, index) => {
    const mine = normalise(M.parseCsv(item.text, { delimiter: item.delimiter }).rows);
    const theirs = normalise(pythonRows[index]);
    if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
      parseMismatches += 1;
      if (parseMismatches === 1) {
        console.log(`        首个不一致的输入：${JSON.stringify(item.text)}`);
        console.log(`        本实现：${JSON.stringify(mine)}`);
        console.log(`        Python：${JSON.stringify(theirs)}`);
      }
    }
  });
  check(`${cases.length} 个输入与 csv.reader 的解析结果一致`, parseMismatches, 0);

  // The writer pins down minimal quoting: identical bytes or a real difference.
  const writerCases = [];
  for (let round = 0; round < 200; round += 1) {
    const rows = randomRows();
    writerCases.push({
      rows,
      delimiter: [',', '\t', ';', '|'][round % 4],
      ending: round % 2 === 0 ? '\n' : '\r\n',
    });
  }
  const pythonText = runPython(WRITER, writerCases);
  let writeMismatches = 0;
  writerCases.forEach((item, index) => {
    const mine = M.serializeCsv(item.rows, {
      delimiter: item.delimiter,
      lineEnding: item.ending === '\n' ? 'lf' : 'crlf',
    });
    // csv.writer always terminates the last record; ours does not by default.
    const theirs = pythonText[index].endsWith(item.ending)
      ? pythonText[index].slice(0, -item.ending.length)
      : pythonText[index];
    if (mine !== theirs) {
      writeMismatches += 1;
      if (writeMismatches === 1) {
        console.log(`        首个不一致：${JSON.stringify(item.rows)}`);
        console.log(`        本实现：${JSON.stringify(mine)}`);
        console.log(`        Python：${JSON.stringify(theirs)}`);
      }
    }
  });
  check(`${writerCases.length} 组随机行与 csv.writer 的输出逐字节一致（最小引号规则）`, writeMismatches, 0);
}

console.log(
  `\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}` +
    (skipped ? `, ${skipped} skipped` : ''),
);
process.exit(failed === 0 ? 0 : 1);
