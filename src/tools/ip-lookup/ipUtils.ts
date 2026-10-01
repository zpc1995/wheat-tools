/**
 * Lookup of the visitor's public IP address.
 *
 * There is no backend: this is a static site, so the browser must ask a
 * third-party service. `ipwho.is` is used because it is the only key-less
 * provider tested that returns `Access-Control-Allow-Origin: *` over HTTPS
 * (api.ipify.org sends no CORS header, ipapi.co answers 403 from a browser).
 *
 * That request necessarily discloses the caller's IP to that third party, so
 * the UI states this explicitly instead of hiding it behind a "query" button.
 */

const ENDPOINT = 'https://ipwho.is/';

export interface IpDetails {
  ip: string;
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
 * Fetches the caller's public IP details.
 *
 * `AbortController` provides the timeout, since `fetch` has none of its own;
 * without it a blocked request would leave the UI spinning indefinitely.
 */
export async function lookupPublicIp(timeoutMs = 10_000): Promise<IpDetails> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(ENDPOINT, {
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

/** Builds an OpenStreetMap link for the reported coordinates. */
export function mapLink(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=11/${latitude}/${longitude}`;
}
