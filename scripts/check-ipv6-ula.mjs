/**
 * Checks the IPv6 ULA generator.
 *
 * Three independent references are used, because "it looks right" is not a test:
 *
 *   1. **RFC 5952's own examples**, rule by rule. Two naive compressors are
 *      implemented here on purpose and shown to give the wrong answer on the
 *      RFC's boundary cases, which is what proves those assertions have teeth.
 *   2. **Node's WHATWG URL parser** as a native IPv6 serialiser. `new URL()`
 *      implements RFC 5952 compression for bracketed host literals, so every
 *      zero-pattern is compared against a implementation written by someone
 *      else, plus a second hand-written state-machine compressor in this file.
 *   3. **node:crypto's SHA-1** for the RFC 4193 §3.2.2 derivation, alongside the
 *      FIPS/RFC 3174 published test vectors, and the RFC 4193 §3.2.3 collision
 *      table for the probability formula.
 *
 * Usage: node scripts/check-ipv6-ula.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(readFileSync('src/tools/ipv6-ula/ipv6UlaUtils.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/ipv6-ula.mjs', compiled);
const M = await import(pathToFileURL('.verify/ipv6-ula.mjs').href);

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

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const sha1Hex = (data) => createHash('sha1').update(data).digest('hex');
const bytesFromHex = (text) => Uint8Array.from(Buffer.from(text, 'hex'));

function seededBytes(seed) {
  let state = seed >>> 0;
  const next = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state & 0xff;
  };
  return (length) => {
    const out = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) out[index] = next();
    return out;
  };
}

// ---------------------------------------------------------------------------
// Two deliberately naive compressors, to prove the checks can fail.
//
// Both encapsulate a plausible-looking idea that RFC 5952 §4.2 rules out:
// "compress the first run of zeros you find" and "compress any zero run".
// ---------------------------------------------------------------------------

/** Renders a group list where -1 marks the elided run as text. */
function renderNaive(parts) {
  return parts.map((group) => (group === -1 ? '' : group.toString(16))).join(':');
}

/** Naive #1: the first run of two or more zeros wins, however short it is. */
function naiveFirstRunWins(groups) {
  for (let index = 0; index + 1 < groups.length; index += 1) {
    if (groups[index] === 0 && groups[index + 1] === 0) {
      let end = index;
      while (end < groups.length && groups[end] === 0) end += 1;
      return renderNaive([...groups.slice(0, index), -1, ...groups.slice(end)]);
    }
  }
  return renderNaive(groups);
}

/** Naive #2: the first zero group wins, even when it stands alone. */
function naiveAnyZeroRun(groups) {
  const index = groups.indexOf(0);
  if (index === -1) return renderNaive(groups);
  let end = index;
  while (end < groups.length && groups[end] === 0) end += 1;
  return renderNaive([...groups.slice(0, index), -1, ...groups.slice(end)]);
}

/** Independent #3: a state-machine builder that emits tokens, not slices. */
function tokenCompress(groups) {
  const part = (value) => value.toString(16);
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let index = 0; index <= groups.length; index += 1) {
    const isZero = index < groups.length && groups[index] === 0;
    if (isZero) {
      if (runStart === -1) runStart = index;
      continue;
    }
    if (runStart !== -1) {
      const length = index - runStart;
      if (length > bestLength) {
        bestLength = length;
        bestStart = runStart;
      }
      runStart = -1;
    }
  }
  if (bestLength < 2) return groups.map(part).join(':');
  if (bestLength === 8) return '::';
  const tokens = [];
  for (let index = 0; index < groups.length; index += 1) {
    if (index === bestStart) {
      tokens.push('');
      // A run touching either end of the address needs a second empty token,
      // because there is no neighbouring group to supply the other colon.
      if (bestStart === 0 || bestStart + bestLength === groups.length) tokens.push('');
      index += bestLength - 1;
      continue;
    }
    tokens.push(part(groups[index]));
  }
  return tokens.join(':');
}

/** The native serialiser: WHATWG URL brackets IPv6 hosts in compressed form. */
function urlCompress(groups) {
  const full = groups.map((group) => group.toString(16)).join(':');
  return new URL(`http://[${full}]/`).hostname.replace(/^\[|\]$/g, '');
}

console.log('--- SHA-1：FIPS 180-1 / RFC 3174 测试向量 ---');
{
  check('空串', hex(M.sha1(new Uint8Array(0))), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  check(
    '"abc"',
    hex(M.sha1(new TextEncoder().encode('abc'))),
    'a9993e364706816aba3e25717850c26c9cd0d89d',
  );
  const long = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
  check(
    '56 字节的双块消息',
    hex(M.sha1(new TextEncoder().encode(long))),
    '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
  );
  check(
    '100 万个 "a"',
    hex(M.sha1(new TextEncoder().encode('a'.repeat(1_000_000)))),
    '34aa973cd4c4daa4f61eeb2bdbad27316534016f',
  );

  // Padding boundaries: 55/56/57 and 63/64/65 bytes are where a hand-written
  // implementation gets the length field or the extra block wrong.
  let mismatches = 0;
  const lengths = [];
  for (let length = 0; length <= 300; length += 1) lengths.push(length);
  for (const length of [511, 512, 513, 1000, 4096, 10000]) lengths.push(length);
  for (const length of lengths) {
    const message = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) message[index] = (index * 37 + 11) & 0xff;
    if (hex(M.sha1(message)) !== sha1Hex(message)) mismatches += 1;
  }
  check(`与 node:crypto 在 ${lengths.length} 种长度（0–300 及 511/512/513/1000/4096/10000）上完全一致`, mismatches, 0);

  check('摘要长度恒为 20 字节', M.sha1(new Uint8Array(3)).length, 20);
}

console.log('--- MAC 转 EUI-64（RFC 4291 附录 A） ---');
{
  check('RFC 4291 的示例：34-56-78-9A-BC-DE -> 36-56-78-FF-FE-9A-BC-DE', hex(M.parseEui64('34-56-78-9A-BC-DE')), '365678fffe9abcde');
  check('冒号写法与连字符写法等价', hex(M.parseEui64('34:56:78:9a:bc:de')), hex(M.parseEui64('34-56-78-9A-BC-DE')));
  check('无分隔符写法等价', hex(M.parseEui64('3456789abcde')), '365678fffe9abcde');
  check('u 位被翻转：0x34 -> 0x36', hex(M.macToEui64(bytesFromHex('3456789abcde'))).slice(0, 2), '36');
  check('0x00 开头翻转后是 0x02', hex(M.macToEui64(bytesFromHex('001122334455'))), '021122fffe334455');
  check('0x02 开头翻转后是 0x00（翻转是异或，不是置位）', hex(M.macToEui64(bytesFromHex('021122334455'))), '001122fffe334455');
  check('已经是 8 字节的 EUI-64 原样使用', hex(M.parseEui64('02:11:22:ff:fe:33:44:55')), '021122fffe334455');

  const bad = ['', '34-56-78-9A-BC', 'zz:56:78:9a:bc:de', '34:56:78:9a:bc:de:00'];
  check(
    '长度或字符非法的输入一律抛 UlaError',
    bad.map((text) => {
      try {
        M.parseEui64(text);
        return 'no-throw';
      } catch (error) {
        return error instanceof M.UlaError ? 'UlaError' : 'other';
      }
    }),
    bad.map(() => 'UlaError'),
  );
}

console.log('--- NTP 时间戳 ---');
{
  check('Unix 纪元对应 NTP 秒 2208988800', M.toNtpTimestamp(0), { seconds: 2208988800, fraction: 0 });
  check('+1 秒', M.toNtpTimestamp(1000), { seconds: 2208988801, fraction: 0 });
  check('+500 毫秒正好是小数部分的一半', M.toNtpTimestamp(500).fraction, 2147483648);
  check('+1 毫秒的定点近似', M.toNtpTimestamp(1).fraction, 4294967);
  check('小数秒不取整为 0', M.toNtpTimestamp(999).fraction > 0, true);
  check(
    'NTP 字节序是大端（秒在前）',
    hex(M.ntpToBytes({ seconds: 0x01020304, fraction: 0x05060708 })),
    '0102030405060708',
  );
  check('1900 年之前抛错', (() => {
    try {
      M.toNtpTimestamp(-(M.NTP_EPOCH_OFFSET_SECONDS * 1000 + 1));
      return 'no-throw';
    } catch (error) {
      return error instanceof M.UlaError ? 'UlaError' : 'other';
    }
  })(), 'UlaError');
  check('NTP 纪元偏移量为 2208988800 秒', M.NTP_EPOCH_OFFSET_SECONDS, 2208988800);

  // The display path converts back to Unix time; it must land on the same
  // millisecond, or the timestamp shown next to a derived prefix would be a
  // different instant from the one that went into the hash.
  let roundTripFailures = 0;
  for (let step = 0; step < 2000; step += 1) {
    const epochMs = 1_000_000_000_000 + step * 86_399_991;
    const back = M.ntpToEpochMs(M.toNtpTimestamp(epochMs));
    if (Math.floor(back) !== epochMs) roundTripFailures += 1;
  }
  check('NTP 时间戳换算回 UNIX 毫秒后仍落在同一毫秒（2000 个取值）', roundTripFailures, 0);
}

console.log('--- RFC 4193 §3.2.2：时间 + EUI-64 -> SHA-1 -> 最低 40 位 ---');
{
  const ntp = M.toNtpTimestamp(1735689600123);
  const eui = M.parseEui64('34-56-78-9A-BC-DE');
  const key = M.deriveKey(ntp, eui);
  const expectedKey = Buffer.concat([Buffer.from(M.ntpToBytes(ntp)), Buffer.from(eui)]);
  check('哈希输入 = NTP 时间戳（8 字节）‖ EUI-64（8 字节），共 16 字节', hex(key), expectedKey.toString('hex'));

  const digest = createHash('sha1').update(Buffer.from(key)).digest();
  const lastFive = Uint8Array.from(digest.subarray(15, 20));
  const firstFive = Uint8Array.from(digest.subarray(0, 5));
  const cleared = Uint8Array.from(lastFive);
  cleared[0] &= ~0x02 & 0xff;

  const result = M.globalIdFromTimeAndEui64(ntp, eui);
  check('全局 ID 等于 node:crypto 摘要的最后 5 字节（并清除 u 位）', hex(result.bytes), hex(cleared));
  check('清除 u 位前的原始值等于摘要最后 5 字节', hex(result.raw), hex(lastFive));
  check('推导模式标记为真，并回传所用的 NTP 时间戳', [result.derived, result.ntp.seconds], [true, ntp.seconds]);
  check('回传的哈希输入与手工拼接一致', hex(result.key), expectedKey.toString('hex'));
  check('回传的 SHA-1 摘要与 node:crypto 一致', hex(result.digest), digest.toString('hex'));
  check('随机路径不带哈希输入与摘要', [M.globalIdFromBytes(bytesFromHex('103456789a')).key, M.globalIdFromBytes(bytesFromHex('103456789a')).digest], [null, null]);
  check(
    '取摘要前 5 字节会得到不同结果（证明"最低 40 位"这条断言确实在起作用）',
    hex(firstFive) === hex(result.bytes),
    false,
  );

  // The same derivation over a range of timestamps and identifiers, still
  // cross-checked against node:crypto rather than against itself.
  let mismatches = 0;
  let uBitClearedCount = 0;
  for (let step = 0; step < 200; step += 1) {
    const when = M.toNtpTimestamp(1_600_000_000_000 + step * 1234567);
    const id = M.parseEui64(
      `${((step * 7) % 256).toString(16).padStart(2, '0')}:11:22:33:44:55`,
    );
    const reference = createHash('sha1')
      .update(Buffer.concat([Buffer.from(M.ntpToBytes(when)), Buffer.from(id)]))
      .digest()
      .subarray(15, 20);
    const referenceCleared = Uint8Array.from(reference);
    referenceCleared[0] &= ~0x02 & 0xff;
    const produced = M.globalIdFromTimeAndEui64(when, id);
    if (hex(produced.bytes) !== Buffer.from(referenceCleared).toString('hex')) mismatches += 1;
    if (produced.uBitCleared) uBitClearedCount += 1;
  }
  check('200 组时间 + EUI-64 与 node:crypto 的推导逐字节一致', mismatches, 0);
  check('其中确实有一半左右的原始摘要 u 位为 1（说明清除逻辑真的被执行过）', uBitClearedCount > 60 && uBitClearedCount < 140, true);
}

console.log('--- u 位（掩码 0x02）断言与反例 ---');
{
  const raw = bytesFromHex('123456789a');
  check('反例：原始值 0x12 的 u 位（0x02）为 1', M.hasUbitSet(raw), true);
  const cleared = M.withUbitCleared(raw);
  check('清除后首字节为 0x10（0x12 & ~0x02）', hex(cleared), '103456789a');
  check('清除后的值 u 位为 0', M.hasUbitSet(cleared), false);
  check('withUbitCleared 不修改入参', hex(raw), '123456789a');
  check('本来 u 位为 0 的值不会被改动', hex(M.withUbitCleared(bytesFromHex('103456789a'))), '103456789a');

  const generated = M.globalIdFromBytes(raw);
  check('随机路径也会清除 u 位，并如实报告', [hex(generated.bytes), generated.uBitCleared, hex(generated.raw)], ['103456789a', true, '123456789a']);
  const clean = M.globalIdFromBytes(bytesFromHex('103456789a'));
  check('u 位原本为 0 时不报告"已清除"', [hex(clean.bytes), clean.uBitCleared], ['103456789a', false]);

  let uBitViolations = 0;
  const source = seededBytes(0xc0ffee);
  for (let round = 0; round < 500; round += 1) {
    if (M.hasUbitSet(M.globalIdFromBytes(source(5)).bytes)) uBitViolations += 1;
  }
  check('500 次随机生成，全局 ID 的 u 位始终为 0', uBitViolations, 0);

  check('长度不对的全局 ID 一律抛 UlaError', (() => {
    try {
      M.hasUbitSet(new Uint8Array(4));
      return 'no-throw';
    } catch (error) {
      return error instanceof M.UlaError ? 'UlaError' : 'other';
    }
  })(), 'UlaError');
}

console.log('--- 前缀与地址拼装 ---');
{
  const globalId = bytesFromHex('103456789a');
  const zeroIid = new Uint8Array(8);
  const base = M.buildUlaAddress(globalId, 0, zeroIid);
  check('/48 站点前缀', M.formatPrefix(base, 48), 'fd10:3456:789a::/48');
  check(
    'u 位为 1 的全局 ID（如任务文案里的 fd12:…）会被拼装函数拒绝，而不是被悄悄改写',
    (() => {
      try {
        M.buildUlaAddress(bytesFromHex('123456789a'), 0, zeroIid);
        return 'no-throw';
      } catch (error) {
        return error instanceof M.UlaError ? 'UlaError' : 'other';
      }
    })(),
    'UlaError',
  );
  check(
    '同一批 40 位经 globalIdFromBytes 规范化后得到 fd10:3456:789a::/48',
    M.formatPrefix(M.buildUlaAddress(M.globalIdFromBytes(bytesFromHex('123456789a')).bytes, 0, zeroIid), 48),
    'fd10:3456:789a::/48',
  );
  check('/64 子网前缀（子网 1）', M.formatPrefix(M.buildUlaAddress(globalId, 1, zeroIid), 64), 'fd10:3456:789a:1::/64');
  check('/64 子网前缀（子网 0xabcd）', M.formatPrefix(M.buildUlaAddress(globalId, 0xabcd, zeroIid), 64), 'fd10:3456:789a:abcd::/64');

  const iid = bytesFromHex('021a2b3c4d5e6f70');
  const full = M.buildUlaAddress(globalId, 1, iid);
  check('完整地址（压缩形式）', M.compressIpv6(full), 'fd10:3456:789a:1:21a:2b3c:4d5e:6f70');
  check('完整地址（不压缩形式）', M.formatIpv6Full(full), 'fd10:3456:789a:1:21a:2b3c:4d5e:6f70');
  check('完整地址（补零形式）', M.formatIpv6Padded(full), 'fd10:3456:789a:0001:021a:2b3c:4d5e:6f70');
  check('首字节是 FD（FC00::/7 且 L=1）', full[0], 0xfd);
  check('全局 ID 落在第 1–5 字节', hex(full.subarray(1, 6)), '103456789a');
  check('子网 ID 落在第 6–7 字节（大端）', hex(full.subarray(6, 8)), '0001');
  check('接口 ID 落在第 8–15 字节', hex(full.subarray(8, 16)), '021a2b3c4d5e6f70');

  check('地址始终落在 fd00::/8 内（fc00::/7 且 L=1）', M.planUla(M.globalIdFromBytes(globalId), 3, iid).inUlaRange, true);
  check('子网 ID 越界抛 UlaError', (() => {
    try {
      M.buildUlaAddress(globalId, 65536, zeroIid);
      return 'no-throw';
    } catch (error) {
      return error instanceof M.UlaError ? 'UlaError' : 'other';
    }
  })(), 'UlaError');
  check('前缀长度越界抛 UlaError', (() => {
    try {
      M.formatPrefix(base, 129);
      return 'no-throw';
    } catch (error) {
      return error instanceof M.UlaError ? 'UlaError' : 'other';
    }
  })(), 'UlaError');
}

console.log('--- RFC 5952 第 4 节：逐条规则 ---');
{
  const groups = (text) => M.groupsOf(M.parseIpv6(text));
  const compress = (text) => M.compressGroups(groups(text));

  // §4.1 leading zeros MUST be suppressed; a single all-zero field is "0".
  check('§4.1 省略前导零', compress('2001:0db8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  check('§4.1 单个全零字段写作 0', compress('2001:db8:0:1:1:1:1:1'), '2001:db8:0:1:1:1:1:1');
  check('§4.1 十六进制小写（§4.3）', compress('2001:DB8:0:1:1:1:1:1'), '2001:db8:0:1:1:1:1:1');

  // §4.2.1 "::" must be used to its maximum capability.
  check('§4.2.1 最长连续零组全部压缩', compress('2001:db8:0:0:0:0:2:1'), '2001:db8::2:1');
  check('§4.2.1 不接受 2001:db8::0:1 这种没压到底的写法', compress('2001:db8:0:0:0:0:0:1'), '2001:db8::1');

  // §4.2.2 a single zero field MUST NOT be compressed.
  check('§4.2.2 单个零组不压缩（RFC 原文例子）', compress('2001:db8:0:1:1:1:1:1'), '2001:db8:0:1:1:1:1:1');
  check('§4.2.2 朴素写法会错误地压成 2001:db8::1:1:1:1:1', naiveAnyZeroRun(groups('2001:db8:0:1:1:1:1:1')), '2001:db8::1:1:1:1:1');
  check('§4.2.2 朴素写法的结果是错的（与本实现不同）', naiveAnyZeroRun(groups('2001:db8:0:1:1:1:1:1')) === compress('2001:db8:0:1:1:1:1:1'), false);

  // §4.2.3 longest run wins; ties go to the leftmost.
  check('§4.2.3 RFC 原文例子 2001:0:0:1:0:0:0:1 压缩后面那组三个零', compress('2001:0:0:1:0:0:0:1'), '2001:0:0:1::1');
  check('§4.2.3 朴素"第一段零优先"写法会压错成 2001::1:0:0:0:1', naiveFirstRunWins(groups('2001:0:0:1:0:0:0:1')), '2001::1:0:0:0:1');
  check('§4.2.3 朴素"第一段零优先"的结果是错的（与本实现不同）', naiveFirstRunWins(groups('2001:0:0:1:0:0:0:1')) === compress('2001:0:0:1:0:0:0:1'), false);
  check('§4.2.3 长度相同时压缩最左边那组（RFC 原文例子）', compress('2001:db8:0:0:1:0:0:1'), '2001:db8::1:0:0:1');

  // Whole-address edge cases.
  check('全零地址写作 ::', compress('0:0:0:0:0:0:0:0'), '::');
  check('回环地址 ::1', compress('0:0:0:0:0:0:0:1'), '::1');
  check('只有最后一组非零', compress('0:0:0:0:0:0:0:abcd'), '::abcd');
  check('前七组为零且末组为零以外', compress('0:0:0:0:0:0:1:0'), '::1:0');
  check('末尾连续零组', compress('fd10:3456:789a:0:0:0:0:0'), 'fd10:3456:789a::');
  check('开头连续零组', compress('0:0:0:0:0:0:0:1'), '::1');
  check('中间两组零压缩', compress('fd10:0:0:789a:1:2:3:4'), 'fd10::789a:1:2:3:4');
  check('没有零组时不出现 ::', compress('1:2:3:4:5:6:7:8'), '1:2:3:4:5:6:7:8');
  check('压缩输出中 :: 最多出现一次', [...['2001:db8:0:0:1:0:0:1', '2001:0:0:1:0:0:0:1', '0:0:0:0:0:0:0:0', '1:2:3:4:5:6:7:8']].map((text) => (compress(text).match(/::/g) ?? []).length <= 1), [true, true, true, true]);
}

console.log('--- RFC 5952：全部 256 种零组分布，与 Node 原生解析器 + 第二份独立实现比对 ---');
{
  let urlMismatch = 0;
  let tokenMismatch = 0;
  let roundTripFailures = 0;
  let uppercaseFound = 0;
  let overlongGroupFound = 0;

  for (let mask = 0; mask < 256; mask += 1) {
    // Non-zero groups get distinct values so a mis-ordered join is visible.
    const groups = [...Array(8).keys()].map((index) =>
      (mask >> (7 - index)) & 1 ? 0 : 0x1000 + index * 0x0111 + 1,
    );
    const bytes = M.bytesOf(groups);
    const mine = M.compressIpv6(bytes);
    if (mine !== urlCompress(groups)) urlMismatch += 1;
    if (mine !== tokenCompress(groups)) tokenMismatch += 1;
    const parsed = M.parseIpv6(mine);
    if (parsed === null || hex(parsed) !== hex(bytes)) roundTripFailures += 1;
    if (/[A-F]/.test(mine)) uppercaseFound += 1;
    if (mine.split(':').some((part) => part.length > 4)) overlongGroupFound += 1;
  }
  check('256 种零组分布与 Node 的 WHATWG URL 序列化结果完全一致', urlMismatch, 0);
  check('256 种零组分布与第二份独立实现（token 状态机）完全一致', tokenMismatch, 0);
  check('256 种分布压缩后再解析都能还原（往返回环）', roundTripFailures, 0);
  check('输出中没有大写十六进制字母', uppercaseFound, 0);
  check('输出中没有超过 4 位的组', overlongGroupFound, 0);

  // Random addresses, including the ULA shape and fully random 128-bit values.
  let randomMismatch = 0;
  const source = seededBytes(0x5eed);
  for (let round = 0; round < 20000; round += 1) {
    const bytes = source(16);
    const groups = M.groupsOf(bytes);
    if (M.compressIpv6(bytes) !== urlCompress(groups)) randomMismatch += 1;
  }
  check('20000 个随机 128 位地址与 Node 原生序列化结果完全一致', randomMismatch, 0);

  let ulaMismatch = 0;
  for (let round = 0; round < 5000; round += 1) {
    const globalId = M.globalIdFromBytes(source(5));
    const bytes = M.buildUlaAddress(globalId.bytes, source(2)[0] * 256 + source(2)[0], source(8));
    if (M.compressIpv6(bytes) !== urlCompress(M.groupsOf(bytes))) ulaMismatch += 1;
  }
  check('5000 个随机 ULA 地址与 Node 原生序列化结果完全一致', ulaMismatch, 0);
}

console.log('--- IPv6 解析的边界与非法输入 ---');
{
  const valid = [
    '::',
    '::1',
    '1::',
    'fd10:3456:789a::1',
    '0:0:0:0:0:0:0:0',
    'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    'FD10:3456:789A:0001:021A:2B3C:4D5E:6F70',
  ];
  check('合法写法都能解析', valid.every((text) => M.parseIpv6(text) !== null), true);
  check('大写会被规范化', hex(M.parseIpv6('FD10:3456:789A::')), hex(M.parseIpv6('fd10:3456:789a::')));
  check('两边都能展开', hex(M.parseIpv6('1:2::3:4')), '00010002000000000000000000030004');

  const invalid = [
    '1:2:3:4:5:6:7',            // 只有 7 组且没有 ::
    '1:2:3:4:5:6:7:8:9',        // 9 组
    '1::2::3',                  // 两个 ::
    ':::',                      // 三个冒号
    '1:2:3:4:5:6:7:',           // 结尾多一个冒号
    ':1:2:3:4:5:6:7',           // 开头多一个冒号
    '12345::',                  // 组超过 4 位
    'gggg::',                   // 非十六进制字符
    '',                         // 空串
    '1:2:3:4:5:6:7:8::',        // :: 没有可代表的组
    '::ffff:192.0.2.1',         // 内嵌 IPv4 形式本工具不支持
  ];
  check(
    '非法写法一律返回 null',
    invalid.map((text) => M.parseIpv6(text)),
    invalid.map(() => null),
  );
}

console.log('--- 随机接口 ID ---');
{
  const source = seededBytes(0xabcdef);
  let violations = 0;
  for (let round = 0; round < 300; round += 1) {
    // The interface identifier's own u bit must be cleared, for the same reason
    // as the Global ID's: a random identifier is locally administered.
    const id = M.randomInterfaceId(source(8));
    if ((id[0] & 0x02) !== 0) violations += 1;
  }
  check('300 个随机接口 ID 的 u 位（掩码 0x02）始终为 0', violations, 0);
  check(
    '入参首字节 u 位为 1 时会被清掉（反例：0x02 -> 0x00）',
    M.randomInterfaceId(bytesFromHex('0212345678901234'))[0],
    0x00,
  );
  check(
    'u 位本来就是 0 的首字节不受影响（0x10 -> 0x10）',
    hex(M.randomInterfaceId(bytesFromHex('1034567890123456'))).slice(0, 2),
    '10',
  );
  check('随机接口 ID 长度恒为 8 字节', M.randomInterfaceId(source(8)).length, 8);
  check('入参非法长度抛 UlaError', (() => {
    try {
      M.randomInterfaceId(new Uint8Array(4));
      return 'no-throw';
    } catch (error) {
      return error instanceof M.UlaError ? 'UlaError' : 'other';
    }
  })(), 'UlaError');
}

console.log('--- RFC 4193 §3.2.3：碰撞概率表 ---');
{
  const table = [
    [2, '1.81e-12'],
    [10, '4.54e-11'],
    [100, '4.54e-09'],
    [1000, '4.54e-07'],
    [10000, '4.54e-05'],
  ];
  check(
    '40 位全局 ID 的概率与 RFC 4193 表格逐行一致（截断到 3 位有效数字）',
    table.map(([n]) => M.formatCollisionProbability(n, 40)),
    table.map(([, text]) => text),
  );
  check('概率随互联数量单调递增', [2, 10, 100, 1000, 10000].every((n, index, all) => index === 0 || M.collisionProbability(n, 40) > M.collisionProbability(all[index - 1], 40)), true);
  check('清除 u 位后只有 39 位随机，碰撞概率约为 40 位的两倍', Math.abs(M.collisionProbability(10000, 39) / M.collisionProbability(10000, 40) - 2) < 0.001, true);
  check('零/负数互联数量抛 UlaError', (() => {
    try {
      M.collisionProbability(0, 40);
      return 'no-throw';
    } catch (error) {
      return error instanceof M.UlaError ? 'UlaError' : 'other';
    }
  })(), 'UlaError');
  check('概率为 0 时格式化为 "0"', M.formatProbability(0), '0');
}

console.log('--- 全局 ID 的文本形式与 planUla ---');
{
  check('格式化 10 位小写十六进制', M.formatGlobalId(bytesFromHex('103456789a')), '103456789a');
  check('解析冒号写法', hex(M.parseGlobalId('10:34:56:78:9a')), '103456789a');
  check('解析 0x 前缀写法', hex(M.parseGlobalId('0x103456789a')), '103456789a');
  check('长度不对抛 UlaError', (() => {
    try {
      M.parseGlobalId('103456789');
      return 'no-throw';
    } catch (error) {
      return error instanceof M.UlaError ? 'UlaError' : 'other';
    }
  })(), 'UlaError');

  const ntp = M.toNtpTimestamp(1735689600123);
  const derived = M.globalIdFromTimeAndEui64(ntp, M.parseEui64('34-56-78-9A-BC-DE'));
  const plan = M.planUla(derived, 0x0001, bytesFromHex('021a2b3c4d5e6f70'));

  // The prefix strings are parsed back rather than compared to a hand-built
  // string: a hand-built one would have to guess how the compressor elides the
  // trailing zeros, which is the very thing under test.
  const siteBytes = M.parseIpv6(plan.sitePrefix.split('/')[0]);
  const subnetBytes = M.parseIpv6(plan.subnetPrefix.split('/')[0]);
  check('planUla 的 /48 前缀前 6 字节 = 0xFD + 全局 ID', hex(siteBytes.subarray(0, 6)), `fd${M.formatGlobalId(plan.globalId)}`);
  check('planUla 的 /48 前缀其余 10 字节为 0', hex(siteBytes.subarray(6)), '00'.repeat(10));
  check('planUla 的 /48 以 ::/48 结尾', plan.sitePrefix.endsWith('::/48'), true);
  check('planUla 的 /64 第 7–8 字节是子网 ID（大端 0001）', hex(subnetBytes.subarray(6, 8)), '0001');
  check('planUla 的 /64 其余 8 字节为 0', hex(subnetBytes.subarray(8)), '00'.repeat(8));
  check('planUla 的 /64 以 ::/64 结尾', plan.subnetPrefix.endsWith('::/64'), true);
  check('planUla 的完整地址与手工拼装一致', plan.address, M.compressIpv6(M.buildUlaAddress(derived.bytes, 1, bytesFromHex('021a2b3c4d5e6f70'))));
  check('planUla 的完整地址能解析回同样的 16 字节', hex(M.parseIpv6(plan.address)), hex(M.buildUlaAddress(derived.bytes, 1, bytesFromHex('021a2b3c4d5e6f70'))));
  check('没有接口 ID 时不给出完整地址', M.planUla(derived, 0, null).address, null);
  check('planUla 报告 u 位与推导来源', [plan.uBitCleared, plan.derived, plan.ntp !== null], [derived.uBitCleared, true, true]);
  check('planUla 的补零形式与完整形式长度一致', [plan.addressPadded.split(':').length, plan.addressFull.split(':').length], [8, 8]);
}

console.log('--- 子网 ID 文本解析 ---');
{
  check('纯数字按十进制（10 是十，不是十六）', M.parseSubnetId('10'), 10);
  check('0x 前缀按十六进制', M.parseSubnetId('0x10'), 16);
  check('含字母按十六进制', M.parseSubnetId('abcd'), 0xabcd);
  check('大写十六进制', M.parseSubnetId('0xABCD'), 0xabcd);
  check('0 是合法子网 ID', M.parseSubnetId('0'), 0);
  check('上界 65535', M.parseSubnetId('65535'), 65535);
  check('0xffff', M.parseSubnetId('0xffff'), 65535);
  const invalid = ['', '-1', '65536', '0x10000', 'abcde', 'zz', '12 34'];
  check(
    '非法子网 ID 一律抛 UlaError',
    invalid.map((text) => {
      try {
        M.parseSubnetId(text);
        return 'no-throw';
      } catch (error) {
        return error instanceof M.UlaError ? 'UlaError' : 'other';
      }
    }),
    invalid.map(() => 'UlaError'),
  );
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
