/**
 * IPv4 textual representation conversion.
 *
 * Scope: the *many ways to write the same IPv4 address*, and nothing else. It is
 * not a subnet calculator (that is the CIDR tool) and not a base converter (that
 * is the number-base tool) — it exists because `127.0.0.1`, `2130706433`,
 * `0x7f000001`, `017700000001` and `127.1` all denote the same address, and the
 * short ones are exactly the ones people misread.
 *
 * ## Why the shorthand forms matter (security)
 *
 * `inet_aton` — and the URL parsers, HTTP clients and SSRF filters that copied
 * its tolerance — accept a *shorter* address whose last part absorbs the missing
 * bytes (`127.1` = `127.0.0.1`), parts written in octal or hex, and a bare
 * 32-bit integer. Every one of those is a documented SSRF and allow-list bypass:
 * a filter that compares the string `127.0.0.1` or resolves only dotted-quad
 * literals lets `http://2130706433/` and `http://0x7f.1/` straight through to
 * the loopback interface, and `010.0.0.1` reaches `8.0.0.1` rather than
 * `10.0.0.1`. This module therefore *parses* them (so the user can see what they
 * really mean) and *labels every one of them as unsafe*, but never suggests using
 * them — in a URL, an ACL or a config file the canonical dotted-quad form is the
 * only form to write. `formatShorthand` exists purely to show what a filter
 * would have to defend against, and the UI presents it as a hazard display.
 *
 * ## Numeric domain
 *
 * Addresses are unsigned 32-bit integers held in a `number`. 2^32 - 1 is far
 * below `Number.MAX_SAFE_INTEGER`, so every value is exact. JavaScript's bitwise
 * operators work on *signed* 32-bit integers, so `1 << 31` is negative and the
 * result of every shift here is normalised with `>>> 0`.
 *
 * ## Precision guard
 *
 * A decimal token longer than 10 digits cannot be represented exactly by
 * `parseInt`, so `99999999999` would silently become a nearby float and then be
 * range-rejected for the wrong reason. Token length is checked *before* parsing,
 * so the rejection says "too long" instead of "out of range".
 */

/** An IPv4 address as an unsigned 32-bit integer (0 .. 4294967295). */
export type Uint32 = number;

const MAX_U32 = 4294967295;

export class Ipv4ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ipv4ParseError';
  }
}

/** The textual shape an input was recognised as. */
export type AddressForm =
  | 'dotted'
  | 'dotted-octal'
  | 'dotted-hex'
  | 'short-3'
  | 'short-2'
  | 'integer'
  | 'hex'
  | 'octal'
  | 'binary';

/** Result of parsing anything this tool accepts. */
export interface ParsedAddress {
  value: Uint32;
  /** Canonical dotted-decimal form, always four decimal octets. */
  dotted: string;
  form: AddressForm;
  /**
   * True for every form except canonical dotted-decimal. Callers must surface
   * this: these are the forms that defeat naive string filters.
   */
  shorthand: boolean;
  /** Simplified-Chinese name of the recognised form. */
  formLabel: string;
  /**
   * Simplified-Chinese risk note, or `null` for canonical dotted-decimal.
   * Non-null means "this is how an SSRF filter gets bypassed".
   */
  warning: string | null;
}

const FORM_LABELS: Record<AddressForm, string> = {
  dotted: '点分十进制（规范形式）',
  'dotted-octal': '点分 + 八进制段（历史写法）',
  'dotted-hex': '点分 + 十六进制段（历史写法）',
  'short-3': '三段简写（最后一段占 16 位）',
  'short-2': '两段简写（最后一段占 24 位）',
  integer: '单个 32 位十进制整数',
  hex: '单个 32 位十六进制整数',
  octal: '单个 32 位八进制整数',
  binary: '32 位二进制',
};

/** One sentence per non-canonical form, phrased as the hazard it is. */
const SHORTHAND_WARNING =
  '这是 inet_aton 接受的历史简写，不是规范写法。它常被用于绕过只比对点分十进制字符串的 ' +
  'SSRF 防护与白名单：同样的目标地址写成这种形式就能骗过过滤器。请只在"解读可疑输入"时使用，' +
  '绝不要写进 URL、ACL 或配置文件。';

const RADIX_WARNING =
  '非十进制的段（前导 0 表示八进制、0x 表示十六进制）同样来自 inet_aton，容易被误读：' +
  '010.0.0.1 是 8.0.0.1 而不是 10.0.0.1。请改用点分十进制。';

function warningFor(form: AddressForm): string | null {
  if (form === 'dotted') return null;
  if (form === 'dotted-octal' || form === 'dotted-hex') return RADIX_WARNING;
  if (form === 'binary') {
    return '32 位二进制不是 inet_aton 的写法，只是本工具提供的可读视图；不要把它当作地址字符串使用。';
  }
  return SHORTHAND_WARNING;
}

function assertU32(value: number, what: string): Uint32 {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U32) {
    throw new Ipv4ParseError(`${what} 超出 IPv4 的 0 ~ 4294967295 范围`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** `2130706433` → `127.0.0.1`. */
export function toDotted(value: Uint32): string {
  const v = assertU32(value, '地址');
  return `${(v >>> 24) & 0xff}.${(v >>> 16) & 0xff}.${(v >>> 8) & 0xff}.${v & 0xff}`;
}

/** `127.0.0.1` → `2130706433`. */
export function toDecimalString(value: Uint32): string {
  return String(assertU32(value, '地址'));
}

/** `127.0.0.1` → `0x7f000001` (always eight digits, lower case). */
export function toHexString(value: Uint32): string {
  return `0x${assertU32(value, '地址').toString(16).padStart(8, '0')}`;
}

/** `127.0.0.1` → `0x7f.0x0.0x0.0x1`. */
export function toHexDotted(value: Uint32): string {
  const v = assertU32(value, '地址');
  // Each octet must go through `toString(16)`. Writing the decimal digits after
  // a `0x` prefix yields strings such as `0x127...` for 127.0.0.1 — 0x127 is 295,
  // above the octet range, so the value does not parse back and the row would be
  // a lie. No zero padding, so the documented `0x7f.0x0.0x0.0x1` shape holds.
  return `0x${((v >>> 24) & 0xff).toString(16)}.0x${((v >>> 16) & 0xff).toString(16)}.0x${(
    (v >>> 8) & 0xff
  ).toString(16)}.0x${(v & 0xff).toString(16)}`;
}

/**
 * `127.0.0.1` → `017700000001`.
 *
 * Eleven octal digits, because 2^32 in octal is `40000000000` — also eleven
 * digits. The leading `0` is not decoration: it is what makes the value octal
 * for `inet_aton`, and it is why `017700000001` parses back to 127.0.0.1.
 */
export function toOctalString(value: Uint32): string {
  return `0${assertU32(value, '地址').toString(8).padStart(11, '0')}`;
}

/** `127.0.0.1` → `0177.0.0.1`. */
export function toOctalDotted(value: Uint32): string {
  const v = assertU32(value, '地址');
  return `0${((v >>> 24) & 0xff).toString(8)}.0${((v >>> 16) & 0xff).toString(8)}.0${(
    (v >>> 8) & 0xff
  ).toString(8)}.0${(v & 0xff).toString(8)}`;
}

/** `127.0.0.1` → `01111111000000000000000000000001`. */
export function toBinaryString(value: Uint32): string {
  return assertU32(value, '地址').toString(2).padStart(32, '0');
}

/** `127.0.0.1` → `01111111.00000000.00000000.00000001`. */
export function toBinaryGrouped(value: Uint32): string {
  const bits = toBinaryString(value);
  return `${bits.slice(0, 8)}.${bits.slice(8, 16)}.${bits.slice(16, 24)}.${bits.slice(24, 32)}`;
}

/**
 * The shortest `inet_aton` spelling, for hazard display only.
 *
 * `127.0.0.1` → `127.1`, because the trailing three bytes collapse into one
 * 24-bit number. A value whose first byte is zero cannot be shortened this way
 * (the leading part would be an empty string), so it falls back to the dotted
 * form. The UI shows this next to an explicit warning; nothing in this module
 * ever offers it as a value to copy into a request.
 */
export function formatShorthand(value: Uint32): string {
  const v = assertU32(value, '地址');
  const top = (v >>> 24) & 0xff;
  if (v <= 0xff) return String(v);
  if (top === 0) return toDotted(v);
  return `${top}.${v & 0xffffff}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface NumberToken {
  value: number;
  radix: 10 | 8 | 16;
}

/**
 * Parses one dotted part the way `inet_aton` does: `0x`-prefixed is hex, a
 * leading zero is octal, anything else is decimal.
 *
 * Length is bounded before `parseInt` for the reason in the file header, and
 * `08`/`09` are rejected rather than treated as decimal — `strtoul` with base 0
 * stops at the invalid digit, so glibc rejects them too.
 */
export function parseDottedPart(token: string): NumberToken {
  if (token === '') throw new Ipv4ParseError('地址中出现空的分段');

  if (/^0[xX]/.test(token)) {
    const digits = token.slice(2);
    if (digits === '' || !/^[0-9a-fA-F]+$/.test(digits)) {
      throw new Ipv4ParseError(`"${token}" 不是合法的十六进制段`);
    }
    if (digits.length > 8) throw new Ipv4ParseError(`十六进制段 "${token}" 位数过多`);
    return { value: parseInt(digits, 16), radix: 16 };
  }

  if (!/^[0-9]+$/.test(token)) {
    throw new Ipv4ParseError(`"${token}" 不是合法的地址分段（只能是十进制、0x 十六进制或前导 0 八进制）`);
  }

  if (token.length > 1 && token.startsWith('0')) {
    if (!/^0[0-7]+$/.test(token)) {
      throw new Ipv4ParseError(`"${token}" 看起来是八进制，但含有 8 或 9，inet_aton 会拒绝它`);
    }
    // 2^32 in octal is eleven digits; anything longer cannot be exact.
    if (token.length > 12) throw new Ipv4ParseError(`八进制段 "${token}" 位数过多`);
    return { value: parseInt(token.slice(1), 8), radix: 8 };
  }

  if (token.length > 10) throw new Ipv4ParseError(`十进制段 "${token}" 位数过多`);

  return { value: parseInt(token, 10), radix: 10 };
}

/** True when the whole string is a 32-bit binary literal, dots optional. */
function looksBinary(text: string): boolean {
  if (/^[01]{32}$/.test(text)) return true;
  if (/^[01]{8}(?:\.[01]{8}){3}$/.test(text)) return true;
  return false;
}

/**
 * Parses every IPv4 spelling this tool understands.
 *
 * Recognised, in the order they are tested:
 *
 *   1. 32-bit binary, plain or grouped by byte (this tool's own view — not an
 *      `inet_aton` form, and flagged as such so nobody pastes it into a URL).
 *   2. A single number: decimal, `0x` hex, or leading-zero octal.
 *   3. Two, three or four dot-separated parts, where the final part absorbs the
 *      missing bytes — the classic short form.
 *
 * A `/prefix` suffix is rejected with a pointer at the subnet tool rather than
 * silently ignored: quietly dropping the mask would misrepresent the input.
 */
export function parseAddress(input: string): ParsedAddress {
  const text = input.trim();
  if (text === '') throw new Ipv4ParseError('输入为空');

  if (text.includes('/')) {
    throw new Ipv4ParseError('不要带 /前缀 —— 这里只做表示形式转换，子网计算请用 IPv4 子网计算器');
  }

  if (looksBinary(text)) {
    const bits = text.replace(/\./g, '');
    // parseInt on 32 bits: 2^32 - 1 fits exactly, so no precision loss.
    return finish(parseInt(bits, 2), 'binary', toDotted(parseInt(bits, 2)));
  }

  const parts = text.split('.');
  if (parts.some((part) => part === '')) {
    throw new Ipv4ParseError('地址中出现了空的点分段');
  }
  if (parts.length > 4) {
    throw new Ipv4ParseError(`IPv4 最多四段，收到 ${parts.length} 段`);
  }

  const tokens = parts.map(parseDottedPart);

  // A four-part form is the canonical one, but only the *decimal* variant is
  // canonical: `0x7f.0.0.1` and `0177.0.0.1` are still inet_aton-isms.
  if (tokens.length === 4) {
    for (const [index, token] of tokens.entries()) {
      if (token.value > 255) throw new Ipv4ParseError(`第 ${index + 1} 段 ${token.value} 超过 255`);
    }
    const radixes = new Set(tokens.map((token) => token.radix));
    const form: AddressForm =
      radixes.size === 1 && radixes.has(10)
        ? 'dotted'
        : radixes.has(16)
          ? 'dotted-hex'
          : 'dotted-octal';
    const value =
      (((tokens[0].value << 24) | (tokens[1].value << 16) | (tokens[2].value << 8) | tokens[3].value) >>>
        0) as Uint32;
    return finish(value, form, toDotted(value));
  }

  if (tokens.length === 1) {
    const [only] = tokens;
    const form: AddressForm = only.radix === 16 ? 'hex' : only.radix === 8 ? 'octal' : 'integer';
    const value = assertU32(only.value, '地址');
    return finish(value, form, toDotted(value));
  }

  if (tokens.length === 2) {
    if (tokens[0].value > 255) throw new Ipv4ParseError('两段简写中，第一段必须在 0 ~ 255 之间');
    if (tokens[1].value > 0xffffff) throw new Ipv4ParseError('两段简写中，第二段必须在 0 ~ 16777215 之间');
    const value = (((tokens[0].value << 24) | tokens[1].value) >>> 0) as Uint32;
    return finish(value, 'short-2', toDotted(value));
  }

  if (tokens[0].value > 255) throw new Ipv4ParseError('三段简写中，第一段必须在 0 ~ 255 之间');
  if (tokens[1].value > 255) throw new Ipv4ParseError('三段简写中，第二段必须在 0 ~ 255 之间');
  if (tokens[2].value > 0xffff) throw new Ipv4ParseError('三段简写中，第三段必须在 0 ~ 65535 之间');
  const value = (((tokens[0].value << 24) | (tokens[1].value << 16) | tokens[2].value) >>> 0) as Uint32;
  return finish(value, 'short-3', toDotted(value));
}

function finish(value: Uint32, form: AddressForm, dotted: string): ParsedAddress {
  return {
    value,
    dotted,
    form,
    shorthand: form !== 'dotted',
    formLabel: FORM_LABELS[form],
    warning: warningFor(form),
  };
}

/**
 * Strict canonical parse: four decimal octets, no leading zeros.
 *
 * Used when the question is "is this exactly the safe form?", which is what
 * config validation and allow-list checks need. `parseAddress` is the tolerant
 * one, and keeping them separate is the point: tolerant parsing is for reading
 * hostile input, strict parsing is for deciding whether to accept it.
 */
export function parseCanonicalDotted(input: string): Uint32 {
  const text = input.trim();
  const parts = text.split('.');
  if (parts.length !== 4) throw new Ipv4ParseError('规范点分十进制必须正好四段');
  let value = 0;
  for (const [index, part] of parts.entries()) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part)) {
      throw new Ipv4ParseError(`第 ${index + 1} 段 "${part}" 不是规范十进制八位组（不允许前导 0）`);
    }
    const octet = parseInt(part, 10);
    if (octet > 255) throw new Ipv4ParseError(`第 ${index + 1} 段 ${octet} 超过 255`);
    value = ((value << 8) | octet) >>> 0;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type AddressKind =
  | 'unspecified'
  | 'thisNetwork'
  | 'private'
  | 'shared'
  | 'loopback'
  | 'linkLocal'
  | 'documentation'
  | 'benchmark'
  | 'protocol'
  | 'reserved'
  | 'multicast'
  | 'broadcast'
  | 'public';

export interface AddressClass {
  /** IPv4 class letter, as defined by the original (obsolete) classful scheme. */
  klass: 'A' | 'B' | 'C' | 'D' | 'E';
  kind: AddressKind;
  label: string;
  /** The defining CIDR, shown so the judgement can be audited. */
  cidr: string;
  /** True only for the RFC 1918 blocks, which is what "私有地址" normally means. */
  isPrivate: boolean;
  /** True for anything that must never appear as a public destination. */
  isReserved: boolean;
}

interface BlockRule {
  network: string;
  prefix: number;
  kind: AddressKind;
  label: string;
  isPrivate?: boolean;
  isReserved?: boolean;
}

/**
 * Ordered most-specific-first: the first match wins.
 *
 * An independent transcription of the IANA special-purpose registry rather than
 * an import from the subnet tool, so the two tools cannot share a typo — and the
 * check script re-derives these boundaries from the CIDR strings themselves.
 */
const BLOCKS: BlockRule[] = [
  { network: '0.0.0.0', prefix: 32, kind: 'unspecified', label: '未指定地址（0.0.0.0）', isReserved: true },
  { network: '0.0.0.0', prefix: 8, kind: 'thisNetwork', label: '"本网络"（0.0.0.0/8）', isReserved: true },
  { network: '10.0.0.0', prefix: 8, kind: 'private', label: 'RFC 1918 私有地址（10.0.0.0/8）', isPrivate: true, isReserved: true },
  { network: '100.64.0.0', prefix: 10, kind: 'shared', label: '运营商级 NAT 共享地址（100.64.0.0/10）', isReserved: true },
  { network: '127.0.0.0', prefix: 8, kind: 'loopback', label: '回环地址（127.0.0.0/8）', isReserved: true },
  { network: '169.254.0.0', prefix: 16, kind: 'linkLocal', label: '链路本地（169.254.0.0/16，APIPA）', isReserved: true },
  { network: '172.16.0.0', prefix: 12, kind: 'private', label: 'RFC 1918 私有地址（172.16.0.0/12）', isPrivate: true, isReserved: true },
  { network: '192.0.0.0', prefix: 24, kind: 'protocol', label: 'IETF 协议专用（192.0.0.0/24）', isReserved: true },
  { network: '192.0.2.0', prefix: 24, kind: 'documentation', label: '文档示例（TEST-NET-1，192.0.2.0/24）', isReserved: true },
  { network: '192.88.99.0', prefix: 24, kind: 'protocol', label: '6to4 中继（已废弃，192.88.99.0/24）', isReserved: true },
  { network: '192.168.0.0', prefix: 16, kind: 'private', label: 'RFC 1918 私有地址（192.168.0.0/16）', isPrivate: true, isReserved: true },
  { network: '198.18.0.0', prefix: 15, kind: 'benchmark', label: '基准测试（198.18.0.0/15）', isReserved: true },
  { network: '198.51.100.0', prefix: 24, kind: 'documentation', label: '文档示例（TEST-NET-2，198.51.100.0/24）', isReserved: true },
  { network: '203.0.113.0', prefix: 24, kind: 'documentation', label: '文档示例（TEST-NET-3，203.0.113.0/24）', isReserved: true },
  { network: '224.0.0.0', prefix: 4, kind: 'multicast', label: '组播（224.0.0.0/4）', isReserved: true },
  // The limited broadcast must be tested *before* 240.0.0.0/4, which contains
  // it: with the wider rule first, 255.255.255.255 would be reported as plain
  // "reserved" and the more useful label would be unreachable.
  { network: '255.255.255.255', prefix: 32, kind: 'broadcast', label: '受限广播（255.255.255.255/32）', isReserved: true },
  { network: '240.0.0.0', prefix: 4, kind: 'reserved', label: '保留（240.0.0.0/4）', isReserved: true },
];

/** The classful letter, which still appears in old documentation and textbooks. */
export function addressClass(value: Uint32): 'A' | 'B' | 'C' | 'D' | 'E' {
  const first = (assertU32(value, '地址') >>> 24) & 0xff;
  if (first < 128) return 'A';
  if (first < 192) return 'B';
  if (first < 224) return 'C';
  if (first < 240) return 'D';
  return 'E';
}

/** True when `value` falls inside `network/prefix`. */
export function inBlock(value: Uint32, network: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const base = parseCanonicalDotted(network);
  return ((value & mask) >>> 0) === ((base & mask) >>> 0);
}

export function classifyAddress(value: Uint32): AddressClass {
  const v = assertU32(value, '地址');
  for (const rule of BLOCKS) {
    if (inBlock(v, rule.network, rule.prefix)) {
      return {
        klass: addressClass(v),
        kind: rule.kind,
        label: rule.label,
        cidr: `${rule.network}/${rule.prefix}`,
        isPrivate: rule.isPrivate === true,
        isReserved: rule.isReserved === true,
      };
    }
  }
  return {
    klass: addressClass(v),
    kind: 'public',
    label: '公网可路由地址',
    cidr: '0.0.0.0/0（不在任何特殊用途段内）',
    isPrivate: false,
    isReserved: false,
  };
}

// ---------------------------------------------------------------------------
// The conversion table shown in the UI
// ---------------------------------------------------------------------------

export interface ConversionRow {
  key: string;
  /** Simplified-Chinese label for the form. */
  label: string;
  value: string;
  /** Extra note shown under the value, or null. */
  note: string | null;
  /** True for rows that must not be pasted into a URL or a filter. */
  unsafe: boolean;
}

/** Every representation of one address, in the order the UI shows them. */
export function convertAll(value: Uint32): ConversionRow[] {
  const v = assertU32(value, '地址');
  const shorthand = formatShorthand(v);
  return [
    { key: 'dotted', label: '点分十进制', value: toDotted(v), note: '规范写法，唯一应当出现在配置里的形式', unsafe: false },
    { key: 'decimal', label: '32 位十进制整数', value: toDecimalString(v), note: '用作 URL 主机名可绕过字符串白名单', unsafe: true },
    { key: 'hex', label: '十六进制（0x 前缀）', value: toHexString(v), note: null, unsafe: true },
    { key: 'hexDotted', label: '十六进制分段', value: toHexDotted(v), note: null, unsafe: true },
    { key: 'octal', label: '八进制（前导 0）', value: toOctalString(v), note: '前导 0 是八进制的标志，不是补位', unsafe: true },
    { key: 'octalDotted', label: '八进制分段', value: toOctalDotted(v), note: '010.0.0.1 是 8.0.0.1，不是 10.0.0.1', unsafe: true },
    { key: 'binaryGrouped', label: '二进制（按字节分组）', value: toBinaryGrouped(v), note: null, unsafe: true },
    { key: 'binary', label: '二进制（连续 32 位）', value: toBinaryString(v), note: null, unsafe: true },
    {
      key: 'shorthand',
      label: '最短简写（inet_aton 风格）',
      value: shorthand,
      note: '仅供识别可疑输入：这种写法是 SSRF 与白名单绕过的常见手法',
      unsafe: true,
    },
  ];
}

/** One row of the batch table. */
export interface BatchRow {
  index: number;
  input: string;
  ok: boolean;
  dotted: string;
  decimal: string;
  hex: string;
  formLabel: string;
  shorthand: boolean;
  /** Distinct warnings for this line, empty when the input was canonical. */
  warnings: string[];
}

export const MAX_BATCH_LINES = 500;

/**
 * Converts one address per line.
 *
 * A bad line becomes a failed row rather than aborting the whole paste: with a
 * hundred lines, one typo must not hide the other ninety-nine results.
 */
export function batchConvert(text: string): { rows: BatchRow[]; truncated: boolean } {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    // Comments and blanks are skipped silently; a paste of a config file
    // routinely carries both.
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('//'));

  const truncated = lines.length > MAX_BATCH_LINES;
  const used = truncated ? lines.slice(0, MAX_BATCH_LINES) : lines;

  const rows = used.map((input, index) => {
    try {
      const parsed = parseAddress(input);
      return {
        index: index + 1,
        input,
        ok: true,
        dotted: parsed.dotted,
        decimal: toDecimalString(parsed.value),
        hex: toHexString(parsed.value),
        formLabel: parsed.formLabel,
        shorthand: parsed.shorthand,
        warnings: parsed.warning ? [parsed.warning] : [],
      };
    } catch (error) {
      return {
        index: index + 1,
        input,
        ok: false,
        dotted: '',
        decimal: '',
        hex: '',
        formLabel: '',
        shorthand: false,
        warnings: [error instanceof Error ? error.message : String(error)],
      };
    }
  });

  return { rows, truncated };
}
