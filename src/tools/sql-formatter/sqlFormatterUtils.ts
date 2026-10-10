/**
 * SQL 美化 / 压缩：词法扫描 + 排版。
 *
 * ## 为什么不是"正则替换关键字"
 *
 * 最省事的实现是全局把 `\bselect\b` 之类替换成大写，再在关键字前面插入换行。
 * 那样一定会误伤：字符串字面量、引号标识符和注释里的 `select` 不是关键字。
 * `SELECT 'from where select' FROM t` 会被改成 `SELECT 'FROM WHERE SELECT' FROM t`，
 * 语义直接变了。所以这里先做一次逐字符的词法扫描，把源码切成
 * 「字符串 / 引号标识符 / 注释 / 数字 / 操作符 / 词」几类 token，
 * 之后所有排版都只在 token 边界上做，字符串与注释的原文一个字节都不碰。
 *
 * 扫描器还负责两件扫描时才看得清的事：
 *
 * 1. **括号配平**：栈里记录每种左括号出现的位置，报错时能给出行列；
 * 2. **引号闭合**：字符串扫到结尾仍未闭合就报错，而不是默默把整段吃掉。
 *
 * 支持 SQL 标准与几种主流的引用写法：`'...'`、`"..."`、反引号标识符、
 * 方括号标识符、以及 PostgreSQL 的美元引用（`$tag$ ... $tag$`）。
 * 转义按各自方言的规矩处理：单引号与反引号用反斜杠转义，双引号与方括号
 * 用「写两遍」转义。
 *
 * 不做什么：不连数据库、不校验方言语义、不做语法树级别的重写。
 * 排版只保证 token 序列（以及其中的字面量原文）不变。
 */

export type TokenKind =
  | 'word'
  | 'number'
  | 'string'
  | 'comment'
  | 'punct'
  | 'operator';

export interface SqlToken {
  kind: TokenKind;
  /** 原文切片。字符串与注释始终保持原样。 */
  text: string;
  start: number;
  /** 1 起算的行号。 */
  line: number;
  /** 1 起算的列号（按 UTF-16 代码单元计）。 */
  column: number;
}

export interface SqlError {
  message: string;
  line: number;
  column: number;
  /** 出错那一段原文的偏移，用于界面高亮。 */
  index: number;
  /** 出错位置所在行，附带一个指向列号的插入符。 */
  snippet?: string;
}

export interface SqlFormatOptions {
  /** 缩进空格数，默认 2。 */
  indent?: number;
  /** 逗号写法：`trailing` 为 `a,` 换行，`leading` 为换行后 `, a`。 */
  comma?: 'trailing' | 'leading';
  /** 压缩成单行：换行与缩进全部去掉。 */
  compact?: boolean;
  /** 压缩时是否保留注释，默认 false（压缩通常是为了塞进一行执行）。 */
  keepComments?: boolean;
}

export type SqlFormatResult =
  | {
      ok: true;
      sql: string;
      /** token 数量，用于界面上的统计。 */
      tokens: number;
      lines: number;
    }
  | { ok: false; error: SqlError };

/* ------------------------------------------------------------------ */
/* 词法扫描                                                             */
/* ------------------------------------------------------------------ */

const SINGLE_QUOTES = "'`";
const PAIR_QUOTES: Record<string, string> = { '"': '"', '[': ']' };

interface QuoteResult {
  text: string;
  end: number;
  closed: boolean;
}

/**
 * 从 `start` 处的引号字符开始读一段引用内容。
 *
 * `backslash` 为真时把 `\x` 当作两字符转义（MySQL 风格），否则用「写两遍」
 * 表示一个引号字符（SQL 标准风格）。
 */
function readQuoted(source: string, start: number, open: string, backslash: boolean): QuoteResult {
  const close = PAIR_QUOTES[open] ?? open;
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (backslash && ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === close) {
      if (source[i + 1] === close) {
        i += 2;
        continue;
      }
      return { text: source.slice(start, i + 1), end: i + 1, closed: true };
    }
    i += 1;
  }
  return { text: source.slice(start), end: source.length, closed: false };
}

/** 在 `source` 的 `from` 处读出 `$tag$` 形式的美元引用定界符，读不到返回 null。 */
function readDollarTag(source: string, from: number): string | null {
  if (source[from] !== '$') return null;
  let i = from + 1;
  if (source[i] === '$') return '$$';
  if (!/[A-Za-z_]/.test(source[i] ?? '')) return null;
  i += 1;
  while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) i += 1;
  return source[i] === '$' ? source.slice(from, i + 1) : null;
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_$\u0080-\uFFFF]/.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/**
 * 全部操作符，长的在前。
 *
 * 顺序有意义：`->>` 必须在 `->` 之前匹配，否则会被拆成 `->` 加 `>`。
 */
const OPERATORS = [
  '->>',
  '#>>',
  '!~~*',
  '!~~',
  '~~*',
  '::',
  '<=',
  '>=',
  '<>',
  '!=',
  '||',
  '->',
  '#>',
  ':=',
  '=>',
  '<<',
  '>>',
  '!~',
  '~*',
  '~~',
  '@>',
  '<@',
  '&&',
  '|/',
  '||/',
  '..',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '=',
  '<',
  '>',
  '~',
  '&',
  '|',
  '!',
  '?',
  '@',
  '#',
];

const PUNCTUATION = '(),.;[]{}:';

function locationAt(source: string, index: number): { line: number; column: number } {
  const before = source.slice(0, index);
  const lastBreak = before.lastIndexOf('\n');
  return {
    line: before.split('\n').length,
    column: index - lastBreak,
  };
}

function errorAt(source: string, index: number, message: string): SqlError {
  const { line, column } = locationAt(source, index);
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  const lineEndRaw = source.indexOf('\n', index);
  const lineEnd = lineEndRaw === -1 ? source.length : lineEndRaw;
  return {
    message,
    line,
    column,
    index,
    snippet: `${source.slice(lineStart, lineEnd)}\n${' '.repeat(Math.max(0, column - 1))}^`,
  };
}

/**
 * 扫描失败时抛出的内部错误，由 `tokenize` 转成 `SqlError`。
 *
 * 用异常是因为深层递归里发现"引号没闭合"时，把失败一路当返回值传上来会让
 * 每个分支都要处理它；异常在这里只用于不可恢复的输入错误。
 */
class LexError extends Error {
  constructor(
    readonly index: number,
    message: string,
  ) {
    super(message);
    this.name = 'LexError';
  }
}

export type TokenizeResult =
  | { ok: true; tokens: SqlToken[] }
  | { ok: false; error: SqlError };

/** 把 SQL 源码切成 token；引号未闭合时返回错误。 */
export function tokenize(source: string): TokenizeResult {
  const tokens: SqlToken[] = [];
  let i = 0;

  const at = (start: number, kind: TokenKind, end: number) => {
    const { line, column } = locationAt(source, start);
    tokens.push({ kind, text: source.slice(start, end), start, line, column });
  };

  try {
    while (i < source.length) {
      const ch = source[i];

      if (/\s/.test(ch)) {
        i += 1;
        continue;
      }

      // 行注释：`--` 直到行尾（注意这里只写两个连字符，行内注释不影响扫描）
      if (ch === '-' && source[i + 1] === '-') {
        let end = source.indexOf('\n', i);
        if (end === -1) end = source.length;
        at(i, 'comment', end);
        i = end;
        continue;
      }

      // 块注释：斜杠加星号开始，星号加斜杠结束
      if (ch === '/' && source[i + 1] === '*') {
        let depth = 1;
        let j = i + 2;
        while (j < source.length && depth > 0) {
          if (source[j] === '/' && source[j + 1] === '*') {
            depth += 1;
            j += 2;
          } else if (source[j] === '*' && source[j + 1] === '/') {
            depth -= 1;
            j += 2;
          } else {
            j += 1;
          }
        }
        if (depth > 0) throw new LexError(i, '块注释没有闭合');
        at(i, 'comment', j);
        i = j;
        continue;
      }

      // PostgreSQL 美元引用：$tag$ ... $tag$
      const dollarTag = readDollarTag(source, i);
      if (dollarTag !== null) {
        const close = source.indexOf(dollarTag, i + dollarTag.length);
        if (close === -1) {
          throw new LexError(i, `美元引用 ${dollarTag} 没有找到配对的结束标记`);
        }
        at(i, 'string', close + dollarTag.length);
        i = close + dollarTag.length;
        continue;
      }

      // 字符串与引号标识符
      if (SINGLE_QUOTES.includes(ch) || ch === '"' || ch === '[') {
        const quoted = readQuoted(source, i, ch, ch === "'" || ch === '`' || ch === '"');
        if (!quoted.closed) throw new LexError(i, `引号 ${ch} 没有闭合`);
        at(i, 'string', quoted.end);
        i = quoted.end;
        continue;
      }

      // 数字：十六进制、小数、指数，以及结尾可选的类型转换（`1::int` 不在这里吃）
      if (isDigit(ch) || (ch === '.' && isDigit(source[i + 1] ?? ''))) {
        const start = i;
        if (ch === '0' && /[xX]/.test(source[i + 1] ?? '')) {
          i += 2;
          while (i < source.length && /[0-9a-fA-F]/.test(source[i])) i += 1;
        } else {
          while (i < source.length && isDigit(source[i])) i += 1;
          if (source[i] === '.') {
            i += 1;
            while (i < source.length && isDigit(source[i])) i += 1;
          }
          if (/[eE]/.test(source[i] ?? '') && /[0-9+-]/.test(source[i + 1] ?? '')) {
            i += 1;
            if (source[i] === '+' || source[i] === '-') i += 1;
            while (i < source.length && isDigit(source[i])) i += 1;
          }
        }
        // `1.5` 是一个数字，但 `1.` 后面跟标识符（如 `2.foo`）时那个点是成员访问，
        // 不属于数字，留到下一轮当标点处理。
        if (source[i - 1] === '.' && !isDigit(source[i] ?? '')) i -= 1;
        at(start, 'number', i);
        continue;
      }

      // 词：字母/下划线/高位字符开头，可含数字与 `$`
      if (/[A-Za-z_\u0080-\uFFFF]/.test(ch)) {
        const start = i;
        while (i < source.length && isWordChar(source[i])) i += 1;
        at(start, 'word', i);
        continue;
      }

      // 操作符，长匹配优先
      const operator = OPERATORS.find((candidate) => source.startsWith(candidate, i));
      if (operator !== undefined) {
        at(i, 'operator', i + operator.length);
        i += operator.length;
        continue;
      }

      if (PUNCTUATION.includes(ch)) {
        at(i, 'punct', i + 1);
        i += 1;
        continue;
      }

      // 不认识的字符（例如全角标点）按单字符操作符放行，排版时原样输出，
      // 而不是让整次格式化失败。
      at(i, 'operator', i + 1);
      i += 1;
    }
  } catch (error) {
    if (error instanceof LexError) {
      return { ok: false, error: errorAt(source, error.index, error.message) };
    }
    throw error;
  }

  return { ok: true, tokens };
}

/* ------------------------------------------------------------------ */
/* 括号配平                                                             */
/* ------------------------------------------------------------------ */

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/**
 * 检查括号配平。
 *
 * 只在外面套一层而不是塞进扫描器，是因为"配平"是整段文本的性质：
 * 多出来的右括号可能出现在任意位置，提前 return 会漏掉后面更早的左括号。
 */
export function validateBrackets(tokens: SqlToken[], source: string): SqlError | null {
  const stack: SqlToken[] = [];
  for (const token of tokens) {
    if (token.kind !== 'punct') continue;
    if (OPENERS[token.text]) {
      stack.push(token);
      continue;
    }
    const expected = CLOSERS[token.text];
    if (!expected) continue;
    const top = stack.pop();
    if (!top) {
      return errorAt(source, token.start, `多出一个右括号 ${token.text}，没有与之配对的左括号`);
    }
    if (top.text !== expected) {
      return errorAt(
        source,
        token.start,
        `括号不匹配：第 ${top.line} 行第 ${top.column} 列的 ${top.text} 期望配对的收尾是 ` +
          `${OPENERS[top.text]}，这里却是 ${token.text}`,
      );
    }
  }
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    return errorAt(
      source,
      top.start,
      `左括号 ${top.text} 没有闭合，缺少 ${OPENERS[top.text]}`,
    );
  }
  return null;
}

/** 只做校验，不做排版。 */
export function validateSql(source: string): { ok: true; tokens: number } | { ok: false; error: SqlError } {
  const scanned = tokenize(source);
  if (!scanned.ok) return scanned;
  const bracketError = validateBrackets(scanned.tokens, source);
  if (bracketError) return { ok: false, error: bracketError };
  return { ok: true, tokens: scanned.tokens.length };
}

/* ------------------------------------------------------------------ */
/* 关键字                                                               */
/* ------------------------------------------------------------------ */

const KEYWORD_LIST = `ADD ALL ALTER ANALYZE AND ANY AS ASC AUTOINCREMENT BEGIN BETWEEN BOTH BY
CASCADE CASE CAST CHECK COLLATE COLUMN COMMIT CONFLICT CONSTRAINT CREATE CROSS CURRENT_DATE
CURRENT_TIME CURRENT_TIMESTAMP DATABASE DEFAULT DEFERRABLE DELETE DESC DESCRIBE DISTINCT DO
DROP ELSE END ESCAPE EXCEPT EXISTS EXPLAIN FALSE FETCH FILTER FIRST FOLLOWING FOR FOREIGN FROM
FULL FUNCTION GLOB GRANT GROUP HAVING IF IGNORE ILIKE IN INDEX INNER INSERT INTERSECT INTO IS
ISNULL JOIN KEY LAST LEFT LIKE LIMIT MATCH NATURAL NOT NOTHING NOTNULL NULL NULLS OFFSET ON OR
ORDER OUTER OVER PARTITION PRAGMA PRIMARY PROCEDURE RANGE RECURSIVE REFERENCES REGEXP REINDEX
RELEASE RENAME REPLACE RESTRICT RETURNING RIGHT ROLLBACK ROW ROWS SAVEPOINT SELECT SET SIMILAR
TABLE TEMP TEMPORARY THEN TO TRANSACTION TRIGGER TRUE TRUNCATE UNBOUNDED UNION UNIQUE UPDATE
USING VACUUM VALUES VIEW WHEN WHERE WINDOW WITH WITHOUT`.split(/\s+/);

/** 大写关键字集合，导出给检查脚本做对照。 */
export const KEYWORDS: ReadonlySet<string> = new Set(KEYWORD_LIST);

function isKeyword(text: string): boolean {
  return KEYWORDS.has(text.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* 排版                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 会另起一行的子句短语（长的必须排在前面，匹配是从上往下取的）。
 *
 * `body` 为真表示这个子句的主体是一张列表：它所在括号深度上的逗号要换行，
 * 列表项一行一个。而 `WHERE a IN (1, 2, 3)` 的逗号深度更深（在括号里），
 * 因此不会被拆开——只有当前子句深度的逗号才换行。
 *
 * 只收录"出现在语句或子句开头"的写法。像 `BETWEEN ... AND ...` 里的 AND、
 * `OVER (PARTITION BY ...)` 里的 PARTITION 都不在这里，所以不会被拆行。
 */
const CLAUSE_PHRASES: Array<{ words: string[]; body: boolean }> = [
  { words: ['FULL', 'OUTER', 'JOIN'], body: true },
  { words: ['LEFT', 'OUTER', 'JOIN'], body: true },
  { words: ['RIGHT', 'OUTER', 'JOIN'], body: true },
  { words: ['CROSS', 'JOIN'], body: true },
  { words: ['INNER', 'JOIN'], body: true },
  { words: ['LEFT', 'JOIN'], body: true },
  { words: ['RIGHT', 'JOIN'], body: true },
  { words: ['FULL', 'JOIN'], body: true },
  { words: ['NATURAL', 'JOIN'], body: true },
  { words: ['GROUP', 'BY'], body: true },
  { words: ['ORDER', 'BY'], body: true },
  { words: ['UNION', 'ALL'], body: false },
  { words: ['UNION'], body: false },
  { words: ['INTERSECT'], body: false },
  { words: ['EXCEPT'], body: false },
  { words: ['SELECT'], body: true },
  { words: ['FROM'], body: true },
  { words: ['WHERE'], body: false },
  { words: ['HAVING'], body: false },
  { words: ['LIMIT'], body: false },
  { words: ['OFFSET'], body: false },
  { words: ['JOIN'], body: true },
  { words: ['VALUES'], body: true },
  { words: ['RETURNING'], body: true },
  { words: ['SET'], body: true },
  { words: ['USING'], body: true },
  { words: ['INSERT', 'INTO'], body: false },
  { words: ['DELETE', 'FROM'], body: false },
  { words: ['UPDATE'], body: false },
  { words: ['WITH'], body: false },
  { words: ['ON', 'CONFLICT'], body: false },
  { words: ['ON', 'DUPLICATE'], body: false },
];

/** 连写在一起、不能从中间拆开的连接类型前缀。 */
const JOIN_PREFIX = new Set(['LEFT', 'RIGHT', 'FULL', 'INNER', 'CROSS', 'NATURAL', 'OUTER']);

/**
 * 需要把紧随其后的括号当作"列定义列表"的短语。
 *
 * `CREATE TABLE t (a int, b text)` 里的逗号不在任何子句主体里，但它和
 * SELECT 列表一样应该一行一项。
 */
const TABLE_BODY_PHRASES: string[][] = [
  ['CREATE', 'TABLE'],
  ['CREATE', 'TEMP', 'TABLE'],
  ['CREATE', 'TEMPORARY', 'TABLE'],
  ['CREATE', 'INDEX'],
  ['CREATE', 'UNIQUE', 'INDEX'],
  ['ALTER', 'TABLE'],
];

/** 关键字后面跟左括号时要留一个空格（`IN (1, 2)` 而不是 `IN(1, 2)`）。 */
const SPACE_BEFORE_PAREN = new Set(
  ('IN EXISTS VALUES ANY ALL SOME NOT AND OR SELECT WHERE FROM JOIN ON USING BETWEEN LIKE ' +
    'CASE WHEN THEN ELSE END OVER UNION INTERSECT EXCEPT RETURNING SET AS BY DISTINCT')
    .split(' ')
    .filter(Boolean),
);

/** 让排版可以重启的"语句节拍"，用于扫描括号里是否藏了一个子查询。 */
const SUBQUERY_HEADS = new Set(['SELECT', 'VALUES', 'INSERT', 'UPDATE', 'DELETE', 'WITH', 'TABLE']);
const STANDALONE_WORDS = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'VALUES', 'TABLE']);

function upperAt(tokens: SqlToken[], index: number, length: number): string | null {
  if (index + length > tokens.length) return null;
  const parts: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const token = tokens[index + i];
    if (token.kind !== 'word') return null;
    parts.push(token.text.toUpperCase());
  }
  return parts.join(' ');
}

/**
 * 左括号内是否藏着一条完整的子查询。
 *
 * 只有这种情况才把括号里的内容当作独立查询排版并整体缩进。函数调用、
 * `IN (...)` 列表、行构造器都保持内联——把 `IN` 的取值列表一行一个展开
 * 反而更难读。
 */
function opensSubquery(tokens: SqlToken[], openIndex: number): boolean {
  const first = upperAt(tokens, openIndex + 1, 1);
  if (first !== null && SUBQUERY_HEADS.has(first)) return true;

  // 第一个词不是查询头时，继续看括号内部：`(WITH x AS (...) SELECT ...)`
  // 或者 `(VALUES (1), (2))` 这类形状的第一个词就不是 SELECT。
  // 注意 `INSERT INTO t (a, b)` 的括号是列清单，它遇到 `)` 就返回 false。
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind === 'punct') {
      if (token.text === '(') depth += 1;
      else if (token.text === ')') {
        depth -= 1;
        if (depth === 0) return false;
      } else if (token.text === ';' && depth === 1) {
        return false;
      }
      continue;
    }
    if (token.kind !== 'word' || depth !== 1) continue;
    const word = token.text.toUpperCase();
    if (STANDALONE_WORDS.has(word)) return true;
    if (word === 'WITH') {
      // WITH 后面要先跨过一组 CTE 定义，再看有没有跟 SELECT / VALUES。
      let inner = 0;
      for (let j = i + 1; j < tokens.length; j += 1) {
        const next = tokens[j];
        if (next.kind === 'punct' && next.text === '(') inner += 1;
        else if (next.kind === 'punct' && next.text === ')') {
          if (inner === 0) break;
          inner -= 1;
        } else if (inner === 0 && next.kind === 'word' && /^(SELECT|VALUES)$/.test(next.text.toUpperCase())) {
          return true;
        }
      }
      return false;
    }
    // `UPDATE` / `DELETE` / `INSERT` 出现在括号首层时，只有紧跟查询体才算子查询；
    // 保守起见只在开头已经判过（上面的 SUBQUERY_HEADS）时才认定。
  }
  return false;
}

function isSubqueryOpen(tokens: SqlToken[], index: number): boolean {
  const token = tokens[index];
  return token.kind === 'punct' && token.text === '(' && opensSubquery(tokens, index);
}

/** 词是否位于点号之后（`t.select` 里的 select 是列名，不是关键字）。 */
function followsDot(tokens: SqlToken[], index: number): boolean {
  let i = index - 1;
  while (i >= 0 && tokens[i].kind === 'comment') i -= 1;
  return i >= 0 && tokens[i].kind === 'punct' && tokens[i].text === '.';
}

/** SQL 运算符的字母写法，大小写不敏感地转成大写。 */
const WORD_OPERATORS = new Set([
  'AND', 'OR', 'NOT', 'IN', 'IS', 'LIKE', 'ILIKE', 'GLOB', 'REGEXP', 'BETWEEN', 'ESCAPE',
  'ISNULL', 'NOTNULL', 'EXISTS', 'ANY', 'ALL', 'SOME', 'SIMILAR', 'COLLATE',
]);

/** 上下文栈：用来判断某个逗号是不是"列表里的分隔符"。 */
interface FormatFrame {
  /** 该作用域里应当换行的逗号所处的括号深度；-1 表示该子句不按逗号断行。 */
  breakDepth: number;
  /** 这一层括号是否包着一条子查询（决定收尾括号要不要独占一行）。 */
  isSubquery: boolean;
  /** 这一层括号里的子句关键字是否禁止换行（函数调用、取值列表等）。 */
  suppressClauses: boolean;
}

/**
 * 极简的输出缓冲。
 *
 * 换行先记账、等内容真的写下来时才落笔：这样连续调用 `newline()` 只会得到
 * 一个空行，结尾也没有悬空的换行要收拾。缩进写成 `pad()` 与随后 `write()`
 * 的内容一起落笔，保证"这行是不是空的"这类判断只看真实内容。
 */
class Printer {
  private buffer = '';
  private pending: string | null = null;
  /** 是否停在一行开头（此时 `space()` 不产生任何输出）。 */
  atLineStart = true;

  write(text: string): void {
    if (this.pending !== null) {
      // 缓冲区还是空的时候丢掉这次换行：语句开头的 SELECT 也走"先记一次
      // 换行、再写内容"这条路，照写就会得到一个前导空行。
      if (this.buffer !== '') this.buffer += this.pending;
      this.pending = null;
    }
    this.buffer += text;
    this.atLineStart = false;
  }

  /** 记一次换行（`pad` 是下一行开头的缩进）。 */
  newline(pad = ''): void {
    this.pending = `\n${pad}`;
    this.atLineStart = true;
  }

  /** 写一个空格；行首与已经有空格时都不写。 */
  space(): void {
    if (this.atLineStart || this.pending !== null) return;
    if (this.buffer.endsWith(' ') || this.buffer.endsWith('\n')) return;
    this.buffer += ' ';
  }

  /** 当前行已有的内容（不含换行），用于判断"这行是不是只有缩进"。 */
  currentLine(): string {
    const breakAt = this.buffer.lastIndexOf('\n');
    return this.buffer.slice(breakAt + 1);
  }

  text(): string {
    return this.buffer;
  }
}

function needsSpaceBetween(previous: SqlToken | null, token: SqlToken, tokens: SqlToken[], index: number): boolean {
  if (!previous) return false;
  if (previous.kind === 'punct' && (previous.text === '(' || previous.text === '[' || previous.text === '.')) {
    return false;
  }
  if (token.kind === 'punct' && (token.text === ')' || token.text === ']' || token.text === ',' || token.text === ';' || token.text === '.')) {
    return false;
  }
  if (token.kind === 'punct' && (token.text === '(' || token.text === '[')) {
    if (previous.kind !== 'word') return false;
    const word = previous.text.toUpperCase();
    if (WORD_OPERATORS.has(word) || SPACE_BEFORE_PAREN.has(word)) return true;
    // 普通函数名/关键字与括号之间不留空格：`count(x)`、`AS(x)` 之类都合法。
    return false;
  }
  // 一元正负号与数字紧贴：`-1` 不写 `- 1`。
  if (
    previous.kind === 'operator' &&
    (previous.text === '-' || previous.text === '+') &&
    token.kind === 'number' &&
    !followsDot(tokens, index - 1)
  ) {
    return false;
  }
  return true;
}

/**
 * 把 SQL 排版成可读形式。
 *
 * 输出只由 token 序列决定：换行只加在子句短语前、子查询左括号后、配对的
 * 右括号前、列表逗号处和分号后，缩进只加在行首；其余位置最多把连续空白
 * 收敛成一个空格，因此不会改变任何 token 的文本。
 */
export function formatSql(source: string, options: SqlFormatOptions = {}): SqlFormatResult {
  const indent = Math.max(0, Math.min(8, Math.floor(options.indent ?? 2)));
  const comma = options.comma ?? 'trailing';
  const compact = options.compact === true;
  const keepComments = options.keepComments === true;

  const scanned = tokenize(source);
  if (!scanned.ok) return scanned;
  const { tokens } = scanned;
  const bracketError = validateBrackets(tokens, source);
  if (bracketError) return { ok: false, error: bracketError };

  if (tokens.length === 0) {
    return { ok: true, sql: '', tokens: 0, lines: 0 };
  }

  const printer = new Printer();
  let depth = 0;
  const stack: FormatFrame[] = [{ breakDepth: 0, isSubquery: false, suppressClauses: false }];
  /** 是否处于 CREATE TABLE / CREATE INDEX 这类"列定义列表"的括号之前。 */
  let expectTableBody = false;

  const pad = () => ' '.repeat(indent * depth);
  /**
   * 子句主体里的列表项用的缩进：比子句关键字多一级。
   *
   * 子句自己缩进由括号深度决定（`FROM (` 里的子查询整体缩进一级），但列表项
   * 若也只按括号深度缩进，顶层的 `SELECT a,` / `b` 就会齐平在列 0，看不出
   * 层级。多给一级之后：
   *
   *   SELECT c.id,
   *     c.name
   *   FROM t
   *
   * 选项 `indent` 因此始终有可见效果。
   */
  const padBreak = () => ' '.repeat(indent * (depth + 1));

  /** 当前作用域里"可换行的逗号"所在深度。 */
  const breakDepth = () => stack[stack.length - 1].breakDepth;

  /** 设置当前作用域的换行逗号深度（子句主体是一张列表时才调用）。 */
  const setBreakDepth = (value: number) => {
    stack[stack.length - 1].breakDepth = value;
  };

  /**
   * 子句是否可以在此处另起一行。
   *
   * 处在函数调用或 `IN (...)` 这类普通括号里时不行：`row_number() OVER (...)`
   * 里的 `ORDER BY`、`GROUP_CONCAT(x ORDER BY y)` 里的 `ORDER BY` 都只是
   * 括号参数的一部分，拆行会把行内表达式拆散。只有位于子查询括号里
   * （`FROM (SELECT ...)`）或不在任何括号里时才允许换行。
   */
  const canBreakClause = () => !stack[stack.length - 1].suppressClauses;

  /** 跳过注释后，从 `from` 往前找下一个实质 token 的下标。 */
  const previousMeaningful = (from: number): number => {
    let i = from;
    while (i >= 0 && tokens[i].kind === 'comment') i -= 1;
    return i;
  };

  /** 从 `index` 起匹配一个子句短语。 */
  const matchClause = (index: number): { length: number; body: boolean } | null => {
    for (const phrase of CLAUSE_PHRASES) {
      const upper = upperAt(tokens, index, phrase.words.length);
      if (upper === null) continue;
      if (upper === phrase.words.join(' ')) {
        return {
          length: phrase.words.length,
          body: phrase.body,
        };
      }
    }
    return null;
  };

  /** 从 `index` 起匹配一个"表体"短语。 */
  const matchTableBody = (index: number): number | null => {
    for (const phrase of TABLE_BODY_PHRASES) {
      const upper = upperAt(tokens, index, phrase.length);
      if (upper !== null && upper === phrase.join(' ')) return phrase.length;
    }
    return null;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const previousIndex = previousMeaningful(index - 1);
    const previous = previousIndex >= 0 ? tokens[previousIndex] : null;

    if (token.kind === 'comment') {
      if (compact && !keepComments) continue;
      if (compact) {
        printer.space();
        printer.write(token.text);
        continue;
      }
      const isLine = token.text.startsWith('--');
      if (!printer.atLineStart) {
        if (isLine) printer.newline(pad());
        else printer.space();
      }
      printer.write(token.text);
      if (isLine) printer.newline(pad());
      continue;
    }

    if (token.kind === 'punct') {
      if (token.text === '(') {
        const subquery = isSubqueryOpen(tokens, index);
        if (needsSpaceBetween(previous, token, tokens, index)) printer.space();
        printer.write('(');
        const inner = depth + 1;
        if (subquery && !compact) {
          // 子查询整体缩进一级，并且它自己的 SELECT 列表按新深度换行。
          depth = inner;
          stack.push({ breakDepth: inner, isSubquery: true, suppressClauses: false });
          printer.newline(pad());
        } else if (expectTableBody && !compact) {
          // `CREATE TABLE t (a int, b text)`：这一层括号是列定义列表，
          // 逗号按列换行，但里面的 `PRIMARY KEY` 之类不算子句。
          expectTableBody = false;
          stack.push({ breakDepth: inner, isSubquery: false, suppressClauses: true });
        } else {
          // 函数调用、`IN (...)`、`VALUES (1, 2)` 的行记录都保持内联。
          stack.push({ breakDepth: breakDepth(), isSubquery: false, suppressClauses: true });
        }
        continue;
      }
      if (token.text === '[' || token.text === '{') {
        if (needsSpaceBetween(previous, token, tokens, index)) printer.space();
        printer.write(token.text);
        depth += 1;
        continue;
      }
      if (token.text === ')') {
        const frame = stack.length > 1 ? stack.pop() : null;
        if (frame?.isSubquery && !compact) {
          depth -= 1;
          if (printer.currentLine().trim() !== '') printer.newline(pad());
        }
        printer.write(token.text);
        continue;
      }
      if (token.text === ']' || token.text === '}') {
        printer.write(token.text);
        if (depth > 0) depth -= 1;
        continue;
      }
      if (token.text === ',') {
        if (compact) {
          printer.write(',');
        } else if (comma === 'trailing') {
          printer.write(',');
          if (depth === breakDepth()) printer.newline(padBreak());
          else printer.space();
        } else if (depth === breakDepth()) {
          printer.newline(padBreak());
          printer.write(', ');
        } else {
          printer.write(',');
          printer.space();
        }
        continue;
      }
      if (token.text === ';') {
        printer.write(';');
        if (!compact) printer.newline('');
        continue;
      }
      printer.write(token.text);
      continue;
    }

    if (token.kind === 'word') {
      const upper = token.text.toUpperCase();
      const atDot = followsDot(tokens, index);
      const clause = compact || atDot || !canBreakClause() ? null : matchClause(index);

      if (!compact) {
        // `LEFT` / `OUTER` 这类连接前缀已经起过一行，紧随其后的 JOIN 要贴
        // 上去写成 `LEFT JOIN`；`JOIN t ON ...` 里的 ON 则单独起一行。
        const joinPrefix = previous !== null && JOIN_PREFIX.has(previous.text.toUpperCase());
        const joinCondition =
          upper === 'ON' && clause === null && breakDepth() !== -1 && !joinPrefix;
        if ((clause !== null && !joinPrefix) || joinCondition) {
          printer.newline(pad());
        }
        if (clause !== null) {
          // 只有"带列表主体"的子句才把逗号设为换行点：
          // `INSERT INTO t (a, b)` 的列清单、`IN (1, 2, 3)` 都靠这一点保持内联。
          setBreakDepth(clause.body ? depth : -1);
          if (matchTableBody(index) !== null) {
            // CREATE TABLE t (...) 的列定义列表：那个左括号要展开。
            expectTableBody = true;
          }
        }
      }

      if (needsSpaceBetween(previous, token, tokens, previousIndex)) printer.space();
      const keepOriginal = atDot || (!isKeyword(token.text) && !WORD_OPERATORS.has(upper));
      printer.write(keepOriginal ? token.text : upper);
      continue;
    }

    // 数字与操作符
    if (needsSpaceBetween(previous, token, tokens, index)) printer.space();
    printer.write(token.text);
  }

  // 结尾不留多余空行，也不让文件以大量空行结束。
  const lines = printer.text().replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  return {
    ok: true,
    sql: lines,
    tokens: tokens.length,
    lines: lines === '' ? 0 : lines.split('\n').length,
  };
}

/** 把多行 SQL 压成一行（字符串与注释里的内容不动）。 */
export function compactSql(source: string, keepComments = false): SqlFormatResult {
  return formatSql(source, { compact: true, keepComments });
}

/* ------------------------------------------------------------------ */
/* 给界面与检查用的辅助                                                  */
/* ------------------------------------------------------------------ */

export interface LiteralRecord {
  kind: 'string' | 'comment';
  text: string;
}

/**
 * 取出所有字符串、引用标识符与注释的原文。
 *
 * 这是"排版不改写字面量"这一断言的抓手：格式化前后各取一次，逐条比对应
 * 当完全一致（顺序也一致，因为排版不改动 token 的顺序）。
 */
export function collectLiterals(tokens: SqlToken[]): LiteralRecord[] {
  return tokens
    .filter((token): token is SqlToken & { kind: 'string' | 'comment' } =>
      token.kind === 'string' || token.kind === 'comment',
    )
    .map((token) => ({ kind: token.kind, text: token.text }));
}

/** 供检查脚本对照：正则朴素替换会怎么做（会被字符串里的关键字误伤）。 */
export function naiveUppercaseKeywords(source: string): string {
  return source.replace(/\b(select|from|where|join|on|group by|order by)\b/gi, (match) =>
    match.toUpperCase(),
  );
}

export const SQL_SAMPLE = `-- 统计每个客户的订单金额，只取最近 90 天
select c.id, c.name as customer,
       count(o.id) as orders,
       sum(o.total) as amount
  from customers c
  left join orders o on o.customer_id = c.id and o.status <> 'cancelled'
 where c.created_at >= date('now', '-90 days')
   and c.name like '%from where%'
 group by c.id, c.name
having sum(o.total) > 100
 order by amount desc
 limit 20;`;

export const SQL_SAMPLE_DIALECTS = [
  {
    label: '字符串里的关键字',
    sql: "SELECT 'from where select' AS note FROM t WHERE label = 'it''s fine';",
  },
  {
    label: '引号标识符',
    sql: 'SELECT "select", `from`, [where] FROM "order";',
  },
  {
    label: '注释里的关键字',
    sql: 'SELECT a /* from where */ FROM t; -- select and where here',
  },
  {
    label: '美元引用',
    sql: "SELECT $$from where select$$ AS body, $tag$it's$tag$ AS other;",
  },
];
