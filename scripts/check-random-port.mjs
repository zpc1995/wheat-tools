/**
 * Checks the random port generator.
 *
 * The claims worth defending are:
 *
 *   1. Every generated port is inside the requested range — asserted over a
 *      large sample from each preset, not over one lucky draw.
 *   2. The IANA range boundaries are right at 1023 / 1024 / 49151 / 49152 and
 *      reject 65536 and negatives. Verified *exhaustively* for all 65536 port
 *      numbers against a range table written out separately in this file, so
 *      the implementation cannot agree with itself by sharing a constant.
 *   3. "N distinct ports" really returns N distinct ports, and an impossible
 *      request is an error rather than a spin. The error paths assert that the
 *      random source is never even called, which is the difference between
 *      "reports the problem" and "retries until the heat death of the universe".
 *   4. The hex and binary renderings are the 16-bit field, compared against an
 *      independently written formatter for every one of the 65536 values.
 *
 * The random source is injected (a seeded xorshift32), so a failure is
 * reproducible and the statistical claims are deterministic.
 *
 * Usage: node scripts/check-random-port.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(readFileSync('src/tools/random-port/randomPortUtils.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/random-port.mjs', compiled);
const M = await import(pathToFileURL('.verify/random-port.mjs').href);

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

/** Seeded xorshift32: reproducible, and good enough that the statistics below
 * are about the implementation rather than about the generator. */
function seededSource(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

/**
 * Collects `total` ports by issuing batches that respect MAX_COUNT.
 *
 * The statistics below want tens of thousands of draws; the public API caps one
 * request at MAX_COUNT so a mistyped quantity cannot freeze the tab. Batching
 * here keeps both facts true, and exercises the boundary at the same time.
 */
function samplePorts(request, source, total) {
  const ports = [];
  while (ports.length < total) {
    const count = Math.min(M.MAX_COUNT, total - ports.length);
    ports.push(...M.generatePorts({ ...request, count }, source).ports);
  }
  return ports;
}

// ---------------------------------------------------------------------------
// Independent references, written from the standards rather than from the
// implementation, so agreement is evidence and not a tautology.
// ---------------------------------------------------------------------------

/** IANA ranges as three explicit intervals (RFC 6335 section 6). */
const IANA_RANGES = [
  { kind: 'wellKnown', min: 0, max: 1023 },
  { kind: 'registered', min: 1024, max: 49151 },
  { kind: 'dynamic', min: 49152, max: 65535 },
];

function referenceClass(port) {
  const hit = IANA_RANGES.find((range) => port >= range.min && port <= range.max);
  return hit ? hit.kind : 'outOfRange';
}

function referenceHex(port) {
  return '0x' + port.toString(16).toUpperCase().padStart(4, '0');
}

function referenceBinary(port) {
  return port.toString(2).padStart(16, '0').match(/.{4}/g).join(' ');
}

// ---------------------------------------------------------------------------

console.log('--- IANA 范围划分：全部 65536 个取值逐一比对 ---');
{
  let mismatches = 0;
  let outOfRangeAccepted = 0;
  for (let port = 0; port <= 65535; port += 1) {
    if (M.classifyPort(port).kind !== referenceClass(port)) mismatches += 1;
  }
  check('0–65535 每一个端口的所属范围都与独立写的区间表一致', mismatches, 0);

  for (const bad of [-1, 65536, 100000, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    if (M.isValidPort(bad)) outOfRangeAccepted += 1;
  }
  check('非法端口一律不被接受（-1 / 65536 / 100000 / 1.5 / NaN / Infinity）', outOfRangeAccepted, 0);

  let threw = 0;
  for (const bad of [-1, 65536, 1.5, Number.NaN]) {
    try {
      M.classifyPort(bad);
    } catch (error) {
      if (error instanceof M.PortError) threw += 1;
    }
  }
  check('非法端口调用 classifyPort 一律抛 PortError', threw, 4);
}

console.log('--- 范围边界（含 1023 / 1024 / 49151 / 49152 的邻接） ---');
{
  const boundary = [
    [0, 'wellKnown'],
    [1, 'wellKnown'],
    [1022, 'wellKnown'],
    [1023, 'wellKnown'],
    [1024, 'registered'],
    [1025, 'registered'],
    [49150, 'registered'],
    [49151, 'registered'],
    [49152, 'dynamic'],
    [49153, 'dynamic'],
    [65534, 'dynamic'],
    [65535, 'dynamic'],
  ];
  check(
    '边界值逐个落在正确的 IANA 区间',
    boundary.map(([port]) => M.classifyPort(port).kind),
    boundary.map(([, kind]) => kind),
  );
  check('1023 是系统端口的上界', M.classifyPort(1023).ianaRange, '0–1023');
  check('1024 是用户端口的下界', M.classifyPort(1024).ianaRange, '1024–49151');
  check('49151 是用户端口的上界', M.classifyPort(49151).ianaRange, '1024–49151');
  check('49152 是动态端口的下界', M.classifyPort(49152).ianaRange, '49152–65535');
  check('65535 是端口空间的上界', M.classifyPort(65535).kind, 'dynamic');
  check('三个 IANA 区间首尾相接、不重叠、无空隙', IANA_RANGES.every((range, index) => index === 0 || range.min === IANA_RANGES[index - 1].max + 1), true);
}

console.log('--- 已知端口对应的服务名 ---');
{
  check('22 = SSH', M.serviceName(22), 'SSH');
  check('53 = DNS', M.serviceName(53), 'DNS');
  check('80 = HTTP', M.serviceName(80), 'HTTP');
  check('443 = HTTPS', M.serviceName(443), 'HTTPS');
  check('3306 = MySQL', M.serviceName(3306), 'MySQL / MariaDB');
  check('5432 = PostgreSQL', M.serviceName(5432), 'PostgreSQL');
  check('6379 = Redis', M.serviceName(6379), 'Redis');
  check('未登记的端口没有服务名', M.serviceName(49152), null);
  check('未登记的端口没有服务名（随机取一个）', M.serviceName(41234), null);
  check('6379 在常见占用清单里', M.isCommonlyOccupied(6379), true);
  check('49152 不在常见占用清单里', M.isCommonlyOccupied(49152), false);

  // The registry names below were read off the IANA "Service Name and Transport
  // Protocol Port Number Registry" CSV. Where they disagree with the name
  // everyone uses, the tool must say so rather than repeat the folklore.
  const registry = [
    [80, 'http'],
    [443, 'https'],
    [22, 'ssh'],
    [53, 'domain'],
    [3306, 'mysql'],
    [5432, 'postgresql'],
    [6379, 'redis'],
    [1521, 'ncube-lm'],
    [2181, 'eforward'],
    [7001, 'afs3-callback'],
    [9200, 'wap-wsp'],
    [9300, 'vrace'],
    [6443, 'sun-sr-https'],
    [445, 'microsoft-ds'],
    [514, 'syslog'],
    [27017, 'mongodb'],
    [11211, 'memcache'],
  ];
  check(
    '表中每个端口的 IANA 登记名与注册表一致',
    registry.map(([port]) => M.serviceInfo(port).ianaName),
    registry.map(([, ianaName]) => ianaName),
  );
  check(
    'IANA 登记名与日常叫法不同的端口都被标注出来（Oracle / ZooKeeper / WebLogic / Elasticsearch）',
    [1521, 2181, 7001, 9200].map((port) => /约定/.test(M.serviceInfo(port).name)),
    [true, true, true, true],
  );
  check('53 的协议是 tcp 与 udp', M.serviceInfo(53).protocols, 'tcp, udp');
  check('514 只登记在 UDP 上', M.serviceInfo(514).protocols, 'udp');
  check('未收录的端口没有服务信息', M.serviceInfo(41234), null);

  // The list must stay a list of real ports: sorted, unique, in range.
  const list = M.COMMON_OCCUPIED_PORTS;
  const sorted = [...list].sort((a, b) => a - b);
  check('常见占用清单是有序的', JSON.stringify(list) === JSON.stringify(sorted), true);
  check('常见占用清单没有重复项', new Set(list).size, list.length);
  check('常见占用清单全部是合法端口', list.every((port) => M.isValidPort(port)), true);
  check('常见占用清单全部落在系统端口与注册端口范围内（< 49152）', list.every((port) => port < 49152), true);
  const required = [22, 80, 443, 3306, 5432, 6379, 8080];
  check('清单含任务要求的 22 / 80 / 443 / 3306 / 5432 / 6379 / 8080', required.every((port) => list.includes(port)), true);
  check('服务表的键全部是合法端口', Object.keys(M.PORT_SERVICES).every((key) => M.isValidPort(Number(key))), true);
}

console.log('--- 十六进制 / 二进制形式：全部 65536 个取值逐一比对 ---');
{
  let hexMismatch = 0;
  let binMismatch = 0;
  for (let port = 0; port <= 65535; port += 1) {
    if (M.formatPortHex(port) !== referenceHex(port)) hexMismatch += 1;
    if (M.formatPortBinary(port) !== referenceBinary(port)) binMismatch += 1;
  }
  check('十六进制与独立实现 65536 个取值全一致', hexMismatch, 0);
  check('二进制与独立实现 65536 个取值全一致', binMismatch, 0);

  check('80 的十六进制补齐到 4 位', M.formatPortHex(80), '0x0050');
  check('80 的二进制按 4 位分组', M.formatPortBinary(80), '0000 0000 0101 0000');
  check('8080 的十六进制', M.formatPortHex(8080), '0x1F90');
  check('8080 的二进制', M.formatPortBinary(8080), '0001 1111 1001 0000');
  check('65535 的十六进制是全 1', M.formatPortHex(65535), '0xFFFF');
  check('65535 的二进制是全 1', M.formatPortBinary(65535), '1111 1111 1111 1111');
  check('0 号端口渲染为全 0', [M.formatPortHex(0), M.formatPortBinary(0)], ['0x0000', '0000 0000 0000 0000']);
  check('二进制长度恒为 19（16 位 + 3 个分隔空格）', new Set([...Array(65536).keys()].map((p) => M.formatPortBinary(p).length)).size, 1);
}

console.log('--- 范围校验 ---');
{
  const cases = [
    ['最大端口超过 65535', () => M.assertRange(0, 65536)],
    ['最小端口为负', () => M.assertRange(-1, 100)],
    ['最小值大于最大值', () => M.assertRange(200, 100)],
    ['非整数', () => M.assertRange(1.5, 10)],
    ['NaN', () => M.assertRange(Number.NaN, 10)],
  ];
  check(
    '非法范围一律抛 PortError',
    cases.map(([, run]) => {
      try {
        run();
        return 'no-throw';
      } catch (error) {
        return error instanceof M.PortError ? 'PortError' : 'other';
      }
    }),
    cases.map(() => 'PortError'),
  );

  const counts = [0, -1, 1.5, Number.NaN, M.MAX_COUNT + 1];
  check(
    '非法数量一律抛 PortError',
    counts.map((count) => {
      try {
        M.assertCount(count);
        return 'no-throw';
      } catch (error) {
        return error instanceof M.PortError ? 'PortError' : 'other';
      }
    }),
    counts.map(() => 'PortError'),
  );
  check('恰好 MAX_COUNT 是允许的', (() => {
    try {
      M.assertCount(M.MAX_COUNT);
      return 'ok';
    } catch {
      return 'threw';
    }
  })(), 'ok');
}

console.log('--- 预设范围 ---');
{
  check('默认预设是动态端口范围', M.DEFAULT_PRESET_ID, 'dynamic');
  check(
    '三个预设的范围与 IANA 定义一致',
    M.PORT_RANGE_PRESETS.map((preset) => [preset.id, preset.min, preset.max]),
    [
      ['dynamic', 49152, 65535],
      ['registered', 1024, 49151],
      ['all', 0, 65535],
    ],
  );
  check('按 id 取预设', M.presetById('registered').min, 1024);
  check('未知 id 返回 null', M.presetById('nope'), null);
}

console.log('--- 生成：大样本全部落在请求范围内 ---');
{
  let outOfRange = 0;
  let wrongLength = 0;
  const presets = M.PORT_RANGE_PRESETS;
  for (const preset of presets) {
    const ports = samplePorts(
      { min: preset.min, max: preset.max, unique: false, excludeCommon: false },
      seededSource(0x1234abcd + preset.min),
      2000,
    );
    if (ports.length !== 2000) wrongLength += 1;
    for (const port of ports) {
      if (!Number.isInteger(port) || port < preset.min || port > preset.max) outOfRange += 1;
    }
  }
  check('三个预设各 2000 次采样，共 6000 个端口全部落在范围内', outOfRange, 0);
  check('三个预设的返回条数都等于请求数量', wrongLength, 0);

  // Distribution: the mean of the dynamic range must sit near the midpoint.
  // The standard error of the mean over 20000 draws of a 16384-wide uniform is
  // about 33, so a window of +-200 is six sigma: it would only fail if the
  // sampler were biased, not by chance.
  const sample = samplePorts(
    { min: 49152, max: 65535, unique: false, excludeCommon: false },
    seededSource(20240607),
    20000,
  );
  const mean = sample.reduce((sum, port) => sum + port, 0) / sample.length;
  check('20000 次采样的均值落在范围中点 ±200 内（无系统性偏移）', Math.abs(mean - (49152 + 65535) / 2) < 200, true);

  // Coverage of a tiny range: every value must appear.
  const small = samplePorts(
    { min: 0, max: 9, unique: false, excludeCommon: false },
    seededSource(99),
    20000,
  );
  const counts = new Array(10).fill(0);
  for (const port of small) counts[port] += 1;
  check('10 个取值的小范围，20000 次采样后每个值都被抽到', counts.every((n) => n > 0), true);
  check(
    '每个值的出现次数都在 2000 ± 400 内（期望 2000，标准差约 42）',
    counts.every((n) => Math.abs(n - 2000) < 400),
    true,
  );
}

console.log('--- 去重语义 ---');
{
  const unique = M.generatePorts(
    { min: 49152, max: 65535, count: 200, unique: true, excludeCommon: false },
    seededSource(7),
  );
  check('请求 200 个不重复端口，集合大小确为 200', new Set(unique.ports).size, 200);
  check('返回条数等于请求数量', unique.ports.length, 200);

  // The whole pool, exactly once: a permutation, which is only true if the
  // partial shuffle draws each slot without replacement.
  const pool = M.generatePorts(
    { min: 0, max: 4, count: 5, unique: true, excludeCommon: false },
    seededSource(11),
  ).ports;
  check('范围只有 5 个端口而请求 5 个不重复端口时，正好是这 5 个的排列', [...pool].sort((a, b) => a - b), [0, 1, 2, 3, 4]);

  const withExclusion = M.generatePorts(
    { min: 80, max: 84, count: 4, unique: true, excludeCommon: true },
    seededSource(13),
  );
  check('排除 80 后只剩 4 个候选，请求 4 个不重复端口正好用到它们', [...withExclusion.ports].sort((a, b) => a - b), [81, 82, 83, 84]);
  check('可用数量如实报告为 4', withExclusion.available, 4);
  check('被排除的端口列表如实报告为 [80]', withExclusion.excluded, [80]);

  // Uniformity of the distinct sampler: over the same 5-value pool, each value
  // must appear in a 2-of-5 draw about 2/5 of the time. Expected 8000 of 20000
  // with a standard deviation near 69, so +-400 is again a wide margin.
  const draws = new Array(5).fill(0);
  const source = seededSource(4242);
  for (let round = 0; round < 20000; round += 1) {
    for (const port of M.generatePorts({ min: 0, max: 4, count: 2, unique: true, excludeCommon: false }, source).ports) {
      draws[port] += 1;
    }
  }
  check(
    '不重复采样 2/5 共 20000 轮，每个值的出现次数都在 8000 ± 400 内',
    draws.every((n) => Math.abs(n - 8000) < 400),
    true,
  );

  const repeatable = M.generatePorts(
    { min: 49152, max: 65535, count: 500, unique: false, excludeCommon: false },
    seededSource(2024),
  ).ports;
  check('允许重复时确实会出现重复值', new Set(repeatable).size < repeatable.length, true);

  const twoValues = M.generatePorts(
    { min: 3000, max: 3001, count: 200, unique: false, excludeCommon: false },
    seededSource(31),
  ).ports;
  check('两值范围 200 次采样只可能取到那两个值', new Set(twoValues).size, 2);
}

console.log('--- 不可满足的请求必须报错，而且不能空转 ---');
{
  let calls = 0;
  const counting = () => {
    calls += 1;
    return 0.5;
  };

  let error = null;
  try {
    M.generatePorts({ min: 100, max: 101, count: 3, unique: true, excludeCommon: false }, counting);
  } catch (caught) {
    error = caught;
  }
  check('范围只有 2 个端口却要 3 个不重复端口时抛 PortError', error instanceof M.PortError, true);
  check('错误信息说清了可用数量', /最多只有 2 个/.test(String(error && error.message)), true);
  check('报错前一次随机数都没抽（不会死循环、不会空转）', calls, 0);

  // Same shape, but the range is emptied by the exclusion list instead.
  calls = 0;
  error = null;
  try {
    M.generatePorts({ min: 80, max: 80, count: 1, unique: true, excludeCommon: true }, counting);
  } catch (caught) {
    error = caught;
  }
  check('排除后范围内一个候选都不剩时抛 PortError', error instanceof M.PortError, true);
  check('该错误同样在抽取之前就报出来', calls, 0);

  check('可用数量计算与候选数组长度一致（含全范围）', [
    M.availablePortCount(0, 65535, false),
    M.availablePortCount(0, 65535, true),
    M.availablePortCount(49152, 65535, true),
  ], [
    65536,
    65536 - M.COMMON_OCCUPIED_PORTS.length,
    M.candidatePorts(49152, 65535, true).length,
  ]);
  check('动态端口范围内没有需要排除的常见端口', M.excludedPortsInRange(49152, 65535), []);

  // Hostile random sources must be rejected rather than trusted.
  const hostile = [() => 1, () => -0.1, () => Number.NaN, () => Number.POSITIVE_INFINITY];
  check(
    '越界 / NaN / Infinity 的随机源一律抛 PortError',
    hostile.map((source) => {
      try {
        M.generatePorts({ min: 0, max: 100, count: 1, unique: false, excludeCommon: false }, source);
        return 'no-throw';
      } catch (caught) {
        return caught instanceof M.PortError ? 'PortError' : 'other';
      }
    }),
    hostile.map(() => 'PortError'),
  );
}

console.log('--- 排除常见端口 ---');
{
  const sampled = samplePorts(
    { min: 0, max: 65535, unique: false, excludeCommon: true },
    seededSource(555),
    5000,
  );
  const hit = sampled.filter((port) => M.isCommonlyOccupied(port));
  check('全范围 5000 次采样，排除了常见端口后一个都没抽到', hit, []);
  const all = M.generatePorts({ min: 0, max: 65535, count: 1000, unique: false, excludeCommon: true }, seededSource(557));
  check('全范围下被排除的数量等于清单长度', all.excluded.length, M.COMMON_OCCUPIED_PORTS.length);
  check('返回条数不受排除影响', all.ports.length, 1000);

  const inDynamic = M.generatePorts(
    { min: 49152, max: 65535, count: 100, unique: false, excludeCommon: true },
    seededSource(556),
  );
  check('动态范围排除常见端口时不产生额外排除项', inDynamic.excluded, []);
  check('动态范围排除前后的可用数量相同', inDynamic.available, M.availablePortCount(49152, 65535, false));
}

console.log('--- 可复现性：同一个随机源序列给出同一个结果 ---');
{
  const first = M.generatePorts({ min: 0, max: 65535, count: 50, unique: true, excludeCommon: true }, seededSource(123456));
  const second = M.generatePorts({ min: 0, max: 65535, count: 50, unique: true, excludeCommon: true }, seededSource(123456));
  check('同一 seed 两次生成结果完全相同', first.ports, second.ports);
  const third = M.generatePorts({ min: 0, max: 65535, count: 50, unique: true, excludeCommon: true }, seededSource(123457));
  check('不同 seed 结果不同', JSON.stringify(third.ports) === JSON.stringify(first.ports), false);
}

console.log('--- 逐端口的完整描述与导出 ---');
{
  const described = M.describePort(80);
  check('80 的描述字段', [described.port, described.portClass.kind, described.service, described.hex, described.binary, described.commonlyOccupied], [80, 'wellKnown', 'HTTP', '0x0050', '0000 0000 0101 0000', true]);
  check('80 的 IANA 登记名随描述一起给出', described.ianaName, 'http');
  check('2181 的描述里 IANA 名与日常叫法不同', [M.describePort(2181).service, M.describePort(2181).ianaName], ['ZooKeeper（约定）', 'eforward']);
  check('0 号端口是系统端口，但不在常见占用清单里', [M.describePort(0).portClass.kind, M.describePort(0).commonlyOccupied], ['wellKnown', false]);
  check('49152 的描述没有服务名', M.describePort(49152).service, null);

  const ports = [80, 49152, 65535];
  check('纯列表导出为每行一个端口', M.portsToText(ports), '80\n49152\n65535');
  const tsv = M.portsToTsv(ports).split('\n');
  check('TSV 首行是表头', tsv[0], '端口\t范围\t十六进制\t二进制\t服务');
  check('TSV 行数为 1 + 端口数', tsv.length, 4);
  check('TSV 的 80 行', tsv[1], '80\t系统端口（知名端口）\t0x0050\t0000 0000 0101 0000\tHTTP');
  check('TSV 的 49152 行没有服务名', tsv[2], '49152\t动态 / 私有端口\t0xC000\t1100 0000 0000 0000\t');
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
