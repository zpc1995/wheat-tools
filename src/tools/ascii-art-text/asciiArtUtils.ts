/**
 * FIGlet-style text rendering, built on the repo's own copy of the classic
 * `standard` face.
 *
 * ## What this deliberately is not
 *
 * Full FIGlet resolves each pair of neighbouring glyphs with "kerning" and
 * "smushing": overlapping their columns when the characters allow it, so the
 * output is narrower and letters visually interlock. That is a nontrivial
 * algorithm with a long tail of rules (old layout flags, hardblanks, universal
 * smushing), and reproducing it here would be both a large amount of code and a
 * large amount of risk for a text utility.
 *
 * This module lays glyphs out side by side with a fixed, explicit letter
 * spacing instead. The output is FIGlet's artwork with predictable columns:
 * every character occupies exactly its own glyph width plus the spacing, which
 * is what makes the width arithmetic below checkable. The UI says so.
 *
 * ## Pure logic
 *
 * No React, no DOM, no clocks. Everything the renderer needs is passed in, so
 * `scripts/check-ascii-art-text.mjs` can exercise it in plain Node.
 */

import {
  FONT_FIRST_CODE,
  FONT_GLYPHS,
  FONT_HEIGHT,
  FONT_LAST_CODE,
  FONT_WIDTHS,
} from './figletStandardFont';

/**
 * Re-exported so the component has a single place to import the renderer's
 * public surface from; the font module itself is an implementation detail of
 * the renderer.
 */
export { FONT_HEIGHT } from './figletStandardFont';

/** Human-readable name of the single built-in face, shown in the UI. */
export const FONT_LABEL = 'Standard（FIGlet 标准体）';

/** Column range the built-in face covers: printable ASCII, space included. */
export const SUPPORTED_RANGE = `U+${FONT_FIRST_CODE.toString(16).toUpperCase().padStart(4, '0')}–U+${FONT_LAST_CODE
  .toString(16)
  .toUpperCase()
  .padStart(4, '0')}`;

/**
 * Cap on rendered input, in characters.
 *
 * The renderer is linear, so nothing here is slow; the cap is about the output.
 * Six rows of 8-column glyphs per character means 200 characters already
 * produce rows around 1600 columns wide, which is past the point where the
 * result can be read or pasted anywhere useful. The UI reports the truncation
 * instead of quietly dropping the tail.
 */
export const MAX_INPUT_CHARS = 200;

/** Cap on input lines, for the same reason: 20 lines is already 120 rows. */
export const MAX_INPUT_LINES = 20;

/** Largest accepted letter spacing. Beyond a few columns the text falls apart. */
export const MAX_SPACING = 6;

/** Upper bound on the alignment canvas, so a typo cannot allocate 10^9 columns. */
export const MAX_CANVAS_WIDTH = 500;

export type ArtAlign = 'left' | 'center' | 'right';

export interface ArtOptions {
  /** Blank columns inserted between adjacent glyphs. Defaults to 1. */
  spacing?: number;
  /** Where the block sits inside `width`. Defaults to `left`. */
  align?: ArtAlign;
  /** Character used to fill the canvas. Defaults to a space. */
  padChar?: string;
  /** Canvas width; `null` (the default) means "as wide as the artwork". */
  width?: number | null;
}

export interface ArtResult {
  /** The rendered block, one entry per output row. */
  lines: string[];
  /**
   * Width of the natural artwork — every glyph row of an input line shares it
   * by construction. Equal to the longest `lines` entry when padding is off.
   */
  artWidth: number;
  /** Length of the longest output row, after padding. */
  width: number;
  /** Distinct characters outside the font, in first-seen order. */
  unsupported: string[];
  /** Input was cut at the length or line cap. */
  truncated: boolean;
  /** The artwork is wider than the requested canvas; it was not cut. */
  overflow: boolean;
}

/** One glyph as the renderer needs it: padded rows plus the column width. */
export interface Glyph {
  rows: string[];
  width: number;
}

/**
 * Looks up a glyph by character.
 *
 * Returns `null` for anything outside the face rather than substituting a
 * placeholder: the caller decides how to report the omission, and a silent
 * "?" box would make a Chinese title render as plausible-looking garbage.
 */
export function getGlyph(character: string): Glyph | null {
  // Only the first code point is considered; a caller passing a surrogate pair
  // gets `null` unless some future face covers it.
  const code = character.codePointAt(0);
  if (code === undefined || code < FONT_FIRST_CODE || code > FONT_LAST_CODE) return null;
  // A lone surrogate or a combining mark must not be treated as the base char.
  if (character.length !== 1) return null;

  const index = code - FONT_FIRST_CODE;
  const width = FONT_WIDTHS[index];
  const rows = FONT_GLYPHS[index];
  if (!rows || typeof width !== 'number') return null;

  // The stored rows are right-trimmed; padding them back to the recorded width
  // restores exactly the columns FIGlet's font file carries.
  return { width, rows: rows.map((row) => row.padEnd(width, ' ')) };
}

/** Every character the built-in face can draw, in code-point order. */
export function supportedCharacters(): string[] {
  const out: string[] = [];
  for (let code = FONT_FIRST_CODE; code <= FONT_LAST_CODE; code += 1) {
    out.push(String.fromCodePoint(code));
  }
  return out;
}

/**
 * Characters of `text` that cannot be drawn, de-duplicated, in first-seen
 * order.
 *
 * Tabs are not reported: they are expanded to a single space by
 * `renderLine`, because a tab in pasted text is a layout accident rather than a
 * character the user wants drawn.
 */
export function unsupportedCharacters(text: string): string[] {
  const seen = new Set<string>();
  for (const char of text) {
    if (char === '\n' || char === '\r' || char === '\t') continue;
    if (getGlyph(char) === null) seen.add(char);
  }
  return [...seen];
}

/** Clamps the spacing option, tolerating `undefined`, NaN and negatives. */
function normaliseSpacing(spacing: number | undefined): number {
  if (typeof spacing !== 'number' || !Number.isFinite(spacing)) return 1;
  return Math.min(MAX_SPACING, Math.max(0, Math.trunc(spacing)));
}

/**
 * Resolves the fill character.
 *
 * Only a single UTF-16 code unit is accepted. An emoji or any other astral
 * character is two units wide and would make one padded row two columns wider
 * than the next, which is exactly the misalignment the whole renderer exists to
 * avoid; those fall back to a space instead.
 */
function normalisePadChar(padChar: string | undefined): string {
  if (typeof padChar !== 'string') return ' ';
  const first = [...padChar][0];
  if (first === undefined || first.length !== 1) return ' ';
  return first;
}

/** Resolves the canvas width: `null`/absent means no padding, junk is ignored. */
function normaliseWidth(width: number | null | undefined): number | null {
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 1) return null;
  return Math.min(MAX_CANVAS_WIDTH, Math.trunc(width));
}

/** Resolves the alignment, falling back to left for anything unrecognised. */
function normaliseAlign(align: ArtAlign | undefined): ArtAlign {
  return align === 'center' || align === 'right' ? align : 'left';
}

/**
 * Renders one input line to exactly {@link FONT_HEIGHT} rows.
 *
 * Every returned row has the same length, `glyphWidths + spacing * (n - 1)`.
 * That equality is the whole point of the function: if any glyph had a
 * different number of rows, or a row of a different width, the rows below it
 * would shear sideways and the artwork would be unreadable. The check script
 * asserts it for every supported character and for mixed strings.
 *
 * Undrawable characters are dropped rather than replaced, so the caller can
 * surface them through `unsupportedCharacters`.
 */
export function renderLine(line: string, spacing = 1): string[] {
  const gap = normaliseSpacing(spacing);
  const glyphs: Glyph[] = [];
  for (const char of line) {
    // A tab is whitespace the user cannot see; drawing nothing for it would
    // silently glue two words together, so it becomes a space glyph.
    const glyph = getGlyph(char === '\t' ? ' ' : char);
    if (glyph) glyphs.push(glyph);
  }

  if (glyphs.length === 0) {
    // An empty input line still occupies its rows. Keeping the height uniform
    // is what makes "output rows = input lines * FONT_HEIGHT" hold for every
    // input, including blank lines in the middle of a paragraph.
    return Array.from({ length: FONT_HEIGHT }, () => '');
  }

  const separator = ' '.repeat(gap);
  const rows: string[] = [];
  for (let row = 0; row < FONT_HEIGHT; row += 1) {
    // Every glyph row was padded to its own width in `getGlyph`, so joining
    // them lines the columns up exactly.
    rows.push(glyphs.map((glyph) => glyph.rows[row]).join(separator));
  }
  return rows;
}

/** Applies the alignment canvas to one row. */
function padRow(row: string, width: number, align: ArtAlign, padChar: string): string {
  const missing = width - row.length;
  if (missing <= 0) return row;
  if (align === 'right') return padChar.repeat(missing) + row;
  if (align === 'center') {
    const left = Math.floor(missing / 2);
    return padChar.repeat(left) + row + padChar.repeat(missing - left);
  }
  return row + padChar.repeat(missing);
}

/**
 * Splits input into lines and applies the length/line caps.
 *
 * Exported because the caps are a contract the UI reports to the user, and a
 * cap that only exists inside the renderer is hard to test.
 */
export function clampInput(text: string): { lines: string[]; truncated: boolean } {
  const normalised = text.replace(/\r\n?/g, '\n');
  const capped = normalised.slice(0, MAX_INPUT_CHARS);
  const lengthTruncated = capped.length < normalised.length;

  const split = capped.split('\n');
  const lines = split.slice(0, MAX_INPUT_LINES);
  return { lines, truncated: lengthTruncated || lines.length < split.length };
}

/**
 * Renders `text` as FIGlet-style ASCII art.
 *
 * The empty string produces no output at all, which is different from a string
 * that merely contains newlines: `""` has nothing to draw, while `"\n"` is two
 * (blank) lines and yields two blocks. Both behaviours are asserted.
 */
export function renderAsciiArt(text: string, options: ArtOptions = {}): ArtResult {
  const spacing = normaliseSpacing(options.spacing);
  const align = normaliseAlign(options.align);
  const padChar = normalisePadChar(options.padChar);
  const width = normaliseWidth(options.width);
  const unsupported = unsupportedCharacters(text);

  if (text === '') {
    return { lines: [], artWidth: 0, width: 0, unsupported, truncated: false, overflow: false };
  }

  const { lines: inputLines, truncated } = clampInput(text);

  const rows: string[] = [];
  let artWidth = 0;
  for (const line of inputLines) {
    const rendered = renderLine(line, spacing);
    for (const row of rendered) {
      artWidth = Math.max(artWidth, row.length);
      rows.push(row);
    }
  }

  // Trailing blanks are dropped from every row. They are invisible in a
  // monospace font, so trimming changes nothing on screen, and it keeps pasted
  // output free of trailing whitespace that linters and editors would flag.
  const trimmed = rows.map((row) => row.replace(/ +$/, ''));

  const canvas = width === null ? null : Math.max(width, artWidth);
  const overflow = width !== null && width < artWidth;
  const padded = canvas === null ? trimmed : trimmed.map((row) => padRow(row, canvas, align, padChar));

  return {
    lines: padded,
    artWidth,
    width: padded.reduce((max, row) => Math.max(max, row.length), 0),
    unsupported,
    truncated,
    overflow,
  };
}

/** Joins a result into the single string the copy button puts on the clipboard. */
export function artToText(result: ArtResult): string {
  return result.lines.join('\n');
}

/** Counts output rows without building the strings, for the UI's counters. */
export function outputRowCount(lineCount: number): number {
  return lineCount * FONT_HEIGHT;
}
