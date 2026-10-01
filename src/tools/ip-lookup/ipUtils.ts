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
  fetch: (signal: AbortSignal) => Promise<string | null>;
}

/**
 * Single-stack sources for each family.
 *
 * `ident.me` publishes A-only and AAAA-only hostnames, so which one answers
 * tells us directly whether that family works for this visitor — no inference
 * needed. Both were verified to send `Access-Control-Allow-Origin: *`.
 *
 * Network failure is the *expected* outcome for a family the visitor lacks, so
 * a null result here is normal, not an error.
 */
const SOURCES: Record<IpFamily, AddressSource[]> = {
  IPv4: [
    {
      label: 'ident.me',
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
  ],
  IPv6: [
    {
      label: 'ident.me',
      fetch: async (signal) => {
        const res = await fetch('https://ipv6.ident.me/.json', {
          signal,
          cache: 'no-store',
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { address?: unknown };
        return typeof body.address === 'string' ? body.address : null;
      },
    },
    {
      // Dual-stack fallback: only useful if the browser happens to connect
      // over IPv6, but it costs nothing to try when ident.me is unreachable.
      label: 'ipwho.is',
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
  ],
};

/** Tries each source for one family until a well-formed address comes back. */
async function resolveFamily(
  family: IpFamily,
  timeoutMs: number,
): Promise<OwnAddress | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (const source of SOURCES[family]) {
      try {
        const raw = await source.fetch(controller.signal);
        if (!raw) continue;
        if (familyOf(raw) !== family) continue;
        return { ip: raw, family, source: source.label };
      } catch {
        // Try the next source.
      }
    }
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export interface OwnAddresses {
  ipv4: OwnAddress | null;
  ipv6: OwnAddress | null;
}

/**
 * Resolves both families, concurrently.
 *
 * Queried in parallel rather than sequentially so a machine without IPv6 does
 * not pay the IPv6 timeout before its IPv4 address appears. Each family is
 * independent: `null` simply means that stack is not usable from here.
 */
export async function lookupBothFamilies(
  timeoutMs = 9000,
): Promise<OwnAddresses> {
  const [ipv4, ipv6] = await Promise.all([
    resolveFamily('IPv4', timeoutMs),
    resolveFamily('IPv6', timeoutMs),
  ]);
  return { ipv4, ipv6 };
}

/** Looks up geography/ASN for several addresses concurrently. */
export async function lookupMany(
  addresses: Array<{ family: IpFamily; ip: string }>,
): Promise<Partial<Record<IpFamily, IpDetails>>> {
  const results = await Promise.allSettled(
    addresses.map(async (item) => [item.family, await lookupIp(item.ip)] as const),
  );

  const out: Partial<Record<IpFamily, IpDetails>> = {};
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const [family, details] = result.value;
      out[family] = details;
    }
  }
  return out;
}

/** Builds an OpenStreetMap link for the reported coordinates. */
export function mapLink(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=11/${latitude}/${longitude}`;
}
