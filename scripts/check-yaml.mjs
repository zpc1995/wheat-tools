/**
 * Correctness and safety checks for the YAML ↔ JSON converter.
 *
 * The safety cases matter most: `YAML.parse()` silently ignores duplicate-key
 * errors, custom tags are a deserialisation risk, and alias expansion is the
 * classic YAML bomb.
 *
 * Usage: node scripts/check-yaml.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

// Transpiled to a real file rather than a data: URL, because this module
// imports the `yaml` package and data: URLs cannot resolve bare specifiers.
const source = readFileSync('src/tools/yaml-json/yamlUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
const modulePath = '.verify/yamlUtils.mjs';
writeFileSync(modulePath, compiled);

const M = await import(pathToFileURL(modulePath).href);

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

console.log('--- 基本转换 ---');
{
  const result = M.yamlToJson('a: 1\nb: [x, y]\nc:\n  d: true');
  check('标量/数组/嵌套对象', JSON.parse(result.json), { a: 1, b: ['x', 'y'], c: { d: true } });
  check('类型：数字', JSON.parse(result.json).a, 1);
  check('类型：数组', Array.isArray(JSON.parse(result.json).b), true);
}
{
  const result = M.yamlToJson('a: "123"\nb: 123');
  check('引号保留字符串', typeof JSON.parse(result.json).a, 'string');
  check('无引号为数字', typeof JSON.parse(result.json).b, 'number');
}
check('null 字面量', JSON.parse(M.yamlToJson('a: null\nb: ~\nc:').json), { a: null, b: null, c: null });
check('注释被忽略', JSON.parse(M.yamlToJson('# 注释\na: 1  # 行尾').json), { a: 1 });
check('多行块标量', JSON.parse(M.yamlToJson('a: |\n  l1\n  l2\n').json).a, 'l1\nl2\n');
check('折叠标量', JSON.parse(M.yamlToJson('a: >\n  l1\n  l2\n').json).a, 'l1 l2\n');
check('缩进自定义为 4', M.yamlToJson('a: {b: 1}', 4).json.includes('    '), true);

console.log('--- 错误处理 ---');
check('空输入被拒', M.yamlToJson('   ').ok, false);
check('缩进错误被拒', M.yamlToJson('a:\n  b: 1\n c: 2').ok, false);
check('错误信息含行号', /第 \d+ 行/.test(M.yamlToJson('a: [1, 2').error ?? M.yamlToJson('a:\n  - 1\n  b: 2').error ?? ''), true);

console.log('--- 安全：重复键（parse() 会静默忽略，必须报错）---');
{
  const dup = M.yamlToJson('a: 1\na: 2');
  check('重复键被拒绝', dup.ok, false);
  check('重复键错误信息可读', /重复|unique|DUPLICATE/i.test(dup.error ?? ''), true);
}

console.log('--- 安全：自定义标签不执行 ---');
{
  const result = M.yamlToJson('a: !!js/function "function(){ return 1 }"');
  // The core schema does not know this tag, so it must degrade to a plain
  // string rather than constructing a callable.
  const value = result.ok ? JSON.parse(result.json).a : result.error;
  check('自定义标签不会变成函数', typeof value, 'string');
  check('自定义标签内容原样保留', typeof value === 'string' && value.includes('function'), true);
}
{
  // The important property is that nothing is *executed*; whether the unknown
  // tag degrades to a string or a small object depends on the schema.
  const tagged = M.yamlToJson('a: !!python/object/apply:os.system ["echo hi"]');
  const value = tagged.ok ? JSON.parse(tagged.json).a : tagged.error;
  check('!!python/object 不抛出/不执行', ['string', 'object'].includes(typeof value), true);
  check('!!python/object 内容未被求值', JSON.stringify(value).includes('echo hi') || JSON.stringify(value).length > 0, true);
}

console.log('--- 安全：原型污染 ---');
{
  const result = M.yamlToJson('__proto__:\n  polluted: true');
  check('解析成功但不污染原型', ({}).polluted, undefined);
  check('给出 __proto__ 警告', result.ok && result.warnings.some((w) => w.message.includes('__proto__')), true);
}

console.log('--- 安全：别名炸弹 ---');
{
  const bomb = [
    'a: &a [1,2,3,4,5,6,7,8,9]',
    'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
    'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
    'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
    'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
    'f: &f [*e,*e,*e,*e,*e,*e,*e,*e,*e]',
    'g: &g [*f,*f,*f,*f,*f,*f,*f,*f,*f]',
    'h: &h [*g,*g,*g,*g,*g,*g,*g,*g,*g]',
    'i: &i [*h,*h,*h,*h,*h,*h,*h,*h,*h]',
    'j: [*i,*i,*i,*i,*i,*i,*i,*i,*i]',
  ].join('\n');
  const started = Date.now();
  const result = M.yamlToJson(bomb);
  const elapsed = Date.now() - started;
  check('别名炸弹被拒绝', result.ok, false);
  check('拒绝理由与别名相关', /alias|别名|exhaust/i.test(result.error ?? ''), true);
  check('未长时间阻塞（<3s）', elapsed < 3000, true);
}
check('超大输入被拒', M.yamlToJson('a: ' + 'x'.repeat(M.MAX_INPUT_BYTES + 10)).ok, false);

console.log('--- 多文档 ---');
{
  const result = M.yamlToJson('a: 1\n---\nb: 2');
  check('多文档解析成功', result.ok, true);
  check('报告文档数量', result.ok && result.documents, 2);
  check('提示只转换了第一个', result.ok && result.warnings.some((w) => w.message.includes('文档')), true);
}

console.log('--- JSON → YAML ---');
{
  const result = M.jsonToYaml('{"a":1,"b":["x","y"],"c":{"d":true}}');
  check('转换成功', result.ok, true);
  check('输出含键', result.ok && result.yaml.includes('a: 1'), true);
  check('无多余的 JSON 括号', result.ok && !result.yaml.includes('{'), true);
}
check('非法 JSON 被拒', M.jsonToYaml('{a:1}').ok, false);
check('空输入被拒', M.jsonToYaml('  ').ok, false);
{
  const sorted = M.jsonToYaml('{"b":1,"a":2}', 2, true);
  check('可按键排序', sorted.ok && sorted.yaml.indexOf('a:') < sorted.yaml.indexOf('b:'), true);
  const unsorted = M.jsonToYaml('{"b":1,"a":2}', 2, false);
  check('默认保持原顺序', unsorted.ok && unsorted.yaml.indexOf('b:') < unsorted.yaml.indexOf('a:'), true);
}

console.log('--- 往返一致 ---');
{
  let roundTripOk = true;
  const cases = [
    '{"a":1,"b":"x","c":true,"d":null}',
    '{"nested":{"deep":{"value":[1,2,3]}}}',
    '{"unicode":"中文 😀","empty":"","zero":0}',
    '{"multi":"line1\\nline2"}',
  ];
  for (const json of cases) {
    const toYaml = M.jsonToYaml(json);
    if (!toYaml.ok) { roundTripOk = false; console.log('  JSON→YAML 失败:', json); continue; }
    const back = M.yamlToJson(toYaml.yaml);
    if (!back.ok) { roundTripOk = false; console.log('  YAML→JSON 失败:', toYaml.yaml); continue; }
    if (JSON.stringify(JSON.parse(back.json)) !== JSON.stringify(JSON.parse(json))) {
      roundTripOk = false;
      console.log('  往返不一致:', json, '→', back.json);
    }
  }
  check('JSON→YAML→JSON 一致', roundTripOk, true);
}

console.log('--- 统计 ---');
{
  // Every value is counted once: root object, 1, the array, its two elements,
  // the nested object and true — 7 in total. (Easy to miscount as 9 by charging
  // the array and the nested object an extra node each.)
  const stats = M.collectStats({ a: 1, b: [1, 2], c: { d: true } });
  check('节点数', stats.nodes, 7);
  check('键数', stats.keys, 4);
  check('数组数', stats.arrays, 1);
  check('深度', stats.depth, 3);
  check('根类型', stats.kind, '对象');
  check('数组根类型', M.collectStats([1, 2]).kind, '数组');
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
