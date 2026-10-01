/**
 * Checks the JSON structural diff.
 *
 * The claim worth defending is not "the diff list looks right" but "the diff list
 * is complete and correct" — and the only honest way to test that is to use it:
 * apply the changes back to the left document and require the result to be
 * deeply equal to the right document. That round trip is run against hundreds of
 * randomly generated pairs, in both array-matching modes, and it is what catches
 * the whole class of mistakes a hand-picked example never would (a wrong index
 * for an array insertion, a moved element whose content edits get dropped, a
 * nested array rebuilt with its parent's slots).
 *
 * The reference points used here are:
 *
 *  - RFC 6901's own escaping examples, for the pointer syntax;
 *  - `JSON.stringify` with sorted keys as an independent equality oracle, so a
 *    bug in the implementation's own comparison cannot excuse a failure;
 *  - the round-trip property, which is self-checking: any wrong change list
 *    produces a document that differs from the target.
 *
 * Where a naive implementation would obviously be simpler, the naive version is
 * implemented alongside and shown to be wrong (pointer escaping without `~0` and
 * `~1` collapsing two distinct structures to one path; string equality treating
 * 1 as "1"; sorting keys by insertion order failing on reordered keys).
 *
 * Usage: node scripts/check-json-diff.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/json-diff/jsonDiffUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/json-diff.mjs', compiled);
const M = await import(pathToFileURL('.verify/json-diff.mjs').href);

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

/** Asserts that a call throws, and returns the thrown message for inspection. */
function checkThrows(label, fn, matcher) {
  try {
    fn();
    failed += 1;
    console.log(`FAIL  ${label}\n        没有抛出异常`);
    return '';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const ok = matcher.test(message);
    if (ok) passed += 1;
    else failed += 1;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${label}` +
        (ok ? '' : `\n        异常信息不匹配：${message}`),
    );
    return message;
  }
}

/** Independent equality oracle: canonical JSON via sorted-key stringify. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`;
}
const same = (left, right) => canonical(left) === canonical(right);

/** A second, structural oracle, written without help from the implementation. */
function structuralEqual(left, right) {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left !== typeof right) return false;
  if (typeof left !== 'object') return left === right;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    return left.length === right.length && left.every((item, index) => structuralEqual(item, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  if (leftKeys.some((key, index) => key !== rightKeys[index])) return false;
  return leftKeys.every((key) => structuralEqual(left[key], right[key]));
}

/* ------------------------------------------------------------------ *
 * Deterministic pseudo-random JSON, for the property tests
 * ------------------------------------------------------------------ */

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const KEYS = ['', 'a', 'b', 'id', 'x', '值', '键/斜杠', '波浪~号', '~1', 'a/b', '0', '1', ' ', 'не'];
const STRINGS = ['', 'x', 'hello', '中文', 'emoji 😀', 'a/b', '~tilde', 'null', '1', 'true', '\n', '\u0000'];

function randomValue(rand, depth) {
  const roll = rand();
  if (depth <= 0) {
    if (roll < 0.25) return null;
    if (roll < 0.45) return rand() < 0.5;
    if (roll < 0.75) return Math.round((rand() - 0.5) * 2000) / 100;
    return STRINGS[Math.floor(rand() * STRINGS.length)];
  }
  if (roll < 0.18) return null;
  if (roll < 0.3) return rand() < 0.5;
  if (roll < 0.5) return Math.round((rand() - 0.5) * 2000) / 100;
  if (roll < 0.64) return STRINGS[Math.floor(rand() * STRINGS.length)];
  if (roll < 0.78) {
    const length = Math.floor(rand() * 5);
    const array = [];
    for (let index = 0; index < length; index += 1) array.push(randomValue(rand, depth - 1));
    return array;
  }
  if (roll < 0.9) {
    // Records with a unique identity field, so keyed matching actually engages.
    const length = Math.floor(rand() * 5);
    const array = [];
    for (let index = 0; index < length; index += 1) {
      array.push({ id: index + 1, v: randomValue(rand, depth - 1), tag: STRINGS[Math.floor(rand() * STRINGS.length)] });
    }
    return array;
  }
  const length = Math.floor(rand() * 4);
  const object = {};
  for (let index = 0; index < length; index += 1) {
    object[KEYS[Math.floor(rand() * KEYS.length)] + (index || '')] = randomValue(rand, depth - 1);
  }
  return object;
}

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** Mutates a random place in `root`, so the pair differs by a plausible edit. */
function mutateRandomly(rand, root) {
  const path = [];
  let node = root;
  for (let step = 0; step < 6; step += 1) {
    if (node === null || typeof node !== 'object') break;
    const keys = Array.isArray(node) ? node.map((_, index) => index) : Object.keys(node);
    if (keys.length === 0) break;
    const key = keys[Math.floor(rand() * keys.length)];
    path.push(key);
    node = node[key];
  }
  let parent = root;
  for (const key of path.slice(0, -1)) parent = parent[key];
  const key = path[path.length - 1];
  const roll = rand();

  if (Array.isArray(parent) && key !== undefined) {
    if (roll < 0.3) parent.splice(key, 1);
    else if (roll < 0.6) parent.splice(key, 0, randomValue(rand, 2));
    else if (roll < 0.8) parent[key] = randomValue(rand, 2);
    else {
      const other = Math.floor(rand() * parent.length);
      const held = parent[key];
      parent[key] = parent[other];
      parent[other] = held;
    }
    return;
  }
  if (parent !== null && typeof parent === 'object') {
    if (roll < 0.3 && key !== undefined) delete parent[key];
    else if (roll < 0.6) parent[`新键${Math.floor(rand() * 5)}`] = randomValue(rand, 2);
    else if (roll < 0.85 && key !== undefined) parent[key] = randomValue(rand, 2);
    else if (key !== undefined) parent[key] = { retyped: randomValue(rand, 1) };
  }
}

console.log('--- JSON Pointer（RFC 6901）---');
{
  // These two are the specification's own examples.
  check('键中的 / 转义为 ~1', M.escapePointerToken('a/b'), 'a~1b');
  check('键中的 ~ 转义为 ~0', M.escapePointerToken('m~n'), 'm~0n');
  check('满 RFC 的例子：/ → ~1', M.pointerOf(['a/b']), '/a~1b');
  check('满 RFC 的例子：~ → ~0', M.pointerOf(['m~n']), '/m~0n');
  check('RFC 6901 §5 的文档指针', M.pointerOf(['foo', '0']), '/foo/0');
  check('RFC 6901 §5 的空串键', M.pointerOf(['']), '/');

  // `~01` must decode to the two characters `~1`, not to `/`. That is why the
  // `~1` pass has to run before the `~0` pass in the unescaper.
  check('~01 解码为 ~1（不是 /）', M.unescapePointerToken('~01'), '~1');
  check('~1 解码为 /', M.unescapePointerToken('~1'), '/');
  check('~0 解码为 ~', M.unescapePointerToken('~0'), '~');
  check('先转义 ~ 再转义 /（反例见下）', M.escapePointerToken('~1'), '~01');

  // Round trip over hostile keys.
  const hostile = ['', '/', '~', '~0', '~1', 'a/b', 'm~n', '~01', '/~', 'a//b', '键/斜杠', '波浪~号'];
  check(
    '12 个危险键名转义后可无损还原',
    hostile.every((key) => M.unescapePointerToken(M.escapePointerToken(key)) === key),
    true,
  );

  // Counter-example: the naive escape (just prefixing keys with a slash) maps two
  // different structures to the same pointer. This is the bug the RFC rule exists
  // to prevent, and the assertion below proves the naive version is ambiguous.
  const naivePointer = (tokens) => `/${tokens.join('/')}`;
  const flatKey = naivePointer(['a/b']); // { "a/b": 1 }
  const nestedKey = naivePointer(['a', 'b']); // { "a": { "b": 1 } }
  check('反证：朴素拼接把两种结构映射到同一个路径', flatKey === nestedKey, true);
  check('RFC 转义让两者不同（/a~1b 与 /a/b）', M.pointerOf(['a/b']) !== M.pointerOf(['a', 'b']), true);
  check(
    '反证：真实 diff 里两者路径确实不同',
    M.diff({ 'a/b': 1 }, { 'a/b': 2 }).changes.map((change) => change.path).join(',') !==
      M.diff({ a: { b: 1 } }, { a: { b: 2 } }).changes.map((change) => change.path).join(','),
    true,
  );
  check('{"a/b":1} → {"a/b":2} 的路径', M.diff({ 'a/b': 1 }, { 'a/b': 2 }).changes[0].path, '/a~1b');
  check('{"a":{"b":1}} → 2 的路径', M.diff({ a: { b: 1 } }, { a: { b: 2 } }).changes[0].path, '/a/b');
  check('路径可反解回键名', M.pointerTokens('/a~1b'), ['a/b']);
  check('波浪键的路径可反解', M.pointerTokens('/m~0n'), ['m~n']);
}

console.log('--- 已知固定值 ---');
{
  const one = (a, b) => M.diff(a, b).changes;
  check('{"a":1} vs {"a":2} → 修改 /a', [one({ a: 1 }, { a: 2 })[0].kind, one({ a: 1 }, { a: 2 })[0].path], ['modified', '/a']);
  check('修改记录带前后值', [one({ a: 1 }, { a: 2 })[0].before, one({ a: 1 }, { a: 2 })[0].after], [1, 2]);
  check('{"a":1} vs {} → 删除 /a', [one({ a: 1 }, {})[0].kind, one({ a: 1 }, {})[0].path], ['removed', '/a']);
  check('{} vs {"a":1} → 新增 /a', [one({}, { a: 1 })[0].kind, one({}, { a: 1 })[0].path], ['added', '/a']);
  check('[1,2] vs [1,2,3] → 新增 /2', [one([1, 2], [1, 2, 3])[0].kind, one([1, 2], [1, 2, 3])[0].path], ['added', '/2']);
  check('[1,2,3] vs [1,2] → 删除 /2', [one([1, 2, 3], [1, 2])[0].kind, one([1, 2, 3], [1, 2])[0].path], ['removed', '/2']);
  check('嵌套对象：修改 /a/b/c', one({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })[0].path, '/a/b/c');
  check('嵌套删除：/a/b', one({ a: { b: 1, c: 2 } }, { a: { c: 2 } })[0].path, '/a/b');
  check('数组内对象：/users/0/name', M.diff({ users: [{ name: 'a' }] }, { users: [{ name: 'b' }] }).changes[0].path, '/users/0/name');
  check('类型变化单独标出（数字 → 字符串）', one({ a: 1 }, { a: '1' })[0].kind, 'typeChanged');
  check('类型变化（对象 → 数组）', one({ a: {} }, { a: [] })[0].kind, 'typeChanged');
  check('类型变化（null → 数字）', one({ a: null }, { a: 0 })[0].kind, 'typeChanged');
  check('布尔 → 数字也算类型变化', one(true, 1)[0].kind, 'typeChanged');
  check('根节点是标量时的路径是空串', M.diff(1, 2).changes[0].path, '');
  check('同类型改值不算类型变化', one({ a: 1 }, { a: 2 })[0].kind, 'modified');
  check('null → null 无差异', one(null, null), []);
  check('键顺序不敏感：a,b 与 b,a', one({ a: 1, b: 2 }, { b: 2, a: 1 }), []);
  check('深层键顺序也不敏感', one({ x: { a: 1, b: [1, { c: 2, d: 3 }] } }, { x: { b: [1, { d: 3, c: 2 }], a: 1 } }), []);
  check('差异按路径排序输出（与键顺序无关）', one({ b: 1, a: 1 }, { b: 2, a: 2 }).map((c) => c.path), ['/a', '/b']);
}

console.log('--- 等值与容差 ---');
{
  check('字符串与数字不相等', M.valuesEqual(1, '1', 0), false);
  check('容差只作用于数字：数字与数字', M.valuesEqual(1.0000001, 1, 0.001), true);
  check('容差内视为相同', M.valuesEqual(0.1 + 0.2, 0.3, 1e-9), true);
  check('超出容差仍是差异', M.valuesEqual(0.1, 0.3, 1e-3), false);
  check('容差不作用于字符串', M.valuesEqual('1.0', '1.00', 1), false);
  check('默认（容差 0）浮点误差算差异', M.diff({ a: 0.1 + 0.2 }, { a: 0.3 }).stats.total, 1);
  check('设了容差后浮点误差不算差异', M.diff({ a: 0.1 + 0.2 }, { a: 0.3 }, { numberTolerance: 1e-9 }).stats.total, 0);
  check('容差不会掩盖真实差异', M.diff({ a: 1 }, { a: 1.5 }, { numberTolerance: 0.1 }).stats.total, 1);
  check('反证：朴素字符串比较认不出数字等价', JSON.stringify(0.1 + 0.2) === JSON.stringify(0.3), false);
  check('反证：朴素字符串比较把 1 与 "1" 当不同（这里恰好是对的）', JSON.stringify(1) === JSON.stringify('1'), false);
  check('类型不同的键即使数值相同也是类型变化', M.diff({ a: '1' }, { a: 1 }, { numberTolerance: 5 }).changes[0].kind, 'typeChanged');
}

console.log('--- 输入校验：非法 JSON 必须被拒绝 ---');
{
  check('NaN 不是合法 JSON', M.isJsonValue(Number.NaN), false);
  check('Infinity 不是合法 JSON', M.isJsonValue(Number.POSITIVE_INFINITY), false);
  check('undefined 不是合法 JSON', M.isJsonValue(undefined), false);
  check('函数不是合法 JSON', M.isJsonValue(() => 1), false);
  check('Date 不是合法 JSON 值', M.isJsonValue(new Date()), false);
  check('Map 不是合法 JSON 值', M.isJsonValue(new Map()), false);
  check('BigInt 不是合法 JSON 值', M.isJsonValue(10n), false);
  check('普通对象是合法 JSON', M.isJsonValue({ a: [1, null, 'x'] }), true);
  check('Object.create(null) 也算普通对象', M.isJsonValue(Object.assign(Object.create(null), { a: 1 })), true);
  checkThrows('diff 拒绝 NaN', () => M.diff({ a: Number.NaN }, {}), /非法数字/);
  checkThrows('diff 拒绝 Infinity', () => M.diff({}, { a: Number.POSITIVE_INFINITY }), /非法数字/);
  checkThrows('diff 拒绝 undefined', () => M.diff({ a: undefined }, {}), /undefined/);
  checkThrows('diff 拒绝 Date', () => M.diff({ a: new Date() }, {}), /非普通对象/);
  checkThrows('diff 拒绝 BigInt', () => M.diff({ a: 1n }, {}), /BigInt/);
  checkThrows('assertJsonValue 报出左侧/右侧标签', () => M.assertJsonValue({ a: Number.NaN }, '右侧 JSON'), /右侧 JSON/);
  check('校验通过时返回 undefined', M.assertJsonValue({ a: 1 }), undefined);

  // JSON.parse never produces any of those, so the text entry point is safe too.
  check('JSON.parse 也拒绝 NaN 字面量', (() => { try { JSON.parse('{"a":NaN}'); return 'accepted'; } catch { return 'rejected'; } })(), 'rejected');
  checkThrows('空输入报错', () => M.parseJsonInput('   ', '左侧 JSON'), /为空/);
  checkThrows('语法错误报错并给出原因', () => M.parseJsonInput('{a:1}', '左侧 JSON'), /不是合法 JSON/);
  check('合法输入解析成功', M.parseJsonInput('[1,2]', '左侧 JSON'), [1, 2]);
}

console.log('--- 上限：变化数量、节点数量 ---');
{
  check('变化数量上限已声明', Number.isInteger(M.MAX_CHANGES) && M.MAX_CHANGES > 1000, true);
  check('节点数量上限已声明', Number.isInteger(M.MAX_NODES) && M.MAX_NODES > 100_000, true);
  check('深度上限已声明', Number.isInteger(M.MAX_DEPTH) && M.MAX_DEPTH >= 64, true);
  check('超限错误是 Error 的子类并可识别', new M.DiffLimitError() instanceof Error, true);
  check('超限错误名可识别', new M.DiffLimitError().name, 'DiffLimitError');
  check('深度错误名可识别', new M.JsonDepthError(1).name, 'JsonDepthError');
  check('大小错误名可识别', new M.JsonSizeError(1).name, 'JsonSizeError');
  check('输入错误名可识别', new M.JsonInputError('x').name, 'JsonInputError');
  check('应用错误名可识别', new M.DiffApplyError('x').name, 'DiffApplyError');

  // The limit is enforced while the list is being built, not after it exists:
  // the run below passes through the counter on every change. Raising it past the
  // cap is therefore an error, not a truncated list — a truncated list could not
  // be applied back, which would break the round-trip guarantee silently.
  const many = Array.from({ length: 3000 }, (_, index) => index);
  const manyChanged = many.map((value) => value + 1);
  const wide = M.diff(many, manyChanged);
  check('3000 处差异全部列出（未触及上限）', wide.stats.total, 3000);
  check('3000 处差异可应用', same(M.applyChanges(many, wide.changes), manyChanged), true);
}

console.log('--- 边界：空容器、深嵌套、超大数组 ---');
{
  check('空对象 vs 空对象', M.diff({}, {}).changes, []);
  check('空数组 vs 空数组', M.diff([], []).changes, []);
  check('空对象 vs 空数组是类型变化', M.diff({}, []).changes[0].kind, 'typeChanged');
  check('空对象新增键', M.diff({}, { a: null }).changes[0].kind, 'added');
  check('空数组新增元素', M.diff([], [null]).changes[0].path, '/0');
  check('深层嵌套的比较', M.diff({ a: { b: { c: { d: { e: [1, { f: 2 }] } } } } }, { a: { b: { c: { d: { e: [1, { f: 3 }] } } } } }).changes[0].path, '/a/b/c/d/e/1/f');
  check('路径 token 数等于深度', M.diff({ a: { b: 1 } }, { a: { b: 2 } }).changes[0].tokens.length, 2);

  // Depth limit. A recursive comparison would overflow the stack here; the
  // explicit queue in assertJsonValue is what makes the failure a message.
  const deep = (levels) => {
    let node = 1;
    for (let index = 0; index < levels; index += 1) node = { x: node };
    return node;
  };
  checkThrows('超过深度上限报错（400 层）', () => M.diff(deep(400), deep(400)), /嵌套深度超过上限/);
  checkThrows('超过深度上限时不做递归（100000 层不爆栈）', () => M.diff(deep(100_000), deep(100_000)), /嵌套深度超过上限/);
  checkThrows('只在右侧超过上限也报错', () => M.diff(1, deep(400)), /嵌套深度超过上限/);
  check('深度上限之内正常工作', M.diff(deep(M.MAX_DEPTH - 2), deep(M.MAX_DEPTH - 2)).changes, []);

  // A very large array: 20 000 elements, one of them changed, plus an append.
  const bigBefore = Array.from({ length: 20_000 }, (_, index) => index);
  const bigAfter = bigBefore.slice();
  bigAfter[19_999] = -1;
  bigAfter.push(99_999);
  const bigResult = M.diff(bigBefore, bigAfter);
  check('超大数组：只有两条差异', bigResult.stats.total, 2);
  check('超大数组：改动位置', bigResult.changes[0].path, '/19999');
  check('超大数组：新增位置', bigResult.changes[1].path, '/20000');
  check('超大数组可应用回目标', same(M.applyChanges(bigBefore, bigResult.changes), bigAfter), true);
  check(
    '超大数组按 id 配对（无 id 字段时退化为按索引）',
    M.diff(bigBefore, bigAfter, { mode: 'key', keyField: 'id' }).keyedArrays.byIndex > 0,
    true,
  );

  const records = Array.from({ length: 5000 }, (_, index) => ({ id: index + 1, v: index }));
  const shuffled = records.slice().reverse();
  const reversed = M.diff(records, shuffled, { mode: 'key', keyField: 'id' });
  check('5000 条记录整体倒序：按键配对只报位置移动', reversed.stats.moved, 5000);
  check('5000 条记录整体倒序：没有内容差异', reversed.stats.added + reversed.stats.removed + reversed.stats.modified + reversed.stats.typeChanged, 0);
  check('5000 条记录倒序可应用回目标', same(M.applyChanges(records, reversed.changes), shuffled), true);
}

console.log('--- 数组：按索引比较（默认）---');
{
  check('默认模式是按索引', M.DEFAULT_DIFF_OPTIONS.mode, 'index');
  check('尾部新增', M.diff([1, 2], [1, 2, 3]).changes.map((c) => [c.kind, c.path]), [['added', '/2']]);
  check('尾部删除', M.diff([1, 2, 3], [1, 2]).changes.map((c) => [c.kind, c.path]), [['removed', '/2']]);
  check('中部改值', M.diff([1, 2, 3], [1, 9, 3]).changes.map((c) => [c.kind, c.path]), [['modified', '/1']]);
  check('[1,2] vs [2,1] 按索引是两处改值', M.diff([1, 2], [2, 1]).stats.modified, 2);
  check('数组与对象互变是类型变化', M.diff({ a: [1] }, { a: { 0: 1 } }).changes[0].kind, 'typeChanged');
  check('索引模式的数组不会用身份重建', M.diff([1, 2], [2, 1]).keyedArrays.byKey, 0);
  check('[1,2,3] vs [3,2,1] 可应用', same(M.applyChanges([1, 2, 3], M.diff([1, 2, 3], [3, 2, 1]).changes), [3, 2, 1]), true);
}

console.log('--- 数组：按标识字段配对（本工具的核心）---');
{
  const key = (a, b, keyField = 'id') => M.diff(a, b, { mode: 'key', keyField });

  check('默认字段名是 id', M.DEFAULT_DIFF_OPTIONS.keyField, 'id');
  check(
    '重排不产生假差异：[{id:1},{id:2}] vs 倒序 → 只报位置移动',
    key([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }]).stats,
    { added: 0, removed: 0, modified: 0, typeChanged: 0, moved: 2, total: 2 },
  );
  check(
    '重排后内容不变：位置移动不计入内容差异',
    M.hasContentChanges(key([{ id: 1, v: 'a' }, { id: 2, v: 'b' }], [{ id: 2, v: 'b' }, { id: 1, v: 'a' }]).changes),
    false,
  );
  // Reversing three elements moves the two ends and leaves the middle one in
  // place — its index is unchanged, so it has no move to report. The information
  // is still complete: the records of the two movers pin both ends, and the
  // untouched element fills what is left.
  const reversed3 = key(
    [{ id: 1, v: 1 }, { id: 2, v: 2 }, { id: 3, v: 3 }],
    [{ id: 3, v: 3 }, { id: 2, v: 2 }, { id: 1, v: 1 }],
  );
  check('数组整体倒序：只有两端产生位置移动', reversed3.stats.moved, 2);
  check('数组整体倒序：没有内容差异', M.hasContentChanges(reversed3.changes), false);
  check('数组整体倒序可应用回目标', same(M.applyChanges(
    [{ id: 1, v: 1 }, { id: 2, v: 2 }, { id: 3, v: 3 }],
    reversed3.changes,
  ), [{ id: 3, v: 3 }, { id: 2, v: 2 }, { id: 1, v: 1 }]), true);
  check(
    '元素字段改值只报那个字段',
    key([{ id: 1, v: 'a' }, { id: 2, v: 'b' }], [{ id: 2, v: 'b' }, { id: 1, v: 'z' }]).changes
      .filter((c) => c.kind !== 'matched' && c.kind !== 'moved')
      .map((c) => [c.kind, c.path]),
    [['modified', '/0/v']],
  );
  check(
    '删除的元素单独标出',
    key([{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 3 }, { id: 1 }]).stats.removed,
    1,
  );
  check(
    '新增的元素单独标出',
    key([{ id: 1 }, { id: 2 }], [{ id: 9 }, { id: 1 }, { id: 2 }]).stats.added,
    1,
  );
  check(
    '重排 + 新增 + 删除同时发生',
    key([{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 4 }, { id: 3 }, { id: 1 }]).stats,
    { added: 1, removed: 1, modified: 0, typeChanged: 0, moved: 2, total: 4 },
  );
  check(
    '重排 + 新增 + 删除可应用',
    same(
      M.applyChanges([{ id: 1 }, { id: 2 }, { id: 3 }], key([{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 4 }, { id: 3 }, { id: 1 }]).changes),
      [{ id: 4 }, { id: 3 }, { id: 1 }],
    ),
    true,
  );
  check('嵌套数组也按键配对', key({ list: [{ id: 1 }, { id: 2 }] }, { list: [{ id: 2 }, { id: 1 }] }).stats.moved, 2);
  check('自定义标识字段', M.diff([{ sku: 'a' }, { sku: 'b' }], [{ sku: 'b' }, { sku: 'a' }], { mode: 'key', keyField: 'sku' }).stats.moved, 2);
  check('标识不匹配时退化为按索引', M.diff([{ sku: 'a' }, { sku: 'b' }], [{ sku: 'b' }, { sku: 'a' }], { mode: 'key', keyField: 'id' }).keyedArrays.byKey, 0);
  check('keyedArrays 报告按键配对的数组个数（a 与 b 都按 id 配对）', key({ a: [{ id: 1 }], b: [{ id: 2 }, { id: 1 }] }, { a: [{ id: 1 }], b: [{ id: 1 }, { id: 2 }] }).keyedArrays.byKey, 2);
  // A matched element still has a position record — that bookkeeping is what makes
  // the array rebuildable — but it is not a difference, so nothing is visible.
  check('相同的数组：无可显示的差异', M.visibleChanges(key([{ id: 1 }], [{ id: 1 }]).changes).length, 0);
  check('相同的数组：统计为 0', key([{ id: 1 }], [{ id: 1 }]).stats.total, 0);
  check('相同的数组：位置记录仍在（重建需要它）', key([{ id: 1 }], [{ id: 1 }]).changes.length, 1);
  check('相同的数组：记录类型是 matched', key([{ id: 1 }], [{ id: 1 }]).changes[0].kind, 'matched');

  // Degradation rules, spelled out: an array is matched by identity only when the
  // key is unique and present on every element.
  check('降级条件：元素不是对象', key([{ id: 1 }, 2], [2, { id: 1 }]).keyedArrays.byKey, 0);
  check('降级条件：缺少标识字段', key([{ id: 1 }, { v: 2 }], [{ v: 2 }, { id: 1 }]).keyedArrays.byIndex, 1);
  check('降级条件：标识重复（配对会认错元素）', key([{ id: 1 }, { id: 1 }], [{ id: 1 }, { id: 1 }]).keyedArrays.byKey, 0);
  check('缺失标识字段时降级仍能正确应用', same(M.applyChanges([{ id: 1 }, { v: 2 }], key([{ id: 1 }, { v: 2 }], [{ v: 2 }, { id: 1 }]).changes), [{ v: 2 }, { id: 1 }]), true);
  check('标识字段值可以是字符串', key([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'a' }]).stats.moved, 2);
  check('标识字段值可以是数字 1 与字符串 "1" 不混同', key([{ id: 1 }], [{ id: '1' }]).stats.total, 2);

  // The point of the whole feature, stated as one assertion: a text diff of two
  // reordered documents is mostly changed lines; this reports no content change.
  const leftText = JSON.stringify([{ id: 1, v: 'aaa' }, { id: 2, v: 'bbb' }], null, 2);
  const rightText = JSON.stringify([{ id: 2, v: 'bbb' }, { id: 1, v: 'aaa' }], null, 2);
  const changedLines = leftText.split('\n').filter((line, index) => line !== rightText.split('\n')[index]).length;
  check('反证：逐行文本对比在纯重排上报了多行改动', changedLines > 2, true);
  check('结构化对比在纯重排上报 0 处内容差异', M.hasContentChanges(key(JSON.parse(leftText), JSON.parse(rightText)).changes), false);
}

console.log('--- 统计、筛选与复制 ---');
{
  const result = M.diff(
    { same: 1, gone: 2, tweak: 3, retype: 4, arr: [1, 2] },
    { same: 1, fresh: 9, tweak: 4, retype: '4', arr: [1, 2, 3] },
  );
  check('统计：新增 2 条', result.stats.added, 2);
  check('统计：删除 1 条', result.stats.removed, 1);
  check('统计：修改 1 条', result.stats.modified, 1);
  check('统计：类型变化 1 条', result.stats.typeChanged, 1);
  check('统计：合计等于差异条数', result.stats.total, result.changes.length);
  check('统计：moved 为 0', result.stats.moved, 0);
  check('按类型筛选可行', result.changes.filter((change) => change.kind === 'added').length, 2);
  check('按键名筛选可行', result.changes.filter((change) => change.path.startsWith('/arr')).length, 1);

  const moved = M.diff([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }], { mode: 'key', keyField: 'id' });
  check('matched 记录不计入统计', moved.stats.total, moved.changes.filter((c) => c.kind !== 'matched').length);
  check('visibleChanges 过滤掉 matched', M.visibleChanges(moved.changes).length, 2);
  check('纯重排时可见差异就是两条位置移动', M.visibleChanges(moved.changes).every((c) => c.kind === 'moved'), true);

  const text = M.changesToText(result.changes);
  check('复制文本：行数等于可见差异数', text.split('\n').length, M.visibleChanges(result.changes).length);
  check('复制文本：新增行以 + 开头', text.split('\n').some((line) => line.startsWith('+ /arr/2')), true);
  check('复制文本：删除行以 - 开头', text.split('\n').some((line) => line.startsWith('- /gone')), true);
  check('复制文本：类型变化行写明两个类型', /类型|number → string/.test(text), true);
  check('无差异时的文案', M.changesToText([]), '两份 JSON 结构相同，没有差异。');
  check('纯重排无内容差异时仍列出位置移动', M.changesToText(moved.changes).split('\n').length, 2);

  const asJson = JSON.parse(M.changesToJson(result.changes));
  check('复制 JSON：条数一致', asJson.length, M.visibleChanges(result.changes).length);
  check('复制 JSON：每条都有 path 与 kind', asJson.every((change) => typeof change.path === 'string' && typeof change.kind === 'string'), true);
  check('复制 JSON：新增项不含 before', Object.prototype.hasOwnProperty.call(asJson.find((c) => c.kind === 'added'), 'before'), false);
  check('复制 JSON：删除项不含 after', Object.prototype.hasOwnProperty.call(asJson.find((c) => c.kind === 'removed'), 'after'), false);
  check('复制 JSON：可被 JSON.parse 还原', asJson[0].path, M.visibleChanges(result.changes)[0].path);
  check('formatChange 里根路径显示为 /', M.formatChange({ path: '', kind: 'modified', tokens: [], before: 1, after: 2 }).startsWith('~ /'), true);
  check('changeKindLabel 有中文标签', M.changeKindLabel('typeChanged'), '类型变化');
  check('abbreviate 截断长值', M.abbreviate({ a: 'x'.repeat(200) }).length <= 60, true);
}

console.log('--- 应用差异（往返的基础）---');
{
  check('空差异列表返回等值文档', same(M.applyChanges({ a: 1 }, []), { a: 1 }), true);
  check('应用是纯函数：不改动输入', (() => {
    const before = { a: 1, b: 2 };
    const copy = JSON.parse(JSON.stringify(before));
    M.applyChanges(before, M.diff(before, { a: 9 }).changes);
    return same(before, copy);
  })(), true);
  check('新增成员', same(M.applyChanges({ a: 1 }, M.diff({ a: 1 }, { a: 1, b: 2 }).changes), { a: 1, b: 2 }), true);
  check('删除成员', same(M.applyChanges({ a: 1, b: 2 }, M.diff({ a: 1, b: 2 }, { a: 1 }).changes), { a: 1 }), true);
  check('修改标量', same(M.applyChanges({ a: 1 }, M.diff({ a: 1 }, { a: [1, 2] }).changes), { a: [1, 2] }), true);
  check('删除数组元素', same(M.applyChanges([1, 2, 3], M.diff([1, 2, 3], [1, 3]).changes), [1, 3]), true);
  check('从中间删除多个元素', same(M.applyChanges([1, 2, 3, 4, 5], M.diff([1, 2, 3, 4, 5], [1, 4]).changes), [1, 4]), true);
  check('插入到数组中间', same(M.applyChanges([1, 4], M.diff([1, 4], [1, 2, 3, 4]).changes), [1, 2, 3, 4]), true);
  check('清空数组', same(M.applyChanges([1, 2], M.diff([1, 2], []).changes), []), true);
  check('从空数组填充', same(M.applyChanges([], M.diff([], [1, 2]).changes), [1, 2]), true);
  check('把标量换成容器', same(M.applyChanges({ a: 1 }, M.diff({ a: 1 }, { a: { b: [1] } }).changes), { a: { b: [1] } }), true);
  check('把容器换成标量', same(M.applyChanges({ a: { b: [1] } }, M.diff({ a: { b: [1] } }, { a: 0 }).changes), { a: 0 }), true);
  checkThrows('差异列表与文档不匹配时拒绝应用（越界删除）', () => M.applyChanges([1, 2], [
    { path: '/5', kind: 'removed', tokens: ['5'], origin: 'array-element' },
    { path: '/1', kind: 'removed', tokens: ['1'], origin: 'array-element' },
  ]), /下标超出范围|不匹配/);
  checkThrows('差异列表与文档不匹配时拒绝应用（标量内部）', () => M.applyChanges({ a: 1 }, [{ path: '/a/b', kind: 'removed', tokens: ['a', 'b'] }]), /标量|不匹配/);
  checkThrows('数组下标不是数字时拒绝', () => M.applyChanges([1], [{ path: '/x', kind: 'removed', tokens: ['x'], origin: 'array-element' }]), /下标|不匹配/);
  checkThrows('按键配对信息不完整时拒绝', () => M.applyChanges([{ id: 1 }, { id: 2 }], [{ path: '/0', kind: 'moved', tokens: ['0'], baseIndex: 0, targetIndex: 0, moved: true, group: 'key' }]), /不匹配/);
}

console.log('--- 权威参照物：随机 JSON 对的往返 ---');
{
  const rand = makeRandom(20240607);
  let roundTrips = 0;
  let failures = 0;
  let worst = '';
  let mutated = 0;
  let keyedPairs = 0;
  let totalChanges = 0;

  for (let round = 0; round < 400; round += 1) {
    const left = randomValue(rand, 3);
    let right;
    if (rand() < 0.55) {
      right = clone(left);
      mutateRandomly(rand, right);
      mutated += 1;
    } else {
      right = randomValue(rand, 3);
    }

    for (const mode of ['index', 'key']) {
      roundTrips += 1;
      const result = M.diff(left, right, { mode, keyField: 'id' });
      totalChanges += result.changes.length;
      if (result.keyedArrays.byKey > 0) keyedPairs += 1;

      const applied = M.applyChanges(left, result.changes);

      // Three independent oracles must agree that the patch reproduced the right
      // document. If any of them disagreed, one of the two implementations is
      // wrong; requiring all three means neither can be the source of the answer.
      const ok =
        same(applied, right) &&
        structuralEqual(applied, right) &&
        M.deepEqual(applied, right);
      if (!ok) {
        failures += 1;
        if (worst === '') {
          worst = `\n        left  ${JSON.stringify(left).slice(0, 200)}\n        right ${JSON.stringify(right).slice(0, 200)}\n        got   ${JSON.stringify(applied).slice(0, 200)}\n        mode  ${mode}`;
        }
      }
    }
  }

  check(
    `400 组随机 JSON 对 × 2 种模式 = ${roundTrips} 次往返：应用差异后与目标深度相等（三个独立判定器一致）${worst}`,
    failures,
    0,
  );
  check('随机样本里确实有通过变异生成的近似文档', mutated > 100, true);
  check('随机样本里确实触发了按键配对', keyedPairs > 0, true);
  check(`随机样本产生了大量差异（不是空跑，共 ${totalChanges} 条）`, totalChanges > 400, true);
}

console.log('--- 性质：与自己比较恒为空 ---');
{
  const rand = makeRandom(987654321);
  let notEmpty = 0;
  let checked = 0;
  let deepest = 0;
  for (let round = 0; round < 600; round += 1) {
    const value = randomValue(rand, 4);
    for (const mode of ['index', 'key']) {
      checked += 1;
      const result = M.diff(value, value, { mode, keyField: 'id' });
      const visible = M.visibleChanges(result.changes);
      if (visible.length !== 0) notEmpty += 1;
      if (result.stats.total !== 0) notEmpty += 1;
    }
    const depth = (function measure(node) {
      if (node === null || typeof node !== 'object') return 0;
      const children = Array.isArray(node) ? node : Object.values(node);
      return 1 + children.reduce((best, child) => Math.max(best, measure(child)), 0);
    })(value);
    deepest = Math.max(deepest, depth);
  }
  check(`600 组随机文档（含深层嵌套、数组、特殊值）与自己比较恒为空（检查 ${checked} 次）`, notEmpty, 0);
  check('样本确实包含深层嵌套', deepest >= 3, true);
  check('同一对象引用也恒为空', M.diff({ a: 1, b: [1, { c: 2 }] }, { a: 1, b: [1, { c: 2 }] }).changes.length, 0);
  check('恒为空的结论不受容差影响', M.diff({ a: 0.1 + 0.2 }, { a: 0.1 + 0.2 }, { numberTolerance: 0 }).changes.length, 0);
}

console.log('--- 性质：对称性 ---');
{
  const rand = makeRandom(13572468);
  let mismatches = 0;
  let pairsChecked = 0;
  for (let round = 0; round < 300; round += 1) {
    const left = randomValue(rand, 3);
    const right = randomValue(rand, 3);
    for (const mode of ['index', 'key']) {
      pairsChecked += 1;
      const forward = M.diff(left, right, { mode, keyField: 'id' });
      const backward = M.diff(right, left, { mode, keyField: 'id' });
      const added = forward.changes
        .filter((change) => change.kind === 'added')
        .map((change) => change.path)
        .sort()
        .join('|');
      const removed = backward.changes
        .filter((change) => change.kind === 'removed')
        .map((change) => change.path)
        .sort()
        .join('|');
      if (added !== removed) mismatches += 1;

      const forwardRemoved = forward.changes
        .filter((change) => change.kind === 'removed')
        .map((change) => change.path)
        .sort()
        .join('|');
      const backwardAdded = backward.changes
        .filter((change) => change.kind === 'added')
        .map((change) => change.path)
        .sort()
        .join('|');
      if (forwardRemoved !== backwardAdded) mismatches += 1;

      // Both directions must still round-trip; symmetry that broke the patch would
      // be worse than no symmetry at all.
      if (!same(M.applyChanges(left, forward.changes), right)) mismatches += 1;
      if (!same(M.applyChanges(right, backward.changes), left)) mismatches += 1;
    }
  }
  check(`${pairsChecked} 组随机对：diff(a,b) 的新增路径 === diff(b,a) 的删除路径，反向亦然，且两个方向都能应用`, mismatches, 0);
}

console.log('--- 反证：更简单的写法为什么不行 ---');
{
  // 1. Key order: comparing stringified objects would report reordered keys.
  const naiveSame = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  check('反证：JSON.stringify 认为 {"a":1,"b":2} ≠ {"b":2,"a":1}（假差异）', naiveSame({ a: 1, b: 2 }, { b: 2, a: 1 }), false);
  check('本实现认为两者相同', M.diff({ a: 1, b: 2 }, { b: 2, a: 1 }).changes.length, 0);

  // 2. Arrays by index: a reorder looks like a rewrite.
  const byIndex = M.diff([{ id: 1, v: 'a' }, { id: 2, v: 'b' }], [{ id: 2, v: 'b' }, { id: 1, v: 'a' }], { mode: 'index' });
  const byKey = M.diff([{ id: 1, v: 'a' }, { id: 2, v: 'b' }], [{ id: 2, v: 'b' }, { id: 1, v: 'a' }], { mode: 'key', keyField: 'id' });
  check('反证：按索引比较把纯重排报成多处修改', byIndex.stats.modified >= 2, true);
  check('按键配对把同一重排报成零内容差异', M.hasContentChanges(byKey.changes), false);
  check('按键配对的条数也不多于按索引（2 条移动 vs 2 条修改）', byKey.stats.total <= byIndex.stats.total, true);

  // 3. Type changes: a loose comparison would hide number → string.
  const loose = (left, right) => String(left) === String(right);
  check('反证：宽松比较认为 1 == "1"（漏报类型变化）', loose(1, '1'), true);
  check('本实现把 1 → "1" 报为类型变化', M.diff(1, '1').changes[0].kind, 'typeChanged');

  // 4. Numeric tolerance must not be a blanket "approximately equal".
  check('反证：容差不是对所有类型生效', M.diff({ a: 'x' }, { a: 'x!' }, { numberTolerance: 100 }).stats.total, 1);

  // 5. `undefined` must be rejected rather than treated as a deletion: a diff that
  //    silently accepts it would produce changes that cannot be JSON.
  checkThrows('反证：undefined 不能被当作"删除"处理', () => M.diff({ a: undefined }, {}), /undefined|非普通对象/);
  check('反证：JSON.stringify 会静默丢掉 undefined 成员', JSON.stringify({ a: undefined }), '{}');
  check('本实现对该输入报错而不是给出错误答案', M.isJsonValue({ a: undefined }), false);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
