/**
 * UUID (RFC 4122) helpers.
 *
 * `crypto.randomUUID` is only available in secure contexts (https or
 * localhost), so a cryptographically secure fallback is provided for other
 * origins such as plain-http LAN access.
 */

const HEX: string[] = Array.from({ length: 256 }, (_, index) =>
  (index + 0x100).toString(16).slice(1),
);

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  // Last-resort fallback: only reached in ancient/embedded browsers.
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** Generates an RFC 4122 version-4 (random) UUID in lowercase. */
export function uuidV4(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  return (
    HEX[bytes[0]] +
    HEX[bytes[1]] +
    HEX[bytes[2]] +
    HEX[bytes[3]] +
    '-' +
    HEX[bytes[4]] +
    HEX[bytes[5]] +
    '-' +
    HEX[bytes[6]] +
    HEX[bytes[7]] +
    '-' +
    HEX[bytes[8]] +
    HEX[bytes[9]] +
    '-' +
    HEX[bytes[10]] +
    HEX[bytes[11]] +
    HEX[bytes[12]] +
    HEX[bytes[13]] +
    HEX[bytes[14]] +
    HEX[bytes[15]]
  );
}

export type UuidFormat = 'lower' | 'upper' | 'nohyphen' | 'braces';

/** Re-formats an existing UUID string for display/copy. */
export function formatUuid(uuid: string, format: UuidFormat): string {
  switch (format) {
    case 'upper':
      return uuid.toUpperCase();
    case 'nohyphen':
      return uuid.replace(/-/g, '');
    case 'braces':
      return `{${uuid}}`;
    case 'lower':
    default:
      return uuid.toLowerCase();
  }
}

export const UUID_FORMAT_LABELS: Record<UuidFormat, string> = {
  lower: '小写',
  upper: '大写',
  nohyphen: '无连字符',
  braces: '带花括号',
};

/** Formats a `Date` as `HH:mm:ss` for the history list. */
export function formatTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}
