/**
 * Pure User-Agent parsing.
 *
 * ## What this can and cannot do
 *
 * A User-Agent string is a sequence of `<product>/<version>` tokens with
 * optional comments in parentheses, and it is written by the client. Nothing
 * forces it to be true: `curl -A "Mozilla/5.0 ... Chrome/999"` is a one-liner.
 * So every field this module produces is a *claim*, not a fact, and the result
 * carries that caveat explicitly. The parser never invents a browser for an
 * input it does not recognise; `recognized: false` with empty fields is the
 * honest answer.
 *
 * ## Why the rules are ordered, not just a bag of regexes
 *
 * Edge, Opera, Samsung Internet, Vivaldi and Yandex all ship a Chrome engine and
 * therefore all include `Chrome/…` in their UA. A naive `ua.includes('Chrome')`
 * labels every one of them "Chrome". The rule list below is therefore a fixed
 * priority order (the branded browser first, Chrome last among the Chromium
 * family), and the check script proves that the naive test really does give the
 * wrong answer on those strings.
 *
 * ## UA reduction is why some fields look wrong
 *
 * Modern browsers deliberately stopped telling the truth:
 *   - Chrome froze the minor/patch version (`Chrome/120.0.0.0`) and, on
 *     Android, reports `Android 10; K` for every newer release.
 *   - Safari froze the OS version at `10_15_7` and reports `Intel Mac OS X`
 *     even on Apple Silicon.
 *   - Chrome on Windows always says `Windows NT 10.0`, so Windows 10 and 11
 *     are indistinguishable.
 * The alternative is Client Hints (`Sec-CH-UA`, `Sec-CH-UA-Platform`,
 * `navigator.userAgentData`), which are structured and can be requested
 * selectively. The parser surfaces each of these cases as a warning instead of
 * presenting the reduced value as the truth.
 *
 * No DOM, no clock, no React: `parseUserAgent` is a pure string function.
 */

export type DeviceType =
  | 'desktop'
  | 'mobile'
  | 'tablet'
  | 'bot'
  | 'console'
  | 'tv'
  | 'cli'
  | 'unknown';

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  desktop: '桌面',
  mobile: '手机',
  tablet: '平板',
  bot: '爬虫/机器人',
  console: '游戏主机',
  tv: '电视/机顶盒',
  cli: '命令行/脚本',
  unknown: '无法判断',
};

export interface NamedVersion {
  name: string;
  /** The version as claimed in the string, or null when none was written. */
  version: string | null;
}

export interface UaEngine extends NamedVersion {
  /**
   * True when the engine was inferred from the browser rather than named in the
   * string. Blink is never written in a UA: Chrome-family UAs only expose
   * `AppleWebKit/…`, so calling the engine Blink is an inference.
   */
  inferred: boolean;
}

export interface UaCpu {
  architecture: string;
  /** '32' or '64' when the string says so, otherwise null. */
  bits: string | null;
}

export interface UaSegment {
  start: number;
  end: number;
  text: string;
  /** What the highlighted run was matched as. */
  label: string;
  kind: 'browser' | 'engine' | 'os' | 'device' | 'cpu' | 'bot';
}

export interface UaAnalysis {
  raw: string;
  browser: NamedVersion | null;
  engine: UaEngine | null;
  os: NamedVersion | null;
  device: {
    type: DeviceType;
    vendor: string | null;
    model: string | null;
  };
  cpu: UaCpu | null;
  isBot: boolean;
  bot: NamedVersion | null;
  segments: UaSegment[];
  warnings: string[];
  /** False when nothing at all could be identified. */
  recognized: boolean;
}

/* ------------------------------------------------------------------ helpers */

function firstMatch(raw: string, pattern: RegExp): RegExpExecArray | null {
  // A fresh regex per call: a shared /g/ literal would carry `lastIndex` across
  // calls and silently skip the second parse of the same string.
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags).exec(raw);
}

function segment(
  segments: UaSegment[],
  matched: RegExpExecArray | null,
  label: string,
  kind: UaSegment['kind'],
): void {
  if (!matched) return;
  const start = matched.index;
  const end = start + matched[0].length;
  // Keep the highlight runs non-overlapping so the UI can render them in one
  // pass; the first (highest-priority) rule wins the overlap.
  if (segments.some((existing) => start < existing.end && end > existing.start)) return;
  segments.push({ start, end, text: matched[0], label, kind });
}

/* ----------------------------------------------------------------- browser */

interface BrowserRule {
  name: string;
  pattern: RegExp;
  /** The family used for engine inference. */
  family: 'chromium' | 'gecko' | 'webkit' | 'trident' | 'edgehtml' | 'other';
}

/**
 * Priority order. Everything that embeds Chrome must come before Chrome.
 */
const BROWSER_RULES: BrowserRule[] = [
  { name: 'Microsoft Edge', pattern: /\bEdg(?:e|A|iOS)?\/([\d.]+)/i, family: 'chromium' },
  { name: 'Opera', pattern: /\b(?:OPR|OPT|Opera)[ /]([\d.]+)/i, family: 'chromium' },
  { name: 'Samsung Internet', pattern: /\bSamsungBrowser\/([\d.]+)/i, family: 'chromium' },
  { name: 'Yandex Browser', pattern: /\bYaBrowser\/([\d.]+)/i, family: 'chromium' },
  { name: 'Vivaldi', pattern: /\bVivaldi\/([\d.]+)/i, family: 'chromium' },
  { name: 'UC Browser', pattern: /\bUCBrowser\/([\d.]+)/i, family: 'chromium' },
  { name: 'Huawei Browser', pattern: /\bHuaweiBrowser\/([\d.]+)/i, family: 'chromium' },
  { name: 'Firefox', pattern: /\bFxiOS\/([\d.]+)/i, family: 'gecko' },
  { name: 'Firefox', pattern: /\bFirefox\/([\d.]+)/i, family: 'gecko' },
  { name: 'Chrome', pattern: /\bCriOS\/([\d.]+)/i, family: 'chromium' },
  { name: 'Chrome Headless', pattern: /\bHeadlessChrome\/([\d.]+)/i, family: 'chromium' },
  { name: 'Chrome', pattern: /\b(?:Chrome|Chromium)\/([\d.]+)/i, family: 'chromium' },
  // Safari writes its real version in `Version/…`; the `Safari/…` token is the
  // WebKit build number, which is not what users mean by "Safari 17".
  { name: 'Safari', pattern: /\bVersion\/([\d.]+)[^)]*Safari\//i, family: 'webkit' },
  { name: 'Internet Explorer', pattern: /\bMSIE ([\d.]+)/i, family: 'trident' },
  { name: 'Internet Explorer', pattern: /\bTrident\/[\d.]+;[^)]*\brv:([\d.]+)/i, family: 'trident' },
];

/** Non-browser clients. Reported as such rather than dressed up as a browser. */
const CLIENT_RULES: BrowserRule[] = [
  { name: 'curl', pattern: /\bcurl\/([\d.]+)/i, family: 'other' },
  { name: 'Wget', pattern: /\bWget\/([\d.]+)/i, family: 'other' },
  { name: 'python-requests', pattern: /\bpython-requests\/([\d.]+)/i, family: 'other' },
  { name: 'Python urllib', pattern: /\bPython-urllib\/([\d.]+)/i, family: 'other' },
  { name: 'Go-http-client', pattern: /\bGo-http-client\/([\d.]+)/i, family: 'other' },
  { name: 'node-fetch', pattern: /\bnode-fetch\/([\d.]+)/i, family: 'other' },
  { name: 'OkHttp', pattern: /\bokhttp\/([\d.]+)/i, family: 'other' },
  { name: 'Postman', pattern: /\bPostmanRuntime\/([\d.]+)/i, family: 'other' },
];

/* --------------------------------------------------------------------- bot */

/** Named crawlers. `order` is irrelevant; the whole list is checked. */
const BOT_RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Googlebot', pattern: /\bGooglebot(?:-Image|-Video|-News|-Mobile)?\/([\d.]+)/i },
  { name: 'Google Other', pattern: /\b(?:GoogleOther|Google-InspectionTool|Storebot-Google|Google-Extended)\b/i },
  { name: 'Bingbot', pattern: /\bbingbot\/([\d.]+)/i },
  { name: 'BingPreview', pattern: /\bBingPreview\/([\d.]+)/i },
  { name: 'DuckDuckBot', pattern: /\bDuckDuckBot\/([\d.]+)/i },
  { name: 'Baiduspider', pattern: /\bBaiduspider\/([\d.]+)/i },
  { name: 'YandexBot', pattern: /\bYandexBot\/([\d.]+)/i },
  { name: 'Sogou Spider', pattern: /\bSogou (?:web|inst|Pic) spider\/([\d.]+)/i },
  { name: 'Exabot', pattern: /\bExabot\/([\d.]+)/i },
  { name: 'Applebot', pattern: /\bApplebot\/([\d.]+)/i },
  { name: 'AhrefsBot', pattern: /\bAhrefsBot\/([\d.]+)/i },
  { name: 'SemrushBot', pattern: /\bSemrushBot\/([\d.]+)/i },
  { name: 'MJ12bot', pattern: /\bMJ12bot\/v?([\d.]+)/i },
  { name: 'DotBot', pattern: /\bDotBot\/([\d.]+)/i },
  { name: 'PetalBot', pattern: /\bPetalBot\/([\d.]+)/i },
  { name: 'Bytespider', pattern: /\bBytespider\b/i },
  { name: 'GPTBot', pattern: /\bGPTBot\/([\d.]+)/i },
  { name: 'ChatGPT-User', pattern: /\bChatGPT-User\/([\d.]+)/i },
  { name: 'ClaudeBot', pattern: /\bClaudeBot\/([\d.]+)/i },
  { name: 'CCBot', pattern: /\bCCBot\/([\d.]+)/i },
  { name: 'Amazonbot', pattern: /\bAmazonbot\/([\d.]+)/i },
  { name: 'facebookexternalhit', pattern: /\bfacebookexternalhit\/([\d.]+)/i },
  { name: 'Twitterbot', pattern: /\bTwitterbot\/([\d.]+)/i },
  { name: 'LinkedInBot', pattern: /\bLinkedInBot\/([\d.]+)/i },
  { name: 'Slackbot', pattern: /\bSlackbot(?:-LinkExpanding)?\b/i },
  { name: 'Discordbot', pattern: /\bDiscordbot\/([\d.]+)/i },
  { name: 'TelegramBot', pattern: /\bTelegramBot\b/i },
  { name: 'WhatsApp', pattern: /\bWhatsApp\/([\d.]+)/i },
  { name: 'Pinterestbot', pattern: /\bPinterestbot\/([\d.]+)/i },
  { name: 'archive.org bot', pattern: /\bia_archiver\b/i },
];

/** The catch-all: a token that says "bot", "spider" or "crawler". */
const GENERIC_BOT = /\b([A-Za-z0-9_.-]*(?:bot|spider|crawler|crawl|slurp)[A-Za-z0-9_.-]*)(?:\/([\d.]+))?/i;

/* ---------------------------------------------------------------------- OS */

interface OsMatch {
  name: string;
  version: string | null;
  /** Offset range of the matched text, for the highlight. */
  matched: RegExpExecArray;
}

const WINDOWS_VERSIONS: Record<string, string> = {
  '10.0': '10 或 11（UA 无法区分）',
  '6.3': '8.1',
  '6.2': '8',
  '6.1': '7',
  '6.0': 'Vista',
  '5.1': 'XP',
  '5.0': '2000',
};

function detectOs(raw: string): OsMatch | null {
  const candidates: Array<{ name: string; pattern: RegExp }> = [
    { name: 'Windows Phone', pattern: /\bWindows Phone ([\d.]+)/i },
    { name: 'KaiOS', pattern: /\bKaiOS\/([\d.]+)/i },
    { name: 'Tizen', pattern: /\bTizen[ /]([\d.]+)/i },
    { name: 'webOS', pattern: /\bwebOS[.\/]?([\d.]+)?/i },
    { name: 'iPadOS', pattern: /\b(?:CPU OS|CPU iPhone OS) ([\d_]+)/i },
    { name: 'iOS', pattern: /\bCPU (?:iPhone )?OS ([\d_]+)/i },
    { name: 'Android', pattern: /\bAndroid[ /-]([\d.]+)/i },
    { name: 'ChromeOS', pattern: /\bCrOS [^;)\s]+ ([\d.]+)/i },
    { name: 'macOS', pattern: /\bMac OS X[ /]([\d_.]+)/i },
    { name: 'Windows', pattern: /\bWindows NT ([\d.]+)/i },
    { name: 'Windows', pattern: /\bWindows ([\d.]+)/i },
    { name: 'FreeBSD', pattern: /\bFreeBSD[ /]?([\d.]+)?/i },
    { name: 'OpenBSD', pattern: /\bOpenBSD[ /]?([\d.]+)?/i },
    { name: 'NetBSD', pattern: /\bNetBSD[ /]?([\d.]+)?/i },
    { name: 'Linux', pattern: /\bLinux\b/i },
    { name: 'Ubuntu', pattern: /\bUbuntu[ /]?([\d.]+)?/i },
  ];

  // iPad must be checked before iOS: an iPad UA contains `CPU OS`, which the
  // iOS pattern would otherwise claim and then report the wrong name.
  const isIpad = /\biPad\b/i.test(raw);
  for (const candidate of candidates) {
    const matched = firstMatch(raw, candidate.pattern);
    if (!matched) continue;
    if (candidate.name === 'iPadOS' && !isIpad) continue;
    if (candidate.name === 'iOS' && isIpad) continue;
    let version = matched[1] ?? null;
    if (version !== null) version = version.replace(/_/g, '.');
    if (candidate.name === 'Windows' && version !== null && WINDOWS_VERSIONS[version]) {
      version = `${version} · ${WINDOWS_VERSIONS[version]}`;
    }
    return { name: candidate.name, version, matched };
  }
  return null;
}

/* ------------------------------------------------------------------ device */

function detectDevice(
  raw: string,
  osName: string | null,
  isBot: boolean,
): { type: DeviceType; vendor: string | null; model: string | null } {
  if (isBot) return { type: 'bot', vendor: null, model: null };

  if (/\b(?:Xbox|PlayStation|Nintendo|Valve Steam|SteamOS)\b/i.test(raw)) {
    return { type: 'console', vendor: null, model: null };
  }
  if (/\b(?:SmartTV|SMART-TV|HbbTV|AppleTV|CrKey|Roku|BRAVIA|NetCast|Web0S|Tizen TV)\b/i.test(raw)) {
    return { type: 'tv', vendor: null, model: null };
  }

  // CLI clients never claim a form factor; calling them "desktop" would imply a
  // browser session that does not exist.
  if (
    /\b(?:curl|Wget|python-requests|Python-urllib|Go-http-client|node-fetch|okhttp|PostmanRuntime|libwww-perl|HTTPie)\//i.test(
      raw,
    )
  ) {
    return { type: 'cli', vendor: null, model: null };
  }

  const modelMatch = /\bAndroid[^;)]*;\s*([^;)]+?)(?:\s+Build[/A-Za-z0-9]*|\))/i.exec(raw);
  const model = modelMatch ? modelMatch[1].trim() : null;

  if (/\biPad\b/i.test(raw)) {
    return { type: 'tablet', vendor: 'Apple', model: 'iPad' };
  }
  if (/\biPhone\b/i.test(raw)) {
    return { type: 'mobile', vendor: 'Apple', model: 'iPhone' };
  }
  if (/\biPod\b/i.test(raw)) {
    return { type: 'mobile', vendor: 'Apple', model: 'iPod' };
  }
  if (/\bTablet\b/i.test(raw) || (/\bAndroid\b/i.test(raw) && !/\bMobile\b/i.test(raw))) {
    return { type: 'tablet', vendor: null, model };
  }
  if (/\bAndroid\b/i.test(raw) || /\bMobile\b/i.test(raw) || /\bWindows Phone\b/i.test(raw)) {
    return { type: 'mobile', vendor: null, model };
  }
  if (osName === 'Windows' || osName === 'macOS' || osName === 'Linux' || osName === 'ChromeOS' || osName === 'FreeBSD' || osName === 'OpenBSD' || osName === 'NetBSD') {
    return { type: 'desktop', vendor: null, model: null };
  }
  return { type: 'unknown', vendor: null, model: null };
}

/* --------------------------------------------------------------------- cpu */

function detectCpu(raw: string, osName: string | null): UaCpu | null {
  if (/\b(?:Win64|x64|x86_64|amd64)\b/i.test(raw)) return { architecture: 'x86', bits: '64' };
  if (/\bWOW64\b/i.test(raw)) return { architecture: 'x86', bits: '64' };
  if (/\b(?:i686|i586|i386|x86)\b/i.test(raw)) return { architecture: 'x86', bits: '32' };
  if (/\b(?:arm64|aarch64)\b/i.test(raw)) return { architecture: 'ARM', bits: '64' };
  if (/\b(?:armv7l|armv7|armv6|arm)\b/i.test(raw)) return { architecture: 'ARM', bits: '32' };
  if (/\bPPC\b/i.test(raw)) return { architecture: 'PowerPC', bits: null };
  if (/\b(?:iPhone|iPad|iPod)\b/i.test(raw)) return { architecture: 'ARM', bits: null };
  // A Mac UA says only "Intel" and Apple Silicon reports exactly the same, which
  // is why architecture is left as a claim rather than a fact.
  if (osName === 'macOS') return { architecture: 'x86', bits: null };
  return null;
}

/* ------------------------------------------------------------------- parse */

function inferEngine(raw: string, browser: BrowserRule | null): UaEngine | null {
  const webkit = firstMatch(raw, /\bAppleWebKit\/([\d.]+)/i);
  const gecko = firstMatch(raw, /\brv:([\d.]+)/i) ?? firstMatch(raw, /\bGecko\/(\d{8})/i);
  const trident = firstMatch(raw, /\bTrident\/([\d.]+)/i);

  if (browser?.family === 'trident' || trident) {
    return { name: 'Trident', version: trident?.[1] ?? null, inferred: false };
  }
  if (/\bEdge\//.test(raw)) {
    const edge = firstMatch(raw, /\bEdge\/([\d.]+)/);
    return { name: 'EdgeHTML', version: edge?.[1] ?? null, inferred: false };
  }
  if (browser?.family === 'gecko') {
    return { name: 'Gecko', version: gecko?.[1] ?? null, inferred: false };
  }
  if (browser?.family === 'chromium') {
    // Blink is never named in a UA. Chrome-family strings still carry the
    // AppleWebKit token they inherited, so the WebKit version is reported while
    // the engine name is marked as inferred.
    return { name: 'Blink', version: webkit?.[1] ?? null, inferred: true };
  }
  if (browser?.family === 'webkit' || webkit) {
    return { name: 'WebKit', version: webkit?.[1] ?? null, inferred: false };
  }
  return null;
}

function detectBot(raw: string): { bot: NamedVersion | null; matched: RegExpExecArray | null } {
  for (const rule of BOT_RULES) {
    const matched = firstMatch(raw, rule.pattern);
    if (matched) {
      return { bot: { name: rule.name, version: matched[1] ?? null }, matched };
    }
  }
  const generic = firstMatch(raw, GENERIC_BOT);
  if (generic) {
    return { bot: { name: generic[1], version: generic[2] ?? null }, matched: generic };
  }
  return { bot: null, matched: null };
}

/**
 * Parses a UA string into the fields the UI shows.
 *
 * Every rule is applied in priority order and only the first browser match is
 * kept, because a UA can legitimately contain several browser tokens (Googlebot
 * carries a Chrome token) and the branded one must win.
 */
export function parseUserAgent(raw: string): UaAnalysis {
  const ua = typeof raw === 'string' ? raw : '';
  const segments: UaSegment[] = [];
  const warnings: string[] = [];

  const botResult = detectBot(ua);
  const isBot = botResult.bot !== null;
  segment(segments, botResult.matched, botResult.bot?.name ?? 'bot', 'bot');

  let browserRule: BrowserRule | null = null;
  let browserMatch: RegExpExecArray | null = null;
  for (const rule of [...BROWSER_RULES, ...CLIENT_RULES]) {
    const matched = firstMatch(ua, rule.pattern);
    if (matched) {
      browserRule = rule;
      browserMatch = matched;
      break;
    }
  }
  const browser: NamedVersion | null =
    browserRule && browserMatch
      ? { name: browserRule.name, version: browserMatch[1] ?? null }
      : null;
  segment(segments, browserMatch, browser?.name ?? 'browser', 'browser');

  const engine = inferEngine(ua, browserRule);
  segment(segments, firstMatch(ua, /\bAppleWebKit\/([\d.]+)/i), 'WebKit token', 'engine');
  segment(segments, firstMatch(ua, /\brv:([\d.]+)/i), 'Gecko version', 'engine');
  segment(segments, firstMatch(ua, /\bTrident\/([\d.]+)/i), 'Trident version', 'engine');

  const osMatch = detectOs(ua);
  const os: NamedVersion | null = osMatch
    ? { name: osMatch.name, version: osMatch.version }
    : null;
  segment(segments, osMatch?.matched ?? null, osMatch?.name ?? 'OS', 'os');

  const device = detectDevice(ua, os?.name ?? null, isBot);
  segment(segments, firstMatch(ua, /\bAndroid[^;)]*;\s*[^;)]+?(?:\s+Build[/A-Za-z0-9]*|\))/i), 'Android 设备', 'device');
  segment(segments, firstMatch(ua, /\b(iPhone|iPad|iPod)\b/i), 'Apple 设备', 'device');
  segment(segments, firstMatch(ua, /\b(?:SmartTV|SMART-TV|CrKey|AppleTV|Roku|Xbox|PlayStation|Nintendo)\b/i), '设备类型', 'device');

  const cpu = detectCpu(ua, os?.name ?? null);
  segment(
    segments,
    firstMatch(ua, /\b(?:Win64;\s*x64|x86_64|WOW64|aarch64|arm64|armv7l|x86|i686|PPC)\b/i),
    'CPU 架构',
    'cpu',
  );

  const recognized = browser !== null || os !== null || device.type !== 'unknown';

  // The unconditional caveat. Everything else below is case-specific.
  warnings.push(
    'UA 字符串由客户端自己填写，可以任意伪造（一行 curl -A 就能改）。这里显示的是「自称」，不是事实，更不能用它做安全判断（比如放行、封禁或鉴权）。',
  );

  if (!recognized) {
    warnings.push(
      '无法从这段字符串识别出任何已知的浏览器、操作系统或设备。它可能是伪造、被截断，或是非常规客户端；本工具不会硬猜一个结果。',
    );
  }

  if (browser?.name === 'Chrome' && browser.version !== null && /^\d+\.\d+\.\d+\.\d+$/.test(browser.version) && browser.version.endsWith('.0.0.0')) {
    warnings.push(
      `Chrome 从 110 起做 UA Reduction：小版本与补丁号被冻结成 0，所以这里看到的 ${browser.version} 只反映大版本，不是真实的小版本。`,
    );
  }

  if (os?.name === 'Android' && os.version === '10') {
    warnings.push(
      'Chrome 在 Android 上做 UA Reduction 后，无论系统实际是 10 还是更高，都写 Android 10 并把设备型号写成 K。这里的系统版本和型号都不可信。',
    );
  }

  if (os?.name === 'macOS' && os.version?.startsWith('10.15.7')) {
    warnings.push(
      'Safari 冻结了 macOS 版本，一直报告 10_15_7。因此无法判断实际是 10.15、11 还是更新版本，也无法从 UA 判断是不是 Apple Silicon（它仍写 Intel）。',
    );
  }

  if (os?.name === 'Windows' && os.version?.startsWith('10.0')) {
    warnings.push(
      'Windows NT 10.0 同时用于 Windows 10 和 Windows 11，UA 里没有可区分的字段。',
    );
  }

  if (device.type === 'tablet' && device.model === 'K') {
    warnings.push('型号 "K" 是 Chrome 的匿名化占位符，不是真实机型。');
  }

  if (isBot) {
    warnings.push(
      `这段 UA 自称是爬虫（${botResult.bot?.name}），但爬虫 UA 极其容易伪装；反过来说，某些真实爬虫（如 Googlebot）会带上完整的 Chrome token，所以上面的浏览器字段不能当作证据。屏蔽或放行爬虫请用 IP 验证（如反向 DNS）而不是 UA。`,
    );
  }

  warnings.push(
    '现代浏览器的替代方案是 Client Hints（Sec-CH-UA、Sec-CH-UA-Platform、Sec-CH-UA-Mobile 等，浏览器里对应 navigator.userAgentData）。它们是结构化字段、可以由服务器按需索取，比整串 UA 更可靠，但只在部分浏览器上可用，且需要服务器主动请求。',
  );

  segments.sort((a, b) => a.start - b.start);

  return {
    raw: ua,
    browser,
    engine,
    os,
    device,
    cpu,
    isBot,
    bot: botResult.bot,
    segments,
    warnings,
    recognized,
  };
}

/* ----------------------------------------------------------------- samples */

export interface UaSample {
  /** Short Chinese label for the picker. */
  label: string;
  ua: string;
  /** What this sample is meant to demonstrate. */
  note: string;
}

/**
 * Real, widely published UA strings.
 *
 * Each one is a string a real client sends, chosen so the awkward cases are one
 * click away: an embedded-Chrome browser, a frozen Safari version, a
 * smartphone crawler that also carries Chrome, and so on.
 */
export const UA_SAMPLES: UaSample[] = [
  {
    label: 'Chrome 120 · Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    note: '注意小版本是 0.0.0：这是 Chrome 的 UA Reduction，不是真实补丁号。',
  },
  {
    label: 'Edge 120 · Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    note: '同时含 Chrome 和 Edg：只看 "Chrome" 会误判成 Chrome。',
  },
  {
    label: 'Opera 105 · Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 OPR/105.0.0.0',
    note: '同样内嵌 Chrome，靠 OPR 标记区分。',
  },
  {
    label: 'Samsung Internet 23 · Android',
    ua: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
    note: '三星浏览器：含 Chrome 与 SamsungBrowser，型号是真实机型。',
  },
  {
    label: 'Firefox 121 · Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    note: 'Gecko 引擎，版本写在 rv 与 Firefox 两处。',
  },
  {
    label: 'Safari 17 · macOS',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    note: 'macOS 版本被冻结在 10_15_7；真实版本可能是 14。',
  },
  {
    label: 'Safari 17 · iPhone',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
    note: 'iOS 版本用下划线，Safari 版本另算。',
  },
  {
    label: 'iPad · iPadOS 16',
    ua: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    note: 'iPad 默认请求桌面站点，UA 里仍写 iPad。',
  },
  {
    label: 'Chrome 120 · Android（缩减后）',
    ua: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    note: 'Android 10 与型号 K 都是匿名化占位符，真实机型被隐藏。',
  },
  {
    label: 'Chrome 120 · iOS',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
    note: 'iOS 上所有浏览器都必须用 WebKit，CriOS 是 Chrome 的标记。',
  },
  {
    label: 'Googlebot 2.1（桌面）',
    ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    note: '经典爬虫 UA：没有 Chrome token。',
  },
  {
    label: 'Googlebot 智能手机（含 Chrome）',
    ua: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2272.96 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    note: '爬虫也可能携带完整 Chrome token，所以浏览器字段不能当证据。',
  },
  {
    label: 'bingbot 2.0',
    ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    note: '必应爬虫。',
  },
  {
    label: 'GPTBot 1.1',
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
    note: 'AI 训练爬虫，UA 里没有浏览器版本。',
  },
  {
    label: 'facebookexternalhit 1.1',
    ua: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    note: '链接预览抓取，不是浏览器。',
  },
  {
    label: 'Internet Explorer 11 · Windows 7',
    ua: 'Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko',
    note: '经典 UA：Trident 引擎，兼容性视图会伪装成 MSIE 7。',
  },
  {
    label: 'Chrome 41 · Windows 7（经典）',
    ua: 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2272.104 Safari/537.36',
    note: 'UA Reduction 之前，小版本是完整的。',
  },
  {
    label: 'Firefox 121 · Linux',
    ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    note: 'Linux 桌面，x86_64 写在平台串里。',
  },
  {
    label: 'Firefox 121 · Android',
    ua: 'Mozilla/5.0 (Android 13; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0',
    note: '移动 Firefox 不再带 Android 设备型号。',
  },
  {
    label: 'Yandex Browser 23.11 · Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36 YaBrowser/23.11.0.0',
    note: '又一款内嵌 Chrome 的浏览器。',
  },
  {
    label: 'curl 8.4（命令行）',
    ua: 'curl/8.4.0',
    note: '不是浏览器：设备类型是命令行，没有操作系统与引擎。',
  },
];

/**
 * A deliberately naive classifier, kept as executable documentation of the bug
 * the priority order avoids. The check script asserts that this function really
 * does mislabel Edge, Opera and Samsung Internet as Chrome.
 */
export function naiveChromeCheck(raw: string): string {
  if (raw.includes('Chrome')) return 'Chrome';
  if (raw.includes('Firefox')) return 'Firefox';
  if (raw.includes('Safari')) return 'Safari';
  return 'unknown';
}
