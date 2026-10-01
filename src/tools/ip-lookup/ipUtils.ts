/**
 * Lookup of the visitor's public IP address.
 *
 * There is no backend: this is a static site, so the browser must ask a
 * third-party service. `ipwho.is` is used because it is the only key-less
 * provider tested that returns `Access-Control-Allow-Origin: *` over HTTPS
 * (api.ipify.org sends no CORS header, ipapi.co answers 403 from a browser).
 * It is also dual-stack, which matters for the protocol story below.
 *
 * That request necessarily discloses the caller's IP to that third party, so
 * the UI states this explicitly instead of hiding it behind a "query" button.
 */

const ENDPOINT = 'https://ipwho.is/';

/** Only the fields the UI renders, to keep the response small. */
const FIELDS = [
  'ip',
  'type',
  'continent',
  'country',
  'country_code',
  'region',
  'city',
  'postal',
  'calling_code',
  'capital',
  'latitude',
  'longitude',
  'connection',
  'timezone',
  'flag',
].join(',');

export interface IpDetails {
  ip: string;
  /** Protocol of this address, as reported by the API. */
  type: string;
  continent: string | null;
  country: string;
  countryCode: string;
  flagEmoji: string | null;
  region: string | null;
  city: string | null;
  postal: string | null;
  callingCode: string | null;
  capital: string | null;
  latitude: number | null;
  longitude: number | null;
  asn: number | null;
  org: string | null;
  isp: string | null;
  domain: string | null;
  timezoneId: string | null;
  timezoneAbbr: string | null;
  timezoneUtc: string | null;
}

type RawResponse = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function obj(value: unknown): RawResponse {
  return value && typeof value === 'object' ? (value as RawResponse) : {};
}

function mapResponse(raw: RawResponse): IpDetails {
  const connection = obj(raw.connection);
  const timezone = obj(raw.timezone);
  const flag = obj(raw.flag);

  return {
    ip: str(raw.ip) ?? '未知',
    type: str(raw.type) ?? '未知',
    continent: str(raw.continent),
    country: str(raw.country) ?? '未知',
    countryCode: str(raw.country_code) ?? '',
    flagEmoji: str(flag.emoji),
    region: str(raw.region),
    city: str(raw.city),
    postal: str(raw.postal),
    callingCode: str(raw.calling_code),
    capital: str(raw.capital),
    latitude: num(raw.latitude),
    longitude: num(raw.longitude),
    asn: num(connection.asn),
    org: str(connection.org),
    isp: str(connection.isp),
    domain: str(connection.domain),
    timezoneId: str(timezone.id),
    timezoneAbbr: str(timezone.abbr),
    timezoneUtc: str(timezone.utc),
  };
}

export class IpLookupError extends Error {
  /** True when the failure is a timeout rather than a rejection by the API. */
  readonly timedOut: boolean;

  constructor(message: string, timedOut = false) {
    super(message);
    this.name = 'IpLookupError';
    this.timedOut = timedOut;
  }
}

/**
 * Fetches IP details.
 *
 * `address` omitted → the caller's own IP, resolved over whichever stack the
 * browser can reach. Passing an explicit address (e.g. `2001:4860:4860::8888`)
 * queries that address instead, which is how the UI lets you check IPv6
 * connectivity on a v4-only machine.
 *
 * `AbortController` provides the timeout, since `fetch` has none of its own;
 * without it a blocked request would leave the UI spinning indefinitely.
 */
export async function lookupIp(
  address?: string,
  timeoutMs = 10_000,
): Promise<IpDetails> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  const url = address
    ? `${ENDPOINT}${encodeURIComponent(address)}?fields=${FIELDS}`
    : `${ENDPOINT}?fields=${FIELDS}`;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new IpLookupError(`查询接口返回 HTTP ${response.status}`);
    }

    const raw = (await response.json()) as RawResponse;

    // The API reports failures with HTTP 200 plus `success: false`.
    if (raw.success === false) {
      throw new IpLookupError(str(raw.message) ?? '查询接口拒绝了本次请求');
    }

    return mapResponse(raw);
  } catch (error) {
    if (error instanceof IpLookupError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new IpLookupError('查询超时，请检查网络或稍后重试', true);
    }
    throw new IpLookupError(
      '请求失败，可能是网络不可达，或该接口在当前网络下被拦截',
    );
  } finally {
    window.clearTimeout(timer);
  }
}

export type IpFamily = 'IPv4' | 'IPv6';

export interface OwnAddress {
  ip: string;
  family: IpFamily;
  /** Which service answered — shown in the UI so results are traceable. */
  source: string;
}

/** True for a dotted-quad IPv4 literal. */
function isIpv4(value: string): boolean {
  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts.every(
      (part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255,
    )
  );
}

/** True for anything containing a colon, which covers IPv6 in all notations. */
function isIpv6(value: string): boolean {
  return value.includes(':') && /^[0-9a-fA-F:.]+$/.test(value);
}

export function familyOf(value: string): IpFamily | null {
  if (isIpv4(value)) return 'IPv4';
  if (isIpv6(value)) return 'IPv6';
  return null;
}

/** Extracts the `ip=` line from Cloudflare's `key=value` trace format. */
function parseTrace(text: string): string | null {
  for (const line of text.split('\n')) {
    const index = line.indexOf('=');
    if (index > 0 && line.slice(0, index).trim() === 'ip') {
      const value = line.slice(index + 1).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

interface AddressSource {
  label: string;
  family: IpFamily;
  fetch: (signal: AbortSignal) => Promise<string | null>;
}

/**
 * Address sources, tried in order.
 *
 * More than one on purpose: a previous revision depended solely on
 * `cloudflare.com`, so any network that cannot reach Cloudflare lost the tool
 * entirely. Every entry below was verified to send
 * `Access-Control-Allow-Origin: *`.
 *
 * `ident.me` is listed first because it is a plain dual-stack JSON endpoint:
 * which of its hostnames answers tells us the visitor's own protocol without
 * any inference. The dedicated single-stack hosts (`ipv4.` / `ipv6.`) only
 * resolve on their respective stack, which makes them a direct connectivity
 * test as well.
 */
const ADDRESS_SOURCES: AddressSource[] = [
  {
    label: 'ident.me',
    family: 'IPv4',
    fetch: async (signal) => {
      const res = await fetch('https://ipv4.ident.me/.json', {
        signal,
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { address?: unknown };
      return typeof body.address === 'string' ? body.address : null;
    },
  },
  {
    label: 'cloudflare.com',
    family: 'IPv4',
    fetch: async (signal) => {
      const res = await fetch('https://www.cloudflare.com/cdn-cgi/trace', {
        signal,
        cache: 'no-store',
      });
      if (!res.ok) return null;
      return parseTrace(await res.text());
    },
  },
  {
    label: 'ipwho.is',
    family: 'IPv4',
    fetch: async (signal) => {
      const res = await fetch('https://ipwho.is/?fields=ip', {
        signal,
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { ip?: unknown };
      return typeof body.ip === 'string' ? body.ip : null;
    },
  },
];

const IPV6_ADDRESS_SOURCE: AddressSource = {
  label: 'ipv6.ident.me',
  family: 'IPv6',
  fetch: async (signal) => {
    const res = await fetch('https://ipv6.ident.me/.json', {
      signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { address?: unknown };
    return typeof body.address === 'string' ? body.address : null;
  },
};

/**
 * Tries each source until one yields a well-formed address of the expected
 * family.
 *
 * When `want` is 'IPv6' the IPv6-only host is consulted first: it is the only
 * way to learn an IPv6 address on a dual-stack machine, since a dual-stack
 * hostname may legitimately answer over IPv4.
 */
async function resolveOwnAddress(
  want: IpFamily,
  timeoutMs: number,
): Promise<OwnAddress | null> {
  const sources =
    want === 'IPv6'
      ? [IPV6_ADDRESS_SOURCE, ...ADDRESS_SOURCES]
      : ADDRESS_SOURCES;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (const source of sources) {
      try {
        const raw = await source.fetch(controller.signal);
        if (!raw) continue;
        const family = familyOf(raw);
        if (!family) continue;
        return { ip: raw, family, source: source.label };
      } catch {
        // Try the next source; total failure is handled by the caller.
      }
    }
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Fetches the caller's own address: IPv6 when the machine has it, else IPv4.
 *
 * IPv6 is attempted first so a dual-stack visitor sees their IPv6 address
 * rather than whichever stack a dual-stack hostname happened to pick.
 */
export async function lookupOwnAddress(
  timeoutMs = 9000,
): Promise<OwnAddress> {
  const ipv6 = await resolveOwnAddress('IPv6', timeoutMs);
  if (ipv6) return ipv6;

  const ipv4 = await resolveOwnAddress('IPv4', timeoutMs);
  if (ipv4) return ipv4;

  throw new IpLookupError(
    '所有地址探测服务都不可用（ident.me / cloudflare.com / ipwho.is 均失败），可能是网络受限或这些域名被拦截',
  );
}

export type Ipv6Status =
  | { state: 'checking' }
  | { state: 'native'; ip: string }
  | { state: 'reachable'; address: string }
  | { state: 'unavailable' };

/**
 * Checks IPv6 reachability for a visitor who arrived over IPv4.
 *
 * `ipv6.ident.me` publishes only an AAAA record, so a successful request proves
 * IPv6 works end to end and yields the visitor's IPv6 address. A failure means
 * IPv6 is unavailable *or* the host sent no CORS header; both are reported as
 * `unavailable` rather than claiming the visitor has no IPv6.
 */
export async function probeIpv6(timeoutMs = 7000): Promise<Ipv6Status> {
  const found = await resolveOwnAddress('IPv6', timeoutMs);
  if (found && found.family === 'IPv6') {
    return { state: 'reachable', address: found.ip };
  }
  return { state: 'unavailable' };
}

/** Builds an OpenStreetMap link for the reported coordinates. */
export function mapLink(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=11/${latitude}/${longitude}`;
}
