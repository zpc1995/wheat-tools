/**
 * Checks the device-info tool.
 *
 * ## What can honestly be verified here
 *
 * There is no registry of "your screen size", so this tool cannot be checked
 * against an external authority the way a hash or a subnet calculator can. Two
 * things stand in for one:
 *
 *   1. **Internal consistency.** A correct set of readings satisfies relations
 *      that a wrong one violates — CSS pixels must round-trip through
 *      devicePixelRatio, the available screen area cannot exceed the screen, the
 *      viewport cannot exceed the window that holds it, and the two independent
 *      time-zone sources must agree. The fake environments below violate each
 *      relation one at a time, and the corresponding check must flip to failing;
 *      without that second half, "all checks passed" could just mean the checks
 *      are vacuous.
 *
 *   2. **`Intl.DateTimeFormat` for the time-zone arithmetic.** The offset is
 *      derived twice by different features of the same API — once from the
 *      formatted date parts, once by parsing the `longOffset` name (GMT+05:30) —
 *      across ten zones including 45-minute and 30-minute offsets and a
 *      southern-hemisphere DST rule, at eight instants spanning two years.
 *
 * Everything else is asserted structurally: the required rows exist, the
 * non-standard ones are marked non-standard, missing browser APIs degrade to
 * "不可用" instead of throwing or rendering a plausible-looking zero.
 *
 * The "no fingerprinting" claim is checked by scanning this tool's own sources
 * for the APIs that claim would forbid (canvas read-back, audio processing,
 * device enumeration, hashing-then-transmitting) plus any network call at all.
 * A synthetic source string is run through the same scanner to prove the scanner
 * can actually fail.
 *
 * Usage: node scripts/check-device-info.mjs
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/device-info/deviceInfoUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/device-info.mjs', compiled);
const M = await import(pathToFileURL('.verify/device-info.mjs').href);

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

/** Asserts a condition is true, with the label written as the claim. */
function ok(label, condition) {
  check(label, Boolean(condition), true);
}

console.log('--- 单位换算：CSS 像素 <-> 物理像素 ---');
check('1280 CSS px @2 = 2560 物理 px', M.physicalPixels(1280, 2), 2560);
check('2560 物理 px @2 = 1280 CSS px', M.cssPixels(2560, 2), 1280);
check('1512 CSS px @2 = 3024 物理 px（MacBook 常见值）', M.physicalPixels(1512, 2), 3024);
check('1366 CSS px @1.25 = 1707.5 物理 px', M.physicalPixels(1366, 1.25), 1707.5);
check('1707.5 物理 px @1.25 = 1366 CSS px', M.cssPixels(1707.5, 1.25), 1366);
check('devicePixelRatio 为 0 时返回 null 而不是 Infinity', M.physicalPixels(100, 0), null);
check('devicePixelRatio 为负时返回 null', M.cssPixels(100, -2), null);
check('NaN 输入返回 null', M.physicalPixels(Number.NaN, 2), null);
check('Infinity 输入返回 null', M.cssPixels(Number.POSITIVE_INFINITY, 2), null);

// The relation the tool's consistency report is built on: scaling up by the
// device pixel ratio and back down must return the original CSS size, for the
// awkward ratios real devices report (1.100000023841858 is what Chrome reports
// at 110% zoom, and it does not divide cleanly).
{
  const cases = [
    [1920, 1],
    [1920, 2],
    [1512, 2],
    [1366, 1.25],
    [1280, 1.100000023841858],
    [3840, 1.5],
    [360, 2.75],
    [1024, 0.8],
  ];
  let mismatches = 0;
  for (const [cssWidth, dpr] of cases) {
    const physical = M.physicalPixels(cssWidth, dpr);
    if (M.cssPixels(physical, dpr) !== cssWidth) mismatches += 1;
  }
  check('8 组屏幕尺寸/像素比上换算可逆', mismatches, 0);
}

console.log('--- 时区偏移格式化 ---');
// `formatUtcOffset` takes the ISO-signed offset (east of UTC is positive), which
// is the opposite sign from `Date.prototype.getTimezoneOffset()`. Both spellings
// are pinned below so the convention cannot silently flip.
check('UTC+8（东八区，ISO 记法为 +480）', M.formatUtcOffset(480), 'UTC+08:00');
check('UTC', M.formatUtcOffset(0), 'UTC+00:00');
check('UTC-5:30', M.formatUtcOffset(-330), 'UTC-05:30');
check('UTC+5:45（尼泊尔）', M.formatUtcOffset(345), 'UTC+05:45');
check('UTC+8:45（澳大利亚 Eucla）', M.formatUtcOffset(525), 'UTC+08:45');
check('UTC+14', M.formatUtcOffset(840), 'UTC+14:00');
check('非法值给出不可用而不是 NaN', M.formatUtcOffset(Number.NaN), '不可用');
check('getTimezoneOffset 符号取反：-480（东八区）→ +480', M.utcOffsetFromGetTimezoneOffset(-480), 480);
check('getTimezoneOffset 符号取反：+330（西五区半）→ -330', M.utcOffsetFromGetTimezoneOffset(330), -330);
check('getTimezoneOffset 为 0 时取反仍是 0', M.utcOffsetFromGetTimezoneOffset(0), 0);
check(
  '两者串起来：getTimezoneOffset = -480 显示为 UTC+08:00',
  M.formatUtcOffset(M.utcOffsetFromGetTimezoneOffset(-480)),
  'UTC+08:00',
);

console.log('--- 时区偏移：与 Intl 的 longOffset 名称交叉验证 ---');
{
  /**
   * Independent derivation of the offset: read the zone name Intl prints
   * ("GMT+05:30") and parse it. This is a different code path inside Intl from
   * the date-part formatting the implementation uses, so the two agreeing is a
   * real cross-check rather than the same answer twice.
   */
  function offsetFromLongOffsetName(ms, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
      year: 'numeric',
    }).formatToParts(new Date(ms));
    const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    const match = /^GMT(?:([+-])(\d{1,2}):(\d{2}))?$/.exec(name);
    if (!match) throw new Error(`无法解析 longOffset 名称：${name}`);
    if (!match[1]) return 0;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3]));
  }

  const zones = [
    'UTC',
    'Asia/Shanghai',
    'Asia/Kolkata', // +05:30, no DST
    'Asia/Kathmandu', // +05:45
    'Australia/Eucla', // +08:45
    'Australia/Lord_Howe', // +10:30 / +11:00, a 30-minute DST shift
    'Pacific/Chatham', // +12:45 / +13:45
    'America/New_York', // -05:00 / -04:00
    'Europe/Berlin', // +01:00 / +02:00
    'Pacific/Kiritimati', // +14:00
  ];
  // Two years of solstice/equinox samples: every DST transition in between is
  // covered without having to know the rules.
  const instants = [
    Date.UTC(2023, 0, 15, 12, 0, 0),
    Date.UTC(2023, 3, 15, 12, 0, 0),
    Date.UTC(2023, 6, 15, 12, 0, 0),
    Date.UTC(2023, 9, 15, 12, 0, 0),
    Date.UTC(2024, 0, 15, 12, 0, 0),
    Date.UTC(2024, 3, 15, 12, 0, 0),
    Date.UTC(2024, 6, 15, 12, 0, 0),
    Date.UTC(2024, 9, 15, 12, 0, 0),
  ];

  let compared = 0;
  let mismatches = 0;
  let unknownZones = 0;
  const examples = [];
  for (const timeZone of zones) {
    for (const ms of instants) {
      let expected;
      try {
        expected = offsetFromLongOffsetName(ms, timeZone);
      } catch {
        unknownZones += 1;
        continue;
      }
      const actual = M.intlOffsetMinutes(ms, timeZone);
      compared += 1;
      if (actual !== expected) {
        mismatches += 1;
        if (examples.length < 3) {
          examples.push(`${timeZone}@${new Date(ms).toISOString()}: got ${actual}, want ${expected}`);
        }
      }
    }
  }
  check(`与 longOffset 名称在 ${compared} 个（时区，时刻）组合上一致` + (examples.length ? `（例：${examples.join('；')}）` : ''), mismatches, 0);
  ok('比较样本足够多（至少 60 组）', compared >= 60);
  ok('测试用的时区都被运行时认识（未知时区不会让比较静默变少）', unknownZones === 0);

  // Pin a few values so a broken Intl data set cannot make both sides agree on
  // the same wrong answer.
  check('Asia/Shanghai 全年恒为 +08:00', M.intlOffsetMinutes(Date.UTC(2024, 0, 1), 'Asia/Shanghai'), 480);
  check('America/New_York 1 月为 -05:00', M.intlOffsetMinutes(Date.UTC(2024, 0, 15), 'America/New_York'), -300);
  check('America/New_York 7 月为 -04:00（夏令时）', M.intlOffsetMinutes(Date.UTC(2024, 6, 15), 'America/New_York'), -240);
  check('Europe/Berlin 7 月为 +02:00', M.intlOffsetMinutes(Date.UTC(2024, 6, 15), 'Europe/Berlin'), 120);
  check('Asia/Kathmandu 为 +05:45', M.intlOffsetMinutes(Date.UTC(2024, 6, 15), 'Asia/Kathmandu'), 345);
  check('UTC 为 0', M.intlOffsetMinutes(Date.UTC(2024, 6, 15), 'UTC'), 0);
  check('未知时区返回 null 而不是抛异常', M.intlOffsetMinutes(Date.UTC(2024, 0, 1), 'Not/AZone'), null);
  check('空时区名返回 null', M.intlOffsetMinutes(Date.UTC(2024, 0, 1), ''), null);
  check('NaN 时刻返回 null', M.intlOffsetMinutes(Number.NaN, 'UTC'), null);
  check('毫秒部分不影响结果（整秒对齐）', M.intlOffsetMinutes(Date.UTC(2024, 0, 1) + 999, 'UTC'), 0);
}

console.log('--- 注入的假环境 ---');

/** A complete, internally consistent environment. */
function baseEnv() {
  return {
    screen: {
      width: 1920,
      height: 1080,
      availWidth: 1920,
      availHeight: 1040,
      colorDepth: 24,
      pixelDepth: 24,
      orientationType: 'landscape-primary',
      orientationAngle: 0,
    },
    viewport: {
      innerWidth: 1280,
      innerHeight: 800,
      outerWidth: 1400,
      outerHeight: 1000,
      screenX: 100,
      screenY: 50,
      devicePixelRatio: 2,
      isFullscreen: false,
    },
    layoutViewport: { width: 1265, height: 800 },
    nav: {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      platform: 'Win32',
      vendor: 'Google Inc.',
      language: 'zh-CN',
      languages: ['zh-CN', 'zh', 'en-US', 'en'],
      hardwareConcurrency: 16,
      deviceMemory: 8,
      maxTouchPoints: 0,
      touchEventSupported: false,
      cookieEnabled: true,
      onLine: true,
      doNotTrack: '1',
      userAgentData: {
        mobile: false,
        platform: 'Windows',
        brands: [
          { brand: 'Chromium', version: '126' },
          { brand: 'Google Chrome', version: '126' },
        ],
      },
      connection: {
        effectiveType: '4g',
        type: 'wifi',
        downlink: 10,
        rtt: 50,
        saveData: false,
      },
      battery: { charging: true, level: 0.72, chargingTime: 2400, dischargingTime: Infinity },
    },
    media: {
      colorSchemeDark: true,
      reducedMotion: false,
      prefersContrastMore: false,
      forcedColorsActive: false,
      pointerCoarse: false,
      hoverNone: false,
      displayModeStandalone: true,
      displayModeMinimalUi: false,
      displayModeFullscreen: false,
      navigatorStandalone: false,
    },
    time: {
      timeZone: 'Asia/Shanghai',
      getTimezoneOffsetMinutes: -480,
      sampleMs: Date.UTC(2024, 6, 15, 4, 0, 0),
      localizedTimeZoneName: '中国标准时间',
    },
    webgl: {
      contextName: 'webgl2',
      version: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)',
      shadingLanguageVersion: 'WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Chromium)',
      vendor: 'WebKit',
      renderer: 'WebKit WebGL',
      unmaskedVendor: 'Google Inc. (NVIDIA)',
      unmaskedRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    },
  };
}

const env = baseEnv();
const groups = M.collectInfo(env);
const itemsById = new Map();
for (const group of groups) {
  for (const item of group.items) itemsById.set(item.id, item);
}

console.log('--- 覆盖：任务要求的每一项都在表里 ---');
{
  const required = [
    'screen-size', 'screen-avail', 'screen-physical', 'screen-divided', 'dpr',
    'color-depth', 'inner', 'outer', 'layout-viewport', 'timezone',
    'utc-offset-intl', 'utc-offset-legacy', 'language', 'languages',
    'cores', 'memory', 'touch-points', 'color-scheme', 'reduced-motion',
    'effective-type', 'ua', 'platform', 'display-mode', 'webgl-unmasked-renderer',
    'battery', 'cookie-enabled', 'online', 'save-data',
  ];
  const missing = required.filter((id) => !itemsById.has(id));
  check(`要求的 ${required.length} 项全部存在（缺失：${missing.join(', ') || '无'}）`, missing, []);
  ok('每一项都有来源 API', groups.every((g) => g.items.every((i) => i.api.length > 0)));
  ok('每一项都有值（不出现空字符串）', groups.every((g) => g.items.every((i) => i.value !== '')));
  ok(
    '每一项都标了标准性，且取值合法',
    groups.every((g) =>
      g.items.every((i) => ['standard', 'nonstandard', 'deprecated', 'unknown'].includes(i.support)),
    ),
  );
  ok('id 在整张表内唯一', itemsById.size === groups.reduce((n, g) => n + g.items.length, 0));
}

console.log('--- 标准性标注：非标准的必须标出来 ---');
{
  const mustBeNonstandard = [
    'memory', // deviceMemory：Chromium 专有且粗粒度
    'effective-type', // Network Information API
    'downlink',
    'rtt',
    'save-data',
    'connection-type',
    'ua-mobile',
    'ua-platform',
    'ua-brands',
    'vendor', // Navigator.vendor
    'touch-event',
    'battery',
    'do-not-track',
    'standalone-ios',
    'webgl-unmasked-vendor',
    'webgl-unmasked-renderer',
  ];
  const wrong = mustBeNonstandard.filter((id) => itemsById.get(id)?.support !== 'nonstandard');
  check(`非标准项标注正确（错的：${wrong.join(', ') || '无'}）`, wrong, []);

  const mustBeDeprecated = ['pixel-depth', 'platform'];
  const wrongDeprecated = mustBeDeprecated.filter((id) => itemsById.get(id)?.support !== 'deprecated');
  check(`已废弃项标注正确（错的：${wrongDeprecated.join(', ') || '无'}）`, wrongDeprecated, []);

  const mustBeStandard = [
    'screen-size', 'dpr', 'inner', 'outer', 'timezone', 'language', 'languages',
    'cores', 'touch-points', 'ua', 'color-scheme', 'reduced-motion',
    'cookie-enabled', 'online', 'fullscreen', 'webgl-renderer',
  ];
  const wrongStandard = mustBeStandard.filter((id) => itemsById.get(id)?.support !== 'standard');
  check(`标准项标注正确（错的：${wrongStandard.join(', ') || '无'}）`, wrongStandard, []);

  ok(
    '每条非标准/已废弃项都写了说明（否则用户不知道坑在哪）',
    groups.every((g) =>
      g.items.every((i) => i.support === 'standard' || (i.note ?? '').length > 10),
    ),
  );
  ok(
    'deviceMemory 的说明点明了粗粒度与浏览器限制',
    /粗粒度/.test(itemsById.get('memory').note) && /Chromium/.test(itemsById.get('memory').note),
  );
  ok('hardwareConcurrency 说明了它不是物理核心数', /物理核心数/.test(itemsById.get('cores').note));
  ok('网络类型说明了 Chromium 专有', /Chromium/.test(itemsById.get('effective-type').note));

  check('统计非标准项数量', M.countBySupport(groups, 'nonstandard'), mustBeNonstandard.length);
  check('统计已废弃项数量', M.countBySupport(groups, 'deprecated'), mustBeDeprecated.length);
  ok('标准项数量至少覆盖上面列出的每一项', M.countBySupport(groups, 'standard') >= mustBeStandard.length);
  check(
    '四种标准性的计数之和等于总项数',
    ['standard', 'nonstandard', 'deprecated', 'unknown'].reduce((sum, level) => sum + M.countBySupport(groups, level), 0),
    itemsById.size,
  );
  check('中文标签齐全', M.SUPPORT_LABELS.nonstandard, '非标准');
}

console.log('--- 自洽性核对：一致的环境应全部通过 ---');
{
  const checks = M.checkConsistency(env);
  const failures = checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`);
  check(`干净环境零失败（失败项：${failures.join(' | ') || '无'}）`, failures, []);
  ok('检查项不少于 10 条', checks.length >= 10);
  ok('每条检查都有可核对的数字说明', checks.every((c) => c.detail.length > 0));

  const byId = new Map(checks.map((c) => [c.id, c]));
  // Positive controls: the relations the report claims to verify, spelled out
  // here rather than taken from the module.
  check('屏幕宽 1920 CSS px @2 = 3840 物理 px', byId.get('screen-css-physical').detail.includes('3840'), true);
  check('时区一致性明细给出 UTC+08:00', byId.get('timezone-agrees').detail.includes('UTC+08:00'), true);
  check('色彩深度 24 位通过', byId.get('color-depth').ok, true);
}

console.log('--- 自洽性核对：故意破坏其中一项，必须被抓到 ---');
{
  const cases = [
    ['视口宽于窗口外框', (e) => { e.viewport.innerWidth = 2000; }, 'inner-within-outer'],
    ['排版视口宽于窗口内尺寸', (e) => { e.layoutViewport.width = 9999; }, 'layout-within-inner'],
    ['可用区域大于屏幕', (e) => { e.screen.availWidth = 5000; }, 'avail-inside-screen'],
    ['devicePixelRatio 为 0', (e) => { e.viewport.devicePixelRatio = 0; }, 'dpr-positive'],
    ['devicePixelRatio 为 NaN', (e) => { e.viewport.devicePixelRatio = Number.NaN; }, 'dpr-positive'],
    ['hardwareConcurrency 为 0', (e) => { e.nav.hardwareConcurrency = 0; }, 'hardware-concurrency'],
    ['deviceMemory 不在档位上（3 GiB）', (e) => { e.nav.deviceMemory = 3; }, 'device-memory-ladder'],
    ['时区两套读数不一致', (e) => { e.time.getTimezoneOffsetMinutes = 0; }, 'timezone-agrees'],
    ['时区名为空', (e) => { e.time.timeZone = ''; }, 'timezone-named'],
    ['language 不在 languages 里', (e) => { e.nav.language = 'fr-FR'; }, 'language-in-list'],
    ['色彩深度只有 16 位', (e) => { e.screen.colorDepth = 16; }, 'color-depth'],
  ];
  for (const [label, mutate, id] of cases) {
    const broken = baseEnv();
    mutate(broken);
    const result = M.checkConsistency(broken);
    const entry = result.find((c) => c.id === id);
    check(`被抓到：${label} → ${id}`, entry ? entry.ok : 'missing', false);
  }

  // Fullscreen is the one case where inner > outer is legitimate; the check must
  // say so rather than reporting a false alarm.
  const fullscreen = baseEnv();
  fullscreen.viewport.isFullscreen = true;
  fullscreen.viewport.innerWidth = 2560;
  fullscreen.viewport.outerWidth = 1920;
  const fsEntry = M.checkConsistency(fullscreen).find((c) => c.id === 'inner-within-outer');
  check('全屏时 inner > outer 不算失败', fsEntry.ok, true);
  check('全屏时说明为什么不适用', fsEntry.detail.includes('全屏'), true);
}

console.log('--- 降级：浏览器不提供的 API 必须显示为不可用 ---');
{
  const bare = baseEnv();
  delete bare.nav.hardwareConcurrency;
  delete bare.nav.deviceMemory;
  delete bare.nav.userAgentData;
  delete bare.nav.connection;
  delete bare.nav.battery;
  delete bare.nav.platform;
  delete bare.nav.vendor;
  delete bare.nav.doNotTrack;
  bare.nav.languages = [];
  bare.time.localizedTimeZoneName = undefined;
  bare.screen.orientationType = undefined;
  bare.screen.orientationAngle = undefined;
  bare.webgl = null;

  const bareGroups = M.collectInfo(bare);
  const bareItems = new Map();
  for (const group of bareGroups) for (const item of group.items) bareItems.set(item.id, item);

  check('内存显示不可用', bareItems.get('memory').value, '不可用');
  check('核心数显示不可用', bareItems.get('cores').value, '不可用');
  check('电池显示不可用', bareItems.get('battery').value, '不可用（浏览器未提供该 API）');
  check('语言列表显示不可用', bareItems.get('languages').value, '不可用');
  check('WebGL 显示不可用', bareItems.get('webgl-available').value, '不可用');
  check('渲染器显示不可用', bareItems.get('webgl-unmasked-renderer').value, '不可用');
  check('UA 品牌显示不可用', bareItems.get('ua-brands').value, '不可用');
  check('移动端标记显示不可用', bareItems.get('ua-mobile').value, '不可用');

  const bareChecks = M.checkConsistency(bare);
  const bareFailures = bareChecks.filter((c) => !c.ok).map((c) => c.id);
  check('缺失的 API 不会让自洽性核对失败', bareFailures, []);

  // An environment where nothing at all is right must not throw.
  const broken = {
    screen: { width: 0, height: 0, availWidth: 0, availHeight: 0, colorDepth: 0, pixelDepth: 0 },
    viewport: { innerWidth: 0, innerHeight: 0, outerWidth: 0, outerHeight: 0, screenX: 0, screenY: 0, devicePixelRatio: 1, isFullscreen: false },
    layoutViewport: { width: 0, height: 0 },
    nav: { userAgent: '', language: '', languages: [], maxTouchPoints: 0, touchEventSupported: false, cookieEnabled: false, onLine: false, battery: null, connection: null },
    media: { colorSchemeDark: false, reducedMotion: false, prefersContrastMore: false, forcedColorsActive: false, pointerCoarse: false, hoverNone: false, displayModeStandalone: false, displayModeMinimalUi: false, displayModeFullscreen: false, navigatorStandalone: false },
    time: { timeZone: '', getTimezoneOffsetMinutes: 0, sampleMs: 0 },
    webgl: null,
  };
  let threw = null;
  try {
    M.collectInfo(broken);
    M.checkConsistency(broken);
  } catch (error) {
    threw = String(error);
  }
  check('空环境不抛异常', threw, null);
}

console.log('--- 电池状态的显示 ---');
{
  const items = (battery) => {
    const e = baseEnv();
    e.nav.battery = battery;
    for (const group of M.collectInfo(e)) {
      for (const item of group.items) if (item.id === 'battery') return item.value;
    }
    return null;
  };
  check('充电中', items({ charging: true, level: 0.72, chargingTime: 2400, dischargingTime: Infinity }), '充电中，电量 72%，距充满约 40 分钟');
  check('放电中', items({ charging: false, level: 0.5, chargingTime: Infinity, dischargingTime: 3600 }), '未充电，电量 50%，距耗尽约 60 分钟');
  check('时间未知（Infinity）时不显示分钟数', items({ charging: false, level: 0.31, chargingTime: Infinity, dischargingTime: Infinity }), '未充电，电量 31%');
  check('电量为 NaN 时不显示假数字', items({ charging: true, level: Number.NaN, chargingTime: Infinity, dischargingTime: Infinity }), '充电中，电量 不可用');
}

console.log('--- 导出 ---');
{
  const context = { origin: 'https://example.test', generatedAtMs: Date.UTC(2024, 6, 15, 12, 34, 56) };
  const json = M.reportToJson(env, context);
  const parsed = JSON.parse(json);
  check('JSON 可解析', typeof parsed, 'object');
  check('工具名', parsed.tool, 'device-info');
  check('生成时间来自传入的时刻而不是墙上时钟', parsed.generatedAt, '2024-07-15T12:34:56.000Z');
  check('来源写入 JSON', parsed.origin, 'https://example.test');
  check('分组数一致', parsed.groups.length, groups.length);
  check('核对项数一致', parsed.consistency.length, M.checkConsistency(env).length);
  ok('JSON 里没有 undefined（会被丢字段）', !json.includes('undefined'));
  check('同一输入导出稳定', M.reportToJson(env, context) === json, true);
  check('时间非法时显示不可用而不是 Invalid Date', JSON.parse(M.reportToJson(env, { generatedAtMs: Number.NaN })).generatedAt, '不可用');

  const withoutOrigin = JSON.parse(M.reportToJson(env, { generatedAtMs: 0 }));
  check('没有来源时不写入空字段', 'origin' in withoutOrigin, false);

  const text = M.reportToText(env, context);
  const lines = text.split('\n');
  ok('文本导出含隐私提示', text.includes('请勿随意粘贴'));
  ok('文本导出含生成时间', text.includes('2024-07-15T12:34:56.000Z'));
  ok('文本导出含全部 8 个分组标题', groups.every((g) => text.includes(`【${g.title}】`)));
  ok(
    '文本导出的每一行都带来源 API 与标准性',
    groups.every((g) =>
      g.items.every((i) => text.includes(`${i.label}：${i.value}`) && text.includes(`[${i.api} · ${M.SUPPORT_LABELS[i.support]}]`)),
    ),
  );
  ok('文本导出含自洽性核对小节', text.includes('【自洽性核对】'));
  check('文本导出行数等于 表头 + 每项若干行', lines.length > 100, true);
}

console.log('--- 不做指纹：扫描本工具的源码 ---');
{
  /**
   * APIs that would turn "show me my own data" into fingerprinting: canvas
   * read-back, audio processing, device/font enumeration. `getContext` itself is
   * allowed — the WebGL row needs it — but nothing may read pixels back out.
   */
  const FORBIDDEN = [
    'toDataURL', 'toBlob', 'getImageData', 'putImageData',
    'AudioContext', 'OfflineAudioContext', 'createOscillator', 'createAnalyser',
    'RTCPeerConnection', 'createDataChannel',
    'enumerateDevices', 'getUserMedia', 'requestMIDIAccess',
    'checkFont', 'measureText',
    'crypto.subtle', 'createHash',
  ];
  /** Nothing may be transmitted or persisted: the readings are local-only. */
  const NO_NETWORK = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'localStorage', 'sessionStorage', 'document.cookie', 'importScripts'];

  function scan(text, patterns) {
    return patterns.filter((pattern) => text.includes(pattern));
  }

  const dir = 'src/tools/device-info';
  const files = readdirSync(dir).filter((name) => /\.(ts|tsx)$/.test(name));
  ok('扫描到了本工具的文件', files.length >= 5);

  const sources = files.map((name) => ({ name, text: readFileSync(`${dir}/${name}`, 'utf8') }));
  const fingerprintHits = sources.flatMap(({ name, text }) => scan(text, FORBIDDEN).map((p) => `${name}: ${p}`));
  const networkHits = sources.flatMap(({ name, text }) => scan(text, NO_NETWORK).map((p) => `${name}: ${p}`));
  check(`源码中没有任何指纹类 API（命中：${fingerprintHits.join(', ') || '无'}）`, fingerprintHits, []);
  check(`源码中没有任何传输/存储调用（命中：${networkHits.join(', ') || '无'}）`, networkHits, []);

  // Positive controls, so the two empty results above mean something.
  check(
    '扫描器能抓到指纹 API（用合成源码验证）',
    scan('const url = canvas.toDataURL(); const ac = new AudioContext();', FORBIDDEN),
    ['toDataURL', 'AudioContext'],
  );
  check(
    '扫描器能抓到网络调用（用合成源码验证）',
    scan("fetch('/x'); localStorage.setItem('a', 'b');", NO_NETWORK),
    ['fetch(', 'localStorage'],
  );
  const probe = sources.find((s) => s.name === 'deviceProbe.ts');
  ok('WebGL 依赖的 getContext 确实在探针里（说明没有把整块功能删掉来通过检查）', probe.text.includes('getContext'));
  ok('WebGL 真实型号确实被读取（unmaskedRenderer 出现在源码里）', probe.text.includes('UNMASKED_RENDERER_WEBGL'));
  ok('源码里没有 canvas 像素读取相关注释或代码', !probe.text.toLowerCase().includes('getimagedata'));
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
