/**
 * XML ↔ JSON conversion.
 *
 * Two things live here and they are deliberately separated:
 *
 *   1. A hand-written, strict XML parser. The project has no XML dependency
 *      (only `yaml`), and pulling one in would cost more than it saves: the
 *      parser below is a couple hundred lines, has no transitive weight, and —
 *      most importantly — can be made to *refuse* DTDs outright. That refusal
 *      is a security property (XXE), not a nicety, so owning the parser is the
 *      point rather than an accident.
 *
 *   2. A mapping between the XML tree and JSON. XML and JSON are not
 *      isomorphic — attributes versus elements, text interleaved with child
 *      elements, document order — so there is **no single correct mapping**.
 *      Ours is one convention out of many, it is documented in full in the UI,
 *      and it is lossy: see the notes on every rule below. Claiming a lossless
 *      round trip would be a lie, so nothing here pretends otherwise.
 *
 * The parser keeps text nodes verbatim (no whitespace collapsing at parse
 * time); trimming is a *mapping* decision and happens in `elementToJson`, so
 * the tree can be compared against an independent parser without hidden
 * normalisation.
 */

export interface XmlAttribute {
  name: string;
  value: string;
}

export interface XmlElement {
  type: 'element';
  name: string;
  attributes: XmlAttribute[];
  children: XmlNode[];
  selfClosing: boolean;
}

export interface XmlText {
  type: 'text';
  value: string;
  /** True when the text came from a CDATA section. Recorded for diagnostics only. */
  cdata: boolean;
}

export interface XmlComment {
  type: 'comment';
  value: string;
}

export interface XmlProcessingInstruction {
  type: 'pi';
  target: string;
  data: string;
}

export type XmlNode = XmlElement | XmlText | XmlComment | XmlProcessingInstruction;

export interface XmlDocument {
  children: XmlNode[];
}

export type XmlParseResult =
  | { ok: true; document: XmlDocument; warnings: string[] }
  | { ok: false; error: string; line: number; column: number };

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/* ------------------------------------------------------------------ *
 * Character classes
 * ------------------------------------------------------------------ */

/**
 * XML NameStartChar / NameChar, approximated with Unicode property escapes.
 *
 * The XML spec lists explicit code point ranges; `\p{L}` etc. covers the
 * overwhelming majority and is what a hand-written parser can reasonably do.
 * The practical consequence is that a handful of exotic combining marks are
 * rejected rather than accepted — a strict parser erring on the strict side.
 */
const NAME_START = /[\p{L}\p{Nl}_:]/u;
// The hyphen sits last so it is a literal inside the class.
const NAME_CHAR = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}.:\u00B7\u203F\u2040-]/u;

/** XML 1.0 Char production. Everything else (NUL, most C0 controls, U+FFFE) is illegal. */
function isXmlChar(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

function describeChar(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

function validateChars(value: string, where: string, fail: (message: string) => never): void {
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if (!isXmlChar(cp)) {
      fail(`${where}中存在 XML 不允许的字符 ${describeChar(ch)}（XML 1.0 禁止控制字符）`);
    }
  }
}

export function isValidXmlName(name: string): boolean {
  if (name.length === 0) return false;
  const chars = [...name];
  if (!NAME_START.test(chars[0])) return false;
  for (let i = 1; i < chars.length; i += 1) {
    if (!NAME_CHAR.test(chars[i])) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Parser
 * ------------------------------------------------------------------ */

class XmlParseError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = 'XmlParseError';
    this.line = line;
    this.column = column;
  }
}

const PREDEFINED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

class XmlParser {
  private readonly src: string;
  private pos = 0;

  constructor(src: string) {
    // A leading byte order mark is a byte-level artifact; the string we get is
    // already decoded, so drop it instead of failing on it.
    const withoutBom = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
    // XML 1.0 line-end normalisation: an XML processor must behave as if every
    // CRLF and lone CR had been a single LF. This is done up front so it also
    // applies inside CDATA and attribute values, exactly as the spec requires.
    // Character references such as `&#13;` are untouched, which is why the
    // serialiser emits them for literal carriage returns.
    this.src = withoutBom.replace(/\r\n?/g, '\n');
  }

  parse(): XmlDocument {
    const children: XmlNode[] = [];
    let rootSeen = false;

    for (;;) {
      this.skipWhitespace();
      if (this.eof()) break;

      if (this.startsWith('<!--')) {
        children.push(this.readComment());
        continue;
      }
      if (this.startsWith('<?')) {
        children.push(this.readProcessingInstruction());
        continue;
      }
      if (this.startsWith('<!')) {
        this.rejectDeclaration();
      }
      if (this.peek() === '<') {
        if (rootSeen) this.fail('文档只能有一个根元素，此处出现了第二个元素');
        children.push(this.readElement());
        rootSeen = true;
        continue;
      }
      this.fail(rootSeen ? '根元素之后不允许出现文本内容' : '根元素之前不允许出现文本内容');
    }

    if (!rootSeen) this.fail('文档没有根元素');
    return { children };
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
    if (!this.startsWith(token)) {
      this.fail(`期望 "${token}"`);
    }
    this.pos += token.length;
  }

  private skipWhitespace(): void {
    while (this.pos < this.length) {
      const ch = this.src[this.pos];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') this.pos += 1;
      else break;
    }
  }

  private locate(index: number): { line: number; column: number } {
    const before = this.src.slice(0, index);
    const lastBreak = before.lastIndexOf('\n');
    return {
      line: before.split('\n').length,
      column: index - lastBreak,
    };
  }

  private fail(message: string): never {
    const { line, column } = this.locate(this.pos);
    throw new XmlParseError(message, line, column);
  }

  private readName(what: string): string {
    const start = this.pos;
    const first = this.peek();
    if (first === '' || !NAME_START.test(first)) {
      this.fail(`${what}不是合法的 XML 名称`);
    }
    this.pos += 1;
    while (this.pos < this.length && NAME_CHAR.test(this.src[this.pos])) this.pos += 1;
    return this.src.slice(start, this.pos);
  }

  /**
   * Refuse anything that could define or pull in an entity.
   *
   * This is the XXE guard and it is intentionally blunt: a document that wants
   * a DTD is rejected rather than sanitised, because stripping a DOCTYPE while
   * leaving `&custom;` references behind turns a clear rejection into a
   * confusing "undefined entity" error.
   */
  private rejectDeclaration(): never {
    const rest = this.src.slice(this.pos, this.pos + 16).toUpperCase();
    if (rest.startsWith('<!DOCTYPE')) {
      this.fail(
        '拒绝处理 DTD（<!DOCTYPE）：DTD 可以声明外部实体，是 XXE（XML 外部实体注入）攻击的入口',
      );
    }
    if (rest.startsWith('<!ENTITY')) {
      this.fail('拒绝处理实体声明（<!ENTITY）：本工具只支持 5 个预定义实体');
    }
    this.fail('不支持的 XML 声明；只支持注释、CDATA 与处理指令');
  }

  /* -------------------- node readers -------------------- */

  private readComment(): XmlComment {
    this.expect('<!--');
    const end = this.src.indexOf('-->', this.pos);
    if (end === -1) this.fail('注释没有闭合（缺少 -->）');
    const value = this.src.slice(this.pos, end);
    if (value.includes('--')) this.fail('注释内容不能包含连续的两个连字符（--）');
    if (value.endsWith('-')) this.fail('注释内容不能以连字符结尾');
    validateChars(value, '注释', (message) => this.fail(message));
    this.pos = end + 3;
    return { type: 'comment', value };
  }

  private readCdata(): XmlText {
    this.expect('<![CDATA[');
    const end = this.src.indexOf(']]>', this.pos);
    if (end === -1) this.fail('CDATA 段没有闭合（缺少 ]]>）');
    const value = this.src.slice(this.pos, end);
    validateChars(value, 'CDATA', (message) => this.fail(message));
    this.pos = end + 3;
    return { type: 'text', value, cdata: true };
  }

  private readProcessingInstruction(): XmlProcessingInstruction {
    const start = this.pos;
    this.expect('<?');
    const target = this.readName('处理指令目标');
    if (target.toLowerCase() === 'xml' && start !== 0) {
      this.fail('XML 声明（<?xml ...?>）只能出现在文档最开头');
    }
    this.skipWhitespace();
    const end = this.src.indexOf('?>', this.pos);
    if (end === -1) this.fail('处理指令没有闭合（缺少 ?>）');
    const data = this.src.slice(this.pos, end);
    validateChars(data, '处理指令', (message) => this.fail(message));
    this.pos = end + 2;
    return { type: 'pi', target, data };
  }

  private readElement(): XmlElement {
    this.expect('<');
    const name = this.readName('元素名');
    const attributes: XmlAttribute[] = [];
    const seen = new Set<string>();

    for (;;) {
      const beforeSeparator = this.pos;
      this.skipWhitespace();
      const separated = this.pos > beforeSeparator;
      if (this.startsWith('/>')) {
        this.pos += 2;
        return { type: 'element', name, attributes, children: [], selfClosing: true };
      }
      if (this.peek() === '>') {
        this.pos += 1;
        break;
      }
      if (this.eof()) this.fail(`元素 <${name}> 的开始标签没有闭合`);
      // XML requires whitespace between attributes; without this check
      // `<a b="1"c="2"/>` would be accepted even though every conforming
      // parser rejects it.
      if (!separated) this.fail('属性之间必须有空格');

      const attributeName = this.readName('属性名');
      const expanded = attributeName.toLowerCase();
      if (seen.has(attributeName)) {
        this.fail(`元素 <${name}> 上出现了重复属性 "${attributeName}"`);
      }
      // XML forbids two attributes whose names differ only in case on the same
      // element. Duplicate detection above is case sensitive, so this is the
      // second half of the rule.
      for (const existing of seen) {
        if (existing.toLowerCase() === expanded) {
          this.fail(`元素 <${name}> 上的属性 "${attributeName}" 与 "${existing}" 只有大小写不同`);
        }
      }
      seen.add(attributeName);

      this.skipWhitespace();
      this.expect('=');
      this.skipWhitespace();
      const quote = this.peek();
      if (quote !== '"' && quote !== "'") this.fail(`属性 "${attributeName}" 的值必须用引号括起来`);
      this.pos += 1;
      const close = this.src.indexOf(quote, this.pos);
      if (close === -1) this.fail(`属性 "${attributeName}" 的值没有闭合的引号`);
      const raw = this.src.slice(this.pos, close);
      if (raw.includes('<')) this.fail(`属性 "${attributeName}" 的值中不能出现 "<"（应写成 &lt;）`);
      this.pos = close + 1;
      attributes.push({ name: attributeName, value: this.decodeEntities(raw, '属性值') });
    }

    const children = this.readContent(name);
    return { type: 'element', name, attributes, children, selfClosing: false };
  }

  private readContent(parent: string): XmlNode[] {
    const children: XmlNode[] = [];

    for (;;) {
      if (this.eof()) this.fail(`元素 <${parent}> 没有结束标签`);

      if (this.startsWith('</')) {
        this.pos += 2;
        const closeName = this.readName('结束标签名');
        this.skipWhitespace();
        this.expect('>');
        if (closeName !== parent) {
          this.fail(`结束标签 </${closeName}> 与开始标签 <${parent}> 不匹配`);
        }
        return children;
      }
      if (this.startsWith('<!--')) {
        children.push(this.readComment());
        continue;
      }
      if (this.startsWith('<![CDATA[')) {
        children.push(this.readCdata());
        continue;
      }
      if (this.startsWith('<?')) {
        children.push(this.readProcessingInstruction());
        continue;
      }
      if (this.startsWith('<!')) {
        this.rejectDeclaration();
      }
      if (this.peek() === '<') {
        children.push(this.readElement());
        continue;
      }

      const start = this.pos;
      while (this.pos < this.length && this.src[this.pos] !== '<') this.pos += 1;
      const raw = this.src.slice(start, this.pos);
      if (raw.includes(']]>')) this.fail('文本中不能直接出现 "]]>"（应写成 ]]&gt; 或放进 CDATA）');
      children.push({ type: 'text', value: this.decodeEntities(raw, '文本'), cdata: false });
    }
  }

  /* -------------------- entity decoding -------------------- */

  /**
   * Expand character references and the five predefined entities.
   *
   * Anything else is an error. Because custom entities can only be declared in
   * a DTD, and DTDs are rejected, an undefined reference here means either a
   * typo or an XXE attempt — both deserve a hard stop rather than a silent pass
   * through that would leave `&xxe;` untouched in the output.
   */
  private decodeEntities(raw: string, where: string): string {
    validateChars(raw, where, (message) => this.fail(message));

    let out = '';
    let index = 0;
    while (index < raw.length) {
      const ch = raw[index];
      if (ch !== '&') {
        // Attribute-value normalisation: a literal tab, LF or CR becomes a
        // space, while the same character arriving through a character
        // reference is kept. Without this, `<a b="x&#9;y"/>` and a literal tab
        // would decode differently than every conforming parser decodes them.
        out += where === '属性值' && (ch === '\t' || ch === '\n' || ch === '\r') ? ' ' : ch;
        index += 1;
        continue;
      }
      const semi = raw.indexOf(';', index + 1);
      if (semi === -1) this.fail(`${where}中的 "&" 不是合法的实体引用（缺少分号）`);
      const body = raw.slice(index + 1, semi);
      if (body.length === 0) this.fail(`${where}中出现了空的实体引用 "&;"`);

      if (body.startsWith('#')) {
        const hex = body[1] === 'x' || body[1] === 'X';
        const digits = hex ? body.slice(2) : body.slice(1);
        const pattern = hex ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/;
        if (digits.length === 0 || !pattern.test(digits)) {
          this.fail(`${where}中的字符引用 "&${body};" 不是合法的码位`);
        }
        const codePoint = Number.parseInt(digits, hex ? 16 : 10);
        if (!Number.isFinite(codePoint) || codePoint > 0x10ffff || !isXmlChar(codePoint)) {
          this.fail(`${where}中的字符引用 "&${body};" 指向 XML 不允许的码位`);
        }
        out += String.fromCodePoint(codePoint);
      } else {
        const replacement = Object.prototype.hasOwnProperty.call(PREDEFINED_ENTITIES, body)
          ? PREDEFINED_ENTITIES[body]
          : undefined;
        if (replacement === undefined) {
          this.fail(
            `${where}中出现了未定义的实体引用 "&${body};"；本工具拒绝 DTD，因此只有 amp/lt/gt/quot/apos 与字符引用可用`,
          );
        }
        // A literal "<" is illegal in an attribute value, but the decoded form
        // of `&lt;` is not: this branch deliberately does not re-check it.
        out += replacement;
      }
      index = semi + 1;
    }
    return out;
  }
}

export function parseXml(text: string): XmlParseResult {
  try {
    const document = new XmlParser(text).parse();
    return { ok: true, document, warnings: [] };
  } catch (error) {
    if (error instanceof XmlParseError) {
      return { ok: false, error: error.message, line: error.line, column: error.column };
    }
    return { ok: false, error: `内部错误：${String(error)}`, line: 1, column: 1 };
  }
}

/** First (and, thanks to the parser, only) root element of a document. */
export function rootElement(document: XmlDocument): XmlElement | null {
  for (const node of document.children) {
    if (node.type === 'element') return node;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * XML to JSON
 * ------------------------------------------------------------------ */

export interface XmlToJsonOptions {
  /**
   * Trim text nodes (default true). Whitespace-only text between elements is
   * dropped when the element has element children, which is what makes
   * indented XML convert to clean JSON. Turning it off keeps every byte but
   * then every newline and indent becomes part of `#text`.
   */
  trimText?: boolean;
  /** Emit `#comment` keys (default false: comments are dropped). */
  keepComments?: boolean;
  /** Emit `#pi` keys for processing instructions (default true). */
  keepProcessingInstructions?: boolean;
  /** Attribute key prefix (default "@"). */
  attributePrefix?: string;
  /** Text key (default "#text"). */
  textKey?: string;
  /**
   * Wrap the result in a single-key object whose key is the root element name
   * (default true). Without the wrapper the root name is lost, which makes the
   * JSON impossible to turn back into XML without the user re-typing it.
   */
  wrapRoot?: boolean;
}

interface ResolvedXmlToJsonOptions {
  trimText: boolean;
  keepComments: boolean;
  keepProcessingInstructions: boolean;
  attributePrefix: string;
  textKey: string;
  wrapRoot: boolean;
}

function resolveXmlToJsonOptions(options: XmlToJsonOptions): ResolvedXmlToJsonOptions {
  return {
    trimText: options.trimText ?? true,
    keepComments: options.keepComments ?? false,
    keepProcessingInstructions: options.keepProcessingInstructions ?? true,
    attributePrefix: options.attributePrefix ?? '@',
    textKey: options.textKey ?? '#text',
    wrapRoot: options.wrapRoot ?? true,
  };
}

function collectText(element: XmlElement, options: ResolvedXmlToJsonOptions): string {
  const hasElementChild = element.children.some((child) => child.type === 'element');
  let text = '';
  for (const child of element.children) {
    if (child.type !== 'text') continue;
    if (!options.trimText) {
      text += child.value;
      continue;
    }
    if (hasElementChild && child.value.trim() === '') continue;
    text += child.value.trim();
  }
  return text;
}

function elementToJson(
  element: XmlElement,
  options: ResolvedXmlToJsonOptions,
  warnings: string[],
): JsonValue {
  const text = collectText(element, options);
  const childElements = element.children.filter((child): child is XmlElement => child.type === 'element');
  const comments = element.children.filter(
    (child): child is XmlComment => child.type === 'comment',
  );
  const instructions = element.children.filter(
    (child): child is XmlProcessingInstruction => child.type === 'pi',
  );

  if (
    element.attributes.length === 0 &&
    childElements.length === 0 &&
    (comments.length === 0 || !options.keepComments) &&
    (instructions.length === 0 || !options.keepProcessingInstructions)
  ) {
    // Scalar shorthand. An element with no attributes and no children is its
    // text, and an empty element is the empty string — `<a/>` and `<a></a>`
    // therefore produce the same JSON. That is a deliberate, documented loss.
    return text;
  }

  const result: JsonObject = {};
  for (const attribute of element.attributes) {
    result[options.attributePrefix + attribute.name] = attribute.value;
  }
  if (text !== '') result[options.textKey] = text;

  // Repeated sibling names become arrays; a name that occurs once stays a
  // scalar. This means the JSON shape depends on how many times a tag happens
  // to appear, which is the classic XML/JSON impedance mismatch and cannot be
  // fixed without adding a schema (or making every child an array, which is
  // just as surprising in the other direction).
  const grouped = new Map<string, JsonValue[]>();
  for (const child of childElements) {
    const list = grouped.get(child.name);
    const value = elementToJson(child, options, warnings);
    if (list) list.push(value);
    else grouped.set(child.name, [value]);
  }
  for (const [name, values] of grouped) {
    result[name] = values.length === 1 ? values[0] : values;
  }

  if (childElements.length > 0 && text !== '') {
    warnings.push(
      `元素 <${element.name}> 含混合内容（文本与子元素交错）：JSON 无法表示它们的相对顺序，文本已合并进 ${options.textKey}`,
    );
  }

  if (options.keepComments && comments.length > 0) {
    const values = comments.map((comment) => comment.value);
    result['#comment'] = values.length === 1 ? values[0] : values;
  }
  if (options.keepProcessingInstructions && instructions.length > 0) {
    const values = instructions.map((pi) => (pi.data ? `${pi.target} ${pi.data}` : pi.target));
    result['#pi'] = values.length === 1 ? values[0] : values;
  }

  return result;
}

export type XmlToJsonResult =
  | { ok: true; value: JsonValue; text: string; warnings: string[] }
  | { ok: false; error: string; line: number; column: number; warnings: string[] };

/** Parse XML and convert the root element to JSON. */
export function xmlToJson(xml: string, options: XmlToJsonOptions = {}, indent = 2): XmlToJsonResult {
  const parsed = parseXml(xml);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, line: parsed.line, column: parsed.column, warnings: [] };
  }

  const warnings: string[] = [];
  const resolved = resolveXmlToJsonOptions(options);
  const root = rootElement(parsed.document);
  if (!root) {
    return { ok: false, error: '文档没有根元素', line: 1, column: 1, warnings };
  }

  for (const node of parsed.document.children) {
    if (node === root) continue;
    if (node.type === 'comment') {
      warnings.push(
        resolved.keepComments
          ? '根元素之前的注释没有归属元素，未写入 JSON'
          : '文档级注释被丢弃（可打开「保留注释」开关）',
      );
    } else if (node.type === 'pi') {
      if (node.target.toLowerCase() !== 'xml') {
        warnings.push(
          resolved.keepProcessingInstructions
            ? '根元素之前的处理指令没有归属元素，未写入 JSON'
            : '文档级处理指令被丢弃',
        );
      }
    } else if (node.type === 'text' && node.value.trim() !== '') {
      warnings.push('根元素之外的文本内容被忽略');
    }
  }

  const value = elementToJson(root, resolved, warnings);
  if (!resolved.wrapRoot) {
    warnings.push(`已关闭顶层包装：根元素名 "${root.name}" 未写入 JSON，转回 XML 时需要手动指定根元素名`);
    return { ok: true, value, text: JSON.stringify(value, null, indent > 0 ? indent : 0), warnings };
  }
  const wrapped: JsonObject = { [root.name]: value };
  return { ok: true, value: wrapped, text: JSON.stringify(wrapped, null, indent > 0 ? indent : 0), warnings };
}

/* ------------------------------------------------------------------ *
 * JSON to XML
 * ------------------------------------------------------------------ */

export interface JsonToXmlOptions {
  /** Indentation for the output (default 2; 0 writes everything on one line). */
  indent?: number;
  /** Write the `<?xml version="1.0" encoding="UTF-8"?>` prolog (default true). */
  declaration?: boolean;
  /**
   * When set, the whole JSON value becomes the content of this root element.
   * When absent, the top level must be an object with exactly one key, and that
   * key names the root element.
   */
  rootName?: string;
  /**
   * What to do with keys that are not valid XML names. `error` (default) reports
   * them; `sanitize` replaces offending characters with an underscore and
   * prefixes a digit-leading name with an underscore, which is lossy.
   */
  nameFix?: 'error' | 'sanitize';
  attributePrefix?: string;
  textKey?: string;
}

interface ResolvedJsonToXmlOptions {
  indent: number;
  declaration: boolean;
  rootName?: string;
  nameFix: 'error' | 'sanitize';
  attributePrefix: string;
  textKey: string;
}

export type JsonToXmlResult =
  | { ok: true; text: string; warnings: string[] }
  | { ok: false; error: string; line?: number; column?: number; warnings: string[] };

class JsonToXmlError extends Error {}

function isPlainObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeName(name: string): string {
  const chars = [...name];
  if (chars.length === 0) return '_';
  let out = '';
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (i === 0 && !NAME_START.test(ch) && NAME_CHAR.test(ch)) {
      // A digit, hyphen or combining mark is legal inside a name but not at the
      // start. Prefixing instead of replacing keeps the character, so "1a"
      // becomes "_1a" rather than "_a".
      out += `_${ch}`;
      continue;
    }
    const legal = i === 0 ? NAME_START.test(ch) : NAME_CHAR.test(ch);
    out += legal ? ch : '_';
  }
  if (!NAME_START.test([...out][0] ?? '')) out = `_${out}`;
  return out;
}

function toAttributeText(value: JsonValue, key: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new JsonToXmlError(`属性 "${key}" 的值不是有限数字，XML 无法表示`);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) throw new JsonToXmlError(`属性 "${key}" 的值是 null，XML 没有 null`);
  throw new JsonToXmlError(`属性 "${key}" 的值必须是字符串、数字或布尔值`);
}

function toTextContent(value: JsonValue, key: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new JsonToXmlError(`"${key}" 的值不是有限数字，XML 无法表示`);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) throw new JsonToXmlError(`"${key}" 的值是 null；XML 没有 null，请用空元素或空字符串`);
  throw new JsonToXmlError(`"${key}" 的值必须是字符串、数字或布尔值`);
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
}

function escapeAttribute(value: string): string {
  return escapeText(value)
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    .replace(/\t/g, '&#9;');
}

interface RenderContext {
  options: ResolvedJsonToXmlOptions;
  warnings: string[];
}

function checkCharacters(value: string, where: string): void {
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if (!isXmlChar(cp)) {
      throw new JsonToXmlError(`${where}含 XML 不允许的字符 ${describeChar(ch)}（XML 1.0 禁止控制字符）`);
    }
  }
}

function renderName(rawName: string, context: RenderContext, path: string): string {
  if (isValidXmlName(rawName)) return rawName;
  if (context.options.nameFix === 'sanitize') {
    const fixed = sanitizeName(rawName);
    context.warnings.push(`键 "${path}" 不是合法的 XML 元素名，已改成 "${fixed}"（有损）`);
    return fixed;
  }
  throw new JsonToXmlError(
    `"${rawName}" 不是合法的 XML 元素名（不能以数字开头，不能含空格、@、#、引号等）` +
      `；可在选项中开启「自动清洗非法名称」`,
  );
}

/** Index of a `#pi` value: split off the target, keep the rest as data. */
function splitInstruction(value: string): { target: string; data: string } {
  const trimmed = value.trim();
  const space = trimmed.search(/[\s]/);
  if (space === -1) return { target: trimmed, data: '' };
  return { target: trimmed.slice(0, space), data: trimmed.slice(space + 1) };
}

function renderElement(
  rawName: string,
  value: JsonValue,
  depth: number,
  context: RenderContext,
  path: string,
): string {
  const name = renderName(rawName, context, path);
  const { options } = context;
  const pad = options.indent > 0 ? ' '.repeat(options.indent * depth) : '';
  const childPad = options.indent > 0 ? ' '.repeat(options.indent * (depth + 1)) : '';
  const newline = options.indent > 0 ? '\n' : '';

  if (value === null) {
    // JSON null has no XML counterpart. "No content" is the closest thing, so
    // null becomes a self-closing element rather than an error. It is lossy in
    // the sense that `` empty string and null both come back as "".
    return `${pad}<${name}/>`;
  }

  if (Array.isArray(value)) {
    return value
      .map((item, index) => {
        if (Array.isArray(item)) {
          throw new JsonToXmlError(
            `"${path}" 是数组的数组；重复元素只能展开一层，嵌套数组无法映射`,
          );
        }
        return renderElement(name, item, depth, context, `${path}[${index}]`);
      })
      .join(newline);
  }

  if (isPlainObject(value)) {
    const attributes: string[] = [];
    const children: string[] = [];
    let text = '';

    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith(options.attributePrefix)) {
        const attributeName = key.slice(options.attributePrefix.length);
        if (!isValidXmlName(attributeName)) {
          throw new JsonToXmlError(`属性名 "${attributeName}" 不是合法的 XML 名称`);
        }
        const attributeText = toAttributeText(child, key);
        checkCharacters(attributeText, `属性 ${attributeName} 的值`);
        attributes.push(`${attributeName}="${escapeAttribute(attributeText)}"`);
        continue;
      }
      if (key === options.textKey) {
        text = toTextContent(child, key);
        checkCharacters(text, `元素 <${name}> 的文本`);
        continue;
      }
      if (key === '#comment') {
        const values = Array.isArray(child) ? child : [child];
        for (const item of values) {
          if (typeof item !== 'string') {
            throw new JsonToXmlError(`#comment 的值必须是字符串或字符串数组`);
          }
          if (item.includes('--')) throw new JsonToXmlError('注释内容不能包含连续的两个连字符（--）');
          if (item.endsWith('-')) throw new JsonToXmlError('注释内容不能以连字符结尾');
          checkCharacters(item, '注释');
          children.push(`${childPad}<!--${item}-->`);
        }
        continue;
      }
      if (key === '#pi') {
        const values = Array.isArray(child) ? child : [child];
        for (const item of values) {
          if (typeof item !== 'string') {
            throw new JsonToXmlError(`#pi 的值必须是字符串或字符串数组`);
          }
          const { target, data } = splitInstruction(item);
          if (!isValidXmlName(target)) throw new JsonToXmlError(`处理指令目标 "${target}" 不是合法的 XML 名称`);
          if (target.toLowerCase() === 'xml') throw new JsonToXmlError('不能生成目标为 xml 的处理指令');
          if (data.includes('?>')) throw new JsonToXmlError('处理指令内容不能包含 ?>');
          checkCharacters(data, '处理指令');
          children.push(`${childPad}<?${target}${data ? ` ${data}` : ''}?>`);
        }
        continue;
      }
      children.push(renderElement(key, child, depth + 1, context, `${path}.${key}`));
    }

    const attributeText = attributes.length > 0 ? ` ${attributes.join(' ')}` : '';

    if (children.length === 0) {
      if (text === '') return `${pad}<${name}${attributeText}/>`;
      // Text-only elements stay on one line even in pretty mode: re-indenting
      // text would change its value (the parser would see the added spaces).
      return `${pad}<${name}${attributeText}>${escapeText(text)}</${name}>`;
    }

    // Text next to child elements: everything readable about the original
    // interleaving is already gone by the time we see JSON, so the text is
    // emitted first. Documented as lossy.
    const textLine = text === '' ? '' : `${childPad}${escapeText(text)}${newline}`;
    return (
      `${pad}<${name}${attributeText}>${newline}` +
      textLine +
      children.join(newline) +
      `${newline}${pad}</${name}>`
    );
  }

  const content = toTextContent(value, path);
  checkCharacters(content, `元素 <${name}> 的文本`);
  return `${pad}<${name}>${escapeText(content)}</${name}>`;
}

export function jsonToXml(json: string, options: JsonToXmlOptions = {}): JsonToXmlResult {
  const warnings: string[] = [];
  const resolved: ResolvedJsonToXmlOptions = {
    indent: options.indent ?? 2,
    declaration: options.declaration ?? true,
    rootName: options.rootName,
    nameFix: options.nameFix ?? 'error',
    attributePrefix: options.attributePrefix ?? '@',
    textKey: options.textKey ?? '#text',
  };

  let parsedJson: JsonValue;
  try {
    parsedJson = JSON.parse(json) as JsonValue;
  } catch (error) {
    return { ok: false, error: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`, warnings };
  }

  const context: RenderContext = { options: resolved, warnings };
  const prolog = resolved.declaration ? '<?xml version="1.0" encoding="UTF-8"?>' : '';
  const newline = resolved.indent > 0 ? '\n' : '';

  try {
    let body: string;

    if (resolved.rootName !== undefined && resolved.rootName !== '') {
      if (Array.isArray(parsedJson)) {
        // Repeating the root element would produce several roots, which is not
        // a document. Naming the individual items is the caller's decision, so
        // this is reported rather than guessed.
        return {
          ok: false,
          error:
            '顶层是数组：把它作为根元素的内容会生成多个根元素（非法）。请指定具体的元素名，例如 { "root": { "item": [...] } }',
          warnings,
        };
      }
      body = renderElement(resolved.rootName, parsedJson, 0, context, resolved.rootName);
    } else if (isPlainObject(parsedJson)) {
      const keys = Object.keys(parsedJson);
      if (keys.length === 0) {
        return {
          ok: false,
          error: '顶层对象是空的，无法确定根元素名；请填写「根元素名」或改成 { "root": {} }',
          warnings,
        };
      }
      if (keys.length > 1) {
        return {
          ok: false,
          error:
            `顶层对象有 ${keys.length} 个键（${keys.slice(0, 4).join(', ')}…），XML 只能有一个根元素；` +
            '请包一层，例如 { "root": { ... } }，或指定「根元素名」',
          warnings,
        };
      }
      const [rootName] = keys;
      body = renderElement(rootName, parsedJson[rootName], 0, context, rootName);
    } else {
      return {
        ok: false,
        error: '顶层必须是对象；若要转换数组或标量，请先指定「根元素名」',
        warnings,
      };
    }

    // The declaration is always followed by a line break even in compact mode
    // (the prolog and the root tag running together is legal but unreadable);
    // a pretty-printed document also ends with one, like any text file.
    const text = `${prolog === '' ? '' : `${prolog}\n`}${body}${newline}`;
    return { ok: true, text, warnings };
  } catch (error) {
    if (error instanceof JsonToXmlError) return { ok: false, error: error.message, warnings };
    return { ok: false, error: `内部错误：${String(error)}`, warnings };
  }
}

/* ------------------------------------------------------------------ *
 * Shared documentation
 * ------------------------------------------------------------------ */

/**
 * The mapping contract, shown verbatim in the UI.
 *
 * It is a constant next to the code that implements it on purpose: if the rules
 * change, the text the user reads changes in the same edit.
 */
export const MAPPING_NOTES: readonly string[] = [
  'XML 与 JSON 不同构，映射方式不唯一。本工具采用的约定如下，且它是有损的：往返不保证回到原文（混合内容、注释、CDATA、数字与布尔类型都会变样）。',
  '顶层是单键对象，键就是根元素名：{ "catalog": { ... } }。这样 JSON → XML 才能确定根元素名；关闭这个开关后根元素名会丢失。',
  '元素 → 对象；属性 → 以 @ 开头的键（@id）；文本 → #text；重复出现的同名子元素 → 数组，只出现一次的 → 单个值（因此 JSON 的形状取决于标签出现的次数）。',
  '没有属性、没有子元素的内容直接映射为字符串；<a/> 与 <a></a> 都得到空字符串，二者无法区分。',
  '混合内容（文本与子元素交错）的顺序无法表示：#text 把所有文本按出现顺序拼接，元素之间的相对位置丢失。',
  '命名空间不做解析：前缀按字面保留（soap:Envelope、@xmlns:soap），因此 <a:x xmlns:a="u"/> 与 <b:x xmlns:b="u"/> 会得到不同的键。',
  'CDATA 与转义文本不做区分，都会被解码成普通文本；注释默认丢弃（可开启保留，键名 #comment）；处理指令映射为 #pi。',
  'JSON → XML 时 null 视为空元素 <a/>；数字与布尔值写成文本，转回 JSON 就是字符串，类型信息丢失。',
  'JSON → XML 时元素名必须是合法 XML 名称（不能以数字开头、不能含空格或 @ #），非法名称默认报错，也可开启自动清洗（会改名，有损）。',
];
