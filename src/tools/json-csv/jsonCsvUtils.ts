/**
 * CSV parsing / generation and the JSON <-> CSV conversions behind the tool.
 *
 * The CSV side follows RFC 4180 (the format Excel writes):
 *
 *   - records are separated by CRLF (LF is accepted on input, and a lone CR too)
 *   - fields are separated by a comma (other delimiters are supported)
 *   - a field containing a delimiter, a quote or a line break must be wrapped
 *     in double quotes
 *   - a double quote inside a quoted field is written twice
 *
 * The parser is a small state machine rather than `split(',')` because the
 * naive split is simply wrong for valid CSV — see the round-trip section of
 * `scripts/check-json-csv.mjs`, which asserts that the naive version breaks.
 *
 * Everything here is pure: no React, no DOM, no clock.
 */

/** Field separators offered by the UI. Tab is the TSV case. */
export type CsvDelimiter = ',' | '\t' | ';' | '|';

/** Record separator used when generating. RFC 4180 mandates CRLF; Excel likes it. */
export type LineEnding = 'lf' | 'crlf';

/**
 * What to do with a nested object or array found in a JSON record.
 *
 * `flatten` turns nested objects into dotted columns (`user.name`); arrays are
 * written as JSON text because an index path (`tags.0`) collides with a real
 * key named `0` and the header union across rows would be a different width per
 * row. `json` keeps every non-primitive as its JSON text.
 */
export type NestedMode = 'flatten' | 'json';

export interface CsvParseOptions {
  delimiter: CsvDelimiter;
  /**
   * Remove a leading U+FEFF. Excel writes one when saving "CSV UTF-8", and it is
   * a byte-order mark rather than data, so it is stripped by default. Without
   * this the first header cell would read `\uFEFFid` and never match `id`.
   */
  stripBom?: boolean;
}

export interface CsvParseResult {
  rows: string[][];
  /** Human-readable problem with the input, or null when it parsed. */
  error: string | null;
}

export interface CsvSerializeOptions {
  delimiter: CsvDelimiter;
  lineEnding: LineEnding;
  /** Prepend U+FEFF so Excel detects UTF-8 instead of the local code page. */
  bom?: boolean;
  /** Terminate the last record as well. Off by default, RFC 4180 allows both. */
  trailingNewline?: boolean;
}

export interface JsonToCsvOptions extends CsvSerializeOptions {
  hasHeader: boolean;
  nested: NestedMode;
}

export interface CsvToJsonOptions {
  delimiter: CsvDelimiter;
  hasHeader: boolean;
  /** Indentation passed to JSON.stringify; 0 produces a single line. */
  indent: number;
}

export interface ConversionResult {
  /** Produced text; empty when `error` is set. */
  text: string;
  error: string | null;
  /** Column names detected while converting JSON to CSV (empty otherwise). */
  columns: string[];
  /** Data rows, not counting a generated header row. */
  rowCount: number;
}

export const LINE_ENDING_TEXT: Record<LineEnding, string> = {
  lf: '\n',
  crlf: '\r\n',
};

/** Column name given to a primitive record — `[1, 2]` becomes a single column. */
export const VALUE_COLUMN = 'value';

/**
 * Parses CSV text into rows of raw strings.
 *
 * An empty line is a record with **zero** fields rather than one empty field.
 * That is what CPython's csv module does, and it is the representation that
 * makes a blank line distinguishable from a single empty field: the generator
 * writes the latter as `""` (also what CPython does) so the two cannot collapse
 * into each other on the way back.
 *
 * Deliberate leniencies, matching what Excel and the common parsers accept:
 * a quote in the middle of an unquoted field is literal, and text after a
 * closing quote (`"a"b`) is appended. Refusing those would reject files that
 * every other tool opens.
 */
export function parseCsv(text: string, options: CsvParseOptions): CsvParseResult {
  const delimiter = options.delimiter;
  const stripBom = options.stripBom !== false;
  const input = stripBom && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // Whether anything at all has been seen for the record being read. Without
  // this, `""` (one quoted empty field) is indistinguishable from an empty
  // file, and an empty file would wrongly produce one empty cell.
  let started = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      // Inside quotes everything is data, including delimiters and CR/LF.
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true;
      started = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      started = true;
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (started) row.push(field);
      rows.push(row);
      row = [];
      field = '';
      started = false;
      // A CRLF pair is one record separator, not two.
      i += ch === '\r' && input[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    started = true;
    i += 1;
  }

  if (inQuotes) {
    return { rows: [], error: '输入在引号内结束：有一个双引号没有闭合。' };
  }

  // The final record only exists when the file did not end with a separator;
  // `a,b\n` is one record, `a,b` is also one record.
  if (started) {
    row.push(field);
    rows.push(row);
  }

  return { rows, error: null };
}

/**
 * Quotes a field only when it has to be quoted.
 *
 * The surrounding quotes are the part the naive version forgets: escaping the
 * inner quotes without wrapping the field still produces text that splits at
 * the delimiter. The check script asserts both halves of that failure.
 */
export function encodeCsvField(field: string, delimiter: CsvDelimiter): string {
  const needsQuotes =
    field.includes(delimiter) ||
    field.includes('"') ||
    field.includes('\n') ||
    field.includes('\r');
  if (!needsQuotes) return field;
  // Doubling is the only escape RFC 4180 defines for a quote.
  return `"${field.replace(/"/g, '""')}"`;
}

/**
 * Generates CSV text.
 *
 * Two details exist purely so that parsing the result gives back exactly the
 * rows that went in:
 *
 *   - a record whose only field is empty is written `""`. Without the quotes it
 *     would be a zero-length line, which the parser (correctly) reads as a
 *     record with zero fields — CPython's csv module makes the same choice.
 *   - a trailing record with zero fields needs a terminator of its own, since
 *     the separator before it is also the terminator of the previous record.
 *
 * Leading and trailing spaces are left unquoted on purpose: RFC 4180 treats
 * them as part of the field, and quoting them would be noise. They survive the
 * round trip because the parser does not trim unquoted fields either.
 */
export function serializeCsv(rows: string[][], options: CsvSerializeOptions): string {
  const ending = LINE_ENDING_TEXT[options.lineEnding];
  const body = rows
    .map((row) =>
      row
        .map((field) =>
          // One empty field is ambiguous with a blank line; quote it.
          row.length === 1 && field === '' ? '""' : encodeCsvField(field, options.delimiter),
        )
        .join(options.delimiter),
    )
    .join(ending);

  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
  const needsOwnTerminator = lastRow !== null && lastRow.length === 0;
  let text = needsOwnTerminator ? body + ending : body;
  if (options.trailingNewline && text !== '') text += ending;
  return options.bom ? `\uFEFF${text}` : text;
}

/** Renders one JSON value as a CSV cell. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value) ?? '';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function flattenInto(
  target: Record<string, string>,
  prefix: string,
  value: unknown,
  mode: NestedMode,
): void {
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    // An empty object has no leaves; writing `{}` keeps the column visible.
    if (mode === 'json' || entries.length === 0) {
      target[prefix] = cellText(value);
      return;
    }
    for (const [key, nested] of entries) {
      flattenInto(target, `${prefix}.${key}`, nested, mode);
    }
    return;
  }
  target[prefix] = cellText(value);
}

/** Turns one JSON record into a flat key -> cell map. */
function flattenRecord(value: unknown, mode: NestedMode): Record<string, string> {
  const out: Record<string, string> = {};
  if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      flattenInto(out, key, nested, mode);
    }
    return out;
  }
  out[VALUE_COLUMN] = cellText(value);
  return out;
}

/**
 * Union of keys across all records, in first-seen order.
 *
 * The union (rather than the first record's keys) is the whole point: JSON
 * arrays of objects are frequently ragged, and a missing key must become an
 * empty cell rather than shift every later column left by one.
 */
function collectColumns(records: Array<Record<string, string>>): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

/** Converts JSON text to CSV text. */
export function jsonToCsv(text: string, options: JsonToCsvOptions): ConversionResult {
  if (text.trim() === '') {
    return { text: '', error: null, columns: [], rowCount: 0 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return {
      text: '',
      error: `JSON 解析失败：${cause instanceof Error ? cause.message : String(cause)}`,
      columns: [],
      rowCount: 0,
    };
  }

  const records = Array.isArray(parsed) ? parsed : [parsed];
  if (records.length === 0) {
    return { text: '', error: null, columns: [], rowCount: 0 };
  }

  // An array of arrays is already tabular; its own first row can be a header,
  // so there is nothing to synthesise.
  if (records.every((record) => Array.isArray(record))) {
    const rows = records.map((record) => (record as unknown[]).map(cellText));
    return {
      text: serializeCsv(rows, options),
      error: null,
      columns: [],
      rowCount: rows.length,
    };
  }

  const flat = records.map((record) => flattenRecord(record, options.nested));
  const columns = collectColumns(flat);
  // Records with no keys at all (`[{}]`) have nothing to say; emitting a row of
  // zero fields would produce a line of empty text that is indistinguishable
  // from a blank line.
  if (columns.length === 0) {
    return { text: '', error: null, columns: [], rowCount: flat.length };
  }
  const body = flat.map((record) => columns.map((column) => record[column] ?? ''));
  const rows = options.hasHeader ? [columns, ...body] : body;

  return {
    text: serializeCsv(rows, options),
    error: null,
    columns,
    rowCount: body.length,
  };
}

/**
 * Makes header cells unique.
 *
 * Duplicate names would otherwise make the later column overwrite the earlier
 * one when building objects, losing data silently. Empty names get the same
 * positional fallback Excel uses.
 */
export function uniqueHeader(raw: string[]): string[] {
  const counts = new Map<string, number>();
  return raw.map((name, index) => {
    const base = name === '' ? `column${index + 1}` : name;
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    return seen === 0 ? base : `${base}_${seen + 1}`;
  });
}

/** Converts CSV text to JSON text. */
export function csvToJson(text: string, options: CsvToJsonOptions): ConversionResult {
  const parsed = parseCsv(text, { delimiter: options.delimiter });
  if (parsed.error) {
    return { text: '', error: parsed.error, columns: [], rowCount: 0 };
  }

  const rows = parsed.rows;
  if (rows.length === 0) {
    return { text: '[]', error: null, columns: [], rowCount: 0 };
  }

  const space = options.indent > 0 ? options.indent : 0;

  if (!options.hasHeader) {
    return {
      text: JSON.stringify(rows, null, space),
      error: null,
      columns: [],
      rowCount: rows.length,
    };
  }

  const header = uniqueHeader(rows[0]);
  const body = rows.slice(1);
  const objects = body.map((row) => {
    const object: Record<string, string> = {};
    header.forEach((name, index) => {
      object[name] = row[index] ?? '';
    });
    // Cells past the header keep their data under a positional name rather than
    // being dropped — a ragged file should still survive the conversion.
    for (let index = header.length; index < row.length; index += 1) {
      object[`column${index + 1}`] = row[index];
    }
    return object;
  });

  return {
    text: JSON.stringify(objects, null, space),
    error: null,
    columns: header,
    rowCount: objects.length,
  };
}
