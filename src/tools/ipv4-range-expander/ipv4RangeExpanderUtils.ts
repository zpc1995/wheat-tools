/**
 * IPv4 range ↔ minimal CIDR cover.
 *
 * Two directions, one algorithm:
 *
 *   - **range → CIDRs** (`summarizeRange`): the smallest set of CIDR blocks
 *     whose union is exactly the inclusive range.
 *   - **CIDRs → range** (`collapseBlocks`): the union of the given blocks,
 *     re-summarised into the smallest set of blocks (and the plain first/last
 *     addresses of each connected piece).
 *
 * ## Why greedy is optimal (not just "reasonable")
 *
 * Every CIDR block is a set of addresses `[base, base + 2^k - 1]` where `base` is
 * a multiple of `2^k`. So a block that starts at `x` and stays inside
 * `[start, end]` must satisfy `2^k <= alignment(x)` and `2^k <= end - x + 1`. The
 * largest such power of two is therefore the *largest block that can possibly
 * start at `x`*, and taking it can never be worse than taking a smaller one: any
 * cover of `[x, end]` needs at least one block containing `x`, every candidate is
 * contained in the block chosen, and the chosen block is itself contained in the
 * range. Greedily consuming the largest one and repeating yields a cover whose
 * size is a lower bound as well — this is the standard canonical cover, and it
 * is *the* minimum, not merely a minimum the algorithm happens to find. Python's
 * `ipaddress.summarize_address_range` computes the same set, which is what the
 * check script compares against on every case.
 *
 * ## Deliberately not implemented
 *
 * Nothing about routing *semantics*: no longest-prefix-match reasoning, no
 * "is this aggregate advertisement acceptable", no AS/registry lookups, no
 * policy about not aggregating across a boundary. This is set arithmetic on
 * 32-bit integers. Two blocks that happen to be adjacent are merged because
 * their union is one block; that is a mathematical fact, not an opinion about
 * who announces what.
 *
 * ## Numeric domain
 *
 * Values are unsigned 32-bit integers in a `number`. 2^32 is not a valid
 * address but *is* a valid count (the size of 0.0.0.0/0) and is still far below
 * `Number.MAX_SAFE_INTEGER`, so address counts are exact — which is what the
 * "sum of block sizes equals the range length" property test relies on. Bitwise
 * results are normalised with `>>> 0` because JavaScript's operators are signed.
 */

/** An IPv4 address as an unsigned 32-bit integer (0 .. 4294967295). */
export type Uint32 = number;

const MAX_U32 = 4294967295;
const TOTAL_ADDRESSES = 4294967296;

export class Ipv4RangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ipv4RangeError';
  }
}

/** A CIDR block in canonical (network-address) form. */
export interface CidrBlock {
  network: Uint32;
  prefix: number;
}

/** An inclusive address range. */
export interface AddressRange {
  first: Uint32;
  last: Uint32;
}

export const MAX_INPUT_LINES = 2000;

// ---------------------------------------------------------------------------
// Block arithmetic
// ---------------------------------------------------------------------------

/** `2^(32 - prefix)`: how many addresses the block holds. */
export function blockSize(prefix: number): number {
  assertPrefix(prefix);
  return 2 ** (32 - prefix);
}

/** How many of those addresses are usable as hosts under the classic rule. */
export function usableHostCount(prefix: number): number {
  assertPrefix(prefix);
  if (prefix === 32) return 1;
  // RFC 3021: a /31 is two hosts on a point-to-point link, no network or
  // broadcast address is reserved.
  if (prefix === 31) return 2;
  return 2 ** (32 - prefix) - 2;
}

/** The netmask for a prefix, as an unsigned integer. */
export function maskForPrefix(prefix: number): Uint32 {
  assertPrefix(prefix);
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function assertPrefix(prefix: number): void {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Ipv4RangeError(`前缀长度必须是 0 到 32 之间的整数，收到 "${prefix}"`);
  }
}

function assertU32(value: number, what: string): Uint32 {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U32) {
    throw new Ipv4RangeError(`${what} 超出 IPv4 的 0 ~ 4294967295 范围`);
  }
  return value;
}

export function toDotted(value: Uint32): string {
  const v = assertU32(value, '地址');
  return `${(v >>> 24) & 0xff}.${(v >>> 16) & 0xff}.${(v >>> 8) & 0xff}.${v & 0xff}`;
}

/** `192.168.1.5` → 3232235781. Strict: four decimal octets, no leading zeros. */
export function parseIpv4(text: string): Uint32 {
  const trimmed = text.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 4) {
    throw new Ipv4RangeError(`"${trimmed}" 不是点分十进制 IPv4（必须正好四段）`);
  }
  let value = 0;
  for (const [index, part] of parts.entries()) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part)) {
      throw new Ipv4RangeError(`"${trimmed}" 的第 ${index + 1} 段 "${part}" 不是 0 ~ 255 的十进制数`);
    }
    const octet = parseInt(part, 10);
    if (octet > 255) throw new Ipv4RangeError(`"${trimmed}" 的第 ${index + 1} 段 ${octet} 超过 255`);
    value = ((value << 8) | octet) >>> 0;
  }
  return value;
}

/** `192.168.1.5/24` → the block `192.168.1.0/24`. */
export function parseCidr(text: string): CidrBlock {
  const trimmed = text.trim();
  const slash = trimmed.lastIndexOf('/');
  if (slash === -1) throw new Ipv4RangeError(`"${trimmed}" 缺少 /前缀`);
  const address = parseIpv4(trimmed.slice(0, slash));
  const prefixText = trimmed.slice(slash + 1).trim();
  if (!/^[0-9]{1,2}$/.test(prefixText)) {
    throw new Ipv4RangeError(`"${trimmed}" 的前缀长度 "${prefixText}" 不是 0 ~ 32 的整数`);
  }
  const prefix = parseInt(prefixText, 10);
  assertPrefix(prefix);
  return { network: (address & maskForPrefix(prefix)) >>> 0, prefix };
}

/** True when the block's network address is already aligned to its size. */
export function isCanonical(block: CidrBlock): boolean {
  return block.network === ((block.network & maskForPrefix(block.prefix)) >>> 0);
}

/** The first address of a block. */
export function blockFirst(block: CidrBlock): Uint32 {
  assertPrefix(block.prefix);
  return (block.network & maskForPrefix(block.prefix)) >>> 0;
}

/** The last address of a block. */
export function blockLast(block: CidrBlock): Uint32 {
  const first = blockFirst(block);
  return (first + blockSize(block.prefix) - 1) >>> 0;
}

/** `192.168.1.0/24`. */
export function formatBlock(block: CidrBlock): string {
  return `${toDotted(blockFirst(block))}/${block.prefix}`;
}

/** The total number of addresses covered by a list of blocks (duplicates counted). */
export function totalAddresses(blocks: CidrBlock[]): number {
  let total = 0;
  for (const block of blocks) total += blockSize(block.prefix);
  return total;
}

// ---------------------------------------------------------------------------
// range → CIDRs
// ---------------------------------------------------------------------------

/**
 * The minimal CIDR cover of the inclusive range `[start, end]`.
 *
 * See the file header for why the greedy choice is provably minimal. The loop
 * runs at most 64 times for any range, since each step consumes at least one bit
 * position's worth of alignment.
 */
export function summarizeRange(start: Uint32, end: Uint32): CidrBlock[] {
  assertU32(start, '起始地址');
  assertU32(end, '结束地址');
  if (start > end) {
    throw new Ipv4RangeError(`起始地址 ${toDotted(start)} 大于结束地址 ${toDotted(end)}`);
  }

  const blocks: CidrBlock[] = [];
  let current = start;

  while (current <= end) {
    // Largest power of two that divides `current`. For address 0 every size is
    // aligned (0 divides by everything), so the whole 32-bit space is available
    // — hence the explicit 2^32 rather than 0, which is what `x & -x` returns
    // for x = 0 and would stall the loop.
    const alignment = current === 0 ? TOTAL_ADDRESSES : (current & -current) >>> 0;
    const remaining = end - current + 1;

    let size = 1;
    while (size * 2 <= alignment && size * 2 <= remaining) size *= 2;

    const prefix = 32 - Math.round(Math.log2(size));
    blocks.push({ network: current, prefix });
    current = current + size;
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// CIDRs → range
// ---------------------------------------------------------------------------

/**
 * Merges intervals that touch or overlap, then re-summarises each piece.
 *
 * Adjacency (`next.first === current.last + 1`) is merged as well as overlap:
 * `192.168.1.0/25` and `192.168.1.128/25` are two blocks but one contiguous
 * range, and the union is genuinely `192.168.1.0/24`. Blocks that are *not*
 * adjacent stay separate — the result is a list of ranges, not one range that
 * would cover addresses the input never mentioned.
 */
export function collapseBlocks(blocks: CidrBlock[]): { ranges: AddressRange[]; blocks: CidrBlock[] } {
  if (blocks.length === 0) return { ranges: [], blocks: [] };

  const intervals = blocks
    .map((block) => ({ first: blockFirst(block), last: blockLast(block) }))
    .sort((a, b) => a.first - b.first);

  const ranges: AddressRange[] = [];
  for (const interval of intervals) {
    const previous = ranges[ranges.length - 1];
    if (previous && interval.first <= previous.last + 1) {
      if (interval.last > previous.last) previous.last = interval.last;
    } else {
      ranges.push({ ...interval });
    }
  }

  const merged: CidrBlock[] = [];
  for (const range of ranges) merged.push(...summarizeRange(range.first, range.last));

  return { ranges, blocks: merged };
}

/** True when no two blocks in the list overlap. */
export function areDisjoint(blocks: CidrBlock[]): boolean {
  const sorted = blocks
    .map((block) => ({ first: blockFirst(block), last: blockLast(block) }))
    .sort((a, b) => a.first - b.first);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].first <= sorted[index - 1].last) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

/** Cuts comments (`#`, `//`) and blank lines out of a pasted list. */
export function splitInputLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => {
      const hash = line.indexOf('#');
      const slashes = line.indexOf('//');
      let cut = line.length;
      if (hash !== -1) cut = Math.min(cut, hash);
      if (slashes !== -1) cut = Math.min(cut, slashes);
      return line.slice(0, cut).trim();
    })
    .filter((line) => line !== '');
}

const RANGE_SEPARATOR = /\s*(?:-|–|—|~|\.\.|\bto\b)\s*/;

/**
 * Parses "start - end" style input.
 *
 * Several separators are accepted because they all appear in the wild: a plain
 * hyphen (with or without spaces), an en/em dash from a pasted document, a
 * tilde, `..`, and the word `to`. The separator must not be confused with the
 * dots inside an address, so `..` is only treated as a separator because a
 * single dot never is — and the check script exercises `192.168.1.5..192.168.1.30`
 * against `192.168.1.5-192.168.1.30` for exactly that reason.
 *
 * A bare IP is read as the single-address range `/32`; a CIDR is expanded to the
 * range it covers, so the two notations can be mixed within one pasted list.
 */
/**
 * One side of a range expression: either a bare address or a whole CIDR block.
 *
 * Allowing both is what lets a pasted line mix notations (for example the last
 * host of a /24 as the end of a range), which is how network change tickets are
 * actually written.
 */
function rangePiece(piece: string): { first: Uint32; last: Uint32 } {
  const trimmed = piece.trim();
  if (trimmed.includes('/')) {
    const block = parseCidr(trimmed);
    return { first: blockFirst(block), last: blockLast(block) };
  }
  const value = parseIpv4(trimmed);
  return { first: value, last: value };
}

export function parseRangeExpression(text: string): AddressRange {
  const trimmed = text.trim();
  if (trimmed === '') throw new Ipv4RangeError('输入为空');

  const pieces = trimmed.split(RANGE_SEPARATOR).filter((piece) => piece !== '');
  if (pieces.length === 1) return rangePiece(pieces[0]);
  if (pieces.length !== 2) {
    throw new Ipv4RangeError(`"${trimmed}" 无法解析为"起始 - 结束"，分隔符两侧应各是一个 IPv4 地址或 CIDR`);
  }
  const first = rangePiece(pieces[0]).first;
  const last = rangePiece(pieces[1]).last;
  if (first > last) {
    throw new Ipv4RangeError(`起始地址 ${toDotted(first)} 大于结束地址 ${toDotted(last)}`);
  }
  return { first, last };
}

export interface ParsedRangeInput {
  ranges: AddressRange[];
  /** Lines that could not be parsed, kept so the UI can point at them. */
  errors: Array<{ line: string; message: string }>;
  truncated: boolean;
}

/** Parses a pasted list of ranges, one per line. */
export function parseRangeList(text: string): ParsedRangeInput {
  const lines = splitInputLines(text);
  const truncated = lines.length > MAX_INPUT_LINES;
  const used = truncated ? lines.slice(0, MAX_INPUT_LINES) : lines;

  const ranges: AddressRange[] = [];
  const errors: ParsedRangeInput['errors'] = [];
  for (const line of used) {
    try {
      ranges.push(parseRangeExpression(line));
    } catch (error) {
      errors.push({ line, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ranges, errors, truncated };
}

export interface ParsedCidrInput {
  blocks: CidrBlock[];
  /** Blocks whose host bits were dropped, reported so nothing is silent. */
  normalised: Array<{ input: string; canonical: string }>;
  errors: Array<{ line: string; message: string }>;
  truncated: boolean;
}

/** Parses a pasted CIDR list, one block per line. */
export function parseCidrList(text: string): ParsedCidrInput {
  const lines = splitInputLines(text);
  const truncated = lines.length > MAX_INPUT_LINES;
  const used = truncated ? lines.slice(0, MAX_INPUT_LINES) : lines;

  const blocks: CidrBlock[] = [];
  const normalised: ParsedCidrInput['normalised'] = [];
  const errors: ParsedCidrInput['errors'] = [];

  for (const line of used) {
    try {
      const block = parseCidr(line);
      // `192.168.1.5/24` is a common way to write "the /24 that contains this
      // host". Silently dropping the host bits would be fine numerically but
      // hides a probable typo, so the substitution is reported.
      const explicitNetwork = parseIpv4(line.slice(0, line.lastIndexOf('/')));
      if (explicitNetwork !== block.network) {
        normalised.push({ input: line, canonical: formatBlock(block) });
      }
      blocks.push(block);
    } catch (error) {
      errors.push({ line, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return { blocks, normalised, errors, truncated };
}
