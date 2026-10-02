/**
 * Checks the TOML <-> JSON tool.
 *
 * The authoritative reference is Python's `tomllib` (stdlib since 3.11): this
 * script hands it the same documents, encodes its result into the tool's tagged
 * form, and compares value by value. On top of that:
 *
 *   - every TOML string this tool generates is parsed by tomllib, which is the
 *     proof that the serialiser emits valid TOML rather than plausible text;
 *   - TOML → JSON → TOML is round-tripped over the whole corpus;
 *   - a naive line-based parser is implemented here and shown to get arrays of
 *     tables wrong, so the structural assertions are demonstrably able to catch
 *     that class of bug.
 *
 * Usage: node scripts/check-toml-json.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(readFileSync('src/tools/toml-json/tomlJsonUtils.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/toml-json.mjs', compiled);
const M = await import(pathToFileURL('.verify/toml-json.mjs').href);

let passed = 0;
let failed = 0;

/** JSON objects are unordered, so comparisons sort keys at every level. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

function report(ok, label, detail) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n${detail}`}`);
}

function check(label, actual, expected) {
  const a = JSON.stringify(stable(actual));
  const e = JSON.stringify(stable(expected));
  report(a === e, label, `        got      ${a}\n        expected ${e}`);
}

function checkTrue(label, actual) {
  report(actual === true, label, `        got      ${JSON.stringify(actual)}\n        expected true`);
}

function checkContains(label, actual, needle) {
  const ok = typeof actual === 'string' && actual.includes(needle);
  report(ok, label, `        got      ${JSON.stringify(actual)}\n        expected to contain ${JSON.stringify(needle)}`);
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

/* ------------------------------------------------------------------ *
 * The tomllib oracle
 * ------------------------------------------------------------------ */

const PY_DOCS = `
import sys, json, math, datetime
import tomllib

def enc(o):
    if isinstance(o, bool):
        return o
    if isinstance(o, str):
        return o
    if isinstance(o, dict):
        return {k: enc(v) for k, v in o.items()}
    if isinstance(o, list):
        return [enc(v) for v in o]
    if isinstance(o, int):
        return o
    if isinstance(o, float):
        if math.isnan(o):
            return {"$type": "toml-float", "$value": "nan"}
        if math.isinf(o):
            return {"$type": "toml-float", "$value": "inf" if o > 0 else "-inf"}
        return o
    if isinstance(o, datetime.datetime):
        if o.tzinfo is None:
            return {"$type": "toml-local-date-time", "$value": o.isoformat()}
        text = o.isoformat()
        if text.endswith("+00:00"):
            text = text[:-6] + "Z"
        return {"$type": "toml-offset-date-time", "$value": text}
    if isinstance(o, datetime.date):
        return {"$type": "toml-local-date", "$value": o.isoformat()}
    if isinstance(o, datetime.time):
        return {"$type": "toml-local-time", "$value": o.isoformat()}
    raise TypeError(str(type(o)))

documents = json.load(sys.stdin)
results = []
for document in documents:
    try:
        results.append({"ok": True, "value": enc(tomllib.loads(document))})
    except Exception as exc:
        results.append({"ok": False, "error": str(exc)})
print(json.dumps(results, ensure_ascii=False))
`;

const pythonAvailable =
  spawnSync('python3', ['-c', 'import tomllib'], { encoding: 'utf8' }).status === 0;

if (!pythonAvailable) {
  console.log('注意：python3 或 tomllib 不可用，跳过与权威实现的比对（本机应当可用）\n');
}

function pythonParseDocs(documents) {
  const out = execFileSync('python3', ['-c', PY_DOCS], {
    input: Buffer.from(JSON.stringify(documents), 'utf8'),
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

/**
 * Normalises the date text on both sides before comparing.
 *
 * tomllib reports a `datetime`, whose `isoformat()` always uses `T`, always
 * writes six fractional digits and spells UTC as `+00:00`. This tool keeps the
 * source text verbatim. Both are the same instant, so the comparison looks
 * through the formatting.
 */
function normaliseDateText(text) {
  let out = text.replace(/[tT ]/, 'T').replace(/z$/, 'Z').replace(/\+00:00$/, 'Z');
  out = out.replace(/\.(\d+)/, (match, digits) => {
    const trimmed = digits.replace(/0+$/, '');
    return trimmed === '' ? '' : `.${trimmed}`;
  });
  return out;
}

function normaliseValue(value) {
  if (Array.isArray(value)) return value.map(normaliseValue);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 2 && keys.includes('$type') && keys.includes('$value')) {
      if (value.$type === 'toml-float') {
        const text = String(value.$value).toLowerCase().replace(/^\+/, '');
        return { $type: 'toml-float', $value: text.replace(/^-?nan$/, 'nan') };
      }
      return { $type: value.$type, $value: normaliseDateText(String(value.$value)) };
    }
    const out = {};
    for (const key of keys.sort()) out[key] = normaliseValue(value[key]);
    return out;
  }
  return value;
}

function sameValue(a, b) {
  return JSON.stringify(stable(normaliseValue(a))) === JSON.stringify(stable(normaliseValue(b)));
}

/* ------------------------------------------------------------------ *
 * Corpus
 * ------------------------------------------------------------------ */

const CORPUS = [
  { label: '空文档', toml: '' },
  { label: '只有注释', toml: '# 只有注释\n# 第二行\n' },
  { label: '整数', toml: 'a = 1\nb = -17\nc = 0\nd = 1_000_000\n' },
  { label: '各进制整数', toml: 'hex = 0xDEAD_BEEF\noct = 0o755\nbin = 0b1010_1010\n' },
  { label: '浮点', toml: 'f = 1.5\ng = -0.001\nh = 5e22\ni = 6.626e-34\nj = 1.0\n' },
  { label: '无穷与 nan', toml: 'p = inf\nn = -inf\nz = nan\nq = +inf\n' },
  { label: '基本字符串转义', toml: 's = "tab\\there\\nnewline \\u00e9 \\U0001F600 \\"quoted\\" \\\\"\n' },
  { label: '多行基本字符串（含续行反斜杠）', toml: 'x = """\n第一行\n第二行 \\\n    接上来\n"""\n' },
  { label: '字面量字符串', toml: "w = 'C:\\Users\\x'\nv = '不转义 \\n 保留原文'\n" },
  { label: '多行字面量字符串', toml: "x = '''\n原样\n保留 '' 两个引号\n'''\n" },
  { label: '布尔', toml: 'b = true\nc = false\n' },
  { label: '四种日期时间', toml:
      'offset = 1979-05-27T07:32:00Z\n' +
      'offset2 = 1979-05-27T00:32:00-07:00\n' +
      'space = 1979-05-27 07:32:00\n' +
      'frac = 1979-05-27T07:32:00.999999Z\n' +
      'localdt = 1979-05-27T07:32:00\n' +
      'day = 1979-05-27\n' +
      'alarm = 07:32:00\n' +
      'alarm2 = 00:32:00.5\n' },
  { label: '表与嵌套表', toml: '[a]\nb = 1\n\n[a.c]\nd = 2\n[e]\nf = 3\n' },
  { label: '数组表', toml: '[[p]]\nn = 1\n[[p]]\nn = 2\n[[p]]\nn = 3\n' },
  { label: '数组表里的子表', toml: '[[a]]\nn = 1\n[a.b]\nc = 2\n[[a]]\nn = 3\n[a.b]\nc = 4\n' },
  { label: '内联表与嵌套内联表', toml: 'x = { a = 1, b = { c = 2 }, d = [1, 2] }\n' },
  { label: '数组（嵌套、异构、跨行、尾随逗号）', toml: 'x = [1, 2, 3,]\ny = [[1, 2], [3]]\nz = [\n  1, # 注释\n  "two",\n  true,\n]\n' },
  { label: '点号键', toml: 'a.b.c = 1\na.b.d = 2\n' },
  { label: '带引号的键', toml: '"a.b" = 1\n\'c d\' = 2\n"" = 3\n"中文键" = 4\n' },
  { label: '超出安全范围的整数', toml: 'big = 9223372036854775807\n' },
  { label: '空表', toml: '[empty]\n[empty2.sub]\n' },
  { label: '空内联表与空数组', toml: 'x = {}\ny = []\nz = [[]]\n' },
  { label: 'Unicode 与 emoji', toml: 'name = "小麦 😀"\n["表名"]\nk = "值"\n' },
  { label: 'CRLF 换行', toml: 'a = 1\r\nb = 2\r\n[t]\r\nc = 3\r\n' },
  { label: '先隐式后显式的表', toml: '[a.b]\n[a]\nc = 1\n' },
  { label: '内联表数组', toml: 'points = [ { x = 1, y = 2 }, { x = 3, y = 4 } ]\n' },
  // The rest are adversarial shapes found while differentially testing against
  // tomllib; they are kept so a regression shows up immediately.
  { label: '嵌套数组表', toml: '[[a.b]]\nx = 1\n[[a.b]]\nx = 2\n' },
  { label: '数组表深层子表', toml: '[[a]]\n[a.b.c]\nd = 1\n[[a]]\n[a.b.c]\nd = 2\n' },
  { label: '裸数字键与保留字键', toml: '1234 = "x"\ntrue = 1\nfalse = 2\ninf = 3\nnan = 4\n' },
  { label: '表头里有空格', toml: '[ a . b ]\nx = 1\n' },
  { label: '浮点下划线', toml: 'x = 1_0.0_1e1_0\n' },
  { label: '正零与负零', toml: 'x = +0.0\ny = -0.0\nz = 0.0\n' },
  { label: '小数秒全为零', toml: 'x = 1979-05-27T07:32:00.000000Z\n' },
  { label: '正偏移', toml: 'x = 1979-05-27T07:32:00+07:00\n' },
  { label: '空多行字符串', toml: 'x = """\n"""\n' },
  { label: '多行字符串里的两个引号', toml: 'x = """a""b"""\n' },
  { label: '浮点溢出按 inf 处理', toml: 'x = 1e400\ny = -1e400\n' },
  { label: '负 nan', toml: 'x = -nan\n' },
  { label: '数组里混内联表', toml: 'x = [ {a=1}, {b=2} ]\n' },
  { label: '值后面的注释', toml: 'x = 1 # 注释\n' },
  { label: '引号键里的转义', toml: '"a\\tb" = 1\n' },
  { label: '数组表之后跟别的表', toml: '[[a]]\nn = 1\n[a.b]\nc = 2\n[b]\nd = 3\n' },
  { label: '数组表元素里的点号键', toml: '[[a]]\nb.c = 1\n[[a]]\nb.c = 2\n' },
  { label: '多行字面量里的两个引号', toml: "x = '''a''b'''\n" },
  { label: 'CRLF 多行字符串', toml: 'x = """\r\na\r\nb"""\r\n' },
  { label: '制表符作分隔', toml: 'x\t=\t1\n' },
  { label: '空引号键加点号', toml: '"" . a = 1\n' },
  { label: '数组里的日期与时间', toml: 'x = [1979-05-27, 07:32:00]\n' },
  { label: '极大但有限的浮点', toml: 'x = 1e308\n' },
  { label: '十六进制零', toml: 'x = 0x0\n' },
  { label: '键里的井号', toml: '"a#b" = 1\n' },
  { label: '没有结尾换行', toml: 'x = 1 # 注释' },
  { label: '只有表头没有换行', toml: '[a]' },
  { label: '嵌套内联表里的数组', toml: 'x = { a = [1, {b=2}] }\n' },
  { label: '数组表隐式建父表后再显式定义', toml: '[[a.b]]\nx = 1\n[a]\ny = 2\n' },
  { label: 'BOM 开头（tomllib 不接受，仅本工具容忍）', toml: '\uFEFFa = 1\n', python: false },
];

/* ------------------------------------------------------------------ *
 * 1. Cross-check against tomllib
 * ------------------------------------------------------------------ */

section('与 Python tomllib 的逐值比对');
if (pythonAvailable) {
  const comparable = CORPUS.filter((entry) => entry.python !== false);
  const results = pythonParseDocs(comparable.map((entry) => entry.toml));

  const disagreements = [];
  const pythonFailures = [];
  comparable.forEach((entry, index) => {
    const theirs = results[index];
    const mine = M.parseToml(entry.toml);
    if (!theirs.ok) {
      // tomllib should accept every document in this corpus.
      pythonFailures.push(`${entry.label}: tomllib 失败了 ${theirs.error}`);
      return;
    }
    if (!mine.ok) {
      disagreements.push(`${entry.label}: 本工具解析失败 ${mine.error}`);
      return;
    }
    if (!sameValue(mine.value, theirs.value)) {
      disagreements.push(
        `${entry.label}:\n          本工具   ${JSON.stringify(stable(normaliseValue(mine.value)))}\n          tomllib  ${JSON.stringify(stable(normaliseValue(theirs.value)))}`,
      );
    }
  });

  check('tomllib 接受全部语料（说明语料本身是合法 TOML）', pythonFailures, []);
  check(`${comparable.length} 份文档的解析结果与 tomllib 完全一致`, disagreements, []);
} else {
  console.log('SKIP  与 tomllib 的逐值比对');
}

/* ------------------------------------------------------------------ *
 * 2. Round trip
 * ------------------------------------------------------------------ */

section('TOML → JSON → TOML 往返稳定');
{
  let mismatches = 0;
  let jsonStable = 0;
  for (const entry of CORPUS) {
    const first = M.parseToml(entry.toml);
    if (!first.ok) {
      mismatches += 1;
      console.log(`        ${entry.label}: 首次解析失败 ${first.error}`);
      continue;
    }
    const json = M.tomlToJson(entry.toml, 2);
    if (!json.ok) {
      mismatches += 1;
      console.log(`        ${entry.label}: 转 JSON 失败 ${json.error}`);
      continue;
    }
    const back = M.jsonToToml(json.text);
    if (!back.ok) {
      mismatches += 1;
      console.log(`        ${entry.label}: 回写 TOML 失败 ${back.error}`);
      continue;
    }
    const second = M.parseToml(back.text);
    if (!second.ok) {
      mismatches += 1;
      console.log(`        ${entry.label}: 回写后再解析失败 ${second.error}\n${back.text}`);
      continue;
    }
    if (!sameValue(first.value, second.value)) {
      mismatches += 1;
      console.log(
        `        ${entry.label}:\n          原始 ${JSON.stringify(stable(normaliseValue(first.value)))}\n          往返 ${JSON.stringify(stable(normaliseValue(second.value)))}\n          TOML ${JSON.stringify(back.text)}`,
      );
      continue;
    }
    // A second lap must produce the same TOML byte for byte. The JSON has
    // already been reordered once by then (TOML requires a table's own keys to
    // precede its sub-tables), so the fixpoint is asserted on the TOML text.
    const json2 = M.tomlToJson(back.text, 2);
    if (!json2.ok) {
      mismatches += 1;
      console.log(`        ${entry.label}: 回写后的 JSON 解析失败`);
      continue;
    }
    const back2 = M.jsonToToml(json2.text);
    if (back2.ok && back2.text === back.text) jsonStable += 1;
  }
  check(`往返 ${CORPUS.length} 份文档后值完全一致`, mismatches, 0);
  check('第二轮的 TOML 文本逐字节相同（TOML 是不动点）', jsonStable, CORPUS.length);

  // The one thing that is not stable is JSON key order, because TOML forces
  // scalars before sub-tables. The values are unaffected.
  const orderDemo = M.tomlToJson('a = {}\ny = []\nz = [[]]\n', 0);
  const orderBack = M.jsonToToml(orderDemo.text);
  const orderJson = M.tomlToJson(orderBack.text, 0);
  checkTrue('JSON 键顺序可能改变（TOML 要求标量在前）', orderDemo.text !== orderJson.text);
  check('但值完全一致', JSON.parse(orderDemo.text), JSON.parse(orderJson.text));
}

/* ------------------------------------------------------------------ *
 * 3. Generated TOML is valid (tomllib accepts it)
 * ------------------------------------------------------------------ */

section('生成的 TOML 能被 tomllib 解析（序列化正确性证明）');
{
  const dateTag = (type, value) => ({ $type: type, $value: value });
  const documents = [
    ['标量与数组', { a: 1, b: 's', c: true, d: [1, 2, 3], e: 1.5 }],
    ['嵌套表', { a: { b: { c: 1 } }, d: 2 }],
    ['数组表', { a: [{ n: 1 }, { n: 2 }] }],
    ['数组表带子表', { a: [{ n: 1, sub: { x: 1 } }, { n: 2, sub: { x: 2 } }] }],
    ['点号与空格与中文键', { 'a.b': 1, 'c d': 2, 中文: 3, '': 4 }],
    ['字符串转义', { s: 'a"b\\c\nd\te\u0001f' }],
    ['日期标签', {
      offset: dateTag('toml-offset-date-time', '1979-05-27T07:32:00Z'),
      localdt: dateTag('toml-local-date-time', '1979-05-27T07:32:00'),
      day: dateTag('toml-local-date', '1979-05-27'),
      alarm: dateTag('toml-local-time', '07:32:00'),
    }],
    ['inf 与 nan', { i: dateTag('toml-float', 'inf'), n: dateTag('toml-float', 'nan'), m: dateTag('toml-float', '-inf') }],
    ['空表与空数组', { a: {}, b: [], c: { d: {} } }],
    ['内联表数组', { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }],
    ['数组表里带空子表', { a: [{ b: {} }] }],
    ['空的数组表元素', { a: [{}] }],
    ['表里嵌套数组表', { a: { b: [{ c: 1 }] } }],
    ['数组的数组', { a: [[]] }],
    ['混合类型数组', { a: [1, { b: 2 }, 'x', true] }],
    ['同名保留字的普通键', { $type: 'x', $value: 'y', z: 1 }],
    ['深嵌套 30 层', (() => {
      let node = { leaf: 1 };
      for (let i = 0; i < 30; i += 1) node = { [`n${i}`]: node };
      return node;
    })()],
  ];

  if (pythonAvailable) {
    const generated = documents.map(([label, json]) => ({
      label,
      result: M.jsonToToml(JSON.stringify(json)),
    }));
    const failures = generated.filter((entry) => !entry.result.ok);
    for (const entry of failures) console.log(`        ${entry.label}: 生成失败 ${entry.result.error}`);
    const acceptable = generated.filter((entry) => entry.result.ok);

    const results = pythonParseDocs(acceptable.map((entry) => entry.result.text));
    let mismatches = failures.length;
    acceptable.forEach((entry, index) => {
      const theirs = results[index];
      if (!theirs.ok) {
        mismatches += 1;
        console.log(`        ${entry.label}: tomllib 拒绝生成的 TOML：${theirs.error}\n${entry.result.text}`);
        return;
      }
      const mine = M.parseToml(entry.result.text);
      if (!mine.ok || !sameValue(mine.value, theirs.value)) {
        mismatches += 1;
        console.log(
          `        ${entry.label}: 两边解析结果不同\n          本工具  ${JSON.stringify(mine.ok ? stable(normaliseValue(mine.value)) : mine.error)}\n          tomllib ${JSON.stringify(stable(normaliseValue(theirs.value)))}\n${entry.result.text}`,
        );
      }
    });
    check(`${documents.length} 份生成的 TOML 均被 tomllib 接受且解析一致`, mismatches, 0);
  } else {
    console.log('SKIP  序列化正确性证明（无 tomllib）');
  }

  // Exact output shapes, so a formatting regression is caught even without
  // Python present.
  check('数组表的确切输出', M.jsonToToml('{"a":[{"n":1},{"n":2}]}').text, '[[a]]\nn = 1\n\n[[a]]\nn = 2\n');
  check(
    '数组表带子表的确切输出',
    M.jsonToToml('{"a":[{"n":1,"sub":{"x":1}}]}').text,
    '[[a]]\nn = 1\n\n[a.sub]\nx = 1\n',
  );
  check('日期标签不加引号', M.jsonToToml('{"d":{"$type":"toml-local-date","$value":"1979-05-27"}}').text, 'd = 1979-05-27\n');
  check('+inf 写成 inf', M.jsonToToml('{"i":{"$type":"toml-float","$value":"+inf"}}').text, 'i = inf\n');
  check('键里的点号要加引号', M.jsonToToml('{"a.b":1}').text, '"a.b" = 1\n');
  check('空顶层对象得到空文档', M.jsonToToml('{}').text, '');
  check('空表写成表头', M.jsonToToml('{"a":{}}').text, '[a]\n');
}

/* ------------------------------------------------------------------ *
 * 4. JSON to TOML specifics
 * ------------------------------------------------------------------ */

section('JSON → TOML');
{
  check('非法 JSON 报错', M.jsonToToml('{oops').ok, false);
  checkContains('非法 JSON 的提示', M.jsonToToml('{oops').error, 'JSON 解析失败');
  check('顶层数组报错', M.jsonToToml('[1,2]').ok, false);
  checkContains('顶层数组的提示', M.jsonToToml('[1,2]').error, '顶层必须是对象');
  check('顶层标量报错', M.jsonToToml('42').ok, false);

  check('null 报错', M.jsonToToml('{"a":null}').ok, false);
  checkContains('null 的提示说明 TOML 没有 null', M.jsonToToml('{"a":null}').error, 'TOML 没有 null');
  checkContains('null 的提示带键路径', M.jsonToToml('{"a":{"b":null}}').error, 'a.b');
  checkContains('数组里的 null 也带下标', M.jsonToToml('{"a":[1,null]}').error, 'a[1]');
  check('null 不会被静默丢弃', M.jsonToToml('{"a":1,"b":null}').ok, false);

  check('非有限数字（非标签）报错', M.jsonToToml('{"a":1e999}').ok, false);
  checkContains('非有限数字的提示', M.jsonToToml('{"a":1e999}').error, 'inf');

  check('非法日期标签报错', M.jsonToToml('{"a":{"$type":"toml-local-date","$value":"not-a-date"}}').ok, false);
  checkContains('非法日期的提示', M.jsonToToml('{"a":{"$type":"toml-local-date","$value":"not-a-date"}}').error, '不是合法');
  check('非法 inf 标签报错', M.jsonToToml('{"a":{"$type":"toml-float","$value":"maybe"}}').ok, false);

  check(
    '字符串转义写回',
    M.jsonToToml('{"s":"a\\"b\\\\c\\nd"}').text,
    's = "a\\"b\\\\c\\nd"\n',
  );
  check('整数与浮点', M.jsonToToml('{"a":1,"b":1.5}').text, 'a = 1\nb = 1.5\n');
  check('布尔', M.jsonToToml('{"a":true,"b":false}').text, 'a = true\nb = false\n');
  check('空字符串键', M.jsonToToml('{"":1}').text, '"" = 1\n');
  check('标签歧义：只有两个键的普通表会被当成标签', M.jsonToToml('{"a":{"$type":"toml-float","$value":"inf"}}').text, 'a = inf\n');
  check(
    '三个键的表不会被当成标签',
    M.jsonToToml('{"a":{"$type":"x","$value":"y","z":1}}').ok,
    true,
  );

  const deep = (() => {
    let node = { leaf: 1 };
    for (let i = 0; i < 30; i += 1) node = { [`n${i}`]: node };
    return JSON.stringify(node);
  })();
  check('30 层深嵌套可写回', M.jsonToToml(deep).ok, true);
  const deepBack = M.jsonToToml(deep);
  check('30 层深嵌套可再解析', M.parseToml(deepBack.text).ok, true);
  checkTrue('深嵌套的键路径很长', deepBack.text.includes('n29.n28'));

  const tooDeep = (() => {
    let node = { leaf: 1 };
    for (let i = 0; i < 130; i += 1) node = { [`n${i}`]: node };
    return JSON.stringify(node);
  })();
  check('超过深度上限不崩溃、给出错误', M.jsonToToml(tooDeep).ok, false);
}

/* ------------------------------------------------------------------ *
 * 5. Boundaries and invalid TOML
 * ------------------------------------------------------------------ */

section('边界与非法 TOML');
{
  const bad = [
    ['未闭合的字符串', 'a = "x', '没有闭合'],
    ['未闭合的多行字符串', 'a = """x\n', '没有闭合'],
    ['未闭合的字面量字符串', "a = 'x", '没有闭合'],
    ['未闭合的数组', 'a = [1, 2', '没有闭合'],
    ['未闭合的内联表', 'a = { b = 1', '内联表'],
    ['重复的键', 'a = 1\na = 2', '重复的键'],
    ['表重复定义', '[a]\n[a]', '重复定义'],
    ['值之后又当表', 'a = 1\n[a]', '已经是一个值'],
    ['表之后又当值', '[a]\nb = 1\n[a.b]', '已经是一个值'],
    ['点号键之后又写表头', 'a.b = 1\n[a]', '点号键'],
    ['数组表之后又写普通表', '[[a]]\n[a]', '数组表'],
    ['普通表之后又写数组表', '[a]\n[[a]]', '不能改成数组表'],
    ['普通数组不能当表', 'a = [1]\n[a]', '普通数组'],
    ['前导零整数', 'a = 012', '前导零'],
    ['小数点后没有数字', 'a = 1.', '多余内容'],
    ['小数点前没有数字', 'a = .5', '无法识别'],
    ['双下划线', 'a = 1__0', '多余内容'],
    ['未知转义', 'a = "\\q"', '未知的转义'],
    ['代理区码位', 'a = "\\uD800"', '不是合法的 Unicode 码位'],
    ['内联表尾随逗号', 'a = { b = 1, }', '尾随逗号'],
    ['内联表跨行', 'a = { b = 1,\n c = 2 }', '内联表'],
    ['二月三十日', 'a = 1979-02-30', '没有 30 日'],
    ['十三月', 'a = 1979-13-01', '超出 1-12'],
    ['闰秒 60', 'a = 23:59:60', '超出 00-59'],
    ['25 点', 'a = 25:00:00', '超出 00-23'],
    ['表头没有键名', '[]', '没有键名'],
    ['表头没有闭合', '[a', '期望 "]"'],
    ['值之后有多余内容', 'a = 1 b = 2', '多余内容'],
    ['没有等号', 'a 1', '期望 "="'],
    ['单独的 CR 换行', 'a = 1\rb = 2', '单独的 CR'],
    ['字符串里的换行', 'a = "x\ny"', '不能有换行'],
    ['注释里的控制字符', 'a = 1 # \u0001', '控制字符'],
    ['裸键含点号以外的非法字符', 'a$ = 1', '非法字符'],
    ['超过深度上限', `a = ${'['.repeat(105)}${']'.repeat(105)}`, '嵌套超过'],
    ['infinity 不是合法值', 'x = infinity', '多余内容'],
    ['裸键不能是中文（必须加引号）', '中文 = 1', '需要一个键'],
    ['内联表不能再扩展', 'x = { a = 1 }\nx.b = 2', '内联表'],
    ['内联表里重复键', 'x = { a = 1, a = 2 }', '重复的键'],
    ['数组表与普通表混用', '[[a]]\n[a.b]\nx = 1\n[a]', '数组表'],
  ];

  let rejected = 0;
  for (const [label, toml, needle] of bad) {
    const parsed = M.parseToml(toml);
    if (!parsed.ok) rejected += 1;
    check(`${label}：报错`, parsed.ok, false);
    if (!parsed.ok) checkContains(`${label}：错误信息`, parsed.error, needle);
  }
  check(`全部 ${bad.length} 个非法样本被拒绝`, rejected, bad.length);

  // Accepted edge cases.
  check('空输入是合法的空文档', M.parseToml('').value, {});
  check('只有注释是合法的空文档', M.parseToml('# hi\n').value, {});
  check('数组允许尾随逗号', M.parseToml('a = [1, 2,]').value, { a: [1, 2] });
  check('内联表允许单行多键', M.parseToml('a = { b = 1, c = 2 }').value, { a: { b: 1, c: 2 } });
  check('空内联表', M.parseToml('a = {}').value, { a: {} });
  check('空表头', M.parseToml('[a]').value, { a: {} });
  check('BOM 被容忍', M.parseToml('\uFEFFa = 1').value, { a: 1 });
  check('CRLF 被接受', M.parseToml('a = 1\r\nb = 2').value, { a: 1, b: 2 });
  check('多行字符串开头的换行被裁掉', M.parseToml('a = """\nx"""').value, { a: 'x' });
  check('多行字符串里的换行保留', M.parseToml('a = """\nx\ny"""').value, { a: 'x\ny' });
  check('字面量字符串不转义', M.parseToml("a = 'x\\ny'").value, { a: 'x\\ny' });
  check('多行字面量字符串', M.parseToml("a = '''\nx\ny'''").value, { a: 'x\ny' });
  check('续行反斜杠合并空白', M.parseToml('a = """x \\\n   y"""').value, { a: 'x y' });
  check('多行字符串结尾的两个引号属于内容', M.parseToml('a = """x""""').value, { a: 'x"' });
  check('十六进制整数', M.parseToml('a = 0xDEAD_BEEF').value, { a: 0xdeadbeef });
  check('下划线分隔', M.parseToml('a = 1_000_000').value, { a: 1000000 });
  check('负零浮点', M.parseToml('a = -0.0').value, { a: -0 });
  check(
    '日期时间的 $value 保留原文',
    M.parseToml('a = 1979-05-27 07:32:00').value,
    { a: { $type: 'toml-local-date-time', $value: '1979-05-27 07:32:00' } },
  );
  check(
    '小写 z 也保留',
    M.parseToml('a = 1979-05-27T07:32:00z').value,
    { a: { $type: 'toml-offset-date-time', $value: '1979-05-27T07:32:00z' } },
  );
  check(
    '数组表解析成数组',
    M.parseToml('[[a]]\nn = 1\n[[a]]\nn = 2').value,
    { a: [{ n: 1 }, { n: 2 }] },
  );
  check(
    '数组表里的子表挂在对应元素上',
    M.parseToml('[[a]]\nn = 1\n[a.b]\nc = 2\n[[a]]\nn = 3\n[a.b]\nc = 4').value,
    { a: [{ n: 1, b: { c: 2 } }, { n: 3, b: { c: 4 } }] },
  );
  check('隐式表之后可以显式定义', M.parseToml('[a.b]\n[a]\nc = 1').value, { a: { b: {}, c: 1 } });
  check(
    '点号键创建嵌套表',
    M.parseToml('a.b.c = 1\na.b.d = 2').value,
    { a: { b: { c: 1, d: 2 } } },
  );
  check('引号键里的点号不是路径', M.parseToml('"a.b" = 1').value, { 'a.b': 1 });

  const big = M.parseToml('big = 9223372036854775807');
  checkTrue('超范围整数给出警告', big.warnings.some((warning) => warning.includes('精度')));
  check('超范围整数仍然解析出值', typeof big.value.big, 'number');
}

/* ------------------------------------------------------------------ *
 * 6. Counter-example: the naive line-based parser really is wrong
 * ------------------------------------------------------------------ */

section('反证：按行 split 的朴素 TOML 解析器会搞错数组表');
{
  /**
   * The naive approach: walk lines, treat `[x]` as "current table", and assign
   * `key = value` with a couple of string strips. This is what a first attempt
   * usually looks like.
   */
  function naiveToml(text) {
    const out = {};
    let current = out;
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('#')) continue;
      if (line.startsWith('[')) {
        const name = line.replace(/[[\]]/g, '');
        if (!current[name]) current[name] = {};
        current = current[name];
        continue;
      }
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
      current[key] = value;
    }
    return out;
  }

  const aot = '[[books]]\nid = "a"\n[[books]]\nid = "b"\n';
  const naive = naiveToml(aot);
  const truth = M.parseToml(aot).value;
  checkTrue('朴素解析器把数组表变成对象（不是数组）', Array.isArray(naive.books) === false);
  checkTrue('真实解析结果是数组', Array.isArray(truth.books));
  check('数组表元素个数', truth.books.length, 2);
  check('朴素解析器把第二次 [[books]] 又套了一层', naive.books.books.id, 'b');
  check('朴素解析器的第一层只有第一个元素', naive.books.id, 'a');
  check('真实结果保留两个元素', truth.books.map((book) => book.id), ['a', 'b']);

  const inline = 'x = { a = 1 }\ny = [1, 2]\n';
  const naiveInline = naiveToml(inline);
  check('朴素解析器把内联表当字符串', typeof naiveInline.x, 'string');
  check('真实结果是对象', typeof M.parseToml(inline).value.x, 'object');
  check('朴素解析器把数组当字符串', typeof naiveInline.y, 'string');
  checkTrue('真实结果是数组', Array.isArray(M.parseToml(inline).value.y));

  const numbers = 'a = 1_000\nb = 0x10\nc = true\n';
  const naiveNumbers = naiveToml(numbers);
  check('朴素解析器不处理数字下划线', naiveNumbers.a, '1_000');
  check('真实结果是数字', M.parseToml(numbers).value.a, 1000);
  check('朴素解析器不处理十六进制', naiveNumbers.b, '0x10');
  check('真实结果是数字', M.parseToml(numbers).value.b, 16);
  check('朴素解析器把布尔当字符串', naiveNumbers.c, 'true');
  check('真实结果是布尔', M.parseToml(numbers).value.c, true);

  const dotted = 'a.b = 1\n';
  check('朴素解析器把点号键当成一个平键', naiveToml(dotted), { 'a.b': '1' });
  check('真实结果是嵌套表', M.parseToml(dotted).value, { a: { b: 1 } });
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
console.log(pythonAvailable ? '（python3 tomllib 参照物已启用）' : '（python3 tomllib 不可用，已跳过比对）');
process.exit(failed === 0 ? 0 : 1);
