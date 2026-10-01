/**
 * Arithmetic engine behind the expression calculator.
 *
 * Pure logic: this module never touches the DOM, the clock, storage or React,
 * and — the whole point of the tool — it never asks the JavaScript engine to
 * evaluate the input. Every export is a plain function of its arguments, which
 * is what lets the check script drive the engine directly from Node.
 *
 * ## Why this is a hand-written lexer and parser instead of `eval`
 *
 * `eval` and `new Function` hand the raw text to the JavaScript parser, and the
 * JavaScript grammar is enormously wider than arithmetic: member access, calls,
 * `new`, assignments, whole statements. A "calculator" built on one of them
 * therefore executes whatever the string says. In a browser that means a pasted
 * expression can read localStorage or cookies, issue a fetch with them, block
 * the tab in an endless loop, or reach the real global object through
 * `constructor.constructor`. It is not a theoretical risk: the whole genre of
 * "expression evaluator" bugs is this exact mistake.
 *
 * Sanitising the text with a blacklist regex does not close the hole. Escapes
 * are decoded by the parser *after* the filter has inspected the characters, so
 * a spelling such as a backslash-u escape for a letter slips past a filter that
 * looks for the assembled word, and then runs. The check script contains that
 * demonstration (see the counter-example section) precisely because "we filter
 * it" is the wrong-but-tempting answer.
 *
 * The robust fix is for the JavaScript engine to never see the input: lex it
 * and parse it here, against a grammar that contains nothing but numbers,
 * operators, function calls and named constants. That is what this file does.
 * The worst an input can do is produce an error message.
 *
 * ## Numbers
 *
 * Everything is an IEEE-754 double, exactly like `Math`. That is a deliberate
 * choice over BigInt or a decimal library:
 *
 * - The results agree with `Math`, with the `eval` oracle used by the checks,
 *   and with the arithmetic the user gets in their own code.
 * - Constants such as `pi` and `e` are irrational, so "exact decimal" is not a
 *   promise this tool could keep anyway once a transcendental function appears.
 * - Arbitrary precision would need a whole arithmetic library (and would make
 *   `sqrt(2)` either inexact again or very slow), which is a different tool.
 *
 * The visible cost is `0.1 + 0.2`, which prints as `0.30000000000000004`. The
 * UI reports that instead of hiding it; see `looksLikeRoundingArtifact`.
 *
 * ## Grammar
 *
 *   expression := term (('+' | '-') term)*                 left associative
 *   term       := unary (('*' | '/' | '%') unary)*         left associative
 *   unary      := '-' unary | power                        prefix, covers --x too
 *   power      := postfix ('^' unary)?                     right associative
 *   postfix    := primary ('!')*                           postfix factorial
 *   primary    := number | constant | name '(' args ')' | '(' expression ')'
 *
 * The two classic traps are encoded above and pinned by known values in the
 * check script:
 *
 * - `^` takes its right operand from `unary`, so it is right associative
 *   (`2^3^2` is `2^(3^2)` = 512) and its exponent may be negated (`2^-1` = 0.5).
 * - `unary` sits *below* `power`, so the minus in `-2^2` applies to the whole
 *   power: the result is -4, not 4.
 */

export type AngleMode = 'rad' | 'deg';

export interface EvaluateOptions {
  /** How trigonometric arguments and results are interpreted. */
  angleMode?: AngleMode;
}

export interface FormatOptions {
  /**
   * Fixed number of fraction digits, or `null` for the shortest decimal string
   * that round-trips to the same double.
   */
  decimals?: number | null;
  /** Insert thousands separators into the integer part. */
  group?: boolean;
}

/** One folded sub-expression, in evaluation order. */
export interface MathStep {
  /**
   * The sub-expression text exactly as the user typed it, taken from the
   * original string rather than re-printed from the tree, so the trace shows
   * the real input (and its real spacing) instead of a reconstruction.
   */
  expression: string;
  value: number;
}

export interface EvalSuccess {
  ok: true;
  value: number;
  /** The whole expression in reverse Polish notation. */
  rpn: string;
  /** Sub-expressions in the order the evaluator folded them. */
  steps: MathStep[];
}

export interface EvalFailure {
  ok: false;
  message: string;
  /** 0-based character offset the message points at, or `null` for the whole input. */
  position: number | null;
}

export type EvalResult = EvalSuccess | EvalFailure;

/**
 * Longest accepted input.
 *
 * A cap is not about performance (the parser is linear) but about the UI: a
 * pasted document should be refused with a clear message rather than turned
 * into a thousand-line trace. 1000 characters is far more than a calculator
 * expression ever needs.
 */
export const MAX_EXPRESSION_LENGTH = 1000;

/** Deepest accepted parenthesis nesting, so recursion stays bounded. */
export const MAX_PAREN_DEPTH = 64;

/** Largest offered fraction-digit count. */
export const MAX_FRACTION_DIGITS = 15;

/**
 * Named constants.
 *
 * `inf` is spelled rather than `Infinity` because the identifier lexer does not
 * distinguish the two anyway (lookup is case-insensitive) and `inf` keeps the
 * expression short. `π` is accepted as a convenience for pasted text.
 */
export const CONSTANTS: Readonly<Record<string, number>> = {
  pi: Math.PI,
  'π': Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  inf: Number.POSITIVE_INFINITY,
};

interface FunctionSpec {
  /** Fewest accepted arguments. */
  minArgs: number;
  /** Most accepted arguments; `Infinity` for variadic functions. */
  maxArgs: number;
  /** The first argument is an angle, converted when the mode is degrees. */
  takesAngle?: boolean;
  /** The result is an angle, converted when the mode is degrees. */
  returnsAngle?: boolean;
  apply: (args: number[]) => number;
}

/**
 * Supported functions.
 *
 * Each one delegates to the matching `Math` function, which is the authority
 * the check script compares against, so there is no second implementation of
 * `sin` or `log` to drift. `ln` and `log` are the same function on purpose:
 * this follows `Math.log` (natural logarithm) rather than the base-10 meaning
 * `log` has on some calculators, and `log10` is available under its own name.
 *
 * Hyperbolic functions are not angle-dependent, so they ignore the angle mode.
 */
const FUNCTIONS: Readonly<Record<string, FunctionSpec>> = {
  sqrt: { minArgs: 1, maxArgs: 1, apply: (a) => Math.sqrt(a[0]) },
  cbrt: { minArgs: 1, maxArgs: 1, apply: (a) => Math.cbrt(a[0]) },
  abs: { minArgs: 1, maxArgs: 1, apply: (a) => Math.abs(a[0]) },
  ln: { minArgs: 1, maxArgs: 1, apply: (a) => Math.log(a[0]) },
  log: { minArgs: 1, maxArgs: 1, apply: (a) => Math.log(a[0]) },
  log2: { minArgs: 1, maxArgs: 1, apply: (a) => Math.log2(a[0]) },
  log10: { minArgs: 1, maxArgs: 1, apply: (a) => Math.log10(a[0]) },
  exp: { minArgs: 1, maxArgs: 1, apply: (a) => Math.exp(a[0]) },
  sin: { minArgs: 1, maxArgs: 1, takesAngle: true, apply: (a) => Math.sin(a[0]) },
  cos: { minArgs: 1, maxArgs: 1, takesAngle: true, apply: (a) => Math.cos(a[0]) },
  tan: { minArgs: 1, maxArgs: 1, takesAngle: true, apply: (a) => Math.tan(a[0]) },
  asin: { minArgs: 1, maxArgs: 1, returnsAngle: true, apply: (a) => Math.asin(a[0]) },
  acos: { minArgs: 1, maxArgs: 1, returnsAngle: true, apply: (a) => Math.acos(a[0]) },
  atan: { minArgs: 1, maxArgs: 1, returnsAngle: true, apply: (a) => Math.atan(a[0]) },
  sinh: { minArgs: 1, maxArgs: 1, apply: (a) => Math.sinh(a[0]) },
  cosh: { minArgs: 1, maxArgs: 1, apply: (a) => Math.cosh(a[0]) },
  tanh: { minArgs: 1, maxArgs: 1, apply: (a) => Math.tanh(a[0]) },
  floor: { minArgs: 1, maxArgs: 1, apply: (a) => Math.floor(a[0]) },
  ceil: { minArgs: 1, maxArgs: 1, apply: (a) => Math.ceil(a[0]) },
  round: { minArgs: 1, maxArgs: 1, apply: (a) => Math.round(a[0]) },
  sign: { minArgs: 1, maxArgs: 1, apply: (a) => Math.sign(a[0]) },
  min: { minArgs: 1, maxArgs: Number.POSITIVE_INFINITY, apply: (a) => Math.min(...a) },
  max: { minArgs: 1, maxArgs: Number.POSITIVE_INFINITY, apply: (a) => Math.max(...a) },
  pow: { minArgs: 2, maxArgs: 2, apply: (a) => Math.pow(a[0], a[1]) },
  hypot: { minArgs: 1, maxArgs: Number.POSITIVE_INFINITY, apply: (a) => Math.hypot(...a) },
};

/** Function names, for the UI's reference list. */
export const FUNCTION_NAMES: readonly string[] = Object.keys(FUNCTIONS);

/** Constant names, for the UI's reference list. */
export const CONSTANT_NAMES: readonly string[] = Object.keys(CONSTANTS);

type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '^';

type Node =
  | { kind: 'number'; value: number; start: number; end: number }
  | { kind: 'constant'; name: string; value: number; start: number; end: number }
  | { kind: 'group'; inner: Node; start: number; end: number }
  | { kind: 'unary'; operand: Node; start: number; end: number }
  | { kind: 'binary'; op: BinaryOperator; left: Node; right: Node; start: number; end: number }
  | { kind: 'factorial'; operand: Node; start: number; end: number }
  | { kind: 'call'; name: string; args: Node[]; start: number; end: number };

/**
 * Error carrying the offset that caused it.
 *
 * A message such as "缺少右括号" is much more useful next to the character it
 * refers to, so the position travels with the error instead of being folded
 * into the text.
 */
class MathEvalError extends Error {
  readonly position: number | null;

  constructor(message: string, position: number | null) {
    super(message);
    this.name = 'MathEvalError';
    this.position = position;
  }
}

type TokenKind = 'number' | 'name' | 'op' | 'lparen' | 'rparen' | 'comma' | 'end';

interface Token {
  kind: TokenKind;
  /** Canonical text: operators are stored in their ASCII spelling. */
  text: string;
  /** Numeric value of a `number` token; `NaN` for every other kind. */
  value: number;
  start: number;
  end: number;
}

/** Spellings users paste from other applications. */
const OPERATOR_ALIASES: Readonly<Record<string, string>> = {
  '×': '*',
  '·': '*',
  '÷': '/',
  '−': '-',
};

const SINGLE_CHAR_OPERATORS = new Set(['+', '-', '*', '/', '%', '^', '!']);

const IDENTIFIER_START = /[\p{L}_]/u;
const IDENTIFIER_PART = /[\p{L}\p{N}_]/u;

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && IDENTIFIER_START.test(char);
}

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && IDENTIFIER_PART.test(char);
}

/**
 * Turns the source text into tokens.
 *
 * Hand-written rather than regular-expression based: a number token is a small
 * state machine of its own (digits, optional fraction, optional exponent) and a
 * regexp that gets it right is harder to read than the loop.
 */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1;
      continue;
    }

    if (isDigit(char) || (char === '.' && isDigit(source[index + 1]))) {
      const start = index;
      while (isDigit(source[index])) index += 1;
      if (source[index] === '.') {
        index += 1;
        while (isDigit(source[index])) index += 1;
      }
      if (source[index] === 'e' || source[index] === 'E') {
        // Only consume the exponent marker when real digits follow, so that
        // `2e` stays "the number 2 followed by the constant e" and is reported
        // as two values in a row rather than as a malformed number.
        let lookahead = index + 1;
        if (source[lookahead] === '+' || source[lookahead] === '-') lookahead += 1;
        if (isDigit(source[lookahead])) {
          index = lookahead;
          while (isDigit(source[index])) index += 1;
        }
      }
      const text = source.slice(start, index);
      tokens.push({ kind: 'number', text, value: Number(text), start, end: index });
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (isIdentifierPart(source[index])) index += 1;
      tokens.push({ kind: 'name', text: source.slice(start, index), value: Number.NaN, start, end: index });
      continue;
    }

    const alias = OPERATOR_ALIASES[char];
    if (alias !== undefined) {
      tokens.push({ kind: 'op', text: alias, value: Number.NaN, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    // Checked before the single-character operators so `**` is one power token
    // rather than two multiplications.
    if (char === '*' && source[index + 1] === '*') {
      tokens.push({ kind: 'op', text: '^', value: Number.NaN, start: index, end: index + 2 });
      index += 2;
      continue;
    }

    if (SINGLE_CHAR_OPERATORS.has(char)) {
      tokens.push({ kind: 'op', text: char, value: Number.NaN, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    if (char === '(') {
      tokens.push({ kind: 'lparen', text: char, value: Number.NaN, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    if (char === ')') {
      tokens.push({ kind: 'rparen', text: char, value: Number.NaN, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    if (char === ',') {
      tokens.push({ kind: 'comma', text: char, value: Number.NaN, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    throw new MathEvalError(`无法识别的字符 "${char}"`, index);
  }

  tokens.push({ kind: 'end', text: '', value: Number.NaN, start: source.length, end: source.length });
  return tokens;
}

function arityMessage(name: string, spec: FunctionSpec, count: number): string {
  let expected: string;
  if (spec.maxArgs === Number.POSITIVE_INFINITY) {
    expected = `至少 ${spec.minArgs} 个参数`;
  } else if (spec.minArgs === spec.maxArgs) {
    expected = `${spec.minArgs} 个参数`;
  } else {
    expected = `${spec.minArgs} 到 ${spec.maxArgs} 个参数`;
  }
  return `函数 ${name} 需要${expected}，实际给了 ${count} 个`;
}

/** Recursive-descent parser for the grammar in the file header. */
class Parser {
  private index = 0;
  private depth = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Node {
    const node = this.parseExpression();
    const token = this.peek();
    if (token.kind !== 'end') {
      throw new MathEvalError(`多余的符号 "${token.text}"`, token.start);
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    const token = this.tokens[this.index];
    if (token.kind !== 'end') this.index += 1;
    return token;
  }

  private unexpected(token: Token): MathEvalError {
    if (token.kind === 'end') return new MathEvalError('表达式不完整', token.start);
    if (token.kind === 'rparen') return new MathEvalError('多余的右括号 )', token.start);
    if (token.kind === 'comma') return new MathEvalError('逗号只能出现在函数参数之间', token.start);
    return new MathEvalError(`意外的符号 "${token.text}"`, token.start);
  }

  private parseExpression(): Node {
    let left = this.parseTerm();
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'op' || (token.text !== '+' && token.text !== '-')) return left;
      this.next();
      const right = this.parseTerm();
      left = { kind: 'binary', op: token.text as BinaryOperator, left, right, start: left.start, end: right.end };
    }
  }

  private parseTerm(): Node {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'op' || (token.text !== '*' && token.text !== '/' && token.text !== '%')) return left;
      this.next();
      const right = this.parseUnary();
      left = { kind: 'binary', op: token.text as BinaryOperator, left, right, start: left.start, end: right.end };
    }
  }

  private parseUnary(): Node {
    const token = this.peek();
    // Only unary minus exists: `1++2` is rejected rather than read as
    // `1 + (+2)`, because a calculator that silently accepts a doubled plus
    // hides a typo instead of reporting it.
    if (token.kind === 'op' && token.text === '-') {
      this.next();
      const operand = this.parseUnary();
      return { kind: 'unary', operand, start: token.start, end: operand.end };
    }
    return this.parsePower();
  }

  private parsePower(): Node {
    const base = this.parsePostfix();
    const token = this.peek();
    if (token.kind === 'op' && token.text === '^') {
      this.next();
      // The exponent recurses through `unary`, which gives `^` its right
      // associativity and allows a leading minus in the exponent.
      const exponent = this.parseUnary();
      return { kind: 'binary', op: '^', left: base, right: exponent, start: base.start, end: exponent.end };
    }
    return base;
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'op' || token.text !== '!') return node;
      this.next();
      node = { kind: 'factorial', operand: node, start: node.start, end: token.end };
    }
  }

  private parsePrimary(): Node {
    const token = this.next();

    if (token.kind === 'number') {
      return { kind: 'number', value: token.value, start: token.start, end: token.end };
    }

    if (token.kind === 'name') {
      return this.parseName(token);
    }

    if (token.kind === 'lparen') {
      const inner = this.nested(token, () => this.parseExpression());
      const close = this.next();
      if (close.kind !== 'rparen') throw new MathEvalError('缺少右括号 )', close.start);
      return { kind: 'group', inner, start: token.start, end: close.end };
    }

    throw this.unexpected(token);
  }

  private parseName(token: Token): Node {
    const name = token.text.toLowerCase();

    const constant = CONSTANTS[name];
    if (constant !== undefined) {
      return { kind: 'constant', name, value: constant, start: token.start, end: token.end };
    }

    const spec = FUNCTIONS[name];
    if (spec === undefined) {
      // The message distinguishes the two mistakes a user actually makes:
      // calling an unknown function versus naming a variable that does not
      // exist (this evaluator has no variables at all).
      const following = this.peek();
      if (following.kind === 'lparen') throw new MathEvalError(`未知函数 ${token.text}`, token.start);
      throw new MathEvalError(`未知变量 ${token.text}`, token.start);
    }

    const open = this.peek();
    if (open.kind !== 'lparen') {
      throw new MathEvalError(`函数 ${token.text} 后面需要一对括号，例如 ${name}(2)`, token.start);
    }
    this.next();

    const args: Node[] = [];
    let close: Token;
    if (this.peek().kind === 'rparen') {
      close = this.next();
    } else {
      args.push(
        ...this.nested(open, () => {
          const collected: Node[] = [];
          for (;;) {
            collected.push(this.parseExpression());
            const separator = this.next();
            if (separator.kind === 'comma') continue;
            if (separator.kind !== 'rparen') {
              throw new MathEvalError(
                separator.kind === 'end' ? '缺少右括号 )' : '函数参数之间只能用逗号分隔',
                separator.start,
              );
            }
            return collected;
          }
        }),
      );
      close = this.tokens[this.index - 1];
    }

    if (args.length < spec.minArgs || args.length > spec.maxArgs) {
      throw new MathEvalError(arityMessage(name, spec, args.length), token.start);
    }

    return { kind: 'call', name, args, start: token.start, end: close.end };
  }

  /** Runs `body` one parenthesis level deeper, refusing runaway nesting. */
  private nested<T>(open: Token, body: () => T): T {
    this.depth += 1;
    if (this.depth > MAX_PAREN_DEPTH) {
      throw new MathEvalError(`括号嵌套超过 ${MAX_PAREN_DEPTH} 层`, open.start);
    }
    try {
      return body();
    } finally {
      this.depth -= 1;
    }
  }
}

interface EvalContext {
  source: string;
  angleMode: AngleMode;
  steps: MathStep[];
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Applies a binary operator.
 *
 * Division follows IEEE-754 rather than throwing: `1/0` is `Infinity` and `0/0`
 * is `NaN`, which is what the `eval` oracle produces and what the rest of the
 * language does. `%` is the truncated remainder of JavaScript and C, so the
 * sign follows the dividend (`-7 % 3` is `-1`); it is not a percentage sign and
 * not the always-positive Euclidean modulo.
 */
function applyBinary(op: BinaryOperator, left: number, right: number): number {
  switch (op) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      return left / right;
    case '%':
      return left % right;
    case '^':
      return Math.pow(left, right);
  }
}

function applyFunction(name: string, args: number[], angleMode: AngleMode): number {
  const spec = FUNCTIONS[name];
  const prepared =
    spec.takesAngle && angleMode === 'deg' ? [toRadians(args[0]), ...args.slice(1)] : args;
  const result = spec.apply(prepared);
  return spec.returnsAngle && angleMode === 'deg' ? toDegrees(result) : result;
}

/**
 * Factorial.
 *
 * Only defined for non-negative integers here. Extending it to other values
 * would mean pulling in the gamma function, whose sign conventions and poles
 * are a topic of their own; a clear error is more useful than a surprising
 * value. 171! already exceeds the largest double, so the loop is capped: a
 * request such as `1e9!` returns `Infinity` immediately instead of spinning.
 */
function factorial(value: number, position: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new MathEvalError(`阶乘只对非负整数有定义，这里是 ${String(value)}`, position);
  }
  if (value > 170) return Number.POSITIVE_INFINITY;
  let result = 1;
  for (let factor = 2; factor <= value; factor += 1) result *= factor;
  return result;
}

function recordStep(context: EvalContext, node: Node, value: number): void {
  context.steps.push({ expression: context.source.slice(node.start, node.end), value });
}

function evaluateNode(node: Node, context: EvalContext): number {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'constant':
      return node.value;
    case 'group':
      // Groups are transparent: they shape the tree, they are not an
      // operation, so they never appear as a step of their own.
      return evaluateNode(node.inner, context);
    case 'unary': {
      const value = -evaluateNode(node.operand, context);
      recordStep(context, node, value);
      return value;
    }
    case 'factorial': {
      const value = factorial(evaluateNode(node.operand, context), node.start);
      recordStep(context, node, value);
      return value;
    }
    case 'binary': {
      const left = evaluateNode(node.left, context);
      const right = evaluateNode(node.right, context);
      const value = applyBinary(node.op, left, right);
      recordStep(context, node, value);
      return value;
    }
    case 'call': {
      const args = node.args.map((arg) => evaluateNode(arg, context));
      const value = applyFunction(node.name, args, context.angleMode);
      recordStep(context, node, value);
      return value;
    }
  }
}

/**
 * Post-order walk producing reverse Polish notation.
 *
 * Variadic functions carry their argument count (`hypot#2`, `min#3`). Postfix
 * notation has no other way to say where an argument list ends: in
 * `1 3 4 hypot` nothing in the string says whether `1` belongs to `hypot`, so
 * the arity has to be written down. Fixed-arity functions do not need it.
 */
function toRpn(node: Node): string[] {
  switch (node.kind) {
    case 'number':
      return [String(node.value)];
    case 'constant':
      return [node.name];
    case 'group':
      return toRpn(node.inner);
    case 'unary':
      return [...toRpn(node.operand), 'neg'];
    case 'factorial':
      return [...toRpn(node.operand), '!'];
    case 'binary':
      return [...toRpn(node.left), ...toRpn(node.right), node.op];
    case 'call': {
      const args = node.args.flatMap((arg) => toRpn(arg));
      const variadic = FUNCTIONS[node.name].maxArgs === Number.POSITIVE_INFINITY;
      return [...args, variadic ? `${node.name}#${node.args.length}` : node.name];
    }
  }
}

/**
 * Evaluates `source`.
 *
 * Returns a result object rather than throwing, because "the user is still
 * typing" is the normal state of an input field: a half-typed `1+` is not an
 * exception, it is just not a value yet. Unexpected exceptions (a bug in here)
 * are not converted into parse errors; they are rethrown so they cannot hide.
 */
export function evaluateExpression(source: string, options: EvaluateOptions = {}): EvalResult {
  const angleMode = options.angleMode ?? 'rad';

  if (source.trim() === '') {
    return { ok: false, message: '表达式为空', position: null };
  }
  if (source.length > MAX_EXPRESSION_LENGTH) {
    return {
      ok: false,
      message: `表达式过长：${source.length} 个字符，上限 ${MAX_EXPRESSION_LENGTH}`,
      position: null,
    };
  }

  try {
    const node = new Parser(tokenize(source)).parse();
    const context: EvalContext = { source, angleMode, steps: [] };
    const value = evaluateNode(node, context);
    return { ok: true, value, rpn: toRpn(node).join(' '), steps: context.steps };
  } catch (error) {
    if (error instanceof MathEvalError) {
      return { ok: false, message: error.message, position: error.position };
    }
    throw error;
  }
}

/** Inserts thousands separators into the integer part of a plain number. */
function groupThousands(text: string): string {
  // Exponential notation has no fixed integer part to group; leaving it alone
  // is better than producing "1.5e+1,000".
  if (text.includes('e') || text.includes('E')) return text;
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const dot = body.indexOf('.');
  const integer = dot === -1 ? body : body.slice(0, dot);
  const fraction = dot === -1 ? '' : body.slice(dot);
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction}`;
}

/**
 * Renders a value for display.
 *
 * With `decimals: null` the shortest decimal string that round-trips is used
 * (`String(value)`). That is deliberate: it shows `0.1 + 0.2` as
 * `0.30000000000000004` rather than hiding the binary representation behind a
 * rounded 0.3, which is the honest thing for a tool whose subject is arithmetic.
 * A fixed `decimals` uses `toFixed`, which rounds the *binary* value — so
 * `(1.005).toFixed(2)` is `1.00`, because the stored double is slightly below
 * 1.005. That is a property of the number, not a rounding bug.
 */
export function formatNumber(value: number, options: FormatOptions = {}): string {
  const decimals = options.decimals ?? null;
  const group = options.group ?? false;

  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';

  let text: string;
  if (decimals === null) {
    text = String(value);
  } else {
    const digits = Math.max(0, Math.min(MAX_FRACTION_DIGITS, Math.trunc(decimals)));
    text = Math.abs(value) >= 1e21 ? value.toExponential(digits) : value.toFixed(digits);
  }

  return group ? groupThousands(text) : text;
}

/**
 * Heuristic: does this value look like a decimal that only exists because of
 * binary floating point?
 *
 * A double's shortest round-tripping form needs at most 17 significant digits,
 * and a value the user actually meant needs far fewer. So a fraction with more
 * than 17 significant digits is the signature of `0.1 + 0.2` (18 digits) rather
 * than of `1/3` (16 digits). It is a heuristic and the UI presents it as a hint,
 * never as part of the result; the digits themselves are always shown.
 */
export function looksLikeRoundingArtifact(value: number): boolean {
  if (!Number.isFinite(value) || Number.isInteger(value)) return false;
  const text = String(Math.abs(value));
  if (text.includes('e')) return false;
  return text.replace('.', '').length > 17;
}
