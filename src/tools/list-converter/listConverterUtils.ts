/**
 * Conversion between the common ways of writing a flat list of strings.
 *
 * Formats handled, each with its own escaping rules:
 *
 *   lines / comma / semicolon / space / tab  plain text separators
 *   json                                     JSON array, escaped by JSON rules
 *   sql                                      SQL `IN` list, quotes doubled
 *   markdown / ordered                       Markdown bullet and numbered lists
 *   html                                     `<ul>` / `<ol>` with entities
 *   yaml                                     block sequence, YAML scalars
 *
 * The escaping is the point of the tool. Joining items with a comma is not a
 * reversible operation once an item contains a comma, and the same is true of
 * every other format: without quoting (text formats), doubling (SQL), JSON
 * escaping, HTML entities or YAML quoting, a list can be silently mangled. The
 * check script implements the naive versions and asserts that they lose data.
 *
 * YAML is the one format parsed by a library instead of by hand. Folding,
 * implicit typing and quoting rules are exactly the corner cases a hand-rolled
 * reader gets subtly wrong, and the `yaml` package is already a dependency of
 * this app (the YAML <-> JSON tool uses it).
 *
 * Everything here is pure: no React, no DOM, no clock.
 */
import { parse as parseYamlDocument } from 'yaml';

export type ListFormat =
  | 'lines'
  | 'comma'
  | 'semicolon'
  | 'space'
  | 'tab'
  | 'json'
  | 'sql'
  | 'markdown'
  | 'ordered'
  | 'html'
  | 'yaml';

export interface NormalizeOptions {
  /** Trim leading and trailing whitespace of every item. */
  trim: boolean;
  /** Drop items that are empty after trimming. */
  dropEmpty: boolean;
  /** Keep the first occurrence of each item. */
  dedupe: boolean;
  /** Sort with a locale-aware, numeric-aware comparison. */
  sort: boolean;
}

export interface SerializeOptions {
  /**
   * `string` quotes every SQL value; `auto` leaves values that look like
   * numbers bare, which is what `IN (1, 2, 3)` normally looks like.
   */
  sqlQuoting: 'string' | 'auto';
  /** Emit `<ol>` instead of `<ul>`. */
  htmlOrdered: boolean;
  /** JSON indentation; 0 produces a single line. */
  indent: number;
}

export interface ParseResult {
  items: string[];
  error: string | null;
}

/** Delimiter for each plain-text separated format. */
export const FORMAT_DELIMITER: Partial<Record<ListFormat, string>> = {
  comma: ',',
  semicolon: ';',
  space: ' ',
  tab: '\t',
};

const DEFAULT_OPTIONS: SerializeOptions = {
  sqlQuoting: 'string',
  htmlOrdered: false,
  indent: 0,
};

// ---------------------------------------------------------------------------
// Plain-text separated formats
// ---------------------------------------------------------------------------

/**
 * Splits a delimited list.
 *
 * Quoted fields are taken verbatim; unquoted fields are trimmed and empty ones
 * are dropped. Trimming is safe because the generator quotes anything with
 * leading or trailing whitespace, so an item that must keep its spaces is never
 * left bare. Empty unquoted fields are dropped for the same reason: `a,,b` and
 * `a, ,b` are both just "a and b" in a hand-written list, while a genuinely
 * empty item is written `""` and survives.
 */
export function parseDelimitedList(text: string, delimiter: string): ParseResult {
  const items: string[] = [];
  let field = '';
  let quoted = false;
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    const value = quoted ? field : field.trim();
    if (quoted || value !== '') items.push(value);
    field = '';
    quoted = false;
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      quoted = true;
      i += 1;
      continue;
    }
    // A line break separates items as well, so a column pasted from a
    // spreadsheet works without switching format.
    if (ch === delimiter || ch === '\n' || ch === '\r') {
      endField();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (inQuotes) return { items: [], error: '有一个双引号没有闭合。' };
  endField();
  return { items, error: null };
}

/**
 * Quotes an item when the delimiter or the surrounding whitespace would
 * otherwise eat it. Doubling the quote is the only escape the text formats have.
 */
export function encodeDelimitedItem(item: string, delimiter: string): string {
  const needsQuotes =
    item === '' ||
    item.includes(delimiter) ||
    item.includes('"') ||
    item.includes('\n') ||
    item.includes('\r') ||
    item.trim() !== item;
  if (!needsQuotes) return item;
  return `"${item.replace(/"/g, '""')}"`;
}

export function serializeDelimitedList(items: string[], delimiter: string): string {
  return items.map((item) => encodeDelimitedItem(item, delimiter)).join(delimiter);
}

/** One item per line. The format has no quoting, so it cannot hold a newline. */
export function linesToItems(text: string): ParseResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // Trailing line breaks are terminators, not empty items; an empty item at the
  // very end is therefore not representable (there is no escape to mark it).
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return { items: lines, error: null };
}

export function itemsToLines(items: string[]): string {
  return items.join('\n');
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** Serialises to a JSON array; `JSON.stringify` is the authority on escaping. */
export function itemsToJson(items: string[], indent: number): string {
  return JSON.stringify(items, null, indent > 0 ? indent : 0);
}

export function jsonToItems(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return {
      items: [],
      error: `JSON 解析失败：${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  if (!Array.isArray(parsed)) return { items: [], error: 'JSON 顶层不是数组。' };

  const items: string[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const value = parsed[index];
    if (value === null || value === undefined) {
      items.push('');
    } else if (typeof value === 'string') {
      items.push(value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      items.push(String(value));
    } else {
      return { items: [], error: `第 ${index + 1} 项是对象或数组，不能当作列表项。` };
    }
  }
  return { items, error: null };
}

// ---------------------------------------------------------------------------
// SQL IN lists
// ---------------------------------------------------------------------------

/**
 * A value that can be written without quotes in SQL.
 *
 * Only plain decimal literals are accepted. Hex (`0x1f`), octal, `TRUE` and
 * function-looking text are all left quoted, because whether they are valid
 * without quotes depends on the dialect and the column type.
 */
export function isNumericLiteral(item: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(item);
}

/**
 * Escapes a SQL string literal.
 *
 * The SQL standard (and SQLite, PostgreSQL and Oracle) escapes a single quote by
 * doubling it. Backslash escaping is a MySQL extension and is not portable, so
 * the tool does not use it — the check asserts that SQLite rejects the
 * backslash form and accepts this one.
 */
export function escapeSqlString(item: string): string {
  return `'${item.replace(/'/g, "''")}'`;
}

export function itemsToSql(items: string[], quoting: SerializeOptions['sqlQuoting']): string {
  const parts = items.map((item) =>
    quoting === 'auto' && isNumericLiteral(item) ? item : escapeSqlString(item),
  );
  return `(${parts.join(', ')})`;
}

export function sqlToItems(text: string): ParseResult {
  const trimmed = text.trim();
  // Accept the whole `IN (...)` fragment, the parenthesised list, or just the
  // values. All three are pasted in practice.
  const parenthesised = /^(?:in\s*)?\(([\s\S]*)\)\s*;?$/i.exec(trimmed);
  const inner = parenthesised ? parenthesised[1] : trimmed;

  const items: string[] = [];
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === ',' || /\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let value = '';
      let closed = false;
      while (j < inner.length) {
        if (inner[j] === "'") {
          if (inner[j + 1] === "'") {
            value += "'";
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        value += inner[j];
        j += 1;
      }
      if (!closed) return { items: [], error: '有一个 SQL 字符串字面量没有闭合。' };
      items.push(value);
      i = j;
      continue;
    }
    // An unquoted token (a number, or a bare word someone pasted).
    let j = i;
    while (j < inner.length && inner[j] !== ',') j += 1;
    const token = inner.slice(i, j).trim();
    if (token !== '') items.push(token);
    i = j;
  }
  return { items, error: null };
}

// ---------------------------------------------------------------------------
// Markdown bullet / ordered lists
// ---------------------------------------------------------------------------

/**
 * Renders a block list.
 *
 * A multi-line item becomes a marker line plus continuation lines indented by
 * the marker's own width, which is how Markdown itself represents a paragraph
 * that continues an item. An empty item is written as a bare marker (`-`, `1.`)
 * rather than `- ` so it does not end in trailing whitespace.
 */
function blockListToText(items: string[], prefixFor: (index: number) => string): string {
  return items
    .map((item, index) => {
      const prefix = prefixFor(index);
      const indent = ' '.repeat(prefix.length);
      const lines = item.split('\n');
      const head = lines[0];
      const marker = head === '' ? prefix.trimEnd() : prefix + head;
      const rest = lines.slice(1).map((line) => indent + line);
      return [marker, ...rest].join('\n');
    })
    .join('\n');
}

export function itemsToMarkdownList(items: string[]): string {
  return blockListToText(items, () => '- ');
}

export function itemsToOrderedList(items: string[]): string {
  return blockListToText(items, (index) => `${index + 1}. `);
}

/**
 * Reads a Markdown-style block list.
 *
 * Indented lines always continue the current item, never start a new one: an
 * item whose own text begins with `- ` or `1. ` is written indented by the
 * generator, and treating that as a nested list would split it in two. Before
 * the first marker every non-blank line is taken as its own item, so pasting a
 * plain list after selecting this format still does something sensible.
 */
function blockListFromText(text: string, ordered: boolean): ParseResult {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const lines = normalized.split('\n');
  const items: string[] = [];
  let current: string | null = null;
  let markerWidth = ordered ? 3 : 2;
  let sawMarker = false;

  for (const line of lines) {
    const indented = /^[ \t]/.test(line);
    if (current !== null && indented) {
      const leading = line.length - line.trimStart().length;
      current += `\n${line.slice(Math.min(leading, markerWidth))}`;
      continue;
    }

    const match = ordered
      ? /^\s{0,3}(\d{1,9})([.)])(?:[ \t](.*))?$/.exec(line)
      : /^\s{0,3}([-*+])(?:[ \t](.*))?$/.exec(line);

    if (match) {
      if (current !== null) items.push(current);
      const indent = line.length - line.trimStart().length;
      const marker = ordered ? `${match[1]}${match[2]}` : match[1];
      markerWidth = indent + marker.length + 1;
      current = (ordered ? match[3] : match[2]) ?? '';
      sawMarker = true;
      continue;
    }

    if (!sawMarker) {
      if (line.trim() !== '') items.push(line);
      continue;
    }
    // An unindented line after a marker is a lazy continuation.
    current = current === null ? line : `${current}\n${line}`;
  }

  if (current !== null) items.push(current);
  return { items, error: null };
}

export function markdownListToItems(text: string): ParseResult {
  return blockListFromText(text, false);
}

export function orderedListToItems(text: string): ParseResult {
  return blockListFromText(text, true);
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

/**
 * Escapes text for an HTML text node.
 *
 * `&` has to go through the same pass as everything else. Escaping `<` first
 * and `&` afterwards would turn `&lt;` into `&amp;lt;`, which renders as the
 * literal `&lt;` — the classic double-escaping bug, demonstrated in the check.
 * `\r` becomes a numeric reference so the parser's input preprocessing (which
 * normalises CR and CRLF to LF) cannot change it; `\n` is left as-is, because a
 * newline in a text node is a newline in the DOM.
 */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '\r': '&#13;',
};

export function escapeHtmlText(text: string): string {
  return text.replace(/[&<>"'\r]/g, (char) => HTML_ESCAPES[char]);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

function isCodePoint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff;
}

/**
 * Decodes HTML character references in a single pass.
 *
 * One pass matters: decoding `&amp;` first and then re-scanning the result would
 * turn `&amp;lt;` into `<` instead of `&lt;`. Unknown entity names are kept
 * verbatim rather than dropped.
 */
export function unescapeHtmlText(text: string): string {
  return text.replace(
    /&(?:#([0-9]+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g,
    (whole, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (decimal !== undefined) {
        const value = Number(decimal);
        return isCodePoint(value) ? String.fromCodePoint(value) : whole;
      }
      if (hex !== undefined) {
        const value = Number.parseInt(hex, 16);
        return isCodePoint(value) ? String.fromCodePoint(value) : whole;
      }
      const key = name ?? '';
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key)
        ? NAMED_ENTITIES[key]
        : whole;
    },
  );
}

export function itemsToHtmlList(items: string[], ordered: boolean): string {
  const tag = ordered ? 'ol' : 'ul';
  if (items.length === 0) return `<${tag}>\n</${tag}>`;
  const body = items.map((item) => `<li>${escapeHtmlText(item)}</li>`).join('\n');
  return `<${tag}>\n${body}\n</${tag}>`;
}

/**
 * Extracts the items from an HTML list.
 *
 * An `</li>` is optional in HTML, so the content of an item runs until the next
 * `<li>`, the closing list tag or the end of the input. Inner markup is dropped
 * and character references are decoded one pass, which is what a browser's text
 * content of the item would be.
 */
export function htmlListToItems(text: string): ParseResult {
  const itemPattern = /<li\b[^>]*>([\s\S]*?)(?=<\/li\s*>|<li\b|<\/ul\s*>|<\/ol\s*>|$)/gi;
  const items: string[] = [];
  let match = itemPattern.exec(text);
  while (match !== null) {
    const content = match[1].replace(/<[^>]*>/g, '');
    items.push(unescapeHtmlText(content));
    // A zero-length match would loop forever on input like `<li></li>`.
    if (itemPattern.lastIndex === match.index) itemPattern.lastIndex += 1;
    match = itemPattern.exec(text);
  }
  return { items, error: null };
}

// ---------------------------------------------------------------------------
// YAML block sequences
// ---------------------------------------------------------------------------

/**
 * Whether a scalar can be written unquoted in a YAML block sequence.
 *
 * Conservative on purpose. A plain scalar must not look like a number, a
 * boolean, a null, a date, a hex literal, a mapping key or a comment, and it
 * must not begin with whitespace or an indicator character. Anything uncertain
 * is double-quoted instead, which is always safe and still valid YAML.
 */
export function isPlainSafeYamlScalar(value: string): boolean {
  if (value === '') return false;
  if (value.trim() !== value) return false;
  // Line breaks of any flavour would fold or split the scalar.
  if (/[\n\r\t\u0085\u2028\u2029]/.test(value)) return false;
  // Starting with a digit or punctuation is where implicit typing lives.
  if (!/^[A-Za-z\u00a1-\uffff]/.test(value)) return false;
  // A colon can start a mapping, a hash can start a comment.
  if (value.includes(':') || value.includes('#')) return false;
  if (/^(?:true|false|null|yes|no|on|off|y|n|nan|inf)$/i.test(value)) return false;
  // A lone surrogate is not a character; it can only be written as an escape,
  // and even then a YAML parser is not obliged to accept it.
  if (hasLoneSurrogate(value)) return false;
  return true;
}

function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
        continue;
      }
      return true;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

/** Double-quoted YAML scalars accept JSON's escape sequences. */
export function yamlScalar(value: string): string {
  return isPlainSafeYamlScalar(value) ? value : JSON.stringify(value);
}

export function itemsToYamlList(items: string[]): string {
  return items.map((item) => `- ${yamlScalar(item)}`).join('\n');
}

export function yamlListToItems(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = parseYamlDocument(text);
  } catch (cause) {
    return {
      items: [],
      error: `YAML 解析失败：${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  if (parsed === null || parsed === undefined) return { items: [], error: null };
  if (!Array.isArray(parsed)) {
    return { items: [], error: 'YAML 顶层不是列表（需要 - item 形式的块序列）。' };
  }
  const items: string[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const value = parsed[index];
    if (value === null || value === undefined) {
      items.push('');
    } else if (typeof value === 'object') {
      return { items: [], error: `第 ${index + 1} 项是嵌套结构，不能当作纯文本列表项。` };
    } else {
      items.push(String(value));
    }
  }
  return { items, error: null };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Parses any supported format into a flat list. */
export function parseList(text: string, format: ListFormat): ParseResult {
  const delimiter = FORMAT_DELIMITER[format];
  if (delimiter !== undefined) return parseDelimitedList(text, delimiter);
  switch (format) {
    case 'lines':
      return linesToItems(text);
    case 'json':
      return jsonToItems(text);
    case 'sql':
      return sqlToItems(text);
    case 'markdown':
      return markdownListToItems(text);
    case 'ordered':
      return orderedListToItems(text);
    case 'html':
      return htmlListToItems(text);
    case 'yaml':
      return yamlListToItems(text);
    default:
      return { items: [], error: null };
  }
}

/** Renders a flat list in any supported format. */
export function serializeList(
  items: string[],
  format: ListFormat,
  options: SerializeOptions = DEFAULT_OPTIONS,
): string {
  const delimiter = FORMAT_DELIMITER[format];
  if (delimiter !== undefined) return serializeDelimitedList(items, delimiter);
  switch (format) {
    case 'lines':
      return itemsToLines(items);
    case 'json':
      return itemsToJson(items, options.indent);
    case 'sql':
      return itemsToSql(items, options.sqlQuoting);
    case 'markdown':
      return itemsToMarkdownList(items);
    case 'ordered':
      return itemsToOrderedList(items);
    case 'html':
      return itemsToHtmlList(items, options.htmlOrdered);
    case 'yaml':
      return itemsToYamlList(items);
    default:
      return '';
  }
}

/** Applies the optional clean-up steps, in a fixed order. */
export function normalizeItems(items: string[], options: NormalizeOptions): string[] {
  let out = items;
  if (options.trim) out = out.map((item) => item.trim());
  if (options.dropEmpty) out = out.filter((item) => item !== '');
  if (options.dedupe) {
    const seen = new Set<string>();
    out = out.filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
  }
  if (options.sort) {
    out = out.slice().sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }));
  }
  return out;
}

/**
 * Guesses the input format.
 *
 * Structured formats are checked before separators because a JSON array or an
 * HTML list also contains commas and spaces. Markdown and YAML are
 * indistinguishable at this level (both are `- item`), so Markdown is reported;
 * the two parsers accept each other's output for plain scalars.
 */
export function detectFormat(text: string): ListFormat {
  const trimmed = text.trim();
  if (trimmed === '') return 'lines';

  if (/^[[{]/.test(trimmed)) {
    try {
      const value: unknown = JSON.parse(trimmed);
      if (Array.isArray(value)) return 'json';
    } catch {
      // Not JSON; fall through to the other shapes.
    }
  }
  if (/^(?:in\s*)?\(/i.test(trimmed) && /\)\s*;?$/.test(trimmed)) return 'sql';
  if (/<li\b/i.test(text)) return 'html';

  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  if (lines.some((line) => /^\d{1,9}[.)](?:[ \t]|$)/.test(line))) return 'ordered';
  if (lines.some((line) => /^[-*+](?:[ \t]|$)/.test(line))) return 'markdown';
  if (text.includes('\t')) return 'tab';
  if (text.includes(';')) return 'semicolon';
  if (text.includes(',')) return 'comma';
  // Only a real space or tab counts: splitting on newlines would make every
  // multi-line list look space-separated.
  if (/[ \t]/.test(trimmed) && trimmed.split(/\s+/).length > 1) return 'space';
  return 'lines';
}
