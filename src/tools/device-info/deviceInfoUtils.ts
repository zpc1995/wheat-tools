/**
 * Pure logic behind the device-info tool.
 *
 * Nothing in this module touches the DOM: every reading is passed in as an
 * argument instead of being pulled off a global. That is the whole reason the
 * file exists separately from the component. The interesting parts of this tool
 * are the *derivations* — CSS pixels from physical pixels, a UTC offset from an
 * IANA time zone, a consistency verdict from two measurements that should agree
 * — and a version that reached for `window.screen` internally could only be
 * exercised in a real browser. With the environment injected, the check script
 * can hand it a screen of 1920 logical pixels at devicePixelRatio 2 and assert
 * the arithmetic, plus hand it deliberately contradictory readings and assert
 * that the consistency report actually notices.
 *
 * The second job of this file is honesty about provenance. Every row carries the
 * API it came from and whether that API is standard, non-standard (a Chromium
 * extension in practice), or deprecated. Most of the "device info" screens on
 * the web present Chromium-only properties such as `deviceMemory`,
 * `connection.effectiveType` and the unmasked WebGL strings as if they were
 * universal facts; marking them is the point of the tool.
 */

/** Where a reading comes from, in standards terms. */
export type SupportLevel = 'standard' | 'nonstandard' | 'deprecated' | 'unknown';

export const SUPPORT_LABELS: Record<SupportLevel, string> = {
  standard: '标准',
  nonstandard: '非标准',
  deprecated: '已废弃',
  unknown: '未知',
};

export interface InfoItem {
  id: string;
  /** Chinese label shown in the first column. */
  label: string;
  /** Already-formatted value; the util formats so the component stays dumb. */
  value: string;
  /** The exact API the value came from, e.g. `Screen.width`. */
  api: string;
  support: SupportLevel;
  /** What is surprising or misleading about this value, if anything. */
  note?: string;
}

export interface InfoGroup {
  id: string;
  title: string;
  items: InfoItem[];
}

export interface ConsistencyCheck {
  id: string;
  label: string;
  ok: boolean;
  /** The numbers the verdict was computed from, so it can be audited by eye. */
  detail: string;
}

export interface ScreenEnv {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
  pixelDepth: number;
  orientationType?: string;
  orientationAngle?: number;
}

export interface LayoutViewportEnv {
  width: number;
  height: number;
}

export interface ViewportEnv {
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  screenX: number;
  screenY: number;
  devicePixelRatio: number;
  isFullscreen: boolean;
}

export interface UserAgentBrand {
  brand: string;
  version: string;
}

export interface UserAgentDataEnv {
  mobile?: boolean;
  platform?: string;
  brands?: UserAgentBrand[];
}

export interface ConnectionEnv {
  effectiveType?: string;
  type?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

export interface BatteryEnv {
  charging: boolean;
  level: number;
  chargingTime: number;
  dischargingTime: number;
}

export interface WebglEnv {
  /** Which context was obtained: `webgl2` or `webgl`. */
  contextName: string;
  version: string;
  shadingLanguageVersion?: string;
  /** The plain vendor/renderer strings the context reports. */
  vendor: string;
  renderer: string;
  /**
   * The unmasked strings, only present when the browser exposes the
   * `WEBGL_debug_renderer_info` extension. This is the classic fingerprinting
   * surface: present so the reader can see what their browser leaks.
   */
  unmaskedVendor?: string;
  unmaskedRenderer?: string;
}

export interface NavEnv {
  userAgent: string;
  platform?: string;
  vendor?: string;
  language: string;
  languages: string[];
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints: number;
  touchEventSupported: boolean;
  cookieEnabled: boolean;
  onLine: boolean;
  doNotTrack?: string | null;
  userAgentData?: UserAgentDataEnv | null;
  connection?: ConnectionEnv | null;
  battery?: BatteryEnv | null;
}

export interface MediaEnv {
  colorSchemeDark: boolean;
  reducedMotion: boolean;
  prefersContrastMore: boolean;
  forcedColorsActive: boolean;
  pointerCoarse: boolean;
  hoverNone: boolean;
  displayModeStandalone: boolean;
  displayModeMinimalUi: boolean;
  displayModeFullscreen: boolean;
  navigatorStandalone: boolean;
}

export interface TimeEnv {
  /** IANA zone from `Intl.DateTimeFormat().resolvedOptions().timeZone`. */
  timeZone: string;
  /** Raw `Date.prototype.getTimezoneOffset()`: minutes *behind* UTC. */
  getTimezoneOffsetMinutes: number;
  /** The instant the readings above were taken at. */
  sampleMs: number;
  /** Localised long zone name, e.g. 中国标准时间. */
  localizedTimeZoneName?: string;
}

export interface DeviceEnvironment {
  screen: ScreenEnv;
  viewport: ViewportEnv;
  layoutViewport: LayoutViewportEnv;
  nav: NavEnv;
  media: MediaEnv;
  time: TimeEnv;
  webgl?: WebglEnv | null;
}

/** Where the readings were taken, used for the exported report header. */
export interface ReportContext {
  origin?: string;
  generatedAtMs: number;
}

// ---------------------------------------------------------------------------
// Unit conversion
// ---------------------------------------------------------------------------

/**
 * CSS pixels to physical pixels.
 *
 * `devicePixelRatio` is the number of physical pixels per CSS pixel, so this
 * multiplies. Returns null rather than NaN/Infinity for nonsense input: a
 * non-finite number rendered into the report would look like a real reading.
 */
export function physicalPixels(
  cssPixels: number,
  devicePixelRatio: number,
): number | null {
  if (!Number.isFinite(cssPixels) || !Number.isFinite(devicePixelRatio)) {
    return null;
  }
  if (devicePixelRatio <= 0) return null;
  return round2(cssPixels * devicePixelRatio);
}

/** Physical pixels back to CSS pixels; the exact inverse of the above. */
export function cssPixels(
  devicePixels: number,
  devicePixelRatio: number,
): number | null {
  if (!Number.isFinite(devicePixels) || !Number.isFinite(devicePixelRatio)) {
    return null;
  }
  if (devicePixelRatio <= 0) return null;
  return round2(devicePixels / devicePixelRatio);
}

/** Rounds to two decimals to keep floating point noise out of the display. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Time zone arithmetic
// ---------------------------------------------------------------------------

/**
 * Formats a UTC offset, given in the ISO sense (east of UTC is positive).
 *
 * The sign convention is the single most confusing thing about this area:
 * `Date.prototype.getTimezoneOffset()` returns the opposite sign (it answers
 * "how many minutes is local time behind UTC"), so UTC+8 yields -480. This
 * function takes the ISO-style value; use `utcOffsetFromGetTimezoneOffset` to
 * convert the legacy one, and note that the consistency report compares the two.
 */
export function formatUtcOffset(offsetMinutes: number): string {
  if (!Number.isFinite(offsetMinutes)) return '不可用';
  const total = Math.round(offsetMinutes);
  const sign = total < 0 ? '-' : '+';
  const abs = Math.abs(total);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `UTC${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Converts the legacy, inverted `getTimezoneOffset()` value to ISO sign. */
export function utcOffsetFromGetTimezoneOffset(
  getTimezoneOffsetMinutes: number,
): number | null {
  if (!Number.isFinite(getTimezoneOffsetMinutes)) return null;
  return -getTimezoneOffsetMinutes;
}

/**
 * The UTC offset of an IANA zone at a given instant, in minutes.
 *
 * Derived from `Intl.DateTimeFormat` rather than from the host's own offset so
 * that the two disagree loudly when one of them is wrong: the report shows this
 * number next to `getTimezoneOffset()` and the consistency check compares them.
 * The offset is genuinely a function of the *instant* — America/New_York is
 * -300 in January and -240 in July — which is why the sample time is a
 * parameter instead of being read from the clock here.
 */
export function intlOffsetMinutes(
  sampleMs: number,
  timeZone: string,
): number | null {
  if (!Number.isFinite(sampleMs)) return null;
  if (typeof timeZone !== 'string' || timeZone === '') return null;

  // Whole seconds only: the formatted parts have second resolution, so a
  // millisecond remainder would show up as a fractional minute.
  const whole = Math.floor(sampleMs / 1000) * 1000;

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(whole));
  } catch {
    // An unknown zone name throws a RangeError; "no answer" is the honest
    // result, not a silently invented offset.
    return null;
  }

  const pick = (type: string): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : Number.NaN;
  };

  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  // Some engines emit hour "24" for midnight even with h23; Date.UTC would roll
  // that into the next day and skew the offset by 24 hours.
  const hour = pick('hour') % 24;
  const minute = pick('minute');
  const second = pick('second');

  if ([year, month, day, hour, minute, second].some((n) => !Number.isFinite(n))) {
    return null;
  }

  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return Math.round((asUtc - whole) / 60_000);
}

// ---------------------------------------------------------------------------
// Consistency report
// ---------------------------------------------------------------------------

/** The only values `deviceMemory` may legally take, per the Device Memory spec. */
const DEVICE_MEMORY_STEPS = [0.25, 0.5, 1, 2, 4, 8];

/**
 * Cross-checks readings that must agree with each other.
 *
 * This is the closest thing to an authoritative reference that device info can
 * have: there is no registry of "your screen size", but a correct set of
 * readings is internally consistent, and a wrong one usually is not. The
 * differences are also real signal — `innerWidth > outerWidth` means the page is
 * inside a frame or the reading is bogus, and a mismatched time-zone offset means
 * the two clocks disagree, which invalidates every timestamp the tool shows.
 */
export function checkConsistency(env: DeviceEnvironment): ConsistencyCheck[] {
  const { screen, viewport, layoutViewport, nav, time } = env;
  const checks: ConsistencyCheck[] = [];

  // 1. CSS pixels <-> physical pixels must round-trip.
  const physical = physicalPixels(screen.width, viewport.devicePixelRatio);
  const back = physical === null ? null : cssPixels(physical, viewport.devicePixelRatio);
  checks.push({
    id: 'screen-css-physical',
    label: '屏幕物理像素与 CSS 像素换算自洽',
    ok: back !== null && Math.abs(back - screen.width) < 0.01,
    detail:
      `${screen.width} CSS px × ${viewport.devicePixelRatio} = ${physical ?? '不可用'} 物理 px，` +
      `再 ÷ ${viewport.devicePixelRatio} = ${back ?? '不可用'} CSS px`,
  });

  // 2. devicePixelRatio must be positive and finite. It is *not* asserted to be
  // >= 1: browser zoom below 100% legitimately produces values like 0.67, and a
  // check that failed there would be wrong rather than strict.
  checks.push({
    id: 'dpr-positive',
    label: 'devicePixelRatio 为正的有限数',
    ok: Number.isFinite(viewport.devicePixelRatio) && viewport.devicePixelRatio > 0,
    detail: `devicePixelRatio = ${viewport.devicePixelRatio}（页面缩放到 100% 以下时该值可以小于 1）`,
  });

  // 3. The available area is the screen minus system chrome.
  checks.push({
    id: 'avail-inside-screen',
    label: '可用区域不超过屏幕尺寸',
    ok: screen.availWidth <= screen.width && screen.availHeight <= screen.height,
    detail: `可用 ${screen.availWidth} × ${screen.availHeight}，屏幕 ${screen.width} × ${screen.height}`,
  });

  // 4. The viewport cannot exceed the window that contains it. Skipped while
  // fullscreen, where outerWidth legitimately lags behind.
  if (viewport.isFullscreen) {
    checks.push({
      id: 'inner-within-outer',
      label: '视口不超过窗口外框',
      ok: true,
      detail: '当前处于全屏，该关系不适用',
    });
  } else {
    checks.push({
      id: 'inner-within-outer',
      label: '视口不超过窗口外框',
      ok:
        viewport.innerWidth <= viewport.outerWidth &&
        viewport.innerHeight <= viewport.outerHeight,
      detail:
        `inner ${viewport.innerWidth} × ${viewport.innerHeight}，` +
        `outer ${viewport.outerWidth} × ${viewport.outerHeight}`,
    });
  }

  // 5. The scrollbar-free layout viewport is a subset of the inner size.
  checks.push({
    id: 'layout-within-inner',
    label: '排版视口不超过窗口内尺寸',
    ok:
      layoutViewport.width <= viewport.innerWidth &&
      layoutViewport.height <= viewport.innerHeight,
    detail:
      `clientWidth × clientHeight = ${layoutViewport.width} × ${layoutViewport.height}，` +
      `innerWidth × innerHeight = ${viewport.innerWidth} × ${viewport.innerHeight}`,
  });

  // 6. hardwareConcurrency is a parallelism hint; the spec floors it at 1. A
  // present-but-zero value means the two sources disagree.
  const cores = nav.hardwareConcurrency;
  checks.push({
    id: 'hardware-concurrency',
    label: 'CPU 逻辑核心数 ≥ 1',
    ok: cores === undefined || (Number.isFinite(cores) && cores >= 1),
    detail:
      cores === undefined
        ? '浏览器未提供 hardwareConcurrency，无法核对'
        : `hardwareConcurrency = ${cores}`,
  });

  // 7. deviceMemory is coarsened to a fixed ladder; anything else means the
  // reading was tampered with or the spec changed.
  const memory = nav.deviceMemory;
  checks.push({
    id: 'device-memory-ladder',
    label: 'deviceMemory 落在规范的粗粒度档位上',
    ok:
      memory === undefined ||
      DEVICE_MEMORY_STEPS.some((step) => step === memory),
    detail:
      memory === undefined
        ? '浏览器未提供 deviceMemory，无法核对'
        : `deviceMemory = ${memory} GiB，合法档位为 ${DEVICE_MEMORY_STEPS.join(' / ')}`,
  });

  // 8. Two independent time-zone readings must agree. This is the check that
  // catches a host whose Intl data is stale (an outdated tzdata gives a
  // different DST rule than the OS clock).
  const intlOffset = intlOffsetMinutes(time.sampleMs, time.timeZone);
  const legacyOffset = utcOffsetFromGetTimezoneOffset(time.getTimezoneOffsetMinutes);
  checks.push({
    id: 'timezone-agrees',
    label: 'Intl 时区偏移与 getTimezoneOffset 一致',
    ok: intlOffset !== null && legacyOffset !== null && intlOffset === legacyOffset,
    detail:
      `Intl（${time.timeZone}） = ${intlOffset === null ? '不可用' : formatUtcOffset(intlOffset)}，` +
      `getTimezoneOffset = ${legacyOffset === null ? '不可用' : formatUtcOffset(legacyOffset)}`,
  });

  // 9. A zone name is required for the rest of the arithmetic to mean anything.
  checks.push({
    id: 'timezone-named',
    label: '能解析出 IANA 时区名',
    ok: typeof time.timeZone === 'string' && time.timeZone.length > 0,
    detail: `timeZone = ${time.timeZone || '(空)'}`,
  });

  // 10. navigator.language should appear in navigator.languages.
  const languages = Array.isArray(nav.languages) ? nav.languages : [];
  checks.push({
    id: 'language-in-list',
    label: 'language 出现在 languages 列表中',
    ok: languages.length === 0 || languages.includes(nav.language),
    detail:
      languages.length === 0
        ? '浏览器未提供 languages，无法核对'
        : `language = ${nav.language}，languages = ${languages.join(', ')}`,
  });

  // 11. Colour depth of 24 bits and up is the normal case; a smaller value is
  // reported rather than hidden because it explains washed-out colours.
  checks.push({
    id: 'color-depth',
    label: '色彩深度 ≥ 24 位',
    ok: Number.isFinite(screen.colorDepth) && screen.colorDepth >= 24,
    detail: `colorDepth = ${screen.colorDepth} 位`,
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Display formatting helpers
// ---------------------------------------------------------------------------

function text(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '不可用';
  const asString = String(value);
  return asString === '' ? '不可用' : asString;
}

function yesNo(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return '不可用';
  return value ? '是' : '否';
}

function withUnit(value: number | undefined | null, unit: string): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '不可用';
  }
  return `${value} ${unit}`;
}

const MEDIA_QUERY_API = 'window.matchMedia';

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/**
 * Turns the injected environment into the rows the UI renders.
 *
 * Kept separate from `checkConsistency` because the two answer different
 * questions: this one says "what did the browser report", the other says "do
 * those reports hang together". A tool that merged them would have nowhere to
 * put a value that is readable but inconsistent.
 */
export function collectInfo(env: DeviceEnvironment): InfoGroup[] {
  const { screen, viewport, layoutViewport, nav, media, time, webgl } = env;

  const physicalWidth = physicalPixels(screen.width, viewport.devicePixelRatio);
  const physicalHeight = physicalPixels(screen.height, viewport.devicePixelRatio);
  const dividedByDpr = cssPixels(screen.width, viewport.devicePixelRatio);

  const groups: InfoGroup[] = [
    {
      id: 'screen',
      title: '屏幕',
      items: [
        {
          id: 'screen-size',
          label: '屏幕分辨率',
          value: `${screen.width} × ${screen.height} CSS px`,
          api: 'Screen.width / Screen.height',
          support: 'standard',
          note:
            '这里的单位是 CSS 像素，不是物理像素。物理分辨率约等于该值乘以 devicePixelRatio。',
        },
        {
          id: 'screen-avail',
          label: '屏幕可用区域',
          value: `${screen.availWidth} × ${screen.availHeight} CSS px`,
          api: 'Screen.availWidth / availHeight',
          support: 'standard',
          note: '已扣除系统任务栏、停靠栏等操作系统占用的区域。',
        },
        {
          id: 'screen-physical',
          label: '物理分辨率（估算）',
          value:
            physicalWidth === null || physicalHeight === null
              ? '不可用'
              : `${physicalWidth} × ${physicalHeight} 物理 px`,
          api: 'Screen.width × Window.devicePixelRatio',
          support: 'standard',
          note:
            '由两个标准属性相乘得到。缩放不为 100% 时，它反映的是当前缩放档位下的设备像素，而不是面板的原生分辨率。',
        },
        {
          id: 'screen-divided',
          label: '屏幕尺寸 ÷ devicePixelRatio',
          value:
            dividedByDpr === null
              ? '不可用'
              : `${dividedByDpr} × ${
                  cssPixels(screen.height, viewport.devicePixelRatio) ?? '不可用'
                }`,
          api: 'Screen.width ÷ devicePixelRatio',
          support: 'standard',
          note:
            '这是"把屏幕尺寸按 DPR 缩小"的换算，用于验证 CSS 像素换算可逆；它不是屏幕的物理分辨率，物理分辨率要用乘法。',
        },
        {
          id: 'dpr',
          label: '设备像素比',
          value: text(viewport.devicePixelRatio),
          api: 'Window.devicePixelRatio',
          support: 'standard',
          note: '一个 CSS 像素对应的物理像素数。页面缩放会改变它，缩放到 67% 时约为 0.67。',
        },
        {
          id: 'color-depth',
          label: '色彩深度',
          value: `${screen.colorDepth} 位/像素`,
          api: 'Screen.colorDepth',
          support: 'standard',
        },
        {
          id: 'pixel-depth',
          label: '像素深度',
          value: `${screen.pixelDepth} 位/像素`,
          api: 'Screen.pixelDepth',
          support: 'deprecated',
          note: '与 colorDepth 等价，属于历史遗留属性，新代码不应使用。',
        },
        {
          id: 'orientation',
          label: '屏幕方向',
          value:
            screen.orientationType === undefined
              ? '不可用'
              : `${screen.orientationType}（${withUnit(screen.orientationAngle, '度')}）`,
          api: 'ScreenOrientation.type / angle',
          support: 'standard',
        },
      ],
    },
    {
      id: 'viewport',
      title: '窗口与视口',
      items: [
        {
          id: 'inner',
          label: '窗口内尺寸',
          value: `${viewport.innerWidth} × ${viewport.innerHeight} CSS px`,
          api: 'Window.innerWidth / innerHeight',
          support: 'standard',
          note: '包含滚动条占用的宽度。',
        },
        {
          id: 'outer',
          label: '窗口外尺寸',
          value: `${viewport.outerWidth} × ${viewport.outerHeight} CSS px`,
          api: 'Window.outerWidth / outerHeight',
          support: 'standard',
          note: '浏览器窗口的整体尺寸，含标签栏与边框；全屏时可能不更新。',
        },
        {
          id: 'layout-viewport',
          label: '排版视口',
          value: `${layoutViewport.width} × ${layoutViewport.height} CSS px`,
          api: 'document.documentElement.clientWidth / clientHeight',
          support: 'standard',
          note: '不含滚动条，是 CSS 布局实际可用的区域。',
        },
        {
          id: 'screen-position',
          label: '窗口在屏幕上的位置',
          value: `x = ${viewport.screenX}, y = ${viewport.screenY}`,
          api: 'Window.screenX / screenY',
          support: 'standard',
          note: '多显示器场景下该值可能是负数。',
        },
        {
          id: 'fullscreen',
          label: '是否处于全屏',
          value: yesNo(viewport.isFullscreen),
          api: 'document.fullscreenElement',
          support: 'standard',
        },
      ],
    },
    {
      id: 'time',
      title: '时区与语言',
      items: [
        {
          id: 'timezone',
          label: 'IANA 时区名',
          value: text(time.timeZone),
          api: 'Intl.DateTimeFormat().resolvedOptions().timeZone',
          support: 'standard',
        },
        {
          id: 'timezone-name',
          label: '时区本地化名称',
          value: text(time.localizedTimeZoneName),
          api: 'Intl.DateTimeFormat(timeZoneName: "long")',
          support: 'standard',
        },
        {
          id: 'utc-offset-intl',
          label: 'UTC 偏移（Intl 计算）',
          value: formatUtcOffsetValue(intlOffsetMinutes(time.sampleMs, time.timeZone)),
          api: 'Intl.DateTimeFormat().formatToParts()',
          support: 'standard',
          note: '按采样时刻计算，因此能反映夏令时：同一个时区在冬夏两季的偏移不同。',
        },
        {
          id: 'utc-offset-legacy',
          label: 'UTC 偏移（getTimezoneOffset）',
          value: formatUtcOffsetValue(
            utcOffsetFromGetTimezoneOffset(time.getTimezoneOffsetMinutes),
          ),
          api: 'Date.prototype.getTimezoneOffset()',
          support: 'standard',
          note:
            '注意符号相反：该 API 返回"本地时间落后 UTC 多少分钟"，UTC+8 得到 -480。工具已按 ISO 习惯换算显示。',
        },
        {
          id: 'language',
          label: '首选语言',
          value: text(nav.language),
          api: 'Navigator.language',
          support: 'standard',
        },
        {
          id: 'languages',
          label: '语言偏好列表',
          value: nav.languages.length > 0 ? nav.languages.join(', ') : '不可用',
          api: 'Navigator.languages',
          support: 'standard',
          note: '按优先级排序，第一个是首选语言。',
        },
      ],
    },
    {
      id: 'hardware',
      title: '硬件与设备',
      items: [
        {
          id: 'cores',
          label: 'CPU 逻辑核心数',
          value: withUnit(nav.hardwareConcurrency, '个'),
          api: 'Navigator.hardwareConcurrency',
          support: 'standard',
          note:
            '标准属性，但语义是"可并行线程数的上限提示"，不是物理核心数；浏览器为降低指纹熵可能取整或截断。',
        },
        {
          id: 'memory',
          label: '设备内存',
          value:
            nav.deviceMemory === undefined
              ? '不可用'
              : `约 ${nav.deviceMemory} GiB`,
          api: 'Navigator.deviceMemory',
          support: 'nonstandard',
          note:
            '非标准，仅 Chromium 系浏览器支持，Safari 与 Firefox 均不提供。值被刻意粗粒度化（只报 0.25 / 0.5 / 1 / 2 / 4 / 8），且封顶为 8，因此不能当作真实内存容量。',
        },
        {
          id: 'touch-points',
          label: '触摸点上限',
          value: text(nav.maxTouchPoints),
          api: 'Navigator.maxTouchPoints',
          support: 'standard',
          note: '大于 0 表示设备支持触摸输入。',
        },
        {
          id: 'touch-event',
          label: '是否暴露触摸事件',
          value: yesNo(nav.touchEventSupported),
          api: '("ontouchstart" in window)',
          support: 'nonstandard',
          note: '非标准探测方式，仅用于兜底；请以上面的 maxTouchPoints 为准。',
        },
        {
          id: 'platform',
          label: '平台',
          value: text(nav.platform),
          api: 'Navigator.platform',
          support: 'deprecated',
          note:
            '已被规范标记为废弃，替代品是 User-Agent Client Hints 的 platform；出于隐私考虑该值常被简化为固定字符串。',
        },
        {
          id: 'vendor',
          label: '浏览器厂商',
          value: text(nav.vendor),
          api: 'Navigator.vendor',
          support: 'nonstandard',
          note: '非标准属性，且可被伪造，不要用于特性判断。',
        },
        {
          id: 'ua',
          label: 'User Agent',
          value: text(nav.userAgent),
          api: 'Navigator.userAgent',
          support: 'standard',
          note:
            '标准属性，但主流浏览器已冻结并精简其内容，不再可靠地反映真实版本；能读到不等于应该据此做分支。',
        },
        {
          id: 'ua-mobile',
          label: '是否移动设备（UA-CH）',
          value: yesNo(nav.userAgentData?.mobile),
          api: 'NavigatorUAData.mobile',
          support: 'nonstandard',
          note: '非标准，仅 Chromium 系提供，Safari 与 Firefox 无此接口。',
        },
        {
          id: 'ua-platform',
          label: '平台（UA-CH）',
          value: text(nav.userAgentData?.platform),
          api: 'NavigatorUAData.platform',
          support: 'nonstandard',
          note: '非标准，仅 Chromium 系提供。',
        },
        {
          id: 'ua-brands',
          label: '浏览器品牌（UA-CH）',
          value:
            nav.userAgentData?.brands && nav.userAgentData.brands.length > 0
              ? nav.userAgentData.brands
                  .map((brand) => `${brand.brand} ${brand.version}`)
                  .join('；')
              : '不可用',
          api: 'NavigatorUAData.brands',
          support: 'nonstandard',
          note: '非标准，仅 Chromium 系提供；其中常含刻意填入的假品牌。',
        },
        {
          id: 'battery',
          label: '电池状态',
          value: describeBattery(nav.battery),
          api: 'navigator.getBattery()（Battery Status API）',
          support: 'nonstandard',
          note:
            '非标准且规范已停止推进，仅 Chromium 系在部分环境下提供（通常要求安全上下文）。出于隐私考虑，即使接口存在也可能返回粗化或占位数值。',
        },
      ],
    },
    {
      id: 'preferences',
      title: '显示与输入偏好',
      items: [
        {
          id: 'color-scheme',
          label: '偏好配色方案',
          value: media.colorSchemeDark ? '深色（dark）' : '浅色（light）',
          api: `${MEDIA_QUERY_API}('(prefers-color-scheme: dark)')`,
          support: 'standard',
        },
        {
          id: 'reduced-motion',
          label: '偏好减少动态效果',
          value: yesNo(media.reducedMotion),
          api: `${MEDIA_QUERY_API}('(prefers-reduced-motion: reduce)')`,
          support: 'standard',
          note: '为真表示用户在系统里开启了"减少动态效果"，网页应当降低或关闭动画。',
        },
        {
          id: 'contrast',
          label: '偏好更高对比度',
          value: yesNo(media.prefersContrastMore),
          api: `${MEDIA_QUERY_API}('(prefers-contrast: more)')`,
          support: 'standard',
        },
        {
          id: 'forced-colors',
          label: '强制颜色模式',
          value: yesNo(media.forcedColorsActive),
          api: `${MEDIA_QUERY_API}('(forced-colors: active)')`,
          support: 'standard',
          note: 'Windows 高对比度模式会命中该媒体查询。',
        },
        {
          id: 'pointer',
          label: '主指针是否粗粒度',
          value: yesNo(media.pointerCoarse),
          api: `${MEDIA_QUERY_API}('(pointer: coarse)')`,
          support: 'standard',
          note: '粗粒度通常意味着触摸屏或遥控器，细粒度意味着鼠标或触控板。',
        },
        {
          id: 'hover',
          label: '是否不支持悬停',
          value: yesNo(media.hoverNone),
          api: `${MEDIA_QUERY_API}('(hover: none)')`,
          support: 'standard',
          note: '为真时不应把功能藏在 hover 里，触摸设备无法触发。',
        },
        {
          id: 'display-mode',
          label: '显示模式',
          value: describeDisplayMode(media),
          api: `${MEDIA_QUERY_API}('(display-mode: …)')`,
          support: 'standard',
        },
        {
          id: 'standalone-ios',
          label: '是否以独立窗口运行（iOS 专有）',
          value: yesNo(media.navigatorStandalone),
          api: 'Navigator.standalone',
          support: 'nonstandard',
          note: '非标准，只有 iOS Safari 的主屏网页应用有该属性；判断 PWA 请优先看 display-mode。',
        },
      ],
    },
    {
      id: 'graphics',
      title: '图形能力（WebGL）',
      items: [
        {
          id: 'webgl-available',
          label: 'WebGL 是否可用',
          value: webgl ? `可用（已取得 ${webgl.contextName} 上下文）` : '不可用',
          api: 'HTMLCanvasElement.getContext("webgl2" / "webgl")',
          support: 'standard',
        },
        {
          id: 'webgl-version',
          label: 'WebGL 版本',
          value: text(webgl?.version),
          api: 'WebGLRenderingContext.VERSION',
          support: 'standard',
        },
        {
          id: 'webgl-glsl',
          label: '着色器语言版本',
          value: text(webgl?.shadingLanguageVersion),
          api: 'WebGLRenderingContext.SHADING_LANGUAGE_VERSION',
          support: 'standard',
        },
        {
          id: 'webgl-vendor',
          label: '显卡厂商（未解掩码）',
          value: text(webgl?.vendor),
          api: 'WebGLRenderingContext.VENDOR',
          support: 'standard',
          note: '未开启调试扩展时通常是 "WebKit" 之类的占位字符串，不含真实信息。',
        },
        {
          id: 'webgl-renderer',
          label: '渲染器（未解掩码）',
          value: text(webgl?.renderer),
          api: 'WebGLRenderingContext.RENDERER',
          support: 'standard',
          note: '同上，通常是占位值。',
        },
        {
          id: 'webgl-unmasked-vendor',
          label: '显卡厂商（真实值）',
          value: text(webgl?.unmaskedVendor),
          api: 'WEBGL_debug_renderer_info.UNMASKED_VENDOR_WEBGL',
          support: 'nonstandard',
          note:
            '非标准扩展。这是公认的指纹熵来源之一：显卡型号组合起来辨识度很高。本工具只把它显示给你自己看，不做哈希、不与其他字段拼接、也不发送任何请求。',
        },
        {
          id: 'webgl-unmasked-renderer',
          label: '渲染器型号（真实值）',
          value: text(webgl?.unmaskedRenderer),
          api: 'WEBGL_debug_renderer_info.UNMASKED_RENDERER_WEBGL',
          support: 'nonstandard',
          note:
            '非标准扩展，部分浏览器或显卡驱动会屏蔽它。同样只做本地展示，不参与任何指纹计算。',
        },
      ],
    },
    {
      id: 'network',
      title: '网络与存储',
      items: [
        {
          id: 'online',
          label: '是否在线',
          value: yesNo(nav.onLine),
          api: 'Navigator.onLine',
          support: 'standard',
          note:
            '只表示浏览器认为网络接口可用，不能证明真的能访问互联网：连着一个没有出口的 Wi-Fi 也会返回"是"。',
        },
        {
          id: 'effective-type',
          label: '网络类型',
          value: text(nav.connection?.effectiveType),
          api: 'NetworkInformation.effectiveType',
          support: 'nonstandard',
          note:
            '非标准，仅 Chromium 系提供，Safari 与 Firefox 均不提供；值是浏览器推测的粗粒度档位（slow-2g / 2g / 3g / 4g）。',
        },
        {
          id: 'connection-type',
          label: '连接技术',
          value: text(nav.connection?.type),
          api: 'NetworkInformation.type',
          support: 'nonstandard',
          note: '非标准，仅 Chromium 系提供，且桌面端常为空。',
        },
        {
          id: 'downlink',
          label: '下行带宽估算',
          value: withUnit(nav.connection?.downlink, 'Mbit/s'),
          api: 'NetworkInformation.downlink',
          support: 'nonstandard',
          note: '非标准，且被刻意粗化到 25 kbit/s 量级并封顶，不可作为测速结果。',
        },
        {
          id: 'rtt',
          label: '往返时延估算',
          value: withUnit(nav.connection?.rtt, 'ms'),
          api: 'NetworkInformation.rtt',
          support: 'nonstandard',
          note: '非标准，已被移出规范草案，仅部分 Chromium 版本仍提供。',
        },
        {
          id: 'save-data',
          label: '省流量模式',
          value: yesNo(nav.connection?.saveData),
          api: 'NetworkInformation.saveData',
          support: 'nonstandard',
          note: '非标准，仅 Chromium 系提供。',
        },
        {
          id: 'cookie-enabled',
          label: '是否启用 Cookie',
          value: yesNo(nav.cookieEnabled),
          api: 'Navigator.cookieEnabled',
          support: 'standard',
          note: '只表示浏览器是否允许写入 Cookie，不代表当前站点一定写得进去（可能被第三方策略拦截）。',
        },
        {
          id: 'do-not-track',
          label: 'Do Not Track 信号',
          value: text(nav.doNotTrack),
          api: 'Navigator.doNotTrack',
          support: 'nonstandard',
          note:
            '非标准且已停止推进，主流浏览器多已移除该属性；它从来没有强制力，网站的遵守是自愿的。',
        },
      ],
    },
  ];

  return groups;
}

function formatUtcOffsetValue(offsetMinutes: number | null): string {
  if (offsetMinutes === null) return '不可用';
  return `${formatUtcOffset(offsetMinutes)}（${offsetMinutes >= 0 ? '+' : ''}${offsetMinutes} 分钟）`;
}

function describeBattery(battery: BatteryEnv | null | undefined): string {
  if (!battery) return '不可用（浏览器未提供该 API）';
  const percent = Number.isFinite(battery.level)
    ? `${Math.round(battery.level * 100)}%`
    : '不可用';
  const state = battery.charging ? '充电中' : '未充电';
  const parts = [`${state}，电量 ${percent}`];
  if (battery.charging && Number.isFinite(battery.chargingTime) && battery.chargingTime !== Infinity) {
    parts.push(`距充满约 ${Math.round(battery.chargingTime / 60)} 分钟`);
  }
  if (!battery.charging && Number.isFinite(battery.dischargingTime) && battery.dischargingTime !== Infinity) {
    parts.push(`距耗尽约 ${Math.round(battery.dischargingTime / 60)} 分钟`);
  }
  return parts.join('，');
}

function describeDisplayMode(media: MediaEnv): string {
  const modes: string[] = [];
  if (media.displayModeStandalone) modes.push('standalone（独立窗口，通常是已安装的 PWA）');
  if (media.displayModeMinimalUi) modes.push('minimal-ui');
  if (media.displayModeFullscreen) modes.push('fullscreen（无浏览器界面）');
  if (modes.length === 0) return 'browser（普通浏览器标签页）';
  return modes.join('；');
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface DeviceReport {
  tool: 'device-info';
  note: string;
  generatedAt: string;
  origin?: string;
  groups: InfoGroup[];
  consistency: ConsistencyCheck[];
}

const PRIVACY_NOTE =
  '以下数据全部由浏览器在本地读出，页面没有发起任何网络请求，也没有写入任何存储。请勿随意粘贴到公开场合。';

/**
 * Builds the JSON export.
 *
 * `generatedAtMs` is a parameter rather than `Date.now()` so the export is a
 * pure function of its inputs and can be asserted verbatim in the check script.
 */
export function buildReport(
  env: DeviceEnvironment,
  context: ReportContext,
): DeviceReport {
  return {
    tool: 'device-info',
    note: PRIVACY_NOTE,
    generatedAt: Number.isFinite(context.generatedAtMs)
      ? new Date(context.generatedAtMs).toISOString()
      : '不可用',
    ...(context.origin ? { origin: context.origin } : {}),
    groups: collectInfo(env),
    consistency: checkConsistency(env),
  };
}

export function reportToJson(
  env: DeviceEnvironment,
  context: ReportContext,
): string {
  return JSON.stringify(buildReport(env, context), null, 2);
}

/**
 * The plain-text export.
 *
 * One row per line with its API and standards status inline, because the text
 * version is what ends up pasted into an issue report; a bare "1920 × 1080"
 * without its provenance is exactly the kind of claim this tool exists to avoid.
 */
export function reportToText(
  env: DeviceEnvironment,
  context: ReportContext,
): string {
  const report = buildReport(env, context);
  const lines: string[] = [
    '设备与浏览器信息',
    `生成时间：${report.generatedAt}`,
  ];
  if (report.origin) lines.push(`页面来源：${report.origin}`);
  lines.push(PRIVACY_NOTE, '');

  for (const group of report.groups) {
    lines.push(`【${group.title}】`);
    for (const item of group.items) {
      lines.push(
        `  ${item.label}：${item.value}  [${item.api} · ${SUPPORT_LABELS[item.support]}]`,
      );
      if (item.note) lines.push(`    说明：${item.note}`);
    }
    lines.push('');
  }

  lines.push('【自洽性核对】');
  for (const check of report.consistency) {
    lines.push(`  ${check.ok ? '通过' : '不一致'}  ${check.label}`);
    lines.push(`    ${check.detail}`);
  }

  return lines.join('\n');
}

/** Counts how many items are marked non-standard, for the UI summary line. */
export function countBySupport(
  groups: InfoGroup[],
  level: SupportLevel,
): number {
  let total = 0;
  for (const group of groups) {
    for (const item of group.items) {
      if (item.support === level) total += 1;
    }
  }
  return total;
}
