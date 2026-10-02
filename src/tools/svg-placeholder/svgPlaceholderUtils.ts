/**
 * SVG placeholder image generation.
 *
 * Pure logic: no React, no DOM, no clock, no randomness. The same options always
 * produce a byte-identical document, which is what makes the escaping checks
 * meaningful — the output can be compared against the input character by
 * character, and parsing it back must yield the original text.
 *
 * The single most dangerous thing this module does is interpolate user-supplied
 * text and user-supplied colours into an XML document. Two consequences drive
 * the whole design:
 *
 *   1. **Text must be escaped, and `&` must be escaped first.** A placeholder
 *      caption is arbitrary user text; an unescaped `<` turns it into markup,
 *      and `</text><script>…</script>` turns a caption into script content. The
 *      escape order matters: replacing `<` before `&` would turn an existing
 *      `&lt;` into `&amp;lt;` and change the text that comes back out.
 *
 *   2. **Colours must be validated against an allow-list, not escaped.** They
 *      are not text content but attribute values and paint-server references, so
 *      a value like `red" onload="alert(1)` cannot be made safe by entity
 *      encoding alone — the parser still sees a new attribute. Only strings that
 *      match a known CSS colour syntax are accepted; everything else falls back
 *      to a default.
 *
 * A third, quieter hazard: XML 1.0 does not allow most C0 control characters or
 * unpaired surrogates. `\u0000` inside a caption is enough to make the document
 * ill-formed — well-formed enough to look right in a `<textarea>`, but rejected
 * by every XML parser. Those code points are replaced with U+FFFD here rather
 * than emitted.
 *
 * Deliberately not implemented: rasterisation to PNG/JPEG. That requires a
 * canvas or a native rasteriser, i.e. a real rendering engine, not string
 * building; the browser's own decoder already does it best when the SVG is used
 * in an `<img>` or downloaded and opened. Bitmap resizing/conversion is a
 * separate concern that the existing image tool covers.
 */

/** Background pattern drawn on top of the flat background colour. */
export type PatternKind = 'none' | 'grid' | 'stripes';

/** Everything that shapes the generated document. */
export interface PlaceholderOptions {
  width: number;
  height: number;
  background: string;
  text: string;
  textColor: string;
  /** 0 means "derive a size that fits", which is what most people want. */
  fontSize: number;
  radius: number;
  borderWidth: number;
  borderColor: string;
  pattern: PatternKind;
  patternColor: string;
  showDimensions: boolean;
}

export const DEFAULT_OPTIONS: PlaceholderOptions = {
  width: 640,
  height: 360,
  background: '#e8eef6',
  text: '640 × 360',
  textColor: '#3b4a5a',
  fontSize: 0,
  radius: 12,
  borderWidth: 0,
  borderColor: '#9aa8b8',
  pattern: 'none',
  patternColor: '#c9d6e4',
  showDimensions: false,
};

export const MIN_DIMENSION = 1;
export const MAX_DIMENSION = 4096;
export const MAX_TEXT_LENGTH = 2000;
export const MIN_FONT_SIZE = 4;
export const MAX_FONT_SIZE = 512;

/**
 * Named CSS colours worth accepting.
 *
 * A short list rather than the full 148: the tool's own defaults and the common
 * hand-typed names cover what people actually write, and every extra name is one
 * more string that has to stay correct. Anything not listed can be entered as
 * hex or as an `rgb()`/`hsl()` function.
 */
const NAMED_COLOURS = new Set([
  'black',
  'silver',
  'gray',
  'grey',
  'white',
  'maroon',
  'red',
  'purple',
  'fuchsia',
  'green',
  'lime',
  'olive',
  'yellow',
  'navy',
  'blue',
  'teal',
  'aqua',
  'orange',
  'transparent',
  'none',
]);

const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * `rgb()` / `rgba()` / `hsl()` / `hsla()` with numeric arguments only.
 *
 * The character class deliberately excludes quotes, parentheses, semicolons and
 * angle brackets, so nothing that could terminate the attribute can get in.
 * `url(...)`, `var(...)` and CSS escapes are not matched at all.
 */
const FUNCTIONAL_COLOUR = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9]+(?:\.[0-9]+)?%?\s*(?:[,/]\s*[0-9]+(?:\.[0-9]+)?%?\s*){2,3}\)$/i;

/** True when `value` is a colour this tool is willing to write into the SVG. */
export function isValidColour(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (NAMED_COLOURS.has(trimmed.toLowerCase())) return true;
  if (HEX_COLOUR.test(trimmed)) return true;
  return FUNCTIONAL_COLOUR.test(trimmed);
}

/** `value` if it is a valid colour, otherwise `fallback`. */
export function safeColour(value: string, fallback: string): string {
  return isValidColour(value) ? value.trim() : fallback;
}

/**
 * Escapes a string for use as XML text **or** as a double-quoted attribute
 * value.
 *
 * `&` first, always: every later replacement introduces an `&` of its own, and
 * doing them in the other order double-escapes the input (`&lt;` would become
 * `&amp;lt;` and read back as the literal text `&lt;`). The remaining four are
 * the characters XML reserves; escaping `>` as well is not strictly required
 * but makes `]]>` and stray `-->` sequences harmless too.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Replaces code points that XML 1.0 forbids with U+FFFD.
 *
 * XML 1.0 allows #x9, #xA, #xD, #x20-#xD7FF, #xE000-#xFFFD and #x10000-#x10FFFF.
 * Everything else — NUL, the other C0 controls, #xFFFE, #xFFFF, and unpaired
 * surrogates — makes the document ill-formed. Iterating by code point (rather
 * than by code unit) is what keeps astral characters such as emoji intact:
 * splitting a surrogate pair would itself create two invalid characters.
 */
export function stripInvalidXmlChars(value: string): string {
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const valid =
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    out += valid ? character : '\uFFFD';
  }
  return out;
}

/** Clamps to an integer inside a range, falling back when the input is unusable. */
export function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Number of bytes the string occupies when encoded as UTF-8. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/** Collapses everything that could break the layout into a tidy option set. */
export function normaliseOptions(options: PlaceholderOptions): PlaceholderOptions {
  // Dimensions first: the radius limit is derived from them, and clamping
  // against an unvalidated 0 or NaN would let a nonsense radius through.
  const width = clampInt(options.width, MIN_DIMENSION, MAX_DIMENSION, DEFAULT_OPTIONS.width);
  const height = clampInt(options.height, MIN_DIMENSION, MAX_DIMENSION, DEFAULT_OPTIONS.height);
  return {
    width,
    height,
    background: safeColour(options.background, DEFAULT_OPTIONS.background),
    text: stripInvalidXmlChars(String(options.text ?? '')).slice(0, MAX_TEXT_LENGTH),
    textColor: safeColour(options.textColor, DEFAULT_OPTIONS.textColor),
    fontSize: clampInt(options.fontSize, 0, MAX_FONT_SIZE, 0),
    radius: clampInt(options.radius, 0, Math.floor(Math.min(width, height) / 2), 0),
    borderWidth: clampInt(options.borderWidth, 0, 64, 0),
    borderColor: safeColour(options.borderColor, DEFAULT_OPTIONS.borderColor),
    pattern: options.pattern === 'grid' || options.pattern === 'stripes' ? options.pattern : 'none',
    patternColor: safeColour(options.patternColor, DEFAULT_OPTIONS.patternColor),
    showDimensions: options.showDimensions === true,
  };
}

/** Longest line, counted by code point so an emoji is one column not two. */
function longestLineLength(lines: string[]): number {
  let longest = 0;
  for (const line of lines) longest = Math.max(longest, [...line].length);
  return longest;
}

/**
 * Picks a font size when the caller asked for "auto".
 *
 * Two independent constraints: the text must not exceed the box vertically, and
 * the longest line must not exceed it horizontally. Deriving the second from the
 * character count is an approximation — 0.6 em is a decent average advance
 * width for a proportional sans-serif — but it beats letting text run off the
 * edge, and the user can always type an explicit size.
 */
export function autoFontSize(options: PlaceholderOptions, lines: string[]): number {
  const reserved = options.showDimensions ? 46 : 16;
  const usableHeight = Math.max(8, options.height - reserved);
  const usableWidth = Math.max(8, options.width - 32);
  const longest = Math.max(1, longestLineLength(lines));
  const byHeight = usableHeight / (lines.length * 1.25);
  const byWidth = usableWidth / (longest * 0.6);
  return clampInt(Math.min(byHeight, byWidth), MIN_FONT_SIZE, MAX_FONT_SIZE, 16);
}

/** One rendered line together with its baseline offset. */
interface LaidOutLine {
  text: string;
  y: number;
}

/** Vertical placement: every line centred as a block, one line-height apart. */
function layoutLines(lines: string[], fontSize: number, height: number): LaidOutLine[] {
  const lineHeight = fontSize * 1.25;
  const blockHeight = lineHeight * lines.length;
  const firstBaseline = (height - blockHeight) / 2 + lineHeight * 0.78;
  return lines.map((text, index) => ({ text, y: firstBaseline + index * lineHeight }));
}

const GRID_STEP = 24;
const STRIPE_WIDTH = 8;
const STRIPE_PERIOD = 16;

/** The `<defs>` block, present only when a pattern was requested. */
function patternDefs(options: PlaceholderOptions): string {
  if (options.pattern === 'none') return '';
  const colour = escapeXml(options.patternColor);
  if (options.pattern === 'grid') {
    return (
      '  <defs>\n' +
      `    <pattern id="wt-placeholder-grid" width="${GRID_STEP}" height="${GRID_STEP}" patternUnits="userSpaceOnUse">\n` +
      `      <path d="M ${GRID_STEP} 0 L 0 0 L 0 ${GRID_STEP}" fill="none" stroke="${colour}" stroke-width="1"/>\n` +
      '    </pattern>\n' +
      '  </defs>\n'
    );
  }
  return (
    '  <defs>\n' +
    `    <pattern id="wt-placeholder-stripes" width="${STRIPE_PERIOD}" height="${STRIPE_PERIOD}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">\n` +
    `      <rect x="0" y="0" width="${STRIPE_WIDTH}" height="${STRIPE_PERIOD}" fill="${colour}"/>\n` +
    '    </pattern>\n' +
    '  </defs>\n'
  );
}

/** Edge ticks plus `W px` / `H px` labels, drawn inside the frame. */
function dimensionAnnotations(options: PlaceholderOptions, fontSize: number): string {
  const { width, height } = options;
  const colour = escapeXml(options.textColor);
  const tick = 6;
  const inset = 10;
  const sizeFont = clampInt(Math.min(fontSize, 14), 8, 20, 12);
  const parts: string[] = [];

  // Horizontal ruler along the bottom edge.
  parts.push(
    `  <g stroke="${colour}" stroke-width="1" opacity="0.65">\n` +
      `    <line x1="${inset}" y1="${height - inset}" x2="${Math.max(inset, width - inset)}" y2="${height - inset}"/>\n` +
      `    <line x1="${inset}" y1="${height - inset - tick / 2}" x2="${inset}" y2="${height - inset + tick / 2}"/>\n` +
      `    <line x1="${width - inset}" y1="${height - inset - tick / 2}" x2="${width - inset}" y2="${height - inset + tick / 2}"/>\n` +
      '  </g>\n',
  );
  parts.push(
    `  <text x="${width / 2}" y="${height - inset - 4}" fill="${colour}" font-family="sans-serif" font-size="${sizeFont}" text-anchor="middle" opacity="0.85">${escapeXml(
      `${width} px`,
    )}</text>\n`,
  );

  // Vertical ruler along the left edge; the label is rotated so it reads upward.
  parts.push(
    `  <g stroke="${colour}" stroke-width="1" opacity="0.65">\n` +
      `    <line x1="${inset}" y1="${inset}" x2="${inset}" y2="${Math.max(inset, height - inset)}"/>\n` +
      `    <line x1="${inset - tick / 2}" y1="${inset}" x2="${inset + tick / 2}" y2="${inset}"/>\n` +
      `    <line x1="${inset - tick / 2}" y1="${height - inset}" x2="${inset + tick / 2}" y2="${height - inset}"/>\n` +
      '  </g>\n',
  );
  parts.push(
    `  <text x="${inset + 4}" y="${height / 2}" fill="${colour}" font-family="sans-serif" font-size="${sizeFont}" text-anchor="middle" opacity="0.85" transform="rotate(-90 ${inset + 4} ${height / 2})">${escapeXml(
      `${height} px`,
    )}</text>\n`,
  );

  return parts.join('');
}

/**
 * Builds the SVG document.
 *
 * The output is written by hand rather than through a DOM builder: the whole
 * point of the tool is to *show* the source, and going through
 * `document.createElementNS` would both require a DOM (breaking the purity the
 * checks rely on) and hide exactly the escaping this module is about.
 */
export function buildPlaceholderSvg(rawOptions: PlaceholderOptions): string {
  const options = normaliseOptions(rawOptions);
  const { width, height } = options;

  const lines = options.text.split('\n').slice(0, 40);
  const fontSize = options.fontSize > 0 ? options.fontSize : autoFontSize(options, lines);
  const laidOut = layoutLines(lines, fontSize, height);

  const rx = options.radius > 0 ? ` rx="${options.radius}" ry="${options.radius}"` : '';

  let body = '';
  body += `  <rect x="0" y="0" width="${width}" height="${height}"${rx} fill="${escapeXml(
    options.background,
  )}"/>\n`;

  if (options.pattern !== 'none') {
    const id = options.pattern === 'grid' ? 'wt-placeholder-grid' : 'wt-placeholder-stripes';
    body += `  <rect x="0" y="0" width="${width}" height="${height}"${rx} fill="url(#${id})"/>\n`;
  }

  if (options.borderWidth > 0) {
    // The stroke straddles the path, so half of it would be clipped outside the
    // viewBox; insetting by half the width keeps the whole border visible and
    // keeps the drawn rectangle exactly `width` × `height` outside it.
    const half = options.borderWidth / 2;
    const inset = options.borderWidth > 1 ? half : 0.5;
    body += `  <rect x="${inset}" y="${inset}" width="${Math.max(0, width - inset * 2)}" height="${Math.max(
      0,
      height - inset * 2,
    )}"${rx} fill="none" stroke="${escapeXml(options.borderColor)}" stroke-width="${
      options.borderWidth
    }"/>\n`;
  }

  if (laidOut.length > 0 && options.text !== '') {
    const tspans = laidOut
      .map(
        (line) =>
          `<tspan x="${width / 2}" y="${line.y.toFixed(2)}">${escapeXml(line.text)}</tspan>`,
      )
      .join('');
    body +=
      `  <text x="${width / 2}" y="${laidOut[0].y.toFixed(2)}" fill="${escapeXml(
        options.textColor,
      )}" font-family="'Segoe UI', system-ui, sans-serif" font-size="${fontSize}" ` +
      `font-weight="600" text-anchor="middle">${tspans}</text>\n`;
  }

  if (options.showDimensions) {
    body += dimensionAnnotations(options, fontSize);
  }

  // The `<title>` is what a screen reader announces for the image and what the
  // browser shows as a tooltip, so it mirrors the caption.
  const title = options.text.trim() === '' ? `${width} × ${height}` : options.text;

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" ' +
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    'role="img" ' +
    `aria-label="${escapeXml(title)}">\n` +
    `  <title>${escapeXml(title)}</title>\n` +
    patternDefs(options) +
    body +
    '</svg>\n'
  );
}

/**
 * Percent-encodes an SVG document for a `data:` URL.
 *
 * `encodeURIComponent` is the right encoder here, and the reason is worth
 * stating because the naive alternatives are subtly broken:
 *
 *   - Leaving the SVG as-is produces a URL where `#` starts a fragment. The very
 *     first colour, `#e8eef6`, would silently truncate the document — the image
 *     still loads (the SVG parser recovers) but everything after the `#` is
 *     gone.
 *   - `encodeURI` does not escape `#` either, so it has the same fault.
 *   - Base64 (`btoa`) cannot encode non-ASCII text such as Chinese captions
 *     without a manual UTF-8 pre-pass, and it triples the length of a markup
 *     document that is mostly punctuation and ASCII keywords.
 *
 * Percent-encoding is UTF-8 by definition (`encodeURIComponent` emits the UTF-8
 * bytes as `%XX`), so multi-byte text needs no special handling.
 */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Convenience wrapper: options in, both outputs out. */
export function generatePlaceholder(rawOptions: PlaceholderOptions): {
  svg: string;
  dataUrl: string;
  byteLength: number;
} {
  const svg = buildPlaceholderSvg(rawOptions);
  return { svg, dataUrl: svgToDataUrl(svg), byteLength: utf8ByteLength(svg) };
}

/**
 * The unescaped string concatenation a first implementation would write.
 *
 * It exists so the checks can demonstrate the *bug* rather than assert a
 * property in the abstract: `naiveSvg` with an injection-shaped caption produces
 * a document containing a real `<script>` element, which the parser confirms.
 * Nothing in the app calls this.
 */
export function naiveSvgForComparison(caption: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>${caption}</text></svg>`;
}
