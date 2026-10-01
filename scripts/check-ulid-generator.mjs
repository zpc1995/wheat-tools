/**
 * Checks the ULID generator logic.
 *
 * Everything here runs against `ulidUtils.ts` transpiled to a temporary ESM
 * module. The point of the pure-function design is visible in this file: the
 * clock is pinned to a chosen millisecond and the randomness is a chosen byte
 * array, so the *specification's own examples* can be asserted exactly instead
 * of "some 26 character string came out".
 *
 * The independent reference used throughout is a separate BigInt implementation
 * written straight from the specification (encode by repeated division, decode
 * by repeated multiplication). The implementation under test does its encoding
 * with 5-bit packing and 48-bit-safe arithmetic; the two share no code, so
 * agreeing on a thousand inputs is evidence rather than a tautology.
 *
 * Authoritative sources
 *   - Specification and monotonic example: https://github.com/ulid/spec
 *   - Reference implementation README vectors (encodeTime/decodeTime and the
 *     paired full example): https://github.com/ulid/javascript
 *
 * One correction to the brief this tool was built from: it paired
 * `01ARZ3NDEKTSV4RRFFQ69G5FAV` with the millisecond value 1469918176385. Those
 * two do not belong together. The reference README shows a no-argument example
 * using that string, and separately shows
 *   ulid(1469918176385) // "01ARYZ6S41TSV4RRFFQ69G5FAV"
 *   decodeTime("01ARYZ6S41TSV4RRFFQ69G5FAV"); // 1469918176385
 * so 1469918176385 encodes to `01ARYZ6S41`, while `01ARZ3NDEK` decodes to
 * 1469922850259. Both facts are asserted below, so the correct pairing is
 * recorded in the suite.
 *
 * Usage: node scripts/check-ulid-generator.mjs
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/ulid-generator/ulidUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/ulid-generator.mjs', compiled);
const M = await import(pathToFileURL('.verify/ulid-generator.mjs').href);

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

/** The implementation throws RangeError; assert that specifically. */
function throwsRangeError(fn) {
  try {
    fn();
    return false;
  } catch (error) {
    return error instanceof RangeError;
  }
}

// ---------------------------------------------------------------------------
// Independent reference, straight from the specification.
// ---------------------------------------------------------------------------

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RFC4648_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Big-endian Crockford Base32 of a BigInt, zero-padded to `length`. */
function refEncode(value, length) {
  let remaining = value;
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out = ALPHABET[Number(remaining % 32n)] + out;
    remaining /= 32n;
  }
  return out;
}

/** Big-endian decode of a Crockford Base32 string to a BigInt. */
function refDecode(text) {
  let value = 0n;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error(`reference decoder got a foreign character: ${char}`);
    value = value * 32n + BigInt(digit);
  }
  return value;
}

function bytesToBigInt(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

/** The whole ULID, built with BigInt only. */
function refGenerate(nowMs, bytes) {
  return refEncode(BigInt(nowMs), 10) + refEncode(bytesToBigInt(bytes), 16);
}

/** Random bytes that spell a given 16 character random field. */
function bytesForRandom(random) {
  const value = refDecode(random);
  const bytes = new Uint8Array(10);
  for (let index = 9; index >= 0; index -= 1) {
    // The mask has to happen while the value is still a BigInt: converting an
    // 80-bit value to a Number first would round away the low 27 bits, which is
    // precisely the precision loss this implementation avoids.
    bytes[index] = Number((value >> BigInt((9 - index) * 8)) & 0xffn);
  }
  return bytes;
}

function randomTimestamp48() {
  let value = 0;
  for (const byte of randomBytes(6)) value = value * 256 + byte;
  return value % (M.MAX_TIMESTAMP + 1);
}

// ---------------------------------------------------------------------------
console.log('--- Crockford Base32 字母表 ---');
check('字母表与规范一致', M.CROCKFORD_ALPHABET, ALPHABET);
check('字母表长度 32', M.CROCKFORD_ALPHABET.length, 32);
check('刻意排除 I、L、O、U', ['I', 'L', 'O', 'U'].filter((c) => ALPHABET.includes(c)), []);
check('字母表无重复字符', new Set([...ALPHABET]).size, 32);
// The overflow test below compares characters directly; that is only sound if
// the alphabet is in ASCII order.
check('字母表按 ASCII 升序排列（首字符比较因此成立）', [...ALPHABET].sort().join(''), ALPHABET);

// ---------------------------------------------------------------------------
console.log('--- 规范与参考实现的官方示例 ---');
check('参考实现 encodeTime(1469918176385)', M.encodeTime(1469918176385), '01ARYZ6S41');
check(
  '参考实现 ulid(1469918176385) 的完整示例（随机部分给定）',
  M.generateUlid(1469918176385, bytesForRandom('TSV4RRFFQ69G5FAV')),
  '01ARYZ6S41TSV4RRFFQ69G5FAV',
);
check(
  '参考实现 decodeTime("01ARYZ6S41TSV4RRFFQ69G5FAV")',
  M.decodeTime('01ARYZ6S41TSV4RRFFQ69G5FAV'),
  1469918176385,
);
check(
  '规范 README 的示例串本身是合法 ULID',
  M.isValidUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  true,
);
check(
  '常被误配的 01ARZ3NDEK 实际解码为 1469922850259',
  M.decodeTime('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  1469922850259,
);
check(
  '01ARZ3NDEK 与 1469918176385 并不对应（纠正任务描述里的配对）',
  M.decodeTime('01ARZ3NDEKTSV4RRFFQ69G5FAV') === 1469918176385,
  false,
);
check(
  '规范 README 的单调示例：同毫秒内 VRZ 进位为 VS0',
  M.nextMonotonicUlid(
    { timestamp: M.decodeTime('01BX5ZZKBKACTAV9WEVGEMMVRZ'), random: 'ACTAV9WEVGEMMVRZ' },
    M.decodeTime('01BX5ZZKBKACTAV9WEVGEMMVRZ'),
    new Uint8Array(10),
  ).ulid,
  '01BX5ZZKBKACTAV9WEVGEMMVS0',
);
check(
  '规范 README 给出的最大 ULID 对应 2 的 48 次方减一',
  M.decodeTime('7ZZZZZZZZZZZZZZZZZZZZZZZZZ'),
  281474976710655,
);

// ---------------------------------------------------------------------------
console.log('--- 长度与字符集约束 ---');
{
  let wrongLength = 0;
  let foreignChars = 0;
  let badFirstChar = 0;
  for (let index = 0; index < 500; index += 1) {
    const ulid = M.generateUlid(randomTimestamp48(), randomBytes(10));
    if (ulid.length !== 26) wrongLength += 1;
    for (const char of ulid) if (!ALPHABET.includes(char)) foreignChars += 1;
    if (ulid[0] > '7') badFirstChar += 1;
  }
  check('500 个 ULID 长度均为 26', wrongLength, 0);
  check('500 个 ULID 只使用 Crockford 字母表（I/L/O/U 从未出现）', foreignChars, 0);
  check('首字符始终不超过 7（48 位时间戳没有溢出）', badFirstChar, 0);
}
check('时间部分恰好 10 位', M.generateUlid(1, new Uint8Array(10)).slice(0, 10).length, 10);
check('随机部分恰好 16 位', M.generateUlid(1, new Uint8Array(10)).slice(10).length, 16);
check('小写输入可被接受（ULID 大小写不敏感）', M.normaliseUlid('01aryz6s41tsv4rrffq69g5fav'), '01ARYZ6S41TSV4RRFFQ69G5FAV');
check('首尾空白被忽略', M.normaliseUlid('  01ARYZ6S41TSV4RRFFQ69G5FAV  '), '01ARYZ6S41TSV4RRFFQ69G5FAV');
check('i 不会被折叠成 1（宁可报错也不静默换一个 id）', M.normaliseUlid('01ARYZ6S41TSV4RRFFQ69G5FAi'), null);
check('o 不会被折叠成 0', M.normaliseUlid('01ARYZ6S41TSV4RRFFQ69G5FAo'), null);
check('l 不会被折叠成 1', M.normaliseUlid('01ARYZ6S41TSV4RRFFQ69G5FAl'), null);
check('u 不是合法字符', M.normaliseUlid('01ARYZ6S41TSV4RRFFQ69G5FAu'), null);

// ---------------------------------------------------------------------------
console.log('--- 边界值 ---');
check('时间戳 0 编码为十个 0', M.encodeTime(0), '0000000000');
check('时间戳上限编码为 7 加九个 Z', M.encodeTime(M.MAX_TIMESTAMP), '7ZZZZZZZZZ');
check('时间戳上限加一被拒绝', throwsRangeError(() => M.encodeTime(M.MAX_TIMESTAMP + 1)), true);
check('负时间戳被拒绝', throwsRangeError(() => M.encodeTime(-1)), true);
check('小数时间戳被拒绝', throwsRangeError(() => M.encodeTime(1.5)), true);
check('NaN 时间戳被拒绝', throwsRangeError(() => M.encodeTime(Number.NaN)), true);
check('Infinity 时间戳被拒绝', throwsRangeError(() => M.encodeTime(Number.POSITIVE_INFINITY)), true);
check('全 0 随机与时间戳 0 得到全 0 串', M.generateUlid(0, new Uint8Array(10)), '0'.repeat(26));
check(
  '全 0xFF 随机与上限时间戳得到最大 ULID',
  M.generateUlid(M.MAX_TIMESTAMP, new Uint8Array(10).fill(0xff)),
  `7${'Z'.repeat(25)}`,
);
check('不足 10 字节随机被拒绝', throwsRangeError(() => M.encodeRandom(new Uint8Array(9))), true);
check('超过 10 字节随机只取前 10 字节', M.encodeRandom(new Uint8Array(11).fill(0xff)), 'Z'.repeat(16));
check('随机字节全 0xFF 编码为十六个 Z', M.encodeRandom(new Uint8Array(10).fill(0xff)), 'Z'.repeat(16));
check('十六进制展示', M.randomToHex(new Uint8Array(10).fill(0xff)), 'FF'.repeat(10));
check('十六进制展示补前导零', M.randomToHex(new Uint8Array([0, 1, 15])), '00010F');
check('时间戳 0 的 UTC 展示', M.formatTimestampIso(0), '1970-01-01T00:00:00.000Z');
check(
  '官方示例时间戳的 UTC 展示',
  M.formatTimestampIso(1469918176385),
  '2016-07-30T22:36:16.385Z',
);
check(
  '上限时间戳落在规范所说的 10889 年',
  M.formatTimestampIso(M.MAX_TIMESTAMP),
  '+010889-08-02T05:31:50.655Z',
);

console.log('--- 非法 ULID 的分类 ---');
check('长度不足', M.validateUlid('01ARYZ6S41TSV4RRFFQ69G5FA'), 'length');
check('长度超出', M.validateUlid(`${'01ARYZ6S41TSV4RRFFQ69G5FAV'}V`), 'length');
check('空串', M.validateUlid(''), 'length');
check('非字符串', M.validateUlid(null), 'length');
check('含非法字符 I', M.validateUlid('01ARYZ6S41TSV4RRFFQ69G5FAI'), 'alphabet');
check('含非法字符 U', M.validateUlid('01ARYZ6S41TSV4RRFFQ69G5FAU'), 'alphabet');
check('含小写字母（未规范化）', M.validateUlid('01aryz6s41tsv4rrffq69g5fav'), 'alphabet');
check('含连字符', M.validateUlid('01ARYZ6S41-TSV4RRFFQ69G5FAV'.slice(0, 26)), 'alphabet');
check('首字符 8 视为 48 位溢出', M.validateUlid(`8${'0'.repeat(25)}`), 'overflow');
check('首字符 Z 视为 48 位溢出', M.validateUlid(`Z${'0'.repeat(25)}`), 'overflow');
check('最大合法 ULID 通过校验', M.validateUlid('7ZZZZZZZZZZZZZZZZZZZZZZZZZ'), null);
check('decodeUlid 对非法输入返回 null', M.decodeUlid('not-a-ulid'), null);
check('decodeUlid 对溢出输入返回 null', M.decodeUlid(`8${'0'.repeat(25)}`), null);
check('decodeTime 对非法输入抛错', throwsRangeError(() => M.decodeTime('nope')), true);
check('decodeRandom 对错误长度抛错', throwsRangeError(() => M.decodeRandom('123')), true);
check('incrementRandomPart 对错误长度抛错', throwsRangeError(() => M.incrementRandomPart('123')), true);

// ---------------------------------------------------------------------------
console.log('--- 与独立的 BigInt 参照实现比对 ---');
{
  const timestamps = [0, 1, 31, 32, 33, 1023, 1024, M.MAX_TIMESTAMP, 1469918176385, 1469922850259];
  for (let bit = 0; bit <= 47; bit += 1) {
    timestamps.push(2 ** bit, 2 ** bit - 1);
  }
  for (let index = 0; index < 400; index += 1) timestamps.push(randomTimestamp48());

  let timeMismatches = 0;
  let roundTripMismatches = 0;
  for (const now of timestamps) {
    if (!Number.isInteger(now) || now < 0 || now > M.MAX_TIMESTAMP) continue;
    const encoded = M.encodeTime(now);
    if (encoded !== refEncode(BigInt(now), 10)) timeMismatches += 1;
    // decode is checked through a full ULID, which is the public path.
    if (M.decodeTime(`${encoded}${'0'.repeat(16)}`) !== now) roundTripMismatches += 1;
  }
  check(
    `encodeTime 在 ${timestamps.length} 个时间戳上与 BigInt 参照一致（含 2 的幂边界）`,
    timeMismatches,
    0,
  );
  check('时间戳 编码→解码 全部回到原值', roundTripMismatches, 0);
}
{
  let encodeMismatches = 0;
  let roundTripMismatches = 0;
  for (let index = 0; index < 300; index += 1) {
    const bytes = randomBytes(10);
    const encoded = M.encodeRandom(bytes);
    if (encoded !== refEncode(bytesToBigInt(bytes), 16)) encodeMismatches += 1;
    if (M.randomToHex(M.decodeRandom(encoded)) !== M.randomToHex(bytes)) roundTripMismatches += 1;
  }
  check('encodeRandom 在 300 组随机字节上与 BigInt 参照一致', encodeMismatches, 0);
  check('随机部分 编码→解码 全部回到原字节', roundTripMismatches, 0);
}
{
  let mismatches = 0;
  for (let index = 0; index < 300; index += 1) {
    const now = randomTimestamp48();
    const bytes = randomBytes(10);
    if (M.generateUlid(now, bytes) !== refGenerate(now, bytes)) mismatches += 1;
  }
  check('generateUlid 在 300 组随机（时间, 字节）上与 BigInt 参照一致', mismatches, 0);
}

// ---------------------------------------------------------------------------
console.log('--- 解码 → 编码往返 ---');
{
  let mismatches = 0;
  for (let index = 0; index < 300; index += 1) {
    const now = randomTimestamp48();
    const bytes = randomBytes(10);
    const ulid = M.generateUlid(now, bytes);
    const decoded = M.decodeUlid(ulid);
    if (!decoded) {
      mismatches += 1;
      continue;
    }
    if (decoded.timestamp !== now) mismatches += 1;
    if (decoded.random !== ulid.slice(10)) mismatches += 1;
    if (M.randomToHex(decoded.randomBytes) !== M.randomToHex(bytes)) mismatches += 1;
    if (M.generateUlid(decoded.timestamp, decoded.randomBytes) !== ulid) mismatches += 1;
    if (M.normaliseUlid(ulid.toLowerCase()) !== ulid) mismatches += 1;
  }
  check('300 组随机 ULID 解码→编码回到原字符串', mismatches, 0);

  const official = M.decodeUlid('01ARYZ6S41TSV4RRFFQ69G5FAV');
  check('官方示例解码时间戳', official.timestamp, 1469918176385);
  check('官方示例解码随机部分', official.random, 'TSV4RRFFQ69G5FAV');
  check(
    '官方示例随机部分的字节（大端 80 位）',
    M.randomToHex(official.randomBytes),
    refDecode('TSV4RRFFQ69G5FAV').toString(16).toUpperCase().padStart(20, '0'),
  );
  check(
    '官方示例重新编码后完全一致',
    M.generateUlid(official.timestamp, official.randomBytes),
    '01ARYZ6S41TSV4RRFFQ69G5FAV',
  );
}

// ---------------------------------------------------------------------------
console.log('--- 单调递增 ---');
{
  const NOW = 1469918176385;
  const ulids = [];
  let state = null;
  for (let index = 0; index < 1000; index += 1) {
    const step = M.nextMonotonicUlid(state, NOW, new Uint8Array(10));
    ulids.push(step.ulid);
    state = step.state;
  }

  let inversions = 0;
  for (let index = 1; index < ulids.length; index += 1) {
    if (ulids[index - 1] >= ulids[index]) inversions += 1;
  }
  check('同一毫秒内连续 1000 个字符串严格递增（零次逆序）', inversions, 0);
  check('1000 个互不相同', new Set(ulids).size, 1000);
  check('1000 个时间戳部分完全相同', new Set(ulids.map((u) => u.slice(0, 10))).size, 1);
  check('首个等于官方时间戳 + 全 0 随机', ulids[0], `01ARYZ6S41${'0'.repeat(16)}`);

  // Independent oracle: starting from zero and incrementing i times must equal
  // the base32 of i, computed with BigInt rather than by this implementation.
  let mismatch = 0;
  for (let index = 0; index < ulids.length; index += 1) {
    if (ulids[index] !== `01ARYZ6S41${refEncode(BigInt(index), 16)}`) mismatch += 1;
  }
  check('1000 个随机部分逐一等于 BigInt 参照的 i', mismatch, 0);
  check('第 1000 个随机部分', ulids[999].slice(10), refEncode(999n, 16));
}
{
  // Same guarantee from an arbitrary (crypto) starting point, with fresh random
  // bytes arriving on every call: once the millisecond is the same, they must
  // be ignored.
  const NOW = 1508808576371;
  const seed = randomBytes(10);
  const first = M.generateUlid(NOW, seed);
  const startValue = refDecode(first.slice(10));
  let state = { timestamp: NOW, random: first.slice(10) };
  let mismatch = 0;
  let previous = first;
  for (let index = 1; index <= 1000; index += 1) {
    const step = M.nextMonotonicUlid(state, NOW, randomBytes(10));
    state = step.state;
    if (step.ulid !== `01BX5ZZKBK${refEncode(startValue + BigInt(index), 16)}`) mismatch += 1;
    if (step.ulid <= previous) mismatch += 1;
    if (step.reusedTimestamp !== true) mismatch += 1;
    previous = step.ulid;
  }
  check('从随机起点继续 1000 次自增仍与 BigInt 参照一致且严格递增', mismatch, 0);
}
{
  const NOW = 1000;
  const step = M.nextMonotonicUlid({ timestamp: NOW, random: '0'.repeat(16) }, NOW + 1, new Uint8Array(10));
  check('时间戳前进时使用新随机数（不复用旧时间戳）', step.reusedTimestamp, false);
  check('时间戳前进时随机部分来自传入的字节', step.ulid.slice(10), '0'.repeat(16));

  // A wall clock that jumps backwards must not break the ordering: monotonic
  // mode keeps the last timestamp instead of emitting an earlier one.
  const back = M.nextMonotonicUlid({ timestamp: NOW, random: '0'.repeat(15) + '5' }, NOW - 5000, new Uint8Array(10));
  check('时钟回拨时保留上一个时间戳', back.state.timestamp, NOW);
  check('时钟回拨时随机部分仍然 +1', back.ulid.slice(10), '0'.repeat(15) + '6');
  check(
    '时钟回拨时的结果仍大于上一个 ULID',
    back.ulid > `${M.encodeTime(NOW)}${'0'.repeat(15)}5`,
    true,
  );
}
{
  check('全 Z 随机部分无法再自增', M.incrementRandomPart('Z'.repeat(16)), null);
  check('末位从 Z 进位到前一位', M.incrementRandomPart(`${'0'.repeat(15)}Z`), `${'0'.repeat(14)}10`);
  check('跨位进位（后 16 位全进位）', M.incrementRandomPart(`0${'Z'.repeat(15)}`), `1${'0'.repeat(15)}`);
  check('普通自增只动末位', M.incrementRandomPart('000000000000000Z'.slice(0, 15) + '2'), `${'0'.repeat(15)}3`);
  check('自增结果与 BigInt 参照一致', M.incrementRandomPart('ACTAV9WEVGEMMVRZ'), refEncode(refDecode('ACTAV9WEVGEMMVRZ') + 1n, 16));
  check(
    '随机部分溢出时按规范抛错，而不是回绕成 0 或伪造时间戳',
    throwsRangeError(() =>
      M.nextMonotonicUlid({ timestamp: 12345, random: 'Z'.repeat(16) }, 12345, new Uint8Array(10)),
    ),
    true,
  );
}
{
  const NOW = 1469918176385;
  // Non-monotonic mode draws fresh randomness every time, so the strings are
  // not sorted. This is the contrast that proves monotonic mode is not a no-op:
  // with a random 80-bit field, 1000 values all being in ascending order has
  // probability 1/1000! — effectively zero.
  const plainBatch = M.generateBatch(1000, NOW, () => randomBytes(10), { timestamp: NOW, random: '0'.repeat(16) }, false);
  let inversions = 0;
  for (let index = 1; index < plainBatch.ulids.length; index += 1) {
    if (plainBatch.ulids[index - 1] >= plainBatch.ulids[index]) inversions += 1;
  }
  check('非单调模式同一毫秒内 1000 个并不递增（对照）', inversions > 0, true);
  check('非单调模式不保留单调状态', plainBatch.monotonicState, null);

  const monotonicBatch = M.generateBatch(1000, NOW, () => randomBytes(10), null, true);
  let monotonicInversions = 0;
  for (let index = 1; index < monotonicBatch.ulids.length; index += 1) {
    if (monotonicBatch.ulids[index - 1] >= monotonicBatch.ulids[index]) monotonicInversions += 1;
  }
  check('单调模式的同一批量严格递增', monotonicInversions, 0);
  check('单调模式返回可供下一批续用的状态', typeof monotonicBatch.monotonicState?.random, 'string');
  check('单调状态的随机部分与最后一个 ULID 一致', monotonicBatch.monotonicState.random, monotonicBatch.ulids[999].slice(10));
}

// ---------------------------------------------------------------------------
console.log('--- 批量参数 ---');
{
  const NOW = 1469918176385;
  const zeros = () => new Uint8Array(10);
  check('数量 0 生成空列表', M.generateBatch(0, NOW, zeros, null, false).ulids, []);
  check('负数数量按 0 处理', M.generateBatch(-5, NOW, zeros, null, false).ulids, []);
  check('NaN 数量按 0 处理', M.generateBatch(Number.NaN, NOW, zeros, null, false).ulids, []);
  check('小数数量向下取整', M.generateBatch(3.9, NOW, zeros, null, false).ulids.length, 3);
  check('数量上限被夹到 MAX_BATCH', M.generateBatch(5000, NOW, zeros, null, false).ulids.length, M.MAX_BATCH);
  check('上限常量与文档一致', M.MAX_BATCH, 1000);
  let randomCalls = 0;
  M.generateBatch(4, NOW, () => {
    randomCalls += 1;
    return zeros();
  }, null, false);
  check('随机源被调用恰好 count 次（每条一个新随机数）', randomCalls, 4);
  // Non-monotonic with identical randomness at one timestamp is the honest
  // worst case: the ids really are equal, and the tool does not pretend
  // otherwise by silently bumping them.
  const same = M.generateBatch(3, NOW, zeros, null, false).ulids;
  check('非单调且随机相同时会产生重复（不静默改写随机数）', new Set(same).size, 1);
}

// ---------------------------------------------------------------------------
console.log('--- 跨毫秒的自然顺序 ---');
{
  let mismatches = 0;
  let previous = '';
  for (let index = 0; index < 1000; index += 1) {
    const now = 1469918176385 + index * 3;
    const ulid = M.generateUlid(now, randomBytes(10));
    if (ulid <= previous) mismatches += 1;
    previous = ulid;
  }
  check('时间戳递增时字符串必然递增（128 位随机也不影响先后）', mismatches, 0);
}

// ---------------------------------------------------------------------------
console.log('--- 随机源统计（node:crypto） ---');
{
  const NOW = 1469918176385;
  const COUNT = 2000;
  const ulids = [];
  for (let index = 0; index < COUNT; index += 1) ulids.push(M.generateUlid(NOW, randomBytes(10)));

  let structureProblems = 0;
  for (const ulid of ulids) {
    if (ulid.length !== 26) structureProblems += 1;
    for (const char of ulid) if (!ALPHABET.includes(char)) structureProblems += 1;
  }
  check(`${COUNT} 个加密随机 ULID 结构全部合法`, structureProblems, 0);
  check('同一毫秒内 2000 个加密随机 ULID 互不相同', new Set(ulids).size, COUNT);
  check(
    '同一毫秒内时间戳部分完全一致',
    new Set(ulids.map((ulid) => ulid.slice(0, 10))).size,
    1,
  );

  const randomChars = ulids.map((ulid) => ulid.slice(10)).join('');
  const counts = new Map();
  for (const char of randomChars) counts.set(char, (counts.get(char) ?? 0) + 1);
  const expected = randomChars.length / 32;
  let chiSquare = 0;
  for (const symbol of ALPHABET) {
    const observed = counts.get(symbol) ?? 0;
    chiSquare += ((observed - expected) ** 2) / expected;
  }
  check('32 个字符全部出现过', [...ALPHABET].filter((s) => !counts.has(s)).length, 0);
  // df = 31: the 0.1% critical value is 67.7. The bound is deliberately loose so
  // a rare unlucky run is not reported as a bug, while a biased encoder (say,
  // one that masks bytes down to 5 bits) is still caught immediately.
  check(
    `字符分布卡方统计量 ${chiSquare.toFixed(1)} 低于 90（df=31，宽松上限）`,
    chiSquare < 90,
    true,
  );
  const maxShare = Math.max(...[...counts.values()]) / randomChars.length;
  check(`最频繁字符占比 ${(maxShare * 100).toFixed(2)}% 不超过 8%`, maxShare < 0.08, true);
}

// ---------------------------------------------------------------------------
console.log('--- 更简单的写法为什么是错的 ---');
{
  // 1. A Number cannot hold 80 bits. Any implementation that builds the random
  //    field from `Math.random() * 2 ** 80` collapses neighbouring values.
  const allOnes = Array(10).fill(0xff);
  const allOnesMinusOne = [...Array(9).fill(0xff), 0xfe];
  const asNumber = (bytes) => bytes.reduce((acc, byte) => acc * 256 + byte, 0);
  check(
    '两个不同的 80 位随机值转成 Number 后相等（证明 80 位无法用 Number 承载）',
    asNumber(allOnes) === asNumber(allOnesMinusOne),
    true,
  );
  check(
    '同一个字节序列，本实现编码后并不相同（位数没有丢失）',
    M.encodeRandom(Uint8Array.from(allOnes)) === M.encodeRandom(Uint8Array.from(allOnesMinusOne)),
    false,
  );
  check(
    '两个 80 位随机值编码后恰好相差 1',
    refDecode(M.encodeRandom(Uint8Array.from(allOnes))) - refDecode(M.encodeRandom(Uint8Array.from(allOnesMinusOne))) === 1n,
    true,
  );

  // 2. Bitwise operators in JavaScript are 32-bit; a 48-bit timestamp pushed
  //    through `>>>` comes out as a different number.
  check('48 位时间戳经 32 位位运算后被截断', 1469918176385 >>> 0, 1039361153);
  check('截断后的值不等于原时间戳', (1469918176385 >>> 0) === 1469918176385, false);

  // 3. Generic base32 alphabets are not Crockford's. RFC 4648 keeps I, L, O and
  //    U, and encodes the same millisecond to a visibly different string.
  check(
    'RFC 4648 字母表包含全部四个易混字符',
    ['I', 'L', 'O', 'U'].filter((c) => RFC4648_ALPHABET.includes(c)).length,
    4,
  );
  {
    let remaining = 1469918176385;
    let rfc = '';
    for (let index = 0; index < 10; index += 1) {
      rfc = RFC4648_ALPHABET[remaining % 32] + rfc;
      remaining = Math.floor(remaining / 32);
    }
    check('同一时间戳用 RFC 4648 编码结果不同', rfc, 'ABKY67GZEB');
    check('RFC 4648 的结果与本实现不同', rfc === M.encodeTime(1469918176385), false);
  }
  {
    // `toString(32)` is the shortest "just use built-in base32" shortcut, and it
    // produces O and U, which ULIDs must never contain.
    const builtin = (1469918176385).toString(32).toUpperCase();
    check('Number.prototype.toString(32) 产生了被排除的字符', [...new Set(builtin)].filter((c) => !ALPHABET.includes(c)).sort(), ['O', 'U']);
  }
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
