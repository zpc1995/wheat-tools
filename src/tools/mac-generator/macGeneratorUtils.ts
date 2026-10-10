/**
 * Random MAC address generation.
 *
 * ## The two bits that matter
 *
 * A MAC address is six bytes; the *first byte's two least significant bits* are
 * flags, not part of the address value (IEEE 802 / RFC 7042 section 2.1):
 *
 *   - **bit 0 (I/G)** — 0 = unicast (individual), 1 = multicast (group).
 *   - **bit 1 (U/L)** — 0 = universally administered (the prefix was bought from
 *     the IEEE registry), 1 = locally administered (the prefix is not registered
 *     to anyone).
 *
 * A randomly generated address that leaves bit 1 clear is claiming a registered
 * prefix it does not own. With a random first byte there is a 50% chance the
 * address lands in the universally-administered half of the space, and a
 * meaningful chance it collides with a real vendor's OUI — for example
 * `00:1B:63:…` is Apple's block and `00:00:0C:…` is Cisco's (RFC 7042 lists the
 * latter as a documentation example). Two devices on one link with the same MAC
 * address break forwarding, ARP/ND caches and DHCP leases. Setting bit 1 costs
 * nothing and removes the whole class of collision, which is why the default
 * here is **unicast + locally administered**: the first byte always ends in
 * `0b10` (`0x02`, `0x06`, `0x0A`, … `0xFE`).
 *
 * Because `random` is a parameter (a `Uint8Array`) rather than an internal call
 * to `Math.random`, generation is reproducible and the checks can drive it with
 * a fixed stream. Bytes are used verbatim — no `% 256`, no scaling — so the
 * distribution is exactly the source's distribution rather than a biased
 * approximation of it.
 *
 * ## Explicitly out of scope
 *
 * No OUI vendor lookup. Resolving a prefix to a company needs the IEEE registry,
 * which is a data problem (and a licensing one), not a bit problem.
 */

export class MacError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MacError';
  }
}

/** Exactly six bytes, each 0..255. */
export type MacBytes = number[];

export const MAC_LENGTH = 6;
export const OUI_LENGTH = 3;
/** The I/G bit: 1 means the frame is addressed to a group. */
export const MULTICAST_BIT = 0x01;
/** The U/L bit: 1 means the prefix is locally assigned, not registry-assigned. */
export const LOCAL_BIT = 0x02;
/** Clears both flag bits of the first byte. */
const FLAG_MASK = 0xfc;

export type MacStyle = 'colon' | 'hyphen' | 'cisco' | 'plain';

export const MAC_STYLE_LABELS: Record<MacStyle, string> = {
  colon: 'AA:BB:CC:DD:EE:FF',
  hyphen: 'AA-BB-CC-DD-EE-FF',
  cisco: 'aabb.ccdd.eeff',
  plain: 'AABBCCDDEEFF',
};

function hex2(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

function assertBytes(bytes: MacBytes): MacBytes {
  if (!Array.isArray(bytes) || bytes.length !== MAC_LENGTH) {
    throw new MacError(`MAC 地址必须是 ${MAC_LENGTH} 个字节，收到 ${Array.isArray(bytes) ? bytes.length : '非数组'}`);
  }
  for (const [index, byte] of bytes.entries()) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new MacError(`第 ${index + 1} 个字节 ${byte} 不是 0 ~ 255 的整数`);
    }
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Formatting and parsing
// ---------------------------------------------------------------------------

/**
 * Renders the bytes in one of the four notations that actually appear in the
 * wild: colon-separated (Unix), hyphen-separated (Windows), dotted quads of four
 * hex digits (Cisco `show mac address-table`) and the bare 12 hex digits used by
 * some switch CLIs.
 *
 * Everything is lower case except the colon and hyphen forms, which are upper —
 * that is what the tools that consume them print.
 */
export function formatMac(bytes: MacBytes, style: MacStyle = 'colon'): string {
  assertBytes(bytes);
  const lower = bytes.map(hex2);
  const upper = bytes.map((byte) => hex2(byte).toUpperCase());

  switch (style) {
    case 'colon':
      return upper.join(':');
    case 'hyphen':
      return upper.join('-');
    case 'cisco':
      return `${lower.slice(0, 2).join('')}.${lower.slice(2, 4).join('')}.${lower.slice(4, 6).join('')}`;
    case 'plain':
      return upper.join('');
  }
}

/** Every notation at once, which is what the UI shows. */
export function formatAllStyles(bytes: MacBytes): Array<{ style: MacStyle; label: string; value: string }> {
  assertBytes(bytes);
  return (Object.keys(MAC_STYLE_LABELS) as MacStyle[]).map((style) => ({
    style,
    label: MAC_STYLE_LABELS[style],
    value: formatMac(bytes, style),
  }));
}

/** Strips `:`, `-`, `.` and whitespace; returns null when the rest is not 12 hex digits. */
export function normaliseMacText(text: string): string | null {
  const cleaned = text.trim().replace(/[\s:.-]/g, '');
  if (!/^[0-9a-fA-F]{12}$/.test(cleaned)) return null;
  return cleaned.toLowerCase();
}

/**
 * Parses any of the four formats back into bytes.
 *
 * The separators are simply removed rather than pattern-matched: `aabb.ccdd.eeff`
 * and `aa:bb:cc:dd:ee:ff` and `AABBCCDDEEFF` all reduce to the same twelve hex
 * digits, and `aabbcc.ddeeff` (a grouping Cisco does *not* use) reduces to them
 * too — accepting it is harmless because the byte boundaries can only be read one
 * way once the length is known to be twelve. What is *not* accepted is a wrong
 * digit count, which is the only thing that can actually be ambiguous.
 */
export function parseMac(text: string): MacBytes {
  const cleaned = normaliseMacText(text);
  if (cleaned === null) {
    throw new MacError(`"${text.trim()}" 不是合法的 MAC 地址（需要 12 位十六进制，可带 : - . 分隔）`);
  }
  const bytes: MacBytes = [];
  for (let index = 0; index < MAC_LENGTH; index += 1) {
    bytes.push(parseInt(cleaned.slice(index * 2, index * 2 + 2), 16));
  }
  return bytes;
}

/** `parseMac` without the exception, for live input fields. */
export function tryParseMac(text: string): MacBytes | null {
  try {
    return parseMac(text);
  } catch {
    return null;
  }
}

/** Parses a 3-byte OUI / prefix. `null` and empty string both mean "no prefix". */
export function parseOui(text: string): MacBytes | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  // Checked directly rather than through `normaliseMacText`, which requires the
  // full twelve digits of an address and therefore can never accept a prefix.
  const six = trimmed.replace(/[\s:.-]/g, '');
  if (!/^[0-9a-fA-F]{6}$/.test(six)) {
    throw new MacError(`"${trimmed}" 不是合法的 OUI 前缀（需要 6 位十六进制，可带 : - . 分隔）`);
  }
  return [
    parseInt(six.slice(0, 2), 16),
    parseInt(six.slice(2, 4), 16),
    parseInt(six.slice(4, 6), 16),
  ];
}

/** Same as `parseOui` but returns null instead of throwing. */
export function tryParseOui(text: string): MacBytes | null | { error: string } {
  try {
    return parseOui(text);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Flag bits
// ---------------------------------------------------------------------------

export interface MacOptions {
  /** Three-byte prefix, or empty for a fully random first three bytes. */
  prefix: string;
  /** I/G bit: true generates a multicast (group) address. */
  multicast: boolean;
  /** U/L bit: true marks the address as locally administered. */
  locallyAdministered: boolean;
}

export const DEFAULT_MAC_OPTIONS: MacOptions = {
  prefix: '',
  multicast: false,
  // Default on, for the collision reason in the file header.
  locallyAdministered: true,
};

/**
 * Forces the two flag bits of the first byte to the requested values.
 *
 * Written as a read-modify-write with an explicit mask (`& 0xfc` then `| flags`)
 * rather than two independent conditionals, because the conditional form is
 * where the classic bug lives: `bytes[0] | 0x02` sets the local bit but can
 * never *clear* it, so "generate a vendor-prefixed address" would silently keep
 * a stray bit from the prefix.
 */
export function applyFlags(
  bytes: MacBytes,
  flags: { multicast: boolean; locallyAdministered: boolean },
): MacBytes {
  assertBytes(bytes);
  const result = bytes.slice();
  result[0] = (result[0] & FLAG_MASK) | (flags.multicast ? MULTICAST_BIT : 0) | (flags.locallyAdministered ? LOCAL_BIT : 0);
  return result;
}

export interface MacFlagReading {
  /** Bit 0 of the first byte, as a number (0 or 1). */
  individualBit: number;
  /** Bit 1 of the first byte, as a number (0 or 1). */
  universalBit: number;
  isMulticast: boolean;
  isLocallyAdministered: boolean;
  individualLabel: string;
  administrationLabel: string;
  /** Simplified-Chinese note about which space the address claims to be in. */
  note: string;
}

/** Decodes the two flag bits and explains them. */
export function readFlags(bytes: MacBytes): MacFlagReading {
  assertBytes(bytes);
  const first = bytes[0];
  const isMulticast = (first & MULTICAST_BIT) !== 0;
  const isLocallyAdministered = (first & LOCAL_BIT) !== 0;

  let note: string;
  if (isLocallyAdministered) {
    note =
      'U/L = 1：这个前缀不属于 IEEE 注册表中的任何厂商，因此即使随机生成也不会与真实硬件冲突。' +
      '随机生成的地址必须置这一位。';
  } else if (isMulticast) {
    note =
      'U/L = 0 且 I/G = 1：这是一个组播地址，其高位前缀通常来自标准保留块（如 01:00:5E 用于 IPv4 组播映射），' +
      '不应作为设备地址使用。';
  } else {
    note =
      'U/L = 0：地址声称自己使用 IEEE 分配给某厂商的 OUI。随机生成的地址落到这一半空间就等于冒用他人前缀，' +
      '可能与真实设备撞车。若确实要模拟某个厂商，请填写该厂商的真实 OUI 并确认来源。';
  }

  return {
    individualBit: first & MULTICAST_BIT,
    universalBit: (first & LOCAL_BIT) >> 1,
    isMulticast,
    isLocallyAdministered,
    individualLabel: isMulticast ? 'I/G = 1 · 组播（group）' : 'I/G = 0 · 单播（individual）',
    administrationLabel: isLocallyAdministered
      ? 'U/L = 1 · 本地管理（locally administered）'
      : 'U/L = 0 · 全球唯一 / 厂商 OUI（universally administered）',
    note,
  };
}

/** How the first three bytes were obtained, for display and for the checks. */
export function describePrefixSource(options: MacOptions): string {
  const oui = tryParseOui(options.prefix);
  if (oui === null) return '前三字节完全随机（OUI 位已按本地管理处理）';
  if ('error' in oui) return oui.error;
  const first = oui[0];
  if ((first & LOCAL_BIT) !== 0) {
    return '指定的前缀第 1 字节已带本地管理位（U/L = 1），属于自分配前缀空间';
  }
  return '指定的前缀第 1 字节 U/L = 0，看起来是 IEEE 注册的厂商 OUI：请确认你有权使用该前缀';
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Builds one address from six supplied random bytes plus the options.
 *
 * `random.length` must be at least six; extra bytes are ignored so a caller can
 * hand over one buffer for a whole batch and slice it itself.
 */
export function generateMac(options: MacOptions, random: Uint8Array): MacBytes {
  if (!random || random.length < MAC_LENGTH) {
    throw new MacError(`随机源至少需要 ${MAC_LENGTH} 个字节，收到 ${random ? random.length : 0}`);
  }

  const bytes: MacBytes = [
    random[0],
    random[1],
    random[2],
    random[3],
    random[4],
    random[5],
  ];

  const oui = parseOui(options.prefix);
  if (oui) {
    bytes[0] = oui[0];
    bytes[1] = oui[1];
    bytes[2] = oui[2];
  }

  return applyFlags(bytes, {
    multicast: options.multicast,
    locallyAdministered: options.locallyAdministered,
  });
}

/**
 * Generates `count` addresses from one random buffer, six bytes each.
 *
 * Sequentially sliced rather than re-drawing per address: it makes the batch a
 * pure function of the buffer, so a fixed buffer produces a fixed list and the
 * uniformity test can look at every byte position without caring how many
 * addresses were requested.
 */
export function generateMacBatch(count: number, options: MacOptions, random: Uint8Array): MacBytes[] {
  if (!Number.isInteger(count) || count < 1) throw new MacError('生成数量必须是正整数');
  if (count > 1000) throw new MacError('一次最多生成 1000 个地址');
  if (!random || random.length < count * MAC_LENGTH) {
    throw new MacError(`随机源需要 ${count * MAC_LENGTH} 个字节，收到 ${random ? random.length : 0}`);
  }
  const out: MacBytes[] = [];
  for (let index = 0; index < count; index += 1) {
    out.push(generateMac(options, random.subarray(index * MAC_LENGTH, (index + 1) * MAC_LENGTH)));
  }
  return out;
}

/** The three bytes that identify the vendor block, and the three that do not. */
export function splitOuiAndNic(bytes: MacBytes): { oui: string; nic: string; ouiBytes: MacBytes; nicBytes: MacBytes } {
  assertBytes(bytes);
  return {
    oui: bytes.slice(0, OUI_LENGTH).map(hex2).join(':').toUpperCase(),
    nic: bytes.slice(OUI_LENGTH).map(hex2).join(':').toUpperCase(),
    ouiBytes: bytes.slice(0, OUI_LENGTH),
    nicBytes: bytes.slice(OUI_LENGTH),
  };
}

/**
 * The generation the check script uses as a counter-example: the same random
 * bytes with the local bit *not* forced on. Nothing in the app calls it.
 */
export function generateWithoutLocalBit(options: MacOptions, random: Uint8Array): MacBytes {
  const bytes: MacBytes = [random[0], random[1], random[2], random[3], random[4], random[5]];
  const oui = parseOui(options.prefix);
  if (oui) {
    bytes[0] = oui[0];
    bytes[1] = oui[1];
    bytes[2] = oui[2];
  }
  // Only the multicast bit is honoured — the bug being demonstrated.
  return applyFlags(bytes, { multicast: options.multicast, locallyAdministered: false });
}
