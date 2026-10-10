/**
 * Checks the User-Agent parser.
 *
 * The oracle is a set of real UA strings that can be checked against the
 * vendors' own documentation (Chrome's UA reduction guide, Apple's and
 * Googlebot's published strings). Each is asserted to a fixed expected value,
 * not to "whatever the parser currently says".
 *
 * Two claims are defended specifically:
 *
 *   1. The priority order is necessary. `naiveChromeCheck` (a plain
 *      `indexOf('Chrome')`) is run over the Edge / Opera / Samsung samples and
 *      asserted to give the *wrong* answer, which is what forces the ordered
 *      rule list.
 *   2. Malformed input is never forced into a browser. Empty, symbolic,
 *      over-long, nested-paren and emoji inputs must come back unrecognised
 *      with null fields.
 *
 * Usage: node scripts/check-user-agent-parser.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/user-agent-parser/userAgentParserUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/user-agent-parser.mjs', compiled);
const M = await import(pathToFileURL('.verify/user-agent-parser.mjs').href);

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

const byLabel = (label) => {
  const sample = M.UA_SAMPLES.find((s) => s.label === label);
  if (!sample) throw new Error(`没有这个样本：${label}`);
  return M.parseUserAgent(sample.ua);
};

console.log('--- 样本本身 ---');
{
  check('样本数量足够（>= 20）', M.UA_SAMPLES.length >= 20, true);
  check(
    '样本 UA 字符串互不重复',
    M.UA_SAMPLES.length - new Set(M.UA_SAMPLES.map((s) => s.ua)).size,
    0,
  );
  check(
    '样本标签互不重复',
    M.UA_SAMPLES.length - new Set(M.UA_SAMPLES.map((s) => s.label)).size,
    0,
  );
  check('每个样本都写了它要演示什么', M.UA_SAMPLES.every((s) => s.note.length > 0), true);

  const notRecognized = M.UA_SAMPLES.filter((s) => !M.parseUserAgent(s.ua).recognized).map((s) => s.label);
  check('所有内置样本都能被识别', notRecognized, []);

  // A CLI client has no OS or engine, and a bare crawler has no browser token;
  // everything else must yield a browser, an OS and an engine.
  const CLI_NAMES = new Set(['curl', 'Wget', 'python-requests', 'Python urllib', 'Go-http-client', 'node-fetch', 'OkHttp', 'Postman']);
  const incomplete = [];
  for (const sample of M.UA_SAMPLES) {
    const parsed = M.parseUserAgent(sample.ua);
    if (!parsed.browser && !parsed.isBot) incomplete.push(`${sample.label}: 没有浏览器`);
    if (parsed.browser && !CLI_NAMES.has(parsed.browser.name) && !parsed.isBot) {
      if (!parsed.os) incomplete.push(`${sample.label}: 没有操作系统`);
      if (!parsed.engine) incomplete.push(`${sample.label}: 没有渲染引擎`);
      if (parsed.device.type === 'unknown') incomplete.push(`${sample.label}: 设备类型未知`);
    }
  }
  check('非爬虫样本的浏览器/系统/引擎/设备字段都非空', incomplete, []);
}

console.log('--- 固定值断言：逐款浏览器 ---');
{
  const chrome = byLabel('Chrome 120 · Windows');
  check('Chrome 名称', chrome.browser, { name: 'Chrome', version: '120.0.0.0' });
  check('Chrome 引擎推断为 Blink', chrome.engine, { name: 'Blink', version: '537.36', inferred: true });
  check('Chrome 操作系统', chrome.os, { name: 'Windows', version: '10.0 · 10 或 11（UA 无法区分）' });
  check('Chrome 设备类型', chrome.device.type, 'desktop');
  check('Chrome CPU 架构', chrome.cpu, { architecture: 'x86', bits: '64' });
  check('Chrome 不是爬虫', chrome.isBot, false);

  const edge = byLabel('Edge 120 · Windows');
  check('Edge 被识别为 Edge 而不是 Chrome', edge.browser, { name: 'Microsoft Edge', version: '120.0.0.0' });
  check('Edge 引擎是 Blink', edge.engine.name, 'Blink');
  check('Edge 的 UA 里确实含 Chrome 字样', edge.raw.includes('Chrome/'), true);

  const opera = byLabel('Opera 105 · Windows');
  check('Opera 被识别为 Opera', opera.browser, { name: 'Opera', version: '105.0.0.0' });
  check('Opera 的 UA 里确实含 Chrome 字样', opera.raw.includes('Chrome/'), true);

  const samsung = byLabel('Samsung Internet 23 · Android');
  check('三星浏览器被识别', samsung.browser, { name: 'Samsung Internet', version: '23.0' });
  check('三星设备是手机', samsung.device.type, 'mobile');
  check('三星型号取自 UA', samsung.device.model, 'SM-S918B');
  check('三星系统是 Android 13', samsung.os, { name: 'Android', version: '13' });

  const firefox = byLabel('Firefox 121 · Windows');
  check('Firefox 名称与版本', firefox.browser, { name: 'Firefox', version: '121.0' });
  check('Firefox 引擎是 Gecko', firefox.engine, { name: 'Gecko', version: '121.0', inferred: false });

  const safariMac = byLabel('Safari 17 · macOS');
  check('Safari 版本取自 Version/ 而不是 Safari/ 构建号', safariMac.browser, { name: 'Safari', version: '17.2' });
  check('Safari 引擎是 WebKit 605.1.15', safariMac.engine, { name: 'WebKit', version: '605.1.15', inferred: false });
  check('macOS 版本被冻结为 10.15.7', safariMac.os, { name: 'macOS', version: '10.15.7' });
  check('macOS 是桌面', safariMac.device.type, 'desktop');

  const safariIos = byLabel('Safari 17 · iPhone');
  check('iOS 系统名', safariIos.os, { name: 'iOS', version: '17.2' });
  check('iPhone 是手机', safariIos.device, { type: 'mobile', vendor: 'Apple', model: 'iPhone' });

  const ipad = byLabel('iPad · iPadOS 16');
  check('iPad 系统名是 iPadOS 而不是 iOS', ipad.os, { name: 'iPadOS', version: '16.6' });
  check('iPad 是平板', ipad.device.type, 'tablet');

  const chromeAndroid = byLabel('Chrome 120 · Android（缩减后）');
  check('缩减后系统仍写 Android 10', chromeAndroid.os, { name: 'Android', version: '10' });
  check('缩减后型号是 K', chromeAndroid.device.model, 'K');
  check('缩减后设备仍是手机', chromeAndroid.device.type, 'mobile');

  const ie = byLabel('Internet Explorer 11 · Windows 7');
  check('IE 版本', ie.browser, { name: 'Internet Explorer', version: '11.0' });
  check('IE 引擎 Trident 7.0', ie.engine, { name: 'Trident', version: '7.0', inferred: false });
  check('Windows 7 由 NT 6.1 推出', ie.os, { name: 'Windows', version: '6.1 · 7' });

  const curl = byLabel('curl 8.4（命令行）');
  check('curl 被识别为 curl', curl.browser, { name: 'curl', version: '8.4.0' });
  check('curl 设备类型是命令行', curl.device.type, 'cli');
  check('curl 没有操作系统', curl.os, null);
  check('curl 没有渲染引擎', curl.engine, null);
}

console.log('--- 爬虫 ---');
{
  const googlebot = byLabel('Googlebot 2.1（桌面）');
  check('Googlebot 标为爬虫', googlebot.isBot, true);
  check('Googlebot 名称与版本', googlebot.bot, { name: 'Googlebot', version: '2.1' });
  check('Googlebot 设备类型是爬虫', googlebot.device.type, 'bot');
  check('桌面 Googlebot 没有浏览器 token', googlebot.browser, null);

  const googlebotMobile = byLabel('Googlebot 智能手机（含 Chrome）');
  check('智能手机 Googlebot 也标为爬虫', googlebotMobile.isBot, true);
  check('但它的浏览器字段会被解析成 Chrome（说明浏览器字段不能当证据）', googlebotMobile.browser?.name, 'Chrome');
  check('设备类型仍是爬虫而不是手机', googlebotMobile.device.type, 'bot');

  const bing = byLabel('bingbot 2.0');
  check('bingbot 名称', bing.bot, { name: 'Bingbot', version: '2.0' });
  check('bingbot 是爬虫', bing.isBot, true);

  const gpt = byLabel('GPTBot 1.1');
  check('GPTBot 名称与版本', gpt.bot, { name: 'GPTBot', version: '1.1' });
  check('GPTBot 是爬虫', gpt.isBot, true);

  const facebook = byLabel('facebookexternalhit 1.1');
  check('facebookexternalhit 是爬虫', facebook.isBot, true);
  check('facebookexternalhit 设备类型是爬虫', facebook.device.type, 'bot');
}

console.log('--- 反证：朴素 indexOf("Chrome") 一定是错的 ---');
{
  const cases = [
    ['Edge 120 · Windows', 'Microsoft Edge'],
    ['Opera 105 · Windows', 'Opera'],
    ['Samsung Internet 23 · Android', 'Samsung Internet'],
    ['Yandex Browser 23.11 · Windows', 'Yandex Browser'],
  ];
  const naiveWrong = [];
  for (const [label, expected] of cases) {
    const ua = M.UA_SAMPLES.find((s) => s.label === label).ua;
    const naive = M.naiveChromeCheck(ua);
    const parsed = M.parseUserAgent(ua).browser?.name;
    if (naive !== 'Chrome' || parsed !== expected) {
      naiveWrong.push(`${label}: 朴素=${naive} 解析=${parsed}`);
    }
  }
  check('四款内嵌 Chrome 的浏览器都被朴素判断误判为 Chrome，而解析器给出了品牌名', naiveWrong, []);

  // The naive check is not simply "always wrong": on a real Chrome UA it agrees.
  const realChrome = M.UA_SAMPLES.find((s) => s.label === 'Chrome 120 · Windows').ua;
  check('朴素判断在真 Chrome 上给出 Chrome（否则这个反证没有意义）', M.naiveChromeCheck(realChrome), 'Chrome');
}

console.log('--- 诚实标注：伪造与 UA Reduction ---');
{
  const chrome = byLabel('Chrome 120 · Windows');
  check('Chrome 缩减警告存在', chrome.warnings.some((w) => w.includes('UA Reduction')), true);
  check('Windows 10/11 无法区分被点明', chrome.warnings.some((w) => w.includes('Windows 11')), true);

  const safariMac = byLabel('Safari 17 · macOS');
  check('Safari 冻结 macOS 版本被点明', safariMac.warnings.some((w) => w.includes('10_15_7')), true);

  const chromeAndroid = byLabel('Chrome 120 · Android（缩减后）');
  check('Android 10 / 型号 K 的匿名化被点明', chromeAndroid.warnings.some((w) => w.includes('Android 10')), true);

  for (const [label, parsed] of [
    ['Chrome 120 · Windows', chrome],
    ['Googlebot 2.1（桌面）', byLabel('Googlebot 2.1（桌面）')],
    ['curl 8.4（命令行）', byLabel('curl 8.4（命令行）')],
  ]) {
    check(`${label} 始终提示 UA 可伪造`, parsed.warnings.some((w) => w.includes('伪造')), true);
    check(`${label} 始终提示不能用 UA 做安全判断`, parsed.warnings.some((w) => w.includes('安全判断')), true);
    check(`${label} 提示 Client Hints 替代方案`, parsed.warnings.some((w) => w.includes('Client Hints')), true);
  }

  const bing = byLabel('bingbot 2.0');
  check('爬虫警告里点明不能只靠 UA 反爬', bing.warnings.some((w) => w.includes('反向 DNS')), true);

  // A hand-forged string parses fine — which is the point of the caveat.
  const forged = M.parseUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/999.0.0.0 Safari/537.36',
  );
  check('伪造的 Chrome 999 照样被「成功」解析', forged.browser, { name: 'Chrome', version: '999.0.0.0' });
  check('但结果里带着「可伪造」的警告', forged.warnings.some((w) => w.includes('伪造')), true);
}

console.log('--- 无法识别时不许瞎猜 ---');
{
  const garbage = [
    ['空字符串', ''],
    ['只有空白', '   '],
    ['纯符号', '!!!@@@###$$$%%%'],
    ['嵌套括号', '((((((((((((('],
    ['右括号', '))))))))))'],
    ['emoji', '😀🎉🚀🥳'],
    ['中文', '这是一段中文，不是 User Agent'],
    ['无信息的 Mozilla 前缀', 'Mozilla/5.0 ('],
    ['超长重复字符', 'a'.repeat(100000)],
    ['超长符号', '@'.repeat(50000)],
  ];
  for (const [label, ua] of garbage) {
    const parsed = M.parseUserAgent(ua);
    check(`${label}：不崩且 recognized=false`, parsed.recognized, false);
    check(`${label}：不硬塞浏览器`, parsed.browser, null);
    check(`${label}：不硬塞系统`, parsed.os, null);
    check(`${label}：设备类型为 unknown`, parsed.device.type, 'unknown');
  }

  // Nested parentheses around real content must not break the surrounding
  // matches; the parser reads tokens, not a balanced tree.
  const nested = M.parseUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; (nested (deeper) parens)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  );
  check('嵌套括号不影响系统识别', nested.os?.name, 'Windows');
  check('嵌套括号不影响浏览器识别', nested.browser?.name, 'Chrome');

  check('null 入参安全', M.parseUserAgent(null).raw, '');
  check('数字入参安全', M.parseUserAgent(123).recognized, false);
  check('undefined 入参安全', M.parseUserAgent(undefined).recognized, false);
}

console.log('--- 分段高亮 ---');
{
  const edge = byLabel('Edge 120 · Windows');
  check('有分段', edge.segments.length > 0, true);
  check('分段按起点排序', edge.segments.map((s) => s.start), [...edge.segments.map((s) => s.start)].sort((a, b) => a - b));
  check('分段互不重叠', edge.segments.every((seg, i) => i === 0 || seg.start >= edge.segments[i - 1].end), true);
  check(
    '分段全部落在原始串范围内',
    edge.segments.every((seg) => seg.start >= 0 && seg.end <= edge.raw.length && seg.text === edge.raw.slice(seg.start, seg.end)),
    true,
  );
  check('分段里出现了品牌名', edge.segments.some((s) => s.label === 'Microsoft Edge'), true);
  check('分段里出现了操作系统', edge.segments.some((s) => s.kind === 'os' && s.label === 'Windows'), true);
  check('分段里出现了 CPU', edge.segments.some((s) => s.kind === 'cpu'), true);

  const bot = byLabel('Googlebot 2.1（桌面）');
  check('爬虫 UA 有 bot 分段', bot.segments.some((s) => s.kind === 'bot'), true);
  check('bot 分段覆盖 Googlebot/2.1', bot.segments.some((s) => s.kind === 'bot' && s.text.includes('Googlebot/2.1')), true);

  check('无法识别的串没有分段', M.parseUserAgent('!!!!').segments, []);
}

console.log('--- 设备类型标签完整 ---');
{
  const types = Object.keys(M.DEVICE_TYPE_LABELS);
  check('标签覆盖 8 种设备类型', types.length, 8);
  check(
    '标签都是中文说明',
    types.every((t) => typeof M.DEVICE_TYPE_LABELS[t] === 'string' && M.DEVICE_TYPE_LABELS[t].length > 0),
    true,
  );
  check('包含桌面/手机/平板/爬虫', ['desktop', 'mobile', 'tablet', 'bot'].every((t) => types.includes(t)), true);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
