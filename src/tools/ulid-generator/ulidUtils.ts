/**
 * ULID (Universally Unique Lexicographically Sortable Identifier) logic.
 *
 * Specification: https://github.com/ulid/spec
 *
 * Everything in this module is pure: the two inputs that would normally be
 * taken from the environment — the current time and the random bytes — are
 * parameters instead. That is what makes the generator testable. A function
 * that calls `Date.now()` and `crypto.getRandomValues()` internally can only be
 * checked by generating values and eyeballing them; with the inputs injected, a
 * check can pin the millisecond, feed one exact byte sequence, and compare the
 * output against the specification's own examples.
 *
 * A ULID is 26 characters of Crockford Base32:
 *
 *   tttttttttt rrrrrrrrrrrrrrrr
 *   10 chars   16 chars
 *   48 bits    80 bits
 *   ms time    randomness
 *
 * The alphabet deliberately omits I, L, O and U, so a ULID can never be
 * confused with a hand-copied number, and the fixed-width timestamp first means
 * plain string sorting equals time sorting.
 */

/**
 * Crockford Base32, in value order: index 0 is "0", index 31 is "Z".
 *
 * The four letters missing from the alphabet are I, L, O and U. That is not an
 * oversight to be "fixed" with a full A-Z alphabet: leaving them out is what
 * makes 1/l/I and 0/O unambiguous when an id is read aloud or retyped.
 */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Characters used by the millisecond timestamp. */
export const TIME_LENGTH = 10;
/** Characters used by the randomness. */
export const RANDOM_LENGTH = 16;
/** Length of a canonical ULID string. */
export const ULID_LENGTH = TIME_LENGTH + RANDOM_LENGTH;
/** Random bytes consumed per ULID: 80 bits, exactly the 16 random characters. */
export const RANDOM_BYTES = 10;
/**
 * Largest timestamp a ULID can hold: 2 ** 48 - 1 ms, i.e. the year 10889.
 *
 * Expressed as a literal rather than `2 ** 48 - 1` only because a literal is
 * what the specification prints; the value is identical.
 */
export const MAX_TIMESTAMP = 281474976710655;
/**
 * Hard cap on one batch.
 *
 * The cap exists so a mistyped quantity cannot freeze the tab building a
 * million-character string. The UI's largest preset is well below it.
 */
export const MAX_BATCH = 1000;

const ALPHABET_INDEX = new Map<string, number>();
for (let index = 0; index < CROCKFORD_ALPHABET.length; index += 1) {
  ALPHABET_INDEX.set(CROCKFORD_ALPHABET[index], index);
}
const ALPHABET_MAX_INDEX = CROCKFORD_ALPHABET.length - 1;
const ZERO_CHAR = CROCKFORD_ALPHABET[0];

/** Why a string is not a valid ULID. */
export type UlidErrorReason = 'length' | 'alphabet' | 'overflow';

/** A ULID taken apart into the two fields it encodes. */
export interface DecodedUlid {
  /** Milliseconds since the Unix epoch, from the first 10 characters. */
  timestamp: number;
  /** The 16 random characters exactly as they appear in the string. */
  random: string;
  /** The same 80 random bits as bytes, useful for hex display and re-encoding. */
  randomBytes: Uint8Array;
}

/** The state a monotonic generator has to carry between calls. */
export interface MonotonicState {
  /** Timestamp of the last ULID produced by this generator. */
  timestamp: number;
  /** Randomness of the last ULID produced, as 16 characters. */
  random: string;
}

export interface MonotonicStep {
  ulid: string;
  state: MonotonicState;
  /**
   * True when this call detected "same millisecond" and reused the previous
   * timestamp with the random part incremented.
   */
  reusedTimestamp: boolean;
}

export interface BatchResult {
  ulids: string[];
  /** State to hand back to the next batch, or null in non-monotonic mode. */
  monotonicState: MonotonicState | null;
}

function charValue(char: string): number {
  const value = ALPHABET_INDEX.get(char);
  if (value === undefined) {
    throw new RangeError(`Not a Crockford Base32 character: ${char}`);
  }
  return value;
}

/**
 * Encodes a millisecond timestamp as the 10 character time field.
 *
 * Repeated division rather than bitwise operators: JavaScript's `>>` and `>>>`
 * coerce to 32 bits, so a 48-bit timestamp run through them would be silently
 * truncated to garbage. The same reason rules out cramming the value into a
 * `DataView` by hand. Division is also exact here — every intermediate value is
 * an integer below 2 ** 53, the largest integer a double represents exactly.
 */
export function encodeTime(now: number): string {
  if (!Number.isInteger(now) || now < 0 || now > MAX_TIMESTAMP) {
    throw new RangeError(`ULID timestamp out of range: ${now}`);
  }

  let remaining = now;
  let encoded = '';
  for (let index = 0; index < TIME_LENGTH; index += 1) {
    encoded = CROCKFORD_ALPHABET[remaining % 32] + encoded;
    remaining = Math.floor(remaining / 32);
  }
  return encoded;
}

function decodeTimePart(prefix: string): number {
  let timestamp = 0;
  for (let index = 0; index < TIME_LENGTH; index += 1) {
    timestamp = timestamp * 32 + charValue(prefix[index]);
  }
  return timestamp;
}

/**
 * Reads the timestamp of a complete 26 character ULID.
 *
 * Rejects anything `validateUlid` rejects, including a first character above
 * "7": such a string would hold more than 48 bits of time and silently decode
 * to a date far outside the range the format promises.
 */
export function decodeTime(value: string): number {
  const reason = validateUlid(value);
  if (reason !== null) {
    throw new RangeError(`Invalid ULID (${reason}): ${value}`);
  }
  return decodeTimePart(value.slice(0, TIME_LENGTH));
}

/**
 * Encodes exactly 80 random bits as the 16 character random field.
 *
 * 80 bits in and 16 x 5 bits out is an exact fit, so the bytes are packed
 * big-endian with nothing left over and `decodeRandom` reverses this losslessly.
 * Simpler-looking alternatives are all worse: slicing each byte down to 5 bits
 * throws away 48 of the 128 bits drawn, and building the field from a `Number`
 * cannot represent 80 bits at all (a double holds 53), so two different random
 * draws would produce the same characters.
 */
export function encodeRandom(bytes: Uint8Array): string {
  if (bytes.length < RANDOM_BYTES) {
    throw new RangeError(`ULID randomness needs ${RANDOM_BYTES} bytes, got ${bytes.length}`);
  }

  let encoded = '';
  for (let char = 0; char < RANDOM_LENGTH; char += 1) {
    let value = 0;
    for (let bit = 0; bit < 5; bit += 1) {
      const position = char * 5 + bit;
      const byte = bytes[position >> 3];
      value = value * 2 + ((byte >> (7 - (position & 7))) & 1);
    }
    encoded += CROCKFORD_ALPHABET[value];
  }
  return encoded;
}

/** Reverses `encodeRandom`. Throws on a wrong length or a foreign character. */
export function decodeRandom(random: string): Uint8Array {
  if (random.length !== RANDOM_LENGTH) {
    throw new RangeError(`ULID randomness must be ${RANDOM_LENGTH} characters, got ${random.length}`);
  }

  const bytes = new Uint8Array(RANDOM_BYTES);
  for (let char = 0; char < RANDOM_LENGTH; char += 1) {
    const value = charValue(random[char]);
    for (let bit = 0; bit < 5; bit += 1) {
      const position = char * 5 + bit;
      if (((value >> (4 - bit)) & 1) === 1) {
        bytes[position >> 3] |= 128 >> (position & 7);
      }
    }
  }
  return bytes;
}

/** Assembles a ULID from its two parts. Both inputs are supplied by the caller. */
export function generateUlid(now: number, random: Uint8Array): string {
  return encodeTime(now) + encodeRandom(random);
}

/**
 * Classifies a string as a ULID, or explains what is wrong with it.
 *
 * Strict on purpose: lowercase is handled by `normaliseUlid` before this is
 * called, but I, L, O and U are never accepted, and the first character must be
 * "7" or below. The reference JavaScript implementation folds i/l to 1 and o to
 * 0; doing that here would turn a mistyped id into a *different valid id*
 * instead of an error, which is the opposite of what an id reader should do.
 */
export function validateUlid(value: string): UlidErrorReason | null {
  if (typeof value !== 'string' || value.length !== ULID_LENGTH) return 'length';
  for (let index = 0; index < ULID_LENGTH; index += 1) {
    if (!ALPHABET_INDEX.has(value[index])) return 'alphabet';
  }
  // 26 characters can carry 130 bits but a ULID is only 128, so the first
  // character is limited to 0-7. Comparing characters instead of decoding is
  // safe because the alphabet is in ASCII order, so "8" and every letter sort
  // after "7".
  if (value[0] > '7') return 'overflow';
  return null;
}

/** True for a canonical 26 character ULID. */
export function isValidUlid(value: string): boolean {
  return validateUlid(value) === null;
}

/**
 * Trims and upper-cases input, returning a canonical ULID or null.
 *
 * ULIDs are case insensitive, so accepting lowercase from a paste is right;
 * "canonical" here still means the 26 character Crockford form.
 */
export function normaliseUlid(value: string): string | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return validateUlid(upper) === null ? upper : null;
}

/** Takes a ULID apart, or returns null when the string is not one. */
export function decodeUlid(value: string): DecodedUlid | null {
  const normalised = normaliseUlid(value);
  if (normalised === null) return null;

  const random = normalised.slice(TIME_LENGTH);
  return {
    timestamp: decodeTimePart(normalised.slice(0, TIME_LENGTH)),
    random,
    randomBytes: decodeRandom(random),
  };
}

/**
 * Adds one to the 16 character random field, base32 with carry.
 *
 * The carry is what keeps the *strings* ordered: bumping the last character
 * only would run off the end of the alphabet, so the field is treated as one
 * 80-bit number — advance the rightmost character that can advance, and zero
 * everything to its right.
 *
 * Returns null when every character is already "Z", i.e. the 80-bit field is
 * full. The specification says generation must fail in that case, and the
 * reference implementation throws; wrapping around to zero, or borrowing a
 * millisecond that has not happened, would both produce a string that sorts
 * before its predecessor and a timestamp that is simply untrue.
 */
export function incrementRandomPart(random: string): string | null {
  if (random.length !== RANDOM_LENGTH) {
    throw new RangeError(`ULID randomness must be ${RANDOM_LENGTH} characters, got ${random.length}`);
  }

  const chars = random.split('');
  for (let index = RANDOM_LENGTH - 1; index >= 0; index -= 1) {
    const value = charValue(chars[index]);
    if (value < ALPHABET_MAX_INDEX) {
      chars[index] = CROCKFORD_ALPHABET[value + 1];
      for (let right = index + 1; right < RANDOM_LENGTH; right += 1) {
        chars[right] = ZERO_CHAR;
      }
      return chars.join('');
    }
  }
  return null;
}

/**
 * Produces the next ULID of a monotonic sequence.
 *
 * When the clock has not moved past the previous ULID — the same millisecond,
 * or a clock that jumped backwards — the previous timestamp is reused and the
 * random field is incremented. That single rule is the whole point of monotonic
 * mode: ULIDs generated in one millisecond still sort in generation order,
 * which UUIDv4 can never promise.
 *
 * `previous` being null starts a new sequence. The caller owns the state, so
 * the function stays pure and a check can replay a sequence exactly.
 */
export function nextMonotonicUlid(
  previous: MonotonicState | null,
  now: number,
  random: Uint8Array,
): MonotonicStep {
  if (previous !== null && now <= previous.timestamp) {
    const bumped = incrementRandomPart(previous.random);
    if (bumped === null) {
      throw new RangeError('ULID randomness overflowed within one millisecond');
    }
    return {
      ulid: encodeTime(previous.timestamp) + bumped,
      state: { timestamp: previous.timestamp, random: bumped },
      reusedTimestamp: true,
    };
  }

  // A fresh millisecond (or the first call): the timestamp alone already puts
  // this ULID after every previous one, so new randomness is safe.
  const encoded = encodeRandom(random);
  return {
    ulid: encodeTime(now) + encoded,
    state: { timestamp: now, random: encoded },
    reusedTimestamp: false,
  };
}

/**
 * Generates `count` ULIDs that all share one timestamp.
 *
 * The quantity is clamped rather than rejected: this feeds a text field, and
 * the useful outcome of a bogus count is an empty list, not an exception in the
 * middle of a render. `randomFor` is called once per ULID so the caller decides
 * where randomness comes from — the check passes a deterministic source.
 */
export function generateBatch(
  count: number,
  now: number,
  randomFor: (index: number) => Uint8Array,
  previous: MonotonicState | null,
  monotonic: boolean,
): BatchResult {
  const total = Number.isFinite(count)
    ? Math.min(Math.max(Math.trunc(count), 0), MAX_BATCH)
    : 0;

  const ulids: string[] = [];
  let state = monotonic ? previous : null;

  for (let index = 0; index < total; index += 1) {
    if (monotonic) {
      const step = nextMonotonicUlid(state, now, randomFor(index));
      ulids.push(step.ulid);
      state = step.state;
    } else {
      ulids.push(generateUlid(now, randomFor(index)));
    }
  }

  return { ulids, monotonicState: monotonic ? state : null };
}

/** Formats random bytes as upper-case hex, for the decoded view. */
export function randomToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let index = 0; index < bytes.length; index += 1) {
    hex += (bytes[index] + 0x100).toString(16).slice(1);
  }
  return hex.toUpperCase();
}

/**
 * Renders a ULID timestamp as an ISO 8601 UTC string.
 *
 * Converting a number to a `Date` reads no clock, so this stays deterministic
 * and usable from the logic layer; the epoch itself is just UTC.
 */
export function formatTimestampIso(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Invalid Date' : date.toISOString();
}
