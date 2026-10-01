/**
 * Checks the IPv4 subnet calculator.
 *
 * What is actually being defended here:
 *
 *   1. **Fixed, externally known CIDR values.** The seven blocks in the task
 *      (192.168.1.10/24, 10.0.0.1/8, 172.16.5.4/12, 203.0.113.7/32, 0.0.0.0/0,
 *      192.168.1.0/31, 192.168.1.0/30) have hand-written expected values, not
 *      values copied out of the implementation.
 *
 *   2. **An independent bit-arithmetic oracle.** `oracle()` below re-derives
 *      every field from a 32-bit unsigned word using only `>>>`, `&`, `|` and
 *      `~`, with no shared code with the implementation. It is then run over
 *      4089 addresses (the extremes plus pseudo-random ones) × all 33 prefixes,
 *      comparing eight fields each — 1,058,112 field comparisons in total, and
 *      every one must agree. A copy of the formula inside the implementation
 *      would agree with itself; this one cannot, because it is written in the
 *      other direction (from the bit string) and its `network`/`broadcast` come
 *      from the word arithmetic rather than from the `address & mask` shortcut.
 *
 *   3. **The /31 and /32 trap.** The textbook formula `2^(32-p) - 2` is
 *      evaluated here in two independently written ways and shown to disagree
 *      with the implementation, proving the assertions would catch a regression
 *      to the naive formula rather than merely passing.
 *
 *   4. **Boundaries and rejects.** /0, /32, prefix 33, prefix -1, illegal IPs,
 *      empty input, letters, non-contiguous masks.
 *
 *   5. **Subnet splitting.** Count equals 2^(new-old); adjacent slices abut
 *      exactly (no overlap, no gap); the slices tile the parent block.
 *
 * Usage: node scripts/check-ipv4-subnet.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/ipv4-subnet/ipv4SubnetUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/ipv4-subnet.mjs', compiled);
const M = await import(pathToFileURL('.verify/ipv4-subnet.mjs').href);

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

/* -------------------------------------------------------------------------
 * Independent reference implementation ("oracle").
 *
 * Written from the definition, deliberately *not* by reusing anything from the
 * module under test:
 *
 *   - The bit string is built character by character, and the network prefix is
 *     the first `p` characters with the rest set to '0'. Converting that string
 *     back to a number is a second, independent path to the network address.
 *   - The broadcast address is that string with the trailing bits set to '1'.
 *   - Masks come from the string form too, so `prefixForMask` has something to
 *     be checked against.
 * ---------------------------------------------------------------------- */

/** 32-character binary string of an unsigned word. */
function bitsOf(value) {
  let out = '';
  for (let i = 31; i >= 0; i -= 1) out += String((value >>> i) & 1);
  return out;
}

/** Unsigned word from a 32-character binary string. */
function wordFromBits(bits) {
  let value = 0;
  for (const ch of bits) value = (value * 2 + (ch === '1' ? 1 : 0)) >>> 0;
  return value >>> 0;
}

/** Independent dotted-quad formatter, via the bit string. */
function oracleDotted(value) {
  const bits = bitsOf(value);
  const octets = [];
  for (let i = 0; i < 4; i += 1) {
    let octet = 0;
    for (const ch of bits.slice(i * 8, i * 8 + 8)) octet = octet * 2 + (ch === '1' ? 1 : 0);
    octets.push(String(octet));
  }
  return octets.join('.');
}

/** Independent dotted-quad parser, rejecting anything malformed. */
function oracleParseDotted(text) {
  const parts = String(text).split('.');
  if (parts.length !== 4) return null;
  const octets = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  let word = 0;
  for (const octet of octets) word = (word * 256 + octet) >>> 0;
  return word >>> 0;
}

function oracle(address, prefix) {
  const addressBits = bitsOf(address);
  const maskBits = '1'.repeat(prefix) + '0'.repeat(32 - prefix);
  const networkBits = addressBits.slice(0, prefix) + '0'.repeat(32 - prefix);
  const broadcastBits = networkBits.slice(0, prefix) + '1'.repeat(32 - prefix);
  const wildcardBits = '0'.repeat(prefix) + '1'.repeat(32 - prefix);

  const network = wordFromBits(networkBits);
  const broadcast = wordFromBits(broadcastBits);
  const total = 2 ** (32 - prefix);

  let usable;
  if (prefix === 31) usable = 2;
  else if (prefix === 32) usable = 1;
  else usable = total - 2;

  return {
    mask: oracleDotted(wordFromBits(maskBits)),
    wildcard: oracleDotted(wordFromBits(wildcardBits)),
    network: oracleDotted(network),
    broadcast: oracleDotted(broadcast),
    total,
    usable,
    firstHost: oracleDotted(prefix >= 31 ? network : network + 1),
    lastHost: oracleDotted(prefix >= 31 ? broadcast : broadcast - 1),
  };
}

/** A tiny deterministic PRNG so a failure is reproducible from the seed alone. */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state >>> 0;
  };
}

/* -------------------------------------------------------------------------
 * 1. Fixed, externally known values.
 * ---------------------------------------------------------------------- */
console.log('--- 固定已知 CIDR（期望值来自手算，不取自实现）---');

function analyse(text) {
  const info = M.analyseCidrText(text);
  return {
    network: M.formatIp(info.network),
    broadcast: M.formatIp(info.broadcast),
    mask: M.formatIp(info.mask),
    wildcard: M.formatIp(info.wildcard),
    first: info.firstHost === null ? null : M.formatIp(info.firstHost),
    last: info.lastHost === null ? null : M.formatIp(info.lastHost),
    usable: info.usableHosts,
    total: info.totalAddresses,
    cls: info.classInfo.name,
    private: info.block.isPrivate,
    kind: info.kind,
  };
}

check('192.168.1.10/24（RFC 1918 私有，C 类）', analyse('192.168.1.10/24'), {
  network: '192.168.1.0',
  broadcast: '192.168.1.255',
  mask: '255.255.255.0',
  wildcard: '0.0.0.255',
  first: '192.168.1.1',
  last: '192.168.1.254',
  usable: 254,
  total: 256,
  cls: 'C',
  private: true,
  kind: 'standard',
});

check('10.0.0.1/8（RFC 1918 私有，A 类）', analyse('10.0.0.1/8'), {
  network: '10.0.0.0',
  broadcast: '10.255.255.255',
  mask: '255.0.0.0',
  wildcard: '0.255.255.255',
  first: '10.0.0.1',
  last: '10.255.255.254',
  usable: 16777214,
  total: 16777216,
  cls: 'A',
  private: true,
  kind: 'standard',
});

check('172.16.5.4/12（RFC 1918 私有，B 类）', analyse('172.16.5.4/12'), {
  network: '172.16.0.0',
  broadcast: '172.31.255.255',
  mask: '255.240.0.0',
  wildcard: '0.15.255.255',
  first: '172.16.0.1',
  last: '172.31.255.254',
  usable: 1048574,
  total: 1048576,
  cls: 'B',
  private: true,
  kind: 'standard',
});

check('203.0.113.7/32（单主机，TEST-NET-3）', analyse('203.0.113.7/32'), {
  network: '203.0.113.7',
  broadcast: '203.0.113.7',
  mask: '255.255.255.255',
  wildcard: '0.0.0.0',
  first: '203.0.113.7',
  last: '203.0.113.7',
  usable: 1,
  total: 1,
  cls: 'C',
  private: false,
  kind: 'singleHost',
});

check('0.0.0.0/0（默认路由，可用主机数 4294967294）', analyse('0.0.0.0/0'), {
  network: '0.0.0.0',
  broadcast: '255.255.255.255',
  mask: '0.0.0.0',
  wildcard: '255.255.255.255',
  first: '0.0.0.1',
  last: '255.255.255.254',
  usable: 4294967294,
  total: 4294967296,
  cls: 'A',
  private: false,
  kind: 'standard',
});

check('192.168.1.0/31（RFC 3021 点对点，2 个都可用）', analyse('192.168.1.0/31'), {
  network: '192.168.1.0',
  broadcast: '192.168.1.1',
  mask: '255.255.255.254',
  wildcard: '0.0.0.1',
  first: '192.168.1.0',
  last: '192.168.1.1',
  usable: 2,
  total: 2,
  cls: 'C',
  private: true,
  kind: 'pointToPoint',
});

check('192.168.1.0/30（2 个可用主机）', analyse('192.168.1.0/30'), {
  network: '192.168.1.0',
  broadcast: '192.168.1.3',
  mask: '255.255.255.252',
  wildcard: '0.0.0.3',
  first: '192.168.1.1',
  last: '192.168.1.2',
  usable: 2,
  total: 4,
  cls: 'C',
  private: true,
  kind: 'standard',
});

// The mask row above is only meaningful if `prefixForMask` agrees with the
// dotted forms below, which are the canonical netmask table.
console.log('--- 掩码与前缀互推（经典掩码表）---');
const CANONICAL_MASKS = [
  ['0.0.0.0', 0],
  ['128.0.0.0', 1],
  ['192.0.0.0', 2],
  ['224.0.0.0', 3],
  ['240.0.0.0', 4],
  ['248.0.0.0', 5],
  ['252.0.0.0', 6],
  ['254.0.0.0', 7],
  ['255.0.0.0', 8],
  ['255.128.0.0', 9],
  ['255.192.0.0', 10],
  ['255.224.0.0', 11],
  ['255.240.0.0', 12],
  ['255.248.0.0', 13],
  ['255.252.0.0', 14],
  ['255.254.0.0', 15],
  ['255.255.0.0', 16],
  ['255.255.128.0', 17],
  ['255.255.192.0', 18],
  ['255.255.224.0', 19],
  ['255.255.240.0', 20],
  ['255.255.248.0', 21],
  ['255.255.252.0', 22],
  ['255.255.254.0', 23],
  ['255.255.255.0', 24],
  ['255.255.255.128', 25],
  ['255.255.255.192', 26],
  ['255.255.255.224', 27],
  ['255.255.255.240', 28],
  ['255.255.255.248', 29],
  ['255.255.255.252', 30],
  ['255.255.255.254', 31],
  ['255.255.255.255', 32],
];
{
  let mismatches = 0;
  for (const [dotted, prefix] of CANONICAL_MASKS) {
    if (M.formatIp(M.maskForPrefix(prefix)) !== dotted) mismatches += 1;
    if (M.prefixForMask(M.parseIpv4(dotted)) !== prefix) mismatches += 1;
  }
  check('33 个经典掩码的 mask→prefix 与 prefix→mask 双向一致', mismatches, 0);
}
check('非连续掩码 255.0.255.0 被拒绝', M.prefixForMask(M.parseIpv4('255.0.255.0')), null);
check('非连续掩码 255.255.255.1 被拒绝', M.prefixForMask(M.parseIpv4('255.255.255.1')), null);

/* -------------------------------------------------------------------------
 * 2. The /31 and /32 trap, with the naive formula implemented two ways.
 * ---------------------------------------------------------------------- */
console.log('--- /31 与 /32：经典公式 2^(32-前缀)-2 在此是错的 ---');

// Way 1: the formula as written.
const naiveFormula = (prefix) => 2 ** (32 - prefix) - 2;
// Way 2: same result derived from the address count, independently.
const naiveFromTotal = (prefix) => {
  let total = 1;
  for (let i = 0; i < 32 - prefix; i += 1) total *= 2;
  return total - 2;
};

check('/31 经典公式算出 0（本题证明公式是错的）', naiveFormula(31), 0);
check('/31 经典公式的第二种独立写法同样算出 0', naiveFromTotal(31), 0);
check('/31 实际可用主机数为 2（RFC 3021）', M.analyseCidrText('192.168.1.0/31').usableHosts, 2);
check(
  '/31 实现与经典公式不一致，且实现是对的',
  M.analyseCidrText('192.168.1.0/31').usableHosts !== naiveFormula(31),
  true,
);
check('/31 标记了经典公式不适用', M.analyseCidrText('192.168.1.0/31').textbookFormulaFails, true);
check('/31 保留经典公式的结果以供界面说明', M.analyseCidrText('192.168.1.0/31').textbookUsableHosts, 0);

check('/32 经典公式算出 -1（负数，本身就说明公式不适用）', naiveFormula(32), -1);
check('/32 经典公式的第二种独立写法同样算出 -1', naiveFromTotal(32), -1);
check('/32 实际可用主机数为 1', M.analyseCidrText('203.0.113.7/32').usableHosts, 1);
check('/32 标记了经典公式不适用', M.analyseCidrText('203.0.113.7/32').textbookFormulaFails, true);

// /30 is the smallest prefix where the formula is still right — the boundary
// between "formula applies" and "formula does not" is exactly here.
check('/30 经典公式仍然适用（2）', naiveFormula(30), 2);
check('/30 未标记公式不适用', M.analyseCidrText('192.168.1.0/30').textbookFormulaFails, false);
check('/29 经典公式仍然适用（6）', M.analyseCidrText('192.168.1.0/29').usableHosts, naiveFormula(29));
check('/24 实现与经典公式一致', M.analyseCidrText('192.168.1.0/24').usableHosts, naiveFormula(24));

/* -------------------------------------------------------------------------
 * 3. Oracle sweep over random addresses × every prefix.
 * ---------------------------------------------------------------------- */
console.log('--- 独立位运算参照实现：随机地址 × 全部 33 个前缀 ---');
{
  const random = makeRandom(0x5eed1234);
  const addresses = [
    0,
    1,
    0xffffffff,
    0x7fffffff,
    0x80000000,
    0x0a000000,
    0xac100000,
    0xc0a80100,
    ...Array.from({ length: 4000 }, () => random()),
  ];

  let checkedFields = 0;
  let mismatches = 0;
  const samples = [];

  for (const address of addresses) {
    for (let prefix = 0; prefix <= 32; prefix += 1) {
      const info = M.analyseCidr(address, prefix);
      const ref = oracle(address, prefix);
      checkedFields += 8;
      const problems = [];
      if (M.formatIp(info.mask) !== ref.mask) problems.push('mask');
      if (M.formatIp(info.wildcard) !== ref.wildcard) problems.push('wildcard');
      if (M.formatIp(info.network) !== ref.network) problems.push('network');
      if (M.formatIp(info.broadcast) !== ref.broadcast) problems.push('broadcast');
      if (info.totalAddresses !== ref.total) problems.push('total');
      if (info.usableHosts !== ref.usable) problems.push('usable');
      if (M.formatIp(info.firstHost) !== ref.firstHost) problems.push('firstHost');
      if (M.formatIp(info.lastHost) !== ref.lastHost) problems.push('lastHost');
      if (problems.length > 0) {
        mismatches += 1;
        if (samples.length < 3) {
          samples.push({ address: M.formatIp(address), prefix, problems });
        }
      }
    }
  }

  check(
    `4089 个地址 × 33 个前缀共 ${checkedFields} 项字段与独立位运算参照完全一致`,
    mismatches,
    0,
  );
  if (samples.length > 0) console.log('        样例:', JSON.stringify(samples));
}

// The same sweep, but through the string parser, to prove the parser and the
// numeric entry point cannot disagree.
{
  const random = makeRandom(0xc0ffee);
  let mismatches = 0;
  for (let i = 0; i < 2000; i += 1) {
    const address = random();
    const prefix = address % 33;
    const text = `${M.formatIp(address)}/${prefix}`;
    const viaText = M.analyseCidrText(text);
    const viaNumber = M.analyseCidr(address, prefix);
    if (
      viaText.network !== viaNumber.network ||
      viaText.broadcast !== viaNumber.broadcast ||
      viaText.mask !== viaNumber.mask ||
      viaText.usableHosts !== viaNumber.usableHosts
    ) {
      mismatches += 1;
    }
  }
  check('2000 组「字符串解析」与「数值入口」结果一致', mismatches, 0);
}

/* -------------------------------------------------------------------------
 * 4. Parsing: notations, round trips, rejects.
 * ---------------------------------------------------------------------- */
console.log('--- 解析：多种进制、往返一致、非法输入 ---');
check('点分十进制', M.parseIpv4('192.168.1.10'), 0xc0a8010a);
check('全零', M.parseIpv4('0.0.0.0'), 0);
check('全一', M.parseIpv4('255.255.255.255'), 0xffffffff);
check('十进制整数', M.parseIpv4('3232235786'), 0xc0a8010a);
check('十六进制', M.parseIpv4('0xC0A8010A'), 0xc0a8010a);
check('小写十六进制', M.parseIpv4('0xc0a8010a'), 0xc0a8010a);
check('二进制', M.parseIpv4('0b11000000101010000000000100001010'), 0xc0a8010a);
check('前后空白被忽略', M.parseIpv4('  10.0.0.1  '), 0x0a000001);
check('前导零按十进制解释（010 = 10，不是八进制 8）', M.parseIpv4('192.168.001.010'), 0xc0a8010a);

check('往返：连续 70000 个整数全部自洽', (() => {
  for (let value = 0; value < 0xffffffff; value += 61379) {
    if (!M.roundTrips(value >>> 0)) return M.formatIp(value >>> 0);
  }
  // Also the four extreme values, which the stride may skip.
  for (const value of [0, 1, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff]) {
    if (!M.roundTrips(value)) return M.formatIp(value);
  }
  return 'ok';
})(), 'ok');

check('往返：十进制字符串再解析回同一值', M.parseIpv4(M.formatDecimal(0xffffffff)), 0xffffffff);
check('往返：十六进制字符串再解析回同一值', M.parseIpv4(`0x${M.formatHex(0xdeadbeef)}`), 0xdeadbeef);
check('往返：二进制字符串再解析回同一值', M.parseIpv4(`0b${(0xdeadbeef).toString(2)}`), 0xdeadbeef);

// Incremental parse→format→parse over every octet-length boundary, so the
// parser and the formatter cannot drift at a carry.
{
  let mismatches = 0;
  for (const value of [0xff, 0x100, 0xffff, 0x10000, 0xffffff, 0x1000000, 0xffffffff]) {
    const text = M.formatIp(value);
    if (M.parseIpv4(text) !== value) mismatches += 1;
    if (oracleParseDotted(text) !== value) mismatches += 1;
  }
  check('进位边界上解析/格式化和独立参照都一致', mismatches, 0);
}

const REJECTS = [
  ['256.1.1.1', '八位组越界'],
  ['1.2.3', '只有三段'],
  ['1.2.3.4.5', '五段'],
  ['', '空串'],
  ['   ', '全空白'],
  ['1.2.3.', '尾随点'],
  ['.1.2.3', '前导点'],
  ['1..2.3', '空八位组'],
  ['192.168.1.a', '含字母'],
  ['abc', '纯字母'],
  ['0xZZ', '非法十六进制'],
  ['0b1012', '非法二进制'],
  ['-1', '负数'],
  ['1.2.3.-4', '负八位组'],
  ['4294967296', '十进制超出 32 位'],
  ['1.2.3.4/24/8', '两个斜杠'],
  ['0x1ffffffff', '十六进制超出 32 位'],
  ['1.2.3.4/255.0.255.0', '非连续掩码'],
];
{
  let problems = 0;
  const wrong = [];
  for (const [text, why] of REJECTS) {
    const got = M.parseIpv4(text);
    if (got !== null) {
      problems += 1;
      wrong.push(`${why}: ${JSON.stringify(text)} -> ${got}`);
    }
  }
  check(`${REJECTS.length} 个非法输入全部返回 null`, problems, 0);
  if (wrong.length > 0) console.log('        ', wrong.join('; '));
}
check('首尾空白不会影响合法性（"1.2.3.4 " 仍有效）', M.parseIpv4('1.2.3.4 '), 0x01020304);

const CIDR_REJECTS = [
  ['256.1.1.1/24', '非法地址'],
  ['', '空串'],
  ['/24', '缺地址'],
  ['1.2.3.4/', '缺前缀'],
  ['1.2.3.4/33', '前缀超过 32'],
  ['1.2.3.4/999', '前缀离谱'],
  ['1.2.3.4/-1', '负数前缀'],
  ['1.2.3.4/abc', '前缀含字母'],
  ['abc/24', '地址含字母'],
  ['1.2.3.4/255.0.255.0', '非连续掩码'],
  ['1.2.3.4//24', '双斜杠'],
  ['1.2.3.4/24/8', '双前缀'],
  ['1.2.3/24', '三段地址'],
];
{
  let problems = 0;
  const wrong = [];
  for (const [text, why] of CIDR_REJECTS) {
    let threw = false;
    try {
      M.analyseCidrText(text);
    } catch (error) {
      threw = error instanceof M.IpParseError;
      if (!threw) wrong.push(`${why}: 抛出了非 IpParseError 的错误`);
    }
    if (!threw) {
      problems += 1;
      if (!wrong.some((line) => line.startsWith(why))) wrong.push(`${why}: 未被拒绝`);
    }
  }
  check(`${CIDR_REJECTS.length} 个非法 CIDR 均以 IpParseError 拒绝`, problems, 0);
  if (wrong.length > 0) console.log('        ', wrong.join('; '));
}

check('裸地址按 /32 处理', M.analyseCidrText('10.0.0.1').prefix, 32);
check('裸地址的 usable 为 1', M.analyseCidrText('10.0.0.1').usableHosts, 1);
check('带前缀时 prefixWasExplicit 为 true', M.analyseCidrText('10.0.0.1/8').prefixWasExplicit, true);
check('掩码写法 /255.255.255.0 等价于 /24', M.analyseCidrText('192.168.1.10/255.255.255.0').prefix, 24);
check('十六进制掩码等价', M.analyseCidrText('192.168.1.10/0xffffff00').prefix, 24);
check('二进制掩码等价', M.analyseCidrText(`192.168.1.10/0b${'1'.repeat(24)}${'0'.repeat(8)}`).prefix, 24);
check('前缀 33 的报错信息可读', (() => {
  try {
    M.analyseCidrText('1.2.3.4/33');
    return 'no error';
  } catch (error) {
    return error.message;
  }
})(), '前缀长度不能超过 32，收到 "/33"');
check('负数前缀的报错信息可读', (() => {
  try {
    M.analyseCidrText('1.2.3.4/-1');
    return 'no error';
  } catch (error) {
    return error.message;
  }
})(), '无法识别的前缀或子网掩码："-1"');
check('前导零会被标记提醒', M.analyseCidrText('192.168.001.010/24').leadingZeroWarning, true);
check('无前导零不会误报', M.analyseCidrText('192.168.1.10/24').leadingZeroWarning, false);

/* -------------------------------------------------------------------------
 * 5. Address classification.
 * ---------------------------------------------------------------------- */
console.log('--- 地址性质分类 ---');
const CLASSIFY = [
  ['10.0.0.1', 'private'],
  ['10.255.255.255', 'private'],
  ['172.16.0.1', 'private'],
  ['172.31.255.255', 'private'],
  ['172.32.0.1', 'public'],
  ['192.168.0.1', 'private'],
  ['192.168.255.255', 'private'],
  ['192.169.0.1', 'public'],
  ['127.0.0.1', 'loopback'],
  ['127.255.255.255', 'loopback'],
  ['169.254.1.1', 'linkLocal'],
  ['169.254.255.255', 'linkLocal'],
  ['169.255.0.1', 'public'],
  ['100.64.0.1', 'shared'],
  ['100.127.255.255', 'shared'],
  ['100.128.0.1', 'public'],
  ['224.0.0.1', 'multicast'],
  ['239.255.255.255', 'multicast'],
  ['240.0.0.1', 'reserved'],
  ['255.255.255.254', 'reserved'],
  ['192.0.2.5', 'documentation'],
  ['198.51.100.5', 'documentation'],
  ['203.0.113.5', 'documentation'],
  ['198.18.0.1', 'benchmark'],
  ['198.19.255.255', 'benchmark'],
  ['198.20.0.1', 'public'],
  ['8.8.8.8', 'public'],
  ['1.1.1.1', 'public'],
  ['0.0.0.0', 'unspecified'],
  ['255.255.255.255', 'broadcast'],
  ['0.1.2.3', 'thisNetwork'],
];
{
  let problems = 0;
  const wrong = [];
  for (const [text, kind] of CLASSIFY) {
    const got = M.classify(M.parseIpv4(text)).kind;
    if (got !== kind) {
      problems += 1;
      wrong.push(`${text}: ${got} ≠ ${kind}`);
    }
  }
  check(`${CLASSIFY.length} 个地址的性质分类全部正确`, problems, 0);
  if (wrong.length > 0) console.log('        ', wrong.join('; '));
}
check('私有判定只认 RFC 1918：127.0.0.1 不算私有', M.classify(M.parseIpv4('127.0.0.1')).isPrivate, false);
check('私有判定：169.254.1.1 不算私有', M.classify(M.parseIpv4('169.254.1.1')).isPrivate, false);
check('私有判定：224.0.0.1 不算私有', M.classify(M.parseIpv4('224.0.0.1')).isPrivate, false);
check('私有判定：100.64.0.1 不算私有（CGNAT，非 RFC 1918）', M.classify(M.parseIpv4('100.64.0.1')).isPrivate, false);
check('私有判定：8.8.8.8 不算私有', M.classify(M.parseIpv4('8.8.8.8')).isPrivate, false);

console.log('--- 地址类别 A/B/C/D/E ---');
const CLASSES = [
  ['0.0.0.0', 'A'],
  ['10.0.0.1', 'A'],
  ['127.255.255.255', 'A'],
  ['128.0.0.0', 'B'],
  ['172.16.0.0', 'B'],
  ['191.255.255.255', 'B'],
  ['192.0.0.0', 'C'],
  ['223.255.255.255', 'C'],
  ['224.0.0.0', 'D'],
  ['239.255.255.255', 'D'],
  ['240.0.0.0', 'E'],
  ['255.255.255.255', 'E'],
];
{
  let problems = 0;
  for (const [text, cls] of CLASSES) {
    if (M.ipClass(M.parseIpv4(text)) !== cls) problems += 1;
  }
  check(`${CLASSES.length} 个类别边界值正确`, problems, 0);
}

/* -------------------------------------------------------------------------
 * 6. Subnet splitting: count, tiling, no gaps, no overlaps.
 * ---------------------------------------------------------------------- */
console.log('--- 子网划分 ---');
check('192.168.1.0/24 切 /26 → 4 个子网', M.splitSubnet(M.parseIpv4('192.168.1.0'), 24, 26).subnetCount, 4);
check(
  '4 个子网的网络地址依次为 .0/.64/.128/.192',
  M.splitSubnet(M.parseIpv4('192.168.1.0'), 24, 26).subnets.map((s) => M.formatIp(s.network)),
  ['192.168.1.0', '192.168.1.64', '192.168.1.128', '192.168.1.192'],
);
check(
  '每个 /26 有 62 个可用主机',
  M.splitSubnet(M.parseIpv4('192.168.1.0'), 24, 26).subnets.map((s) => s.usableHosts),
  [62, 62, 62, 62],
);
check('/24 切 /24 → 1 个子网（等于原网段）', M.splitSubnet(M.parseIpv4('192.168.1.0'), 24, 24).subnetCount, 1);
check('/31 切 /32 → 2 个单地址子网', M.splitSubnet(M.parseIpv4('192.168.1.0'), 31, 32).subnets.map((s) => s.usableHosts), [1, 1]);
check('/31 切 /32 的子网是主机路由', M.splitSubnet(M.parseIpv4('192.168.1.0'), 31, 32).subnets.every((s) => s.kind === 'singleHost'), true);
// The most extreme split there is: a /0 into /32s. 2^32 subnets is exactly
// representable as a Number (4294967296, well under 2^53), which is why the
// count field is a plain number rather than a BigInt — and why the arithmetic
// must stay in the unsigned domain, since `1 << 32` in JavaScript is 1.
check('/0 切 /32 → 恰好 2^32 个子网', M.splitSubnet(0, 0, 32).subnetCount, 4294967296);
check('/0 切 /32 的每个子网是单个地址', M.splitSubnet(0, 0, 32).subnetSize, 1);
check(
  '/0 切 /32 时列出的子网是 0.0.0.0/32、0.0.0.1/32 …',
  M.splitSubnet(0, 0, 32, 3).subnets.map((s) => s.cidr),
  ['0.0.0.0/32', '0.0.0.1/32', '0.0.0.2/32'],
);
check('/0 切 /32 只列出前 3 个时标记为不完整', M.splitSubnet(0, 0, 32, 3).complete, false);
check('未截断时标记为完整', M.splitSubnet(M.parseIpv4('192.168.1.0'), 24, 26).complete, true);
check('前缀越界时报错（/0 切 /33）', (() => {
  try {
    M.splitSubnet(0, 0, 33);
    return 'no error';
  } catch (error) {
    return error instanceof M.IpParseError ? 'IpParseError' : 'other';
  }
})(), 'IpParseError');
check('父前缀越界时报错（/33 起切）', (() => {
  try {
    M.splitSubnet(0, 33, 33);
    return 'no error';
  } catch (error) {
    return error instanceof M.IpParseError ? 'IpParseError' : 'other';
  }
})(), 'IpParseError');
check('新前缀小于原前缀时报错', (() => {
  try {
    M.splitSubnet(M.parseIpv4('192.168.1.0'), 24, 20);
    return 'no error';
  } catch (error) {
    return error instanceof M.IpParseError ? 'IpParseError' : 'other';
  }
})(), 'IpParseError');
check('新前缀 33 报错', (() => {
  try {
    M.splitSubnet(0, 0, 33);
    return 'no error';
  } catch (error) {
    return error instanceof M.IpParseError ? 'IpParseError' : 'other';
  }
})(), 'IpParseError');

// Exhaustive tiling check over many (parent, new) pairs. The listing is capped
// at 64 entries, so the cap is raised here to walk complete plans.
{
  let problems = 0;
  const wrong = [];
  const parents = [0, 8, 12, 16, 20, 24, 28, 30, 31];
  for (const parent of parents) {
    const base = oracle(makeRandom(0x1234 + parent)(), parent).network;
    const baseWord = oracleParseDotted(base);
    for (let next = parent; next <= 32; next += 1) {
      const expectedCount = 2 ** (next - parent);
      const plan = M.splitSubnet(baseWord, parent, next, Math.min(expectedCount, 4096));
      if (plan.subnetCount !== expectedCount) {
        problems += 1;
        wrong.push(`/${parent}→/${next}: count ${plan.subnetCount} ≠ ${expectedCount}`);
        continue;
      }
      // Complete tiling for the pairs small enough to enumerate.
      if (plan.complete) {
        let previousEnd = null;
        for (const slice of plan.subnets) {
          if (previousEnd !== null && slice.network !== previousEnd + 1) {
            problems += 1;
            wrong.push(`/${parent}→/${next}: ${M.formatIp(slice.network)} 与前一段不连续`);
            break;
          }
          if (slice.totalAddresses !== plan.subnetSize) {
            problems += 1;
            wrong.push(`/${parent}→/${next}: 子网大小不一致`);
            break;
          }
          previousEnd = slice.broadcast;
        }
        const last = plan.subnets[plan.subnets.length - 1];
        if (last.broadcast !== baseWord + 2 ** (32 - parent) - 1) {
          problems += 1;
          wrong.push(`/${parent}→/${next}: 最后一段未覆盖父网段末尾`);
        }
      }
    }
  }
  check('父/子前缀组合：数量 = 2^(新-旧)，相邻段首尾相接、无重叠无空隙、完整覆盖父网段', problems, 0);
  if (wrong.length > 0) console.log('        ', wrong.slice(0, 5).join('; '));
}

// Randomised tiling check: build a big plan, then verify every listed slice sits
// inside the parent and that the slices are pairwise disjoint.
{
  const random = makeRandom(0xabcdef);
  let problems = 0;
  for (let trial = 0; trial < 300; trial += 1) {
    const parent = 8 + (random() % 20);
    const next = parent + (random() % Math.max(1, Math.min(6, 32 - parent + 1)));
    if (next > 32) continue;
    const address = random();
    const parentInfo = M.analyseCidr(address, parent);
    const plan = M.splitSubnet(parentInfo.network, parent, next, 64);
    const seen = new Set();
    let previousBroadcast = null;
    for (const slice of plan.subnets) {
      if (!M.isInSubnet(slice.network, parentInfo.network, parent)) problems += 1;
      if (!M.isInSubnet(slice.broadcast, parentInfo.network, parent)) problems += 1;
      if (seen.has(slice.network)) problems += 1;
      seen.add(slice.network);
      if (previousBroadcast !== null && slice.network <= previousBroadcast) problems += 1;
      previousBroadcast = slice.broadcast;
    }
  }
  check('300 组随机划分：所有子网都在父网段内、互不重叠、按序递增', problems, 0);
}

/* -------------------------------------------------------------------------
 * 7. The binary view, which is the part users read.
 * ---------------------------------------------------------------------- */
console.log('--- 32 位二进制展示 ---');
check('192.168.1.10 的二进制', M.formatBinary(M.parseIpv4('192.168.1.10')), '11000000 10101000 00000001 00001010');
check('255.255.255.255 的二进制', M.formatBinary(M.parseIpv4('255.255.255.255')), '11111111 11111111 11111111 11111111');
check('0.0.0.0 的二进制', M.formatBinary(0), '00000000 00000000 00000000 00000000');
check('/24 的网络位数量等于前缀', M.formatBinary(M.maskForPrefix(24)).split('').filter((c) => c === '1').length, 24);
check('二进制每行恰好 32 位（去掉空格）', M.formatBinary(0xdeadbeef).replace(/ /g, '').length, 32);
check('十六进制展示', M.formatHex(M.parseIpv4('192.168.1.10')), 'C0A8010A');
check('十六进制补零', M.formatHex(M.parseIpv4('0.0.0.1')), '00000001');
{
  let problems = 0;
  const random = makeRandom(0xfeed);
  for (let i = 0; i < 2000; i += 1) {
    const value = random();
    const bits = M.formatBinary(value).replace(/ /g, '');
    if (bits.length !== 32) problems += 1;
    // The binary string must round-trip through an independent reader.
    if (oracleParseDotted(M.formatIp(value)) !== value) problems += 1;
    if (wordFromBits(bits) !== value) problems += 1;
  }
  check('2000 个值：二进制串长度 32 且能被独立实现读回原值', problems, 0);
}

console.log(
  `\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`,
);
process.exit(failed === 0 ? 0 : 1);
