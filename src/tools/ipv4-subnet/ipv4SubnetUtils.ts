/**
 * IPv4 subnet arithmetic.
 *
 * Pure logic: no React, no DOM, no clock. Everything works on the address as a
 * plain `number` in the unsigned 32-bit range (0 .. 4294967295), because the
 * interesting part of this tool is that the arithmetic is *exact* and easy to
 * check against an independent implementation.
 *
 * Why numbers rather than BigInt: 2^32 is far below Number.MAX_SAFE_INTEGER
 * (2^53 - 1), so every value here — addresses, masks, wildcards, and even the
 * 2^32 address count of a /0 — is represented exactly. BigInt would buy nothing
 * and would make the UI code noisier.
 *
 * JavaScript's bitwise operators convert their operands to **signed 32-bit**
 * integers, so `1 << 31` is -2147483648 and `~0` is -1. This module therefore
 * only ever uses `>>>` (unsigned right shift) and normalises the result with
 * `>>> 0`, which is why the type is documented as "unsigned" everywhere.
 */

/**
 * Addresses are stored as unsigned integers, but the type is still `number`:
 * TypeScript cannot express a numeric range. The invariant is enforced at every
 * entry point (see `parseIpv4` / `parseCidr`).
 */
export type Uint32 = number;

export class IpParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpParseError';
  }
}

/** Semantic classification of the address, most specific match first. */
export type IpBlockKind =
  | 'unspecified'
  | 'thisNetwork'
  | 'private'
  | 'shared'
  | 'loopback'
  | 'linkLocal'
  | 'documentation'
  | 'benchmark'
  | 'multicast'
  | 'reserved'
  | 'broadcast'
  | 'public';

export interface IpBlock {
  kind: IpBlockKind;
  /** Simplified-Chinese label for the UI. */
  label: string;
  /** The defining CIDR, shown so the judgement is auditable. */
  cidr: string;
  /** True only for the RFC 1918 ranges, which is what "私有地址" normally means. */
  isPrivate: boolean;
}

/**
 * Prefix masks, one per prefix length.
 *
 * Built with `>>> 0` rather than `0xffffffff << (32 - prefix)`: at prefix 0 the
 * signed form becomes -1, and at prefix 32 the shift count 32 is reduced modulo
 * 32 by JavaScript, so `<< 32` is a no-op instead of "all ones". Both traps
 * disappear when the value is assembled in the unsigned domain.
 */
const MASKS: Uint32[] = Array.from({ length: 33 }, (_unused, prefix) =>
  prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0,
);

/** The subnet mask for a prefix length, as an unsigned 32-bit integer. */
export function maskForPrefix(prefix: number): Uint32 {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new IpParseError(`前缀长度必须是 0 到 32 之间的整数，收到 "${prefix}"`);
  }
  return MASKS[prefix];
}

/**
 * Recovers the prefix length from a netmask.
 *
 * The value must be contiguous ("all ones then all zeros"). Inverting a
 * contiguous mask yields 2^n - 1, and one more than such a value is a power of
 * two, so the test is `inverted & (inverted - 1) === 0`. A non-contiguous mask
 * such as 255.0.255.0 inverts to 0x00ff00ff, which fails that test and is
 * rejected instead of silently producing a nonsense network.
 *
 * The all-zero mask needs its own branch: its inverse is 2^32, and JavaScript
 * bitwise operators truncate to 32 bits, so `2^32 & (2^32 - 1)` evaluates as
 * `0 & -1` = 0 and would pass the power-of-two test before being rejected by the
 * range check anyway. Spelling it out keeps the one legitimate 2^32 case
 * (prefix 0) correct and the range check meaningful.
 */
export function prefixForMask(mask: Uint32): number | null {
  if (mask === 0) return 0;
  const inverted = (~mask >>> 0) + 1;
  if (inverted > 0xffffffff || (inverted & (inverted - 1)) !== 0) return null;
  return 32 - Math.log2(inverted);
}

/** The wildcard (inverse) mask: every host bit set, network bits clear. */
export function wildcardForPrefix(prefix: number): Uint32 {
  return ~maskForPrefix(prefix) >>> 0;
}

/** The dotted-quad form of an address or mask. */
export function formatIp(value: Uint32): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join('.');
}

/** 8 hex digits, zero padded — the form network engineers write (C0A8010A). */
export function formatHex(value: Uint32): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

/**
 * The canonical dotted-decimal form of an integer.
 *
 * Deliberately just the decimal representation: no dotted-quad conversion, no
 * octal, no hex. It exists so `parseIpv4(formatDecimal(n)) === n` holds for every
 * 32-bit value, which the check script asserts exhaustively.
 */
export function formatDecimal(value: Uint32): string {
  return String(value >>> 0);
}

/** Four space-separated octets of 8 bits, e.g. "11000000 10101000 00000001". */
export function formatBinary(value: Uint32): string {
  const bits = (value >>> 0).toString(2).padStart(32, '0');
  return `${bits.slice(0, 8)} ${bits.slice(8, 16)} ${bits.slice(16, 24)} ${bits.slice(24, 32)}`;
}

/**
 * Parses a bare IPv4 address.
 *
 * Accepted forms (this is the "more than one notation" part of the tool):
 *   - dotted decimal  `192.168.1.10`, `0.0.0.0`, `255.255.255.255`
 *   - 32-bit decimal  `3232235786`
 *   - hex             `0xC0A8010A` (the `0x` is required — without it, `C0A8010A`
 *                     and the decimal 3232235786 would be indistinguishable)
 *   - binary          `0b11000000101010000000000100001010`
 *
 * Returns `null` for anything invalid rather than throwing, because callers ask
 * "is this an address?" far more often than "why is this not an address?".
 *
 * Leading zeros are accepted as decimal (`010` is 10, not octal 8). Browsers and
 * `inet_aton` disagree about legacy octal, and treating them as octal would make
 * `192.168.001.010` mean an address nobody typed.
 */
export function parseIpv4(text: string): Uint32 | null {
  const value = text.trim();
  if (value.length === 0) return null;

  if (/^0[xX][0-9a-fA-F]+$/.test(value)) {
    const parsed = Number.parseInt(value.slice(2), 16);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff
      ? parsed >>> 0
      : null;
  }

  if (/^0[bB][01]+$/.test(value)) {
    const parsed = Number.parseInt(value.slice(2), 2);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff
      ? parsed >>> 0
      : null;
  }

  if (/^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff
      ? parsed >>> 0
      : null;
  }

  const parts = value.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    // At most three digits: "0001" is not an octet, and rejecting it here keeps
    // the error message specific instead of turning it into a range failure.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number.parseInt(part, 10);
    if (octet > 255) return null;
    result = ((result << 8) | octet) >>> 0;
  }
  return result >>> 0;
}

/** True when `text` already carries a prefix suffix (`10.0.0.1/8`). */
export function hasCidrSuffix(text: string): boolean {
  return text.includes('/');
}

export function parsePrefixText(text: string): number {
  const value = text.trim();
  if (value.length === 0) {
    throw new IpParseError('前缀长度不能为空');
  }
  if (!/^\d{1,9}$/.test(value)) {
    throw new IpParseError(`前缀长度必须是整数，收到 "${value}"`);
  }
  const prefix = Number.parseInt(value, 10);
  if (prefix > 32) {
    throw new IpParseError(`前缀长度不能超过 32，收到 "/${prefix}"`);
  }
  return prefix;
}

export interface ParsedCidr {
  /** The address as typed, i.e. the host address unless the input was a network. */
  address: Uint32;
  prefix: number;
  /** True when the input spelled the prefix out (`/24` or a netmask). */
  hadPrefix: boolean;
}

/**
 * Parses `address/prefix`.
 *
 * The suffix may be a prefix length (`/24`), a dotted netmask (`/255.255.255.0`)
 * or `0x`/`0b` forms, because those are the three ways people paste a mask. A
 * missing suffix means /32, matching the "a bare address is a single host" rule
 * that the rest of this module applies.
 */
export function parseCidr(text: string): ParsedCidr {
  const value = text.trim();
  if (value.length === 0) {
    throw new IpParseError('请输入 IPv4 地址或 CIDR，例如 192.168.1.10/24');
  }

  const slash = value.indexOf('/');
  if (slash === -1) {
    const address = parseIpv4(value);
    if (address === null) {
      throw new IpParseError(`无法识别的 IPv4 地址："${value}"`);
    }
    return { address, prefix: 32, hadPrefix: false };
  }

  const addressText = value.slice(0, slash).trim();
  const suffix = value.slice(slash + 1).trim();
  if (addressText.length === 0) {
    throw new IpParseError('"/" 之前缺少 IPv4 地址');
  }
  if (suffix.length === 0) {
    throw new IpParseError('"/" 之后缺少前缀长度或子网掩码');
  }

  const address = parseIpv4(addressText);
  if (address === null) {
    throw new IpParseError(`无法识别的 IPv4 地址："${addressText}"`);
  }

  if (/^\d{1,9}$/.test(suffix)) {
    return { address, prefix: parsePrefixText(suffix), hadPrefix: true };
  }

  // Anything else must be a netmask in one of the supported notations. A
  // non-contiguous mask is rejected on purpose: there is no prefix length that
  // describes it, and half the fields in this tool would become meaningless.
  const maskText = suffix.startsWith('/') ? suffix.slice(1) : suffix;
  const mask = parseIpv4(maskText);
  if (mask === null) {
    throw new IpParseError(`无法识别的前缀或子网掩码："${suffix}"`);
  }
  const prefix = prefixForMask(mask);
  if (prefix === null) {
    throw new IpParseError(`子网掩码 "${formatIp(mask)}" 的 1 不连续，无法换算为前缀长度`);
  }
  return { address, prefix, hadPrefix: true };
}

/** The leading-zero case that trips most calculators, kept for a UI warning. */
export function hasLegacyLeadingZeros(text: string): boolean {
  return /(^|\.)0\d/.test(text.trim());
}

/** The address class, from the leading bits (RFC 791 §3.2 plus later splits). */
export type IpClass = 'A' | 'B' | 'C' | 'D' | 'E';

export function ipClass(value: Uint32): IpClass {
  const first = (value >>> 24) & 0xff;
  if (first < 128) return 'A';
  if (first < 192) return 'B';
  if (first < 224) return 'C';
  if (first < 240) return 'D';
  return 'E';
}

export interface ClassInfo {
  name: IpClass;
  /** How the class maps onto prefix lengths, including the modern splits. */
  note: string;
}

export function describeClass(value: Uint32): ClassInfo {
  const name = ipClass(value);
  const notes: Record<IpClass, string> = {
    A: '首位为 0，默认 /8（其中 0/8、10/8、127/8 有特殊用途）',
    B: '前两位为 10，默认 /16（其中 169.254/16 为链路本地，172.16/12 为私有）',
    C: '前三位为 110，默认 /24（其中 192.0.2/24 为文档地址）',
    D: '前四位为 1110，组播地址，不划分主机',
    E: '前四位为 1111，保留，255.255.255.255 为受限广播',
  };
  return { name, note: notes[name] };
}

/**
 * Block bases, resolved once through the parser so the literals below cannot
 * disagree with it. (`0.0.0.0` parses to 0, which is falsy, so the lookup is
 * keyed by string and never used as a bare number.)
 */
const BLOCK_BASE: Record<string, Uint32> = {
  '0.0.0.0': 0x00000000,
  '10.0.0.0': 0x0a000000,
  '100.64.0.0': 0x64400000,
  '127.0.0.0': 0x7f000000,
  '169.254.0.0': 0xa9fe0000,
  '172.16.0.0': 0xac100000,
  '192.0.2.0': 0xc0000200,
  '192.168.0.0': 0xc0a80000,
  '198.18.0.0': 0xc6120000,
  '198.51.100.0': 0xc6336400,
  '203.0.113.0': 0xcb007100,
  '224.0.0.0': 0xe0000000,
  '240.0.0.0': 0xf0000000,
};

/** True when `value` falls in `base/prefix`. The base is a key of BLOCK_BASE. */
function inBlock(value: Uint32, base: keyof typeof BLOCK_BASE, prefix: number): boolean {
  const mask = maskForPrefix(prefix);
  return (value & mask) >>> 0 === (BLOCK_BASE[base] & mask) >>> 0;
}

/**
 * Classifies an address.
 *
 * Order matters: the most specific block wins, so 192.0.2.5 is "documentation"
 * rather than the class-C it also is, and 169.254.1.1 is link-local rather than
 * plain "not private".
 */
export function classify(value: Uint32): IpBlock {
  if (value === 0) {
    return {
      kind: 'unspecified',
      label: '未指定地址',
      cidr: '0.0.0.0/32',
      isPrivate: false,
    };
  }
  if (value === 0xffffffff) {
    return {
      kind: 'broadcast',
      label: '受限广播地址',
      cidr: '255.255.255.255/32',
      isPrivate: false,
    };
  }
  // RFC 1918, most specific first so 172.16/12 is not swallowed by anything
  // broader. `isPrivate` is set only here.
  if (inBlock(value, '10.0.0.0', 8)) {
    return { kind: 'private', label: '私有地址（RFC 1918）', cidr: '10.0.0.0/8', isPrivate: true };
  }
  if (inBlock(value, '172.16.0.0', 12)) {
    return { kind: 'private', label: '私有地址（RFC 1918）', cidr: '172.16.0.0/12', isPrivate: true };
  }
  if (inBlock(value, '192.168.0.0', 16)) {
    return { kind: 'private', label: '私有地址（RFC 1918）', cidr: '192.168.0.0/16', isPrivate: true };
  }
  // Checked before the loopback test only because it is narrower.
  if (inBlock(value, '100.64.0.0', 10)) {
    return { kind: 'shared', label: '运营商级 NAT 共享地址', cidr: '100.64.0.0/10', isPrivate: false };
  }
  if (inBlock(value, '127.0.0.0', 8)) {
    return { kind: 'loopback', label: '回环地址', cidr: '127.0.0.0/8', isPrivate: false };
  }
  if (inBlock(value, '169.254.0.0', 16)) {
    return { kind: 'linkLocal', label: '链路本地地址（APIPA）', cidr: '169.254.0.0/16', isPrivate: false };
  }
  if (inBlock(value, '192.0.2.0', 24) || inBlock(value, '198.51.100.0', 24) || inBlock(value, '203.0.113.0', 24)) {
    return { kind: 'documentation', label: '文档示例地址（TEST-NET）', cidr: '192.0.2.0/24 等', isPrivate: false };
  }
  if (inBlock(value, '198.18.0.0', 15)) {
    return { kind: 'benchmark', label: '基准测试地址', cidr: '198.18.0.0/15', isPrivate: false };
  }
  if (inBlock(value, '224.0.0.0', 4)) {
    return { kind: 'multicast', label: '组播地址（D 类）', cidr: '224.0.0.0/4', isPrivate: false };
  }
  if (inBlock(value, '240.0.0.0', 4)) {
    return { kind: 'reserved', label: '保留地址（E 类）', cidr: '240.0.0.0/4', isPrivate: false };
  }
  if (inBlock(value, '0.0.0.0', 8)) {
    return { kind: 'thisNetwork', label: '"本网络"保留地址', cidr: '0.0.0.0/8', isPrivate: false };
  }
  return { kind: 'public', label: '公网可路由地址', cidr: '其余地址空间', isPrivate: false };
}

/**
 * How the usable-host rule applies to this prefix.
 *
 * This field exists because the textbook formula `2^(32 - prefix) - 2` is wrong
 * at both ends of the range — see `analyseCidr`.
 */
export type SubnetKind = 'standard' | 'pointToPoint' | 'singleHost';

export interface SubnetInfo {
  /** Raw input address, normalised to unsigned. */
  address: Uint32;
  prefix: number;
  /** True when the caller supplied the prefix (or a mask) rather than defaulting. */
  prefixWasExplicit: boolean;
  mask: Uint32;
  wildcard: Uint32;
  /** `address & mask`. For /31 and /32 this is a real host address, not a reserved one. */
  network: Uint32;
  /** `network | wildcard`. */
  broadcast: Uint32;
  /** The lowest address that can be assigned to an interface, or null. */
  firstHost: Uint32 | null;
  /** The highest address that can be assigned to an interface, or null. */
  lastHost: Uint32 | null;
  /** 2^(32 - prefix). */
  totalAddresses: number;
  /** Addresses assignable to interfaces, after the RFC 3021 special cases. */
  usableHosts: number;
  /** What the textbook formula would have produced, for the UI's explanation. */
  textbookUsableHosts: number;
  /** True when the two differ, i.e. the formula is inapplicable here. */
  textbookFormulaFails: boolean;
  kind: SubnetKind;
  classInfo: ClassInfo;
  block: IpBlock;
  /** Set when the input used legacy leading zeros, which many tools read as octal. */
  leadingZeroWarning: boolean;
}

/**
 * Computes every derived property of one CIDR block.
 *
 * The usable-host rule, spelled out because it is the part that is usually
 * wrong:
 *
 *   prefix <= 30 : 2^(32 - prefix) - 2. The two excluded addresses are the
 *                  all-zeros network address and the all-ones broadcast
 *                  address, which RFC 950 reserved for those roles.
 *   prefix == 31 : 2. RFC 3021 allows both addresses of a /31 to be used as
 *                  hosts, which is exactly what a point-to-point link needs;
 *                  there is no broadcast and no network address on such a link.
 *   prefix == 32 : 1. A single-address host route: the one address is usable,
 *                  and it doubles as the destination.
 *
 * So `2^(32 - prefix) - 2` returns 0 for a /31 (a perfectly usable link) and -1
 * for a /32 (a perfectly usable host route). `textbookUsableHosts` exposes those
 * values rather than hiding them, and the check script asserts the disagreement.
 */
export function analyseCidr(
  address: Uint32,
  prefix: number,
  options: { prefixWasExplicit?: boolean; leadingZeroWarning?: boolean } = {},
): SubnetInfo {
  const mask = maskForPrefix(prefix);
  const wildcard = ~mask >>> 0;
  const network = (address & mask) >>> 0;
  const broadcast = (network | wildcard) >>> 0;
  const totalAddresses = 2 ** (32 - prefix);
  const textbookUsableHosts = totalAddresses - 2;

  let usableHosts: number;
  let firstHost: Uint32 | null;
  let lastHost: Uint32 | null;
  let kind: SubnetKind;

  if (prefix === 31) {
    // RFC 3021: both addresses are assignable; there is no broadcast address.
    kind = 'pointToPoint';
    usableHosts = 2;
    firstHost = network;
    lastHost = broadcast;
  } else if (prefix === 32) {
    kind = 'singleHost';
    usableHosts = 1;
    firstHost = network;
    lastHost = network;
  } else {
    kind = 'standard';
    usableHosts = textbookUsableHosts;
    firstHost = network + 1;
    lastHost = broadcast - 1;
  }

  return {
    address: address >>> 0,
    prefix,
    prefixWasExplicit: options.prefixWasExplicit ?? true,
    mask,
    wildcard,
    network,
    broadcast,
    firstHost,
    lastHost,
    totalAddresses,
    usableHosts,
    textbookUsableHosts,
    textbookFormulaFails: textbookUsableHosts !== usableHosts,
    kind,
    classInfo: describeClass(address),
    block: classify(address),
    leadingZeroWarning: options.leadingZeroWarning ?? false,
  };
}

/** Convenience wrapper: parse then analyse, with the error surfaced to the UI. */
export function analyseCidrText(text: string): SubnetInfo {
  const parsed = parseCidr(text);
  return analyseCidr(parsed.address, parsed.prefix, {
    prefixWasExplicit: parsed.hadPrefix,
    leadingZeroWarning: hasLegacyLeadingZeros(text),
  });
}

/** True when `address` falls inside the block described by `network/prefix`. */
export function isInSubnet(value: Uint32, network: Uint32, prefix: number): boolean {
  const mask = maskForPrefix(prefix);
  return (value & mask) >>> 0 === (network & mask) >>> 0;
}

export interface SubnetSlice {
  /** 0-based position of this subnet inside the parent block. */
  index: number;
  network: Uint32;
  broadcast: Uint32;
  firstHost: Uint32 | null;
  lastHost: Uint32 | null;
  totalAddresses: number;
  usableHosts: number;
  kind: SubnetKind;
  /** Canonical `network/prefix`. */
  cidr: string;
  /** True when no usable host exists in this slice. */
  isEmpty: boolean;
  /** True when the range is a single address that may be a host address. */
  isHostRoute: boolean;
}

export interface SplitPlan {
  parentPrefix: number;
  newPrefix: number;
  /** 2^(newPrefix - parentPrefix), which fits in a number for any valid pair. */
  subnetCount: number;
  /** Addresses per subnet: 2^(32 - newPrefix). */
  subnetSize: number;
  /** Covers every address of the parent once; adjacent slices never overlap. */
  subnets: SubnetSlice[];
  /** True when `subnets` holds every subnet rather than a prefix of them. */
  complete: boolean;
}

export const MAX_LISTED_SUBNETS = 64;

/**
 * Splits the block `network/parentPrefix` into `2^(newPrefix - parentPrefix)`
 * equal subnets and returns the first `limit` of them.
 *
 * The subnets are generated by *index arithmetic* — subnet `k` starts at
 * `network + k * subnetSize` — rather than by repeatedly adding the size to the
 * previous start. Both are correct, but the indexed form cannot drift or
 * accumulate, and it makes the non-overlap and gap-free properties obvious: the
 * ranges are `[network + k*size, network + (k+1)*size - 1]` for consecutive k.
 */
export function splitSubnet(
  network: Uint32,
  parentPrefix: number,
  newPrefix: number,
  limit: number = MAX_LISTED_SUBNETS,
): SplitPlan {
  maskForPrefix(parentPrefix);
  maskForPrefix(newPrefix);
  if (newPrefix < parentPrefix) {
    throw new IpParseError(
      `新前缀 /${newPrefix} 必须大于等于当前前缀 /${parentPrefix}，否则子网会比原网段更大`,
    );
  }

  const bits = newPrefix - parentPrefix;
  const subnetCount = 2 ** bits;
  const subnetSize = 2 ** (32 - newPrefix);
  const capped = Math.min(limit, subnetCount);
  const subnets: SubnetSlice[] = [];

  for (let index = 0; index < capped; index += 1) {
    const subnetNetwork = (network + index * subnetSize) >>> 0;
    const info = analyseCidr(subnetNetwork, newPrefix);
    subnets.push({
      index,
      network: info.network,
      broadcast: info.broadcast,
      firstHost: info.firstHost,
      lastHost: info.lastHost,
      totalAddresses: info.totalAddresses,
      usableHosts: info.usableHosts,
      kind: info.kind,
      cidr: `${formatIp(info.network)}/${newPrefix}`,
      isEmpty: info.usableHosts === 0,
      isHostRoute: newPrefix === 32,
    });
  }

  return {
    parentPrefix,
    newPrefix,
    subnetCount,
    subnetSize,
    subnets,
    complete: capped === subnetCount,
  };
}

/** Decimal, hex and dotted-quad for one address, in the order the UI shows them. */
export interface AddressForms {
  dotted: string;
  hex: string;
  decimal: string;
  binary: string;
}

export function describeAddress(value: Uint32): AddressForms {
  return {
    dotted: formatIp(value),
    hex: `0x${formatHex(value)}`,
    decimal: formatDecimal(value),
    binary: formatBinary(value),
  };
}

/**
 * Round-trip identity check, used by the check script but exported so the tool
 * itself could surface a mismatch rather than silently disagreeing with itself.
 *
 * The three supported spellings of the same address must all parse back to the
 * same value, and re-formatting must reproduce the canonical text.
 */
export function roundTrips(value: Uint32): boolean {
  const dotted = formatIp(value);
  const hex = `0x${formatHex(value)}`;
  const binary = `0b${(value >>> 0).toString(2).padStart(32, '0')}`;
  const decimal = formatDecimal(value);
  return (
    parseIpv4(dotted) === value &&
    parseIpv4(hex) === value &&
    parseIpv4(binary) === value &&
    parseIpv4(decimal) === value &&
    formatIp(parseIpv4(dotted)!) === dotted &&
    formatHex(parseIpv4(hex)!) === hex.slice(2) &&
    formatDecimal(parseIpv4(decimal)!) === decimal
  );
}
