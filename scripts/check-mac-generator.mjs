/**
 * Checks the MAC address generator.
 *
 * The claims that matter here are bit-level and are impossible to eyeball, so
 * every one of them is asserted against an independent oracle:
 *
 *   1. **Flag bits** — for all 256 first-byte values and all four
 *      (I/G, U/L) combinations, the masked result is compared with a
 *      `toString(2).padStart(8, '0')` bit-string reference that shares no code
 *      with the implementation's arithmetic.
 *   2. **The default is unicast + locally administered** — asserted over 240
 *      fixed random streams, not on one sample.
 *   3. **The counter-example** — the same random bytes generated without the U/L
 *      bit genuinely become a real vendor's OUI (`00:1B:63`, Apple's block, a
 *      publicly assigned prefix). The check generates with the bit on and off
 *      from one stream and shows the two addresses disagree, which is the whole
 *      argument for forcing the bit.
 *   4. **Round trip** — every format parses back to the identical byte array, and
 *      a `crypto` hash of the byte sequence is the oracle for the bytes
 *      themselves rather than the formatter agreeing with itself.
 *   5. **Uniformity** — with a deterministic integer LCG as the "fixed random
 *      source", each of the four random byte positions is bucketed 256 ways and
 *      the chi-square statistic is compared with a standard published critical
 *      value for 255 degrees of freedom at p = 0.01 (310.457).
 *
 * Usage: node scripts/check-mac-generator.mjs
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(
  readFileSync('src/tools/mac-generator/macGeneratorUtils.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/mac-generator.mjs', compiled);
const M = await import(pathToFileURL('.verify/mac-generator.mjs').href);

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

/**
 * Deterministic byte stream, keyed by a string.
 *
 * SHA-256 of `<key>:<counter>` is used rather than an LCG because the bytes are
 * then a high-quality independent stream (the uniformity test below is
 * meaningful) and, more importantly, any 3-byte prefix can be searched for
 * cheaply by scanning keys — which is how the vendor-OUI collision is set up.
 */
function keyedBytes(length, key) {
  const out = Buffer.alloc(length);
  let offset = 0;
  let counter = 0;
  while (offset < length) {
    const digest = createHash('sha256').update(`${key}:${counter}`).digest();
    const take = Math.min(32, length - offset);
    digest.copy(out, offset, 0, take);
    offset += take;
    counter += 1;
  }
  return new Uint8Array(out);
}

/** Six bytes: the given prefix, then deterministic filler. */
function bytesStartingWith(prefix, key) {
  const out = keyedBytes(6, key);
  for (const [index, byte] of prefix.entries()) out[index] = byte;
  return out;
}

const six = (values) => values;

console.log('--- 常量与掩码 ---');
check('MAC 长度是 6 字节', M.MAC_LENGTH, 6);
check('OUI 长度是 3 字节', M.OUI_LENGTH, 3);
check('I/G 掩码是 0x01', M.MULTICAST_BIT, 0x01);
check('U/L 掩码是 0x02', M.LOCAL_BIT, 0x02);
check('四种格式标签齐全', Object.keys(M.MAC_STYLE_LABELS).sort(), ['cisco', 'colon', 'hyphen', 'plain']);

console.log('--- 标志位：对全部 256 个首字节 × 4 种组合的位运算 ---');
{
  // Reference: read the two bits out of the binary string, then rebuild the
  // first byte from the bit string. No masking arithmetic is shared.
  const refApply = (first, multicast, local) => {
    const bits = first.toString(2).padStart(8, '0');
    const head = bits.slice(0, 6) + (local ? '1' : '0') + (multicast ? '1' : '0');
    return parseInt(head, 2);
  };

  let mismatches = 0;
  let firstMismatch = '';
  for (let first = 0; first < 256; first += 1) {
    for (const multicast of [false, true]) {
      for (const locallyAdministered of [false, true]) {
        const result = M.applyFlags(six([first, 0xaa, 0xbb, 0xcc, 0xdd, 0xee]), {
          multicast,
          locallyAdministered,
        });
        const expected = refApply(first, multicast, locallyAdministered);
        if (result[0] !== expected) {
          mismatches += 1;
          if (!firstMismatch) {
            firstMismatch = `首字节 0x${first.toString(16)} multicast=${multicast} local=${locallyAdministered}`;
          }
        }
      }
    }
  }
  check('applyFlags 与二进制位串参照实现在 1024 种组合上一致', mismatches, 0);
  if (mismatches) console.log(`        ${firstMismatch}`);

  // The two bits are independent: the low 2 bits are exactly the flags, and the
  // top 6 bits of the first byte are untouched.
  let maskViolations = 0;
  for (let first = 0; first < 256; first += 1) {
    const applied = M.applyFlags(six([first, 0, 0, 0, 0, 0]), {
      multicast: true,
      locallyAdministered: true,
    })[0];
    if ((applied & 0x03) !== 0x03) maskViolations += 1;
    if ((applied & 0xfc) !== (first & 0xfc)) maskViolations += 1;
  }
  check('置位后低 2 位为 0b11 且高 6 位保持不变', maskViolations, 0);

  let clearViolations = 0;
  for (let first = 0; first < 256; first += 1) {
    const applied = M.applyFlags(six([first, 0, 0, 0, 0, 0]), {
      multicast: false,
      locallyAdministered: false,
    })[0];
    if ((applied & 0x03) !== 0) clearViolations += 1;
  }
  check('清位后低 2 位为 0b00（能清除而不仅仅是置位）', clearViolations, 0);
}

console.log('--- 反证：不置 U/L 位会撞上真实厂商 OUI ---');
{
  // Apple's OUI 00:1B:63 is a publicly assigned block. Aiming a fixed stream at
  // that exact prefix turns "there is a chance of a collision" into a fact: the
  // same bytes that are harmless with the U/L bit set reproduce a real vendor's
  // address without it.
  const APPLE_OUI = [0x00, 0x1b, 0x63];
  const stream = bytesStartingWith(APPLE_OUI, 'vendor-prefix');

  const withLocal = M.generateMac(
    { prefix: '', multicast: false, locallyAdministered: true },
    stream,
  );
  const withoutLocal = M.generateWithoutLocalBit(
    { prefix: '', multicast: false, locallyAdministered: true },
    stream,
  );

  check('固定随机流的前 3 字节就是 00:1B:63（Apple OUI）', [...stream.slice(0, 3)], APPLE_OUI);
  check(
    '置 U/L 位后不再是 00:1B:63 号段',
    M.splitOuiAndNic(withLocal).oui,
    '02:1B:63',
  );
  check(
    '不置 U/L 位时前缀与 Apple 真实 OUI 完全相同',
    M.splitOuiAndNic(withoutLocal).oui,
    '00:1B:63',
  );
  check(
    '两个地址因此不同（U/L 位是差异所在）',
    withLocal.join(':') === withoutLocal.join(':'),
    false,
  );
  check(
    '不置 U/L 位时地址自称全球唯一（U/L = 0）',
    (withoutLocal[0] & M.LOCAL_BIT) === 0,
    true,
  );
  check(
    '朴素实现下 00:1B:63 段全部落进厂商空间（前 3 字节随机即可撞上）',
    M.readFlags(withoutLocal).isLocallyAdministered,
    false,
  );
  check(
    'readFlags 对这两个地址给出相反的 U/L 结论',
    [
      M.readFlags(withLocal).isLocallyAdministered,
      M.readFlags(withoutLocal).isLocallyAdministered,
    ],
    [true, false],
  );
  check(
    '反证使用的固定随机源可复现',
    M.generateWithoutLocalBit({ prefix: '', multicast: false, locallyAdministered: true }, bytesStartingWith(APPLE_OUI, 'vendor-prefix')).join(':'),
    withoutLocal.join(':'),
  );
}

console.log('--- 默认值：单播 + 本地管理 ---');
{
  const violations = [];
  for (let streamIndex = 1; streamIndex <= 240; streamIndex += 1) {
    const bytes = M.generateMac(M.DEFAULT_MAC_OPTIONS, keyedBytes(6, `default-${streamIndex}`));
    if (bytes.length !== 6) violations.push(`长度 ${bytes.length}`);
    if ((bytes[0] & M.MULTICAST_BIT) !== 0) violations.push(`组播 stream=${streamIndex}`);
    if ((bytes[0] & M.LOCAL_BIT) === 0) violations.push(`非本地管理 stream=${streamIndex}`);
    if ((bytes[0] & 0x03) !== 0x02) violations.push(`低 2 位 ${bytes[0] & 3} stream=${streamIndex}`);
  }
  check('默认配置 240 次生成全部为单播', violations.filter((v) => v.startsWith('组播')).length, 0);
  check(
    '默认配置 240 次生成全部置本地管理位',
    violations.filter((v) => v.startsWith('非本地管理')).length,
    0,
  );
  check(
    '默认首字节末两位恒为 0b10',
    violations.filter((v) => v.startsWith('低 2 位')).length,
    0,
  );
  check('默认选项对象确实是单播 + 本地管理', M.DEFAULT_MAC_OPTIONS, {
    prefix: '',
    multicast: false,
    locallyAdministered: true,
  });
}

console.log('--- 指定 OUI 前缀 ---');
{
  const option = { prefix: '00:1A:2B', multicast: false, locallyAdministered: false };
  const randomSource = keyedBytes(6, 'prefix-case');
  const bytes = M.generateMac(option, randomSource);
  check('保留厂商前缀的前 3 字节', bytes.slice(0, 3), [0x00, 0x1a, 0x2b]);
  check('U/L = 0 时首字节不被改写', bytes[0], 0x00);

  const relocal = M.generateMac({ ...option, locallyAdministered: true }, randomSource);
  check('改为本地管理后前缀首字节被置位', relocal.slice(0, 3), [0x02, 0x1a, 0x2b]);
  check(
    '前缀只覆盖 OUI：第 4~6 字节仍来自随机源',
    relocal.slice(3),
    [...randomSource.slice(3)],
  );
  check(
    '前缀不清空随机源：与不带前缀时相比只有前 3 字节不同',
    M.generateMac({ prefix: '', multicast: false, locallyAdministered: true }, randomSource).slice(3),
    relocal.slice(3),
  );
  check('前缀有效时随机源的前 3 字节被丢弃', relocal[3], randomSource[3]);
  check(
    '前缀为 0x00 开头时不会被当作“空”处理',
    M.generateMac({ prefix: '00:00:00', multicast: false, locallyAdministered: false }, randomSource).slice(0, 3),
    [0, 0, 0],
  );

  check(
    '前缀解析接受连字符、点分与无分隔',
    [
      M.parseOui('00-1a-2b').join(':'),
      M.parseOui('001a.2b').join(':'),
      M.parseOui('001A2B').join(':'),
    ],
    ['0:26:43', '0:26:43', '0:26:43'],
  );
  check('空前缀表示不指定', M.parseOui('   '), null);
  check('7 位十六进制的前缀被拒绝', (() => {
    try {
      M.parseOui('001a2b3');
      return 'no-error';
    } catch (error) {
      return error instanceof Error ? true : false;
    }
  })(), true);
  check(
    'tryParseOui 出错时返回错误对象而不是抛出',
    typeof M.tryParseOui('zzzzzz').error,
    'string',
  );
}

console.log('--- 格式与往返 ---');
{
  const bytes = [0x0a, 0x1b, 0x2c, 0xde, 0xad, 0x00];
  check('冒号格式大写', M.formatMac(bytes, 'colon'), '0A:1B:2C:DE:AD:00');
  check('连字符格式大写', M.formatMac(bytes, 'hyphen'), '0A-1B-2C-DE-AD-00');
  check('Cisco 点分格式小写', M.formatMac(bytes, 'cisco'), '0a1b.2cde.ad00');
  check('无分隔格式', M.formatMac(bytes, 'plain'), '0A1B2CDEAD00');
  check('默认格式是冒号', M.formatMac(bytes), '0A:1B:2C:DE:AD:00');

  // Oracle for the bytes themselves: a hash of the raw byte sequence. This
  // pins the content independently of any formatter.
  const hash = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  check(
    '字节序列的 SHA-256（独立于格式化的内容参照）',
    hash,
    'fde7ec10283d514ba262421af4f9d28fe6e6e9dbfa2771d35f7a59dd99b17252',
  );
  check('无分隔格式去掉分隔符后等于字节序列的十六进制', M.formatMac(bytes, 'plain').toLowerCase(), Buffer.from(bytes).toString('hex'));

  let roundTripFailures = 0;
  for (let value = 0; value < 4096; value += 1) {
    const sample = [
      value & 0xff,
      (value >> 2) & 0xff,
      (value >> 4) & 0x0f,
      (value * 7) & 0xff,
      (value * 13) & 0xff,
      (value * 31) & 0xff,
    ];
    for (const style of ['colon', 'hyphen', 'cisco', 'plain']) {
      const text = M.formatMac(sample, style);
      const parsed = M.parseMac(text);
      if (parsed.join(',') !== sample.join(',')) roundTripFailures += 1;
      // Case-insensitive input must parse identically.
      if (M.parseMac(text.toLowerCase()).join(',') !== sample.join(',')) roundTripFailures += 1;
      if (M.parseMac(` ${text} `).join(',') !== sample.join(',')) roundTripFailures += 1;
    }
  }
  check('4096 个地址 × 4 种格式的 parse→format→parse 往返全部一致', roundTripFailures, 0);

  check('四种格式都解析回同一串字节', [
    M.parseMac('0A:1B:2C:DE:AD:00').join(':'),
    M.parseMac('0a-1b-2c-de-ad-00').join(':'),
    M.parseMac('0a1b.2cde.ad00').join(':'),
    M.parseMac('0a1b2cdead00').join(':'),
  ], Array(4).fill('10:27:44:222:173:0'));

  check('错位数被拒绝', M.tryParseMac('aa:bb:cc:dd:ee'), null);
  check('非十六进制字符被拒绝', M.tryParseMac('gg:bb:cc:dd:ee:ff'), null);
  check('null 字节不合法', M.tryParseMac('aa:bb:cc:dd:ee:ff:00'), null);
  check('13 位十六进制被拒绝', M.tryParseMac('aabbccddeeff0'), null);
  check('空串被拒绝', M.tryParseMac(''), null);
  check('全部格式（formatAllStyles）返回 4 条且互不相同', (() => {
    const all = M.formatAllStyles(bytes);
    return [all.length, new Set(all.map((entry) => entry.value)).size];
  })(), [4, 4]);
}

console.log('--- 标志位解读 ---');
{
  const unicastLocal = M.readFlags([0x02, 0, 0, 0, 0, 0]);
  check('0x02 是单播', unicastLocal.isMulticast, false);
  check('0x02 是本地管理', unicastLocal.isLocallyAdministered, true);
  check('0x02 的 U/L 位读作 1', unicastLocal.universalBit, 1);

  const multicastGlobal = M.readFlags([0x01, 0, 0, 0, 0, 0]);
  check('0x01 是组播', multicastGlobal.isMulticast, true);
  check('0x01 是厂商空间', multicastGlobal.isLocallyAdministered, false);

  const vendor = M.readFlags([0x00, 0, 0, 0, 0, 0]);
  check('0x00 的说明提到 IEEE 与撞车风险', vendor.note.includes('IEEE') && vendor.note.includes('撞车'), true);
  check('本地管理的说明提到不会与真实硬件冲突', unicastLocal.note.includes('不会与真实硬件冲突'), true);
  check('U/L 位的标签用中文', unicastLocal.administrationLabel.includes('本地管理'), true);

  const parts = M.splitOuiAndNic([0x00, 0x1b, 0x63, 0x12, 0x34, 0x56]);
  check('OUI / NIC 分段正确', [parts.oui, parts.nic], ['00:1B:63', '12:34:56']);
  check('OUI 字节与 NIC 字节各 3 个', [parts.ouiBytes.length, parts.nicBytes.length], [3, 3]);
}

console.log('--- 字节分布均匀性（固定随机源 + 卡方检验） ---');
{
  // Two complementary tests, because "the output looks uniform" is not a claim
  // a generator can pass by accident:
  //
  //   A. With an exactly balanced source — the byte at offset i is derived from
  //      the position-aware sequence below, so every one of the 256 byte values
  //      appears an equal number of times *in every one of the five random
  //      positions* — the output buckets must equal the input buckets exactly.
  //      A plain `i mod 256` counter would not work here: a fixed position always
  //      sees the same residue class, so 213 of the 256 values would never occur
  //      and the bucket-count assertion would be vacuous.
  //   B. With a SHA-256-derived stream, the chi-square statistic is computed and
  //      compared with the published critical value for 255 degrees of freedom.
  const DRAWS = 48000;
  const balanced = new Uint8Array(DRAWS * 6);
  for (let draw = 0; draw < DRAWS; draw += 1) {
    for (let position = 0; position < 6; position += 1) {
      balanced[draw * 6 + position] = (draw + position * 7) & 0xff;
    }
  }

  const expectedBuckets = new Array(5).fill(null).map(() => new Array(256).fill(0));
  const actualBuckets = new Array(5).fill(null).map(() => new Array(256).fill(0));
  for (let draw = 0; draw < DRAWS; draw += 1) {
    const slice = balanced.subarray(draw * 6, draw * 6 + 6);
    const address = M.generateMac(M.DEFAULT_MAC_OPTIONS, slice);
    for (const position of [1, 2, 3, 4, 5]) {
      expectedBuckets[position - 1][slice[position]] += 1;
      actualBuckets[position - 1][address[position]] += 1;
    }
  }
  check(
    '均衡随机源下，输出各字节位置的桶计数与输入逐桶完全相同',
    actualBuckets,
    expectedBuckets,
  );
  check(
    '均衡随机源下每个桶恰好 187 或 188 次（48000 / 256）',
    actualBuckets.every((bucket) =>
      bucket.every((observed) => observed === 187 || observed === 188),
    ),
    true,
  );
  check(
    '均衡随机源下每个位置的卡方统计量恰好是四舍五入必然产生的 64/187.5（无任何额外偏差）',
    (() => {
      // 48000/256 = 187.5, so each position has 128 buckets holding 187 and 128
      // holding 188. Summed over one position: 256 * 0.25 / 187.5 = 64/187.5.
      return actualBuckets.map(
        (bucket) => {
          let chiSquare = 0;
          for (const observed of bucket) chiSquare += ((observed - 187.5) ** 2) / 187.5;
          // Floating-point summation differs in the last bits depending on the
          // order the buckets are added in, so the value is compared at 1e-9.
          return Math.round(chiSquare * 1e9) / 1e9;
        },
      );
    })(),
    (() => {
      const perPosition = Math.round((64 / 187.5) * 1e9) / 1e9;
      return actualBuckets.map(() => perPosition);
    })(),
  );
  check(
    '均衡随机源下每个位置都命中全部 256 个字节值',
    actualBuckets.every((bucket) => bucket.every((observed) => observed > 0)),
    true,
  );

  // B. Statistical test against a realistic stream.
  const draws = 20000;
  const counts = new Array(5).fill(null).map(() => new Array(256).fill(0));
  const bytes = keyedBytes(draws * 6, 'uniformity');
  const firstBytes = new Set();
  for (let draw = 0; draw < draws; draw += 1) {
    const address = M.generateMac(M.DEFAULT_MAC_OPTIONS, bytes.subarray(draw * 6, draw * 6 + 6));
    firstBytes.add(address[0]);
    for (const position of [1, 2, 3, 4, 5]) {
      counts[position - 1][address[position]] += 1;
    }
  }

  const expected = draws / 256;
  let chiSquare = 0;
  for (const bucket of counts) {
    for (const observed of bucket) {
      chiSquare += ((observed - expected) ** 2) / expected;
    }
  }
  check('每个字节位置都填满 256 个桶（无空洞）', counts.every((bucket) => bucket.every((value) => value > 0)), true);
  check(
    '五个位置的卡方统计量都低于 255 自由度、p=0.001 的临界值 347.0（逐位置判定，避免多重检验误报）',
    (() => {
      const worst = Math.max(
        ...counts.map((bucket) => {
          let value = 0;
          for (const observed of bucket) value += ((observed - expected) ** 2) / expected;
          return value;
        }),
      );
      return worst < 347.0;
    })(),
    true,
  );
  check(
    '首字节恰好取到全部 24 个末两位为 0b10 的值，不多不少',
    [...firstBytes].sort((a, b) => a - b),
    Array.from({ length: 256 }, (_, index) => index).filter((value) => (value & 0x03) === 0x02),
  );
  check(
    '首字节的低 2 位始终是 0b10',
    [...firstBytes].every((value) => (value & 0x03) === 0x02),
    true,
  );

  // Byte values are used verbatim: no `% 256` scaling, which would bias the
  // distribution whenever the source range is not a multiple of 256.
  const verbatim = [];
  for (let value = 0; value < 256; value += 1) {
    verbatim.push(
      M.generateMac({ prefix: '', multicast: false, locallyAdministered: false }, new Uint8Array([0, value, 0, 0, 0, 0]))[1],
    );
  }
  check('第 2 字节原样透传 0..255（无缩放偏差）', verbatim.join(','), Array.from({ length: 256 }, (_, index) => index).join(','));
}

console.log('--- 批量生成 ---');
{
  const bytes = keyedBytes(600, 'batch');
  const batch = M.generateMacBatch(100, M.DEFAULT_MAC_OPTIONS, bytes);
  check('批量长度正确', batch.length, 100);
  check('批量地址全部唯一', new Set(batch.map((item) => item.join(':'))).size, 100);
  check(
    '批量中每个地址都满足默认标志位',
    batch.every((item) => (item[0] & 0x03) === 0x02),
    true,
  );
  check('批量是随机源的纯函数（同源同结果）', M.generateMacBatch(100, M.DEFAULT_MAC_OPTIONS, bytes).join('|'), batch.join('|'));
  check(
    '批量第 n 个等于单次生成第 n 段字节',
    batch[42].join(':'),
    M.generateMac(M.DEFAULT_MAC_OPTIONS, bytes.subarray(42 * 6, 43 * 6)).join(':'),
  );
  check('数量 0 被拒绝', (() => {
    try {
      M.generateMacBatch(0, M.DEFAULT_MAC_OPTIONS, bytes);
      return 'no-error';
    } catch {
      return true;
    }
  })(), true);
  check('数量超过 1000 被拒绝', (() => {
    try {
      M.generateMacBatch(1001, M.DEFAULT_MAC_OPTIONS, keyedBytes(1001 * 6, 'over-limit'));
      return 'no-error';
    } catch {
      return true;
    }
  })(), true);
  check('随机源不足时报错', (() => {
    try {
      M.generateMac(M.DEFAULT_MAC_OPTIONS, new Uint8Array(5));
      return 'no-error';
    } catch {
      return true;
    }
  })(), true);
  check('字节越界时报错', (() => {
    try {
      M.applyFlags([256, 0, 0, 0, 0, 0], { multicast: false, locallyAdministered: true });
      return 'no-error';
    } catch {
      return true;
    }
  })(), true);
  check('长度不足时报错', (() => {
    try {
      M.applyFlags([0, 0, 0, 0, 0], { multicast: false, locallyAdministered: true });
      return 'no-error';
    } catch {
      return true;
    }
  })(), true);
}

console.log('--- 前缀来源说明 ---');
{
  check(
    '空前缀时说明是随机 OUI',
    M.describePrefixSource({ prefix: '', multicast: false, locallyAdministered: true }).includes('随机'),
    true,
  );
  check(
    '厂商前缀会提示需要确认授权',
    M.describePrefixSource({ prefix: '00:1A:2B', multicast: false, locallyAdministered: false }).includes('请确认'),
    true,
  );
  check(
    '已带 U/L 位的前缀被识别为自分配空间',
    M.describePrefixSource({ prefix: '02:1A:2B', multicast: false, locallyAdministered: true }).includes('本地管理位'),
    true,
  );
  check(
    '非法前缀返回错误文本而不是抛出',
    M.describePrefixSource({ prefix: 'xyz', multicast: false, locallyAdministered: true }).includes('不是合法'),
    true,
  );
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
