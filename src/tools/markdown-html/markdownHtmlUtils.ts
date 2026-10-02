/**
 * Markdown → HTML source.
 *
 * This is the sibling of `markdown-preview`, and the difference is the whole
 * point of the tool: the preview renders to React elements (so the output can
 * only be looked at), while this one produces an HTML **string** that can be
 * copied into a blog, an email template or a CMS field.
 *
 * Producing a string means the escaping is now our job, and this is where
 * "just call `marked.parse`" quietly becomes an XSS hole: marked passes raw
 * HTML through verbatim and calls `encodeURI` on link targets, which does not
 * remove a `javascript:` scheme. So the parser is used only as a **lexer**
 * (markdown in, token tree out) and every character that reaches the output
 * goes through the escaping functions below. There is no sanitiser dependency
 * because no untrusted HTML is ever parsed in the first place.
 *
 * See `scripts/check-markdown-html.mjs`: it re-parses the output with an
 * independent HTML parser, asserts the tag structure matches the Markdown
 * semantics, and asserts the three classic injections produce no executable
 * tag, attribute or protocol.
 *
 * ## Why the lexer and not a custom renderer
 *
 * marked's `Renderer` can be subclassed, but its `text` method, its
 * `parseInline` plumbing and its `cleanUrl` behaviour are all things this tool
 * would have to audit anyway. Going through the token tree keeps the security
 * argument local: one `switch` statement decides, for every token type, exactly
 * which characters are emitted literally.
 */

import { lexer, type Token, type Tokens } from 'marked';

/* ------------------------------------------------------------------ *
 * Escaping
 * ------------------------------------------------------------------ */

/**
 * Escape text for an HTML text node.
 *
 * `&` is left alone when it already introduces an entity reference
 * (`&amp;`, `&#38;`, `&#x26;`), which is CommonMark's rule: a source that says
 * `&amp;` must reach the reader as `&`. Blindly escaping it would produce
 * `&amp;amp;` and the page would show the six characters instead of one.
 *
 * Quotes are deliberately NOT escaped here. They carry no meaning in text
 * content, and `&#39;` sprinkled through prose makes the generated source
 * harder to read and diff. Attribute values use `escapeAttr`.
 */
export function escapeText(value: string): string {
  return value.replace(
    /[<>]|&(?!(?:#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
    (match) => (match === '<' ? '&lt;' : match === '>' ? '&gt;' : '&amp;'),
  );
}

/**
 * Escape text that must be reproduced character for character.
 *
 * Used for code spans and fenced blocks, where `&amp;` in the source is the
 * five characters the author typed and the browser has to show them literally.
 * Every `&` is escaped, with no entity exception.
 */
export function escapeCode(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escape a value that goes inside a double-quoted attribute.
 *
 * Escaping **every** `&` here is a security decision, not a formatting one.
 * The HTML parser expands character references inside attribute values, so an
 * href left as `&#106;avascript:alert(1)` would be decoded by the browser
 * *after* the scheme check had already looked at the harmless raw text and
 * passed it. Escaping the ampersand guarantees the browser receives exactly
 * the characters that were inspected. The cost is that a source href which
 * already contains `&amp;` keeps it literally — that is the author's own
 * double encoding, and it is the safe direction to err in.
 */
export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------------ *
 * Link targets
 * ------------------------------------------------------------------ */

/** Schemes that may become a real link. Everything else is refused. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export interface HrefCheck {
  ok: boolean;
  href: string;
  reason?: string;
}

/**
 * Validates a link target.
 *
 * Relative and fragment URLs (`/a`, `./a`, `#a`, `?q=1`) have no scheme and are
 * allowed. Anything with a scheme must be on the allow-list, which notably
 * excludes `javascript:`, `data:`, `vbscript:` and `file:`.
 *
 * The control-character stripping before the scheme test is the interesting
 * part. Browsers remove every ASCII tab, newline and carriage return from a
 * URL while parsing it, so `java&#9;script:alert(1)` — and even a literal
 * newline in the middle — is a working `javascript:` URL in every browser.
 * Testing the raw string would see a string that does not match
 * `^scheme:` and wave it through. Removing those characters first can only
 * make the check stricter, never looser.
 *
 * Protocol-relative URLs are handled before the scheme test, because the regex
 * would otherwise read `//example.com` as the scheme `//`. They inherit the
 * page's scheme, so they are pinned to https.
 */
export function checkHref(href: string): HrefCheck {
  const raw = href.trim();
  if (raw === '') return { ok: false, href: '', reason: '空链接' };

  if (raw.startsWith('//')) return { ok: true, href: `https:${raw}` };

  const probe = raw.toLowerCase().replace(/[\u0000-\u0020\u007f]+/g, '');
  const match = /^([a-z][a-z0-9+.-]*):/.exec(probe);
  if (!match) return { ok: true, href: raw };

  const scheme = `${match[1]}:`;
  if (SAFE_SCHEMES.has(scheme)) return { ok: true, href: raw };
  return { ok: false, href: raw, reason: `不允许的协议 ${scheme}` };
}

/* ------------------------------------------------------------------ *
 * Headings and table of contents
 * ------------------------------------------------------------------ */

export interface Heading {
  depth: number;
  text: string;
  /** Slug used as the anchor id and by the table of contents. */
  id: string;
}

/**
 * Slugifies heading text into a stable anchor id.
 *
 * The rules are the same as `markdown-preview`'s, kept in step on purpose so
 * the same document produces the same anchors in both tools. They are
 * re-implemented rather than imported because that module also exports React
 * components (it is a `.tsx` that imports `react`), and this file has to stay
 * importable by a plain Node check script with no JSX transform.
 *
 * CJK is kept: dropping everything outside `[a-z0-9]` would turn every Chinese
 * heading into `section`, and a document with six headings would then produce
 * `section`, `section-1`, … which is useless as a link target.
 */
export function slugify(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '');
  return base || 'section';
}

/** Plain-text extraction from inline tokens, for headings and alt text. */
export function inlineText(tokens: Token[] | undefined): string {
  if (!tokens || tokens.length === 0) return '';
  let out = '';
  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const text = token as Tokens.Text;
        out += text.tokens && text.tokens.length > 0 ? inlineText(text.tokens) : text.text;
        break;
      }
      case 'codespan':
        out += (token as Tokens.Codespan).text;
        break;
      case 'image':
        out += (token as Tokens.Image).text;
        break;
      case 'escape':
        out += (token as Tokens.Escape).text;
        break;
      case 'html':
        out += (token as Tokens.HTML).text;
        break;
      case 'br':
        out += ' ';
        break;
      case 'strong':
        out += inlineText((token as Tokens.Strong).tokens);
        break;
      case 'em':
        out += inlineText((token as Tokens.Em).tokens);
        break;
      case 'del':
        out += inlineText((token as Tokens.Del).tokens);
        break;
      case 'link':
        out += inlineText((token as Tokens.Link).tokens) || (token as Tokens.Link).text;
        break;
      default: {
        const generic = token as Tokens.Generic;
        out += typeof generic.text === 'string' ? generic.text : generic.raw;
      }
    }
  }
  return out;
}

/**
 * Collects headings in document order and assigns each one a unique id.
 *
 * The ids are memoised on the token objects so the renderer can look them up
 * without re-running the de-duplication. Two independent walks would have to
 * agree exactly; one walk cannot disagree with itself.
 */
export function collectHeadings(
  tokens: Token[],
  ids: WeakMap<Token, string> = new WeakMap(),
): Heading[] {
  const headings: Heading[] = [];
  const used = new Map<string, number>();

  const walk = (list: Token[]) => {
    for (const token of list) {
      if (token.type === 'heading') {
        const heading = token as Tokens.Heading;
        const text = inlineText(heading.tokens) || heading.text;
        let id = slugify(text);
        const seen = used.get(id) ?? 0;
        used.set(id, seen + 1);
        if (seen > 0) id = `${id}-${seen}`;
        ids.set(token, id);
        headings.push({ depth: heading.depth, text, id });
      }
      if ('tokens' in token && Array.isArray((token as Tokens.Generic).tokens)) {
        walk((token as Tokens.Generic).tokens as Token[]);
      }
      if (token.type === 'list') {
        for (const item of (token as Tokens.List).items) {
          if (item.tokens) walk(item.tokens);
        }
      }
      if (token.type === 'table') {
        for (const cell of (token as Tokens.Table).header) {
          if (cell.tokens) walk(cell.tokens);
        }
      }
    }
  };

  walk(tokens);
  return headings;
}

interface TocNode {
  heading: Heading;
  children: TocNode[];
}

/**
 * Renders the nested `<ul>` for the table of contents.
 *
 * A document that jumps from `#` to `###` produces a `###` entry one level
 * deeper rather than a broken list: HTML lists cannot skip a level without
 * implying an empty `<li>`, so levels are compacted instead.
 */
function renderToc(headings: Heading[], depth: number, minify: boolean): string {
  const included = headings.filter((heading) => heading.depth <= depth);
  if (included.length === 0) return '';

  const roots: TocNode[] = [];
  const stack: TocNode[] = [];

  for (const heading of included) {
    const node: TocNode = { heading, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].heading.depth >= heading.depth) {
      stack.pop();
    }
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  const newline = minify ? '' : '\n';
  const render = (nodes: TocNode[]): string => {
    const items = nodes.map((node) => {
      const label = escapeText(node.heading.text);
      const link = `<a href="#${escapeAttr(node.heading.id)}">${label}</a>`;
      const nested = node.children.length > 0 ? render(node.children) : '';
      return `<li>${link}${nested}</li>`;
    });
    return `<ul>${newline}${items.join(newline)}${newline}</ul>`;
  };

  return `<nav class="markdown-toc" aria-label="目录">${newline}${render(roots)}${newline}</nav>`;
}

/* ------------------------------------------------------------------ *
 * Options
 * ------------------------------------------------------------------ */

export type HtmlStyle = 'none' | 'embedded' | 'tailwind';

export interface MarkdownHtmlOptions {
  /** Full document with doctype/head/body, or a bare fragment. */
  document?: boolean;
  /** `<title>` for document mode. Defaults to the first `#` heading. */
  title?: string;
  /** `lang` attribute of the document element. */
  lang?: string;
  /** How the output is styled. */
  style?: HtmlStyle;
  /** Remove the newlines between block elements (see the note on `<pre>`). */
  minify?: boolean;
  /** Prepend a generated table of contents. */
  toc?: boolean;
  /** Deepest heading level included in the table of contents. */
  tocDepth?: number;
  /**
   * Emit raw HTML from the source verbatim instead of showing it as text.
   *
   * Off by default and it is a genuine hole in the sandbox when on: the output
   * then contains whatever the source contained, `<script>` included.
   */
  allowHtml?: boolean;
  /** Treat a single newline as `<br>`. */
  breaks?: boolean;
}

interface ResolvedOptions {
  document: boolean;
  title: string;
  lang: string;
  style: HtmlStyle;
  minify: boolean;
  toc: boolean;
  tocDepth: number;
  allowHtml: boolean;
  breaks: boolean;
}

function resolveOptions(options: MarkdownHtmlOptions): ResolvedOptions {
  const depth = options.tocDepth ?? 3;
  return {
    document: options.document ?? false,
    title: options.title ?? '',
    lang: options.lang ?? 'zh-CN',
    style: options.style ?? 'none',
    minify: options.minify ?? false,
    toc: options.toc ?? false,
    tocDepth: depth >= 1 && depth <= 6 ? Math.floor(depth) : 3,
    allowHtml: options.allowHtml ?? false,
    breaks: options.breaks ?? false,
  };
}

export interface MarkdownHtmlResult {
  html: string;
  headings: Heading[];
  warnings: string[];
  error: string | null;
}

/* ------------------------------------------------------------------ *
 * Tailwind class map
 * ------------------------------------------------------------------ */

/**
 * Utility classes applied when `style: 'tailwind'`.
 *
 * They are plain Tailwind names, so they only work in a page that already has
 * Tailwind configured — the tool never injects a CDN script, because a copied
 * snippet silently pulling in a third-party script is exactly the sort of
 * surprise this tool exists to avoid.
 */
const TAILWIND: Record<string, string> = {
  h1: 'text-3xl font-bold mt-8 mb-4',
  h2: 'text-2xl font-semibold mt-8 mb-3',
  h3: 'text-xl font-semibold mt-6 mb-2',
  h4: 'text-lg font-semibold mt-5 mb-2',
  h5: 'text-base font-semibold mt-4 mb-2',
  h6: 'text-sm font-semibold mt-4 mb-2',
  p: 'my-4 leading-7',
  ul: 'my-4 list-disc pl-6 space-y-1',
  ol: 'my-4 list-decimal pl-6 space-y-1',
  li: 'leading-7',
  blockquote: 'my-4 border-l-4 border-gray-300 pl-4 italic text-gray-600',
  pre: 'my-4 overflow-x-auto rounded bg-gray-100 p-4 text-sm',
  codespan: 'rounded bg-gray-100 px-1 py-0.5 text-sm',
  table: 'my-4 w-full border-collapse text-sm',
  th: 'border border-gray-300 bg-gray-50 px-3 py-2 text-left font-semibold',
  td: 'border border-gray-300 px-3 py-2',
  hr: 'my-8 border-t border-gray-300',
  a: 'text-blue-600 underline',
  img: 'max-w-full',
  strong: 'font-semibold',
  em: 'italic',
  del: 'line-through',
};

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

interface RenderContext {
  options: ResolvedOptions;
  warnings: string[];
  headingIds: WeakMap<Token, string>;
  blockedLinks: number;
  blockedImages: number;
  escapedHtml: number;
}

/**
 * ` class="…"` for the given element kind, or an empty string.
 *
 * `extra` is always emitted, whether or not Tailwind classes are in play: the
 * semantic hooks (`task-list`, `markdown-toc`) are part of the markup, not of
 * the optional styling.
 */
function cls(context: RenderContext, kind: string, extra?: string): string {
  const parts: string[] = [];
  if (context.options.style === 'tailwind') {
    const value = TAILWIND[kind];
    if (value) parts.push(value);
  }
  if (extra) parts.push(extra);
  return parts.length > 0 ? ` class="${parts.join(' ')}"` : '';
}

function gap(context: RenderContext): string {
  return context.options.minify ? '' : '\n';
}

function renderInline(tokens: Token[] | undefined, context: RenderContext): string {
  if (!tokens || tokens.length === 0) return '';

  let out = '';
  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const text = token as Tokens.Text;
        out += text.tokens && text.tokens.length > 0
          ? renderInline(text.tokens, context)
          : escapeText(text.text);
        break;
      }
      case 'escape':
        out += escapeText((token as Tokens.Escape).text);
        break;
      case 'strong':
        out += `<strong${cls(context, 'strong')}>${renderInline((token as Tokens.Strong).tokens, context)}</strong>`;
        break;
      case 'em':
        out += `<em${cls(context, 'em')}>${renderInline((token as Tokens.Em).tokens, context)}</em>`;
        break;
      case 'del':
        out += `<del${cls(context, 'del')}>${renderInline((token as Tokens.Del).tokens, context)}</del>`;
        break;
      case 'codespan':
        out += `<code${cls(context, 'codespan')}>${escapeCode((token as Tokens.Codespan).text)}</code>`;
        break;
      case 'br':
        out += '<br>';
        break;
      case 'link': {
        const link = token as Tokens.Link;
        const label = link.tokens && link.tokens.length > 0
          ? renderInline(link.tokens, context)
          : escapeText(link.text);
        const check = checkHref(link.href);
        if (!check.ok) {
          context.blockedLinks += 1;
          context.warnings.push(`已阻止链接「${inlineText(link.tokens) || link.text}」：${check.reason}`);
          // No href at all is emitted: a blocked destination must not appear
          // anywhere in the output, not even in a title or data attribute,
          // because the whole string is meant to be pasted somewhere real.
          out += `<span class="markdown-link-blocked">${label}</span>`;
          break;
        }
        // The title goes through `escapeAttr`, not `escapeText`: it sits inside
        // a double-quoted attribute, so a `"` in the source would otherwise
        // close the value and turn the rest of the title into attributes of
        // its own — `[x](u "a\" onmouseover=\"alert(1)")` produced a live
        // `onmouseover`. Escaping text alone is not enough for attribute
        // position, and that distinction is the reason both functions exist.
        const title = link.title ? ` title="${escapeAttr(link.title)}"` : '';
        out += `<a${cls(context, 'a')} href="${escapeAttr(check.href)}"${title}>${label}</a>`;
        break;
      }
      case 'image': {
        const image = token as Tokens.Image;
        const alt = inlineText(image.tokens) || image.text;
        const check = checkHref(image.href);
        if (!check.ok) {
          context.blockedImages += 1;
          context.warnings.push(`已阻止图片「${alt}」：${check.reason}`);
          out += `<span class="markdown-image-blocked">${escapeText(alt)}</span>`;
          break;
        }
        // Same rule as the link title, plus the alt text: both are attribute
        // values and both are attacker-controlled. Escaping only `<` and `>`
        // here let `![x" onerror="alert(1)](u)` emit a working `onerror`.
        const title = image.title ? ` title="${escapeAttr(image.title)}"` : '';
        out += `<img${cls(context, 'img')} src="${escapeAttr(check.href)}" alt="${escapeAttr(alt)}"${title}>`;
        break;
      }
      case 'checkbox': {
        const box = token as Tokens.Checkbox;
        out += `<input type="checkbox" disabled${box.checked ? ' checked' : ''}> `;
        break;
      }
      case 'html': {
        const html = token as Tokens.HTML;
        if (context.options.allowHtml) {
          context.escapedHtml += 1;
          out += html.text;
        } else {
          context.escapedHtml += 1;
          out += escapeText(html.text);
        }
        break;
      }
      case 'def':
        break;
      default: {
        const generic = token as Tokens.Generic;
        out += escapeText(typeof generic.text === 'string' ? generic.text : generic.raw);
      }
    }
  }
  return out;
}

function renderListItem(item: Tokens.ListItem, context: RenderContext, depth: number): string {
  const remaining: Token[] = [...(item.tokens ?? [])];
  let body = '';

  if (remaining[0]?.type === 'checkbox') {
    const box = remaining.shift() as Tokens.Checkbox;
    body += `<input type="checkbox" disabled${box.checked ? ' checked' : ''}> `;
  }

  // A tight list item starts with a `text` token, and wrapping that in `<p>`
  // would add a paragraph the source did not ask for. The rest of the item is
  // rendered as blocks as usual (nested lists, code, loose paragraphs).
  if (remaining[0]?.type === 'text') {
    const text = remaining.shift() as Tokens.Text;
    body += text.tokens && text.tokens.length > 0
      ? renderInline(text.tokens, context)
      : escapeText(text.text);
  }

  const rest = renderBlocks(remaining, context, depth);
  if (rest !== '') body += body === '' ? rest : gap(context) + rest;

  return `<li${cls(context, 'li')}>${body}</li>`;
}

function renderTable(table: Tokens.Table, context: RenderContext): string {
  const newline = gap(context);
  const align = (value: 'center' | 'left' | 'right' | null): string =>
    value ? ` style="text-align: ${value}"` : '';

  const header = table.header
    .map((cell) => `<th${cls(context, 'th')}${align(cell.align)}>${renderInline(cell.tokens, context)}</th>`)
    .join('');
  const rows = table.rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell) =>
              `<td${cls(context, 'td')}${align(cell.align)}>${renderInline(cell.tokens, context)}</td>`,
          )
          .join('')}</tr>`,
    )
    .join(newline);

  const head = `<thead>${newline}<tr>${header}</tr>${newline}</thead>`;
  const body = `<tbody>${newline}${rows}${newline}</tbody>`;
  return `<table${cls(context, 'table')}>${newline}${head}${newline}${body}${newline}</table>`;
}

function renderBlock(token: Token, context: RenderContext, depth: number): string {
  switch (token.type) {
    case 'space':
      return '';

    case 'heading': {
      const heading = token as Tokens.Heading;
      const level = Math.min(6, Math.max(1, heading.depth));
      const id = context.headingIds.get(token);
      const idAttribute = id ? ` id="${escapeAttr(id)}"` : '';
      return `<h${level}${cls(context, `h${level}`)}${idAttribute}>${renderInline(heading.tokens, context)}</h${level}>`;
    }

    case 'paragraph': {
      const paragraph = token as Tokens.Paragraph;
      return `<p${cls(context, 'p')}>${renderInline(paragraph.tokens, context)}</p>`;
    }

    case 'text': {
      const text = token as Tokens.Text;
      const content = text.tokens && text.tokens.length > 0
        ? renderInline(text.tokens, context)
        : escapeText(text.text);
      return `<p${cls(context, 'p')}>${content}</p>`;
    }

    case 'code': {
      const code = token as Tokens.Code;
      // The info string may carry several words ("ts title=foo"); HTML takes
      // only the first as the language, and the attribute is escaped anyway.
      const language = (code.lang ?? '').trim().split(/\s+/)[0];
      const classAttribute = language ? ` class="language-${escapeAttr(language)}"` : '';
      return `<pre${cls(context, 'pre')}><code${classAttribute}>${escapeCode(code.text)}</code></pre>`;
    }

    case 'blockquote': {
      const quote = token as Tokens.Blockquote;
      const inner = renderBlocks(quote.tokens ?? [], context, depth + 1);
      return `<blockquote${cls(context, 'blockquote')}>${gap(context)}${inner}${gap(context)}</blockquote>`;
    }

    case 'hr':
      return `<hr${cls(context, 'hr')}>`;

    case 'list': {
      const list = token as Tokens.List;
      const items = list.items.map((item) => renderListItem(item, context, depth + 1));
      const newline = gap(context);
      const tasks = list.items.some((item) => item.task);
      const listClass = cls(context, list.ordered ? 'ol' : 'ul', tasks ? 'task-list' : undefined);
      if (list.ordered) {
        const start =
          typeof list.start === 'number' && list.start !== 1 ? ` start="${list.start}"` : '';
        return `<ol${listClass}${start}>${newline}${items.join(newline)}${newline}</ol>`;
      }
      return `<ul${listClass}>${newline}${items.join(newline)}${newline}</ul>`;
    }

    case 'table':
      return renderTable(token as Tokens.Table, context);

    case 'html': {
      const html = token as Tokens.HTML;
      context.escapedHtml += 1;
      if (context.options.allowHtml) {
        // Documented and deliberately opt-in: with this on, the output is only
        // as safe as the Markdown that produced it.
        return html.text;
      }
      // Shown as text, wrapped in a paragraph so a fragment stays valid HTML
      // rather than becoming a run of bare text between two blocks.
      return `<p${cls(context, 'p')}>${escapeText(html.text)}</p>`;
    }

    case 'def':
      // Link reference definitions are metadata; marked already resolved the
      // links that use them, and `def` itself renders to nothing.
      return '';

    default: {
      const generic = token as Tokens.Generic;
      return escapeText(typeof generic.text === 'string' ? generic.text : generic.raw);
    }
  }
}

function renderBlocks(tokens: Token[], context: RenderContext, depth: number): string {
  const parts: string[] = [];
  for (const token of tokens) {
    const html = renderBlock(token, context, depth);
    if (html !== '') parts.push(html);
  }
  return parts.join(gap(context));
}

/* ------------------------------------------------------------------ *
 * Wrappers and the embedded stylesheet
 * ------------------------------------------------------------------ */

/**
 * Stylesheet used by `style: 'embedded'`.
 *
 * Plain colours, no CSS variables: the point of an embedded style block is that
 * it works in a page that knows nothing about this application's design
 * tokens. `pre` gets `overflow-x: auto` so a wide code block scrolls instead of
 * stretching the layout.
 */
const EMBEDDED_CSS = [
  '.markdown-body { line-height: 1.7; color: #1f2328; word-wrap: break-word; }',
  '.markdown-body h1, .markdown-body h2 { border-bottom: 1px solid #d8dee4; padding-bottom: .3em; }',
  '.markdown-body h1 { font-size: 1.9em; } .markdown-body h2 { font-size: 1.5em; }',
  '.markdown-body h3 { font-size: 1.25em; } .markdown-body h4 { font-size: 1.05em; }',
  '.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 { margin: 1.4em 0 .6em; }',
  '.markdown-body p, .markdown-body ul, .markdown-body ol, .markdown-body blockquote { margin: .9em 0; }',
  '.markdown-body ul, .markdown-body ol { padding-left: 1.6em; }',
  '.markdown-body code { background: #f0f1f3; border-radius: 4px; padding: .15em .35em; font-size: .92em; }',
  '.markdown-body pre { background: #f6f8fa; border-radius: 6px; padding: 12px 14px; overflow-x: auto; }',
  '.markdown-body pre code { background: none; padding: 0; }',
  '.markdown-body blockquote { border-left: 4px solid #d0d7de; color: #57606a; padding: 0 1em; }',
  '.markdown-body table { border-collapse: collapse; width: 100%; }',
  '.markdown-body th, .markdown-body td { border: 1px solid #d0d7de; padding: 6px 12px; }',
  '.markdown-body th { background: #f6f8fa; }',
  '.markdown-body img { max-width: 100%; }',
  '.markdown-body hr { border: none; border-top: 1px solid #d8dee4; margin: 1.6em 0; }',
  '.markdown-toc { background: #f6f8fa; border: 1px solid #d8dee4; border-radius: 6px; padding: 8px 16px; }',
  '.markdown-toc ul { margin: .4em 0; }',
  '.markdown-link-blocked { text-decoration: line-through; color: #b35900; }',
  '.markdown-image-blocked { color: #b35900; }',
].join('\n');

function styleBlock(options: ResolvedOptions): string {
  if (options.style !== 'embedded') return '';
  return `<style>\n${EMBEDDED_CSS}\n</style>`;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Renders Markdown to an HTML string.
 *
 * Never throws: a parse failure comes back as `error` with an empty `html`, so
 * the caller can show it the same way it shows a blocking link.
 */
export function renderMarkdownToHtml(
  source: string,
  options: MarkdownHtmlOptions = {},
): MarkdownHtmlResult {
  const resolved = resolveOptions(options);
  let tokens: Token[];

  try {
    tokens = lexer(source, { gfm: true, breaks: resolved.breaks });
  } catch (error) {
    return {
      html: '',
      headings: [],
      warnings: [],
      error: error instanceof Error ? error.message : '解析失败',
    };
  }

  const headingIds = new WeakMap<Token, string>();
  const headings = collectHeadings(tokens, headingIds);

  const context: RenderContext = {
    options: resolved,
    warnings: [],
    headingIds,
    blockedLinks: 0,
    blockedImages: 0,
    escapedHtml: 0,
  };

  const body = renderBlocks(tokens, context, 0);
  const toc = resolved.toc ? renderToc(headings, resolved.tocDepth, resolved.minify) : '';
  const newline = resolved.minify ? '' : '\n';
  const content = [toc, body].filter((part) => part !== '').join(newline + newline);

  const warnings = [...context.warnings];
  if (context.escapedHtml > 0) {
    warnings.push(
      resolved.allowHtml
        ? `${context.escapedHtml} 处原始 HTML 被原样输出：输出中可能包含 <script> 等可执行内容，只应粘贴到自己信任的地方`
        : `${context.escapedHtml} 处原始 HTML 已转义为纯文本（不会执行）`,
    );
  }
  if (resolved.allowHtml) {
    warnings.push('「允许内联 HTML」已开启：本工具不再提供任何 XSS 防护');
  }

  if (!resolved.document) {
    const style = styleBlock(resolved);
    const fragment = style === '' ? content : `${style}${newline}${content}`;
    return { html: fragment, headings, warnings, error: null };
  }

  const title = resolved.title.trim() !== ''
    ? resolved.title
    : headings.find((heading) => heading.depth === 1)?.text || 'Markdown';
  const style = styleBlock(resolved);

  const parts = [
    '<!DOCTYPE html>',
    `<html lang="${escapeAttr(resolved.lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeText(title)}</title>`,
    ...(style === '' ? [] : [style]),
    '</head>',
    '<body>',
    `<main class="markdown-body">${newline}${content}${newline}</main>`,
    '</body>',
    '</html>',
  ];

  return { html: parts.join(newline), headings, warnings, error: null };
}

/* ------------------------------------------------------------------ *
 * Samples
 * ------------------------------------------------------------------ */

/** Sample covering the constructs worth demonstrating. */
export const SAMPLE_MARKDOWN = `# Markdown 转 HTML

把 **Markdown** 编译成可以复制的 HTML 源码，支持 *斜体*、~~删除线~~、\`行内代码\` 与 [链接](https://wheat.chat)。

## 列表

- 无序项
- 带嵌套
  1. 有序子项
  2. 第二项
- [x] 已完成的任务
- [ ] 未完成的任务

## 代码

\`\`\`ts
export function greet(name: string) {
  // 代码里的 <b> 与 & 会被转义，不会被当成标签
  return \`你好，\${name} <b>&</b>\`;
}
\`\`\`

## 表格与引用

| 功能 | 状态 | 说明 |
| :--- | :---: | ---: |
| 表格 | 支持 | 含对齐 |
| 目录 | 支持 | 标题自动生成锚点 |
| 原始 HTML | 默认转义 | 安全考虑 |

> 引用块里的 **格式** 依然生效。
> 第二行。

---

这段原始 HTML 默认只会当作文本显示：<span>span</span>
`;

/**
 * Sample for the "注入" preset.
 *
 * Covers the routes that matter: a raw `script` element, an event-handler
 * attribute on an `img`, Markdown links whose scheme is `javascript:` or
 * `data:`, a scheme split by a tab (which browsers drop while parsing a URL),
 * and a scheme hidden behind a character reference.
 *
 * The last one is the interesting case: it is *not* rejected, because as far as
 * the HTML string is concerned the destination is a relative URL — but the
 * ampersand is escaped, so the browser receives the literal text
 * `&#106;avascript:...` instead of the decoded `javascript:...`, and a single
 * entity-decoding pass never re-reads what it just produced.
 */
export const XSS_SAMPLE = `# 注入测试

原始 HTML 默认被转义，下面这些都不会执行：

<script>alert('script 标签不会执行')</script>
<img src=x onerror="alert('onerror 不会执行')">

Markdown 语法里的危险协议会被拦掉：

[用 javascript: 的链接](javascript:alert('被阻止'))

[用 data: 的链接](data:text/html,<script>alert(1)</script>)

[用制表符拆开协议](<java	script:alert('制表符会被浏览器忽略，所以这里必须被阻止')>)

字符引用伪装的协议不会被解码成 javascript:，因为 & 会被转义：

[字符引用伪装的链接](&#106;avascript:alert('不会执行'))

[正常链接仍然可用](https://wheat.chat)
`;
