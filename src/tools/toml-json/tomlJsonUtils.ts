/**
 * TOML ↔ JSON conversion: a hand-written TOML 1.0 parser and serialiser.
 *
 * Why not a library: the project has no TOML dependency, and the one thing that
 * actually matters here — keeping TOML's four date-time types distinct across a
 * JSON round trip — is exactly the part a generic parser leaves to the caller
 * anyway. Node has no built-in TOML support, so a dependency would be the only
 * alternative, and it would still need this mapping layer on top.
 *
 * The mapping between the two formats is documented in `MAPPING_NOTES` (shown
 * in the UI). The short version:
 *
 *   - TOML's offset date-time, local date-time, local date and local time are
 *     tagged objects (`{ $type, $value }`) because JSON has no date type. The
 *     `$value` is the verbatim source text, so the round trip is stable.
 *   - `inf` / `-inf` / `nan` are tagged for the same reason: they are not valid
 *     JSON numbers.
 *   - JSON `null` has no TOML counterpart and is a hard error, never a silent
 *     drop.
 *   - JSON has a single number type, so TOML's integer/float distinction cannot
 *     survive; `1.0` comes back as `1`. That is stated in the UI.
 */

export type TomlDateType =
  | 'toml-offset-date-time'
  | 'toml-local-date-time'
  | 'toml-local-date'
  | 'toml-local-time';

export interface TomlTagged {
  $type: TomlDateType | 'toml-float';
  $value: string;
}

export type TomlValue = string | number | boolean | TomlTagged | TomlValue[] | TomlObject;

export interface TomlObject {
  [key: string]: TomlValue;
}

const TAG_TYPES: ReadonlySet<string> = new Set([
  'toml-offset-date-time',
  'toml-local-date-time',
  'toml-local-date',
  'toml-local-time',
  'toml-float',
]);

/**
 * Recognises the tagged form.
 *
 * Exactly two keys are required. A TOML table that happens to have `$type` and
 * `$value` as its only two keys is therefore indistinguishable from a tag going
 * back the other way — an inherent cost of tagging, called out in the UI. The
 * strict key count keeps accidental matches rare.
 */
export function isTomlTag(value: unknown): value is TomlTagged {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('$type') || !keys.includes('$value')) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.$type === 'string' &&
    TAG_TYPES.has(record.$type) &&
    typeof record.$value === 'string'
  );
}

function isPlainObject(value: unknown): value is TomlObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !isTomlTag(value);
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

class TomlError extends Error {
  constructor(message: string, line: number, column: number) {
    super(`第 ${line} 行第 ${column} 列：${message}`);
    this.name = 'TomlError';
  }
}

/* ------------------------------------------------------------------ *
 * Patterns
 * ------------------------------------------------------------------ */

const BARE_KEY = /^[A-Za-z0-9_-]+/;
const OFFSET_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})/;
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(\.\d+)?/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const LOCAL_TIME = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?/;
const HEX_INT = /^0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*/;
const OCT_INT = /^0o[0-7](?:_?[0-7])*/;
const BIN_INT = /^0b[01](?:_?[01])*/;
const DEC_INT = /^[+-]?(?:0|[1-9](?:_?[0-9])*)/;
const SPEC_FLOAT = /^[+-]?(?:inf|nan)/;
const DEC_FLOAT =
  /^[+-]?(?:0|[1-9](?:_?[0-9])*)(?:(?:\.[0-9](?:_?[0-9])*)(?:[eE][+-]?[0-9](?:_?[0-9])*)?|(?:[eE][+-]?[0-9](?:_?[0-9])*))/;

const MAX_DEPTH = 100;

function daysInMonth(year: number, month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) return 29;
  return lengths[month - 1];
}

function isControlChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (code < 0x20 && ch !== '\t' && ch !== '\n') || code === 0x7f;
}

/* ------------------------------------------------------------------ *
 * Parser
 * ------------------------------------------------------------------ */

interface TableMeta {
  /** Defined by a `[header]`. */
  header: boolean;
  /** Created as an intermediate by a dotted key, so a header cannot claim it. */
  dotted: boolean;
  /** An inline table: closed for further extension. */
  inline: boolean;
  /** Keys already assigned directly in this table. */
  keys: Set<string>;
}

const TAG_PATH_SEPARATOR = '.';

export interface TomlParseResult {
  ok: boolean;
  value?: TomlObject;
  error?: string;
  warnings: string[];
}

class TomlParser {
  private readonly src: string;
  private pos = 0;
  private readonly root: TomlObject = {};
  private current: TomlObject = this.root;
  private currentPath = '';
  private readonly meta = new WeakMap<object, TableMeta>();
  private readonly arrayKind = new WeakMap<object, 'aot' | 'value'>();
  private readonly warnings: string[] = [];

  constructor(text: string) {
    const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    this.src = withoutBom.replace(/\r\n/g, '\n');
  }

  parse(): { value: TomlObject; warnings: string[] } {
    const strayCr = this.src.indexOf('\r');
    if (strayCr !== -1) {
      this.pos = strayCr;
      this.fail('TOML 只允许 LF 或 CRLF 换行，这里出现了单独的 CR');
    }

    for (;;) {
      this.skipBlank();
      if (this.eof()) break;
      if (this.peek() === '[') this.parseHeader();
      else this.parseKeyValue();
      this.expectLineEnd();
    }

    return { value: this.root, warnings: this.warnings };
  }

  /* -------------------- primitives -------------------- */

  private get length(): number {
    return this.src.length;
  }

  private eof(): boolean {
    return this.pos >= this.src.length;
  }

  private peek(): string {
    return this.src[this.pos] ?? '';
  }

  private startsWith(token: string): boolean {
    return this.src.startsWith(token, this.pos);
  }

  private expect(token: string): void {
    if (!this.startsWith(token)) this.fail(`期望 "${token}"`);
    this.pos += token.length;
  }

  private locate(index: number): { line: number; column: number } {
    const before = this.src.slice(0, index);
    const lastBreak = before.lastIndexOf('\n');
    return { line: before.split('\n').length, column: index - lastBreak };
  }

  private fail(message: string): never {
    const { line, column } = this.locate(this.pos);
    throw new TomlError(message, line, column);
  }

  private skipInlineWs(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.pos += 1;
  }

  private skipComment(): void {
    // A `#` starts a comment that runs to the end of the line. Control
    // characters other than tab are not allowed inside TOML at all.
    this.pos += 1;
    while (!this.eof() && this.peek() !== '\n') {
      if (isControlChar(this.src[this.pos])) this.fail('注释中不能包含控制字符');
      this.pos += 1;
    }
  }

  /** Whitespace, newlines and comments: everything allowed between tokens. */
  private skipBlank(): void {
    for (;;) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\n') {
        this.pos += 1;
      } else if (ch === '#') {
        this.skipComment();
      } else {
        return;
      }
    }
  }

  private expectLineEnd(): void {
    this.skipInlineWs();
    if (this.peek() === '#') this.skipComment();
    if (this.eof()) return;
    if (this.peek() === '\n') {
      this.pos += 1;
      return;
    }
    this.fail(`这一行在值之后还有多余内容 "${this.peek()}"`);
  }

  private tableMeta(object: object): TableMeta {
    let meta = this.meta.get(object);
    if (!meta) {
      meta = { header: false, dotted: false, inline: false, keys: new Set() };
      this.meta.set(object, meta);
    }
    return meta;
  }

  /* -------------------- keys -------------------- */

  private parseKey(): string {
    const ch = this.peek();
    if (ch === '"') return this.readBasicString();
    if (ch === "'") return this.readLiteralString();
    const match = BARE_KEY.exec(this.src.slice(this.pos));
    if (!match) this.fail('这里需要一个键（裸键只能包含 A-Z a-z 0-9 _ -，其他字符要用引号）');
    this.pos += match[0].length;
    const after = this.peek();
    if (after !== '' && !' \t\n.=]},#'.includes(after)) {
      this.fail(`裸键里出现了非法字符 "${after}"（键名需要加引号）`);
    }
    return match[0];
  }

  private parseKeyPath(): string[] {
    const parts: string[] = [this.parseKey()];
    this.skipInlineWs();
    while (this.peek() === '.') {
      this.pos += 1;
      this.skipInlineWs();
      parts.push(this.parseKey());
      this.skipInlineWs();
    }
    return parts;
  }

  /* -------------------- statements -------------------- */

  private parseHeader(): void {
    const array = this.startsWith('[[');
    this.pos += array ? 2 : 1;
    this.skipInlineWs();
    if (this.peek() === ']') this.fail('表头里没有键名');
    const path = this.parseKeyPath();
    this.skipInlineWs();
    this.expect(array ? ']]' : ']');
    this.defineTable(path, array);
  }

  /**
   * Resolves a `[a.b]` or `[[a.b]]` header.
   *
   * Intermediate segments are created as needed; when an intermediate is an
   * array of tables the last element is entered, which is what makes
   * `[[fruit]]` followed by `[fruit.physical]` work.
   */
  private defineTable(path: string[], array: boolean): void {
    let node: TomlObject = this.root;
    for (let i = 0; i < path.length - 1; i += 1) {
      const key = path[i];
      const label = path.slice(0, i + 1).join(TAG_PATH_SEPARATOR);
      const next = node[key];
      if (next === undefined) {
        const created: TomlObject = {};
        node[key] = created;
        node = created;
        continue;
      }
      if (Array.isArray(next)) {
        if (this.arrayKind.get(next) !== 'aot') {
          this.fail(`"${label}" 是一个普通数组，不能当作表来定义`);
        }
        const last = next[next.length - 1];
        if (!isPlainObject(last)) this.fail(`"${label}" 的数组表元素不是表`);
        node = last;
        continue;
      }
      if (!isPlainObject(next)) {
        this.fail(`"${label}" 已经是一个值，不能再当作表`);
      }
      if (this.tableMeta(next).inline) {
        this.fail(`"${label}" 是内联表，不能再扩展`);
      }
      node = next;
    }

    const lastKey = path[path.length - 1];
    const label = path.join(TAG_PATH_SEPARATOR);
    const existing = node[lastKey];

    if (!array) {
      if (existing === undefined) {
        const created: TomlObject = {};
        node[lastKey] = created;
        this.tableMeta(created).header = true;
        this.current = created;
      } else if (Array.isArray(existing)) {
        if (this.arrayKind.get(existing) === 'aot') {
          this.fail(`"${label}" 已经是数组表（[[${label}]]），不能再用 [${label}] 定义`);
        }
        this.fail(`"${label}" 已经是普通数组，不能当作表来定义`);
      } else if (!isPlainObject(existing)) {
        this.fail(`"${label}" 已经是一个值，不能再当作表`);
      } else {
        const meta = this.tableMeta(existing);
        if (meta.inline) this.fail(`"${label}" 是内联表，不能再扩展`);
        if (meta.header) this.fail(`表 "${label}" 重复定义`);
        if (meta.dotted) this.fail(`"${label}" 已经由点号键定义，不能再写成 [${label}] 表头`);
        meta.header = true;
        this.current = existing;
      }
    } else {
      let list: TomlValue[];
      if (existing === undefined) {
        list = [];
        node[lastKey] = list;
        this.arrayKind.set(list, 'aot');
      } else if (Array.isArray(existing) && this.arrayKind.get(existing) === 'aot') {
        list = existing;
      } else if (Array.isArray(existing)) {
        this.fail(`"${label}" 已经是一个普通数组，不能改成数组表`);
      } else {
        this.fail(`"${label}" 已经是一个值，不能改成数组表`);
      }
      const element: TomlObject = {};
      list.push(element);
      this.current = element;
    }

    this.currentPath = label;
    this.skipInlineWs();
  }

  private parseKeyValue(): void {
    const path = this.parseKeyPath();
    this.skipInlineWs();
    this.expect('=');
    this.skipInlineWs();
    const value = this.parseValue(0);
    this.assign(this.current, path, value, this.currentPath);
  }

  /**
   * Assigns `path` into `target`, creating intermediate tables.
   *
   * `container` is passed in so the same code serves both a key-value line
   * (relative to the current table) and the inside of an inline table.
   */
  private assign(target: TomlObject, path: string[], value: TomlValue, where: string): void {
    let node = target;
    for (let i = 0; i < path.length - 1; i += 1) {
      const key = path[i];
      const next = node[key];
      if (next === undefined) {
        const created: TomlObject = {};
        this.tableMeta(created).dotted = true;
        this.tableMeta(node).keys.add(key);
        node[key] = created;
        node = created;
        continue;
      }
      if (!isPlainObject(next)) {
        this.fail(`键 "${key}" 已经是一个值，不能再用作表`);
      }
      if (this.tableMeta(next).inline) {
        this.fail(`键 "${key}" 是内联表，不能再扩展`);
      }
      node = next;
    }

    const last = path[path.length - 1];
    const meta = this.tableMeta(node);
    if (meta.keys.has(last) || Object.prototype.hasOwnProperty.call(node, last)) {
      this.fail(`重复的键 "${last}"（在 ${where === '' ? '根表' : `表 "${where}"`} 中）`);
    }
    meta.keys.add(last);
    node[last] = value;
    if (isPlainObject(value)) this.tableMeta(value).inline = true;
  }

  /* -------------------- values -------------------- */

  private parseValue(depth: number): TomlValue {
    if (depth > MAX_DEPTH) this.fail(`嵌套超过 ${MAX_DEPTH} 层`);
    const ch = this.peek();
    if (this.startsWith('"""')) return this.readMultilineString('"', true);
    if (this.startsWith("'''")) return this.readMultilineString("'", false);
    if (ch === '"') return this.readBasicString();
    if (ch === "'") return this.readLiteralString();
    if (ch === '[') return this.parseArray(depth + 1);
    if (ch === '{') return this.parseInlineTable(depth + 1);
    if (this.startsWith('true')) {
      this.pos += 4;
      return true;
    }
    if (this.startsWith('false')) {
      this.pos += 5;
      return false;
    }
    const date = this.tryParseDateTime();
    if (date) return date;
    const number = this.tryParseNumber();
    if (number !== null) return number;
    this.fail(`无法识别的值 "${this.src.slice(this.pos, this.pos + 12)}"`);
  }

  private parseArray(depth: number): TomlValue[] {
    this.expect('[');
    const items: TomlValue[] = [];
    for (;;) {
      this.skipBlank();
      if (this.eof()) this.fail('数组没有闭合（缺少 ]）');
      if (this.peek() === ']') {
        this.pos += 1;
        return items;
      }
      items.push(this.parseValue(depth));
      this.skipBlank();
      if (this.peek() === ',') {
        this.pos += 1;
        continue;
      }
      if (this.peek() === ']') {
        this.pos += 1;
        return items;
      }
      if (this.eof()) this.fail('数组没有闭合（缺少 ]）');
      this.fail('数组元素之后需要逗号或 ]');
    }
  }

  private parseInlineTable(depth: number): TomlObject {
    this.expect('{');
    const table: TomlObject = {};
    this.tableMeta(table);
    this.skipInlineWs();
    if (this.peek() === '}') {
      this.pos += 1;
      return table;
    }
    for (;;) {
      const path = this.parseKeyPath();
      this.skipInlineWs();
      this.expect('=');
      this.skipInlineWs();
      const value = this.parseValue(depth);
      this.assign(table, path, value, '内联表');
      this.skipInlineWs();
      if (this.peek() === ',') {
        this.pos += 1;
        this.skipInlineWs();
        if (this.peek() === '}') this.fail('内联表不允许尾随逗号');
        if (this.peek() === '\n' || this.eof()) {
          this.fail('内联表必须写在一行内（TOML 1.0 不允许内联表跨行）');
        }
        continue;
      }
      if (this.peek() === '}') {
        this.pos += 1;
        return table;
      }
      this.fail('内联表里需要逗号或 }（内联表必须写在一行内）');
    }
  }

  /* -------------------- datetimes -------------------- */

  private tryParseDateTime(): TomlTagged | null {
    const rest = this.src.slice(this.pos);
    const offset = OFFSET_DATETIME.exec(rest);
    if (offset) {
      this.checkDate(offset[1], offset[2], offset[3]);
      this.checkTime(offset[4], offset[5], offset[6]);
      return this.takeTag('toml-offset-date-time', offset[0]);
    }
    const local = LOCAL_DATETIME.exec(rest);
    if (local) {
      this.checkDate(local[1], local[2], local[3]);
      this.checkTime(local[4], local[5], local[6]);
      return this.takeTag('toml-local-date-time', local[0]);
    }
    const date = LOCAL_DATE.exec(rest);
    if (date) {
      this.checkDate(date[1], date[2], date[3]);
      return this.takeTag('toml-local-date', date[0]);
    }
    const time = LOCAL_TIME.exec(rest);
    if (time) {
      this.checkTime(time[1], time[2], time[3]);
      return this.takeTag('toml-local-time', time[0]);
    }
    return null;
  }

  private takeTag(type: TomlDateType, text: string): TomlTagged {
    // The verbatim source slice is kept so that `T` versus space, `z` versus
    // `Z` and the exact number of fractional digits all survive a round trip.
    this.pos += text.length;
    return { $type: type, $value: text };
  }

  private checkDate(year: string, month: string, day: string): void {
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (m < 1 || m > 12) this.fail(`月份 ${month} 超出 1-12`);
    if (d < 1 || d > daysInMonth(y, m)) this.fail(`${year}-${month} 里没有 ${day} 日`);
  }

  private checkTime(hour: string, minute: string, second: string): void {
    if (Number(hour) > 23) this.fail(`小时 ${hour} 超出 00-23`);
    if (Number(minute) > 59) this.fail(`分钟 ${minute} 超出 00-59`);
    // TOML 1.0 (like Python's tomllib) has no leap-second support.
    if (Number(second) > 59) this.fail(`秒 ${second} 超出 00-59（不支持闰秒 60）`);
  }

  /* -------------------- numbers -------------------- */

  private tryParseNumber(): TomlValue | null {
    const rest = this.src.slice(this.pos);

    const special = SPEC_FLOAT.exec(rest);
    if (special) {
      // `inf` and `nan` cannot be JSON numbers, so they are tagged; the tag
      // carries the sign and the spelling.
      this.pos += special[0].length;
      return { $type: 'toml-float', $value: special[0].toLowerCase() };
    }
    if (/^[+-]?0[0-9]/.test(rest)) {
      this.fail('整数不能有前导零（只有 0 本身可以）');
    }
    for (const [pattern, radix] of [
      [HEX_INT, 16],
      [OCT_INT, 8],
      [BIN_INT, 2],
    ] as const) {
      const match = pattern.exec(rest);
      if (match) {
        this.pos += match[0].length;
        return this.decimalFrom(match[0], radix);
      }
    }
    const float = DEC_FLOAT.exec(rest);
    if (float) {
      this.pos += float[0].length;
      const value = Number(float[0].replace(/_/g, ''));
      if (!Number.isFinite(value)) {
        // TOML defines overflow as ±inf, so this is not an error — but an
        // Infinity leaking into the JSON tree would serialise as `null`, which
        // is why it becomes a tag here rather than a number.
        const sign = value > 0 ? '' : '-';
        this.warnings.push(`浮点数 "${float[0]}" 超出 IEEE-754 范围，按 TOML 规则当作 ${sign}inf`);
        return { $type: 'toml-float', $value: `${sign}inf` };
      }
      return value;
    }
    const integer = DEC_INT.exec(rest);
    if (integer) {
      this.pos += integer[0].length;
      const value = Number(integer[0].replace(/_/g, ''));
      if (!Number.isSafeInteger(value)) {
        this.warnings.push(
          `整数 "${integer[0]}" 超出 IEEE-754 安全整数范围，JSON 数字会丢失精度`,
        );
      }
      return value;
    }
    return null;
  }

  private decimalFrom(text: string, radix: number): number {
    const digits = text.slice(2).replace(/_/g, '');
    const value = Number.parseInt(digits, radix);
    if (!Number.isSafeInteger(value)) {
      this.warnings.push(`整数 "${text}" 超出 IEEE-754 安全整数范围，JSON 数字会丢失精度`);
    }
    return value;
  }

  /* -------------------- strings -------------------- */

  private readEscape(): string {
    this.pos += 1;
    const ch = this.peek();
    const simple: Record<string, string> = {
      b: '\b',
      t: '\t',
      n: '\n',
      f: '\f',
      r: '\r',
      '"': '"',
      '\\': '\\',
    };
    if (simple[ch] !== undefined) {
      this.pos += 1;
      return simple[ch];
    }
    if (ch === 'u' || ch === 'U') {
      const size = ch === 'u' ? 4 : 8;
      const hex = this.src.slice(this.pos + 1, this.pos + 1 + size);
      if (!new RegExp(`^[0-9A-Fa-f]{${size}}$`).test(hex)) {
        this.fail(`\\${ch} 转义需要 ${size} 位十六进制数字`);
      }
      const codePoint = Number.parseInt(hex, 16);
      if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        this.fail(`\\${ch}${hex} 不是合法的 Unicode 码位`);
      }
      this.pos += 1 + size;
      return String.fromCodePoint(codePoint);
    }
    this.fail(`未知的转义序列 \\${ch}`);
  }

  private readBasicString(): string {
    this.expect('"');
    let out = '';
    for (;;) {
      if (this.eof()) this.fail('字符串没有闭合');
      const ch = this.peek();
      if (ch === '"') {
        this.pos += 1;
        return out;
      }
      if (ch === '\n') this.fail('单行字符串里不能有换行，请使用三引号的多行字符串');
      if (ch === '\\') {
        out += this.readEscape();
        continue;
      }
      if (isControlChar(ch)) this.fail('字符串里不能包含控制字符');
      out += ch;
      this.pos += 1;
    }
  }

  private readLiteralString(): string {
    this.expect("'");
    const end = this.src.indexOf("'", this.pos);
    if (end === -1) this.fail('字面量字符串没有闭合');
    const raw = this.src.slice(this.pos, end);
    if (raw.includes('\n')) this.fail('单行字面量字符串里不能有换行');
    for (const ch of raw) {
      if (isControlChar(ch)) this.fail('字符串里不能包含控制字符');
    }
    this.pos = end + 1;
    return raw;
  }

  private readMultilineString(quote: '"' | "'", basic: boolean): string {
    this.pos += 3;
    // A newline directly after the opening delimiter is trimmed.
    if (this.peek() === '\n') this.pos += 1;
    let out = '';
    for (;;) {
      if (this.eof()) this.fail('多行字符串没有闭合');
      const ch = this.peek();

      if (ch === quote) {
        let count = 0;
        while (this.src[this.pos + count] === quote) count += 1;
        if (count >= 3) {
          if (count > 5) this.fail('多行字符串里不允许出现三个以上连续的引号');
          out += quote.repeat(count - 3);
          this.pos += count;
          return out;
        }
        out += quote.repeat(count);
        this.pos += count;
        continue;
      }

      if (basic && ch === '\\') {
        const next = this.src[this.pos + 1];
        if (next === '\n' || next === ' ' || next === '\t') {
          let look = this.pos + 1;
          while (this.src[look] === ' ' || this.src[look] === '\t') look += 1;
          if (this.src[look] === '\n') {
            // Line-ending backslash: the backslash and every following
            // whitespace character (newlines included) are removed.
            let skip = look;
            while (
              skip < this.length &&
              (this.src[skip] === ' ' || this.src[skip] === '\t' || this.src[skip] === '\n')
            ) {
              skip += 1;
            }
            this.pos = skip;
            continue;
          }
        }
        out += this.readEscape();
        continue;
      }

      if (ch === '\n') {
        out += '\n';
        this.pos += 1;
        continue;
      }
      if (isControlChar(ch)) this.fail('字符串里不能包含控制字符');
      out += ch;
      this.pos += 1;
    }
  }
}

export function parseToml(text: string): TomlParseResult {
  try {
    const { value, warnings } = new TomlParser(text).parse();
    return { ok: true, value, warnings };
  } catch (error) {
    if (error instanceof TomlError) {
      return { ok: false, error: error.message, warnings: [] };
    }
    return { ok: false, error: `内部错误：${String(error)}`, warnings: [] };
  }
}

/* ------------------------------------------------------------------ *
 * TOML to JSON
 * ------------------------------------------------------------------ */

export interface TomlToJsonResult {
  ok: boolean;
  text: string;
  error?: string;
  warnings: string[];
}

export function tomlToJson(text: string, indent = 2): TomlToJsonResult {
  const parsed = parseToml(text);
  if (!parsed.ok || parsed.value === undefined) {
    return { ok: false, text: '', error: parsed.error ?? '解析失败', warnings: parsed.warnings };
  }
  return {
    ok: true,
    text: JSON.stringify(parsed.value, null, indent > 0 ? indent : 0),
    warnings: parsed.warnings,
  };
}

/* ------------------------------------------------------------------ *
 * JSON to TOML
 * ------------------------------------------------------------------ */

export interface JsonToTomlResult {
  ok: boolean;
  text: string;
  error?: string;
  warnings: string[];
}

const BARE_KEY_OK = /^[A-Za-z0-9_-]+$/;

function encodeKey(key: string): string {
  if (BARE_KEY_OK.test(key)) return key;
  return `"${escapeBasicString(key)}"`;
}

function encodePath(path: string[]): string {
  return path.map(encodeKey).join('.');
}

function escapeBasicString(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\f') out += '\\f';
    else if (ch === '\r') out += '\\r';
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
    else out += ch;
  }
  return out;
}

const DATE_PATTERNS: Record<TomlDateType, RegExp> = {
  'toml-offset-date-time': new RegExp(`^${OFFSET_DATETIME.source}$`),
  'toml-local-date-time': new RegExp(`^${LOCAL_DATETIME.source}$`),
  'toml-local-date': new RegExp(`^${LOCAL_DATE.source}$`),
  'toml-local-time': new RegExp(`^${LOCAL_TIME.source}$`),
};

/** Finds a `null` anywhere in the value tree, for a precise error message. */
function findNull(value: unknown, path: string): string | null {
  if (value === null) return path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findNull(value[i], `${path}[${i}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value === 'object' && value !== undefined) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const found = findNull(child, path === '' ? key : `${path}.${key}`);
      if (found !== null) return found;
    }
  }
  return null;
}

class SerialiseError extends Error {}

function encodeScalar(value: TomlValue, path: string, depth: number): string {
  if (depth > MAX_DEPTH) throw new SerialiseError(`嵌套超过 ${MAX_DEPTH} 层`);

  if (isTomlTag(value)) {
    if (value.$type === 'toml-float') {
      const normalised = value.$value.toLowerCase();
      if (!['inf', '+inf', '-inf', 'nan', '+nan', '-nan'].includes(normalised)) {
        throw new SerialiseError(`"${path}" 的 $value 不是合法的 inf/nan："${value.$value}"`);
      }
      if (normalised.startsWith('+')) return normalised.slice(1);
      return normalised;
    }
    const pattern = DATE_PATTERNS[value.$type];
    if (!pattern.test(value.$value)) {
      throw new SerialiseError(`"${path}" 的 $value 不是合法的 ${value.$type}："${value.$value}"`);
    }
    return value.$value;
  }

  if (typeof value === 'string') return `"${escapeBasicString(value)}"`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new SerialiseError(`"${path}" 的值不是有限数字；TOML 里要写 inf/nan，请用 $type 标签`);
    }
    // JSON has one number type, so TOML's integer/float distinction cannot be
    // recovered here: 1.0 and 1 are the same value by the time we see them.
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => encodeInline(item, `${path}[${index}]`, depth + 1)).join(', ')}]`;
  }
  if (isPlainObject(value)) return encodeInlineTable(value, path, depth + 1);
  throw new SerialiseError(`"${path}" 的值无法用 TOML 表示`);
}

/** Values written inside an array or an inline table must stay on one line. */
function encodeInline(value: TomlValue, path: string, depth: number): string {
  if (isPlainObject(value)) return encodeInlineTable(value, path, depth);
  return encodeScalar(value, path, depth);
}

function encodeInlineTable(value: TomlObject, path: string, depth: number): string {
  if (depth > MAX_DEPTH) throw new SerialiseError(`嵌套超过 ${MAX_DEPTH} 层`);
  const parts = Object.entries(value).map(
    ([key, child]) => `${encodeKey(key)} = ${encodeInline(child, `${path}.${key}`, depth + 1)}`,
  );
  if (parts.length === 0) return '{}';
  return `{ ${parts.join(', ')} }`;
}

/** True when the array should become `[[table]]` entries. */
function isArrayOfTables(value: TomlValue): value is TomlObject[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isPlainObject(item));
}

function pushLine(lines: string[], line: string): void {
  if (line === '' && (lines.length === 0 || lines[lines.length - 1] === '')) return;
  lines.push(line);
}

function emitTable(path: string[], table: TomlObject, lines: string[], depth: number): void {
  if (depth > MAX_DEPTH) throw new SerialiseError(`嵌套超过 ${MAX_DEPTH} 层`);

  const scalars: [string, TomlValue][] = [];
  const subTables: [string, TomlObject][] = [];
  const arraysOfTables: [string, TomlObject[]][] = [];

  for (const [key, value] of Object.entries(table)) {
    if (isArrayOfTables(value)) arraysOfTables.push([key, value]);
    else if (isPlainObject(value)) subTables.push([key, value]);
    else scalars.push([key, value]);
  }

  // TOML requires a table's own key/value pairs to appear before any sub-table
  // header, so the three groups are emitted in this order at every level.
  for (const [key, value] of scalars) {
    lines.push(`${encodeKey(key)} = ${encodeScalar(value, key, depth)}`);
  }

  for (const [key, value] of subTables) {
    const nextPath = [...path, key];
    pushLine(lines, '');
    lines.push(`[${encodePath(nextPath)}]`);
    emitTable(nextPath, value, lines, depth + 1);
  }

  for (const [key, value] of arraysOfTables) {
    const nextPath = [...path, key];
    for (const element of value) {
      pushLine(lines, '');
      lines.push(`[[${encodePath(nextPath)}]]`);
      emitTable(nextPath, element, lines, depth + 1);
    }
  }
}

export function jsonToToml(json: string): JsonToTomlResult {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return {
      ok: false,
      text: '',
      error: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
      warnings,
    };
  }

  const nullPath = findNull(parsed, '');
  if (nullPath !== null) {
    return {
      ok: false,
      text: '',
      error: `"${nullPath || '(顶层)'}" 的值是 null：TOML 没有 null，无法表示。请删掉这个键，或改成空字符串、0、false 或空表`,
      warnings,
    };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, text: '', error: '顶层必须是对象（TOML 文档本身就是一张表）', warnings };
  }

  const lines: string[] = [];
  try {
    emitTable([], parsed, lines, 0);
  } catch (error) {
    if (error instanceof SerialiseError) return { ok: false, text: '', error: error.message, warnings };
    return { ok: false, text: '', error: `内部错误：${String(error)}`, warnings };
  }

  return { ok: true, text: lines.length === 0 ? '' : `${lines.join('\n')}\n`, warnings };
}

/* ------------------------------------------------------------------ *
 * Documentation shown in the UI
 * ------------------------------------------------------------------ */

export const MAPPING_NOTES: readonly string[] = [
  'TOML 与 JSON 不是同构的，映射方式不唯一。本工具采用的约定如下，往返在语义上稳定，但不保证逐字节相同。',
  '日期时间在 JSON 里没有原生类型，用「标签对象」表示：{ "$type": "toml-local-date", "$value": "1979-05-27" }。四种类型分别是 toml-offset-date-time、toml-local-date-time、toml-local-date、toml-local-time。',
  '$value 保留原文（T 还是空格、Z 还是 z、小数秒几位都不变），所以 TOML → JSON → TOML 能原样写回，不会把本地时间偷偷当成 UTC。',
  'inf / -inf / nan 不是合法的 JSON 数字，同样用标签：{ "$type": "toml-float", "$value": "inf" }。',
  'JSON 的 null 在 TOML 里没有对应物，遇到就报错（并指出是哪个键），不会静默丢掉。',
  'JSON 只有一种数字类型，TOML 区分整数与浮点：1.0 往返后会变成整数 1。超出 IEEE-754 安全范围的整数（如 9223372036854775807）会丢精度，工具会给出警告。',
  'JSON → TOML 时，值是对象的键写成 [表]，元素全是对象的数组写成 [[数组表]]，其余数组写成内联数组；不能做裸键的键名（含点号、空格、中文等）会用基本字符串键并转义。',
  '标签是普通对象，因此一张恰好只有 $type 和 $value 两个键的 TOML 表，转回来时会被当成日期或 inf/nan 标签 —— 这是打标签方案固有的歧义。',
];

export const TOML_TAG_TYPES: readonly string[] = [
  'toml-offset-date-time',
  'toml-local-date-time',
  'toml-local-date',
  'toml-local-time',
  'toml-float',
];
