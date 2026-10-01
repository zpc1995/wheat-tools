/**
 * Checks the math expression evaluator.
 *
 * The claims worth defending, and the independent reference used for each:
 *
 *   1. Precedence and associativity are right — pinned by hand-computed known
 *      values (`2^3^2` is 512, `-2^2` is -4, `10-3-2` is 5 ...). A naive
 *      left-associative or unary-first implementation is computed alongside and
 *      shown to produce *different* numbers, so these assertions are not
 *      vacuous.
 *   2. The arithmetic and every function match their definition — compared
 *      against the `Math` API itself and, for a few hundred random trees,
 *      against the result of `eval` inside `node:vm`, which is a second
 *      evaluator written by somebody else. Floating point is compared with a
 *      relative tolerance, never with equality.
 *   3. The parse is right, independently of the value — the same token streams
 *      are fed to a shunting-yard evaluator implemented here, a different
 *      algorithm from the recursive-descent parser in the tool, and to a stack
 *      machine that consumes the tool's own RPN output.
 *   4. Factorials are right — compared against exact BigInt products.
 *   5. Bad input is refused — never silently turned into NaN, and never throws.
 *   6. `eval` is genuinely dangerous for this job — demonstrated, not asserted.
 *      (Every string handed to `vm` below is a constant written in this file;
 *      no user input ever reaches it. That is what makes running eval *here*
 *      safe, and it is exactly why running it on the *user's* input is not.)
 *
 * Usage: node scripts/check-math-evaluator.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const vm = require('node:vm');

const UTILS_PATH = 'src/tools/math-evaluator/mathEvaluatorUtils.ts';
const utilsSource = readFileSync(UTILS_PATH, 'utf8');

const compiled = ts.transpileModule(utilsSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/math-evaluator.mjs', compiled);
const M = await import(pathToFileURL('.verify/math-evaluator.mjs').href);

let passed = 0;
let failed = 0;

function report(ok, label, detail) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        ${detail}`}`);
}

/** Exact comparison that also treats NaN as equal to NaN and reports -0 vs 0. */
function check(label, actual, expected) {
  const ok =
    Object.is(actual, expected) ||
    (typeof actual === 'object' && JSON.stringify(actual) === JSON.stringify(expected));
  report(
    ok,
    label,
    `got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`,
  );
}

/** Compares numbers with a relative tolerance, the only sane way with floats. */
function checkClose(label, actual, expected, tolerance = 1e-12) {
  const ok = closeEnough(actual, expected, tolerance);
  report(
    ok,
    label,
    `got      ${String(actual)}\n        expected ${String(expected)} (relative tolerance ${tolerance})`,
  );
}

function closeEnough(actual, expected, tolerance = 1e-12) {
  if (Number.isNaN(actual) && Number.isNaN(expected)) return true;
  if (Object.is(actual, expected)) return true;
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  return Math.abs(actual - expected) <= tolerance * scale;
}

/** Runs the evaluator and returns the value, or throws with the parser's message. */
function value(expression, options) {
  const result = M.evaluateExpression(expression, options);
  if (!result.ok) throw new Error(`expected ${expression} to evaluate, got: ${result.message}`);
  return result.value;
}

/** Asserts that the input is refused, and reports what came back if it is not. */
function checkRejected(label, expression, options) {
  let result;
  try {
    result = M.evaluateExpression(expression, options);
  } catch (error) {
    report(false, label, `评估器抛出了异常：${error && error.message}`);
    return;
  }
  const ok = result.ok === false && typeof result.message === 'string' && result.message.length > 0;
  report(
    ok,
    label,
    result.ok
      ? `被接受了，求值结果为 ${String(result.value)}（非法输入必须报错而不是返回 NaN）`
      : '错误信息为空',
  );
  return result;
}

// ---------------------------------------------------------------------------
// Independent references used below.
// ---------------------------------------------------------------------------

/** The Math API, one entry per supported function: the authoritative definition. */
const REF_FUNCTIONS = {
  sqrt: { min: 1, max: 1, fn: (a) => Math.sqrt(a[0]) },
  cbrt: { min: 1, max: 1, fn: (a) => Math.cbrt(a[0]) },
  abs: { min: 1, max: 1, fn: (a) => Math.abs(a[0]) },
  ln: { min: 1, max: 1, fn: (a) => Math.log(a[0]) },
  log: { min: 1, max: 1, fn: (a) => Math.log(a[0]) },
  log2: { min: 1, max: 1, fn: (a) => Math.log2(a[0]) },
  log10: { min: 1, max: 1, fn: (a) => Math.log10(a[0]) },
  exp: { min: 1, max: 1, fn: (a) => Math.exp(a[0]) },
  sin: { min: 1, max: 1, angle: 'arg', fn: (a) => Math.sin(a[0]) },
  cos: { min: 1, max: 1, angle: 'arg', fn: (a) => Math.cos(a[0]) },
  tan: { min: 1, max: 1, angle: 'arg', fn: (a) => Math.tan(a[0]) },
  asin: { min: 1, max: 1, angle: 'result', fn: (a) => Math.asin(a[0]) },
  acos: { min: 1, max: 1, angle: 'result', fn: (a) => Math.acos(a[0]) },
  atan: { min: 1, max: 1, angle: 'result', fn: (a) => Math.atan(a[0]) },
  sinh: { min: 1, max: 1, fn: (a) => Math.sinh(a[0]) },
  cosh: { min: 1, max: 1, fn: (a) => Math.cosh(a[0]) },
  tanh: { min: 1, max: 1, fn: (a) => Math.tanh(a[0]) },
  floor: { min: 1, max: 1, fn: (a) => Math.floor(a[0]) },
  ceil: { min: 1, max: 1, fn: (a) => Math.ceil(a[0]) },
  round: { min: 1, max: 1, fn: (a) => Math.round(a[0]) },
  sign: { min: 1, max: 1, fn: (a) => Math.sign(a[0]) },
  min: { min: 1, max: Infinity, fn: (a) => Math.min(...a) },
  max: { min: 1, max: Infinity, fn: (a) => Math.max(...a) },
  pow: { min: 2, max: 2, fn: (a) => Math.pow(a[0], a[1]) },
  hypot: { min: 1, max: Infinity, fn: (a) => Math.hypot(...a) },
};

const REF_CONSTANTS = { pi: Math.PI, 'π': Math.PI, e: Math.E, tau: Math.PI * 2, inf: Infinity };

/** JS spellings for the same functions, for the `eval` oracle. */
const JS_FUNCTIONS = {
  sqrt: 'Math.sqrt',
  cbrt: 'Math.cbrt',
  abs: 'Math.abs',
  ln: 'Math.log',
  log: 'Math.log',
  log2: 'Math.log2',
  log10: 'Math.log10',
  exp: 'Math.exp',
  sin: 'Math.sin',
  cos: 'Math.cos',
  tan: 'Math.tan',
  asin: 'Math.asin',
  acos: 'Math.acos',
  atan: 'Math.atan',
  sinh: 'Math.sinh',
  cosh: 'Math.cosh',
  tanh: 'Math.tanh',
  floor: 'Math.floor',
  ceil: 'Math.ceil',
  round: 'Math.round',
  sign: 'Math.sign',
  min: 'Math.min',
  max: 'Math.max',
  pow: 'Math.pow',
  hypot: 'Math.hypot',
};

const JS_CONSTANTS = { pi: 'Math.PI', 'π': 'Math.PI', e: 'Math.E', tau: '(2 * Math.PI)', inf: 'Infinity' };

function refApply(name, args, angleMode = 'rad') {
  const spec = REF_FUNCTIONS[name];
  const prepared =
    spec.angle === 'arg' && angleMode === 'deg' ? [(args[0] * Math.PI) / 180, ...args.slice(1)] : args;
  const result = spec.fn(prepared);
  return spec.angle === 'result' && angleMode === 'deg' ? (result * 180) / Math.PI : result;
}

function refBinary(operator, a, b) {
  if (operator === '+') return a + b;
  if (operator === '-') return a - b;
  if (operator === '*') return a * b;
  if (operator === '/') return a / b;
  if (operator === '%') return a % b;
  if (operator === '^') return Math.pow(a, b);
  throw new Error(`unknown operator ${operator}`);
}

function refFactorial(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`reference factorial of ${String(n)}`);
  if (n > 170) return Infinity;
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

// ---------------------------------------------------------------------------
// A second parser: shunting-yard, a different algorithm from the tool's
// recursive descent. Both must agree on the same token stream, which is what
// makes precedence and associativity evidence rather than a restatement.
// ---------------------------------------------------------------------------

const FLAT_TOKEN_RE = /\s*(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|[A-Za-z_\u03c0][A-Za-z0-9_]*|\*\*|[+\-*/%^!(),])/y;
const BINARY_PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 4 };
const UNARY_PRECEDENCE = 3;

function refTokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    FLAT_TOKEN_RE.lastIndex = index;
    const match = FLAT_TOKEN_RE.exec(source);
    if (!match) {
      if (source.slice(index).trim() === '') break;
      throw new Error(`reference tokenizer stuck at ${JSON.stringify(source.slice(index))}`);
    }
    index = FLAT_TOKEN_RE.lastIndex;
    tokens.push(match[1] === '**' ? '^' : match[1]);
  }
  return tokens;
}

function refEvaluateFlat(source, angleMode = 'rad') {
  const tokens = refTokenize(source);
  const output = [];
  const operators = [];
  const argumentCounts = [];
  let previous = null;

  const popOperator = () => {
    const operator = operators.pop();
    if (operator === undefined || operator === '(') throw new Error('unbalanced parentheses');
    output.push(operator);
  };

  for (const token of tokens) {
    if (/^[\d.]/.test(token)) {
      output.push(token);
      previous = token;
      continue;
    }
    if (/^[A-Za-z_\u03c0]/.test(token)) {
      if (REF_FUNCTIONS[token]) operators.push(token);
      else if (REF_CONSTANTS[token] !== undefined) output.push(token);
      else throw new Error(`unknown name ${token}`);
      previous = token;
      continue;
    }
    if (token === '(') {
      operators.push('(');
      argumentCounts.push(1);
      previous = token;
      continue;
    }
    if (token === ',') {
      while (operators.length && operators[operators.length - 1] !== '(') popOperator();
      argumentCounts[argumentCounts.length - 1] += 1;
      previous = token;
      continue;
    }
    if (token === ')') {
      while (operators.length && operators[operators.length - 1] !== '(') popOperator();
      if (!operators.length) throw new Error('unbalanced )');
      operators.pop();
      const count = argumentCounts.pop();
      const top = operators[operators.length - 1];
      if (top !== undefined && REF_FUNCTIONS[top]) {
        operators.pop();
        output.push(`${top}#${count}`);
      }
      previous = token;
      continue;
    }
    if (token === '!') {
      output.push('!');
      previous = token;
      continue;
    }
    // A minus is a prefix operator when nothing can be its left operand. A
    // postfix `!` completes a value, so a minus after it is binary.
    const prefix =
      token === '-' &&
      (previous === null || ['+', '-', '*', '/', '%', '^', '('].includes(previous));
    if (prefix) {
      // A prefix operator's operand starts immediately after it, so nothing on
      // the stack may be reduced yet. This one rule is what makes `2^-1` and
      // `-2^2` come out right at the same time.
      operators.push('neg');
      previous = token;
      continue;
    }
    const precedence = BINARY_PRECEDENCE[token];
    if (precedence === undefined) throw new Error(`unexpected token ${token}`);
    while (operators.length) {
      const top = operators[operators.length - 1];
      if (top === '(') break;
      const topPrecedence = top === 'neg' ? UNARY_PRECEDENCE : BINARY_PRECEDENCE[top];
      if (topPrecedence > precedence || (topPrecedence === precedence && token !== '^')) popOperator();
      else break;
    }
    operators.push(token);
    previous = token;
  }
  while (operators.length) popOperator();

  const stack = [];
  for (const token of output) {
    if (token === 'neg') {
      stack.push(-stack.pop());
      continue;
    }
    if (token === '!') {
      stack.push(refFactorial(stack.pop()));
      continue;
    }
    if (BINARY_PRECEDENCE[token] !== undefined) {
      const b = stack.pop();
      const a = stack.pop();
      stack.push(refBinary(token, a, b));
      continue;
    }
    const call = /^([A-Za-z_\u03c0]+)#(\d+)$/.exec(token);
    if (call) {
      const count = Number(call[2]);
      const args = [];
      for (let i = 0; i < count; i += 1) args.unshift(stack.pop());
      stack.push(refApply(call[1], args, angleMode));
      continue;
    }
    if (REF_CONSTANTS[token] !== undefined) {
      stack.push(REF_CONSTANTS[token]);
      continue;
    }
    stack.push(Number(token));
  }
  if (stack.length !== 1) throw new Error(`reference stack has ${stack.length} values`);
  return stack[0];
}

/** Evaluates the tool's own RPN string with a stack machine written here. */
function evaluateRpn(rpn, angleMode = 'rad') {
  const stack = [];
  for (const token of rpn.split(' ')) {
    if (token === 'neg') {
      stack.push(-stack.pop());
      continue;
    }
    if (token === '!') {
      stack.push(refFactorial(stack.pop()));
      continue;
    }
    if (BINARY_PRECEDENCE[token] !== undefined) {
      const b = stack.pop();
      const a = stack.pop();
      stack.push(refBinary(token, a, b));
      continue;
    }
    if (REF_CONSTANTS[token] !== undefined) {
      stack.push(REF_CONSTANTS[token]);
      continue;
    }
    const call = /^([A-Za-z_\u03c0]+)(?:#(\d+))?$/.exec(token);
    if (call && REF_FUNCTIONS[call[1]]) {
      const name = call[1];
      const spec = REF_FUNCTIONS[name];
      // Fixed arity is known to the reader; a variadic function must say how
      // many arguments it takes, or the RPN would be ambiguous.
      const count =
        call[2] !== undefined
          ? Number(call[2])
          : spec.min === spec.max
            ? spec.min
            : -1;
      if (count < 0) throw new Error(`variadic ${name} without an arity marker: ${rpn}`);
      const args = [];
      for (let i = 0; i < count; i += 1) args.unshift(stack.pop());
      stack.push(refApply(name, args, angleMode));
      continue;
    }
    stack.push(Number(token));
  }
  if (stack.length !== 1) throw new Error(`RPN stack has ${stack.length} values: ${rpn}`);
  return stack[0];
}

// Deterministic pseudo-random source, so a failure is reproducible.
let seed = 0x2f6e2b1;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
function randomInt(min, max) {
  return min + Math.floor(rand() * (max - min + 1));
}
function pick(list) {
  return list[Math.floor(rand() * list.length)];
}

// ---------------------------------------------------------------------------
console.log('--- 优先级与结合性（已知值） ---');
// ---------------------------------------------------------------------------
{
  const known = [
    ['2+3*4', 14],
    ['(2+3)*4', 20],
    ['2^3^2', 512],
    ['2**3**2', 512],
    ['-2^2', -4],
    ['2^-1', 0.5],
    ['10-3-2', 5],
    ['8/4/2', 1],
    ['-2^2^2', -16],
    ['2^3!', 64],
    ['3!^2', 36],
    ['-3!', -6],
    ['--3', 3],
    ['1-2-3-4', -8],
    ['100/10/5', 2],
    ['2*3^2', 18],
    ['2^2*3', 12],
    ['1+2*3^2-4', 15],
    ['2^-1^2', 0.5],
    ['-2^-2', -0.25],
    ['10%3', 1],
    ['-7%3', -1],
    ['7%-3', 1],
    ['2×(3+4)', 14],
    ['8÷2', 4],
  ];
  for (const [expression, expected] of known) {
    check(`${expression} = ${expected}`, value(expression), expected);
  }
}

console.log('--- 反证：朴素写法会得到别的数字（说明上面的断言有鉴别力） ---');
{
  // Left-associative power instead of right-associative.
  const leftAssocPower = Math.pow(Math.pow(2, 3), 2);
  check('左结合解释 2^3^2 会得到 64，而不是 512', leftAssocPower, 64);
  check('正确值是 512', value('2^3^2'), 512);

  // Unary minus binding tighter than the power.
  const unaryFirst = Math.pow(-2, 2);
  check('一元负号先算会得到 4，而不是 -4', unaryFirst, 4);
  check('正确值是 -4', value('-2^2'), -4);

  // Right-associative subtraction and division.
  check('右结合解释 10-3-2 会得到 9，而不是 5', 10 - (3 - 2), 9);
  check('右结合解释 8/4/2 会得到 4，而不是 1', 8 / (4 / 2), 4);

  // Factorial binding looser than the power.
  check('先做幂再做阶乘会得到 40320，而不是 64', refFactorial(Math.pow(2, 3)), 40320);
  check('正确值是 64', value('2^3!'), 64);
}

console.log('--- 与 Math API 逐函数比对（浮点用相对误差） ---');
{
  const cases = [
    // [expression, expected from the Math API, tolerance]
    ['sqrt(2)', Math.sqrt(2)],
    ['sqrt(0)', Math.sqrt(0)],
    ['sqrt(-4)', Math.sqrt(-4)],
    ['cbrt(27)', Math.cbrt(27)],
    ['cbrt(-8)', Math.cbrt(-8)],
    ['abs(-3.5)', Math.abs(-3.5)],
    ['abs(3.5)', Math.abs(3.5)],
    ['ln(5)', Math.log(5)],
    ['log(5)', Math.log(5)],
    ['ln(1)', Math.log(1)],
    ['ln(0)', Math.log(0)],
    ['ln(-1)', Math.log(-1)],
    ['log2(1024)', Math.log2(1024)],
    ['log10(1234)', Math.log10(1234)],
    ['exp(1)', Math.exp(1)],
    ['exp(0)', Math.exp(0)],
    ['exp(1000)', Math.exp(1000)],
    ['sin(1)', Math.sin(1)],
    ['cos(1)', Math.cos(1)],
    ['tan(1)', Math.tan(1)],
    ['asin(0.5)', Math.asin(0.5)],
    ['asin(2)', Math.asin(2)],
    ['acos(0.5)', Math.acos(0.5)],
    ['atan(1)', Math.atan(1)],
    ['sinh(2)', Math.sinh(2)],
    ['cosh(-2)', Math.cosh(-2)],
    ['tanh(0.5)', Math.tanh(0.5)],
    ['floor(-1.2)', Math.floor(-1.2)],
    ['ceil(-1.2)', Math.ceil(-1.2)],
    ['round(-1.5)', Math.round(-1.5)],
    ['round(2.5)', Math.round(2.5)],
    ['sign(-3)', Math.sign(-3)],
    ['sign(0)', Math.sign(0)],
    ['min(3,1,2)', Math.min(3, 1, 2)],
    ['max(3,1,2)', Math.max(3, 1, 2)],
    ['min(-1)', Math.min(-1)],
    ['max(hypot(3,4),5)', Math.max(Math.hypot(3, 4), 5)],
    ['pow(2,10)', Math.pow(2, 10)],
    ['pow(2,0.5)', Math.pow(2, 0.5)],
    ['pow(-8,1/3)', Math.pow(-8, 1 / 3)],
    ['hypot(3,4)', Math.hypot(3, 4)],
    ['hypot(1,2,3,4)', Math.hypot(1, 2, 3, 4)],
    ['pi', Math.PI],
    ['e', Math.E],
    ['tau', Math.PI * 2],
    ['tau/2', Math.PI],
    ['2*tau', 4 * Math.PI],
    ['inf', Infinity],
    ['-inf', -Infinity],
    ['π', Math.PI],
    ['SIN(1)', Math.sin(1)],
    ['1e3', 1000],
    ['1.5e-3', 0.0015],
    ['.5', 0.5],
    ['5.', 5],
    ['3', 3],
  ];
  for (const [expression, expected, tolerance] of cases) {
    checkClose(`${expression} 与 Math 一致`, value(expression), expected, tolerance ?? 1e-15);
  }

  // Every name in the reference table must exist in the tool, and vice versa:
  // a function that is advertised but missing (or silently dropped) is a bug
  // the value comparisons above would only catch if a case covered it.
  check(
    '函数清单与参考表逐项一致',
    [...M.FUNCTION_NAMES].sort(),
    Object.keys(REF_FUNCTIONS).sort(),
  );
  check('常量清单与参考表逐项一致', [...M.CONSTANT_NAMES].sort(), Object.keys(REF_CONSTANTS).sort());
}

console.log('--- 阶乘（对照 BigInt 精确值） ---');
{
  const exact = (n) => {
    let product = 1n;
    for (let i = 2n; i <= BigInt(n); i += 1n) product *= i;
    return product;
  };
  for (const n of [0, 1, 2, 3, 5, 10, 20, 50, 100, 170]) {
    const expected = Number(exact(n));
    checkClose(`${n}! 与 BigInt 精确阶乘一致`, value(`${n}!`), expected, 1e-15);
  }
  check('170! 仍然有限', Number.isFinite(value('170!')), true);
  check('171! 溢出为 Infinity', value('171!'), Infinity);
  check('1e9! 立即返回 Infinity（不会真的循环十亿次）', value('1e9!'), Infinity);
  check('3!! 是 (3!)!', value('3!!'), 720);
  check('(2+3)! 是 120', value('(2+3)!'), 120);
  check('5 的阶乘在步骤里可见', M.evaluateExpression('5!').steps.at(-1).value, 120);

  // A loop capped at 171 is the only reason the previous assertions terminate;
  // timing it makes a regression into an infinite loop visible instead of
  // turning the suite into a hang.
  const started = Date.now();
  value('999999999!');
  check('超大阶乘在 100ms 内返回', Date.now() - started < 100, true);

  checkRejected('(-1)! 被拒绝', '(-1)!');
  checkRejected('1.5! 被拒绝', '1.5!');
  checkRejected('pi! 被拒绝', 'pi!');
}

console.log('--- 与 node:vm 里的 eval 交叉验证（第二套求值器） ---');
{
  const context = vm.createContext({});

  const BINARY = ['+', '-', '*', '/', '%'];

  const randomNumber = () => {
    const roll = rand();
    if (roll < 0.4) return String(randomInt(-20, 20));
    if (roll < 0.75) return (rand() * 200 - 100).toFixed(randomInt(1, 6));
    return `${(rand() * 10).toFixed(4)}e${randomInt(-8, 8)}`;
  };

  const randomTree = (depth) => {
    if (depth <= 0 || rand() < 0.3) {
      return rand() < 0.3
        ? { kind: 'constant', name: pick(['pi', 'e', 'tau']) }
        : { kind: 'number', text: randomNumber() };
    }
    const roll = rand();
    if (roll < 0.55) {
      return { kind: 'binary', op: pick(BINARY), left: randomTree(depth - 1), right: randomTree(depth - 1) };
    }
    if (roll < 0.7) return { kind: 'unary', operand: randomTree(depth - 1) };
    if (roll < 0.9) {
      return { kind: 'call', name: pick(Object.keys(REF_FUNCTIONS).filter((n) => REF_FUNCTIONS[n].max === 1)), args: [randomTree(depth - 1)] };
    }
    if (rand() < 0.5) {
      return { kind: 'call', name: 'pow', args: [randomTree(depth - 1), randomTree(depth - 1)] };
    }
    const arity = randomInt(1, 3);
    const args = [];
    for (let i = 0; i < arity; i += 1) args.push(randomTree(depth - 1));
    return { kind: 'call', name: pick(['min', 'max', 'hypot']), args };
  };

  // Fully parenthesised in both syntaxes: the comparison is about arithmetic
  // and functions, while precedence gets its own evidence above. Translation
  // can therefore not smuggle in an assumption about precedence.
  const renderMine = (node) => {
    if (node.kind === 'number') return node.text;
    if (node.kind === 'constant') return node.name;
    if (node.kind === 'unary') return `(-${renderMine(node.operand)})`;
    if (node.kind === 'binary') return `(${renderMine(node.left)} ${node.op} ${renderMine(node.right)})`;
    return `${node.name}(${node.args.map(renderMine).join(', ')})`;
  };

  const renderJs = (node) => {
    if (node.kind === 'number') return node.text;
    if (node.kind === 'constant') return JS_CONSTANTS[node.name];
    if (node.kind === 'unary') return `(-(${renderJs(node.operand)}))`;
    if (node.kind === 'binary') return `(${renderJs(node.left)} ${node.op} ${renderJs(node.right)})`;
    return `${JS_FUNCTIONS[node.name]}(${node.args.map(renderJs).join(', ')})`;
  };

  let compared = 0;
  let finite = 0;
  let agreements = 0;
  const disagreements = [];

  for (let round = 0; round < 400; round += 1) {
    const tree = randomTree(randomInt(1, 4));
    const mineSource = renderMine(tree);
    const jsSource = renderJs(tree);

    let mine;
    try {
      mine = value(mineSource);
    } catch (error) {
      disagreements.push(`${mineSource} -> 本工具拒绝：${error.message}`);
      continue;
    }
    const oracle = vm.runInContext(jsSource, context);

    compared += 1;
    if (Number.isFinite(mine)) finite += 1;
    if (closeEnough(mine, oracle, 1e-12)) agreements += 1;
    else if (disagreements.length < 5) disagreements.push(`${mineSource}: 本工具 ${mine} vs eval ${oracle}`);
  }

  check(
    `400 个随机表达式中 ${compared} 个可解析，全部与 eval 一致`,
    agreements,
    compared,
  );
  check('其中确实有大量有限值（比对不是靠 NaN 混过去）', finite > 200, true);
  check('没有被拒绝的表达式', disagreements.length, 0);
  if (disagreements.length > 0) console.log(disagreements.map((line) => `        ${line}`).join('\n'));
  check('eval 参照物确实跑过', compared > 350, true);
}

console.log('--- 与独立的调度场（shunting-yard）参考实现比对 ---');
{
  const FLAT_OPERATORS = ['+', '-', '*', '/', '%', '^', '**'];

  const randomFlat = () => {
    const parts = [];
    const operands = randomInt(2, 6);
    for (let i = 0; i < operands; i += 1) {
      if (i > 0) parts.push(pick(FLAT_OPERATORS));
      else if (rand() < 0.25) parts.push('-');
      // Group operands use only + and * so a factorial applied to one stays a
      // factorial of a non-negative integer, which is the only domain both
      // implementations claim to support.
      let operand =
        rand() < 0.8
          ? String(randomInt(1, 12))
          : `(${randomInt(1, 9)} ${pick(['+', '*'])} ${randomInt(1, 9)})`;
      const negative = rand() < 0.12;
      if (negative) operand = `-${operand}`;
      parts.push(operand);
      if (!negative && rand() < 0.12) parts.push('!');
    }
    return parts.join(' ');
  };

  let compared = 0;
  let skipped = 0;
  let agreements = 0;
  let finite = 0;
  const disagreements = [];

  for (let round = 0; round < 400; round += 1) {
    const source = randomFlat();
    let mine;
    let mineError = null;
    let reference;
    let referenceError = null;
    try {
      mine = value(source);
    } catch (error) {
      mineError = error;
    }
    try {
      reference = refEvaluateFlat(source, 'rad');
    } catch (error) {
      referenceError = error;
    }

    // A domain error (a factorial of a negative number, say) is refused by
    // both, and that agreement is not a value comparison.
    if (mineError && referenceError) {
      skipped += 1;
      continue;
    }
    if (mineError || referenceError) {
      disagreements.push(
        `${source}: 本工具 ${mineError ? `拒绝（${mineError.message}）` : mine} vs 调度场 ` +
          `${referenceError ? `拒绝（${referenceError.message}）` : reference}`,
      );
      continue;
    }

    compared += 1;
    if (Number.isFinite(mine)) finite += 1;
    if (closeEnough(mine, reference, 1e-12)) agreements += 1;
    else if (disagreements.length < 5) {
      disagreements.push(`${source}: 本工具 ${mine} vs 调度场 ${reference}`);
    }
  }

  check(`400 个无括号/部分括号表达式中 ${compared} 个双方都接受，结果一致`, agreements, compared);
  check('其中确实有大量有限值', finite > 200, true);
  check('两种算法没有分歧', disagreements.length, 0);
  check('双方一致拒绝的表达式也被统计（不是静默跳过全部）', skipped < 60, true);
  if (disagreements.length > 0) console.log(disagreements.map((line) => `        ${line}`).join('\n'));
  check('随机样本确实产生了足够多的表达式', compared > 300, true);

  // The reference must be able to disagree: check it against the same known
  // values, so agreement above is not two implementations of the same mistake.
  check('参考实现独立复现 -2^2 = -4', refEvaluateFlat('-2^2'), -4);
  check('参考实现独立复现 2^3^2 = 512', refEvaluateFlat('2^3^2'), 512);
  check('参考实现独立复现 2^-1 = 0.5', refEvaluateFlat('2^-1'), 0.5);
  check('参考实现独立复现 -7%3 = -1', refEvaluateFlat('-7%3'), -1);
}

console.log('--- RPN 往返（用独立栈机器执行本工具输出的 RPN） ---');
{
  const knownRpn = [
    ['2+3*4', '2 3 4 * +'],
    ['(2+3)*4', '2 3 + 4 *'],
    ['-2^2', '2 2 ^ neg'],
    ['2^3^2', '2 3 2 ^ ^'],
    ['10-3-2', '10 3 - 2 -'],
    ['8/4/2', '8 4 / 2 /'],
    ['2^-1', '2 1 neg ^'],
    ['5!', '5 !'],
    ['sqrt(2)', '2 sqrt'],
    ['hypot(3,4)', '3 4 hypot#2'],
    ['min(3,1,2)', '3 1 2 min#3'],
    ['-7%3', '7 neg 3 %'],
  ];
  for (const [expression, expected] of knownRpn) {
    check(`${expression} 的 RPN 是 ${expected}`, M.evaluateExpression(expression).rpn, expected);
  }

  const samples = [
    '2+3*4',
    '(2+3)*4',
    '2^3^2',
    '-2^2',
    '2^-1',
    '2^3!',
    '(1+2)!',
    'min(3,1,2)+hypot(3,4)',
    'sqrt(2)*sin(1)-ln(5)/e',
    'tau/2+pi',
    '1+2*3^2-4/8',
    '(((1+2)))*3!',
  ];
  let mismatches = 0;
  for (const expression of samples) {
    const result = M.evaluateExpression(expression);
    if (!closeEnough(evaluateRpn(result.rpn), result.value, 1e-15)) {
      mismatches += 1;
      console.log(`        ${expression}: value ${result.value} vs RPN ${result.rpn}`);
    }
  }
  check(`RPN 用独立栈机器执行后与直接求值一致（${samples.length} 个）`, mismatches, 0);

  // The same must hold for the random flat expressions: the RPN is a faithful
  // encoding of the tree, not just a plausible-looking string.
  let rpnMismatches = 0;
  let rpnChecked = 0;
  for (let round = 0; round < 200; round += 1) {
    const parts = [];
    const operands = randomInt(2, 5);
    for (let i = 0; i < operands; i += 1) {
      if (i > 0) parts.push(pick(['+', '-', '*', '/', '%', '^', '**']));
      parts.push(String(randomInt(1, 9)));
    }
    const source = parts.join(' ');
    const result = M.evaluateExpression(source);
    if (!result.ok) continue;
    rpnChecked += 1;
    if (!closeEnough(evaluateRpn(result.rpn), result.value, 1e-15)) rpnMismatches += 1;
  }
  check(`200 个随机表达式的 RPN 全部可还原（检查了 ${rpnChecked} 个）`, rpnMismatches, 0);
  check('RPN 往返样本足够多', rpnChecked > 190, true);
}

console.log('--- 计算过程（步骤顺序体先算谁） ---');
{
  const unaryTrap = M.evaluateExpression('-2^2');
  check('步骤先折叠 2^2', unaryTrap.steps[0], { expression: '2^2', value: 4 });
  check('再折叠一元负号，结果是 -4', unaryTrap.steps.at(-1), { expression: '-2^2', value: -4 });

  const precedence = M.evaluateExpression('2+3*4');
  check('乘除先于加减：第一步是 3*4', precedence.steps[0], { expression: '3*4', value: 12 });
  check('第二步才是加法', precedence.steps.at(-1), { expression: '2+3*4', value: 14 });

  const grouped = M.evaluateExpression('(2+3)*4');
  check('括号里的先算', grouped.steps[0], { expression: '2+3', value: 5 });
  check('括号作为一个整体参与后续运算', grouped.steps.at(-1).expression, '(2+3)*4');

  const powerRight = M.evaluateExpression('2^3^2');
  check('右结合：先算 3^2', powerRight.steps[0], { expression: '3^2', value: 9 });
  check('再算 2^9', powerRight.steps.at(-1).value, 512);

  const functionStep = M.evaluateExpression('sqrt(9)+1');
  check('先算函数', functionStep.steps[0], { expression: 'sqrt(9)', value: 3 });
  check('再算外层加法', functionStep.steps.at(-1).value, 4);

  check('单个数字没有可展示的步骤', M.evaluateExpression('42').steps, []);
  check('空白不影响步骤文本', M.evaluateExpression('  2 + 3  ').steps[0].expression, '2 + 3');
}

console.log('--- 特殊值（浮点误差、溢出、NaN） ---');
{
  check('0.1+0.2 与 double 的真实结果一致', value('0.1+0.2'), 0.1 + 0.2);
  check('0.1+0.2 不等于 0.3（这正是要展示的浮点误差）', value('0.1+0.2') === 0.3, false);
  check('0.1+0.2 被识别为浮点表示误差', M.looksLikeRoundingArtifact(0.1 + 0.2), true);
  check('1/3 不算作误差（16 位有效数字）', M.looksLikeRoundingArtifact(1 / 3), false);
  check('0.5 不算作误差', M.looksLikeRoundingArtifact(0.5), false);
  check('整数不算作误差', M.looksLikeRoundingArtifact(123456), false);
  check('Infinity 不算作误差', M.looksLikeRoundingArtifact(Infinity), false);
  check('NaN 不算作误差', M.looksLikeRoundingArtifact(NaN), false);

  check('1/0 = Infinity', value('1/0'), Infinity);
  check('-1/0 = -Infinity', value('-1/0'), -Infinity);
  check('0/0 = NaN', Number.isNaN(value('0/0')), true);
  check('5%0 = NaN', Number.isNaN(value('5%0')), true);
  check('Infinity 参与运算仍然是 Infinity', value('1/0+1'), Infinity);
  check('Infinity-Infinity = NaN', Number.isNaN(value('1/0-1/0')), true);

  check('溢出为上溢：1e308*10', value('1e308*10'), Infinity);
  check('下溢为 0：1e-400', value('1e-400'), 0);
  check('exp(1000) 上溢', value('exp(1000)'), Infinity);
  check('极大值减极大值', Number.isNaN(value('1e308*10 - 1e308*10')), true);
  check('1e308+1e308 = Infinity', value('1e308+1e308'), Infinity);
  check('最小的次正规数仍是有限值', Number.isFinite(value('5e-324')), true);
  check('5e-324/2 下溢为 0', value('5e-324/2'), 0);
}

console.log('--- 角度与弧度 ---');
{
  checkClose('弧度模式下 sin(pi/2) = 1', value('sin(pi/2)'), Math.sin(Math.PI / 2), 1e-15);
  checkClose('角度模式下 sin(30) = 0.5', value('sin(30)', { angleMode: 'deg' }), 0.5, 1e-15);
  checkClose('角度模式下 cos(60) = 0.5', value('cos(60)', { angleMode: 'deg' }), 0.5, 1e-15);
  checkClose('角度模式下 tan(45) = 1', value('tan(45)', { angleMode: 'deg' }), 1, 1e-15);
  checkClose('角度模式下 asin(0.5) = 30', value('asin(0.5)', { angleMode: 'deg' }), 30, 1e-12);
  checkClose('角度模式下 acos(0.5) = 60', value('acos(0.5)', { angleMode: 'deg' }), 60, 1e-12);
  checkClose('角度模式下 atan(1) = 45', value('atan(1)', { angleMode: 'deg' }), 45, 1e-12);

  // Reference computed independently from the angle conversion.
  checkClose(
    '角度模式等于自己乘 pi/180 再调 Math.sin',
    value('sin(37)', { angleMode: 'deg' }),
    Math.sin((37 * Math.PI) / 180),
    1e-15,
  );

  // The mode must actually change something, and must not leak into constants.
  check('角度模式下 sin(pi) 不再是 0（pi 仍是弧度值）', Math.abs(value('sin(pi)', { angleMode: 'deg' })) > 0.05, true);
  check('弧度模式下 sin(pi) 是 1.22e-16 级别的浮点零', Math.abs(value('sin(pi)')) < 1e-15, true);
  check(
    '双曲函数不受角度模式影响',
    value('sinh(1)', { angleMode: 'deg' }) === value('sinh(1)', { angleMode: 'rad' }),
    true,
  );
  check(
    '默认是弧度模式',
    value('sin(1)'),
    value('sin(1)', { angleMode: 'rad' }),
  );
}

console.log('--- 结果格式化 ---');
{
  check('自动模式保留最短往返表示', M.formatNumber(0.1 + 0.2), '0.30000000000000004');
  check('自动模式整数不带小数点', M.formatNumber(100), '100');
  check('自动模式不隐藏浮点误差', M.formatNumber(1 / 3), '0.3333333333333333');
  check('固定 2 位小数', M.formatNumber(0.1 + 0.2, { decimals: 2 }), '0.30');
  check('固定 10 位小数（pi）', M.formatNumber(Math.PI, { decimals: 10 }), '3.1415926536');
  check('固定 0 位小数', M.formatNumber(2.5, { decimals: 0 }), '3');
  check('固定小数会补零', M.formatNumber(1, { decimals: 3 }), '1.000');
  check('负数固定小数', M.formatNumber(-1.005, { decimals: 2 }), '-1.00');
  check('超出 15 位会被截到 15 位', M.formatNumber(1, { decimals: 99 }), '1.000000000000000');
  check('toFixed 作用于二进制值，1.005 就是 1.00', (1.005).toFixed(2), '1.00');

  check('NaN 显示为 NaN', M.formatNumber(NaN), 'NaN');
  check('Infinity 显示为 Infinity', M.formatNumber(Infinity), 'Infinity');
  check('-Infinity 显示为 -Infinity', M.formatNumber(-Infinity), '-Infinity');
  check('NaN 加千分位仍是 NaN', M.formatNumber(NaN, { group: true }), 'NaN');

  check('千分位（整数）', M.formatNumber(1234567, { group: true }), '1,234,567');
  check('千分位（负数）', M.formatNumber(-9876543, { group: true }), '-9,876,543');
  check('千分位（小数部分不动）', M.formatNumber(1234567.891, { decimals: 2, group: true }), '1,234,567.89');
  check('千分位（三位以下不加）', M.formatNumber(999, { group: true }), '999');
  check('千分位（恰好四位）', M.formatNumber(1000, { group: true }), '1,000');
  check('零', M.formatNumber(0, { group: true }), '0');
  check('指数表示不强行加逗号', M.formatNumber(1e21, { group: true }), '1e+21');
  check('关闭千分位', M.formatNumber(1234567, { group: false }), '1234567');

  // Independent reference: Intl does the grouping, on integers only (no
  // rounding involved, so the two agree by definition rather than by luck).
  const intl = new Intl.NumberFormat('en-US', { useGrouping: true, maximumFractionDigits: 0 });
  let groupingMismatches = 0;
  for (let i = 0; i < 500; i += 1) {
    const valueToFormat = randomInt(-1e9, 1e9);
    if (M.formatNumber(valueToFormat, { group: true }) !== intl.format(valueToFormat)) {
      groupingMismatches += 1;
    }
  }
  check('500 个随机整数与 Intl 的千分位分组一致', groupingMismatches, 0);

  check('小数量级仍用科学计数法以外的形式', M.formatNumber(0.000001), '0.000001');
  check('极小值用科学计数法', M.formatNumber(1e-7), '1e-7');
}

console.log('--- 非法输入必须报错，而不是返回 NaN ---');
{
  const required = [
    ['1+', '运算符后没有操作数'],
    ['(1+2', '括号没有闭合'],
    ['1++2', '重复的一元正号（不支持一元正号）'],
    ['sin()', '函数没有参数'],
    ['foo(1)', '未知函数'],
    ['x', '未知变量'],
    ['', '空串'],
    ['   ', '纯空白'],
  ];
  for (const [expression, why] of required) {
    checkRejected(`${JSON.stringify(expression)} 被拒绝（${why}）`, expression);
  }

  const others = [
    ')',
    '(1))',
    '1)',
    '2^',
    '^2',
    '!5',
    '1,2',
    ',',
    'sqrt(1,2)',
    'pow(1)',
    'pow(1,2,3)',
    'min()',
    'sin',
    'sqrt',
    'pi+',
    '*3',
    '1*/2',
    '1.2.3',
    '@',
    '"1"',
    '1;2',
    '{1}',
    '[1]',
    '1=2',
    'null',
    'NaN',
    'Infinity',
    'true',
    '2e',
    '1e+',
    '..5',
    '函数',
    '1+2 3',
    '((1)',
    'sin(1',
    'sqrt((2)',
    '1..2',
  ];
  let rejected = 0;
  for (const expression of others) {
    let result;
    try {
      result = M.evaluateExpression(expression);
    } catch (error) {
      report(false, `${JSON.stringify(expression)} 不应让评估器抛异常`, String(error && error.message));
      continue;
    }
    if (result.ok === false && result.message.length > 0) rejected += 1;
    else console.log(`        ${JSON.stringify(expression)} 被接受了：${JSON.stringify(result)}`);
  }
  check(`${others.length} 个额外非法输入全部被拒绝且带有错误信息`, rejected, others.length);

  // Position information: the message points at the offending character when it
  // can, and never outside the string.
  const positioned = ['1++2', '(1+2', 'foo(1)', '1+@', '2^'];
  let positionedOk = 0;
  for (const expression of positioned) {
    const result = M.evaluateExpression(expression);
    if (!result.ok && result.position !== null && result.position >= 0 && result.position <= expression.length) {
      positionedOk += 1;
    }
  }
  check('错误位置落在输入范围内', positionedOk, positioned.length);
  check('空串没有位置可指', M.evaluateExpression('').position, null);

  // NaN as an *input* spelling is refused, so a value can never come back as a
  // silent parse artefact; NaN only ever arises from an operation such as 0/0.
  checkRejected('NaN 不是合法输入', 'NaN');
  check('但 0/0 是一个合法的运算结果 NaN', Number.isNaN(value('0/0')), true);
}

console.log('--- 长度与嵌套边界 ---');
{
  const longValid = `1${'+1'.repeat(499)}`;
  check('999 字符的合法表达式可以求值', value(longValid), 500);
  check('长度正好是 999', longValid.length, 999);
  checkRejected('1001 字符被拒绝', `1${'+1'.repeat(500)}`);
  checkRejected('5000 字符被拒绝', '1'.repeat(5000));
  check('上限常量与判断一致', M.MAX_EXPRESSION_LENGTH, 1000);

  const nested = (depth) => `${'('.repeat(depth)}1${')'.repeat(depth)}`;
  check('64 层括号可以求值', value(nested(64)), 1);
  checkRejected('65 层括号被拒绝', nested(65));
  checkRejected('2000 层括号被拒绝', nested(2000));
  check('嵌套上限常量存在', M.MAX_PAREN_DEPTH, 64);

  // Sibling groups must not accumulate depth: each closes before the next opens.
  const siblings = '1'.concat('+(2)'.repeat(200));
  check('200 个平级括号组不会被误判为过深', value(siblings), 1 + 200 * 2);

  check('超长但语法合法的表达式仍然线性完成', Number.isFinite(value(`1${'*1'.repeat(499)}`)), true);
}

console.log('--- 反证：eval 对同一批输入是危险的 ---');
{
  const evalContext = vm.createContext({});

  // 1. eval runs JavaScript, not arithmetic: an immediately invoked function is
  //    a perfectly good "expression" to it.
  check(
    'eval 会执行函数调用（数学表达式不该有这种输入）',
    vm.runInNewContext('(function () { return 40 + 2 })()'),
    42,
  );
  checkRejected('本工具拒绝同一个函数调用', '(function () { return 40 + 2 })()');

  // 2. Evaluating a string can mutate global state: a side effect that no
  //    arithmetic expression can express, and that the user never sees.
  const mutated = {};
  vm.runInNewContext('globalThis.__sideEffect = "yes"', mutated);
  check('eval 让输入顺手改了全局状态', mutated.__sideEffect, 'yes');
  checkRejected('本工具拒绝同一段输入', 'globalThis.__sideEffect = "yes"');

  // 3. eval reaches whatever the surrounding scope offers. In Node that is the
  //    process; in a browser page it is window, document and localStorage — a
  //    pasted "expression" could read a session token and fetch it away.
  const withProcess = vm.runInContext('String(process.version)', vm.createContext({ process }));
  check('eval 能读到宿主环境（这里是 process.version）', withProcess.startsWith('v'), true);
  checkRejected('本工具拒绝 process.version', 'process.version');
  checkRejected('本工具拒绝 localStorage.getItem("k")', 'localStorage.getItem("k")');
  checkRejected('本工具拒绝 document.cookie', 'document.cookie');
  checkRejected('本工具拒绝 fetch("https://example.com")', 'fetch("https://example.com")');

  // 4. The tempting mitigation — a blacklist regex over the input text — does
  //    not work, because the JavaScript parser decodes escapes *after* the
  //    filter has read the characters.
  const blacklist = /__pwned/;
  const escaped = '1 + (globalThis["__\\u0070wned"] = 1)';
  check('黑名单正则看不到输入真正要访问的名字', blacklist.test(escaped), false);
  const escapedContext = {};
  vm.runInNewContext(escaped, escapedContext);
  check('但解析器解码转义后照样执行了', escapedContext.__pwned, 1);
  checkRejected('本工具拒绝同一段文本', escaped);

  // 5. Silently returning NaN is the wrong failure mode too: an input that is
  //    not arithmetic must be reported, not turned into a number-like value.
  check(
    'eval 把非数字输入悄悄变成 NaN 而不是报错',
    Number.isNaN(vm.runInContext('"abc" * 2', evalContext)),
    true,
  );
  checkRejected('本工具拒绝同一输入', '"abc" * 2');
  let syntaxError = false;
  try {
    vm.runInContext('1+', evalContext);
  } catch (error) {
    // `instanceof SyntaxError` would be false here: the error comes from the
    // sandbox's realm, whose SyntaxError is a different constructor object.
    syntaxError = Boolean(error) && error.name === 'SyntaxError';
  }
  check('eval 对 1+ 抛 SyntaxError（调用方要靠异常才知道输入非法）', syntaxError, true);
  checkRejected('本工具对同一输入返回错误结果对象', '1+');

  // 6. And the implementation itself contains none of it: the parser is real.
  const code = ts.transpileModule(utilsSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      removeComments: true,
    },
  }).outputText;
  check('求值器源码里没有 eval(...)', /(^|[^.\w])eval\s*\(/.test(code), false);
  check('求值器源码里没有 new Function(...)', /new\s+Function\s*\(/.test(code), false);
  check('求值器源码里没有直接调用 Function(...)', /(^|[^.\w])Function\s*\(/.test(code), false);
  check('求值器源码里没有 setTimeout/setInterval', /set(Timeout|Interval)/.test(code), false);
  check('求值器源码里没有 DOM 访问', /\bdocument\b|\bwindow\b|\blocalStorage\b/.test(code), false);
  check('求值器源码里没有读时钟', /Date\.now|performance\.now|new Date/.test(code), false);
  check('求值器源码里没有 import React', /from\s+['"]react['"]/.test(code), false);
  check('求值器源码里没有 import 任何模块', /^\s*import\s/m.test(code), false);

  const toolSource = ts.transpileModule(
    readFileSync('src/tools/math-evaluator/MathEvaluatorTool.tsx', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        removeComments: true,
      },
    },
  ).outputText;
  check('界面组件里也没有 eval', /(^|[^.\w])eval\s*\(/.test(toolSource), false);
  check('界面组件里也没有 new Function(...)', /new\s+Function\s*\(/.test(toolSource), false);
}

console.log('--- 随机输入不变量（不该抛异常、不该挂起） ---');
{
  // Deterministic garbage: whatever comes out must be a value or a message.
  const alphabet = ['1', '2', '9', '0', '.', '+', '-', '*', '/', '%', '^', '!', '(', ')', ',', 'p', 'i', 's', 'q', ' ', '@', 'π'];
  let evaluated = 0;
  let rejected = 0;
  let crashed = 0;
  for (let round = 0; round < 3000; round += 1) {
    const length = randomInt(0, 12);
    let source = '';
    for (let i = 0; i < length; i += 1) source += pick(alphabet);
    try {
      const result = M.evaluateExpression(source);
      if (result.ok) {
        evaluated += 1;
        if (typeof result.value !== 'number' || typeof result.rpn !== 'string' || !Array.isArray(result.steps)) {
          crashed += 1;
        }
      } else {
        rejected += 1;
        if (typeof result.message !== 'string' || result.message.length === 0) crashed += 1;
      }
    } catch (error) {
      crashed += 1;
      if (crashed < 4) console.log(`        ${JSON.stringify(source)} 抛出了 ${error && error.message}`);
    }
  }
  check('3000 段随机垃圾输入没有一次抛异常或返回半成品', crashed, 0);
  check('每一次输入都得到了明确结论（求值或报错）', evaluated + rejected, 3000);
  check('随机输入里确实有被接受的表达式（比例不重要，不崩才是重点）', evaluated > 40, true);
  check('随机输入里确实有被拒绝的表达式', rejected > 2000, true);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
