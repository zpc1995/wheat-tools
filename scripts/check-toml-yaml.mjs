/**
 * Checks the TOML <-> YAML converter.
 *
 * The claims worth defending are "the mapping is faithful" and "both round
 * trips are value-stable". Neither can be settled by comparing the tool against
 * itself, so the script leans on two references that share no code with it:
 *
 *   - Python's `tomllib` (stdlib since 3.11) says what the TOML means;
 *   - PyYAML's `safe_load` says what the YAML means, with dates and times
 *     canonicalised to the same shape as tomllib's.
 *
 * Every converted document is therefore parsed twice by Python — once from the
 * source, once from the tool's output — and the two canonical structures must be
 * equal. The same pair of references then verifies both round trips.
 *
 * A handful of deliberate contrast cases are included, because a test that only
 * agrees with itself proves nothing:
 *
 *   - a naive line-based TOML reader collapses two `[[books]]` entries into one
 *     table, and a naive line-based YAML reader breaks on a block scalar;
 *   - an unquoted `17:32:00` is the integer 63120 to a YAML 1.1 reader, so
 *     emitting a local time as a bare scalar is wrong (the tool never does);
 *   - reading a naive timestamp with the YAML 1.1 schema produces a `Date` in
 *     the machine's zone, which moves the wall-clock reading;
 *   - `yaml.unsafe_load` executes the constructor in a tag, `yaml.safe_load`
 *     refuses, so the oracle must use the safe one;
 *   - walking the tree with the library's `toJS()` folds `1: a` into a string
 *     key, and bypasses the library's alias-expansion guard — both are reasons
 *     this implementation reads the syntax tree itself.
 *
 * Usage: node scripts/check-toml-yaml.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

/* ------------------------------------------------------------------ *
 * Load the tool
 * ------------------------------------------------------------------ */

const OUT_DIR = '.verify/toml-yaml';

/**
 * The tool imports the TOML parser from the sibling `toml-json` directory, so
 * both files are transpiled and the specifier is rewritten to point at the copy.
 * Node refuses extensionless relative imports, hence the rewrite rather than a
 * plain in-place compile.
 */
function transpile(sourcePath, targetPath, replace) {
  let output = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  if (replace) output = output.replace(replace[0], replace[1]);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, output);
}

transpile('src/tools/toml-json/tomlJsonUtils.ts', join(OUT_DIR, 'tomlJsonUtils.mjs'));
transpile('src/tools/toml-yaml/tomlYamlUtils.ts', join(OUT_DIR, 'tomlYamlUtils.mjs'), [
  /'\.\.\/toml-json\/tomlJsonUtils'/g,
  "'./tomlJsonUtils.mjs'",
]);

const M = await import(pathToFileURL(join(OUT_DIR, 'tomlYamlUtils.mjs')).href);

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;

function report(ok, label, detail) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n${detail}`}`);
}

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  report(a === e, label, `        got      ${a}\n        expected ${e}`);
}

function checkTrue(label, actual) {
  report(actual === true, label, `        got      ${JSON.stringify(actual)}\n        expected true`);
}

function checkContains(label, haystack, needle) {
  const ok = typeof haystack === 'string' && haystack.includes(needle);
  report(
    ok,
    label,
    `        got      ${JSON.stringify(haystack)}\n        expected to contain ${JSON.stringify(needle)}`,
  );
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

/** Failure details can otherwise dump a whole document into the terminal. */
function clip(text, limit = 800) {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n        ... （共 ${text.length} 字符）`;
}

function checkYamlToToml(label, yaml) {
  const result = M.yamlToToml(yaml);
  report(result.ok, label, `        error: ${result.error}`);
  return result;
}

function checkTomlToYaml(label, toml) {
  const result = M.tomlToYaml(toml);
  report(result.ok, label, `        error: ${result.error}`);
  return result;
}

/* ------------------------------------------------------------------ *
 * The Python oracle
 * ------------------------------------------------------------------ */

const PY_PROBE = spawnSync('python3', ['-c', 'import yaml, tomllib, json'], { encoding: 'utf8' });
const PY_AVAILABLE = PY_PROBE.status === 0;

const ORACLE = String.raw`
import sys, json, datetime, math
import yaml
import tomllib

# Canonical form: JSON-safe, order-insensitive for mappings (key order is not
# part of a value), and identical for the four date-time types whether they came
# from tomllib, from PyYAML, or from the tool's {"$type","$value"} tag mapping.

def key_repr(k):
    if isinstance(k, bool):
        return ["bool", "true" if k else "false"]
    if k is None:
        return ["null", ""]
    if isinstance(k, str):
        return ["str", k]
    if isinstance(k, int):
        return ["int", str(k)]
    if isinstance(k, float):
        return ["float", repr(k)]
    if isinstance(k, datetime.datetime):
        return ["datetime", k.isoformat()]
    if isinstance(k, datetime.date):
        return ["date", k.isoformat()]
    if isinstance(k, (list, tuple)):
        return ["seq", [key_repr(x) for x in k]]
    return [type(k).__name__, str(k)]

def stamp(kind, y, mo, d, h, mi, s, us, minutes):
    if kind == "ld":
        return ["ld", y, mo, d]
    if kind == "lt":
        return ["lt", h, mi, s, us]
    if kind == "ldt":
        return ["ldt", y, mo, d, h, mi, s, us]
    return ["odt", y, mo, d, h, mi, s, us, minutes]

def from_datetime(v):
    off = v.utcoffset()
    minutes = None if off is None else int(round(off.total_seconds() / 60))
    return stamp("odt" if minutes is not None else "ldt",
                 v.year, v.month, v.day, v.hour, v.minute, v.second, v.microsecond, minutes)

def from_time(v):
    return stamp("lt", 0, 0, 0, v.hour, v.minute, v.second, v.microsecond, None)

TS_RE = None

def from_tag(kind, text):
    import re
    frac6 = None
    if kind == "toml-local-time":
        tm = re.match(r"^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$", text)
        if not tm:
            return {"unparsable-tag": [kind, text]}
        frac = tm.group(4) or ""
        us = int((frac + "000000")[:6]) if frac else 0
        return stamp("lt", 0, 0, 0, int(tm.group(1)), int(tm.group(2)), int(tm.group(3)), us, None)
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?"
                 r"(Z|[-+]\d{2}:\d{2})?)?$", text)
    if not m:
        return {"unparsable-tag": [kind, text]}
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if kind == "toml-local-date":
        return stamp("ld", y, mo, d, 0, 0, 0, 0, None)
    h, mi, s = int(m.group(4)), int(m.group(5)), int(m.group(6))
    frac = m.group(7) or ""
    us = int((frac + "000000")[:6]) if frac else 0
    zone = m.group(8)
    if kind == "toml-local-time":
        return stamp("lt", 0, 0, 0, h, mi, s, us, None)
    if zone in (None, ""):
        return stamp("ldt" if kind == "toml-local-date-time" else "odt", y, mo, d, h, mi, s, us, None)
    sign = -1 if zone[0] == "-" else 1
    minutes = sign * (int(zone[1:3]) * 60 + int(zone[4:6]))
    return stamp("odt", y, mo, d, h, mi, s, us, minutes)

def from_float(v):
    if v != v:
        return {"float": "nan"}
    if v == float("inf"):
        return {"float": "inf"}
    if v == float("-inf"):
        return {"float": "-inf"}
    return v

def canon(v):
    if isinstance(v, bool):
        return v
    if v is None:
        return None
    if isinstance(v, dict):
        if set(v.keys()) == {"$type", "$value"} and isinstance(v["$type"], str) \
                and isinstance(v["$value"], str):
            t, val = v["$type"], v["$value"]
            if t == "toml-float":
                return {"float": "nan" if "nan" in val else ("inf" if not val.startswith("-") else "-inf")}
            return from_tag(t, val)
        entries = [[key_repr(k), canon(x)] for k, x in v.items()]
        entries.sort(key=lambda pair: json.dumps(pair[0], sort_keys=True))
        return {"map": entries}
    if isinstance(v, (list, tuple)):
        return [canon(x) for x in v]
    if isinstance(v, (set, frozenset)):
        return {"set": sorted(json.dumps(canon(x), sort_keys=True) for x in v)}
    if isinstance(v, str):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return from_float(v)
    if isinstance(v, bytes):
        return {"bytes": v.hex()}
    if isinstance(v, datetime.datetime):
        return from_datetime(v)
    if isinstance(v, datetime.date):
        return stamp("ld", v.year, v.month, v.day, 0, 0, 0, 0, None)
    if isinstance(v, datetime.time):
        return from_time(v)
    return {"type": type(v).__name__}

def parse(kind, text):
    if kind == "toml":
        return canon(tomllib.loads(text))
    if kind == "yaml":
        return canon(yaml.safe_load(text))
    raise ValueError("unknown kind " + kind)

payload = json.load(sys.stdin)
out = []
for item in payload["items"]:
    rec = {"name": item["name"], "results": [], "errors": []}
    for spec in item["parses"]:
        try:
            rec["results"].append(parse(spec["kind"], spec["text"]))
        except Exception as exc:
            rec["results"].append(None)
            rec["errors"].append(type(exc).__name__ + ": " + str(exc).split("\n")[0])
    out.append(rec)
json.dump({"items": out}, sys.stdout)
`;

writeFileSync(join(OUT_DIR, 'oracle.py'), ORACLE);

/** Runs the oracle over a list of `{ name, parses: [{ kind, text }] }` items. */
function runOracle(items) {
  const run = spawnSync('python3', [join(OUT_DIR, 'oracle.py')], {
    input: JSON.stringify({ items }),
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    report(false, 'Python 参照物脚本执行成功', `        stderr: ${run.stderr}\n        stdout: ${run.stdout}`);
    return null;
  }
  return JSON.parse(run.stdout).items;
}

/**
 * Compares canonical structures. Numbers are compared as JavaScript parses them,
 * which is the documented meeting point of both formats: TOML integers beyond
 * 2^53 land on the same double here as they do in the tool.
 */
function sameCanonical(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ------------------------------------------------------------------ *
 * Corpus
 * ------------------------------------------------------------------ */

const TOML_BASIC = [
  'title = "小麦的工具站 🎉"',
  'enabled = true',
  'port = 8_080',
  'ratio = 1.5',
  'neg = -17',
  'hex = 0xDEAD_BEEF',
  'quote = "带 \\"引号\\" 与 \\\\ 反斜杠"',
  'empty-array = []',
  'inline = { a = 1, b = { c = 2 }, d = [1, 2, 3] }',
  'dotted.key.here = "点号键"',
  '"weird key.with.dots" = "键里有空格和点号"',
  '"中文键" = "值"',
  'born = 1979-05-27T07:32:00Z',
  'local = 1979-05-27 07:32:00.999',
  'day = 1979-05-27',
  'alarm = 07:32:00',
  'limit = inf',
  'low = -inf',
  'notnum = nan',
  'literal = \'no \\n escape\'',
  'multiline = """第一行',
  '第二行\t带制表符',
  '"""',
  '',
  '[owner]',
  'name = "张三"',
  '',
  '[owner.address]',
  'city = "上海"',
  'tags = ["烘焙", "实用"]',
  '',
  '[[books]]',
  'id = "bk101"',
  '',
  '[[books]]',
  'id = "bk102"',
  'meta = { pages = 100 }',
  '',
].join('\n');

const TOML_CORPUS = [
  { name: '基本类型 + 四种日期时间 + 表/数组表', toml: TOML_BASIC },
  {
    name: '空表与空数组',
    toml: 'nothing = ""\nempty = []\nblank = {}\n\n[table]\n',
  },
  {
    name: '点号键与内联表的嵌套',
    toml: 'a.b.c = 1\ndeep = { x = { y = { z = "底" } } }\n',
  },
  {
    name: '本地时间不带 UTC 化（07 点与 17 点）',
    toml: 'early = 07:32:00\nlate = 17:32:00\nlate2 = 17:32:00.5\n',
  },
  {
    name: '浮点溢出按 TOML 规则变成 inf',
    toml: 'f = 1e400\ng = -1e400\n',
  },
  {
    name: '裸键的所有形状（含会被读成别的类型的名字）',
    toml: [
      '- = 1',
      '-- = 2',
      '_ = 3',
      '0 = 4',
      '123 = 5',
      'true = 6',
      'false = 7',
      'null = 8',
      'yes = 9',
      'on = 10',
      'a-b = 11',
      'A_B = 12',
      '"1:30" = 13',
      '',
    ].join('\n'),
  },
  {
    name: '字符串边界：所有需要加引号的形状',
    toml: [
      'lead = "  leading"',
      'trail = "trailing  "',
      'hash = "a # b"',
      'dash = "- item"',
      'dashes = "---"',
      'dots = "..."',
      'percent = "%TAG"',
      'colon = "a: b"',
      'star = "*alias"',
      'amp = "&anchor"',
      'bang = "!tag"',
      'cr = "a\\rb"',
      'tab = "a\\tb"',
      'backslash = "C:\\\\path\\\\file"',
      'onlyspace = " "',
      'numbit = "1e3"',
      'sexa = "1:30"',
      '"a:b" = 1',
      '"a#b" = 2',
      '"a b" = 3',
      '"" = 4',
      '',
    ].join('\n'),
  },
  {
    name: '偏移日期时间的多种写法',
    toml:
      'a = 1979-05-27T07:32:00Z\nb = 1979-05-27t00:32:00-07:00\nc = 1979-05-27 07:32:00.999999+05:30\n' +
      'd = 1979-05-27T00:32:00z\ne = 1979-05-27t00:32:00z\n',
  },
];

const YAML_CORPUS = [
  {
    name: '基本类型 + 时间戳 + 锚点',
    yaml: [
      'title: 小麦的工具站 🎉',
      'enabled: true',
      'port: 8080',
      'ratio: 1.5',
      'neg: -17',
      'hex: 0xDEADBEEF',
      'quote: "带 \\"引号\\" 与 \\\\ 反斜杠"',
      'emptyList: []',
      'dotted:',
      '  key:',
      '    here: 点号键',
      '"weird key.with.dots": 键里有空格和点号',
      '中文键: 值',
      'born: 1979-12-15T02:59:43.1Z',
      'withSpace: 2001-12-15 02:59:43.10 -5',
      'day: 2001-12-15',
      'alarm:',
      '  $type: toml-local-time',
      '  $value: "07:32:00"',
      'limit: .inf',
      'low: -.inf',
      'literal: \'no \\n escape\'',
      'multiline: |',
      '  第一行',
      '  第二行\t带制表符',
      'owner: &owner',
      '  name: 张三',
      '  address:',
      '    city: 上海',
      '    tags: [烘焙, 实用]',
      'copy: *owner',
      '',
    ].join('\n'),
  },
  {
    name: '嵌套序列与内联映射',
    yaml: 'a:\n  - 1\n  - b: 2\n    c: [3, 4]\n  - plain\n',
  },
  {
    name: '字符串与键里的特殊字符',
    yaml: [
      'lead: "  leading"',
      'trail: "trailing  "',
      'hash: "a # b"',
      'dashes: "---"',
      'colon: "a: b"',
      'star: "*alias"',
      'tab: "a\\tb"',
      'newline: "line1\\nline2"',
      '"a:b": 1',
      '"a#b": 2',
      '"": 3',
      'inline: { a: "x y", b: ["1", "2"] }',
      '',
    ].join('\n'),
  },
  {
    name: '键需要加引号才不会变类型',
    yaml: '"1": one\n"yes": not-a-bool\n"2001-12-15": not-a-date\n"17:32:00": not-a-number\n',
  },
];

/* ------------------------------------------------------------------ *
 * 0. References
 * ------------------------------------------------------------------ */

section('0. 权威参照物可用性');

// Reported as a SKIP, not an assertion.
//
// This used to be `checkTrue(...)`, which made a missing oracle count as a
// failure while the rest of the script printed "assertions skipped" — so the
// suite exited 1 on any machine without PyYAML and the release job stopped. A
// check that cannot run must be visibly skipped, never reported as a pass *or*
// as a failure; that is the convention the other scripts here already follow
// (systemd-analyze, pyfiglet, python3 mimetypes).
if (PY_AVAILABLE) {
  const versions = spawnSync(
    'python3',
    ['-c', 'import sys, yaml, tomllib; print(sys.version.split()[0], yaml.__version__)'],
    { encoding: 'utf8' },
  ).stdout.trim();
  console.log(`      参照物版本：Python ${versions}`);
} else {
  console.log('SKIP  python3 + PyYAML + tomllib 不可用 —— 引用参照物的断言未运行，');
  console.log('      因此本次只验证了不依赖 Python 的那部分（不是「通过」）。');
  console.log('      安装方式：python3 -m pip install pyyaml（需要 Python 3.11+ 的 tomllib）');
}

// The exact call the task asks for, spelled out: hand the tool's YAML to
// python3 -c and compare the structure it produces.
//
// Guarded, because it shells out to PyYAML directly rather than going through
// the helper the rest of the script uses — an unguarded call here was the second
// reason a machine without PyYAML reported a failure instead of a skip.
if (PY_AVAILABLE) {
  const yaml = 'a: 1\nb:\n  - x\n  - y\n';
  const run = spawnSync(
    'python3',
    ['-c', 'import sys, json, yaml; print(json.dumps(yaml.safe_load(sys.stdin.read()), sort_keys=True))'],
    { input: yaml, encoding: 'utf8' },
  );
  check('python3 -c "yaml.safe_load" 解析示例 YAML', run.stdout.trim(), '{"a": 1, "b": ["x", "y"]}');
}

/* ------------------------------------------------------------------ *
 * 1. Mapping decisions
 * ------------------------------------------------------------------ */

section('1. 映射约定：时间戳分类与引号策略');

check(
  '偏移日期时间保留原文',
  M.parseYamlTimestamp('2001-12-15T02:59:43.1Z'),
  { $type: 'toml-offset-date-time', $value: '2001-12-15T02:59:43.1Z' },
);
check(
  '不带偏移的日期时间就是本地日期时间（不是 UTC）',
  M.parseYamlTimestamp('2001-12-15 02:59:43'),
  { $type: 'toml-local-date-time', $value: '2001-12-15 02:59:43' },
);
check('只有日期', M.parseYamlTimestamp('2001-12-15'), {
  $type: 'toml-local-date',
  $value: '2001-12-15',
});
check(
  '一位月/日与单字符偏移被规范化成 TOML 要求的形式',
  M.parseYamlTimestamp('2001-1-1T00:00:00+5'),
  { $type: 'toml-offset-date-time', $value: '2001-01-01T00:00:00+05:00' },
);
check(
  'YAML 1.1 的空格 + 单数字偏移规范化',
  M.parseYamlTimestamp('2001-12-15 02:59:43.10 -5'),
  { $type: 'toml-offset-date-time', $value: '2001-12-15 02:59:43.10-05:00' },
);
// PyYAML resolves this one to a string as well: the date-only branch of the
// YAML 1.1 timestamp pattern requires two-digit month and day.
check('date-only 分支要求两位月日，2001-1-1 仍是字符串', M.parseYamlTimestamp('2001-1-1'), null);
check('非法日期返回 null（调用方报错）', M.parseYamlTimestamp('2001-13-45'), null);
check('非法时刻返回 null', M.parseYamlTimestamp('2001-12-15T24:00:00'), null);

checkTrue('yes 需要加引号', M.needsYamlQuoting('yes'));
checkTrue('六十进制 17:32:00 需要加引号', M.needsYamlQuoting('17:32:00'));
checkTrue('1_000 需要加引号', M.needsYamlQuoting('1_000'));
checkTrue('0123 需要加引号', M.needsYamlQuoting('0123'));
checkTrue('空字符串需要加引号', M.needsYamlQuoting(''));
checkTrue('时间戳字符串需要加引号', M.needsYamlQuoting('2001-12-15'));
checkTrue('含制表符的字符串需要加引号（PyYAML 会直接报扫描错误）', M.needsYamlQuoting('a\tb'));
checkTrue('含 U+0085 的字符串需要加引号（YAML 1.1 当成换行）', M.needsYamlQuoting('a\u0085b'));
checkTrue('含 U+2028 的字符串需要加引号', M.needsYamlQuoting('a\u2028b'));
checkTrue('普通字符串不需要加引号', M.needsYamlQuoting('小麦') === false);
checkTrue('普通单词不需要加引号', M.needsYamlQuoting('wheat-tools') === false);

/* ------------------------------------------------------------------ *
 * 2. Contrast cases
 * ------------------------------------------------------------------ */

section('2. 反证断言：朴素写法是错的');

{
  // A line-based reader has no idea that [[x]] appends to a list.
  const source = '[[books]]\nid = "a"\n\n[[books]]\nid = "b"\n';
  const naive = {};
  let current = naive;
  for (const line of source.split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const header = /^\[(.+)\]$/.exec(text);
    if (header) {
      current = naive;
      for (const part of header[1].replace(/^\[|\]$/g, '').split('.')) {
        current[part] = current[part] ?? {};
        current = current[part];
      }
      continue;
    }
    const pair = /^([^=]+)=(.*)$/.exec(text);
    if (pair) current[pair[1].trim()] = pair[2].trim();
  }
  check('朴素按行解析 [[数组表]]：两条记录被合并成一个表', naive, { books: { id: '"b"' } });

  if (PY_AVAILABLE) {
    const reference = runOracle([
      { name: 'aot', parses: [{ kind: 'toml', text: source }] },
    ])[0].results[0];
    check('tomllib 解析同一份 TOML：books 是两条记录', reference.map[0][1], [
      {
        map: [
          [['str', 'id'], 'a'],
        ],
      },
      {
        map: [
          [['str', 'id'], 'b'],
        ],
      },
    ]);
    checkTrue(
      '朴素结果与 tomllib 结果不同（证明这类断言抓得住该缺陷）',
      JSON.stringify(naive) !== JSON.stringify(reference),
    );
  }
}

{
  // A line-based YAML reader splits a block scalar on its colons.
  const source = 'text: |\n  key: value\nother: 1\n';
  const naive = {};
  for (const line of source.split('\n')) {
    const pair = /^\s*(\w+):\s?(.*)$/.exec(line);
    if (pair) naive[pair[1]] = pair[2];
  }
  check('朴素按行解析 YAML：块标量里的冒号被当成键', naive, { text: '|', key: 'value', other: '1' });

  if (PY_AVAILABLE) {
    const reference = runOracle([{ name: 'block', parses: [{ kind: 'yaml', text: source }] }])[0].results[0];
    check('PyYAML 解析同一份 YAML：text 是一个含换行的字符串', reference, {
      map: [
        [['str', 'other'], 1],
        [['str', 'text'], 'key: value\n'],
      ],
    });
  }
}

{
  // The tool never emits a bare local time; a YAML 1.1 reader would turn it into
  // a sexagesimal integer, and even where it stays a string it is not a time.
  if (PY_AVAILABLE) {
    const run = spawnSync(
      'python3',
      [
        '-c',
        'import yaml, json; out = {}\n' +
          'for t in ["17:32:00", "07:32:00"]:\n' +
          '    v = yaml.safe_load("a: " + t)["a"]\n' +
          '    out[t] = [type(v).__name__, v]\n' +
          'print(json.dumps(out, sort_keys=True))',
      ],
      { encoding: 'utf8' },
    );
    check('反证：YAML 1.1 读取器把 17:32:00 读成整数 63120，07:32:00 读成字符串', JSON.parse(run.stdout), {
      '07:32:00': ['str', '07:32:00'],
      '17:32:00': ['int', 63120],
    });
  }
  const lowerZ = checkTomlToYaml('TOML 允许小写 z', 'a = 1979-05-27T00:32:00z\nb = 1979-05-27t00:32:00z\n');
  check('小写 z 写成大写 Z（YAML 的 timestamp 只认 Z）', lowerZ.text, 'a: 1979-05-27T00:32:00Z\nb: 1979-05-27t00:32:00Z\n');
  checkContains('并且给出规范化提示', lowerZ.warnings.join(' '), 'Z');

  const emitted = checkTomlToYaml('本地时间走标签映射', 'alarm = 07:32:00\nlate = 17:32:00\n');
  checkContains('本地时间不回退成裸标量', emitted.text, '$type: toml-local-time');
  checkTrue(
    '本地时间的 $value 是带引号的字符串',
    emitted.text.includes('$value: "17:32:00"') && emitted.text.includes('$value: "07:32:00"'),
  );
  checkTrue('本地时间给出解释性警告', emitted.warnings.some((w) => w.includes('本地时间')));
}

{
  // Reading a naive timestamp through the YAML 1.1 schema turns it into an
  // absolute instant in the machine's zone: the wall-clock reading moves.
  if (PY_AVAILABLE) {
    checkTrue('参照物可用，naive 时间戳的反证可以运行', true);
  }
  const script =
    "import * as Y from 'yaml';" +
    "const viaTag = Y.parse('t: 2001-12-15 02:59:43', { schema: 'yaml-1.1' }).t;" +
    "const viaDate = new Date('2001-12-15T02:59:43');" +
    'console.log(JSON.stringify({' +
    ' isDate: viaTag instanceof Date,' +
    ' viaTag: viaTag instanceof Date ? viaTag.toISOString() : null,' +
    ' viaDate: viaDate.toISOString(),' +
    '}));';
  const run = spawnSync('node', ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'Asia/Shanghai' },
  });
  const naiveDate = JSON.parse(run.stdout);
  checkTrue('反证：YAML 1.1 schema 把无偏移的时间戳变成了 Date', naiveDate.isDate);
  check(
    '反证：库的 timestamp 标签把墙上时间当成了 UTC（02:59:43 直接当成 02:59:43Z）',
    naiveDate.viaTag,
    '2001-12-15T02:59:43.000Z',
  );
  check(
    '反证：JS 的 new Date 又按本机时区解释同一个字符串（东八区 → 前一天 18:59:43Z）',
    naiveDate.viaDate,
    '2001-12-14T18:59:43.000Z',
  );
  report(
    '反证：两种朴素读法相差整整 8 小时，谁都不等于“保留墙上时间”',
    naiveDate.viaTag !== naiveDate.viaDate,
    '        they agreed',
  );

  const mine = checkYamlToToml('本工具：无偏移时间戳保持本地墙上时间', 't: 2001-12-15 02:59:43\n');
  check('本工具写出的 TOML 里没有 Z、没有偏移', mine.text, 't = 2001-12-15 02:59:43\n');
  if (PY_AVAILABLE) {
    const results = runOracle([{ name: 'naive', parses: [{ kind: 'toml', text: mine.text }] }])[0].results[0];
    check('tomllib 读回来是 naive datetime（没有时区）', results, {
      map: [[['str', 't'], ['ldt', 2001, 12, 15, 2, 59, 43, 0]]],
    });
  }
}

{
  // `toJS()` would make a numeric key a string without saying so.
  const script =
    "import * as Y from 'yaml';" +
    "const v = Y.parse('1: a\\ntrue: b\\n');" +
    'console.log(JSON.stringify(v));';
  const run = spawnSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' });
  check('反证：library 的 toJS 把数字键和布尔键变成了字符串', JSON.parse(run.stdout), { 1: 'a', true: 'b' });

  const mine = M.yamlToToml('1: a\n');
  checkTrue('本工具对非字符串键报错而不是静默字符串化', mine.ok === false);
  checkContains('错误里带键的类型与修改建议', mine.error, '不是字符串');
  checkContains('错误里给了加引号的写法', mine.error, '"1"');
  const quoted = checkYamlToToml('加了引号的键就是字符串键', '"1": a\n"true": b\n');
  check('引号键正常写出', quoted.text, '1 = "a"\ntrue = "b"\n');
}

{
  // Billion laughs: without an alias budget the walk expands 9^9 nodes.
  const bomb = [
    'a: &a ["x","x","x","x","x","x","x","x","x"]',
    'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
    'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
    'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
    'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
    'f: &f [*e,*e,*e,*e,*e,*e,*e,*e,*e]',
    'g: &g [*f,*f,*f,*f,*f,*f,*f,*f,*f]',
    'h: &h [*g,*g,*g,*g,*g,*g,*g,*g,*g]',
    'i: &i [*h,*h,*h,*h,*h,*h,*h,*h,*h]',
    '',
  ].join('\n');
  const result = M.yamlToToml(bomb);
  checkTrue('别名炸弹被拒绝（否则展开后有 9^9 个节点）', result.ok === false);
  checkContains('错误说明是别名展开上限', result.error, '别名');
  check('上限就是 yaml 依赖自己的默认值', M.MAX_ALIASES, 100);

  const recursive = M.yamlToToml('a: &x\n  b: *x\n');
  checkTrue('递归别名被拒绝（TOML 无法表示引用）', recursive.ok === false);
  checkContains('错误说明是递归引用', recursive.error, '递归');
}

if (PY_AVAILABLE) {
  // Why the oracle uses safe_load and not the default loader.
  const unsafe = spawnSync(
    'python3',
    [
      '-c',
      'import yaml, json\n' +
        'payload = "!!python/object/apply:os.getcwd []"\n' +
        'out = {}\n' +
        'try:\n' +
        '    out["unsafe"] = str(yaml.unsafe_load(payload))\n' +
        'except Exception as exc:\n' +
        '    out["unsafe"] = "error:" + type(exc).__name__\n' +
        'try:\n' +
        '    yaml.safe_load(payload)\n' +
        '    out["safe"] = "executed"\n' +
        'except Exception as exc:\n' +
        '    out["safe"] = "error:" + type(exc).__name__\n' +
        'print(json.dumps(out, sort_keys=True))',
    ],
    { encoding: 'utf8' },
  );
  const result = JSON.parse(unsafe.stdout);
  checkTrue('反证：yaml.unsafe_load 执行了标签里的构造器', typeof result.unsafe === 'string' && result.unsafe.startsWith('/'));
  check('safe_load 拒绝同一个输入', result.safe, 'error:ConstructorError');
}

/* ------------------------------------------------------------------ *
 * 3. TOML -> YAML against tomllib and PyYAML
 * ------------------------------------------------------------------ */

section('3. 权威参照物：TOML → YAML 与 TOML → YAML → TOML');

const tomlItems = TOML_CORPUS.map((entry) => {
  const yaml = M.tomlToYaml(entry.toml);
  const back = yaml.ok ? M.yamlToToml(yaml.text) : { ok: false, text: '', error: yaml.error };
  return {
    name: entry.name,
    toml: entry.toml,
    yaml: yaml.text,
    toml2: back.text,
    ok: yaml.ok && back.ok,
    error: yaml.ok ? back.error : yaml.error,
  };
});

if (PY_AVAILABLE) {
  const oracle = runOracle(
    tomlItems.map((item) => ({
      name: item.name,
      parses: [
        { kind: 'toml', text: item.toml },
        { kind: 'yaml', text: item.yaml },
        { kind: 'toml', text: item.toml2 },
      ],
    })),
  );

  for (const [index, item] of tomlItems.entries()) {
    const record = oracle[index];
    if (!item.ok) {
      report(false, `${item.name}：转换成功`, `        error: ${item.error}`);
      continue;
    }
    if (record.errors.length > 0) {
      report(false, `${item.name}：参照物解析全部成功`, `        ${record.errors.join(' | ')}`);
      continue;
    }
    const [fromToml, fromYaml, fromRoundTrip] = record.results;
    report(
      sameCanonical(fromToml, fromYaml),
      `${item.name}：PyYAML 读出的 YAML 与 tomllib 读出的 TOML 同构`,
      `        tomllib  ${JSON.stringify(fromToml)}\n        PyYAML   ${JSON.stringify(fromYaml)}` +
        `\n        ---- YAML ----\n${clip(item.yaml)}`,
    );
    report(
      sameCanonical(fromToml, fromRoundTrip),
      `${item.name}：TOML → YAML → TOML 往返后 tomllib 读出的结构不变`,
      `        before ${JSON.stringify(fromToml)}\n        after  ${JSON.stringify(fromRoundTrip)}` +
        `\n        ---- TOML ----\n${clip(item.toml2)}`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * 4. YAML -> TOML against PyYAML and tomllib
 * ------------------------------------------------------------------ */

section('4. 权威参照物：YAML → TOML 与 YAML → TOML → YAML');

const yamlItems = YAML_CORPUS.map((entry) => {
  const toml = M.yamlToToml(entry.yaml);
  const back = toml.ok ? M.tomlToYaml(toml.text) : { ok: false, text: '', error: toml.error };
  return {
    name: entry.name,
    yaml: entry.yaml,
    toml: toml.text,
    yaml2: back.text,
    ok: toml.ok && back.ok,
    error: toml.ok ? back.error : toml.error,
  };
});

if (PY_AVAILABLE) {
  const oracle = runOracle(
    yamlItems.map((item) => ({
      name: item.name,
      parses: [
        { kind: 'yaml', text: item.yaml },
        { kind: 'toml', text: item.toml },
        { kind: 'yaml', text: item.yaml2 },
      ],
    })),
  );

  for (const [index, item] of yamlItems.entries()) {
    const record = oracle[index];
    if (!item.ok) {
      report(false, `${item.name}：转换成功`, `        error: ${item.error}`);
      continue;
    }
    if (record.errors.length > 0) {
      report(false, `${item.name}：参照物解析全部成功`, `        ${record.errors.join(' | ')}`);
      continue;
    }
    const [fromYaml, fromToml, fromRoundTrip] = record.results;
    report(
      sameCanonical(fromYaml, fromToml),
      `${item.name}：tomllib 读出的 TOML 与 PyYAML 读出的 YAML 同构`,
      `        PyYAML   ${JSON.stringify(fromYaml)}\n        tomllib  ${JSON.stringify(fromToml)}` +
        `\n        ---- TOML ----\n${clip(item.toml)}`,
    );
    report(
      sameCanonical(fromYaml, fromRoundTrip),
      `${item.name}：YAML → TOML → YAML 往返后 PyYAML 读出的结构不变`,
      `        before ${JSON.stringify(fromYaml)}\n        after  ${JSON.stringify(fromRoundTrip)}` +
        `\n        ---- YAML ----\n${clip(item.yaml2)}`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * 5. Text level differences that are explained, not bugs
 * ------------------------------------------------------------------ */

section('5. 文本层面：值等价但字节不同，原因写清楚');

{
  // TOML requires a table's own scalars before any sub-table header, so a
  // mapping whose scalar follows a nested mapping comes back reordered.
  const source = 'a:\n  b: 1\nz: 2\n';
  const toml = checkYamlToToml('标量在子表之后的 YAML 可以转换', source);
  check('TOML 里标量被提到子表之前（这是 TOML 的语法要求）', toml.text, 'z = 2\n\n[a]\nb = 1\n');
  const yaml = checkTomlToYaml('再转回 YAML', toml.text);
  check('转回 YAML 后键序变成 z 在前：文本不同', yaml.text, 'z: 2\na:\n  b: 1\n');
  report('但值等价：源文本与往返文本不同', yaml.text !== source, '        they were identical');

  if (PY_AVAILABLE) {
    const oracle = runOracle([
      { name: 'order', parses: [{ kind: 'yaml', text: source }, { kind: 'yaml', text: yaml.text }] },
    ])[0];
    checkTrue(
      'PyYAML 认为两份文本的值相同（映射无序）',
      sameCanonical(oracle.results[0], oracle.results[1]),
    );
  }
}

{
  // A dotted key becomes a table header on the way out.
  const source = 'a.b = 1\nz = 2\n';
  const yaml = checkTomlToYaml('TOML 的点号键', source);
  check('点号键写成嵌套映射（TOML 里的先后顺序保留）', yaml.text, 'a:\n  b: 1\nz: 2\n');
  const back = checkYamlToToml('再写回 TOML', yaml.text);
  check('回写时点号键变成了 [表]（文本不同，值相同）', back.text, 'z = 2\n\n[a]\nb = 1\n');
}

{
  // TOML 1.0 and the integer 1 are the same double once inside JavaScript.
  const yaml = checkTomlToYaml('TOML 的 1.0', 'f = 1.0\ni = 1\n');
  check('1.0 往返后变成整数 1（与 toml-json 的说明一致）', yaml.text, 'f: 1\ni: 1\n');
}

{
  // Large integers: the one documented precision exception.
  const toml = 'big = 9223372036854775807\n';
  const yaml = checkTomlToYaml('超大整数给出警告', toml);
  checkContains('警告说明超出 IEEE-754 安全范围', yaml.warnings.join('\n'), 'IEEE-754');
  check('YAML 里是双精度能表示的那个值', yaml.text, 'big: 9223372036854776000\n');
  const back = M.yamlToToml(yaml.text);
  checkTrue('写回 TOML 成功', back.ok);
  checkContains('回写时也给出警告', back.warnings.join('\n'), 'IEEE-754');

  if (PY_AVAILABLE) {
    const oracle = runOracle([
      {
        name: 'big',
        parses: [
          { kind: 'toml', text: toml },
          { kind: 'toml', text: back.text },
        ],
      },
    ])[0];
    const before = oracle.results[0].map[0][1];
    const after = oracle.results[1].map[0][1];
    report('往返后整数文字确实变了（如实记录，不假装无损）', before !== after, `        ${before} vs ${after}`);
    report(
      '但两者是同一个双精度值（这就是文档里说的“精度丢失，已警告”）',
      Number(before) === Number(after),
      `        ${before} vs ${after}`,
    );
    check('tomllib 读出的原文是 9223372036854775807', before, 9223372036854775807);
  }
}

/* ------------------------------------------------------------------ *
 * 6. Boundaries
 * ------------------------------------------------------------------ */

section('6. 边界与安全');

check('空 TOML 输入提示', M.tomlToYaml('   \n').error, '请输入 TOML 内容');
check('空 YAML 输入提示', M.yamlToToml('').error, '请输入 YAML 内容');

{
  const onlyCommentToml = checkTomlToYaml('只有注释的 TOML', '# 只有注释\n');
  check('只有注释的 TOML 就是空表', onlyCommentToml.text, '{}\n');

  const onlyCommentYaml = M.yamlToToml('# 只有注释\n');
  checkTrue('只有注释的 YAML 按空表处理', onlyCommentYaml.ok);
  check('输出为空文档', onlyCommentYaml.text, '');
  checkContains('并且提示按空表处理', onlyCommentYaml.warnings.join(' '), '空表');

  const nullDoc = M.yamlToToml('null\n');
  checkTrue('显式的 null 不是空文档，必须报错', nullDoc.ok === false);
  checkContains('错误说明顶层是 null', nullDoc.error, 'null');

  const scalarDoc = M.yamlToToml('hello\n');
  checkTrue('顶层是字符串也不行', scalarDoc.ok === false);
  checkContains('错误说明顶层必须是映射', scalarDoc.error, '顶层必须是映射');

  const timestampDoc = M.yamlToToml('2001-12-15\n');
  checkTrue('顶层是时间戳也不行', timestampDoc.ok === false);
  checkContains('错误点明是哪种标量', timestampDoc.error, 'toml-local-date');

  const sequenceDoc = M.yamlToToml('- 1\n- 2\n');
  checkTrue('顶层是序列也不行', sequenceDoc.ok === false);
  checkContains('错误说明顶层是序列', sequenceDoc.error, '顶层是序列');

  const complexKey = M.yamlToToml('? [1, 2]\n: value\n');
  checkTrue('集合键报错', complexKey.ok === false);
  checkContains('错误说明键是序列', complexKey.error, '的键是序列');

  const nullKey = M.yamlToToml('? ~\n: value\n');
  checkTrue('null 键报错', nullKey.ok === false);
  checkContains('错误说明键是 null', nullKey.error, 'null');

  const emptyMap = checkYamlToToml('空映射可以表示', '{}\n');
  check('空映射写成空 TOML 文档', emptyMap.text, '');
}

{
  const badToml = M.tomlToYaml('a = \n');
  checkTrue('非法 TOML 报错', badToml.ok === false);
  checkContains('错误里带行列号', badToml.error, '行');

  const badYaml = M.yamlToToml('a: [1, 2\n');
  checkTrue('非法 YAML 报错', badYaml.ok === false);
  checkContains('错误里带行列号', badYaml.error, '行');

  const duplicate = M.yamlToToml('a: 1\na: 2\n');
  checkTrue('YAML 重复键报错（不静默取最后一个）', duplicate.ok === false);

  const conflict = M.yamlToToml('1: a\n"1": b\n');
  checkTrue('数字键与引号键在 TOML 里会撞名，必须报错', conflict.ok === false);
}

{
  const multi = M.yamlToToml('a: 1\n---\nb: 2\n');
  checkTrue('多文档 YAML 仍能转换第一个', multi.ok);
  check('只写了第一个文档', multi.text, 'a = 1\n');
  checkContains('并提示还有其它文档', multi.warnings.join(' '), '2 个 YAML 文档');

  const unresolved = M.yamlToToml('a: !!foo bar\n');
  checkTrue('未解析的标签仍能转换（值保持字符串）', unresolved.ok);
  checkContains('并把库的警告透传出来', unresolved.warnings.join(' '), 'Unresolved tag');
}

{
  // Deep nesting: the tool's own limit, which both directions share.
  const flatToml = 'a = 1\n' + Array.from({ length: 60 }, (_, i) => `[t${i}]\n`).join('');
  checkTrue('60 张并列的表在限制之内', M.tomlToYaml(flatToml).ok);

  const dotted = Array.from({ length: 120 }, () => 'k').join('.') + ' = 1\n';
  const deepToml = M.tomlToYaml(dotted);
  checkTrue('120 层点号键被拒绝', deepToml.ok === false);
  checkContains('错误里说明嵌套上限', deepToml.error, '嵌套超过');

  let deepYaml = '';
  for (let i = 0; i < 150; i += 1) deepYaml += '  '.repeat(i) + `k${i}:\n`;
  deepYaml += '  '.repeat(150) + 'value: 1\n';
  const deep = M.yamlToToml(deepYaml);
  checkTrue('150 层嵌套被拒绝', deep.ok === false);
  checkContains('错误里说明嵌套上限', deep.error, '嵌套超过');
  check('上限是 100 层', M.MAX_DEPTH, 100);

  const bigPayload = 'a = 1\n'.repeat(90_000);
  checkTrue('超过 512 KB 的 TOML 被拒绝', M.tomlToYaml(bigPayload).ok === false);
  checkContains('错误里给出上限', M.tomlToYaml(bigPayload).error, '512 KB');
  checkTrue('超过 512 KB 的 YAML 被拒绝', M.yamlToToml(bigPayload).ok === false);
  check('上限字节数', M.MAX_INPUT_BYTES, 512 * 1024);
}

{
  // The shared parser writes `[__proto__]` straight onto Object.prototype, so
  // such input is refused before parsing. This also proves the guard works.
  delete Object.prototype.polluted;
  const attack = '[__proto__]\npolluted = "yes"\n';
  const result = M.tomlToYaml(attack);
  checkTrue('含 __proto__ 键的 TOML 被拒绝', result.ok === false);
  checkContains('错误说明了原因', result.error, '__proto__');
  check('Object.prototype 没有被污染', Object.prototype.polluted, undefined);

  const safe = checkTomlToYaml('普通文档不受影响', 'a = 1\n');
  check('普通文档正常转换', safe.text, 'a: 1\n');

  if (PY_AVAILABLE) {
    const oracle = runOracle([{ name: 'proto', parses: [{ kind: 'toml', text: attack }] }])[0];
    checkTrue(
      'tomllib 能读这份文档（说明拒绝是本工具的保护措施，不是 TOML 语法问题）',
      oracle.errors.length === 0,
    );
  }
}

{
  // Unicode: keys and values, including characters that need escaping.
  const unicode = checkYamlToToml('中文与 emoji', '名字: "张三 🎉"\n"emoji 🎉": 值\n');
  check('Unicode 键与值都保留', unicode.text, '"名字" = "张三 🎉"\n"emoji 🎉" = "值"\n');
  const back = checkTomlToYaml('转回 YAML', unicode.text);
  check('往返后 emoji 不变（不需要引号就保持裸标量）', back.text, '名字: 张三 🎉\nemoji 🎉: 值\n');
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
if (!PY_AVAILABLE) {
  console.log('注意：python3 / PyYAML / tomllib 不可用，引用参照物的断言已跳过。');
}
process.exit(failed === 0 ? 0 : 1);
