/**
 * Hex dump with file-signature detection.
 *
 * The canonical hex-dump layout is used — offset, 16 bytes as hex, then the
 * same bytes as text with non-printables replaced by `.` — because that is the
 * format every other tool and protocol spec uses.
 *
 * Signature detection matters more than it sounds: the single most common
 * reason to open a hex viewer is "what *is* this file?", and extensions lie.
 * The signatures below are matched at offset 0 unless noted.
 */

export interface HexRow {
  offset: number;
  hex: string[];
  /** Printable rendering, one character per byte. */
  ascii: string;
}

export const BYTES_PER_ROW = 16;

/** Renders one byte as two upper-case hex digits. */
function hex2(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, '0');
}

/** Printable ASCII/Latin-1 range; everything else becomes a dot. */
function printable(value: number): string {
  return value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.';
}

/** Builds the dump rows for a byte range. */
export function buildHexRows(
  bytes: Uint8Array,
  start: number,
  length: number,
  bytesPerRow = BYTES_PER_ROW,
): HexRow[] {
  const rows: HexRow[] = [];
  const end = Math.min(bytes.length, start + length);

  for (let offset = Math.max(0, start); offset < end; offset += bytesPerRow) {
    const slice = bytes.subarray(offset, Math.min(offset + bytesPerRow, end));
    rows.push({
      offset,
      hex: [...slice].map(hex2),
      ascii: [...slice].map(printable).join(''),
    });
  }
  return rows;
}

export interface Signature {
  name: string;
  /** Extension hint for the user. */
  extension: string;
  bytes: number[];
  /** Where the signature starts; most are at 0. */
  offset?: number;
}

export const SIGNATURES: Signature[] = [
  { name: 'PNG 图片', extension: '.png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { name: 'JPEG 图片', extension: '.jpg', bytes: [0xff, 0xd8, 0xff] },
  { name: 'GIF 图片', extension: '.gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: 'BMP 图片', extension: '.bmp', bytes: [0x42, 0x4d] },
  { name: 'WebP 图片', extension: '.webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
  { name: 'PDF 文档', extension: '.pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { name: 'ZIP / docx / xlsx', extension: '.zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { name: 'ZIP（空归档）', extension: '.zip', bytes: [0x50, 0x4b, 0x05, 0x06] },
  { name: 'GZIP 压缩', extension: '.gz', bytes: [0x1f, 0x8b] },
  { name: 'BZIP2 压缩', extension: '.bz2', bytes: [0x42, 0x5a, 0x68] },
  { name: 'XZ 压缩', extension: '.xz', bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] },
  { name: '7z 压缩', extension: '.7z', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { name: 'RAR 压缩', extension: '.rar', bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] },
  { name: 'ELF 可执行', extension: '', bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { name: 'Windows 可执行（MZ）', extension: '.exe', bytes: [0x4d, 0x5a] },
  { name: 'Java class', extension: '.class', bytes: [0xca, 0xfe, 0xba, 0xbe] },
  { name: 'SQLite 数据库', extension: '.sqlite', bytes: [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66] },
  { name: 'MP3（ID3）', extension: '.mp3', bytes: [0x49, 0x44, 0x33] },
  { name: 'MP4 / MOV', extension: '.mp4', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { name: 'Ogg', extension: '.ogg', bytes: [0x4f, 0x67, 0x67, 0x53] },
  { name: 'FLAC', extension: '.flac', bytes: [0x66, 0x4c, 0x61, 0x43] },
  { name: 'WAV / AVI（RIFF）', extension: '.wav', bytes: [0x52, 0x49, 0x46, 0x46] },
  { name: 'TrueType 字体', extension: '.ttf', bytes: [0x00, 0x01, 0x00, 0x00] },
  { name: 'OpenType 字体', extension: '.otf', bytes: [0x4f, 0x54, 0x54, 0x4f] },
  { name: 'WOFF 字体', extension: '.woff', bytes: [0x77, 0x4f, 0x46, 0x46] },
  { name: 'WOFF2 字体', extension: '.woff2', bytes: [0x77, 0x4f, 0x46, 0x32] },
];

export interface Detection {
  name: string;
  extension: string;
  /** Byte length of the matched signature. */
  matched: number;
}

/** Finds the first signature matching the data; null when nothing matches. */
export function detectSignature(bytes: Uint8Array): Detection | null {
  for (const signature of SIGNATURES) {
    const at = signature.offset ?? 0;
    if (bytes.length < at + signature.bytes.length) continue;

    let matched = true;
    for (let index = 0; index < signature.bytes.length; index += 1) {
      if (bytes[at + index] !== signature.bytes[index]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { name: signature.name, extension: signature.extension, matched: signature.bytes.length };
    }
  }
  return null;
}

export interface ByteStats {
  total: number;
  /** Counts per byte value, for the distribution view. */
  histogram: Uint32Array;
  /** Shannon entropy in bits per byte (0–8). */
  entropy: number;
  /** Proportion of bytes that are printable ASCII. */
  printableRatio: number;
  nullBytes: number;
}

/**
 * Computes byte statistics.
 *
 * Entropy is the useful signal here: values near 8 bits/byte indicate compressed
 * or encrypted data, while low values indicate text or repetitive structure.
 */
export function analyseBytes(bytes: Uint8Array): ByteStats {
  const histogram = new Uint32Array(256);
  let printableCount = 0;

  for (const byte of bytes) {
    histogram[byte] += 1;
    if (byte >= 0x20 && byte <= 0x7e) printableCount += 1;
  }

  let entropy = 0;
  if (bytes.length > 0) {
    for (const count of histogram) {
      if (count === 0) continue;
      const p = count / bytes.length;
      entropy -= p * Math.log2(p);
    }
  }

  return {
    total: bytes.length,
    histogram,
    entropy,
    printableRatio: bytes.length === 0 ? 0 : printableCount / bytes.length,
    nullBytes: histogram[0],
  };
}

/** Best-effort text decoding, used for the text tab. */
export function decodeText(bytes: Uint8Array, encoding: 'utf-8' | 'utf-16le' | 'latin1'): string {
  try {
    if (encoding === 'latin1') {
      return [...bytes].map((byte) => String.fromCharCode(byte)).join('');
    }
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

/** Detects whether the data looks like UTF-8 text. */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const stats = analyseBytes(bytes.subarray(0, Math.min(bytes.length, 4096)));
  return stats.printableRatio > 0.9;
}

export interface StringHit {
  offset: number;
  text: string;
  encoding: 'ascii' | 'utf-8';
}

/**
 * Extracts readable strings from binary data.
 *
 * This is the `strings(1)` behaviour: runs of printable characters at least
 * `minLength` long. Invaluable for finding embedded URLs, paths or messages.
 */
export function extractStrings(
  bytes: Uint8Array,
  minLength = 4,
  limit = 400,
): StringHit[] {
  const hits: StringHit[] = [];
  let start = -1;
  let buffer: number[] = [];

  const flush = (end: number) => {
    if (buffer.length >= minLength) {
      try {
        // Decode as UTF-8 so multi-byte characters survive.
        const text = new TextDecoder('utf-8', { fatal: true }).decode(
          new Uint8Array(buffer),
        );
        if (text.trim()) {
          hits.push({
            offset: start,
            text: text.slice(0, 300),
            encoding: [...buffer].every((byte) => byte < 0x80) ? 'ascii' : 'utf-8',
          });
        }
      } catch {
        // Not valid UTF-8; fall back to the ASCII subset.
        const text = buffer
          .filter((byte) => byte >= 0x20 && byte <= 0x7e)
          .map((byte) => String.fromCharCode(byte))
          .join('');
        if (text.length >= minLength) {
          hits.push({ offset: start, text: text.slice(0, 300), encoding: 'ascii' });
        }
      }
    }
    buffer = [];
    start = -1;
    void end;
  };

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    // Treat tab as printable so tab-separated content stays together, but a
    // newline terminates a string (there is no "line" in a binary blob).
    const isPrintable = (byte >= 0x20 && byte <= 0x7e) || byte === 0x09 || byte >= 0x80;
    if (isPrintable) {
      if (start === -1) start = index;
      buffer.push(byte);
      if (hits.length >= limit) break;
    } else {
      flush(index);
    }
  }
  flush(bytes.length);

  return hits.slice(0, limit);
}

/** Formats a byte count for display. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

/** Refuses huge files; the whole buffer is held in memory. */
export const MAX_FILE_BYTES = 32 * 1024 * 1024;

/**
 * Interprets a value at a given offset in several widths.
 *
 * Reading integers out of a dump is a routine need and doing it here avoids
 * reaching for a separate calculator.
 */
export function readWidths(
  bytes: Uint8Array,
  offset: number,
): { little: Record<string, number>; big: Record<string, number> } | null {
  if (offset < 0 || offset >= bytes.length) return null;
  const available = bytes.length - offset;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, available);

  const little: Record<string, number> = {};
  const big: Record<string, number> = {};

  if (available >= 1) {
    little['uint8'] = view.getUint8(0);
    big['uint8'] = view.getUint8(0);
  }
  if (available >= 2) {
    little['uint16'] = view.getUint16(0, true);
    big['uint16'] = view.getUint16(0, false);
  }
  if (available >= 4) {
    little['uint32'] = view.getUint32(0, true);
    big['uint32'] = view.getUint32(0, false);
    little['float32'] = Number(view.getFloat32(0, true).toPrecision(7));
    big['float32'] = Number(view.getFloat32(0, false).toPrecision(7));
  }
  if (available >= 8) {
    // BigInt→Number would lose precision, but showing the exact value as a
    // string is more useful than a rounded number.
    little['uint64'] = Number(view.getBigUint64(0, true));
    big['uint64'] = Number(view.getBigUint64(0, false));
  }

  return { little, big };
}
