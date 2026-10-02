/**
 * Checks the IPv4 range expander.
 *
 * The algorithm under test is "smallest set of CIDR blocks whose union is exactly
 * this range". Minimality is the whole claim, so it is not checked by counting
 * blocks: the reference is CPython's `ipaddress.summarize_address_range`, which
 * computes the canonical cover for exactly this problem. Every case — hand-picked
 * boundaries plus thousands of random ranges — is compared set-for-set, in order,
 * against that function. If `python3` is unavailable the comparison is skipped
 * with an explicit notice.
 *
 * The reference does not make the local properties redundant, so they are checked
 * too, each with its own independent arithmetic rather than by calling the module:
 * the block sizes must sum to the exact range length, no two blocks may overlap,
 * and membership of every address is decided by a mask recomputed here. For small
 * ranges the union is enumerated address by address.
 *
 * Usage: node scripts/check-ipv4-range-expander.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/ipv4-range-expander/ipv4RangeExpanderUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/ipv4-range-expander.mjs', compiled);
const R = await import(pathToFileURL('.verify/ipv4-range-expander.mjs').href);

let passed = 0;
let failed = 0;
let skipped = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}
function checkTrue(label, actual) {
  check(label, actual, true);
}
function skip(label, why) {
  skipped += 1;
  console.log(`SKIP  ${label}  （${why}）`);
}
function throwsMessage(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const MAX_U32 = 4294967295;
const TOTAL = 4294967296;

let seed = 0x9e3779b9;
function nextRandom() {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed;
}
function randomValue() {
  return nextRandom() % TOTAL;
}
function dotted(value) {
  return R.toDotted(value);
}

/** Independent mask: computed here, not taken from the module. */
function independentMask(prefix) {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}
/** Independent "does this block contain this address" decision. */
function independentCovers(block, address) {
  const mask = independentMask(block.prefix);
  return ((block.network & mask) >>> 0) === ((address & mask) >>> 0);
}
function independentBlockSize(prefix) {
  return 2 ** (32 - prefix);
}

// ---------------------------------------------------------------------------
// 已知值（固定参照，即使没有 python 也成立）
// ---------------------------------------------------------------------------

console.log('--- 已知值 ---');
const range = (first, last) => ({ first: R.parseIpv4(first), last: R.parseIpv4(last) });
const cover = (first, last) => R.summarizeRange(R.parseIpv4(first), R.parseIpv4(last)).map(R.formatBlock);
check(
  '192.168.1.5 ~ 192.168.1.30 的最小覆盖',
  cover('192.168.1.5', '192.168.1.30'),
  ['192.168.1.5/32', '192.168.1.6/31', '192.168.1.8/29', '192.168.1.16/29', '192.168.1.24/30', '192.168.1.28/31', '192.168.1.30/32'],
);
check('1.2.3.4 ~ 1.2.3.9', cover('1.2.3.4', '1.2.3.9'), ['1.2.3.4/30', '1.2.3.8/31']);
check('10.0.0.0 ~ 10.0.0.3 是单个 /30', cover('10.0.0.0', '10.0.0.3'), ['10.0.0.0/30']);
check('整个地址空间是一个 /0', cover('0.0.0.0', '255.255.255.255'), ['0.0.0.0/0']);
check('单地址 0.0.0.0 是 /32', cover('0.0.0.0', '0.0.0.0'), ['0.0.0.0/32']);
check('单地址 255.255.255.255 是 /32', cover('255.255.255.255', '255.255.255.255'), ['255.255.255.255/32']);
check('192.168.1.1 单地址', cover('192.168.1.1', '192.168.1.1'), ['192.168.1.1/32']);
check('192.168.0.0 ~ 192.168.0.255 是 /24', cover('192.168.0.0', '192.168.0.255'), ['192.168.0.0/24']);
check('192.168.0.0 ~ 192.168.1.255 合并为一个 /23', cover('192.168.0.0', '192.168.1.255'), ['192.168.0.0/23']);
check('0.0.0.0 ~ 127.255.255.255 是 /1', cover('0.0.0.0', '127.255.255.255'), ['0.0.0.0/1']);
check('128.0.0.0 ~ 255.255.255.255 是 /1', cover('128.0.0.0', '255.255.255.255'), ['128.0.0.0/1']);

// ---------------------------------------------------------------------------
// 性质：精确覆盖、互不重叠、最小性的必要条件
// ---------------------------------------------------------------------------

console.log('--- 覆盖性质 ---');
const CASES = [];
for (const [first, last] of [
  ['0.0.0.0', '255.255.255.255'],
  ['0.0.0.0', '0.0.0.0'],
  ['255.255.255.255', '255.255.255.255'],
  ['0.0.0.0', '255.255.255.254'],
  ['1.0.0.0', '255.255.255.255'],
  ['192.168.1.5', '192.168.1.30'],
  ['10.0.0.0', '10.0.0.3'],
  ['172.16.0.0', '172.31.255.255'],
]) {
  CASES.push(range(first, last));
}
for (const base of ['0.0.0.0', '0.0.0.1', '0.0.0.255', '0.0.1.0', '0.255.255.255', '1.0.0.0', '127.255.255.255', '128.0.0.0', '255.255.255.0', '255.255.255.254']) {
  const start = R.parseIpv4(base);
  for (const length of [0, 1, 2, 3, 5, 8, 15, 16, 31, 32, 63]) {
    const last = Math.min(MAX_U32, start + length);
    CASES.push({ first: start, last });
  }
}
for (let index = 0; index < 5000; index += 1) {
  const a = randomValue();
  const b = randomValue();
  CASES.push({ first: Math.min(a, b), last: Math.max(a, b) });
}

{
  let totalViolations = 0;
  let disjointViolations = 0;
  let tilingViolations = 0;
  let canonicalViolations = 0;
  let sizeViolations = 0;
  let runaway = 0;
  for (const { first, last } of CASES) {
    const blocks = R.summarizeRange(first, last);
    if (blocks.length > 64) runaway += 1;

    // Sum of the independently computed block sizes must be the exact length.
    let sum = 0;
    for (const block of blocks) sum += independentBlockSize(block.prefix);
    if (sum !== last - first + 1) sizeViolations += 1;
    if (R.totalAddresses(blocks) !== last - first + 1) totalViolations += 1;

    if (!R.areDisjoint(blocks)) disjointViolations += 1;

    // The blocks must tile the range with no gap: first == start, each next
    // block starts right after the previous ends, last end == end.
    if (blocks.length === 0 || R.blockFirst(blocks[0]) !== first) tilingViolations += 1;
    for (let index = 1; index < blocks.length; index += 1) {
      if (R.blockFirst(blocks[index]) !== R.blockLast(blocks[index - 1]) + 1) tilingViolations += 1;
    }
    if (blocks.length > 0 && R.blockLast(blocks[blocks.length - 1]) !== last) tilingViolations += 1;

    for (const block of blocks) {
      if (block.network !== ((block.network & independentMask(block.prefix)) >>> 0)) canonicalViolations += 1;
      if (block.prefix < 0 || block.prefix > 32 || !Number.isInteger(block.prefix)) canonicalViolations += 1;
    }
  }
  check(`${CASES.length} 个范围：各块地址数之和精确等于范围长度`, sizeViolations, 0);
  check(`${CASES.length} 个范围：totalAddresses 也精确等于范围长度`, totalViolations, 0);
  check(`${CASES.length} 个范围：各块两两不重叠`, disjointViolations, 0);
  check(`${CASES.length} 个范围：各块无缝拼接（首块对齐起点、末块对齐终点、中间无空隙）`, tilingViolations, 0);
  check(`${CASES.length} 个范围：每块都是规范网络地址且 prefix 合法`, canonicalViolations, 0);
  check('每个范围最多 64 块（与实现声明的循环上界一致，不会失控）', runaway, 0);
}

console.log('--- 并集恰好覆盖：逐地址枚举（短范围） ---');
{
  let wrongCount = 0;
  let enumerated = 0;
  let outsideCovered = 0;
  for (const { first, last } of CASES) {
    const length = last - first + 1;
    if (length > 4096) continue;
    enumerated += 1;
    const blocks = R.summarizeRange(first, last);
    const counts = new Map();
    for (const block of blocks) {
      const size = independentBlockSize(block.prefix);
      for (let address = block.network; address < block.network + size; address += 1) {
        counts.set(address, (counts.get(address) ?? 0) + 1);
      }
    }
    for (let address = first; address <= last; address += 1) {
      if (counts.get(address) !== 1) wrongCount += 1;
    }
    for (const [address, count] of counts) {
      if (address < first || address > last) outsideCovered += 1;
      if (count < 1) wrongCount += 1;
    }
  }
  check(`枚举了 ${enumerated} 个短范围，范围内每个地址恰好被覆盖一次`, wrongCount, 0);
  check('覆盖集合里没有范围之外的地址', outsideCovered, 0);
  checkTrue('确实枚举到了足够多的短范围', enumerated > 30);
}

console.log('--- 并集恰好覆盖：随机抽样（长范围，独立掩码判定） ---');
{
  let insideViolations = 0;
  let outsideViolations = 0;
  let sampledInside = 0;
  let sampledOutside = 0;
  for (const { first, last } of CASES) {
    const length = last - first + 1;
    if (length <= 4096) continue;
    const blocks = R.summarizeRange(first, last);
    for (let index = 0; index < 200; index += 1) {
      const inside = first + (nextRandom() % length);
      sampledInside += 1;
      let hits = 0;
      for (const block of blocks) if (independentCovers(block, inside)) hits += 1;
      if (hits !== 1) insideViolations += 1;

      if (first > 0) {
        const outside = nextRandom() % first;
        sampledOutside += 1;
        let hits = 0;
        for (const block of blocks) if (independentCovers(block, outside)) hits += 1;
        if (hits !== 0) outsideViolations += 1;
      }
      if (last < MAX_U32) {
        const outside = last + 1 + (nextRandom() % (MAX_U32 - last));
        sampledOutside += 1;
        let hits = 0;
        for (const block of blocks) if (independentCovers(block, outside)) hits += 1;
        if (hits !== 0) outsideViolations += 1;
      }
    }
  }
  check(`范围内 ${sampledInside} 个抽样点都恰好落在一个块里`, insideViolations, 0);
  check(`范围外 ${sampledOutside} 个抽样点都不在任何块里`, outsideViolations, 0);
}

// ---------------------------------------------------------------------------
// 权威参照物：CPython ipaddress.summarize_address_range
// ---------------------------------------------------------------------------

const PY_SCRIPT = `
import sys, json, ipaddress
data = json.loads(sys.stdin.buffer.read().decode('utf-8'))
out = []
for first, last in data:
    out.append([str(n) for n in ipaddress.summarize_address_range(ipaddress.IPv4Address(first), ipaddress.IPv4Address(last))])
print(json.dumps(out))
`;

function runPython(script, payload) {
  const res = spawnSync('python3', ['-c', script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  if (res.error) return { ok: false, error: res.error.message };
  if (res.status !== 0) return { ok: false, error: (res.stderr || '').trim().slice(0, 400) };
  try {
    return { ok: true, value: JSON.parse(res.stdout) };
  } catch (err) {
    return { ok: false, error: `无法解析 python3 的输出: ${String(err)}` };
  }
}

const HAVE_PY = spawnSync('python3', ['-c', 'import ipaddress'], { encoding: 'utf8' }).status === 0;

console.log('--- 与 CPython ipaddress.summarize_address_range 逐例比对 ---');
if (!HAVE_PY) {
  console.log('WARN  未找到可用的 python3，无法以 ipaddress.summarize_address_range 为参照物验证最小性');
  skip('全部以 ipaddress.summarize_address_range 为参照物的比对', 'python3 不可用');
} else {
  const payload = CASES.map(({ first, last }) => [first, last]);
  const batch = runPython(PY_SCRIPT, payload);
  if (!batch.ok) {
    check('python3 参照物批次执行成功', batch.error, null);
  } else {
    const reference = batch.value;
    checkTrue('参照物返回了同样数量的结果', reference.length === payload.length);
    const mismatches = [];
    for (let index = 0; index < payload.length; index += 1) {
      const mine = R.summarizeRange(payload[index][0], payload[index][1]).map(R.formatBlock);
      if (JSON.stringify(mine) !== JSON.stringify(reference[index])) {
        mismatches.push({ first: dotted(payload[index][0]), last: dotted(payload[index][1]), mine, reference: reference[index] });
      }
    }
    check(`${payload.length} 个范围与 ipaddress.summarize_address_range 的最小 CIDR 集合完全一致`, mismatches.length, 0);
    for (const item of mismatches.slice(0, 3)) console.log(`        ${JSON.stringify(item)}`);

    // The oracle itself: a known non-trivial case, so a silently broken reference
    // cannot make the comparison above vacuous.
    const sample = payload.findIndex(([first, last]) => first === R.parseIpv4('192.168.1.5') && last === R.parseIpv4('192.168.1.30'));
    check(
      '参照物自检：192.168.1.5 ~ 192.168.1.30 的期望集合',
      sample === -1 ? null : reference[sample],
      ['192.168.1.5/32', '192.168.1.6/31', '192.168.1.8/29', '192.168.1.16/29', '192.168.1.24/30', '192.168.1.28/31', '192.168.1.30/32'],
    );
    check(
      '参照物自检：整段范围是单个 0.0.0.0/0',
      reference[payload.findIndex(([first, last]) => first === 0 && last === MAX_U32)],
      ['0.0.0.0/0'],
    );
  }
}

// ---------------------------------------------------------------------------
// 边界与非法输入
// ---------------------------------------------------------------------------

console.log('--- 边界与错误 ---');
check(
  '起始大于终止报错',
  throwsMessage(() => R.summarizeRange(R.parseIpv4('192.168.1.30'), R.parseIpv4('192.168.1.5'))) !== null,
  true,
);
checkTrue(
  '起始大于终止的错误信息点明方向',
  (throwsMessage(() => R.summarizeRange(R.parseIpv4('10.0.0.2'), R.parseIpv4('10.0.0.1'))) || '').includes('大于'),
);
check('地址为负数报错', throwsMessage(() => R.summarizeRange(-1, 10)) !== null, true);
check('地址超过 2^32-1 报错', throwsMessage(() => R.summarizeRange(0, TOTAL)) !== null, true);
check('地址非整数报错', throwsMessage(() => R.summarizeRange(0, 1.5)) !== null, true);
check('前缀为 33 报错', throwsMessage(() => R.assertPrefix(33)) !== null, true);
check('前缀为 -1 报错', throwsMessage(() => R.assertPrefix(-1)) !== null, true);
check('前缀非整数报错', throwsMessage(() => R.assertPrefix(1.5)) !== null, true);
check('parseRangeExpression 空输入报错', throwsMessage(() => R.parseRangeExpression('')) !== null, true);
check('parseRangeExpression 乱码报错', throwsMessage(() => R.parseRangeExpression('abc')) !== null, true);
check('parseRangeExpression 三段报错', throwsMessage(() => R.parseRangeExpression('1.1.1.1-2.2.2.2-3.3.3.3')) !== null, true);
check('parseRangeExpression 起始大于终止报错', throwsMessage(() => R.parseRangeExpression('10.0.0.9-10.0.0.1')) !== null, true);
check('parseIpv4 段数不足报错', throwsMessage(() => R.parseIpv4('1.2.3')) !== null, true);
check('parseIpv4 段数过多报错', throwsMessage(() => R.parseIpv4('1.2.3.4.5')) !== null, true);
check('parseIpv4 超过 255 报错', throwsMessage(() => R.parseIpv4('256.1.1.1')) !== null, true);
check('parseIpv4 拒绝前导 0（与 inet_aton 的八进制陷阱划清界限）', throwsMessage(() => R.parseIpv4('01.2.3.4')) !== null, true);
check('parseIpv4 允许首尾空白', R.parseIpv4('  1.2.3.4 '), R.parseIpv4('1.2.3.4'));
check('parseCidr 缺少 / 报错', throwsMessage(() => R.parseCidr('1.2.3.4')) !== null, true);
check('parseCidr 前缀为 33 报错', throwsMessage(() => R.parseCidr('1.2.3.4/33')) !== null, true);
check('parseCidr 空前缀报错', throwsMessage(() => R.parseCidr('1.2.3.4/')) !== null, true);
check('parseCidr 非数字前缀报错', throwsMessage(() => R.parseCidr('1.2.3.4/abc')) !== null, true);
check('parseCidr 允许带主机位并规范化', R.formatBlock(R.parseCidr('192.168.1.5/24')), '192.168.1.0/24');
check('parseCidr 保留 /0', R.formatBlock(R.parseCidr('0.0.0.0/0')), '0.0.0.0/0');
{
  let typeOk = false;
  try {
    R.summarizeRange(5, 1);
  } catch (error) {
    typeOk = error instanceof R.Ipv4RangeError && error.name === 'Ipv4RangeError';
  }
  check('错误类型是 Ipv4RangeError', typeOk, true);
}
{
  let mismatches = 0;
  for (let index = 0; index < 60_000; index += 1) {
    const value = randomValue();
    if (R.parseIpv4(R.toDotted(value)) !== value) mismatches += 1;
  }
  check('parseIpv4 与 toDotted 在 6 万个随机值上互逆', mismatches, 0);
}

// ---------------------------------------------------------------------------
// 块运算
// ---------------------------------------------------------------------------

console.log('--- 块运算 ---');
check('blockSize(0) = 2^32', R.blockSize(0), TOTAL);
check('blockSize(32) = 1', R.blockSize(32), 1);
check('blockSize(24) = 256', R.blockSize(24), 256);
check('maskForPrefix(0) = 0', R.maskForPrefix(0), 0);
check('maskForPrefix(32) = 4294967295', R.maskForPrefix(32), MAX_U32);
check('maskForPrefix(24)', R.maskForPrefix(24), 0xffffff00);
check('maskForPrefix(8)', R.maskForPrefix(8), 0xff000000);
check('usableHostCount(0) 扣除网络与广播', R.usableHostCount(0), TOTAL - 2);
check('usableHostCount(24) = 254', R.usableHostCount(24), 254);
check('usableHostCount(30) = 2', R.usableHostCount(30), 2);
check('usableHostCount(31) = 2（RFC 3021 点对点）', R.usableHostCount(31), 2);
check('usableHostCount(32) = 1', R.usableHostCount(32), 1);
check('isCanonical 对规范块为真', R.isCanonical(R.parseCidr('10.0.0.0/8')), true);
check('isCanonical 对带主机位的块为假', R.isCanonical({ network: R.parseIpv4('10.1.2.3'), prefix: 8 }), false);
check('blockFirst/blockLast 对 /0', [R.blockFirst(R.parseCidr('0.0.0.0/0')), R.blockLast(R.parseCidr('0.0.0.0/0'))], [0, MAX_U32]);
check('blockFirst/blockLast 对 /32', [R.blockFirst(R.parseCidr('1.2.3.4/32')), R.blockLast(R.parseCidr('1.2.3.4/32'))], [R.parseIpv4('1.2.3.4'), R.parseIpv4('1.2.3.4')]);
check('formatBlock 规范化主机位', R.formatBlock({ network: R.parseIpv4('10.1.2.3'), prefix: 8 }), '10.0.0.0/8');
check('areDisjoint：重叠为假', R.areDisjoint([R.parseCidr('10.0.0.0/24'), R.parseCidr('10.0.0.128/25')]), false);
check('areDisjoint：相邻但不重叠为真', R.areDisjoint([R.parseCidr('10.0.0.0/24'), R.parseCidr('10.0.1.0/24')]), true);
check('areDisjoint：无序输入也能判断', R.areDisjoint([R.parseCidr('10.0.1.0/24'), R.parseCidr('10.0.0.0/24')]), true);
check('areDisjoint：空列表为真', R.areDisjoint([]), true);

// ---------------------------------------------------------------------------
// 反向：CIDR 列表 → 范围
// ---------------------------------------------------------------------------

console.log('--- collapseBlocks（CIDR 列表 → 范围） ---');
check('空列表返回空', R.collapseBlocks([]), { ranges: [], blocks: [] });
check(
  '相邻的两个 /25 合并成一个 /24',
  R.collapseBlocks([R.parseCidr('192.168.1.0/25'), R.parseCidr('192.168.1.128/25')]).blocks.map(R.formatBlock),
  ['192.168.1.0/24'],
);
check(
  '相邻合并后的范围端点',
  R.collapseBlocks([R.parseCidr('192.168.1.0/25'), R.parseCidr('192.168.1.128/25')]).ranges.map((item) => [dotted(item.first), dotted(item.last)]),
  [['192.168.1.0', '192.168.1.255']],
);
check(
  '被包含的块不改变并集',
  R.collapseBlocks([R.parseCidr('10.0.0.0/24'), R.parseCidr('10.0.0.128/25')]).blocks.map(R.formatBlock),
  ['10.0.0.0/24'],
);
check(
  '不相邻的块保持分离（不会覆盖中间的地址）',
  R.collapseBlocks([R.parseCidr('10.0.0.0/24'), R.parseCidr('10.0.2.0/24')]).ranges.map((item) => [dotted(item.first), dotted(item.last)]),
  [['10.0.0.0', '10.0.0.255'], ['10.0.2.0', '10.0.2.255']],
);
check(
  '乱序输入按地址排序',
  R.collapseBlocks([R.parseCidr('10.0.2.0/24'), R.parseCidr('10.0.0.0/24')]).ranges.map((item) => dotted(item.first)),
  ['10.0.0.0', '10.0.2.0'],
);
check(
  '重复块去重',
  R.collapseBlocks([R.parseCidr('10.0.0.0/24'), R.parseCidr('10.0.0.0/24')]).blocks.map(R.formatBlock),
  ['10.0.0.0/24'],
);
check(
  '整段 /0 与其中的小块合并为一个 /0',
  R.collapseBlocks([R.parseCidr('0.0.0.0/0'), R.parseCidr('8.8.8.8/32')]).blocks.map(R.formatBlock),
  ['0.0.0.0/0'],
);
check(
  '反向结果的每个块都在原并集内且总量精确',
  R.totalAddresses(R.collapseBlocks([R.parseCidr('192.168.1.0/25'), R.parseCidr('192.168.1.128/25')]).blocks),
  256,
);
{
  // Independent union: merge the input intervals here and compare, so the
  // property does not depend on the module's own interval handling.
  const inputs = [
    ['10.0.0.0/24'],
    ['10.0.0.128/25'],
    ['10.0.2.0/24'],
    ['172.16.0.0/12'],
    ['172.16.0.0/16'],
    ['192.168.1.0/25'],
    ['192.168.1.128/25'],
    ['192.168.2.0/23'],
    ['0.0.0.0/0'],
  ];
  const blocks = inputs.map(([text]) => R.parseCidr(text));
  const intervals = blocks
    .map((block) => ({ first: R.blockFirst(block), last: R.blockLast(block) }))
    .sort((a, b) => a.first - b.first);
  const merged = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.first <= previous.last + 1) previous.last = Math.max(previous.last, interval.last);
    else merged.push({ ...interval });
  }
  let independentTotal = 0;
  for (const interval of merged) independentTotal += interval.last - interval.first + 1;
  const result = R.collapseBlocks(blocks);
  check('并集地址数与独立实现的区间合并结果一致', R.totalAddresses(result.blocks), independentTotal);
  check('并集区间端点与独立实现一致', result.ranges.map((item) => [item.first, item.last]), merged.map((item) => [item.first, item.last]));
  check('合并后的块两两不重叠', R.areDisjoint(result.blocks), true);
  let tiling = 0;
  for (const item of result.ranges) {
    const piece = R.summarizeRange(item.first, item.last);
    if (R.blockFirst(piece[0]) !== item.first || R.blockLast(piece[piece.length - 1]) !== item.last) tiling += 1;
  }
  check('每段范围都被其最小覆盖精确铺满', tiling, 0);
}

// ---------------------------------------------------------------------------
// 输入解析
// ---------------------------------------------------------------------------

console.log('--- parseRangeExpression 分隔符 ---');
const expectedRange = ['192.168.1.5', '192.168.1.30'];
for (const text of [
  '192.168.1.5-192.168.1.30',
  '192.168.1.5 - 192.168.1.30',
  '192.168.1.5..192.168.1.30',
  '192.168.1.5 to 192.168.1.30',
  '192.168.1.5–192.168.1.30',
  '192.168.1.5—192.168.1.30',
  '192.168.1.5~192.168.1.30',
  '  192.168.1.5  -  192.168.1.30  ',
]) {
  const parsed = R.parseRangeExpression(text);
  check(`"${text}" 解析出的范围`, [dotted(parsed.first), dotted(parsed.last)], expectedRange);
}
check('单个地址按 /32 处理', (() => { const parsed = R.parseRangeExpression('192.168.1.5'); return [dotted(parsed.first), dotted(parsed.last)]; })(), ['192.168.1.5', '192.168.1.5']);
check('单个 CIDR 展开为该块范围', (() => { const parsed = R.parseRangeExpression('192.168.1.0/24'); return [dotted(parsed.first), dotted(parsed.last)]; })(), ['192.168.1.0', '192.168.1.255']);
check('起止可以混用 CIDR 与裸地址', (() => { const parsed = R.parseRangeExpression('10.0.0.0/24 - 10.0.0.5'); return [dotted(parsed.first), dotted(parsed.last)]; })(), ['10.0.0.0', '10.0.0.5']);
check('结束可以是一个 CIDR 的末地址', (() => { const parsed = R.parseRangeExpression('10.0.0.5 - 10.0.0.0/24'); return [dotted(parsed.first), dotted(parsed.last)]; })(), ['10.0.0.5', '10.0.0.255']);
check('.. 与 - 的解析结果相同（关键：单个点不能当分隔符）', JSON.stringify(R.parseRangeExpression('192.168.1.5..192.168.1.30')), JSON.stringify(R.parseRangeExpression('192.168.1.5-192.168.1.30')));
check('CIDR 中的点不会被误当分隔符', R.parseRangeExpression('192.168.1.0/24').first, R.parseIpv4('192.168.1.0'));

console.log('--- splitInputLines / parseRangeList / parseCidrList ---');
check('去掉空行', R.splitInputLines('10.0.0.1\n\n10.0.0.2\n'), ['10.0.0.1', '10.0.0.2']);
check('# 注释被去掉', R.splitInputLines('10.0.0.1 # 注释'), ['10.0.0.1']);
check('// 注释被去掉', R.splitInputLines('10.0.0.1 // 注释'), ['10.0.0.1']);
check('整行注释被丢弃', R.splitInputLines('# 全部注释'), []);
check('首尾空白被裁掉', R.splitInputLines('  10.0.0.1  '), ['10.0.0.1']);
{
  const list = R.parseRangeList(['# 标题', '192.168.1.5-192.168.1.30', '', 'bad-line', '10.0.0.0/24'].join('\n'));
  check('范围列表：成功行数', list.ranges.length, 2);
  check('范围列表：错误行被单独收集而不是中断', list.errors.length, 1);
  check('范围列表：错误行内容', list.errors[0].line, 'bad-line');
  check('范围列表：未被截断', list.truncated, false);
  check('范围列表：CIDR 行展开正确', [dotted(list.ranges[1].first), dotted(list.ranges[1].last)], ['10.0.0.0', '10.0.0.255']);
}
{
  const list = R.parseCidrList(['# 标题', '192.168.1.5/24', '10.0.0.0/8', 'bad', '1.2.3.4/33'].join('\n'));
  check('CIDR 列表：成功块数', list.blocks.length, 2);
  check('CIDR 列表：错误行数', list.errors.length, 2);
  check('CIDR 列表：主机位被丢弃并被报告', list.normalised.length, 1);
  check('CIDR 列表：报告内容', list.normalised[0], { input: '192.168.1.5/24', canonical: '192.168.1.0/24' });
  check('CIDR 列表：规范块不会被报告', list.normalised.some((item) => item.input === '10.0.0.0/8'), false);
}
{
  const many = Array.from({ length: 2100 }, (_, index) => `10.0.${Math.floor(index / 256)}.${index % 256}/32`);
  const list = R.parseRangeList(many.join('\n'));
  check('范围列表超过 2000 行被截断', list.truncated, true);
  check('范围列表截断到 MAX_INPUT_LINES', list.ranges.length, R.MAX_INPUT_LINES);
  const cidrs = R.parseCidrList(many.join('\n'));
  check('CIDR 列表超过 2000 行被截断', cidrs.truncated, true);
  check('CIDR 列表截断到 MAX_INPUT_LINES', cidrs.blocks.length, R.MAX_INPUT_LINES);
}

console.log(`\n${passed}/${passed + failed} passed${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
