/**
 * Reads the browser environment into the plain object the pure logic consumes.
 *
 * This is the only file in the tool that touches the DOM, and it is deliberately
 * kept free of logic: every reading is copied out verbatim, with no arithmetic
 * and no derived values. That split is what lets `deviceInfoUtils.ts` be tested
 * in Node with injected fakes — including fakes that are internally inconsistent,
 * which is how the consistency report is proven to actually catch problems.
 *
 * ## What this file does not do
 *
 * It reads display-related properties and nothing else. In particular it never
 * draws anything into a canvas, never reads pixels back out, never touches the
 * audio stack and never enumerates media devices, fonts or codecs. Those are the
 * ingredients of a *fingerprint* — a stable identifier built by combining
 * measurements that individually say little — and building one is explicitly out
 * of scope. A WebGL context is obtained solely to read the vendor/renderer
 * strings the browser reports; the single pixel it renders is a side effect of
 * creating the context at all, and its contents are never inspected.
 *
 * Nothing here writes to storage or makes a network request either: the readings
 * are shown to the person who asked for them and nowhere else.
 */

import type {
  BatteryEnv,
  ConnectionEnv,
  DeviceEnvironment,
  MediaEnv,
  NavEnv,
  ScreenEnv,
  UserAgentBrand,
  UserAgentDataEnv,
  WebglEnv,
} from './deviceInfoUtils';

/**
 * The bits of `Navigator` this tool reads.
 *
 * Declared structurally and reached through a single cast because half of these
 * properties (`deviceMemory`, `connection`, `userAgentData`, `standalone`,
 * `getBattery`) are not in the standard DOM type library at all — which is
 * itself the point: they are Chromium-and-friends extensions, and the UI marks
 * them as such. Going through one interface keeps the non-standard reads in one
 * visible place instead of scattering casts through the code.
 */
interface ProbeNavigator {
  userAgent: string;
  platform?: string;
  vendor?: string;
  language: string;
  languages?: readonly string[];
  hardwareConcurrency?: number;
  maxTouchPoints?: number;
  cookieEnabled?: boolean;
  onLine?: boolean;
  doNotTrack?: string | null;
  /** Non-standard: Chromium only. */
  deviceMemory?: number;
  /** Non-standard: Network Information API (Chromium only). */
  connection?: ConnectionEnv | null;
  /** Non-standard: User-Agent Client Hints (Chromium only). */
  userAgentData?: {
    mobile?: boolean;
    platform?: string;
    brands?: UserAgentBrand[];
  } | null;
  /** Non-standard: iOS Safari standalone web app. */
  standalone?: boolean;
  /** Non-standard: Battery Status API. */
  getBattery?: () => Promise<{
    charging: boolean;
    level: number;
    chargingTime: number;
    dischargingTime: number;
  }>;
}

/** The minimal shape of a WebGL context needed to read its identity strings. */
interface GlContext {
  getParameter(parameter: number): unknown;
  getExtension(
    name: string,
  ): { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null;
}

// WebGL enum values, spelled out because the constants live on the context and
// the context is exactly what might be missing.
const GL_VENDOR = 0x1f00;
const GL_RENDERER = 0x1f01;
const GL_VERSION = 0x1f02;
const GL_SHADING_LANGUAGE_VERSION = 0x8b8c;

/** `matchMedia` that cannot throw on a query the engine does not understand. */
function matches(query: string): boolean {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

function readScreen(): ScreenEnv {
  const { screen } = window;
  const orientation = screen.orientation;
  return {
    width: screen.width,
    height: screen.height,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    colorDepth: screen.colorDepth,
    pixelDepth: screen.pixelDepth,
    orientationType: orientation?.type,
    orientationAngle: orientation?.angle,
  };
}

function readMedia(nav: ProbeNavigator): MediaEnv {
  return {
    colorSchemeDark: matches('(prefers-color-scheme: dark)'),
    reducedMotion: matches('(prefers-reduced-motion: reduce)'),
    prefersContrastMore: matches('(prefers-contrast: more)'),
    forcedColorsActive: matches('(forced-colors: active)'),
    pointerCoarse: matches('(pointer: coarse)'),
    hoverNone: matches('(hover: none)'),
    displayModeStandalone: matches('(display-mode: standalone)'),
    displayModeMinimalUi: matches('(display-mode: minimal-ui)'),
    displayModeFullscreen: matches('(display-mode: fullscreen)'),
    navigatorStandalone: nav.standalone === true,
  };
}

function readNav(nav: ProbeNavigator, battery: BatteryEnv | null): NavEnv {
  const uaData = nav.userAgentData ?? null;
  const userAgentData: UserAgentDataEnv | null = uaData
    ? {
        mobile: uaData.mobile,
        platform: uaData.platform,
        brands: Array.isArray(uaData.brands)
          ? uaData.brands.map((brand) => ({
              brand: String(brand.brand),
              version: String(brand.version),
            }))
          : undefined,
      }
    : null;

  return {
    userAgent: nav.userAgent ?? '',
    platform: nav.platform,
    vendor: nav.vendor,
    language: nav.language ?? '',
    languages: Array.isArray(nav.languages) ? [...nav.languages] : [],
    hardwareConcurrency:
      typeof nav.hardwareConcurrency === 'number'
        ? nav.hardwareConcurrency
        : undefined,
    deviceMemory:
      typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
    maxTouchPoints:
      typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0,
    touchEventSupported: 'ontouchstart' in window,
    cookieEnabled: nav.cookieEnabled === true,
    onLine: nav.onLine !== false,
    doNotTrack: nav.doNotTrack ?? null,
    userAgentData,
    connection: nav.connection ?? null,
    battery,
  };
}

/**
 * Reads the WebGL identity strings, if a context can be obtained at all.
 *
 * Two requests are made in order: WebGL2 first, then WebGL1. A machine with a
 * blocked GPU returns null for both and the UI says "不可用" rather than showing
 * an empty row that looks like a bug.
 */
function readWebgl(): WebglEnv | null {
  let canvas: HTMLCanvasElement;
  try {
    canvas = document.createElement('canvas');
  } catch {
    return null;
  }

  let context: GlContext | null = null;
  let contextName = '';
  try {
    context = canvas.getContext('webgl2') as unknown as GlContext | null;
    if (context) contextName = 'webgl2';
    if (!context) {
      context = canvas.getContext('webgl') as unknown as GlContext | null;
      if (context) contextName = 'webgl';
    }
  } catch {
    return null;
  }
  if (!context) return null;

  const readParameter = (name: number): string => {
    try {
      const value = context?.getParameter(name);
      return value === null || value === undefined ? '' : String(value);
    } catch {
      return '';
    }
  };

  let unmaskedVendor: string | undefined;
  let unmaskedRenderer: string | undefined;
  try {
    const debugInfo = context.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      unmaskedVendor = readParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
      unmaskedRenderer = readParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    }
  } catch {
    // The extension is optional and may be withheld; the masked strings above
    // are still worth showing.
  }

  return {
    contextName,
    version: readParameter(GL_VERSION),
    shadingLanguageVersion: readParameter(GL_SHADING_LANGUAGE_VERSION),
    vendor: readParameter(GL_VENDOR),
    renderer: readParameter(GL_RENDERER),
    unmaskedVendor: unmaskedVendor || undefined,
    unmaskedRenderer: unmaskedRenderer || undefined,
  };
}

function localizedTimeZoneName(
  timeZone: string,
  sampleMs: number,
): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      timeZoneName: 'long',
    }).formatToParts(new Date(sampleMs));
    return parts.find((part) => part.type === 'timeZoneName')?.value;
  } catch {
    return undefined;
  }
}

/**
 * The Battery Status API is asynchronous, so it is read separately and merged in
 * once it resolves. Everything else is synchronous and available on first paint.
 */
export async function readBattery(): Promise<BatteryEnv | null> {
  const nav = navigator as unknown as ProbeNavigator;
  if (typeof nav.getBattery !== 'function') return null;
  try {
    const battery = await nav.getBattery();
    return {
      charging: battery.charging === true,
      level: typeof battery.level === 'number' ? battery.level : Number.NaN,
      chargingTime:
        typeof battery.chargingTime === 'number'
          ? battery.chargingTime
          : Number.NaN,
      dischargingTime:
        typeof battery.dischargingTime === 'number'
          ? battery.dischargingTime
          : Number.NaN,
    };
  } catch {
    // Chrome gates this behind a secure context and may reject; "no answer" is
    // the honest outcome.
    return null;
  }
}

/** Reads everything that is available synchronously. */
export function readDeviceEnvironment(battery: BatteryEnv | null = null): DeviceEnvironment {
  const nav = navigator as unknown as ProbeNavigator;
  const sampleMs = Date.now();
  const timeZone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    } catch {
      return '';
    }
  })();

  return {
    screen: readScreen(),
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      screenX: window.screenX,
      screenY: window.screenY,
      devicePixelRatio: window.devicePixelRatio,
      isFullscreen: document.fullscreenElement !== null,
    },
    layoutViewport: {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    },
    nav: readNav(nav, battery),
    media: readMedia(nav),
    time: {
      timeZone,
      getTimezoneOffsetMinutes: new Date(sampleMs).getTimezoneOffset(),
      sampleMs,
      localizedTimeZoneName: localizedTimeZoneName(timeZone, sampleMs),
    },
    webgl: readWebgl(),
  };
}

/** The page origin, used only as a header in the exported report. */
export function readOrigin(): string {
  try {
    return window.location.origin;
  } catch {
    return '';
  }
}
