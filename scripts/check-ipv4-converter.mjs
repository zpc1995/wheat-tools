/**
 * Checks the IPv4 textual-representation converter.
 *
 * Two independent references are used, because "the conversion is right" and
 * "the shorthand is dangerous" are different claims:
 *
 *   1. **CPython's `socket.inet_aton` / `inet_ntoa`** implement the exact
 *      historical semantics this module imitates (decimal, octal and hex parts,
 *      short forms whose last part absorbs the missing bytes). The module's
 *      tolerant parser is compared against it on tens of thousands of generated
 *      spellings, in both directions: every spelling `inet_aton` accepts must
 *      parse to the same 32-bit value, and every spelling it rejects must throw.
 *   2. **Round trips and an independent bit formatter** cover the rest without a
 *      network stack: decimal → each form → decimal must be the identity, and
 *      the dotted form is recomputed with division instead of shifts.
 *
 * The security claim gets its own section. Short forms such as `127.1`,
 * `2130706433` and `010.0.0.1` are SSRF and allow-list bypasses precisely because
 * they denote an address a string filter did not see. Every one of them must be
 * marked `shorthand: true` with a non-null warning, and the strict
 * `parseCanonicalDotted` must reject them.
 *
 * Usage: node scripts/check-ipv4-converter.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/ipv4-converter/ipv4ConverterUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/ipv4-converter.mjs', compiled);
const C = await import(pathToFileURL('.verify/ipv4-converter.mjs').href);

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

/** Deterministic 32-bit xorshift so a failure is reproducible. */
let seed = 0x2545f491;
function nextRandom() {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed;
}

const EDGE_VALUES = [0, 1, 2, 255, 256, 257, 65535, 65536, 65537, 16777215, 16777216, 2130706433, 2147483647, 2147483648, 4294967294, MAX_U32];
function randomValue() {
  return nextRandom() % 4294967296;
}
function sampleValues(count) {
  const out = [...EDGE_VALUES];
  while (out.length < count) out.push(randomValue());
  return out;
}

// ---------------------------------------------------------------------------
// 已知值
// ---------------------------------------------------------------------------

console.log('--- 已知值 ---');
check('0.0.0.0 = 0', C.parseAddress('0.0.0.0').value, 0);
check('255.255.255.255 = 4294967295', C.parseAddress('255.255.255.255').value, MAX_U32);
check('127.0.0.1 = 2130706433', C.parseAddress('127.0.0.1').value, 2130706433);
check('0 → 0.0.0.0', C.toDotted(0), '0.0.0.0');
check('4294967295 → 255.255.255.255', C.toDotted(MAX_U32), '255.255.255.255');
check('2130706433 → 127.0.0.1', C.toDotted(2130706433), '127.0.0.1');
check('toDecimalString', C.toDecimalString(2130706433), '2130706433');
check('toHexString', C.toHexString(2130706433), '0x7f000001');
check('toOctalString', C.toOctalString(2130706433), '017700000001');
check('toBinaryString', C.toBinaryString(2130706433), '01111111000000000000000000000001');
check('toBinaryGrouped', C.toBinaryGrouped(2130706433), '01111111.00000000.00000000.00000001');

// `toHexDotted` once emitted decimal octets behind a 0x prefix (`0x127...` for
// 127.0.0.1), which is 0x127 = 295 and does not parse back. These two pin the
// documented shape and the non-obvious case where an octet is above 0x99.
check('toHexDotted 127.0.0.1', C.toHexDotted(2130706433), '0x7f.0x0.0x0.0x1');
check('toHexDotted 0x0dd0e830（每段都必须是十六进制数字）', C.toHexDotted(0x0dd0e830), '0xd.0xd0.0xe8.0x30');
check('toHexDotted 0', C.toHexDotted(0), '0x0.0x0.0x0.0x0');
check('toHexDotted 4294967295', C.toHexDotted(MAX_U32), '0xff.0xff.0xff.0xff');
check('toOctalDotted 127.0.0.1', C.toOctalDotted(2130706433), '0177.00.00.01');
check('toOctalString 0', C.toOctalString(0), '000000000000');
check('toHexString 0', C.toHexString(0), '0x00000000');
check('toBinaryString 0', C.toBinaryString(0), '0'.repeat(32));

// ---------------------------------------------------------------------------
// 往返：十进制 → 每种形式 → 十进制
// ---------------------------------------------------------------------------

console.log('--- 往返（十进制 → 各形式 → 十进制） ---');
{
  const N = 60_000;
  const values = sampleValues(N);
  const forms = {
    dotted: (v) => C.toDotted(v),
    decimal: (v) => C.toDecimalString(v),
    hex: (v) => C.toHexString(v),
    hexDotted: (v) => C.toHexDotted(v),
    octal: (v) => C.toOctalString(v),
    octalDotted: (v) => C.toOctalDotted(v),
    binary: (v) => C.toBinaryString(v),
    binaryGrouped: (v) => C.toBinaryGrouped(v),
    shorthand: (v) => C.formatShorthand(v),
  };
  const broken = {};
  for (const key of Object.keys(forms)) broken[key] = 0;
  for (const value of values) {
    for (const [key, format] of Object.entries(forms)) {
      let parsed;
      try {
        parsed = C.parseAddress(format(value)).value;
      } catch {
        parsed = null;
      }
      if (parsed !== value) broken[key] += 1;
    }
  }
  for (const [key, count] of Object.entries(broken)) {
    check(`${values.length} 个随机值经 ${key} 形式往返后完全一致`, count, 0);
  }
  check('往返覆盖了全部 9 种形式', Object.keys(broken).length, 9);
}

console.log('--- 独立实现：按除法重算点分形式 ---');
{
  const independentlyFormatted = (v) =>
    [Math.floor(v / 16777216), Math.floor(v / 65536) % 256, Math.floor(v / 256) % 256, v % 256].join('.');
  let mismatches = 0;
  for (const value of sampleValues(60_000)) {
    if (C.toDotted(value) !== independentlyFormatted(value)) mismatches += 1;
  }
  check('toDotted 与"按除法取模"的独立实现完全一致', mismatches, 0);
}

console.log('--- parseCanonicalDotted 与 toDotted 互逆 ---');
{
  let mismatches = 0;
  for (const value of sampleValues(60_000)) {
    if (C.parseCanonicalDotted(C.toDotted(value)) !== value) mismatches += 1;
  }
  check('规范解析与规范格式化在 6 万个值上互逆', mismatches, 0);
  check('规范解析拒绝前导 0', throwsMessage(() => C.parseCanonicalDotted('010.0.0.1')) !== null, true);
  check('规范解析拒绝段数不足', throwsMessage(() => C.parseCanonicalDotted('127.0.0')) !== null, true);
  check('规范解析拒绝超过 255 的段', throwsMessage(() => C.parseCanonicalDotted('256.0.0.1')) !== null, true);
  check('规范解析接受 0.0.0.0', C.parseCanonicalDotted('0.0.0.0'), 0);
}

// ---------------------------------------------------------------------------
// 权威参照物：CPython socket.inet_aton / inet_ntoa
// ---------------------------------------------------------------------------

const PY_SCRIPT = `
import sys, json, socket, struct, ipaddress
data = json.loads(sys.stdin.buffer.read().decode('utf-8'))
res = {}
aton = []
for s in data['aton']:
    try:
        aton.append({'ok': True, 'value': struct.unpack('>I', socket.inet_aton(s))[0]})
    except OSError:
        aton.append({'ok': False})
res['aton'] = aton
res['ntoa'] = [socket.inet_ntoa(struct.pack('>I', v)) for v in data['ntoa']]
flags = []
for v in data['flags']:
    a = ipaddress.IPv4Address(v)
    flags.append({
        'loopback': a.is_loopback,
        'linkLocal': a.is_link_local,
        'multicast': a.is_multicast,
        'unspecified': a.is_unspecified,
        'private': a.is_private,
        'reserved': a.is_reserved,
    })
res['flags'] = flags
print(json.dumps(res))
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

const HAVE_PY = spawnSync('python3', ['-c', 'import socket, ipaddress'], { encoding: 'utf8' }).status === 0;

const CURATED_ACCEPTED = [
  '127.1',
  '0x7f.1',
  '010.0.0.1',
  '0177.0.0.1',
  '2130706433',
  '0x7f000001',
  '017700000001',
  '0.0.0.0',
  '255.255.255.255',
  '127.0.0.1',
  '8.0.0.1',
  '1.2.3',
  '1.2',
  '7',
  '0',
  MAX_U32.toString(),
  '037777777777',
  '0xffffffff',
];
const CURATED_REJECTED = ['', '256.0.0.1', '1.2.3.4.5', '08.0.0.1', '300.1', '1.2.3.256', '0x', '0xgg', '1.2.3.4/24', '-1', '1.-2'];

if (!HAVE_PY) {
  console.log('WARN  未找到可用的 python3，无法以 CPython socket.inet_aton 为参照物');
}
console.log('--- 与 CPython socket.inet_aton 对照 ---');
if (!HAVE_PY) {
  skip('全部以 socket.inet_aton / inet_ntoa 为参照物的断言', 'python3 不可用');
} else {
  const atonInputs = [...CURATED_ACCEPTED, ...CURATED_REJECTED];
  for (const value of sampleValues(4000)) {
    atonInputs.push(
      C.toDotted(value),
      C.toDecimalString(value),
      C.toHexString(value),
      C.toHexDotted(value),
      C.toOctalString(value),
      C.toOctalDotted(value),
      C.formatShorthand(value),
    );
  }
  const flagValues = sampleValues(4000);
  const ntoaValues = sampleValues(4000);
  const batch = runPython(PY_SCRIPT, { aton: atonInputs, ntoa: ntoaValues, flags: flagValues });
  if (!batch.ok) {
    check('python3 参照物批次执行成功', batch.error, null);
  } else {
    const { aton, ntoa, flags } = batch.value;

    // The oracle itself is checked first: if it did not know the historical
    // semantics, the comparison below would be meaningless.
    const referenceValue = (input) => {
      const index = atonInputs.indexOf(input);
      return index === -1 || !aton[index].ok ? null : aton[index].value;
    };
    check('参照物自检：inet_aton("127.1") = 2130706433', referenceValue('127.1'), 2130706433);
    check('参照物自检：inet_aton("010.0.0.1") = 8.0.0.1（八进制段）', referenceValue('010.0.0.1'), 134217729);
    check('参照物自检：inet_aton("127.0.0.1") = 2130706433', referenceValue('127.0.0.1'), 2130706433);
    check('参照物自检：inet_aton("255.255.255.255") = 4294967295', referenceValue('255.255.255.255'), MAX_U32);

    let mismatch = 0;
    let falseAccept = 0;
    let accepted = 0;
    for (let index = 0; index < atonInputs.length; index += 1) {
      const reference = aton[index];
      const input = atonInputs[index];
      let mine = null;
      try {
        mine = C.parseAddress(input).value;
      } catch {
        mine = null;
      }
      if (reference.ok) {
        accepted += 1;
        if (mine !== reference.value) mismatch += 1;
      } else if (mine !== null) {
        falseAccept += 1;
      }
    }
    check(`${atonInputs.length} 个拼写上与 inet_aton 的解析结果完全一致（其中参照物接受 ${accepted} 个）`, mismatch, 0);
    check('参照物拒绝的拼写，本实现也全部拒绝（没有误接受）', falseAccept, 0);
    checkTrue('对照样本量足够大', atonInputs.length > 20_000);

    let ntoaMismatch = 0;
    for (let index = 0; index < ntoaValues.length; index += 1) {
      if (C.toDotted(ntoaValues[index]) !== ntoa[index]) ntoaMismatch += 1;
    }
    check('toDotted 与 inet_ntoa 在 4000 个值上完全一致', ntoaMismatch, 0);

    // Classification cross-check on the flags ipaddress exposes unambiguously.
    let kindMismatch = 0;
    let decided = 0;
    for (let index = 0; index < flagValues.length; index += 1) {
      const flag = flags[index];
      let expected = null;
      if (flag.loopback) expected = 'loopback';
      else if (flag.linkLocal) expected = 'linkLocal';
      else if (flag.multicast) expected = 'multicast';
      else if (flag.unspecified) expected = 'unspecified';
      if (expected === null) continue;
      decided += 1;
      if (C.classifyAddress(flagValues[index]).kind !== expected) kindMismatch += 1;
    }
    check(`CPython ipaddress 能判定的 ${decided} 个地址，分类结果一致`, kindMismatch, 0);
  }
}

// ---------------------------------------------------------------------------
// 简写形式必须被标注为安全风险（SSRF / 白名单绕过）
// ---------------------------------------------------------------------------

console.log('--- 简写形式的安全标注 ---');
const SHORTHANDS = [
  ['127.1', 'short-2', 2130706433],
  ['0x7f.1', 'short-2', 2130706433],
  ['2130706433', 'integer', 2130706433],
  ['0x7f000001', 'hex', 2130706433],
  ['017700000001', 'octal', 2130706433],
  ['0x7f.0x0.0x0.0x1', 'dotted-hex', 2130706433],
  ['010.0.0.1', 'dotted-octal', 134217729],
];
for (const [input, form, value] of SHORTHANDS) {
  const parsed = C.parseAddress(input);
  check(`"${input}" 解析为 ${C.toDotted(value)}`, parsed.value, value);
  check(`"${input}" 被识别为 ${form}`, parsed.form, form);
  check(`"${input}" 被标记为简写（shorthand = true）`, parsed.shorthand, true);
  checkTrue(`"${input}" 带有非空的安全警告`, typeof parsed.warning === 'string' && parsed.warning.length > 0);
  check(`规范解析 parseCanonicalDotted 拒绝 "${input}"`, throwsMessage(() => C.parseCanonicalDotted(input)) !== null, true);
}
check('规范形式 127.0.0.1 不标记为简写', C.parseAddress('127.0.0.1').shorthand, false);
check('规范形式 127.0.0.1 没有警告', C.parseAddress('127.0.0.1').warning, null);
check('规范形式 8.0.0.1 也不是简写', C.parseAddress('8.0.0.1').shorthand, false);
check('八进制段 010.0.0.1 确实不等于 10.0.0.1', C.parseAddress('010.0.0.1').value !== C.parseAddress('10.0.0.1').value, true);
check('八进制段 010.0.0.1 等于 8.0.0.1', C.parseAddress('010.0.0.1').value, C.parseAddress('8.0.0.1').value);

for (const input of ['127.1', '2130706433', '0x7f000001', '017700000001']) {
  checkTrue(`"${input}" 的警告点明 SSRF`, C.parseAddress(input).warning.includes('SSRF'));
}
checkTrue(
  '十六进制段写法的警告点明它来自 inet_aton 且容易被误读',
  C.parseAddress('010.0.0.1').warning.includes('inet_aton'),
);

// 核心危害：宽容解析把整数/简写还原成回环地址，而严格的点分校验根本不会看它。
check('整数写法 2130706433 被还原为回环地址', C.parseAddress('2130706433').dotted, '127.0.0.1');
check('该地址的分类是回环', C.classifyAddress(C.parseAddress('2130706433').value).kind, 'loopback');
check('简写 127.1 被还原为回环地址', C.parseAddress('127.1').dotted, '127.0.0.1');
checkTrue(
  '严格的点分校验会拒绝整数写法，因此"只查点分字符串"的过滤器看不到它',
  throwsMessage(() => C.parseCanonicalDotted('2130706433')) !== null,
);

console.log('--- formatShorthand ---');
check('formatShorthand(127.0.0.1) = "127.1"', C.formatShorthand(2130706433), '127.1');
check('formatShorthand(0) = "0"', C.formatShorthand(0), '0');
check('formatShorthand(255) = "255"', C.formatShorthand(255), '255');
check('首字节为 0 时无法缩短，退化为点分形式', C.formatShorthand(256), '0.0.1.0');
check('末三字节为 0 的边界', C.formatShorthand(0x7f000000), '127.0');
{
  let mismatches = 0;
  for (const value of sampleValues(60_000)) {
    if (C.parseAddress(C.formatShorthand(value)).value !== value) mismatches += 1;
  }
  check('最短简写确实指向同一个地址（6 万个值往返一致，这正是绕过的原理）', mismatches, 0);
}

console.log('--- convertAll 的 unsafe 标注 ---');
{
  const rows = C.convertAll(2130706433);
  check('转换表行数', rows.length, 9);
  check('点分十进制行标记为安全', rows.find((row) => row.key === 'dotted').unsafe, false);
  check(
    '除点分十进制外每一行都标记为不安全（不可粘贴进 URL 或过滤器）',
    rows.filter((row) => row.key !== 'dotted' && row.unsafe !== true).length,
    0,
  );
  check(
    '二进制视图也被标记为不安全（它不是 inet_aton 写法，但同样不该当地址用）',
    rows.find((row) => row.key === 'binary').unsafe,
    true,
  );
  checkTrue(
    '最短简写行的说明点名 SSRF 绕过',
    rows.find((row) => row.key === 'shorthand').note.includes('SSRF'),
  );
  check('转换表 key 唯一', new Set(rows.map((row) => row.key)).size, rows.length);
  check('点分十进制行的值', rows.find((row) => row.key === 'dotted').value, '127.0.0.1');
  check('最短简写行的值', rows.find((row) => row.key === 'shorthand').value, '127.1');
  checkTrue('每一行都有非空标签', rows.every((row) => typeof row.label === 'string' && row.label.length > 0));
}

// ---------------------------------------------------------------------------
// 边界与非法输入
// ---------------------------------------------------------------------------

console.log('--- 边界与非法输入 ---');
check('首尾空白被裁掉', C.parseAddress('  127.0.0.1\t').value, 2130706433);
check('空输入报错', throwsMessage(() => C.parseAddress('')) !== null, true);
check('纯空白报错', throwsMessage(() => C.parseAddress('   ')) !== null, true);
check('五段报错', throwsMessage(() => C.parseAddress('1.2.3.4.5')) !== null, true);
check('空段报错', throwsMessage(() => C.parseAddress('1..2.3')) !== null, true);
check('前导点报错', throwsMessage(() => C.parseAddress('.1.2.3')) !== null, true);
check('超过 255 的段报错', throwsMessage(() => C.parseAddress('256.0.0.1')) !== null, true);
check('十进制段超过 255', throwsMessage(() => C.parseAddress('999.1.1.1')) !== null, true);
check('八进制里出现 8/9 报错（与 inet_aton 一致）', throwsMessage(() => C.parseAddress('08.0.0.1')) !== null, true);
check('0x 前缀但无数字报错', throwsMessage(() => C.parseAddress('0x')) !== null, true);
check('0x 后跟非法十六进制报错', throwsMessage(() => C.parseAddress('0xgg')) !== null, true);
check('负数报错', throwsMessage(() => C.parseAddress('-1')) !== null, true);
check('非数字报错', throwsMessage(() => C.parseAddress('abc')) !== null, true);
check('0.0.0.0/24 被拒绝', throwsMessage(() => C.parseAddress('127.0.0.1/24')) !== null, true);
checkTrue(
  '带 /前缀时提示改用子网计算器，而不是静默忽略掩码',
  (throwsMessage(() => C.parseAddress('127.0.0.1/24')) || '').includes('子网'),
);
check('0xffffffff = 4294967295', C.parseAddress('0xffffffff').value, MAX_U32);
check('037777777777 = 4294967295', C.parseAddress('037777777777').value, MAX_U32);
check('4294967295 合法', C.parseAddress(MAX_U32.toString()).value, MAX_U32);
check('4294967296 越界报错', throwsMessage(() => C.parseAddress('4294967296')) !== null, true);
check('11 位十进制串报"位数过多"而不是精度丢失', (throwsMessage(() => C.parseAddress('99999999999')) || '').includes('位数过多'), true);
check('两段简写第一段超过 255 报错', throwsMessage(() => C.parseAddress('256.1')) !== null, true);
check('两段简写第二段超过 16777215 报错', throwsMessage(() => C.parseAddress('1.16777216')) !== null, true);
check('三段简写第二段超过 255 报错', throwsMessage(() => C.parseAddress('1.256.1')) !== null, true);
check('三段简写第三段超过 65535 报错', throwsMessage(() => C.parseAddress('1.2.65536')) !== null, true);
check('三段简写 1.2.3 = 1.2.0.3', C.parseAddress('1.2.3').value, (1 << 24) | (2 << 16) | 3);
check('两段简写 1.2 = 1.0.0.2', C.parseAddress('1.2').value, (1 << 24) | 2);
check('两段简写 127.1 的第三、四段补 0', C.parseAddress('127.1').dotted, '127.0.0.1');
check('二进制 32 位', C.parseAddress('11111111111111111111111111111111').value, MAX_U32);
check('二进制按字节分组', C.parseAddress('11111111.11111111.11111111.11111111').value, MAX_U32);
check('二进制 0', C.parseAddress('00000000.00000000.00000000.00000000').value, 0);
check('二进制形式被识别', C.parseAddress('00000000000000000000000000000001').form, 'binary');
check('位数不足的二进制串按八进制/整数处理而不是二进制', C.parseAddress('1111').form, 'integer');
check('二进制形式的简写标记为 true（只是本工具视图，不可当地址用）', C.parseAddress('00000000000000000000000000000001').shorthand, true);

{
  let typeOk = false;
  try {
    C.parseAddress('');
  } catch (error) {
    typeOk = error instanceof C.Ipv4ParseError && error.name === 'Ipv4ParseError';
  }
  check('错误类型是 Ipv4ParseError', typeOk, true);
}

// ---------------------------------------------------------------------------
// 分类
// ---------------------------------------------------------------------------

console.log('--- 地址分类 ---');
const KINDS = [
  ['0.0.0.0', 'unspecified', false, true, 'A'],
  ['0.1.2.3', 'thisNetwork', false, true, 'A'],
  ['10.0.0.1', 'private', true, true, 'A'],
  ['10.255.255.255', 'private', true, true, 'A'],
  ['100.64.0.1', 'shared', false, true, 'A'],
  ['100.127.255.255', 'shared', false, true, 'A'],
  ['127.0.0.1', 'loopback', false, true, 'A'],
  ['127.255.255.254', 'loopback', false, true, 'A'],
  ['169.254.1.1', 'linkLocal', false, true, 'B'],
  ['172.16.0.1', 'private', true, true, 'B'],
  ['172.31.255.255', 'private', true, true, 'B'],
  ['172.32.0.1', 'public', false, false, 'B'],
  ['192.0.0.1', 'protocol', false, true, 'C'],
  ['192.0.2.1', 'documentation', false, true, 'C'],
  ['192.88.99.1', 'protocol', false, true, 'C'],
  ['192.168.1.1', 'private', true, true, 'C'],
  ['198.18.0.1', 'benchmark', false, true, 'C'],
  ['198.19.255.255', 'benchmark', false, true, 'C'],
  ['198.20.0.1', 'public', false, false, 'C'],
  ['198.51.100.1', 'documentation', false, true, 'C'],
  ['203.0.113.1', 'documentation', false, true, 'C'],
  ['224.0.0.1', 'multicast', false, true, 'D'],
  ['239.255.255.255', 'multicast', false, true, 'D'],
  ['240.0.0.1', 'reserved', false, true, 'E'],
  ['255.255.255.254', 'reserved', false, true, 'E'],
  ['255.255.255.255', 'broadcast', false, true, 'E'],
  ['8.8.8.8', 'public', false, false, 'A'],
  ['128.0.0.1', 'public', false, false, 'B'],
  ['192.0.1.1', 'public', false, false, 'C'],
];
for (const [address, kind, isPrivate, isReserved, klass] of KINDS) {
  const info = C.classifyAddress(C.parseAddress(address).value);
  check(`${address} 的类型是 ${kind}`, info.kind, kind);
  check(`${address} 的 isPrivate=${isPrivate}`, info.isPrivate, isPrivate);
  check(`${address} 的 isReserved=${isReserved}`, info.isReserved, isReserved);
  check(`${address} 的 classful 类别是 ${klass}`, info.klass, klass);
}
check('受限广播必须优先于 240.0.0.0/4 匹配', C.classifyAddress(MAX_U32).kind, 'broadcast');
checkTrue('分类标签非空', KINDS.every(([address]) => C.classifyAddress(C.parseAddress(address).value).label.length > 0));
checkTrue('分类给出定义段 CIDR', KINDS.every(([address]) => C.classifyAddress(C.parseAddress(address).value).cidr.includes('/')));

console.log('--- addressClass 与 inBlock ---');
check('127.255.255.255 是 A 类', C.addressClass(C.parseAddress('127.255.255.255').value), 'A');
check('128.0.0.0 是 B 类', C.addressClass(C.parseAddress('128.0.0.0').value), 'B');
check('191.255.255.255 是 B 类', C.addressClass(C.parseAddress('191.255.255.255').value), 'B');
check('192.0.0.0 是 C 类', C.addressClass(C.parseAddress('192.0.0.0').value), 'C');
check('223.255.255.255 是 C 类', C.addressClass(C.parseAddress('223.255.255.255').value), 'C');
check('224.0.0.0 是 D 类', C.addressClass(C.parseAddress('224.0.0.0').value), 'D');
check('240.0.0.0 是 E 类', C.addressClass(C.parseAddress('240.0.0.0').value), 'E');
check('10.1.2.3 在 10.0.0.0/8 内', C.inBlock(C.parseAddress('10.1.2.3').value, '10.0.0.0', 8), true);
check('11.0.0.0 不在 10.0.0.0/8 内', C.inBlock(C.parseAddress('11.0.0.0').value, '10.0.0.0', 8), false);
check('任意地址都在 0.0.0.0/0 内', C.inBlock(C.parseAddress('8.8.8.8').value, '0.0.0.0', 0), true);
check('10.0.0.0 不在 10.0.0.0/32 之外', C.inBlock(C.parseAddress('10.0.0.1').value, '10.0.0.0', 32), false);
{
  let violations = 0;
  for (const value of sampleValues(5000)) {
    const info = C.classifyAddress(value);
    if ((info.kind === 'public') !== !info.isReserved) violations += 1;
  }
  check('不变量：只有 public 的 isReserved 为 false（5000 个随机值）', violations, 0);
}
{
  let violations = 0;
  for (const value of sampleValues(5000)) {
    const info = C.classifyAddress(value);
    if (info.isPrivate && info.kind !== 'private') violations += 1;
    if (info.kind === 'private' && !info.isPrivate) violations += 1;
  }
  check('不变量：isPrivate 为真当且仅当 type 是 private（RFC 1918）', violations, 0);
}

// ---------------------------------------------------------------------------
// 批量转换
// ---------------------------------------------------------------------------

console.log('--- batchConvert ---');
{
  const result = C.batchConvert(
    ['# 注释行', '127.0.0.1', '// 另一种注释', '', '2130706433', 'not-an-address', '1.2.3.4.5'].join('\n'),
  );
  check('注释与空行被跳过后的行数', result.rows.length, 4);
  check('未被截断', result.truncated, false);
  check('行号连续', result.rows.map((row) => row.index), [1, 2, 3, 4]);
  check('规范地址转换成功', result.rows[0].ok, true);
  check('规范地址的十进制', result.rows[0].decimal, '2130706433');
  check('规范地址的十六进制', result.rows[0].hex, '0x7f000001');
  check('规范地址不标记简写', result.rows[0].shorthand, false);
  check('整数写法解析成功', result.rows[1].ok, true);
  check('整数写法标记简写', result.rows[1].shorthand, true);
  check('整数写法带回警告', result.rows[1].warnings.length, 1);
  check('坏行不中断后续解析（返回 ok=false 行）', result.rows[2].ok, false);
  checkTrue('坏行附带错误信息', result.rows[2].warnings.length === 1 && result.rows[2].warnings[0].length > 0);
  check('五段输入行也失败而非抛异常', result.rows[3].ok, false);
}
{
  const many = Array.from({ length: 600 }, (_, index) => `10.0.0.${index % 256}`);
  const result = C.batchConvert(many.join('\n'));
  check('超过上限被截断', result.truncated, true);
  check('截断到 MAX_BATCH_LINES', result.rows.length, C.MAX_BATCH_LINES);
}
{
  const result = C.batchConvert('');
  check('空输入没有行', result.rows.length, 0);
  check('空输入未被截断', result.truncated, false);
}

console.log(`\n${passed}/${passed + failed} passed${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
