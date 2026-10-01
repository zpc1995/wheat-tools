import type { ReactNode } from 'react';
import { lexer, type Token, type Tokens } from 'marked';

/**
 * Markdown → React elements.
 *
 * **XSS is structurally impossible here.** The parser produces a token tree and
 * each token is mapped to real React elements, so every piece of text goes
 * through React's own escaping. Nothing is ever passed to
 * `dangerouslySetInnerHTML`, which means injected `<script>`, `onerror=`
 * attributes or `javascript:` URLs cannot execute — there is no HTML string
 * being parsed at all. That is why no sanitiser dependency is needed.
 *
 * Link targets get an explicit scheme check on top: an unknown or dangerous
 * scheme is rendered as plain text rather than as a clickable link.
 */

/** Schemes considered safe to turn into a real link. */
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

export interface LinkCheck {
  ok: boolean;
  href: string;
  reason?: string;
}

/**
 * Validates a link target.
 *
 * Relative and fragment URLs (`/a`, `./a`, `#a`) have no scheme and are allowed.
 * Anything with a scheme must be on the allow-list — notably `javascript:` and
 * `data:` are refused.
 */
export function checkLink(href: string): LinkCheck {
  const trimmed = href.trim();
  if (!trimmed) return { ok: false, href: '', reason: '空链接' };

  // Protocol-relative URLs must be handled *before* the scheme test below:
  // that regex reads `//example.com` as the scheme `//`, which would reject a
  // perfectly valid link. They inherit the page scheme, so pin them to https.
  if (trimmed.startsWith('//')) {
    return { ok: true, href: `https:${trimmed}` };
  }

  // No scheme at all → relative path, fragment or query. Safe by construction.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return { ok: true, href: trimmed };
  }

  try {
    const url = new URL(trimmed);
    if (SAFE_SCHEMES.includes(url.protocol)) return { ok: true, href: trimmed };
    return { ok: false, href: trimmed, reason: `不允许的协议 ${url.protocol}` };
  } catch {
    return { ok: false, href: trimmed, reason: '无法解析的链接' };
  }
}

export interface Heading {
  depth: number;
  text: string;
  /** Slug used as the anchor id. */
  id: string;
}

/** Plain-text extraction from a token tree, for headings and TOC labels. */
function tokenText(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  return tokens
    .map((token) => {
      if ('tokens' in token && Array.isArray(token.tokens)) {
        return tokenText(token.tokens as Token[]);
      }
      return 'text' in token && typeof (token as { text?: unknown }).text === 'string'
        ? (token as { text: string }).text
        : (token as { raw?: string }).raw ?? '';
    })
    .join('');
}

/** Slugifies heading text into a stable anchor id. */
export function slugify(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    // Keep letters (incl. CJK), digits, dash and underscore; drop punctuation.
    .replace(/[^\p{L}\p{N}\-_]/gu, '');
  return base || 'section';
}

export interface ParseResult {
  tokens: Token[];
  headings: Heading[];
  error: string | null;
}

/**
 * Parses markdown into tokens plus a heading list for the TOC.
 *
 * Heading ids are de-duplicated so repeated titles still produce unique anchors.
 */
export function parseMarkdown(source: string): ParseResult {
  try {
    const tokens = lexer(source, { gfm: true, breaks: false });

    const headings: Heading[] = [];
    const used = new Map<string, number>();

    const walk = (list: Token[]) => {
      for (const token of list) {
        if (token.type === 'heading') {
          const heading = token as Tokens.Heading;
          const text = tokenText(heading.tokens) || heading.text;
          let id = slugify(text);
          const seen = used.get(id) ?? 0;
          used.set(id, seen + 1);
          if (seen > 0) id = `${id}-${seen}`;
          headings.push({ depth: heading.depth, text, id });
        }
        if ('tokens' in token && Array.isArray(token.tokens)) {
          walk(token.tokens as Token[]);
        }
        if (token.type === 'list') {
          for (const item of (token as Tokens.List).items) {
            if (item.tokens) walk(item.tokens);
          }
        }
        if (token.type === 'table') {
          for (const row of (token as Tokens.Table).header) {
            if (row.tokens) walk(row.tokens);
          }
        }
      }
    };

    walk(tokens);
    return { tokens, headings, error: null };
  } catch (error) {
    return {
      tokens: [],
      headings: [],
      error: error instanceof Error ? error.message : '解析失败',
    };
  }
}

interface RenderContext {
  /** Anchor ids assigned per heading, consumed in document order. */
  headingIds: string[];
  headingCursor: { value: number };
  /**
   * Levels to shift rendered headings down by.
   *
   * The preview is embedded in a page that already has its own `h1` (the tool
   * name), so rendering the document's `#` heading as another `h1` gives the
   * page two top-level headings and breaks outline navigation. Shifting by one
   * keeps the document structure intact *relative to itself* while fitting
   * under the page heading. Verified by the accessibility audit.
   */
  headingOffset: number;
}

/** Renders inline token children, which is where formatting actually lives. */
function inline(tokens: Token[] | undefined, context: RenderContext): ReactNode {
  if (!tokens || tokens.length === 0) return null;

  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;

    switch (token.type) {
      case 'text': {
        const text = token as Tokens.Text;
        // A text token may itself carry inline tokens (e.g. bold inside a
        // paragraph inside a list item).
        if (text.tokens && text.tokens.length > 0) {
          return <span key={key}>{inline(text.tokens, context)}</span>;
        }
        return <span key={key}>{text.text}</span>;
      }
      case 'strong':
        return <strong key={key}>{inline((token as Tokens.Strong).tokens, context)}</strong>;
      case 'em':
        return <em key={key}>{inline((token as Tokens.Em).tokens, context)}</em>;
      case 'del':
        return <del key={key}>{inline((token as Tokens.Del).tokens, context)}</del>;
      case 'codespan':
        return (
          <code key={key} className="wt-md-code">
            {(token as Tokens.Codespan).text}
          </code>
        );
      case 'br':
        return <br key={key} />;
      case 'escape':
        return <span key={key}>{(token as Tokens.Escape).text}</span>;
      case 'link': {
        const link = token as Tokens.Link;
        const check = checkLink(link.href);
        const children = inline(link.tokens, context) ?? link.text;

        if (!check.ok) {
          // Refuse to build a link; show the label plus why it was blocked.
          return (
            <span key={key} className="wt-md-blocked" title={check.reason}>
              {children}
              <span className="wt-md-blocked-note">（链接已被阻止：{check.reason}）</span>
            </span>
          );
        }
        return (
          <a key={key} href={check.href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      }
      case 'image': {
        const image = token as Tokens.Image;
        const check = checkLink(image.href);
        if (!check.ok) {
          return (
            <span key={key} className="wt-md-blocked">
              [图片已阻止：{check.reason}]
            </span>
          );
        }
        return (
          <img
            key={key}
            src={check.href}
            alt={image.text ?? ''}
            title={image.title ?? undefined}
            loading="lazy"
          />
        );
      }
      case 'html':
        // Raw HTML is shown as literal text, never parsed. This is the main
        // defence: `<script>` in the source renders as the characters
        // "<script>" instead of executing.
        return (
          <code key={key} className="wt-md-rawhtml" title="原始 HTML 不会被解析">
            {(token as Tokens.HTML).raw}
          </code>
        );
      default:
        return (
          <span key={key}>
            {'raw' in token ? (token as { raw: string }).raw : null}
          </span>
        );
    }
  });
}

function block(tokens: Token[], context: RenderContext): ReactNode {
  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;

    switch (token.type) {
      case 'space':
        return null;

      case 'heading': {
        const heading = token as Tokens.Heading;
        const id = context.headingIds[context.headingCursor.value] ?? undefined;
        context.headingCursor.value += 1;
        const children = inline(heading.tokens, context);

        // Clamped at h6: HTML has no seventh level, and going deeper would be
        // meaningless anyway.
        const level = Math.min(6, heading.depth + context.headingOffset);
        if (level === 1) return <h1 key={key} id={id}>{children}</h1>;
        if (level === 2) return <h2 key={key} id={id}>{children}</h2>;
        if (level === 3) return <h3 key={key} id={id}>{children}</h3>;
        if (level === 4) return <h4 key={key} id={id}>{children}</h4>;
        if (level === 5) return <h5 key={key} id={id}>{children}</h5>;
        return <h6 key={key} id={id}>{children}</h6>;
      }

      case 'paragraph': {
        const paragraph = token as Tokens.Paragraph;
        return <p key={key}>{inline(paragraph.tokens, context) ?? paragraph.text}</p>;
      }

      case 'text': {
        const text = token as Tokens.Text;
        return <p key={key}>{inline(text.tokens, context) ?? text.text}</p>;
      }

      case 'code': {
        const code = token as Tokens.Code;
        return (
          <pre key={key} className="wt-md-pre">
            <code data-lang={code.lang || undefined}>{code.text}</code>
          </pre>
        );
      }

      case 'blockquote': {
        const quote = token as Tokens.Blockquote;
        return (
          <blockquote key={key}>{block(quote.tokens ?? [], context)}</blockquote>
        );
      }

      case 'hr':
        return <hr key={key} />;

      case 'list': {
        const list = token as Tokens.List;
        const items = list.items.map((item, itemIndex) => (
          <li key={itemIndex}>
            {/* A list item's first token is often a `text` wrapper that would
                otherwise add a stray paragraph. */}
            {item.tokens
              ? item.tokens[0]?.type === 'text'
                ? inline((item.tokens[0] as Tokens.Text).tokens, context) ??
                  (item.tokens[0] as Tokens.Text).text
                : block(item.tokens, context)
              : item.text}
            {item.tokens && item.tokens.length > 1 && (
              <>{block(item.tokens.slice(1), context)}</>
            )}
          </li>
        ));

        if (list.ordered) {
          return (
            <ol key={key} start={typeof list.start === 'number' ? list.start : undefined}>
              {items}
            </ol>
          );
        }
        return (
          <ul key={key} className={list.items.some((i) => i.task) ? 'wt-md-task' : undefined}>
            {items}
          </ul>
        );
      }

      case 'table': {
        const table = token as Tokens.Table;
        return (
          <div key={key} className="wt-md-tablewrap">
            <table>
              <thead>
                <tr>
                  {table.header.map((cell, cellIndex) => (
                    <th key={cellIndex} style={{ textAlign: cell.align ?? undefined }}>
                      {inline(cell.tokens, context) ?? cell.text}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} style={{ textAlign: cell.align ?? undefined }}>
                        {inline(cell.tokens, context) ?? cell.text}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      case 'html':
        return (
          <pre key={key} className="wt-md-pre wt-md-rawhtml">
            <code title="原始 HTML 不会被解析">{(token as Tokens.HTML).raw}</code>
          </pre>
        );

      default:
        return (
          <p key={key}>
            {'raw' in token ? (token as { raw: string }).raw : null}
          </p>
        );
    }
  });
}

/** Renders a parsed document to React nodes. */
export function renderMarkdown(
  parsed: ParseResult,
  options: { headingOffset?: number } = {},
): ReactNode {
  const context: RenderContext = {
    headingIds: parsed.headings.map((heading) => heading.id),
    headingCursor: { value: 0 },
    headingOffset: options.headingOffset ?? 1,
  };
  return block(parsed.tokens, context);
}

/** Ready-made sample covering the features worth demonstrating. */
export const SAMPLE_MARKDOWN = `# Markdown 预览

支持 **粗体**、*斜体*、~~删除线~~、\`行内代码\` 与 [链接](https://wheat.chat)。

## 列表与任务

- 无序项
- 带嵌套
  1. 有序子项
  2. 第二项

- [x] 已完成的任务
- [ ] 未完成的任务

## 代码块

\`\`\`ts
export function greet(name: string) {
  return \`你好，\${name}\`;
}
\`\`\`

## 表格

| 功能 | 状态 | 说明 |
| :--- | :---: | ---: |
| 表格 | 支持 | 含对齐 |
| 任务列表 | 支持 | GFM |
| 原始 HTML | 不解析 | 安全考虑 |

## 引用

> 引用块内的 **格式** 依然生效。
> 第二行。

---

安全说明：下方这段原始 HTML **不会**被执行，只会原样显示。

<script>alert('这段脚本不会运行')</script>
<img src=x onerror="alert('也不会')">
[危险链接](javascript:alert('被阻止'))
`;

/**
 * Sample used by the "HTML 注入" preset to show the defence in action.
 *
 * Covers both injection routes: raw HTML (rendered as inert text) and Markdown
 * syntax with a dangerous scheme (rendered as text with a blocked-link notice).
 */
export const XSS_SAMPLE = `# 注入测试

原始 HTML 一律按文本显示，不会解析：

<script>alert('原始 script 不会执行')</script>
<img src=x onerror="alert('onerror 不会执行')">

Markdown 语法里的危险链接会被阻止：

[用 javascript: 的链接](javascript:alert('被阻止'))

[用 data: 的链接](data:text/html,<script>alert(1)</script>)

[正常链接仍然可用](https://wheat.chat)
`;
