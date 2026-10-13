/**
 * HTML sanitiser for pasted content.
 *
 * ## Why this is hand-written rather than "just set innerHTML"
 *
 * A rich-text editor that puts pasted markup straight into a contentEditable
 * element inherits every script the clipboard carries. The classic one-liner is
 *
 *     editor.innerHTML = clipboardHtml;
 *
 * and it is genuinely exploitable: pasting `<img src=x onerror=alert(1)>` runs
 * the handler immediately, because assigning innerHTML compiles event-handler
 * attributes the same way the parser does when it sees them in a document. A
 * single paste is enough; no click, no navigation. `scripts/check-html-wysiwyg.mjs`
 * proves that with an independent parser instead of asking the reader to trust
 * this paragraph.
 *
 * ## Why not DOMPurify, or the browser's own parser, as the reference
 *
 * DOMPurify would be the right answer in a product. This repository has no
 * runtime dependency beyond React and Fluent, a tool directory is not allowed to
 * add one, and a sanitiser whose correctness is the whole point must be
 * verifiable in Node without a DOM. So the tokeniser lives here as plain string
 * code and is checked against Python's `html.parser` — a parser written by
 * someone else, in another language — rather than against itself.
 *
 * The consequence of rolling our own is stated plainly: this is an allowlist
 * over a small tokeniser, not a general-purpose HTML parser. It deliberately
 * refuses anything it does not fully understand (unknown tags lose their tag,
 * dangerous elements lose their content too), which loses some fidelity but
 * never silently keeps something unparsed.
 *
 * ## The three things that make the naive version exploitable
 *
 *   1. `on*` attributes, which execute on load or on interaction.
 *   2. URLs whose scheme is `javascript:` — and every obfuscation of it:
 *      `JaVaScRiPt:`, `java&#115;cript:`, `jav&#x0A;ascript:`, `&colon;`.
 *   3. Elements that carry their own execution or document context: `script`,
 *      `style`, `iframe`, `object`, `embed`, `svg`, `math`, `template`, and the
 *      form controls that can post elsewhere.
 *
 * Point 2 is why URL checking decodes entities *and* strips the control
 * characters browsers ignore, repeatedly, before looking at the scheme. A
 * single `decodeURIComponent`-style pass is not enough: `&amp;#106;` is a
 * double-encoded `j`.
 */

/** Options controlling what a paste keeps. */
export interface SanitizeOptions {
  /**
   * Keep pasted `style` attributes, after running them through the CSS
   * allowlist below. Off by default: pasted styles routinely carry layout that
   * fights the surrounding page, and a strict default is easier to defend.
   */
  keepInlineStyles?: boolean;
  /**
   * Treat the input as literal text rather than markup. Every character is
   * escaped, so `<script>` arrives in the editor as the visible characters
   * `<script>` instead of as an element.
   */
  plainText?: boolean;
}

/** What the sanitiser removed, for an honest report in the UI. */
export interface SanitizeReport {
  /** Names of elements whose tags were dropped (lower-cased, unique). */
  removedTags: string[];
  /** Names of attributes that were dropped (unique). */
  removedAttributes: string[];
  /** How many URLs were rejected for a dangerous scheme. */
  blockedUrls: number;
  /** How many `style` attributes survived the CSS allowlist. */
  keptStyles: number;
}

export interface SanitizeResult {
  html: string;
  report: SanitizeReport;
}

/**
 * Elements kept in the output.
 *
 * This is the formatting vocabulary the toolbar can produce, plus the harmless
 * structural elements a paste from a document or a web page normally contains.
 * Anything absent loses its tag but keeps its text, so pasting a `<section>`
 * still yields the paragraph inside it.
 */
const ALLOWED_TAGS = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'mark',
  'small', 'sub', 'sup', 'span', 'div', 'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'code', 'kbd', 'samp', 'var',
  'figure', 'figcaption',
  'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'img', 'abbr', 'cite', 'q', 'time', 'address',
]);

/**
 * Elements dropped together with everything inside them.
 *
 * Keeping the text of a `<script>` would leak the source into the document as
 * visible text, and keeping the text of an `<iframe>` is meaningless. For
 * `style` the reason is different but just as firm: CSS can execute
 * `expression()` in old engines and can be used for exfiltration via `url()`.
 *
 * `svg` and `math` are here rather than in the unknown bucket because foreign
 * content switches the parser into a mode where `<script>` is valid inside
 * them; dropping the whole subtree removes that whole class of bypass.
 *
 * `html` and `body` are deliberately *not* here. A pasted full document arrives
 * wrapped in them, and they are only wrappers: they fall through to the unknown
 * case below, which removes the tag but keeps the content. Listing them here
 * would discard the entire paste.
 */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'noframes', 'noscript',
  'object', 'embed', 'applet', 'param', 'portal',
  'svg', 'math', 'template', 'canvas',
  'audio', 'video', 'source', 'track',
  'form', 'input', 'button', 'select', 'option', 'optgroup', 'textarea',
  'fieldset', 'legend', 'label', 'output', 'datalist', 'progress', 'meter',
  'meta', 'link', 'base', 'head', 'title',
  'xmp', 'listing', 'plaintext', 'marquee',
]);

/** Elements that never have an end tag. */
const VOID_TAGS = new Set([
  'br', 'hr', 'img', 'wbr', 'col', 'area', 'base', 'embed', 'input', 'link',
  'meta', 'param', 'source', 'track',
]);

/** Attributes allowed on every element. */
const GLOBAL_ATTRIBUTES = ['title'];

/** Extra attributes allowed per element. Everything else is dropped. */
const TAG_ATTRIBUTES: Record<string, string[]> = {
  a: ['href'],
  img: ['src', 'alt', 'width', 'height'],
  ol: ['start', 'type'],
  li: ['value'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  blockquote: ['cite'],
  q: ['cite'],
  time: ['datetime'],
};

/**
 * CSS properties that may survive a sanitised `style` attribute.
 *
 * An allowlist rather than a blocklist: CSS has far more ways to be dangerous
 * than it has properties, and a property that is not here costs nothing.
 */
const SAFE_STYLE_PROPERTIES = new Set([
  'color', 'background-color', 'font', 'font-family', 'font-size',
  'font-style', 'font-weight', 'font-variant', 'line-height',
  'text-align', 'text-decoration', 'text-transform', 'text-indent',
  'letter-spacing', 'word-spacing', 'white-space', 'vertical-align',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-color', 'border-width', 'border-style', 'border-radius',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'list-style-type', 'opacity',
]);

/** Tokens that must never appear inside a kept declaration value. */
const DANGEROUS_STYLE_VALUE =
  /expression|javascript|vbscript|url\s*\(|@import|behavior|-moz-binding|\\|</i;

/** Characters browsers ignore inside a URL and that therefore hide a scheme. */
const IGNORABLE_URL_CHARS = /[\u0000-\u0020\u007f\u00a0\u2028\u2029]/g;

/**
 * Named character references used by URL-scheme obfuscation.
 *
 * The set is intentionally small and security-oriented rather than a complete
 * HTML5 entity table: only references that can spell or hide a scheme matter
 * here. Numbers are handled generically by `decodeEntities`.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  colon: ':', tab: '\t', newline: '\n', sol: '/', lpar: '(', rpar: ')',
  commat: '@', period: '.', num: '#', dollar: '$', quest: '?', equals: '=',
  semi: ';', bsol: '\\', lcub: '{', rcub: '}', plus: '+', comma: ',',
  excl: '!', ast: '*', perc: '%', grave: '`', vert: '|', tilde: '~',
  hyphen: '-', underscore: '_', lowbar: '_',
};

const ENTITY_PATTERN = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

/**
 * Expands character references in a string.
 *
 * A reference without its trailing semicolon is left alone: legacy HTML does
 * accept a few of those, but guessing at them turns ordinary text such as
 * `a&ltb` into something else, and every obfuscation that matters writes the
 * semicolon anyway.
 */
export function decodeEntities(value: string): string {
  return value.replace(ENTITY_PATTERN, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const digits = isHex ? body.slice(2) : body.slice(1);
      const code = Number.parseInt(digits, isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/**
 * Normalises a URL for inspection only — never for output.
 *
 * Decoding and whitespace-stripping are repeated because each pass can expose
 * the next layer: `&amp;#106;` decodes to `&#106;`, which decodes to `j`. Four
 * rounds is far more than any browser applies and still terminates because the
 * decoder leaves unrecognised references untouched.
 */
export function normalizeUrlForCheck(raw: string): string {
  let value = raw;
  for (let round = 0; round < 4; round += 1) {
    value = decodeEntities(value).replace(IGNORABLE_URL_CHARS, '');
  }
  return value.toLowerCase();
}

/**
 * Whether a URL is safe to keep in the document.
 *
 * No scheme at all means a relative URL, a fragment or a query, all of which
 * stay on the current origin and are safe. `data:` is rejected unless the caller
 * opts in *and* the payload is a base64 raster image: `data:text/html` and
 * `data:image/svg+xml` both execute script when navigated to or rendered.
 */
export function isSafeUrl(raw: string, allowImageData = false): boolean {
  const value = normalizeUrlForCheck(raw);
  if (value === '') return false;

  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(value);
  if (!scheme) return true;

  const name = scheme[1];
  if (name === 'http' || name === 'https' || name === 'mailto' || name === 'tel') {
    return true;
  }
  if (name === 'data' && allowImageData) {
    return /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=]+$/.test(value);
  }
  return false;
}

export function isAllowedAttribute(tag: string, attribute: string, keepStyles: boolean): boolean {
  if (attribute === 'style') return keepStyles;
  if (GLOBAL_ATTRIBUTES.includes(attribute)) return true;
  const perTag = TAG_ATTRIBUTES[tag];
  return perTag !== undefined && perTag.includes(attribute);
}

/** Attribute-value escaping that leaves existing character references intact. */
export function escapeAttributeValue(value: string): string {
  return value
    .replace(/&(?![a-zA-Z][a-zA-Z0-9]{1,31};|#[0-9]+;|#[xX][0-9a-fA-F]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Text escaping that leaves existing character references intact.
 *
 * Re-encoding `&nbsp;` as `&amp;nbsp;` would show the user the literal entity
 * text, so an existing reference is passed through and only a bare `&` is
 * escaped. That is safe: the browser reads the passed-through reference as a
 * character, never as markup, because `<` and `>` are always escaped here.
 */
export function escapeText(value: string): string {
  return value
    .replace(/&(?![a-zA-Z][a-zA-Z0-9]{1,31};|#[0-9]+;|#[xX][0-9a-fA-F]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Full escaping, for text that is known to be literal rather than markup. */
export function escapeAll(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Turns literal text into safe markup, keeping line breaks.
 *
 * Used by the plain-text paste path when the clipboard offers no markup at all.
 */
export function plainTextToHtml(text: string): string {
  if (text.trim() === '') return '';
  return escapeAll(text).replace(/\r\n|\r|\n/g, '<br>');
}

/**
 * Filters one `style` attribute value down to the property allowlist.
 *
 * Returns an empty string when nothing survives, which the caller reads as
 * "drop the attribute" rather than "keep an empty one".
 */
export function sanitizeStyleValue(value: string): string {
  const kept: string[] = [];
  for (const declaration of value.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;

    const property = declaration.slice(0, colon).trim().toLowerCase();
    const rawValue = declaration.slice(colon + 1).trim();

    if (!SAFE_STYLE_PROPERTIES.has(property)) continue;
    if (rawValue === '' || rawValue.length > 120) continue;
    if (DANGEROUS_STYLE_VALUE.test(rawValue)) continue;
    if (/["'<>]/.test(rawValue)) continue;

    kept.push(`${property}: ${rawValue}`);
  }
  return kept.join('; ');
}

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

export interface AttributeToken {
  name: string;
  value: string;
}

export interface TagToken {
  kind: 'tag';
  /** Lower-cased element name. */
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attributes: AttributeToken[];
  raw: string;
}

export interface TextToken {
  kind: 'text';
  raw: string;
}

export interface CommentToken {
  kind: 'comment';
  raw: string;
}

export type HtmlToken = TagToken | TextToken | CommentToken;

/**
 * Finds the `>` that ends a tag, ignoring `>` inside a quoted attribute value.
 *
 * This is the single most important detail the obvious `/<[^>]*>/g` shortcut
 * gets wrong: `<a title="a>b" href="javascript:alert(1)">` ends at the `>` in
 * the title under that regex, which leaves `href="javascript:alert(1)">` to be
 * treated as text and a crafted second tag to slip through unexamined.
 */
function findTagEnd(source: string, from: number): number {
  let quote = '';
  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== '') {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return index;
  }
  return -1;
}

const TAG_NAME_PATTERN = /^([a-zA-Z][a-zA-Z0-9-]*)/;
const ATTRIBUTE_PATTERN =
  /([^\s"'>/=<`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Splits HTML into text, comment and tag tokens. Unterminated markup is text. */
export function tokenize(source: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let index = 0;
  let textStart = 0;

  const flushText = (end: number) => {
    if (end > textStart) tokens.push({ kind: 'text', raw: source.slice(textStart, end) });
  };

  while (index < source.length) {
    const char = source[index];
    if (char !== '<') {
      index += 1;
      continue;
    }

    // Comments are skipped whole. Conditional comments are a legacy IE trick
    // for smuggling markup past filters; dropping the comment drops the trick.
    if (source.startsWith('<!--', index)) {
      const close = source.indexOf('-->', index + 4);
      const end = close === -1 ? source.length : close + 3;
      flushText(index);
      tokens.push({ kind: 'comment', raw: source.slice(index, end) });
      index = end;
      textStart = index;
      continue;
    }

    // A doctype or processing instruction: dropped, but its end must still be
    // found so the rest of the document is not swallowed as text.
    if (/^<[!?]/.test(source.slice(index, index + 2))) {
      const end = findTagEnd(source, index + 1);
      if (end === -1) break;
      flushText(index);
      tokens.push({ kind: 'comment', raw: source.slice(index, end + 1) });
      index = end + 1;
      textStart = index;
      continue;
    }

    const end = findTagEnd(source, index + 1);
    if (end === -1) break; // Unterminated at end of input: browsers treat it as text.

    const inner = source.slice(index + 1, end);
    const closing = inner.startsWith('/');
    const body = closing ? inner.slice(1) : inner;

    const nameMatch = TAG_NAME_PATTERN.exec(body.trimStart());
    if (!nameMatch) {
      // `<` followed by a digit or punctuation is ordinary text.
      index += 1;
      continue;
    }

    const name = nameMatch[1].toLowerCase();
    const rest = body.slice(body.indexOf(nameMatch[1]) + nameMatch[1].length);
    const attributes: AttributeToken[] = [];
    if (!closing) {
      ATTRIBUTE_PATTERN.lastIndex = 0;
      let match = ATTRIBUTE_PATTERN.exec(rest);
      while (match !== null) {
        const value = match[2] ?? match[3] ?? match[4] ?? '';
        attributes.push({ name: match[1].toLowerCase(), value });
        match = ATTRIBUTE_PATTERN.exec(rest);
      }
    }

    flushText(index);
    tokens.push({
      kind: 'tag',
      name,
      closing,
      selfClosing: !closing && inner.trimEnd().endsWith('/'),
      attributes,
      raw: source.slice(index, end + 1),
    });
    index = end + 1;
    textStart = index;
  }

  flushText(source.length);
  return tokens;
}

/** Rebuilds a tag from its parsed pieces, dropping nothing else. */
export function serializeTag(token: TagToken, attributes: AttributeToken[] = token.attributes): string {
  if (token.closing) return `</${token.name}>`;
  const rendered = attributes
    .map((attribute) => ` ${attribute.name}="${escapeAttributeValue(attribute.value)}"`)
    .join('');
  if (VOID_TAGS.has(token.name) || token.selfClosing) return `<${token.name}${rendered}>`;
  return `<${token.name}${rendered}>`;
}

// ---------------------------------------------------------------------------
// Sanitiser
// ---------------------------------------------------------------------------

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

/**
 * Sanitises pasted HTML and reports what was removed.
 *
 * Elements not in the allowlist lose their tag but keep their text; elements in
 * `DROP_WITH_CONTENT` lose everything. That asymmetry is deliberate: a
 * `<section>` wrapper is noise, whereas the inside of a `<script>` or an
 * `<iframe>` is the payload.
 */
export function sanitizeHtmlDetailed(input: string, options: SanitizeOptions = {}): SanitizeResult {
  const keepStyles = options.keepInlineStyles === true;
  const report: SanitizeReport = {
    removedTags: [],
    removedAttributes: [],
    blockedUrls: 0,
    keptStyles: 0,
  };

  if (options.plainText === true) {
    return { html: plainTextToHtml(input), report };
  }

  const output: string[] = [];
  // Tracks a `DROP_WITH_CONTENT` subtree. The depth counter matters for
  // malformed input such as `<svg><svg></svg></svg>`: without it the first close
  // tag would resume copying while the outer element is still open.
  let skip: { name: string; depth: number } | null = null;

  for (const token of tokenize(input)) {
    if (token.kind === 'text') {
      if (skip === null) output.push(escapeText(token.raw));
      continue;
    }
    if (token.kind === 'comment') continue;

    if (skip !== null) {
      if (token.name === skip.name) {
        if (token.closing) {
          skip.depth -= 1;
          if (skip.depth <= 0) skip = null;
        } else if (!token.selfClosing) {
          skip.depth += 1;
        }
      }
      continue;
    }

    if (DROP_WITH_CONTENT.has(token.name)) {
      pushUnique(report.removedTags, token.name);
      if (!token.closing && !token.selfClosing) skip = { name: token.name, depth: 1 };
      continue;
    }

    if (!ALLOWED_TAGS.has(token.name)) {
      pushUnique(report.removedTags, token.name);
      continue;
    }

    if (token.closing) {
      if (!VOID_TAGS.has(token.name)) output.push(`</${token.name}>`);
      continue;
    }

    const kept: AttributeToken[] = [];
    for (const attribute of token.attributes) {
      // Event handlers are reported by name rather than by the generic
      // "not allowed" path: they are the attack, so the UI should say so.
      if (/^on/i.test(attribute.name)) {
        pushUnique(report.removedAttributes, `事件属性 ${attribute.name}`);
        continue;
      }

      if (!isAllowedAttribute(token.name, attribute.name, keepStyles)) {
        pushUnique(
          report.removedAttributes,
          attribute.name === 'style' ? 'style（未开启保留样式）' : attribute.name,
        );
        continue;
      }

      if (attribute.name === 'style') {
        const cleaned = sanitizeStyleValue(attribute.value);
        if (cleaned === '') {
          pushUnique(report.removedAttributes, 'style（内容不安全或为空）');
          continue;
        }
        kept.push({ name: 'style', value: cleaned });
        report.keptStyles += 1;
        continue;
      }

      if (attribute.name === 'href' || attribute.name === 'src') {
        const allowImageData = attribute.name === 'src' && token.name === 'img';
        if (!isSafeUrl(attribute.value, allowImageData)) {
          report.blockedUrls += 1;
          pushUnique(report.removedAttributes, `${attribute.name}（协议被拦截）`);
          continue;
        }
      }

      kept.push(attribute);
    }

    output.push(serializeTag(token, kept));
  }

  return { html: output.join(''), report };
}

/** Sanitises pasted HTML, discarding the removal report. */
export function sanitizeHtml(input: string, options: SanitizeOptions = {}): string {
  return sanitizeHtmlDetailed(input, options).html;
}

/**
 * Removes every `style` attribute from markup.
 *
 * Used when the user turns the "include inline styles" output option off. It
 * runs over the editor's own DOM output, which is arbitrary by the time the user
 * has typed into it, so it re-serialises through the tokeniser instead of
 * matching a pattern that a stray quote would defeat.
 */
export function stripInlineStyles(html: string): string {
  return tokenize(html)
    .map((token) => {
      if (token.kind !== 'tag') return token.raw;
      if (!token.attributes.some((attribute) => attribute.name === 'style')) return token.raw;
      return serializeTag(
        token,
        token.attributes.filter((attribute) => attribute.name !== 'style'),
      );
    })
    .join('');
}

/** A short human-readable summary of a removal report, or null when clean. */
export function describeReport(report: SanitizeReport): string | null {
  const parts: string[] = [];
  if (report.removedTags.length > 0) {
    parts.push(`移除标签：${report.removedTags.join('、')}`);
  }
  if (report.removedAttributes.length > 0) {
    parts.push(`移除属性：${report.removedAttributes.join('、')}`);
  }
  if (report.blockedUrls > 0) {
    parts.push(`拦截危险链接 ${report.blockedUrls} 个`);
  }
  return parts.length === 0 ? null : parts.join('；');
}
