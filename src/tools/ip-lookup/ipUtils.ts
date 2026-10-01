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

/**
 * The visitor's own address, as actually observed on the wire.
 *
 * Cloudflare's trace endpoint is used for this because it reports the address
 * whose protocol the browser really connected with: over IPv6 it echoes the
 * public IPv6 address, over IPv4 the IPv4 one. It also sends
 * `Access-Control-Allow-Origin: *`.
 *
 * An earlier revision tried to infer IPv6 support by asking ipwho.is to look up
 * a *known* IPv6 address. That was wrong: it only proved the machine could
 * reach ipwho.is over IPv4 and read a record, saying nothing about the
 * visitor's own IPv6 connectivity. It reported "IPv6 reachable" on a host with
 * no global IPv6 route at all.
 */
const TRACE_ENDPOINT = 'https://www.cloudflare.com/cdn-cgi/trace';

export interface OwnAddress {
  ip: string;
  /** 'IPv6' when the address contains a colon, else 'IPv4'. */
  family: 'IPv4' | 'IPv6';
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

/**
 * Fetches the caller's own public address and its protocol.
 *
 * This is the only trustworthy way to learn which stack the visitor is on:
 * the answer comes from the connection that was actually made.
 */
export async function lookupOwnAddress(timeoutMs = 8000): Promise<OwnAddress> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(TRACE_ENDPOINT, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new IpLookupError(`IP 探测接口返回 HTTP ${response.status}`);
    }
    const ip = parseTrace(await response.text());
    if (!ip) {
      throw new IpLookupError('IP 探测接口返回的内容无法解析');
    }
    return { ip, family: ip.includes(':') ? 'IPv6' : 'IPv4' };
  } catch (error) {
    if (error instanceof IpLookupError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new IpLookupError('探测超时，请检查网络或稍后重试', true);
    }
    throw new IpLookupError('探测失败，可能是网络不可达或该接口被拦截');
  } finally {
    window.clearTimeout(timer);
  }
}

export type Ipv6Status =
  | { state: 'checking' }
  | { state: 'native' }
  | { state: 'reachable'; address: string }
  | { state: 'unknown' };

/**
 * Best-effort check for IPv6 reachability when the visitor arrived over IPv4.
 *
 * `ipv6.ident.me` publishes only an AAAA record, so a successful request proves
 * IPv6 works end to end and yields the visitor's IPv6 address.
 *
 * Caveat, stated rather than hidden: a failure is ambiguous. It means either
 * that IPv6 is unavailable, or that `ident.me` did not send CORS headers for
 * this origin. The CORS behaviour could not be verified while developing,
 * because the development host has no IPv6 route at all. The UI therefore
 * reports the failure as "无法确认", not as "你没有 IPv6".
 */
export async function probeIpv6(timeoutMs = 6000): Promise<Ipv6Status> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://ipv6.ident.me/.json', {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return { state: 'unknown' };
    const body = (await response.json()) as { address?: unknown };
    const address = typeof body.address === 'string' ? body.address : null;
    if (!address || !address.includes(':')) return { state: 'unknown' };
    return { state: 'reachable', address };
  } catch {
    return { state: 'unknown' };
  } finally {
    window.clearTimeout(timer);
  }
}

/** Builds an OpenStreetMap link for the reported coordinates. */
export function mapLink(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=11/${latitude}/${longitude}`;
}
