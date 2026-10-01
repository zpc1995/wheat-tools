/**
 * Checks JSON Schema generation.
 *
 * The strong part is the validation round trip: every sample used to generate a
 * schema must then **validate** against it (via ajv), and deliberately corrupted
 * samples must **fail**. A schema that merely looks plausible passes the first
 * check but not the second.
 *
 * Usage: node scripts/check-schema.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const Ajv = require('ajv');

const compiled = ts.transpileModule(
  readFileSync('src/tools/json-schema/schemaUtils.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/schemaUtils.mjs', compiled);
const M = await import(pathToFileURL('.verify/schemaUtils.mjs').href);

// Draft 2020-12 needs ajv's 2020 entry point.
const Ajv2020 = require('ajv/dist/2020').default ?? require('ajv/dist/2020');
const addFormats = require('ajv-formats').default ?? require('ajv-formats');

// Two instances: ajv treats `format` as a pure annotation unless `validateFormats`
// is enabled, which is exactly the behaviour the tool documents. Comparing the
// two proves the note is accurate rather than merely plausible.
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const ajvStrictFormats = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
addFormats(ajvStrictFormats);

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

/** Compiles a schema and returns a validate function. */
function compile(schema) {
  return ajv.compile(schema);
}

/**
 * Builds the smallest value a schema accepts.
 *
 * Recursive on purpose: nested objects carry their own `required` list, so
 * filling them with `{}` produces a value the schema legitimately rejects —
 * which is what made an earlier version of this test fail for the wrong reason.
 */
function minimalFor(schema) {
  if (Array.isArray(schema.anyOf)) return minimalFor(schema.anyOf[0]);
  switch (schema.type) {
    case 'string':
      return 'x';
    case 'number':
      return 1;
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'array':
      return [];
    case 'object': {
      const out = {};
      for (const key of schema.required ?? []) {
        out[key] = minimalFor(schema.properties[key]);
      }
      return out;
    }
    default:
      return null;
  }
}

const sample = (value) => M.parseSamples(JSON.stringify(value)).values;
/** Parses one of the module's ready-made JSON **strings** (not a JS value). */
const fromText = (text) => M.parseSamples(text).values;

console.log('--- 基础推断 ---');
{
  const r = M.toJsonSchema(sample({ a: 1, b: 'x', c: true, d: null }));
  check('生成成功', r.ok, true);
  check('含 $schema', r.schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  check('标题', r.schema.title, 'Root');
  check('根类型为对象', r.schema.type, 'object');
  check('数字', r.schema.properties.a.type, 'number');
  check('字符串', r.schema.properties.b.type, 'string');
  check('布尔', r.schema.properties.c.type, 'boolean');
  check('null 保留', r.schema.properties.d.type, 'null');
  check('全部字段必填', r.schema.required, ['a', 'b', 'c', 'd']);
}
check('空样本被拒', M.toJsonSchema([]).ok, false);

console.log('--- 验证往返：样本必须通过自己的 Schema ---');
{
  const values = [{ a: 1, b: 'x' }, { a: 2, b: 'y' }];
  const r = M.toJsonSchema(values);
  const validate = compile(r.schema);
  check('两个样本都通过校验', values.every((v) => validate(v)), true);
  check('校验器无错误信息', validate.errors, null);
}
{
  const values = [
    { id: 1, tags: ['a', 'b'], nested: { deep: { value: 1 } } },
    { id: 2, tags: [], nested: { deep: { value: 2 } } },
  ];
  const r = M.toJsonSchema(values);
  const validate = compile(r.schema);
  check('嵌套结构样本通过校验', values.every((v) => validate(v)), true);
}
{
  const values = fromText(M.SCHEMA_SAMPLE).concat(fromText(M.SCHEMA_SAMPLE_2));
  const r = M.toJsonSchema(values);
  const validate = compile(r.schema);
  check('真实风格的多样本通过校验', values.every((v) => validate(v)), true);
}

console.log('--- 校验必须真的能拒绝（否则 Schema 没用）---');
{
  const r = M.toJsonSchema(sample({ a: 1, b: 'x' }));
  const validate = compile(r.schema);
  check('缺必填字段被拒', validate({ a: 1 }), false);
  check('类型错误被拒', validate({ a: 'not a number', b: 'x' }), false);
  check('正确数据通过', validate({ a: 5, b: 'y' }), true);
}
{
  const r = M.toJsonSchema(sample({ list: [1, 2, 3] }));
  const validate = compile(r.schema);
  check('数组中放字符串被拒', validate({ list: [1, 'two'] }), false);
  check('非数组被拒', validate({ list: 1 }), false);
  check('数字数组通过', validate({ list: [4, 5] }), true);
}

console.log('--- required 只包含所有样本都有的字段 ---');
{
  const r = M.toJsonSchema([{ a: 1, b: 2 }, { a: 3 }]);
  check('a 必填', r.schema.required, ['a']);
  const validate = compile(r.schema);
  check('缺 b 仍通过（b 非必填）', validate({ a: 1 }), true);
  check('缺 a 被拒', validate({ b: 1 }), false);
}
{
  const values = fromText(M.SCHEMA_SAMPLE).concat(fromText(M.SCHEMA_SAMPLE_2));
  const r = M.toJsonSchema(values);
  check('nickname 只出现一次 → 非必填', r.schema.required.includes('nickname'), false);
  check('id 都出现 → 必填', r.schema.required.includes('id'), true);
  check('age 只出现一次 → 非必填', r.schema.required.includes('age'), false);

  const validate = compile(r.schema);
  // Build a minimal object from exactly the required keys: it must validate,
  // and dropping any single one must fail. That proves `required` means what it
  // says rather than being decorative.
  const minimal = minimalFor(r.schema);
  check('只含必填字段（递归构造）的对象通过', validate(minimal), true);
  for (const key of r.schema.required) {
    const without = { ...minimal };
    delete without[key];
    if (!validate(without)) {
      // Expected: every required key must actually be enforced.
      continue;
    }
    check(`去掉必填字段 ${key} 应被拒`, false, true);
    break;
  }
  check('每个必填字段都被真正强制', r.schema.required.every((key) => {
    const without = { ...minimal };
    delete without[key];
    return !validate(without);
  }), true);
}

console.log('--- 类型冲突用 anyOf 表达 ---');
{
  const r = M.toJsonSchema([{ v: 1 }, { v: 'x' }]);
  const variants = r.schema.properties.v.anyOf;
  check('产生 anyOf', Array.isArray(variants), true);
  check('包含两种类型', variants.map((b) => b.type).sort(), ['number', 'string']);
  const validate = compile(r.schema);
  check('数字通过', validate({ v: 1 }), true);
  check('字符串通过', validate({ v: 'x' }), true);
  check('布尔被拒', validate({ v: true }), false);
}
{
  const r = M.toJsonSchema([{ v: { a: 1 } }, { v: [1, 2] }]);
  check('对象与数组也走 anyOf', Array.isArray(r.schema.properties.v.anyOf), true);
  const validate = compile(r.schema);
  check('对象通过', validate({ v: { a: 1 } }), true);
  check('数组通过', validate({ v: [1] }), true);
  check('字符串被拒', validate({ v: 'x' }), false);
}

console.log('--- 数组元素合并 ---');
{
  const r = M.toJsonSchema([{ list: [{ a: 1 }, { a: 2, b: 'x' }] }]);
  check('元素为对象 Schema', r.schema.properties.list.items.type, 'object');
  check('元素属性包含 a 与 b', Object.keys(r.schema.properties.list.items.properties).sort(), ['a', 'b']);
  check('元素 required 只含 a', r.schema.properties.list.items.required, ['a']);
  const validate = compile(r.schema);
  check('缺少 b 的元素仍通过', validate({ list: [{ a: 1 }] }), true);
  check('元素缺 a 被拒', validate({ list: [{ b: 'x' }] }), false);
}
{
  // An empty array gives no element information, so `items` must stay permissive.
  const r = M.toJsonSchema([{ list: [] }]);
  check('空数组的 items 为空 Schema', r.schema.properties.list.items, {});
  const validate = compile(r.schema);
  check('任何元素都能通过', validate({ list: [1, 'a', null] }), true);
}

console.log('--- format 侦测 ---');
{
  const r = M.toJsonSchema([{ at: '2026-01-15T08:30:00Z' }]);
  check('识别 date-time', r.schema.properties.at.format, 'date-time');
}
check('识别 date', M.toJsonSchema([{ d: '2026-01-15' }]).schema.properties.d.format, 'date');
check('识别 email', M.toJsonSchema([{ e: 'a@b.com' }]).schema.properties.e.format, 'email');
check('识别 uuid', M.toJsonSchema([{ u: '123e4567-e89b-12d3-a456-426614174000' }]).schema.properties.u.format, 'uuid');
check('识别 uri', M.toJsonSchema([{ u: 'https://a.com/x' }]).schema.properties.u.format, 'uri');
check('识别 ipv4', M.toJsonSchema([{ ip: '192.168.1.1' }]).schema.properties.ip.format, 'ipv4');
{
  // A format that holds for only one of two samples must not be emitted.
  const r = M.toJsonSchema([{ v: 'a@b.com' }, { v: 'plain text' }]);
  check('不一致的字符串不加 format', r.schema.properties.v.format, undefined);
}
check('关闭侦测后不加 format', M.toJsonSchema([{ e: 'a@b.com' }], { ...M.DEFAULT_SCHEMA_OPTIONS, detectFormats: false }).schema.properties.e.format, undefined);

console.log('--- format 默认只是注解（验证文档中的说明）---');
{
  const r = M.toJsonSchema([{ e: 'a@b.com' }]);
  check('Schema 带 format: email', r.schema.properties.e.format, 'email');

  const lenient = ajv.compile(r.schema);
  check('默认配置下非法邮箱仍通过（format 不作断言）', lenient({ e: 'not-an-email' }), true);

  const strict = ajvStrictFormats.compile(r.schema);
  check('开启 validateFormats 后非法邮箱被拒', strict({ e: 'not-an-email' }), false);
  check('开启后合法邮箱通过', strict({ e: 'a@b.com' }), true);
}

console.log('--- 选项 ---');
{
  const r = M.toJsonSchema([{ a: 1 }], { ...M.DEFAULT_SCHEMA_OPTIONS, strictAdditionalProperties: true });
  check('可开启 additionalProperties: false', r.schema.additionalProperties, false);
  const validate = compile(r.schema);
  check('额外字段被拒', validate({ a: 1, extra: 2 }), false);
}
{
  const r = M.toJsonSchema([{ a: 1 }]);
  check('默认不封闭（额外字段允许）', r.schema.additionalProperties, undefined);
  const validate = compile(r.schema);
  check('额外字段通过', validate({ a: 1, extra: 2 }), true);
}
check('可自定义标题', M.toJsonSchema([{ a: 1 }], { ...M.DEFAULT_SCHEMA_OPTIONS, title: '用户' }).schema.title, '用户');
check('可去掉 $schema', M.toJsonSchema([{ a: 1 }], { ...M.DEFAULT_SCHEMA_OPTIONS, includeSchemaKeyword: false }).schema.$schema, undefined);
check('examples 可关闭', M.toJsonSchema([{ a: 1 }], { ...M.DEFAULT_SCHEMA_OPTIONS, includeExamples: false }).schema.examples, undefined);
{
  const r = M.toJsonSchema([{ a: 1 }], { ...M.DEFAULT_SCHEMA_OPTIONS, includeExamples: true });
  check('单样本输出 examples', Array.isArray(r.schema.examples), true);
}

console.log('--- 统计 ---');
{
  const r = M.toJsonSchema(sample({ a: 1, b: { c: 2 }, d: [1] }));
  check('统计到属性数', r.stats.properties, 4);
  check('统计到对象数', r.stats.objects >= 2, true);
  check('统计到数组数', r.stats.arrays, 1);
  // Root {a,b,d} plus the nested {c} — the nested object's required key counts.
  check('统计到必填数（含嵌套）', r.stats.required, 4);
}

console.log('--- 输入解析 ---');
check('单文档优先整体解析', M.parseSamples('{"a":1}').values.length, 1);
check('空行分隔多样本', M.parseSamples('{"a":1}\n\n{"b":2}').values.length, 2);
check('--- 分隔多样本', M.parseSamples('{"a":1}\n---\n{"b":2}').values.length, 2);
check('空输入被拒', M.parseSamples('   ').ok, false);
check('非法 JSON 被拒', M.parseSamples('{a:1}').ok, false);
check(
  '多样本中某个非法时指出序号',
  /第 2 个样本/.test(M.parseSamples('{"a":1}\n\n{b:2}').error ?? ''),
  true,
);
{
  // A pretty-printed single document contains blank lines; it must still be
  // treated as one sample rather than being split.
  const pretty = JSON.stringify({ a: 1, b: { c: 2 } }, null, 2);
  check('格式化后的单文档不被拆分', M.parseSamples(pretty).values.length, 1);
}

console.log('--- 示例数据 ---');
{
  const values = fromText(M.SCHEMA_SAMPLE).concat(fromText(M.SCHEMA_SAMPLE_2));
  const r = M.toJsonSchema(values);
  check('示例可生成 Schema', r.ok, true);
  const validate = compile(r.schema);
  check('示例本身通过校验', values.every((v) => validate(v)), true);
}
check('注意事项非空', M.SCHEMA_NOTES.length >= 3, true);
check(
  '注意事项说明 format 是注解',
  M.SCHEMA_NOTES.some((n) => /注解/.test(n)),
  true,
);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
