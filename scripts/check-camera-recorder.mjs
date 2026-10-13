/**
 * Checks the camera recorder's pure logic.
 *
 * `getUserMedia` and `MediaRecorder` cannot run in Node, so they are deliberately
 * absent from `cameraRecorderUtils.ts` and are *not* exercised here. What is
 * checked is everything that decides what the user sees and gets: the elapsed
 * clock, the countdown, the limit parsing, the file name, the byte format and
 * the codec fallback order.
 *
 * Two claims get an independent reference rather than a restatement:
 *
 *   - Byte formatting is cross-checked against arithmetic (`Math.round`) and
 *     against `Intl.NumberFormat` on a table of hand-computed powers of 1024,
 *     so the implementation is not its own oracle.
 *   - The elapsed clock is checked against time read directly, and a naive
 *     accumulator is run alongside it to show the check would catch drift.
 *
 * The "nothing is uploaded" claim is checked by scanning the tool's own source
 * for every browser API that can send data anywhere, because it is a claim about
 * what the code does *not* contain.
 *
 * Usage: node scripts/check-camera-recorder.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const UTILS_PATH = 'src/tools/camera-recorder/cameraRecorderUtils.ts';
const COMPONENT_PATH = 'src/tools/camera-recorder/CameraRecorderTool.tsx';

const compiled = ts.transpileModule(readFileSync(UTILS_PATH, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/camera-recorder.mjs', compiled);
const M = await import(pathToFileURL('.verify/camera-recorder.mjs').href);

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok
        ? ''
        : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}

console.log('--- 时长格式化：边界 ---');
check('0 毫秒', M.formatDurationMs(0), '00:00');
check('不足一秒向下取整', M.formatDurationMs(999), '00:00');
check('一秒', M.formatDurationMs(1000), '00:01');
check('59 秒', M.formatDurationMs(59_000), '00:59');
check('60 秒进一分钟', M.formatDurationMs(60_000), '01:00');
check('59:59', M.formatDurationMs(3_599_000), '59:59');
check('一小时开始带小时位', M.formatDurationMs(3_600_000), '1:00:00');
check('1:01:01', M.formatDurationMs(3_661_000), '1:01:01');
check('100 小时', M.formatDurationMs(360_000_000), '100:00:00');
check('超长时长不溢出为科学计数法', M.formatDurationMs(1e12), '277777:46:40');
check('负数按 0 处理', M.formatDurationMs(-1), '00:00');
check('NaN 按 0 处理', M.formatDurationMs(Number.NaN), '00:00');
check('Infinity 按 0 处理', M.formatDurationMs(Number.POSITIVE_INFINITY), '00:00');

console.log('--- 时长解析：合法与非法 ---');
check('空字符串不是合法时长', M.parseDurationText(''), null);
check('只有空格', M.parseDurationText('   '), null);
check('字母', M.parseDurationText('abc'), null);
check('负数', M.parseDurationText('-5'), null);
check('小数', M.parseDurationText('1.5'), null);
check('秒位 60 非法', M.parseDurationText('1:60'), null);
check('四个字段非法', M.parseDurationText('1:2:3:4'), null);
check('纯秒数', M.parseDurationText('90'), 90_000);
check('MM:SS', M.parseDurationText('1:30'), 90_000);
check('HH:MM:SS', M.parseDurationText('1:00:00'), 3_600_000);
check('零', M.parseDurationText('0'), 0);
check('三位数分钟', M.parseDurationText('100:00'), 6_000_000);
check('超长小时数仍是安全整数', M.parseDurationText('100:00:00'), 360_000_000);
check('超过 7 位数字的字段返回 null 而不是溢出', M.parseDurationText('99999999'), null);
check('前导零', M.parseDurationText('01:05'), 65_000);

console.log('--- 格式化与解析往返 ---');
{
  let mismatches = 0;
  let samples = 0;
  // Whole seconds only: formatting truncates to the second, so the round trip
  // is defined on second boundaries.
  for (let seconds = 0; seconds <= 6 * 3600; seconds += 7) {
    samples += 1;
    const ms = seconds * 1000;
    if (M.parseDurationText(M.formatDurationMs(ms)) !== ms) mismatches += 1;
  }
  // The boundaries the sweep can step over.
  for (const seconds of [59, 60, 61, 3599, 3600, 3601, 86_399, 86_400]) {
    samples += 1;
    if (M.parseDurationText(M.formatDurationMs(seconds * 1000)) !== seconds * 1000) mismatches += 1;
  }
  check(`${samples} 个取值上 format→parse 往返精确`, mismatches, 0);
}

console.log('--- 时长上限字段 ---');
check('空字段表示不限', M.limitMsFromText(''), { ok: true, limitMs: null });
check('只有空格也表示不限', M.limitMsFromText('  '), { ok: true, limitMs: null });
check('0 表示不限（否则会立刻自动停止）', M.limitMsFromText('0'), { ok: true, limitMs: null });
check('90 秒', M.limitMsFromText('90'), { ok: true, limitMs: 90_000 });
check('1:30', M.limitMsFromText('1:30'), { ok: true, limitMs: 90_000 });
check('无法识别时报告失败而不是猜', M.limitMsFromText('两分钟'), { ok: false });

console.log('--- 剩余时长与自动停止 ---');
check('不限时没有剩余值', M.remainingMs(null, 5000), null);
check('上限为 0 视为不限', M.remainingMs(0, 5000), null);
check('负上限视为不限', M.remainingMs(-1000, 5000), null);
check('NaN 上限视为不限', M.remainingMs(Number.NaN, 0), null);
check('刚起步时剩余等于上限', M.remainingMs(60_000, 0), 60_000);
check('录制中剩余递减', M.remainingMs(60_000, 45_000), 15_000);
check('恰好到点剩余为 0', M.remainingMs(60_000, 60_000), 0);
check('超时后剩余被夹到 0（不出现负数）', M.remainingMs(60_000, 90_000), 0);
check('负读数被夹到 0', M.remainingMs(60_000, -100), 60_000);

check('不限时永不自动停止', M.shouldAutoStop(null, 10 ** 9), false);
check('差一毫秒不停止', M.shouldAutoStop(60_000, 59_999), false);
check('恰好到点停止', M.shouldAutoStop(60_000, 60_000), true);
check('超过上限停止', M.shouldAutoStop(60_000, 60_001), true);
check('超长时长上限也能停止', M.shouldAutoStop(360_000_000, 360_000_001), true);

console.log('--- 计时基准：不依赖定时器累加 ---');
{
  const clock = M.clockStart(M.createClock(), 0);
  let worst = 0;
  for (let i = 1; i <= 1000; i += 1) {
    const trueTime = i * 3600;
    const readAt = trueTime + (i % 11) * 37;
    worst = Math.max(worst, Math.abs(M.clockElapsed(clock, readAt) - readAt));
  }
  check('一小时内读数与真实时间完全一致（读数由时间戳推导）', worst, 0);
  check('锚定实现在一小时后读数精确', M.clockElapsed(clock, 3_600_000), 3_600_000);

  // The naive version: add a nominal 200 ms per tick while ticks actually
  // arrive 0.9 ms late, which is ordinary for setInterval and much worse in a
  // throttled background tab. Over an hour that is several seconds of error —
  // enough to record past the user's limit.
  const NOMINAL = 200;
  const ACTUAL = 200.9;
  const HOUR = 3_600_000;
  const naive = Math.floor(HOUR / ACTUAL) * NOMINAL;
  check('朴素累加实现一小时会少算十几秒（证明本检查能抓到该缺陷）', HOUR - naive > 15_000, true);
  check('朴素实现的误差方向是“越走越慢”', naive < HOUR, true);

  // A clock read before its anchor must not go negative.
  const skewed = M.clockStart(M.createClock(), 10_000);
  check('时间戳早于锚点时读数按 0 处理', M.clockElapsed(skewed, 5_000), 0);
}

console.log('--- 开始 / 暂停 / 继续 / 重置 ---');
{
  let clock = M.createClock();
  check('初始不在计时', M.clockIsRunning(clock), false);
  check('初始读数为 0', M.clockElapsed(clock, 1234), 0);

  clock = M.clockStart(clock, 1000);
  check('开始后计时中', M.clockIsRunning(clock), true);
  check('开始 2 秒后的读数', M.clockElapsed(clock, 3000), 2000);

  clock = M.clockPause(clock, 3000);
  check('暂停后不在计时', M.clockIsRunning(clock), false);
  check('暂停期间读数不增长', M.clockElapsed(clock, 999_999), 2000);

  clock = M.clockStart(clock, 999_999);
  check('继续后接着累加', M.clockElapsed(clock, 1_000_999), 3000);

  const again = M.clockStart(clock, 2_000_000);
  check('对已在计时的时钟再调 start 不重置锚点', M.clockElapsed(again, 1_001_500), 3501);
  check('重复 start 返回同一对象', again === clock, true);

  const pausedOnce = M.clockPause(clock, 1_002_000);
  const pausedAgain = M.clockPause(pausedOnce, 6_000_000);
  check('重复 pause 不改变读数', M.clockElapsed(pausedAgain, 9_999_999), 4001);
  check('重复 pause 返回同一对象', pausedAgain === pausedOnce, true);

  check('重置后读数归零', M.clockElapsed(M.clockReset(), 5000), 0);
  check('重置后不在计时', M.clockIsRunning(M.clockReset()), false);
}

console.log('--- 大小格式化：与独立算式和 Intl.NumberFormat 对照 ---');
{
  // Hand-computed powers of 1024, the definition of the binary units used.
  check('0 字节', M.formatBytes(0), '0 B');
  check('负数按 0 处理', M.formatBytes(-1), '0 B');
  check('NaN 按 0 处理', M.formatBytes(Number.NaN), '0 B');
  check('Infinity 按 0 处理', M.formatBytes(Number.POSITIVE_INFINITY), '0 B');
  check('1023 字节仍是字节', M.formatBytes(1023), '1023 B');
  check('1024 字节 = 1 KB', M.formatBytes(1024), '1 KB');
  check('1536 字节 = 1.5 KB', M.formatBytes(1536), '1.5 KB');
  check('1048576 字节 = 1 MB', M.formatBytes(1024 ** 2), '1 MB');
  check('1073741824 字节 = 1 GB', M.formatBytes(1024 ** 3), '1 GB');
  check('1099511627776 字节 = 1 TB', M.formatBytes(1024 ** 4), '1 TB');
  check('超出 TB 后不引入千分位', M.formatBytes(1024 ** 5), '1024 TB');
  check('半小时 720p 录像量级', M.formatBytes(180 * 1024 * 1024), '180 MB');

  // Independent arithmetic, written without looking at the implementation.
  function referenceFormatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    let unit = 0;
    while (unit < units.length - 1 && bytes >= 1024 ** (unit + 1)) unit += 1;
    const value = bytes / 1024 ** unit;
    if (unit === 0) return `${Math.round(value)} B`;
    return `${Math.round(value * 10) / 10} ${units[unit]}`;
  }

  let mismatchesArithmetic = 0;
  let samples = 0;
  for (let bytes = 0; bytes <= 300_000; bytes += 7) {
    samples += 1;
    if (M.formatBytes(bytes) !== referenceFormatBytes(bytes)) mismatchesArithmetic += 1;
  }
  for (const bytes of [1, 1023, 1024, 1025, 1_500_000, 9_999_999, 123_456_789, 1024 ** 4 - 1]) {
    samples += 1;
    if (M.formatBytes(bytes) !== referenceFormatBytes(bytes)) mismatchesArithmetic += 1;
  }
  check(`${samples} 个取值上与独立算式一致`, mismatchesArithmetic, 0);

  // Same claim, different reference: the platform's own formatter.
  const intl = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, useGrouping: false });
  let mismatchesIntl = 0;
  let intlSamples = 0;
  for (let exponent = 1; exponent <= 4; exponent += 1) {
    for (let step = 10; step <= 200; step += 7) {
      const value = step / 10;
      const bytes = Math.round(value * 1024 ** exponent);
      const unit = ['B', 'KB', 'MB', 'GB', 'TB'][exponent];
      intlSamples += 1;
      if (M.formatBytes(bytes) !== `${intl.format(bytes / 1024 ** exponent)} ${unit}`) {
        mismatchesIntl += 1;
      }
    }
  }
  check(`${intlSamples} 个取值上与 Intl.NumberFormat 一致`, mismatchesIntl, 0);
}

console.log('--- MIME 类型回退顺序 ---');
{
  check('候选列表非空', M.MIME_CANDIDATES.length > 0, true);
  check('优先 VP9', M.chooseMimeType(() => true), 'video/webm;codecs=vp9,opus');
  check(
    'VP9 不支持时退到 VP8',
    M.chooseMimeType((mime) => !mime.includes('vp9')),
    'video/webm;codecs=vp8,opus',
  );
  check(
    '只支持裸 webm 时选它',
    M.chooseMimeType((mime) => mime === 'video/webm'),
    'video/webm',
  );
  check(
    '只支持 MP4 时（Safari 场景）选 MP4',
    M.chooseMimeType((mime) => mime === 'video/mp4'),
    'video/mp4',
  );
  check('全部不支持时返回空串，交给浏览器自行决定', M.chooseMimeType(() => false), '');
  check(
    '判定函数抛异常时按不支持处理',
    M.chooseMimeType(() => {
      throw new Error('boom');
    }),
    '',
  );
  check('候选列表里同时含 webm 与 mp4（兼容 Safari）', [
    M.MIME_CANDIDATES.some((mime) => mime.startsWith('video/webm')),
    M.MIME_CANDIDATES.some((mime) => mime.startsWith('video/mp4')),
  ], [true, true]);

  check('录音时允许带 opus 的候选', M.isMimeAllowedFor('video/webm;codecs=vp9,opus', true), true);
  check('不录音时排除 opus 候选', M.isMimeAllowedFor('video/webm;codecs=vp9,opus', false), false);
  check('不录音时保留纯视频候选', M.isMimeAllowedFor('video/webm;codecs=vp9', false), true);
  check('不录音时排除纯音频候选', M.isMimeAllowedFor('audio/webm;codecs=opus', false), false);

  check('webm 扩展名', M.extensionForMime('video/webm;codecs=vp9,opus'), 'webm');
  check('mp4 扩展名', M.extensionForMime('video/mp4'), 'mp4');
  check('mp4 带参数', M.extensionForMime('video/mp4;codecs=avc1.42E01E'), 'mp4');
  check('大小写不敏感', M.extensionForMime('VIDEO/WEBM'), 'webm');
  check('ogg 扩展名', M.extensionForMime('video/ogg'), 'ogv');
  check('空 MIME 回退 webm', M.extensionForMime(''), 'webm');
  check('非法 MIME 回退 webm', M.extensionForMime('nonsense'), 'webm');
}

console.log('--- 文件名生成 ---');
{
  const FIXED_TIME = Date.UTC(2024, 5, 7, 12, 34, 56, 789);
  const name = M.buildFileName('camera-recording', FIXED_TIME, 'webm');
  check('文件名以 .webm 结尾', name.endsWith('.webm'), true);
  check(
    '文件名只含合法字符',
    /^[A-Za-z0-9._-]+$/.test(name),
    true,
  );
  check('不包含任何路径分隔符', !/[\\/]/.test(name), true);
  check(
    '时间戳可读且不含冒号',
    name,
    'camera-recording-2024-06-07T12-34-56-789Z.webm',
  );
  check(
    '非法前缀被清理（Windows 保留字符与控制字符）',
    M.buildFileName('a/b\\c:d*e?f"g<h>i|j\u0001k', FIXED_TIME, 'webm').startsWith('a-b-c-d-e-f-g-h-i-j-k-'),
    true,
  );
  check(
    '前缀中的空白折叠为连字符',
    M.buildFileName('我的  录像  1', FIXED_TIME, 'webm').startsWith('我的-录像-1-'),
    true,
  );
  check('空前缀回退到 recording', M.buildFileName('', FIXED_TIME, 'webm').startsWith('recording-'), true);
  check(
    '只有非法字符的前缀回退到 recording',
    M.buildFileName('///', FIXED_TIME, 'webm').startsWith('recording-'),
    true,
  );
  check(
    '非法时间戳不抛异常且标记为 unknown-time',
    M.buildFileName('cam', Number.NaN, 'webm'),
    'cam-unknown-time.webm',
  );
  check('非法扩展名回退 webm', M.buildFileName('cam', FIXED_TIME, 'exe!').endsWith('.webm'), true);
  check('大写扩展名被拒绝并回退', M.buildFileName('cam', FIXED_TIME, 'WEBM').endsWith('.webm'), true);
  check(
    '超长前缀被截断到 60 字符以内',
    M.sanitizeFileNamePart('x'.repeat(200)).length,
    60,
  );
  check('首尾的点与连字符被去掉', M.sanitizeFileNamePart('...a...'), 'a');
  check('非法前缀清理后不含控制字符', /[\u0000-\u001f]/.test(M.sanitizeFileNamePart('a\u0001b')), false);
}

console.log('--- 安全上下文判定 ---');
check('http 页面：先报安全上下文问题', M.describeContextStatus(false, false), 'insecure');
check('http 页面即使 API 存在也报安全上下文问题', M.describeContextStatus(false, true), 'insecure');
check('安全页面但缺少 API：报不支持', M.describeContextStatus(true, false), 'unsupported');
check('安全页面且有 API：可用', M.describeContextStatus(true, true), 'ok');

console.log('--- 权限与设备错误说明 ---');
{
  const names = [
    ['NotAllowedError', 'denied'],
    ['PermissionDeniedError', 'denied'],
    ['NotFoundError', 'not-found'],
    ['DevicesNotFoundError', 'not-found'],
    ['NotReadableError', 'busy'],
    ['TrackStartError', 'busy'],
    ['OverconstrainedError', 'constraints'],
    ['ConstraintNotSatisfiedError', 'constraints'],
    ['SecurityError', 'insecure'],
    ['TypeError', 'unsupported'],
    ['', 'unknown'],
    ['SomeFutureError', 'unknown'],
  ];
  const wrongKinds = [];
  const emptyHints = [];
  for (const [name, kind] of names) {
    const explained = M.explainMediaError(name, '');
    if (explained.kind !== kind) wrongKinds.push(`${name} → ${explained.kind}`);
    if (explained.title === '' || explained.detail === '' || explained.retry === '') {
      emptyHints.push(name);
    }
  }
  check(`${names.length} 种错误名映射到正确的类别`, wrongKinds, []);
  check('每种说明都给出了标题、详情与重试方式', emptyHints, []);

  const denied = M.explainMediaError('NotAllowedError', 'Permission denied');
  check('拒绝授权时说明里包含如何恢复权限', /网站设置|权限/.test(denied.retry), true);
  check('拒绝授权时保留浏览器原文', denied.detail.includes('Permission denied'), true);

  const insecure = M.explainMediaError('SecurityError', '');
  check('安全上下文错误的提示指向 https/localhost', /https|localhost/i.test(insecure.retry), true);

  const busy = M.explainMediaError('NotReadableError', '');
  check('设备占用错误的提示要求关闭其它占用程序', /关闭|占用/.test(busy.retry), true);
  check('空消息不会产生空的括号', M.explainMediaError('NotAllowedError', '').detail.endsWith('。'), true);
}

console.log('--- 设备名回退 ---');
check('无标签时按序号命名（摄像头）', M.deviceOptionLabel(undefined, 'video', 0), '摄像头 1');
check('无标签时按序号命名（麦克风）', M.deviceOptionLabel('', 'audio', 2), '麦克风 3');
check('标签为 default 时按序号命名', M.deviceOptionLabel('default', 'video', 0), '摄像头 1');
check('有标签时用标签', M.deviceOptionLabel('Logitech C920', 'video', 0), 'Logitech C920');
check('标签首尾空白被去掉', M.deviceOptionLabel('  HD Webcam  ', 'video', 1), 'HD Webcam');

console.log('--- 「不上传」：源码里不存在任何外发 API ---');
{
  /**
   * Comments are removed before scanning. The code has to be free of these
   * calls; prose that explains the absence of an upload is not a violation, and
   * the type checker's own comment stripper is more reliable here than a regex
   * that a URL containing a slash pair would confuse.
   */
  function codeWithoutComments(file) {
    return ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        removeComments: true,
      },
    }).outputText;
  }

  const files = [
    UTILS_PATH,
    COMPONENT_PATH,
    'src/tools/camera-recorder/manifest.ts',
    'src/tools/camera-recorder/index.ts',
  ];
  /**
   * Every browser API that can send bytes off the machine. `fetch` and
   * `XMLHttpRequest` are the obvious ones; `sendBeacon`, `WebSocket` and
   * `EventSource` are the quieter channels.
   */
  const uploadApis = [
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /sendBeacon/,
    /\bWebSocket\b/,
    /\bEventSource\b/,
    /\bFormData\b/,
    /navigator\s*\.\s*onLine/,
  ];

  const offences = [];
  const code = new Map();
  for (const file of files) {
    const stripped = codeWithoutComments(file);
    code.set(file, stripped);
    for (const pattern of uploadApis) {
      if (pattern.test(stripped)) offences.push(`${file} 命中 ${pattern}`);
    }
  }
  check(
    `${files.length} 个文件的代码里没有任何上传/外发 API（fetch、XHR、sendBeacon、WebSocket、EventSource）`,
    offences,
    [],
  );

  const componentCode = code.get(COMPONENT_PATH);
  check('组件里确实使用了 getUserMedia', componentCode.includes('getUserMedia'), true);
  check('组件里确实使用了 MediaRecorder', componentCode.includes('MediaRecorder'), true);
  check('录制结果通过 createObjectURL 下载', componentCode.includes('createObjectURL'), true);
  check(
    'Blob 地址在替换与卸载时被释放',
    (componentCode.match(/revokeObjectURL/g) ?? []).length >= 2,
    true,
  );
  check('拒绝了不是 https/localhost 的上下文并给出说明', componentCode.includes('isSecureContext'), true);

  // Pure logic must stay pure: the browser APIs and React stay out of the utils.
  // The patterns are call/construction sites, so a user-facing message that
  // merely names an API is not confused with using it.
  const utilsCode = code.get(UTILS_PATH);
  check('纯函数文件不导入 React', /from ['"]react['"]/.test(utilsCode), false);
  check('纯函数文件不调用 getUserMedia', /\bgetUserMedia\s*\(/.test(utilsCode), false);
  check('纯函数文件不构造 MediaRecorder', /new\s+MediaRecorder/.test(utilsCode), false);
  check('纯函数文件不访问 navigator.mediaDevices', /navigator\s*\.\s*mediaDevices/.test(utilsCode), false);
  check('纯函数文件不触碰 document', /\bdocument\s*\./.test(utilsCode), false);
  check('纯函数文件不读取时间（时间由调用方传入）', /\b(Date\.now|performance\.now)\s*\(/.test(utilsCode), false);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
