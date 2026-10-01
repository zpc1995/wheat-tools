/**
 * IPv6 Unique Local Address (ULA) generation, per RFC 4193, plus RFC 5952 text
 * formatting.
 *
 * Everything here is pure: the clock and the random bytes are parameters. That
 * is what makes the two Global ID algorithms checkable — the random one can be
 * fed an exact five-byte sequence, and the RFC 4193 one can be fed an exact NTP
 * timestamp and EUI-64 and compared against a SHA-1 computed elsewhere.
 *
 * The address layout from RFC 4193 §3.1:
 *
 *   | 7 bits |1|  40 bits   |  16 bits  |          64 bits           |
 *   +--------+-+------------+-----------+----------------------------+
 *   | Prefix |L| Global ID  | Subnet ID |        Interface ID        |
 *   +--------+-+------------+-----------+----------------------------+
 *
 * Prefix is FC00::/7; L = 1 marks the locally assigned variant, which is what
 * makes the first octet FD (1111 1101) and produces the familiar fd00::/8.
 *
 * The "u" bit convention
 * ----------------------
 * RFC 4193 itself only defines the L bit, and the sample algorithm in §3.2.2
 * says nothing about any other bit inside the 40-bit Global ID. The separately
 * defined "u" (universal/local) bit from the modified EUI-64 in RFC 4291
 * Appendix A is bit 6 of the first octet, counting from 0 at the most
 * significant end — a mask of 0x02. Its meaning is 0 = locally administered,
 * 1 = derived from a globally unique identifier. A ULA Global ID is by
 * definition locally assigned, so this tool keeps that bit 0 in the Global ID's
 * first octet and says so on screen, because a prefix whose u bit is 1 claims
 * something about the identifier that is not true. The u bit lives in the
 * Global ID (the octet right after FD), which is a different bit position from
 * the L bit (the low bit of FD).
 *
 * Nothing here computes subnets: no prefix splitting, no address-plan maths.
 */

export class UlaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UlaError';
  }
}

/**
 * A source of random bytes: given a length, return exactly that many bytes.
 *
 * Bytes rather than floats because a 40-bit identifier is naturally five bytes,
 * and because a check can hand over a fixed array.
 */
export type RandomByteSource = (length: number) => Uint8Array;

export const GLOBAL_ID_BITS = 40;
export const GLOBAL_ID_BYTES = 5;
export const SUBNET_ID_BITS = 16;
export const INTERFACE_ID_BYTES = 8;
export const ADDRESS_BYTES = 16;

/** The FC00::/7 prefix with L = 1, i.e. fd00::/8. */
export const ULA_FIRST_BYTE = 0xfd;

/** Bit 6 of the first octet, counting from 0 at the most significant end. */
export const U_BIT_MASK = 0x02;

/** The bit RFC 4291 Appendix A flips to build an EUI-64 from a MAC address. */
export const EUI64_U_BIT_MASK = 0x02;

function assertByteLength(bytes: Uint8Array, length: number, label: string): void {
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
    throw new UlaError(`${label}必须是 ${length} 字节，收到长度 ${bytes ? bytes.length : '未知'}`);
  }
}

/** Lowercase hex, no separators. Used for every byte-string rendering. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Parses a hex string with optional separators into exactly `length` bytes.
 *
 * Accepts `1a2b3c`, `1a:2b:3c`, `1a-2b-3c`, `1a 2b 3c` and a leading `0x`,
 * because those are all spellings of the same MAC or identifier that people
 * paste from different tools. Separators are stripped before the length check,
 * so `1a:2b` and `1a2b` are the same input.
 */
export function parseHexBytes(text: string, length: number, label: string): Uint8Array {
  const cleaned = text.trim().replace(/^0[xX]/, '').replace(/[\s:.-]/g, '');
  if (cleaned.length === 0) {
    throw new UlaError(`${label}不能为空`);
  }
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new UlaError(`${label}含有非十六进制字符："${text.trim()}"`);
  }
  if (cleaned.length !== length * 2) {
    throw new UlaError(`${label}应为 ${length * 2} 个十六进制字符（${length} 字节），收到 ${cleaned.length} 个`);
  }
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Number.parseInt(cleaned.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// SHA-1 (FIPS 180-1 / RFC 3174)
// ---------------------------------------------------------------------------

/**
 * SHA-1 over a byte string.
 *
 * Hand-written rather than taken from Web Crypto because the RFC 4193
 * derivation has to be a pure function: `crypto.subtle.digest` is asynchronous,
 * which would push the whole algorithm into the component and make it testable
 * only through the UI. SHA-1 is used here as a mixing function for identifiers,
 * not as a signature, so its collision weakness is irrelevant; the check script
 * nevertheless compares this implementation against `node:crypto` on the FIPS
 * test vectors and on random inputs.
 *
 * All arithmetic is on 32-bit words with `>>> 0` after every addition, because
 * JavaScript's bitwise operators are signed and the round function overflows
 * constantly.
 */
export function sha1(message: Uint8Array): Uint8Array {
  const bitLength = message.length * 8;
  // Pad to a multiple of 64 bytes with room for the 8-byte length field:
  // 0x80, then zeros, then the length, with the total congruent to 56 mod 64.
  const padded = new Uint8Array((((message.length + 8) >> 6) + 1) << 6);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 4294967296));
  view.setUint32(padded.length - 4, bitLength % 4294967296);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const words = new Uint32Array(80);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 80; index += 1) {
      const mixed = words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16];
      words[index] = ((mixed << 1) | (mixed >>> 31)) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let index = 0; index < 80; index += 1) {
      let f;
      let k;
      if (index < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (index < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (index < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = ((((a << 5) | (a >>> 27)) + f + e + k + words[index]) >>> 0);
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const digest = new Uint8Array(20);
  const out = new DataView(digest.buffer);
  out.setUint32(0, h0);
  out.setUint32(4, h1);
  out.setUint32(8, h2);
  out.setUint32(12, h3);
  out.setUint32(16, h4);
  return digest;
}

// ---------------------------------------------------------------------------
// NTP timestamps (RFC 5905 §6)
// ---------------------------------------------------------------------------

/** Seconds between the NTP epoch (1900-01-01) and the Unix epoch (1970-01-01). */
export const NTP_EPOCH_OFFSET_SECONDS = 2_208_988_800;

/** 64-bit NTP timestamp: 32-bit seconds since 1900 plus a 32-bit fraction. */
export interface NtpTimestamp {
  seconds: number;
  fraction: number;
}

/**
 * Converts a Unix millisecond timestamp into the NTP 64-bit form.
 *
 * The fraction is `ms_in_second * 2^32 / 1000`, floored — the same conversion
 * NTP itself uses (2^-32 s resolution, about 233 picoseconds). Millisecond input
 * therefore cannot round-trip exactly; the check script asserts which
 * millisecond values do and which do not rather than pretending otherwise.
 */
export function toNtpTimestamp(epochMs: number): NtpTimestamp {
  if (!Number.isFinite(epochMs)) {
    throw new UlaError(`时间戳必须是有限数值，收到 "${String(epochMs)}"`);
  }
  const wholeMs = Math.floor(epochMs);
  const seconds = Math.floor(wholeMs / 1000);
  const millisInSecond = wholeMs - seconds * 1000;
  const ntpSeconds = seconds + NTP_EPOCH_OFFSET_SECONDS;
  if (ntpSeconds < 0) {
    throw new UlaError('NTP 时间戳不能早于 1900 年');
  }
  return {
    seconds: ntpSeconds,
    fraction: Math.floor((millisInSecond * 4294967296) / 1000),
  };
}

/** The 8-byte big-endian encoding of an NTP timestamp. */
export function ntpToBytes(ntp: NtpTimestamp): Uint8Array {  if (!Number.isInteger(ntp.seconds) || ntp.seconds < 0 || ntp.seconds > 0xffffffff) {
    throw new UlaError(`NTP 秒字段超出 32 位范围：${ntp.seconds}`);
  }
  if (!Number.isInteger(ntp.fraction) || ntp.fraction < 0 || ntp.fraction > 0xffffffff) {
    throw new UlaError(`NTP 小数秒字段超出 32 位范围：${ntp.fraction}`);
  }
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, ntp.seconds);
  view.setUint32(4, ntp.fraction);
  return bytes;
}

/** ISO 8601 UTC text for a Unix millisecond value. Pure: no clock is read. */
export function formatUtcIso(epochMs: number): string {
  return new Date(Math.floor(epochMs)).toISOString();
}

/**
 * The Unix millisecond value a 64-bit NTP timestamp represents.
 *
 * Used only to show the timestamp on screen in a form a human can read; the
 * conversion back is exact to the millisecond, which the check script asserts
 * against `toNtpTimestamp` in both directions.
 */
export function ntpToEpochMs(ntp: NtpTimestamp): number {
  return (ntp.seconds - NTP_EPOCH_OFFSET_SECONDS) * 1000 + (ntp.fraction * 1000) / 4294967296;
}

// ---------------------------------------------------------------------------
// MAC -> EUI-64
// ---------------------------------------------------------------------------

/**
 * Parses a MAC-48 (`34:56:78:9a:bc:de`) or an EUI-64 (`36:56:78:ff:fe:9a:bc:de`).
 *
 * Accepts 12 or 16 hex digits (separators optional). Returning the EUI-64 form
 * for both means the RFC 4193 derivation has one input shape to deal with.
 */
export function parseEui64(text: string): Uint8Array {
  const cleaned = text.trim().replace(/^0[xX]/, '').replace(/[\s:.-]/g, '');
  if (cleaned.length === 16) {
    // Already an EUI-64: taken as-is. The u bit is left alone, because an
    // EUI-64 that came from a real interface already carries its own value.
    return parseHexBytes(text, 8, 'EUI-64');
  }
  const mac = parseHexBytes(text, 6, 'MAC 地址');
  return macToEui64(mac);
}

/**
 * Builds an EUI-64 from a 48-bit MAC, exactly as RFC 4291 Appendix A describes:
 * insert FF-FE in the middle, then invert the u bit of the first octet.
 *
 * The inversion is the part people get wrong. A MAC address is a *universal*
 * identifier (u = 0 in the MAC's own framing), while the modified EUI-64 form
 * stores the identifier with u = 1 to say "this came from a global authority".
 * RFC 4291's own example is 34-56-78-9A-BC-DE becoming 36-56-78-FF-FE-9A-BC-DE,
 * which the check script asserts.
 */
export function macToEui64(mac: Uint8Array): Uint8Array {
  assertByteLength(mac, 6, 'MAC 地址');
  const eui = new Uint8Array(8);
  eui.set(mac.subarray(0, 3), 0);
  eui[3] = 0xff;
  eui[4] = 0xfe;
  eui.set(mac.subarray(3, 6), 5);
  eui[0] = (eui[0] ^ EUI64_U_BIT_MASK) & 0xff;
  return eui;
}

// ---------------------------------------------------------------------------
// Global ID
// ---------------------------------------------------------------------------

/** True when the Global ID's u bit (mask 0x02 of its first octet) is set. */
export function hasUbitSet(globalId: Uint8Array): boolean {
  assertByteLength(globalId, GLOBAL_ID_BYTES, '全局 ID');
  return (globalId[0] & U_BIT_MASK) !== 0;
}

/** The same Global ID with the u bit cleared. Never mutates the input. */
export function withUbitCleared(globalId: Uint8Array): Uint8Array {
  assertByteLength(globalId, GLOBAL_ID_BYTES, '全局 ID');
  const copy = Uint8Array.from(globalId);
  copy[0] = copy[0] & ~U_BIT_MASK & 0xff;
  return copy;
}

export interface GlobalIdResult {
  /** The 40-bit value that goes into the address, u bit cleared. */
  bytes: Uint8Array;
  /** The value before normalisation; differs only in the u bit. */
  raw: Uint8Array;
  /** True when the u bit had to be cleared. */
  uBitCleared: boolean;
  /** True for the RFC 4193 time + EUI-64 derivation. */
  derived: boolean;
  /** The NTP timestamp used, present only for the derived form. */
  ntp: NtpTimestamp | null;
  /** The 16-byte hash input, present only for the derived form. */
  key: Uint8Array | null;
  /** The 20-byte SHA-1 digest, present only for the derived form. */
  digest: Uint8Array | null;
}

function normalise(
  globalId: Uint8Array,
  derived: boolean,
  ntp: NtpTimestamp | null,
  key: Uint8Array | null = null,
  digest: Uint8Array | null = null,
): GlobalIdResult {
  const raw = Uint8Array.from(globalId);
  return {
    bytes: withUbitCleared(raw),
    raw,
    uBitCleared: hasUbitSet(raw),
    derived,
    ntp,
    key,
    digest,
  };
}

/**
 * A Global ID from five caller-supplied bytes.
 *
 * RFC 4193 §3.2.1 requires a pseudo-random algorithm and forbids sequential or
 * well-known values. Random bytes are the better of the two options the tool
 * offers: the time + EUI-64 derivation makes the identifier reproducible by
 * anyone who can guess roughly when the prefix was generated and which network
 * card was in the machine, whereas a fresh random value has no such story.
 *
 * The u bit is cleared here rather than by the caller, so every Global ID this
 * module hands out already satisfies the invariant that `buildUlaAddress`
 * checks. The caller is told when the bit was actually set.
 */
export function globalIdFromBytes(bytes: Uint8Array): GlobalIdResult {
  assertByteLength(bytes, GLOBAL_ID_BYTES, '随机字节');
  return normalise(bytes, false, null);
}

/**
 * The hash input of the RFC 4193 §3.2.2 algorithm: the timestamp followed by
 * the system identifier, 16 bytes in total.
 */
export function deriveKey(ntp: NtpTimestamp, eui64: Uint8Array): Uint8Array {
  assertByteLength(eui64, 8, 'EUI-64');
  const key = new Uint8Array(16);
  key.set(ntpToBytes(ntp), 0);
  key.set(eui64, 8);
  return key;
}

/**
 * Global ID by the RFC 4193 §3.2.2 sample algorithm.
 *
 * Steps 1-5 of the RFC: NTP time (64 bits) concatenated with an EUI-64, hashed
 * with SHA-1, and "the least significant 40 bits" taken as the Global ID. The
 * least significant bits of a 160-bit digest are its last five bytes, so the
 * slice is `digest[15..19]` and no bit shuffling is involved.
 */
export function globalIdFromTimeAndEui64(ntp: NtpTimestamp, eui64: Uint8Array): GlobalIdResult {
  const key = deriveKey(ntp, eui64);
  const digest = sha1(key);
  const globalId = digest.slice(digest.length - GLOBAL_ID_BYTES);
  return normalise(globalId, true, ntp, key, digest);
}

/** The Global ID as 10 lowercase hex digits, the way it appears in the prefix. */
export function formatGlobalId(globalId: Uint8Array): string {
  assertByteLength(globalId, GLOBAL_ID_BYTES, '全局 ID');
  return toHex(globalId);
}

/** Parses a 40-bit Global ID: `123456789a`, `12:34:56:78:9a` or `0x123456789a`. */
export function parseGlobalId(text: string): Uint8Array {
  return parseHexBytes(text, GLOBAL_ID_BYTES, '全局 ID');
}

/**
 * Parses a 16-bit subnet ID from a text field.
 *
 * Bare digits are decimal, so `10` is ten and not sixteen; anything with a `0x`
 * prefix or a letter in it is hex. The rule is spelled out because the
 * alternative — "a bare `10` in a hex field is 0x10" — silently produces a
 * different subnet than the one typed, and subnet IDs end up in router config.
 */
export function parseSubnetId(text: string): number {
  const value = text.trim();
  if (value.length === 0) {
    throw new UlaError('子网 ID 不能为空（可以是 0）');
  }
  if (/^0[xX][0-9a-fA-F]{1,4}$/.test(value)) {
    return Number.parseInt(value.slice(2), 16);
  }
  if (/^\d{1,5}$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    if (parsed > 0xffff) {
      throw new UlaError(`子网 ID 不能超过 65535，收到 "${value}"`);
    }
    return parsed;
  }
  if (/^[0-9a-fA-F]{1,4}$/.test(value)) {
    return Number.parseInt(value, 16);
  }
  throw new UlaError(`无法识别的子网 ID："${value}"（支持十进制、0x 前缀或 1–4 位十六进制）`);
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * Assembles the 16 address bytes from the three variable fields.
 *
 * Byte 0 is FD (FC00::/7 with the L bit set), bytes 1-5 are the Global ID,
 * bytes 6-7 the Subnet ID and bytes 8-15 the Interface ID — the RFC 4193 §3.1
 * figure read left to right.
 *
 * A Global ID whose u bit is set is rejected rather than silently repaired.
 * Every path that produces one (`globalIdFromBytes`, `globalIdFromTimeAndEui64`)
 * already clears the bit, so reaching this error means a caller handed over a
 * raw 40-bit value from somewhere else — and quietly changing the caller's
 * number in an assembler is the kind of help that hides a bug. A ULA prefix
 * whose u bit is 1 claims a globally administered identifier, which is not what
 * an fd00::/8 site has.
 */
export function buildUlaAddress(
  globalId: Uint8Array,
  subnetId: number,
  interfaceId: Uint8Array,
): Uint8Array {
  assertByteLength(globalId, GLOBAL_ID_BYTES, '全局 ID');
  assertByteLength(interfaceId, INTERFACE_ID_BYTES, '接口 ID');
  if (hasUbitSet(globalId)) {
    throw new UlaError(
      `全局 ID ${toHex(globalId)} 的 u 位（掩码 0x02）为 1；本地分配的 ULA 前缀要求该位为 0，请先用 withUbitCleared 清除`,
    );
  }
  if (!Number.isInteger(subnetId) || subnetId < 0 || subnetId > 0xffff) {
    throw new UlaError(`子网 ID 必须是 0 到 65535 之间的整数，收到 "${subnetId}"`);
  }
  const address = new Uint8Array(ADDRESS_BYTES);
  address[0] = ULA_FIRST_BYTE;
  address.set(globalId, 1);
  address[6] = (subnetId >>> 8) & 0xff;
  address[7] = subnetId & 0xff;
  address.set(interfaceId, 8);
  return address;
}

/** The eight 16-bit groups of an address, most significant first. */
export function groupsOf(bytes: Uint8Array): number[] {
  assertByteLength(bytes, ADDRESS_BYTES, 'IPv6 地址');
  const groups: number[] = [];
  for (let index = 0; index < 8; index += 1) {
    groups.push(bytes[index * 2] * 256 + bytes[index * 2 + 1]);
  }
  return groups;
}

/** The 16 address bytes for eight 16-bit groups. */
export function bytesOf(groups: readonly number[]): Uint8Array {
  if (groups.length !== 8) {
    throw new UlaError(`IPv6 地址必须由 8 组 16 位字段组成，收到 ${groups.length} 组`);
  }
  const bytes = new Uint8Array(ADDRESS_BYTES);
  groups.forEach((group, index) => {
    if (!Number.isInteger(group) || group < 0 || group > 0xffff) {
      throw new UlaError(`第 ${index + 1} 组不是 0 到 65535 之间的整数："${group}"`);
    }
    bytes[index * 2] = (group >>> 8) & 0xff;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

/**
 * The uncompressed form: eight groups, each with leading zeros suppressed but
 * at least one digit, lowercase. `fd10:3456:789a:1:21a:2b3c:4d5e:6f70`.
 *
 * RFC 5952 §4.1 makes leading-zero suppression mandatory and forbids the
 * all-zero group from being written as anything but `0`; it says nothing about
 * compressing, which is `compressGroups` below.
 */
export function formatIpv6Full(bytes: Uint8Array): string {
  return groupsOf(bytes)
    .map((group) => group.toString(16))
    .join(':');
}

/**
 * The same eight groups, each padded to four hex digits:
 * `fd10:3456:789a:0001:021a:2b3c:4d5e:6f70`.
 *
 * This is the form to read when the point is *where* the field boundaries are —
 * the first three groups are the /48, the fourth is the subnet, the last four
 * are the interface ID. It is deliberately not the canonical form (RFC 5952 §4.1
 * suppresses those zeros), which is why the UI shows it under a label saying so.
 */
export function formatIpv6Padded(bytes: Uint8Array): string {
  return groupsOf(bytes)
    .map((group) => group.toString(16).padStart(4, '0'))
    .join(':');
}

/**
 * RFC 5952 §4.2 zero compression.
 *
 * The three rules, and the reason each needs its own code path:
 *
 * §4.2.1 The longest run of consecutive zero groups is compressed, and "::" must
 *        be used to its maximum capability — so a longer run always beats a
 *        shorter one regardless of position.
 * §4.2.2 A single zero group is never compressed. `2001:db8:0:1:1:1:1:1` is
 *        correct and `2001:db8::1:1:1:1:1` is not, which is why the run search
 *        requires at least two groups before it may write "::".
 * §4.2.3 Ties go to the leftmost run. Scanning left to right and replacing only
 *        on a *strictly* longer run gives that for free.
 *
 * A regular expression cannot express "the longest of these alternations", so a
 * naive `replace(/:0(:0)+/, '::')` picks the first run — see the check script,
 * which runs two such naive implementations against the RFC's own examples and
 * shows them producing the wrong answer.
 */
export function compressGroups(groups: readonly number[]): string {
  if (groups.length !== 8) {
    throw new UlaError(`IPv6 地址必须由 8 组 16 位字段组成，收到 ${groups.length} 组`);
  }

  let bestStart = -1;
  let bestLength = 0;
  let index = 0;
  while (index < 8) {
    if (groups[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < 8 && groups[end] === 0) end += 1;
    const runLength = end - index;
    if (runLength > bestLength) {
      bestLength = runLength;
      bestStart = index;
    }
    index = end;
  }

  if (bestLength < 2) {
    return groups.map((group) => group.toString(16)).join(':');
  }

  const head = groups
    .slice(0, bestStart)
    .map((group) => group.toString(16))
    .join(':');
  const tail = groups
    .slice(bestStart + bestLength)
    .map((group) => group.toString(16))
    .join(':');
  return `${head}::${tail}`;
}

/** RFC 5952 compressed text for a 16-byte address. */
export function compressIpv6(bytes: Uint8Array): string {
  return compressGroups(groupsOf(bytes));
}

/**
 * RFC 4291 §2.2 parsing: eight groups of one to four hex digits, with `::`
 * standing in for one or more all-zero groups.
 *
 * Returns null instead of throwing because "is this an address?" is a question
 * asked far more often than "why is it not one?". Embedded IPv4 forms
 * (`::ffff:192.0.2.1`) are deliberately not accepted: this tool only handles the
 * ULA range, and a half-supported extra grammar is worse than none.
 */
export function parseIpv6(text: string): Uint8Array | null {
  const value = text.trim().toLowerCase();
  if (value.length === 0) return null;
  if (value.includes(':::')) return null;
  if ((value.match(/::/g) ?? []).length > 1) return null;

  const hasElision = value.includes('::');
  const [leftText, rightText] = hasElision ? value.split('::') : [value, ''];

  const parseSide = (side: string): number[] | null => {
    if (side.length === 0) return [];
    const groups: number[] = [];
    for (const part of side.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };

  const left = parseSide(leftText);
  const right = parseSide(rightText);
  if (left === null || right === null) return null;

  let groups: number[];
  if (hasElision) {
    // "::" must stand for at least one group, so the explicit groups must leave
    // room: 8 - left - right >= 1.
    if (left.length + right.length > 7) return null;
    groups = [...left, ...new Array(8 - left.length - right.length).fill(0), ...right];
  } else {
    if (left.length !== 8) return null;
    groups = left;
  }

  return bytesOf(groups);
}

/**
 * A prefix in the conventional `address/prefixLength` form.
 *
 * The address part is masked down to the prefix (bits after it cleared) and then
 * passed through the same RFC 5952 compressor as a full address, so
 * `fd10:3456:789a::/48` — not `fd10:3456:789a:0:0:0:0:0/48` and not
 * `fd10:3456:0789a::/48`. RFC 5952 §7 says prefix representation should follow
 * the address rules, and the `/48` disambiguates the `::` that closes it.
 */
export function formatPrefix(bytes: Uint8Array, prefixLength: number): string {
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 128) {
    throw new UlaError(`前缀长度必须是 0 到 128 之间的整数，收到 "${prefixLength}"`);
  }
  const masked = Uint8Array.from(bytes);
  for (let bit = prefixLength; bit < 128; bit += 1) {
    masked[bit >> 3] = masked[bit >> 3] & ~(1 << (7 - (bit & 7))) & 0xff;
  }
  return `${compressIpv6(masked)}/${prefixLength}`;
}

// ---------------------------------------------------------------------------
// Uniqueness analysis (RFC 4193 §3.2.3)
// ---------------------------------------------------------------------------

/**
 * The RFC's collision estimate: `P = 1 - exp(-N^2 / 2^(L+1))`.
 *
 * The formula is the birthday bound restated; the check script compares its
 * output against the table RFC 4193 §3.2.3 publishes for L = 40, which is the
 * only independent confirmation available for it.
 */
export function collisionProbability(connections: number, globalIdBits: number): number {
  if (!Number.isInteger(connections) || connections < 1) {
    throw new UlaError(`互联的全局 ID 数量必须是正整数，收到 "${connections}"`);
  }
  if (!Number.isInteger(globalIdBits) || globalIdBits < 1 || globalIdBits > 64) {
    throw new UlaError(`全局 ID 位宽必须是 1 到 64 之间的整数，收到 "${globalIdBits}"`);
  }
  return 1 - Math.exp(-(connections ** 2) / 2 ** (globalIdBits + 1));
}

/**
 * Formats a probability the way RFC 4193 §3.2.3 does: three significant digits,
 * truncated rather than rounded.
 *
 * Truncation is not an aesthetic choice — it is what the published table
 * contains. 4 / 2^41 is 1.8189e-12, and the RFC prints 1.81e-12; a rounding
 * formatter would print 1.82e-12 and disagree with the standard.
 */
export function formatProbability(probability: number): string {
  if (probability <= 0) return '0';
  const exponent = Math.floor(Math.log10(probability));
  const scaled = probability / 10 ** exponent;
  const truncated = Math.trunc(scaled * 100) / 100;
  return `${truncated.toFixed(2)}e${exponent >= 0 ? '+' : '-'}${String(Math.abs(exponent)).padStart(2, '0')}`;
}

/** The probability for a number of interconnected ULA prefixes, as text. */
export function formatCollisionProbability(connections: number, globalIdBits: number): string {
  return formatProbability(collisionProbability(connections, globalIdBits));
}

/** Everything the UI needs to describe one generated prefix. */
export interface UlaPlan {
  globalId: Uint8Array;
  globalIdRaw: Uint8Array;
  uBitCleared: boolean;
  derived: boolean;
  ntp: NtpTimestamp | null;
  subnetId: number;
  interfaceId: Uint8Array | null;
  /** The /48 covering the whole site prefix, subnet 0. */
  sitePrefix: string;
  /** The /64 for the selected subnet. */
  subnetPrefix: string;
  /** The full /128, present only when an interface ID was supplied. */
  address: string | null;
  addressFull: string | null;
  addressPadded: string | null;
  /** `fd00::/8` sanity check: the address really is in the ULA range. */
  inUlaRange: boolean;
}

/** Builds every derived string for one Global ID plus subnet/interface choice. */
export function planUla(
  generated: GlobalIdResult,
  subnetId: number,
  interfaceId: Uint8Array | null,
): UlaPlan {
  const base = buildUlaAddress(generated.bytes, 0, new Uint8Array(INTERFACE_ID_BYTES));
  const subnetAddress = buildUlaAddress(
    generated.bytes,
    subnetId,
    new Uint8Array(INTERFACE_ID_BYTES),
  );
  const fullAddress =
    interfaceId === null ? null : buildUlaAddress(generated.bytes, subnetId, interfaceId);

  return {
    globalId: generated.bytes,
    globalIdRaw: generated.raw,
    uBitCleared: generated.uBitCleared,
    derived: generated.derived,
    ntp: generated.ntp,
    subnetId,
    interfaceId,
    sitePrefix: formatPrefix(base, 48),
    subnetPrefix: formatPrefix(subnetAddress, 64),
    address: fullAddress ? compressIpv6(fullAddress) : null,
    addressFull: fullAddress ? formatIpv6Full(fullAddress) : null,
    addressPadded: fullAddress ? formatIpv6Padded(fullAddress) : null,
    inUlaRange: ((fullAddress ?? base)[0] & 0xfe) === 0xfc,
  };
}

/**
 * A random interface ID.
 *
 * The u bit of the interface identifier is cleared for the same reason as in the
 * Global ID: a random identifier is locally administered, so claiming otherwise
 * would be a lie. RFC 4941 (privacy addresses) takes the same line.
 */
export function randomInterfaceId(randomBytes: Uint8Array): Uint8Array {
  assertByteLength(randomBytes, INTERFACE_ID_BYTES, '接口 ID 随机字节');
  const id = Uint8Array.from(randomBytes);
  id[0] = id[0] & ~U_BIT_MASK & 0xff;
  return id;
}
