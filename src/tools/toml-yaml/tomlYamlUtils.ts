/**
 * TOML ↔ YAML conversion.
 *
 * Nothing here re-implements either format:
 *
 *   - TOML parsing comes from the sibling `toml-json` tool (`parseToml`), which
 *     already keeps TOML's four date-time types apart by tagging them, and
 *     already warns when an integer leaves the IEEE-754 safe range.
 *   - TOML writing is delegated to `jsonToToml` from the same module, so the
 *     table / array-of-tables layout and the "TOML has no null" error (with a
 *     key path) are shared rather than duplicated.
 *   - YAML comes from the `yaml` dependency.
 *
 * The real work is that the two type systems do not line up. The mapping is
 * listed in `MAPPING_NOTES` and summarised here:
 *
 *   1. **Date-times.** TOML has four types, YAML's `timestamp` covers three of
 *      them. Offset date-time, local date-time and local date are written as
 *      YAML timestamp plain scalars. A YAML timestamp *without* an offset means
 *      a local wall-clock reading (YAML 1.1 spec, and PyYAML agrees), so a TOML
 *      local date-time survives unchanged and is never shifted to UTC. TOML's
 *      local time has no YAML type at all and becomes the two-key mapping
 *      `{ "$type": "toml-local-time", "$value": "07:32:00" }` — writing it as a
 *      bare scalar is not merely imprecise, it changes the value (see
 *      `needsYamlQuoting`).
 *   2. **null.** YAML has it, TOML does not. Converting is refused with the
 *      offending key path; nothing is dropped.
 *   3. **Integers.** JavaScript numbers are doubles. TOML input is parsed by the
 *      shared parser (which rounds and warns); YAML input is read with
 *      `intAsBigInt` so the exact decimal is still available when the warning is
 *      produced. The documented meeting point is the double, exactly as in
 *      `toml-json`.
 *   4. **Keys.** TOML keys are always strings. YAML keys may be numbers,
 *      booleans, null or even collections, so a non-string key is reported
 *      instead of being silently stringified.
 *   5. **Anchors and aliases.** TOML has no references, so an alias is expanded
 *      where it appears. Expansion is counted and depth-limited: walking the
 *      syntax tree by hand (needed to see key types and tags) bypasses the
 *      parser's own alias guard, which only fires inside `toJS()`.
 *
 * Not attempted, on purpose: keeping comments or the original formatting, and
 * validating anything about what the values mean.
 */

import {
  Document,
  Pair,
  Scalar,
  YAMLMap,
  YAMLSeq,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
  stringify,
} from 'yaml';
import type { Node } from 'yaml';
import {
  isTomlTag,
  jsonToToml,
  parseToml,
  type TomlTagged,
  type TomlValue,
} from '../toml-json/tomlJsonUtils';

/* ------------------------------------------------------------------ *
 * Limits
 * ------------------------------------------------------------------ */

/** Refuse inputs larger than this; parsing is synchronous and blocking. */
export const MAX_INPUT_BYTES = 512 * 1024;

/** Same bound as the shared TOML parser, so both directions agree. */
export const MAX_DEPTH = 100;

/**
 * Ceiling on alias expansions, matching the `yaml` package default. Lower than
 * this is still generous for real configuration files, and it is what stops a
 * "billion laughs" document from expanding exponentially.
 */
export const MAX_ALIASES = 100;

/** YAML tag for the timestamp type (YAML 1.1 / the YAML type repository). */
const TIMESTAMP_TAG = 'tag:yaml.org,2002:timestamp';

/* ------------------------------------------------------------------ *
 * Result shape
 * ------------------------------------------------------------------ */

export interface ConvertResult {
  ok: boolean;
  text: string;
  error?: string;
  warnings: string[];
}

/* ------------------------------------------------------------------ *
 * YAML timestamps
 * ------------------------------------------------------------------ */

/**
 * YAML's timestamp patterns, copied from the YAML 1.1 type repository (PyYAML
 * uses the same ones).
 *
 * Note the asymmetry, which is deliberate: the date-only branch requires two
 * digit month and day, while the date-time branch accepts one or two. That is
 * what the specification says, and PyYAML behaves the same way, so `2001-1-1`
 * stays a string while `2001-1-1T00:00:00` is a timestamp.
 */
const YAML_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const YAML_DATE_TIME =
  /^(\d{4})-(\d{1,2})-(\d{1,2})(?:([Tt])|[ \t]+)(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d*))?(?:[ \t]*(Z|[-+]\d{1,2}(?::?\d{2})?))?$/;

function daysInMonth(year: number, month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) return 29;
  return lengths[month - 1];
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function checkDate(parts: DateParts): string | null {
  if (parts.month < 1 || parts.month > 12) return `月份 ${parts.month} 超出 1-12`;
  if (parts.day < 1 || parts.day > daysInMonth(parts.year, parts.month)) {
    return `${parts.year}-${String(parts.month).padStart(2, '0')} 里没有 ${parts.day} 日`;
  }
  return null;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Normalises a YAML time-zone designator to the offset syntax TOML requires.
 *
 * YAML 1.1 allows `Z`, `+5`, `-5:30` and a space before the designator; TOML
 * accepts only `Z` plus `+hh:mm` and does not allow the space. Returns null when
 * the designator cannot be represented.
 */
function normaliseOffset(raw: string): string | null {
  if (/^[Zz]$/.test(raw)) return 'Z';
  const match = /^([-+])(\d{1,2})(?::?(\d{2}))?$/.exec(raw);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = match[3] === undefined ? 0 : Number(match[3]);
  if (hours > 23 || minutes > 59) return null;
  return `${match[1]}${pad2(hours)}:${pad2(minutes)}`;
}

/**
 * Turns YAML timestamp text into the same tagged form `toml-json` uses, so the
 * rest of the pipeline (including the TOML writer) needs no changes.
 *
 * Returns null when the text is not a timestamp at all. When it *looks* like one
 * but the components are impossible (month 13, hour 24, ...) the caller reports
 * an error: PyYAML raises for the same inputs, and quietly turning it into a
 * string would hide a broken document.
 */
export function parseYamlTimestamp(text: string): TomlTagged | null {
  const dateOnly = YAML_DATE_ONLY.exec(text);
  if (dateOnly) {
    const parts = {
      year: Number(dateOnly[1]),
      month: Number(dateOnly[2]),
      day: Number(dateOnly[3]),
    };
    if (checkDate(parts) !== null) return null;
    return { $type: 'toml-local-date', $value: text };
  }

  const dateTime = YAML_DATE_TIME.exec(text);
  if (!dateTime) return null;

  const [, rawYear, rawMonth, rawDay, letter, rawHour, rawMinute, rawSecond, fraction, offset] = dateTime;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  const second = Number(rawSecond);

  if (checkDate({ year, month, day }) !== null) return null;
  if (hour > 23) return null;
  if (minute > 59) return null;
  if (second > 59) return null; // TOML 1.0 has no leap seconds either.

  let zone: string | null = null;
  if (offset !== undefined) {
    zone = normaliseOffset(offset);
    if (zone === null) return null;
  }

  // TOML demands two digits everywhere except the fractional part. YAML allows
  // `T`, `t` or any run of spaces between the date and the time; TOML accepts a
  // single `T`, `t` or space, so a run of spaces collapses to one space and
  // everything else becomes `T`.
  const separator = letter !== undefined ? letter : ' ';
  const body =
    `${rawYear}-${pad2(month)}-${pad2(day)}` +
    `${separator}${pad2(hour)}:${pad2(minute)}:${pad2(second)}` +
    (fraction !== undefined && fraction !== '' ? `.${fraction}` : '') +
    (zone === null ? '' : zone);

  return { $type: zone === null ? 'toml-local-date-time' : 'toml-offset-date-time', $value: body };
}

/* ------------------------------------------------------------------ *
 * YAML 1.1 compatibility of generated scalars
 * ------------------------------------------------------------------ */

/**
 * Characters that cannot appear in a plain scalar at all, or that readers
 * disagree about. `\n` is deliberately absent: a string with real line breaks
 * is better served by a block scalar, which every reader handles.
 */
const PLAIN_UNSAFE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * True when a string has to be quoted rather than written as a plain scalar.
 *
 * Two reasons, both found by running the output past PyYAML:
 *
 *   1. A plain scalar means different things to different readers. `07:32:00`
 *      is a string in YAML 1.2 but a sexagesimal integer to a 1.1 reader
 *      (`17:32:00` becomes 63120), `yes` is a string here and `true` there, and
 *      `1_000` is a string here and 1000 there.
 *   2. Some characters cannot be plain at all. A tab in the middle of a scalar
 *      makes PyYAML raise a scanner error, and U+0085 / U+2028 / U+2029 are line
 *      breaks to a 1.1 reader, so `a<U+0085>b` silently becomes `a b`.
 *
 * The `yaml` package already quotes what its own schema would misread; this adds
 * the interop cases, which is what lets the check script compare this tool
 * against PyYAML.
 */
export function needsYamlQuoting(value: string): boolean {
  if (value === '') return true;
  if (PLAIN_UNSAFE.test(value)) return true;
  if (/^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/.test(value)) {
    return true;
  }
  if (/^(?:~|null|Null|NULL)$/.test(value)) return true;
  // Sexagesimal integers and floats: 1:30, 190:20:30.15
  if (/^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+(?:\.[0-9_]*)?$/.test(value)) return true;
  // Decimal / octal / hex / binary integers, with 1.1's underscore separators.
  if (/^[-+]?(?:0b[0-1_]+|0x[0-9a-fA-F_]+|0[0-7_]+|(?:0|[1-9][0-9_]*))$/.test(value)) return true;
  // Floats, including .inf / -.inf / .nan.
  if (/^[-+]?(?:\.[0-9_]+|[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?)$/.test(value)) return true;
  if (/^[-+]?\.(?:inf|Inf|INF)$/.test(value)) return true;
  if (/^\.(?:nan|NaN|NAN)$/.test(value)) return true;
  // Anything a 1.1 reader would turn into a date or timestamp.
  if (YAML_DATE_ONLY.test(value) || YAML_DATE_TIME.test(value)) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

class ConvertError extends Error {}

/**
 * How a location is named in messages. Chinese reads fine with no space after a
 * quoted path, and a trailing space after the bare word would look like a typo.
 */
function label(path: string): string {
  if (path === '') return '顶层';
  // A path can run to hundreds of segments for deep input; the tail is enough
  // context and keeps the message readable.
  return path.length > 60 ? `“…${path.slice(-55)}”` : `“${path}”`;
}

function show(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `字符串 ${JSON.stringify(value)}`;
  if (typeof value === 'number' || typeof value === 'bigint') return `数字 ${value}`;
  if (typeof value === 'boolean') return `布尔值 ${value}`;
  if (Array.isArray(value)) return '序列';
  return '映射';
}

function isPlainModel(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Scalar) &&
    !(value instanceof Date)
  );
}

function firstLine(message: string): string {
  return message.split('\n')[0];
}

function formatParseError(error: { message: string; linePos?: Array<{ line: number; col: number }> }): string {
  const position = error.linePos?.[0];
  return `${position ? `第 ${position.line} 行第 ${position.col} 列：` : ''}${firstLine(error.message)}`;
}

/* ------------------------------------------------------------------ *
 * TOML to YAML
 * ------------------------------------------------------------------ */

type ModelValue = string | number | boolean | null | TomlTagged | ModelValue[] | ModelObject;
interface ModelObject {
  [key: string]: ModelValue;
}

/**
 * A YAML timestamp is a plain scalar, so the node type is forced: left to
 * itself the serialiser would quote anything it cannot prove is safe. The text
 * is carried through unchanged apart from the `z` to `Z` fix-up applied by the
 * caller, so `T` versus space and the number of fractional digits all survive.
 */
function timestampScalar(text: string): Scalar {
  const scalar = new Scalar(text);
  scalar.type = 'PLAIN';
  return scalar;
}

function stringScalar(text: string): Scalar {
  const scalar = new Scalar(text);
  if (needsYamlQuoting(text)) scalar.type = 'QUOTE_DOUBLE';
  return scalar;
}

/** `{ "$type": "toml-local-time", "$value": "07:32:00" }`, matching toml-json. */
function tagMap(type: string, value: string): YAMLMap {
  const map = new YAMLMap();
  map.items.push(new Pair(new Scalar('$type'), new Scalar(type)));
  map.items.push(new Pair(new Scalar('$value'), stringScalar(value)));
  return map;
}

function floatScalar(text: string): Scalar {
  const normalised = text.replace(/^\+/, '');
  if (normalised === 'nan' || normalised === '-nan') return new Scalar(Number.NaN);
  return new Scalar(normalised === '-inf' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY);
}

const YAML_STRINGIFY_OPTIONS = {
  indent: 2,
  // No line folding: a folded plain scalar reads back the same but the emitted
  // text stops being predictable, which makes round trips harder to reason about.
  lineWidth: 0,
  defaultStringType: 'PLAIN' as const,
  defaultKeyType: 'PLAIN' as const,
  // Anchors are pointless here: the node tree is built fresh, with every alias
  // already expanded, and TOML has no references to point at.
  aliasDuplicateObjects: false,
};

function tomlValueToNode(
  value: TomlValue,
  path: string,
  depth: number,
  warnings: string[],
): Node {
  if (depth > MAX_DEPTH) {
    throw new ConvertError(`${label(path)}嵌套超过 ${MAX_DEPTH} 层，无法转换`);
  }

  if (isTomlTag(value)) {
    if (value.$type === 'toml-float') return floatScalar(value.$value);
    if (value.$type === 'toml-offset-date-time' && value.$value.endsWith('z')) {
      // TOML accepts `z` as the UTC designator, YAML's timestamp pattern only
      // knows `Z`. Emitting the verbatim text would quietly turn the value into
      // a plain string for every YAML 1.1 reader (and for this tool's own
      // parser, which follows that pattern), so the designator is upper-cased.
      const normalised = `${value.$value.slice(0, -1)}Z`;
      warnings.push(
        `“${path}” 的偏移日期时间 “${value.$value}” 里的 z 写成了 Z：YAML 的 timestamp 只认大写 Z（时刻不变）`,
      );
      return timestampScalar(normalised);
    }
    if (value.$type === 'toml-local-time') {
      warnings.push(
        `“${path}” 是 TOML 本地时间（${value.$value}）：YAML 的 timestamp 类型没有“只有时刻、没有日期”的写法，` +
          '已写成 $type 标签映射。它既没有被当成 UTC，也没有退化成普通字符串。',
      );
      return tagMap(value.$type, value.$value);
    }
    return timestampScalar(value.$value);
  }

  if (typeof value === 'string') return stringScalar(value);
  if (typeof value === 'boolean') return new Scalar(value);

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ConvertError(`“${path}” 不是有限数字，TOML 里应写成 inf/nan（解析器本应给它打标签）`);
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      warnings.push(
        `“${path}” 的整数 ${value} 超出 IEEE-754 安全整数范围（±9007199254740991）：YAML/JS 数字只有双精度，` +
          'TOML 原文里的精确值到这里已经无法还原。',
      );
    }
    return new Scalar(value);
  }

  if (Array.isArray(value)) {
    const seq = new YAMLSeq();
    value.forEach((item, index) => {
      seq.items.push(tomlValueToNode(item, `${path}[${index}]`, depth + 1, warnings));
    });
    return seq;
  }

  const map = new YAMLMap();
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === '' ? key : `${path}.${key}`;
    map.items.push(new Pair(stringScalar(key), tomlValueToNode(child, childPath, depth + 1, warnings)));
  }
  return map;
}

/**
 * Guard for a prototype-pollution hole in the shared TOML parser.
 *
 * `parseToml` assigns keys with plain bracket assignment, so a `[__proto__]`
 * header resolves to `Object.prototype` and the following key/value pairs are
 * written onto `Object.prototype` itself — a global side effect from a single
 * pasted document. A `__proto__` *value* is silently dropped for the same
 * reason. Neither can be repaired from the outside, so such input is refused
 * before the parser runs. (Reported to the owner of `toml-json`; this module
 * does not modify that file.)
 */
const TOML_PROTO_KEY =
  /(?:^|[\s[,{.])["']?__proto__["']?\s*=|\[\s*["']?__proto__["']?\s*\]/m;

export function tomlToYaml(source: string): ConvertResult {
  const warnings: string[] = [];

  if (!source.trim()) return { ok: false, text: '', error: '请输入 TOML 内容', warnings };
  if (source.length > MAX_INPUT_BYTES) {
    return {
      ok: false,
      text: '',
      error: `输入过大（${Math.round(source.length / 1024)} KB），上限为 ${Math.round(MAX_INPUT_BYTES / 1024)} KB`,
      warnings,
    };
  }
  if (TOML_PROTO_KEY.test(source)) {
    return {
      ok: false,
      text: '',
      error:
        '输入里出现了 __proto__ 键。复用的 TOML 解析器（toml-json）对这类键会写坏 Object.prototype 或直接丢掉该键，' +
        '本工具在解析前就拒绝，请改用别的键名。',
      warnings,
    };
  }

  const parsed = parseToml(source);
  if (!parsed.ok || parsed.value === undefined) {
    return { ok: false, text: '', error: parsed.error ?? 'TOML 解析失败', warnings };
  }

  // The shared parser reports big-integer precision loss without saying which
  // key it was; that warning is replaced below by one that carries a path. Its
  // other warnings (a float that overflows to inf) are kept as they are.
  for (const warning of parsed.warnings) {
    if (!warning.includes('JSON 数字会丢失精度')) warnings.push(warning);
  }

  let node: Node;
  try {
    node = tomlValueToNode(parsed.value, '', 0, warnings);
  } catch (error) {
    if (error instanceof ConvertError) return { ok: false, text: '', error: error.message, warnings };
    return { ok: false, text: '', error: `内部错误：${String(error)}`, warnings };
  }

  const document = new Document(node as YAMLMap);
  let text: string;
  try {
    text = stringify(document, YAML_STRINGIFY_OPTIONS);
  } catch (error) {
    return {
      ok: false,
      text: '',
      error: `无法序列化为 YAML：${error instanceof Error ? error.message : String(error)}`,
      warnings,
    };
  }

  if (!text.endsWith('\n')) text += '\n';
  return { ok: true, text, warnings };
}

/* ------------------------------------------------------------------ *
 * YAML to TOML
 * ------------------------------------------------------------------ */

const YAML_PARSE_OPTIONS = {
  // `core` is YAML 1.2 core: plain `yes` stays a string and `1_000` stays a
  // string, unlike a 1.1 reader. Timestamps are layered on top by hand below,
  // because the type repository defines them even though core does not.
  schema: 'core' as const,
  // `<<` merge keys are a non-standard extension; off, so the key stays literal.
  merge: false,
  // Duplicate keys are errors rather than "last one wins".
  uniqueKeys: true,
  // Problems surface through `doc.errors` / `doc.warnings`, not the console.
  logLevel: 'silent' as const,
  // Read integers exactly; otherwise 9223372036854775807 silently becomes
  // ...776000 before there is any chance to warn about it.
  intAsBigInt: true,
};

interface WalkState {
  warnings: string[];
  aliases: number;
  /** Collection nodes currently being expanded, to catch recursive aliases. */
  stack: Set<unknown>;
}

function convertScalarNode(node: Scalar, path: string, state: WalkState): ModelValue {
  const isTimestamp = node.tag === TIMESTAMP_TAG;
  const looksLikeTimestamp = node.tag === undefined && node.type === 'PLAIN' && typeof node.value === 'string';

  if (isTimestamp || looksLikeTimestamp) {
    const text = typeof node.source === 'string' ? node.source : String(node.value);
    const tagged = parseYamlTimestamp(text);
    if (tagged !== null) {
      if (tagged.$value !== text) {
        state.warnings.push(
          `${label(path)}的 YAML 时间戳 “${text}” 已规范化为 TOML 的 ${tagged.$type} ${tagged.$value}`,
        );
      }
      return tagged;
    }
    if (isTimestamp || YAML_DATE_TIME.test(text) || YAML_DATE_ONLY.test(text)) {
      throw new ConvertError(
        `${label(path)}的 “${text}” 看起来是时间戳，但里面的日期或时间不合法（PyYAML 对这种输入同样报错）`,
      );
    }
  }

  const value = node.value;

  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    const special = Number.isNaN(value) ? 'nan' : value > 0 ? 'inf' : '-inf';
    return { $type: 'toml-float', $value: special };
  }

  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      const beyondInt64 = value > 9223372036854775807n || value < -9223372036854775808n;
      state.warnings.push(
        `${label(path)}的整数 ${value} 超出 IEEE-754 安全整数范围（±9007199254740991），` +
          `写出的 TOML 会丢精度${beyondInt64 ? '；它同时超出 TOML 整数范围（±2^63-1），会变成浮点近似值' : ''}`,
      );
    }
    return Number(value);
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;

  if (value instanceof Date) {
    // Only reachable through an explicit tag the core schema resolved itself;
    // treat the wall clock reading as local rather than inventing an offset.
    state.warnings.push(`${label(path)}的时间戳被 YAML 解析器变成了 Date，已按本地时间处理`);
    return {
      $type: 'toml-local-date-time',
      $value:
        `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}` +
        `T${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`,
    };
  }

  const rendered = String(value);
  state.warnings.push(`${label(path)}的标量类型无法映射到 TOML，按字符串 ${JSON.stringify(rendered)} 处理`);
  return rendered;
}

function resolveAlias(node: Node, doc: Document, path: string, state: WalkState): Node {
  state.aliases += 1;
  if (state.aliases > MAX_ALIASES) {
    throw new ConvertError(
      `“${path}” 处的锚点/别名展开超过 ${MAX_ALIASES} 次，已中止（这通常是别名炸弹；展开后的内容会指数级增长）`,
    );
  }
  const target = (node as { resolve?: (document: Document) => Node | undefined }).resolve?.(doc);
  if (!target) throw new ConvertError(`${label(path)}的别名无法解析到锚点`);
  return target;
}

function convertKeyNode(node: Node | null, doc: Document, path: string, state: WalkState): string {
  if (node === null) throw new ConvertError(`${label(path)}里有一个没有名字的键，TOML 无法表示`);
  let key = node;
  if (isAlias(key)) key = resolveAlias(key, doc, path, state);
  if (!isScalar(key)) {
    throw new ConvertError(
      `${label(path)}的键是${isSeq(key) ? '序列' : '映射'}：YAML 允许复杂键，TOML 只允许字符串键，无法表示`,
    );
  }
  if (typeof key.value !== 'string') {
    throw new ConvertError(
      `${label(path)}的键是${show(key.value)}（不是字符串）：TOML 只允许字符串键。` +
        '如果本意就是字符串键，请在 YAML 里给键加引号（例如 "1"）；否则请换一个键名。',
    );
  }
  return key.value;
}

function convertNode(node: Node, doc: Document, path: string, depth: number, state: WalkState): ModelValue {
  if (depth > MAX_DEPTH) {
    throw new ConvertError(`${label(path)}嵌套超过 ${MAX_DEPTH} 层，无法转换`);
  }

  if (isAlias(node)) {
    return convertNode(resolveAlias(node, doc, path, state), doc, path, depth, state);
  }

  if (isScalar(node)) return convertScalarNode(node, path, state);

  if (isMap(node) || isSeq(node)) {
    // An alias that points back at a collection we are already inside would
    // recurse forever; TOML cannot express a reference anyway.
    if (state.stack.has(node)) {
      throw new ConvertError(`${label(path)}通过别名指向了自己（递归引用），TOML 没有引用语义，无法表示`);
    }
    state.stack.add(node);
    try {
      if (isSeq(node)) {
        return node.items.map((item, index) =>
          convertNode(item as Node, doc, `${path}[${index}]`, depth + 1, state),
        );
      }
      // A null-prototype object so a `__proto__` key becomes an ordinary own
      // property instead of reaching Object.prototype through the setter.
      const object = Object.create(null) as ModelObject;
      for (const pair of node.items) {
        const key = convertKeyNode(pair.key as Node | null, doc, path, state);
        const childPath = path === '' ? key : `${path}.${key}`;
        if (Object.prototype.hasOwnProperty.call(object, key)) {
          throw new ConvertError(`${label(path)}里有两个键在 TOML 里会变成同一个名字：“${key}”`);
        }
        if (key === '__proto__') {
          state.warnings.push('键 “__proto__” 会作为普通字段写进 TOML，请注意下游代码的兼容性');
        }
        const child = pair.value as Node | null;
        object[key] = child === null ? null : convertNode(child, doc, childPath, depth + 1, state);
      }
      // The same two-key tag convention toml-json uses, so a hand-written
      // { "$type": ..., "$value": ... } map is honoured in both directions.
      if (isTomlTag(object)) return object;
      return object;
    } finally {
      state.stack.delete(node);
    }
  }

  throw new ConvertError(`${label(path)}出现了无法识别的 YAML 节点`);
}

export function yamlToToml(source: string): ConvertResult {
  const warnings: string[] = [];

  if (!source.trim()) return { ok: false, text: '', error: '请输入 YAML 内容', warnings };
  if (source.length > MAX_INPUT_BYTES) {
    return {
      ok: false,
      text: '',
      error: `输入过大（${Math.round(source.length / 1024)} KB），上限为 ${Math.round(MAX_INPUT_BYTES / 1024)} KB`,
      warnings,
    };
  }

  let documents: ReturnType<typeof parseAllDocuments>;
  try {
    documents = parseAllDocuments(source, YAML_PARSE_OPTIONS);
  } catch (error) {
    return {
      ok: false,
      text: '',
      error: `YAML 解析失败：${error instanceof Error ? firstLine(error.message) : String(error)}`,
      warnings,
    };
  }

  const first = documents[0];
  if (!first) return { ok: true, text: '', warnings: [...warnings, 'YAML 文档是空的，按空表处理'] };

  if (first.errors.length > 0) {
    return { ok: false, text: '', error: formatParseError(first.errors[0]), warnings };
  }
  for (const warning of first.warnings) {
    warnings.push(`YAML 警告：${firstLine(warning.message)}`);
  }
  if (documents.length > 1) {
    warnings.push(`源文件包含 ${documents.length} 个 YAML 文档，这里只转换了第一个（其余可分段粘贴）`);
  }

  // `contents === null` means "no document at all" (empty or comments only),
  // which is an empty TOML document — different from an explicit `null`, which
  // is reported below.
  if (first.contents === null) {
    warnings.push('YAML 文档是空的（或只有注释），按空表处理');
    return { ok: true, text: '', warnings };
  }

  const state: WalkState = { warnings, aliases: 0, stack: new Set<unknown>() };
  let model: ModelValue;
  try {
    model = convertNode(first.contents, first, '', 0, state);
  } catch (error) {
    if (error instanceof ConvertError) return { ok: false, text: '', error: error.message, warnings };
    return { ok: false, text: '', error: `内部错误：${String(error)}`, warnings };
  }

  if (state.aliases > 0) {
    warnings.push(
      `已就地展开 ${state.aliases} 处锚点/别名：TOML 没有引用语义，共享的内容会重复写出来`,
    );
  }

  if (model === null) {
    return {
      ok: false,
      text: '',
      error: '顶层是 null：TOML 没有 null，无法表示。空文档会按空表处理，显式的 null 不会',
      warnings,
    };
  }
  if (isTomlTag(model)) {
    return {
      ok: false,
      text: '',
      error: `顶层是 ${model.$type} 标量（${model.$value}）：TOML 文档本身就是一张表，顶层必须是映射`,
      warnings,
    };
  }
  if (!isPlainModel(model)) {
    return {
      ok: false,
      text: '',
      error: `顶层是${show(model)}：TOML 文档本身就是一张表，顶层必须是映射`,
      warnings,
    };
  }

  // The null check, the table / array-of-tables layout and the key escaping are
  // all the shared writer's job; JSON carries the tagged date-times unchanged.
  const written = jsonToToml(JSON.stringify(model));
  if (!written.ok) {
    return {
      ok: false,
      text: '',
      error: written.error?.includes('TOML 没有 null')
        ? `YAML 的 null 无法用 TOML 表示。${written.error}`
        : (written.error ?? '写出 TOML 失败'),
      warnings,
    };
  }

  return { ok: true, text: written.text, warnings };
}

/* ------------------------------------------------------------------ *
 * Documentation and samples shown in the UI
 * ------------------------------------------------------------------ */

export const MAPPING_NOTES: readonly string[] = [
  '两个格式的类型系统不同构，映射方式不唯一。下面这套约定往返稳定（数值深等价），但不保留注释与原始排版。',
  '日期时间：TOML 的偏移日期时间、本地日期时间、本地日期直接写成 YAML 的 timestamp 标量。没有时区偏移的 timestamp 在 YAML 里就是“本地墙上时间”，所以 TOML 的本地日期时间原样保留，绝不会被换算成 UTC。',
  'TOML 的本地时间（如 07:32:00）在 YAML 里没有对应类型。它写成两个键的映射 { "$type": "toml-local-time", "$value": "07:32:00" }（与 TOML 转 JSON 工具同一套标签），既保住类型又能往返。写成裸标量是不行的：YAML 1.1 的读取器（含 PyYAML）会把 17:32:00 当成六十进制整数 63120。',
  'YAML 的 timestamp 允许 1 位月/日（2001-1-1T00:00:00）和 +5 这类偏移，TOML 不允许，会被规范化成 2001-01-01T00:00:00+05:00 并给出提示。反过来，TOML 允许用小写 z 表示 UTC，而 YAML 的 timestamp 模式只认大写 Z，所以 z 会写成 Z（时刻不变，只是文字）。',
  'YAML 的 null 在 TOML 里没有对应物：转换会明确报错并指出是哪个键，不会静默丢弃。空文档（或只有注释）按空表处理，显式写的 null 不会。',
  'YAML 的键可以是数字、布尔、null 甚至集合，TOML 只允许字符串键：非字符串键会报错并给出键名，请给键加引号（"1"）或改名。',
  '数字方面 JS 只有双精度浮点：超出 IEEE-754 安全整数范围（±9007199254740991）的整数会丢精度，两个方向都会给出警告。TOML 的 1.0 往返后会变成 1，inf / -inf / nan 用 YAML 原生的 .inf / -.inf / .nan。',
  'YAML 的锚点与别名会被就地展开成重复内容（TOML 没有引用语义）；展开次数超过 100 次的输入按别名炸弹拒绝。YAML 只允许一个文档，多余文档会提示。',
  '生成的 YAML 里，凡是别的读取器会解析成另一个值的字符串（yes、1_000、17:32:00、2001-12-15 等），以及含制表符或 U+0085 / U+2028 / U+2029 这类会改变含义的字符，都会加上引号。解析则遵循 YAML 1.2 core，另加 timestamp 类型。',
  '不做：不保留注释和原始格式，不校验业务语义，不联网、不读文件。',
];

export const SAMPLE_TOML = `# 一个覆盖主要类型的 TOML 文档
title = "小麦的工具站"
enabled = true
port = 8_080
ratio = 1.5
limit = inf
big = 9_223_372_036_854_775_807

[owner]
name = "张三"
born = 1979-05-27T07:32:00Z
local = 1979-05-27 07:32:00.999
day = 1979-05-27
alarm = 07:32:00

[owner.address]
city = "上海"
tags = ["烘焙", "实用"]

[[books]]
id = "bk101"
title = """多行
文本，反斜杠续行 \\
    会被合并"""

[[books]]
id = "bk102"
note = '字面量 \\n 不转义'
inline = { a = 1, b = { c = 2 } }
`;

export const SAMPLE_YAML = `# 一个覆盖主要类型的 YAML 文档
title: 小麦的工具站
enabled: true
port: 8080
ratio: 1.5
limit: .inf
born: 2001-12-15T02:59:43.1Z
local: 2001-12-15 02:59:43
day: 2001-12-15
alarm:
  $type: toml-local-time
  $value: "07:32:00"
owner: &owner
  name: 张三
  city: 上海
tags:
  - 烘焙
  - 实用
books:
  - id: bk101
    title: |
      多行
      文本
  - id: bk102
    note: '字面量 \\n 不转义'
copy: *owner
emptyMap: {}
emptyList: []
`;
