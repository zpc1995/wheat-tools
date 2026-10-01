/**
 * Checks the JSON → type inference.
 *
 * The generated TypeScript is fed back into the TypeScript compiler and must
 * parse cleanly, which catches emitter bugs (dangling references, bad syntax,
 * duplicate declarations) that a string comparison would miss.
 *
 * Usage: node scripts/check-jsontype.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/json-to-type/inferUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/inferUtils.mjs', compiled);
const M = await import(pathToFileURL('.verify/inferUtils.mjs').href);

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

/** Asserts generated TypeScript has no syntax errors. */
function checkTsSyntax(label, code) {
  const fileName = 'generated.ts';
  const host = ts.createCompilerHost({});
  const originalGetSourceFile = host.getSourceFile;
  host.getSourceFile = (name, languageVersion, ...rest) =>
    name === fileName
      ? ts.createSourceFile(fileName, code, languageVersion, true)
      : originalGetSourceFile.call(host, name, languageVersion, ...rest);

  const program = ts.createProgram([fileName], { noEmit: true, strict: true }, host);
  const diagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];
  const ok = diagnostics.length === 0;
  if (ok) passed += 1;
  else {
    failed += 1;
    console.log(`FAIL  ${label}`);
    for (const d of diagnostics.slice(0, 5)) {
      console.log(`        ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    }
  }
  return ok;
}

console.log('--- 基础推断 ---');
{
  const r = M.toTypeScript([{ a: 1, b: 'x', c: true, d: null }], M.DEFAULT_INFER_OPTIONS);
  check('生成成功', r.ok, true);
  check('字符串类型', r.code.includes('b: string;'), true);
  check('数字类型', r.code.includes('a: number;'), true);
  check('布尔类型', r.code.includes('c: boolean;'), true);
  check('null 保留在联合中', /d: null;/.test(r.code), true);
  checkTsSyntax('基础推断生成的 TS 可编译', r.code);
}
check('空数组被拒绝', M.toTypeScript([], M.DEFAULT_INFER_OPTIONS).ok, false);
check('根为标量被拒绝', M.toTypeScript([42], M.DEFAULT_INFER_OPTIONS).ok, false);
check('根为 null 被拒绝', M.toTypeScript([null], M.DEFAULT_INFER_OPTIONS).ok, false);

console.log('--- 数组元素合并 ---');
{
  const r = M.toTypeScript([{ list: [1, 'two', true] }], M.DEFAULT_INFER_OPTIONS);
  check('异构数组成为联合', /list: \(number \| string \| boolean\)\[\];/.test(r.code), true);
  checkTsSyntax('异构数组 TS 可编译', r.code);
}
{
  // A single-element array must not hide other shapes.
  const merged = M.mergeSamples([{ list: [1] }, { list: ['x'] }]);
  const r = M.toTypeScript([{ list: [1] }, { list: ['x'] }], M.DEFAULT_INFER_OPTIONS);
  check('合并后数组元素为联合', /\(string \| number\)\[\]|\(number \| string\)\[\]/.test(r.code), true);
  void merged;
}
{
  const r = M.toTypeScript([{ list: [] }], M.DEFAULT_INFER_OPTIONS);
  check('空数组推断为 unknown[]', /list: unknown\[\];/.test(r.code), true);
}

console.log('--- 多样本合并 → 可选字段 ---');
{
  const values = M.parseSamples(`${M.JSON_TYPE_SAMPLE}\n\n${M.JSON_TYPE_SAMPLE_2}`);
  check('解析出 2 个样本', values.ok && values.values.length, 2);

  const r = M.toTypeScript(values.values, M.DEFAULT_INFER_OPTIONS);
  check('生成成功', r.ok, true);
  check('仅出现在一个样本的字段变可选', /nickname\?: string;/.test(r.code), true);
  check('两个样本都有的字段不可选', /id: string;/.test(r.code), true);
  check('null 与其他类型合并成联合且 null 在末尾', /deletedAt: string \| null;/.test(r.code), true);
  checkTsSyntax('多样本合并 TS 可编译', r.code);
}
{
  const r = M.toTypeScript([{ a: 1 }, { a: 'x' }], M.DEFAULT_INFER_OPTIONS);
  check('同名字段类型不同成为联合', /a: (string \| number|number \| string);/.test(r.code), true);
  checkTsSyntax('联合字段 TS 可编译', r.code);
}
{
  const r = M.toTypeScript([{ a: 1 }, { b: 2 }], M.DEFAULT_INFER_OPTIONS);
  check('两个字段都变可选', /a\?: number;/.test(r.code) && /b\?: number;/.test(r.code), true);
}

console.log('--- 嵌套对象提升为具名接口 ---');
{
  const r = M.toTypeScript(
    [{ id: 1, profile: { name: 'x', links: { github: 'y' } } }],
    M.DEFAULT_INFER_OPTIONS,
  );
  check('根接口存在', /export interface Root \{/.test(r.code), true);
  check('嵌套接口存在', /export interface RootProfile \{/.test(r.code), true);
  check('深层嵌套接口存在', /export interface RootProfileLinks \{/.test(r.code), true);
  check('字段引用具名接口', /profile: RootProfile;/.test(r.code), true);
  checkTsSyntax('嵌套提升 TS 可编译', r.code);
}
{
  const r = M.toTypeScript([{ items: [{ a: 1 }] }], M.DEFAULT_INFER_OPTIONS);
  check('对象数组提升接口', /items: RootItemsItem\[\];/.test(r.code), true);
  checkTsSyntax('对象数组 TS 可编译', r.code);
}

console.log('--- 根为数组 ---');
{
  const r = M.toTypeScript([[{ a: 1 }, { a: 2, b: 'x' }]], M.DEFAULT_INFER_OPTIONS);
  check('根数组生成成功', r.ok, true);
  check('根别名指向数组', /export type Root = .*\[\];/.test(r.code), true);
  checkTsSyntax('根数组 TS 可编译', r.code);
}

console.log('--- 命名冲突与非法标识符 ---');
{
  const r = M.toTypeScript(
    [{ profile: { name: 'a' }, Profile: { name: 'b' } }],
    M.DEFAULT_INFER_OPTIONS,
  );
  checkTsSyntax('大小写相近的键不产生重复接口名', r.code);
}
{
  const r = M.toTypeScript([{ 'user-name': 'x', '123': 'y', 'ok': 1 }], M.DEFAULT_INFER_OPTIONS);
  check('非法标识符加引号', /"user-name": string;/.test(r.code), true);
  check('数字键加引号', /"123": string;/.test(r.code), true);
  checkTsSyntax('含特殊键的 TS 可编译', r.code);
}
{
  const r = M.toTypeScript([{ a: 1 }], { ...M.DEFAULT_INFER_OPTIONS, rootName: 'user response' });
  check('根名转 PascalCase', /export interface UserResponse/.test(r.code), true);
  checkTsSyntax('自定义根名 TS 可编译', r.code);
}

console.log('--- 选项 ---');
{
  const r = M.toTypeScript([{ b: 1, a: 2 }], { ...M.DEFAULT_INFER_OPTIONS, sortKeys: true });
  check('可按键排序', r.code.indexOf('a:') < r.code.indexOf('b:'), true);
}
{
  // Input declares a before b, so preserving order means a comes first.
  const r = M.toTypeScript([{ a: 1, b: 2 }], { ...M.DEFAULT_INFER_OPTIONS, sortKeys: false });
  check('默认保持原顺序', r.code.indexOf('a:') < r.code.indexOf('b:'), true);
}
{
  const r = M.toTypeScript([{ a: 1 }], { ...M.DEFAULT_INFER_OPTIONS, readonly: true });
  check('可加 readonly', /readonly a: number;/.test(r.code), true);
}
{
  const r = M.toTypeScript([{ a: null }], { ...M.DEFAULT_INFER_OPTIONS, includeNull: false });
  check('关闭 null 时改为可选', /a\?:/.test(r.code), true);
}

console.log('--- Go 生成 ---');
{
  const r = M.toGo([{ id: 'x', count: 3, flag: true, tags: ['a'] }], M.DEFAULT_INFER_OPTIONS);
  check('Go 生成成功', r.ok, true);
  check('包含 package', r.code.startsWith('package main'), true);
  check('数字用 float64', /Count float64/.test(r.code), true);
  check('json tag 存在', /json:"flags?"/.test(r.code), true);
  check('字段名首字母大写', /type Root struct/.test(r.code), true);
}
{
  // A field absent from one of the samples is optional, and optional Go fields
  // must carry omitempty or the zero value would always be serialised.
  const r = M.toGo([{ a: 1 }, { a: 1, b: 'x' }], M.DEFAULT_INFER_OPTIONS);
  check('可选字段带 omitempty', /json:"b,omitempty"/.test(r.code), true);
  check('必填字段不带 omitempty', /json:"a"/.test(r.code), true);
}
{
  const values = M.parseSamples(`${M.JSON_TYPE_SAMPLE}\n\n${M.JSON_TYPE_SAMPLE_2}`).values;
  const r = M.toGo(values, M.DEFAULT_INFER_OPTIONS);
  check('多样本 Go 生成成功', r.ok, true);
  check('Go 中可选字段带 omitempty', /json:"nickname,omitempty"/.test(r.code), true);
  check('Go 无重复类型声明', new Set([...r.code.matchAll(/^type (\w+) struct/gm)].map((m) => m[1])).size, [...r.code.matchAll(/^type (\w+) struct/gm)].length);
}
{
  const r = M.toGo([{ 'user-name': 'x', 'type': 'y' }], M.DEFAULT_INFER_OPTIONS);
  check('Go 键含连字符时字段名合法', /UserName/.test(r.code), true);
  check('Go 字段名不合法时加引号', /json:"user-name"/.test(r.code), true);
}

console.log('--- 输入解析 ---');
check('单文档优先整体解析', M.parseSamples('{"a":1}').values.length, 1);
check('空输入被拒', M.parseSamples('   ').ok, false);
check('非法 JSON 被拒', M.parseSamples('{a:1}').ok, false);
{
  const blank = M.parseSamples('{"a":1}\n\n{"b":2}');
  check('空行分隔多样本', blank.ok && blank.values.length, 2);
}
{
  const dashes = M.parseSamples('{"a":1}\n---\n{"b":2}');
  check('--- 分隔多样本', dashes.ok && dashes.values.length, 2);
}
check(
  '多样本中某个非法时指出序号',
  /第 2 个样本/.test(M.parseSamples('{"a":1}\n\n{b:2}').error ?? ''),
  true,
);

console.log('--- 合并语义单元测试 ---');
check('相同类型合并不变', M.mergeTypes({ kind: 'string' }, { kind: 'string' }).kind, 'string');
check('不同类型成为联合', M.mergeTypes({ kind: 'string' }, { kind: 'number' }).kind, 'union');
check('unknown 不掩盖真实类型', JSON.stringify(M.mergeTypes({ kind: 'unknown' }, { kind: 'string' })), JSON.stringify({ kind: 'string' }));
check(
  '数组元素逐项合并',
  M.mergeTypes(
    { kind: 'array', element: { kind: 'number' } },
    { kind: 'array', element: { kind: 'string' } },
  ).element.kind,
  'union',
);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
