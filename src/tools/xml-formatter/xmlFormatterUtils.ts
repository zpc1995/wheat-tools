/**
 * XML formatting, minification and validation.
 *
 * ## Reuse
 *
 * The parser is **reused, not rewritten**: `parseXml` from the sibling tool
 * `src/tools/xml-json/xmlJsonUtils.ts` already returns a node tree (elements,
 * attributes, verbatim text, CDATA, comments, processing instructions) and
 * already reports failures with a line and a column. That is exactly the
 * interface this tool needs, and it is a *strict* parser, which matters more
 * here than anywhere else: a formatter that is lenient about tag balance would
 * happily "fix" malformed XML into something that looks valid.
 *
 * The file is read-only for this tool (another agent wrote it), so nothing here
 * changes it; only `parseXml` and the node types are imported. Two of its
 * properties shape the UI and are stated there explicitly:
 *
 *   1. It refuses `<!DOCTYPE` and `<!ENTITY` outright (the XXE guard), so a
 *      document with a DTD is rejected as a **policy** decision, not because it
 *      is malformed. Validating a DTD-bearing document is out of scope.
 *   2. It keeps text nodes byte for byte and flags CDATA, which is what makes
 *      "only whitespace changes" a claim that can be checked: the tree can be
 *      compared against an independent parser before and after.
 *
 * ## Why not regex
 *
 * Every "XML formatter" written with `replace(/>\s*</g, ...)` is broken in the
 * same three ways, and `scripts/check-xml-formatter.mjs` contains a naive
 * implementation plus assertions proving each failure:
 *
 *   - a `>` inside a CDATA section or a comment is not a tag boundary;
 *   - a `>` inside a quoted attribute value is not a tag boundary;
 *   - whitespace between two elements is insignificant, but whitespace inside
 *     an element that has no child elements is the content.
 *
 * Working on the parsed tree makes all three disappear: text and CDATA are
 * separate node types, attributes are already split out, and re-indentation is
 * only applied to elements whose children are exclusively elements, comments
 * or whitespace. Mixed content (text interleaved with elements) is emitted
 * verbatim, all the way down.
 */

import {
  parseXml,
  type XmlDocument,
  type XmlElement,
  type XmlNode,
} from '../xml-json/xmlJsonUtils';

/* ------------------------------------------------------------------ *
 * Options
 * ------------------------------------------------------------------ */

export type XmlFormatMode = 'pretty' | 'compact';
export type XmlIndentUnit = 'space' | 'tab';

export interface XmlFormatOptions {
  /** `pretty` re-indents; `compact` removes inter-element whitespace. */
  mode?: XmlFormatMode;
  /** Indent width in `pretty` mode (clamped to 0..16; 0 degrades to compact). */
  indent?: number;
  /** Indent character. Tabs ignore the width and repeat one tab per level. */
  indentUnit?: XmlIndentUnit;
  /** Put every attribute on its own line. */
  attributesOnNewLine?: boolean;
  /** Keep comments. When off they are dropped, which is a lossy operation. */
  preserveComments?: boolean;
}

interface ResolvedOptions {
  mode: XmlFormatMode;
  indent: number;
  indentUnit: XmlIndentUnit;
  attributesOnNewLine: boolean;
  preserveComments: boolean;
}

function resolveOptions(options: XmlFormatOptions): ResolvedOptions {
  const raw = options.indent ?? 2;
  const indent = Number.isFinite(raw) ? Math.min(16, Math.max(0, Math.floor(raw))) : 2;
  const requested = options.mode ?? 'pretty';
  return {
    // An indent of 0 produces no line breaks at all, which *is* compact mode;
    // normalising it here keeps the serializer from having two code paths that
    // disagree about what zero means.
    mode: requested === 'compact' || indent === 0 ? 'compact' : 'pretty',
    indent,
    indentUnit: options.indentUnit ?? 'space',
    attributesOnNewLine: options.attributesOnNewLine ?? false,
    preserveComments: options.preserveComments ?? true,
  };
}

/* ------------------------------------------------------------------ *
 * Escaping
 * ------------------------------------------------------------------ */

/**
 * Escapes text content.
 *
 * Carriage returns are escaped as a character reference because a literal one
 * would be normalised to a line feed by any conforming parser on the way back
 * in (`parseXml` does the same normalisation), so a text node can only contain
 * a CR if it arrived as `&#13;` — and it has to leave as one to survive.
 */
export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
}

/**
 * Escapes an attribute value.
 *
 * Tab, line feed and carriage return must go out as character references: a
 * literal one in the source is turned into a space by attribute-value
 * normalisation, so the only way a parsed value can contain one is via a
 * reference, and emitting it literally would silently change the value.
 */
export function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

/* ------------------------------------------------------------------ *
 * Serialisation
 * ------------------------------------------------------------------ */

interface SerializeContext {
  options: ResolvedOptions;
  warnings: string[];
}

function pad(context: SerializeContext, depth: number): string {
  if (context.options.mode === 'compact') return '';
  const unit = context.options.indentUnit === 'tab' ? '\t' : ' ';
  return context.options.indentUnit === 'tab'
    ? unit.repeat(depth)
    : unit.repeat(context.options.indent * depth);
}

/**
 * Whether an element's children may be re-arranged.
 *
 * Two conditions, and both are load-bearing:
 *
 *   - There must be at least one non-text child. Without it, a whitespace-only
 *     text node is the element's *content* (`<a> </a>` means a single space),
 *     not formatting between two tags, and dropping it would change the value.
 *   - Every text child must be whitespace that did not come from CDATA.
 *     Anything else is content or mixed content, where the exact number of
 *     spaces around a child element carries meaning.
 */
function canReflow(element: XmlElement): boolean {
  const elementLike = element.children.filter((child) => child.type !== 'text');
  if (elementLike.length === 0) return false;
  return element.children.every(
    (child) => child.type !== 'text' || (!child.cdata && child.value.trim() === ''),
  );
}

/** `xml:space` on this element, if it says anything about whitespace. */
function xmlSpace(element: XmlElement): 'preserve' | 'default' | null {
  for (const attribute of element.attributes) {
    if (attribute.name !== 'xml:space') continue;
    const value = attribute.value.trim().toLowerCase();
    if (value === 'preserve') return 'preserve';
    if (value === 'default') return 'default';
  }
  return null;
}

function serializeAttributes(
  element: XmlElement,
  depth: number,
  context: SerializeContext,
): string {
  if (element.attributes.length === 0) return '';
  const rendered = element.attributes.map(
    (attribute) => `${attribute.name}="${escapeXmlAttribute(attribute.value)}"`,
  );
  if (!context.options.attributesOnNewLine || context.options.mode === 'compact') {
    return ` ${rendered.join(' ')}`;
  }
  const inner = pad(context, depth + 1);
  return `\n${inner}${rendered.join(`\n${inner}`)}\n${pad(context, depth)}`;
}

/**
 * Serialises a node.
 *
 * `verbatim` means "this subtree is content, do not touch its whitespace". It
 * is set once a mixed-content element is met and stays set for everything below
 * it, so `<p>Hi <b>x</b> world</p>` keeps its single spaces no matter how deep
 * the inline markup goes.
 */
function serializeNode(
  node: XmlNode,
  depth: number,
  context: SerializeContext,
  verbatim: boolean,
): string {
  switch (node.type) {
    case 'text':
      // CDATA stays CDATA: converting it to escaped text would parse back to
      // the same string, but the author wrote a section and there is no reason
      // to rewrite it.
      return node.cdata ? `<![CDATA[${node.value}]]>` : escapeXmlText(node.value);
    case 'comment':
      return context.options.preserveComments
        ? `${verbatim ? '' : pad(context, depth)}<!--${node.value}-->`
        : '';
    case 'pi':
      // Same rule as comments: reflowed children carry their own indent, nodes
      // inside preserved content carry none.
      return `${verbatim ? '' : pad(context, depth)}<?${node.target}${
        node.data === '' ? '' : ` ${node.data}`
      }?>`;
    default:
      return serializeElement(node, depth, context, verbatim);
  }
}

function serializeElement(
  element: XmlElement,
  depth: number,
  context: SerializeContext,
  verbatim: boolean,
): string {
  // Indentation belongs to the parent's layout decision, so an element only
  // emits it when it is a reflowed child. Inside a verbatim subtree (mixed
  // content, or `xml:space="preserve"`) the leading whitespace is part of the
  // content: emitting it here turned `<p>Hi <b>x</b> y</p>` nested one level
  // down into `<p>Hi   <b>x</b> y</p>`, changing the text.
  const indent = verbatim ? '' : pad(context, depth);
  const open = `<${element.name}${serializeAttributes(element, depth, context)}`;

  if (element.children.length === 0) {
    // `<a/>` and `<a></a>` parse to the same tree; the distinction is kept
    // because "only whitespace changed" is a stronger promise than "the tree
    // is the same", and rewriting one into the other is a gratuitous edit.
    return element.selfClosing
      ? `${indent}${open}/>`
      : `${indent}${open}></${element.name}>`;
  }

  // `xml:space` is inherited, so the flag travels down. `default` cancels an
  // ancestor's `preserve`, which is what the attribute is for.
  const space = xmlSpace(element);
  let inner = verbatim;
  if (space === 'preserve') inner = true;
  else if (space === 'default') inner = false;
  if (!inner) inner = !canReflow(element);

  if (inner) {
    const body = element.children
      .map((child) => serializeNode(child, depth, context, true))
      .join('');
    return `${indent}${open}>${body}</${element.name}>`;
  }

  const kept = element.children.filter((child) => {
    if (child.type === 'comment' && !context.options.preserveComments) return false;
    if (child.type === 'text' && !child.cdata && child.value.trim() === '') return false;
    return true;
  });

  if (kept.length === 0) return `${indent}${open}></${element.name}>`;

  const separator = context.options.mode === 'compact' ? '' : '\n';
  // The separator carries no indentation of its own: every child emits its own
  // leading indent, and adding it in both places would double every level.
  const body = kept.map((child) => serializeNode(child, depth + 1, context, false)).join(separator);
  const closing = context.options.mode === 'compact' ? '' : `\n${indent}`;
  return `${indent}${open}>${separator}${body}${closing}</${element.name}>`;
}

function serializeDocument(document: XmlDocument, context: SerializeContext): string {
  const parts: string[] = [];
  for (const node of document.children) {
    // Whitespace between top-level nodes is formatting; text is not allowed
    // there anyway, so a stray one is dropped rather than emitted.
    if (node.type === 'text') continue;
    if (node.type === 'comment' && !context.options.preserveComments) continue;
    parts.push(serializeNode(node, 0, context, false));
  }
  const text = parts.join(context.options.mode === 'compact' ? '' : '\n');
  return context.options.mode === 'compact' ? text : `${text}\n`;
}

/* ------------------------------------------------------------------ *
 * Diagnostics that the parser cannot give
 * ------------------------------------------------------------------ */

/**
 * Checks that need the whole tree, not the token stream.
 *
 * These are reported as warnings rather than errors on purpose: the parser has
 * already decided what is malformed, and a formatter that refuses to format a
 * document over a debatable namespace complaint is less useful than one that
 * formats it and says what it noticed.
 */
function collectTreeWarnings(document: XmlDocument, warnings: string[]): void {
  const seenReserved = new Set<string>();

  const walk = (element: XmlElement, inherited: Set<string>): void => {
    const scope = new Set(inherited);
    for (const attribute of element.attributes) {
      if (attribute.name === 'xmlns') scope.add('');
      else if (attribute.name.startsWith('xmlns:')) scope.add(attribute.name.slice(6));
    }

    const checkName = (name: string, what: string) => {
      const colon = name.indexOf(':');
      if (colon > 0) {
        const prefix = name.slice(0, colon);
        if (prefix !== 'xml' && prefix !== 'xmlns' && !scope.has(prefix)) {
          warnings.push(
            `<${element.name}> 的${what} "${name}" 使用了未在作用域内声明的前缀 "${prefix}:"（命名空间前缀需要在 xmlns:${prefix} 里声明）`,
          );
        }
      }
      // XML reserves every name beginning with "xml" in any case. The `xml:`
      // prefix itself is bound by the specification (xml:lang, xml:space,
      // xml:base, xml:id), and `xmlns` / `xmlns:*` are the namespace
      // declarations, so those are the only accepted spellings.
      if (/^xml/i.test(name) && !/^xmlns(:|$)/i.test(name) && !/^xml:/i.test(name)) {
        if (!seenReserved.has(name)) {
          seenReserved.add(name);
          warnings.push(
            `${what} "${name}" 以保留前缀 xml 开头：XML 规范保留所有以 xml 开头的名称，只有 xml:lang / xml:space / xml:base / xml:id 等预定义名称与 xmlns 声明可以这样写`,
          );
        }
      }
    };

    checkName(element.name, '元素名');
    for (const attribute of element.attributes) {
      if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) continue;
      checkName(attribute.name, '属性名');
    }

    for (const child of element.children) {
      if (child.type === 'element') walk(child, scope);
    }
  };

  for (const node of document.children) {
    if (node.type === 'element') walk(node, new Set(['xml', 'xmlns']));
  }
}

export interface XmlStats {
  root: string;
  elements: number;
  attributes: number;
  comments: number;
  cdata: number;
  processingInstructions: number;
  maxDepth: number;
  textLength: number;
}

/** Counts what is in the document, for the validation report. */
export function xmlStats(document: XmlDocument): XmlStats {
  const stats: XmlStats = {
    root: '',
    elements: 0,
    attributes: 0,
    comments: 0,
    cdata: 0,
    processingInstructions: 0,
    maxDepth: 0,
    textLength: 0,
  };

  const walk = (node: XmlNode, depth: number): void => {
    switch (node.type) {
      case 'element':
        stats.elements += 1;
        stats.attributes += node.attributes.length;
        stats.maxDepth = Math.max(stats.maxDepth, depth);
        if (stats.root === '') stats.root = node.name;
        for (const child of node.children) walk(child, depth + 1);
        break;
      case 'text':
        if (node.cdata) stats.cdata += 1;
        stats.textLength += node.value.length;
        break;
      case 'comment':
        stats.comments += 1;
        break;
      case 'pi':
        stats.processingInstructions += 1;
        break;
      default:
        break;
    }
  };

  for (const node of document.children) walk(node, 0);
  return stats;
}

/* ------------------------------------------------------------------ *
 * Public entry points
 * ------------------------------------------------------------------ */

export type XmlFormatResult =
  | { ok: true; text: string; warnings: string[] }
  | { ok: false; error: string; line: number; column: number; warnings: string[] };

/**
 * Formats (or minifies) XML.
 *
 * Failure is a parse failure: the input is not XML, and the result says where.
 */
export function formatXml(source: string, options: XmlFormatOptions = {}): XmlFormatResult {
  const resolved = resolveOptions(options);
  const parsed = parseXml(source);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, line: parsed.line, column: parsed.column, warnings: [] };
  }

  const warnings: string[] = [];
  collectTreeWarnings(parsed.document, warnings);
  if (!resolved.preserveComments) {
    const stats = xmlStats(parsed.document);
    if (stats.comments > 0) warnings.push(`已按要求删除 ${stats.comments} 处注释（有损操作）`);
  }

  const context: SerializeContext = { options: resolved, warnings };
  return { ok: true, text: serializeDocument(parsed.document, context), warnings };
}

export type XmlValidationResult =
  | { ok: true; warnings: string[]; stats: XmlStats }
  | { ok: false; error: string; line: number; column: number; warnings: string[] };

/**
 * Checks whether the input is well-formed XML, with a line and column on
 * failure.
 *
 * This is XML 1.0 well-formedness only. It is explicitly **not** XSD, DTD or
 * Relax NG schema validation, and it does not check that namespaces resolve to
 * anything — only that the prefixes in use were declared.
 */
export function validateXml(source: string): XmlValidationResult {
  const parsed = parseXml(source);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, line: parsed.line, column: parsed.column, warnings: [] };
  }
  const warnings: string[] = [];
  collectTreeWarnings(parsed.document, warnings);
  return { ok: true, warnings, stats: xmlStats(parsed.document) };
}

/**
 * The source line an error is on, with a caret under the column.
 *
 * Returned as a pair so the UI can render it in a monospace block without
 * having to guess at tab expansion. Long lines are windowed around the caret,
 * because an error at column 900 in a minified document is otherwise a caret
 * pointing off the side of the screen.
 */
export function lineExcerpt(
  source: string,
  line: number,
  column: number,
): { text: string; caret: string; lineText: string } {
  const lines = source.split(/\r\n|\r|\n/);
  const raw = lines[line - 1] ?? '';
  const start = Math.max(0, column - 61);
  const window = raw.slice(start, start + 120);
  const prefix = start > 0 ? '…' : '';
  const caretOffset = Math.max(0, column - 1 - start) + prefix.length;

  // Tabs inside the window would shift the caret; they are rare in XML and
  // replacing them keeps the caret honest without moving the text.
  const text = `${prefix}${window}`.replace(/\t/g, ' ');
  return {
    text,
    // Clamped: the parser reports the position *after* the offending token, so
    // an error at the end of a line would otherwise put the caret one past the
    // last character, pointing at nothing.
    caret: `${' '.repeat(Math.min(caretOffset, text.length))}^`,
    lineText: raw,
  };
}

/* ------------------------------------------------------------------ *
 * Sample
 * ------------------------------------------------------------------ */

/**
 * Sample that exercises everything the formatter has to get right: an
 * attribute whose value contains `>`, attributes with no space to spare, a
 * CDATA section whose text contains `>` and `&`, a comment, a processing
 * instruction, a namespace prefix, and an `xml:space="preserve"` subtree that
 * must not be re-indented.
 */
export const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!-- 订单示例：属性里的 >、CDATA、注释与保留空白 -->
<orders xmlns:shop="https://example.com/shop" count="2"><order id="A-1" status="paid" note="金额 > 100 元时的说明"><shop:item sku="X-9" qty="3"><name>面粉</name><price currency="CNY">12.50</price></shop:item><shop:item sku="X-10" qty="1"><name>酵母</name><price currency="CNY">3.00</price></shop:item><memo><![CDATA[原文含 <em> 与 & 符号，以及相邻的 ] > 写法]]></memo><layout xml:space="preserve">  <row>a</row>  <row>b</row>  </layout></order><order id="A-2" status="pending"><shop:item sku="X-11" qty="6"><name>黄油</name><price currency="CNY">28.00</price></shop:item><!-- 待付款 --></order></orders>
`;
