import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Divider,
  Dropdown,
  MessageBar,
  MessageBarBody,
  Option,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowCounterclockwiseRegular,
  CheckmarkRegular,
  CopyRegular,
  DeleteRegular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  CONSTANT_NAMES,
  FUNCTION_NAMES,
  MAX_FRACTION_DIGITS,
  evaluateExpression,
  formatNumber,
  looksLikeRoundingArtifact,
  type AngleMode,
  type EvalResult,
  type MathStep,
} from './mathEvaluatorUtils';

const HISTORY_KEY = 'wheat-tools:math-evaluator:history';
const MAX_HISTORY = 50;
const MAX_RENDERED_STEPS = 300;

const MONO = "'Cascadia Code', 'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace";

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    width: '100%',
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  expression: {
    flex: '1 1 320px',
    fontSize: '16px',
    padding: '10px 12px',
  },
  resultBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '14px 16px',
    borderRadius: '8px',
    backgroundColor: tokens.colorNeutralBackground3,
  },
  result: {
    fontFamily: MONO,
    // Tabular figures keep the digits from shifting as the value is retyped.
    fontVariantNumeric: 'tabular-nums',
    fontSize: 'clamp(22px, 5vw, 34px)',
    fontWeight: 600,
    lineHeight: 1.2,
    wordBreak: 'break-all',
    userSelect: 'text',
  },
  resultNote: {
    color: tokens.colorNeutralForeground3,
  },
  caret: {
    margin: 0,
    overflowX: 'auto',
    fontFamily: MONO,
    fontSize: '13px',
    lineHeight: 1.4,
    color: tokens.colorPaletteRedForeground1,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '100%',
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  chip: {
    fontFamily: MONO,
    fontSize: '12px',
    minWidth: 'auto',
    height: '26px',
    padding: '0 8px',
  },
  stepList: {
    margin: 0,
    padding: '8px 0 8px 26px',
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums',
    fontSize: '13px',
    lineHeight: 1.9,
    userSelect: 'text',
  },
  rpn: {
    fontFamily: MONO,
    fontSize: '14px',
    padding: '10px 12px',
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground3,
    wordBreak: 'break-all',
    userSelect: 'text',
  },
  historyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums',
    fontSize: '13px',
    padding: '4px 0',
  },
  historyExpression: {
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    textAlign: 'left',
    background: 'none',
    border: 0,
    padding: 0,
    color: tokens.colorBrandForeground1,
    font: 'inherit',
  },
  historyValue: {
    color: tokens.colorNeutralForeground2,
    whiteSpace: 'nowrap',
  },
  note: {
    color: tokens.colorNeutralForeground3,
    lineHeight: 1.7,
  },
  list: {
    margin: 0,
    paddingLeft: '20px',
    color: tokens.colorNeutralForeground2,
    lineHeight: 1.8,
    fontSize: '13px',
  },
  table: {
    borderCollapse: 'collapse',
    fontSize: '13px',
    fontFamily: MONO,
  },
  tableCell: {
    padding: '4px 16px 4px 0',
    textAlign: 'left',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: 'nowrap',
  },
});

interface HistoryEntry {
  expression: string;
  value: number;
  angleMode: AngleMode;
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<HistoryEntry>;
  return (
    typeof entry.expression === 'string' &&
    entry.expression.length > 0 &&
    typeof entry.value === 'number' &&
    (entry.angleMode === 'rad' || entry.angleMode === 'deg')
  );
}

/** Reads the saved history; unreadable data simply yields no history. */
function readHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryEntry).slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

const DECIMAL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: '自动（最短往返表示）' },
  ...Array.from({ length: MAX_FRACTION_DIGITS + 1 }, (_, digits) => ({
    value: String(digits),
    label: `${digits} 位小数`,
  })),
];

const EXAMPLES: Array<{ text: string; note: string; angleMode?: AngleMode }> = [
  { text: '0.1 + 0.2', note: '浮点误差' },
  { text: '-2^2', note: '一元负号低于幂' },
  { text: '2^3^2', note: '幂右结合' },
  { text: '(2+3)*4', note: '括号' },
  { text: '10-3-2', note: '减法左结合' },
  { text: '5!', note: '阶乘' },
  { text: 'sqrt(2)', note: '函数' },
  { text: 'sin(30)', note: '角度制三角', angleMode: 'deg' },
  { text: 'hypot(3,4)', note: '多参数函数' },
  { text: 'log10(1234)', note: '常用对数' },
  { text: '1/0', note: 'Infinity' },
  { text: '0/0', note: 'NaN' },
  { text: '171!', note: '溢出' },
  { text: '1e308*10', note: '上溢' },
];

export function MathEvaluatorTool() {
  const styles = useStyles();
  const inputRef = useRef<HTMLInputElement>(null);
  const [expression, setExpression] = useState('0.1 + 0.2');
  const [angleMode, setAngleMode] = useState<AngleMode>('rad');
  const [decimals, setDecimals] = useState<number | null>(null);
  const [group, setGroup] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(readHistory);
  const [copied, setCopied] = useState(false);

  // Evaluation is pure and cheap (linear in the input length), so it runs on
  // every keystroke and there is no "计算" button to forget to press.
  const result: EvalResult = useMemo(() => {
    try {
      return evaluateExpression(expression, { angleMode });
    } catch {
      // evaluateExpression only returns, never throws, for input problems; a
      // throw here would be a bug in the evaluator, and the page should say so
      // rather than fail to render.
      return { ok: false, message: '求值器内部错误', position: null };
    }
  }, [expression, angleMode]);

  const formatted = result.ok ? formatNumber(result.value, { decimals, group }) : '';
  const artifact = result.ok && looksLikeRoundingArtifact(result.value);

  const persist = useCallback((entries: HistoryEntry[]) => {
    setHistory(entries);
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    } catch {
      // Persistence is best effort: the calculator works without it.
    }
  }, []);

  const remember = useCallback(
    (current: EvalResult, source: string, mode: AngleMode) => {
      if (!current.ok || source.trim() === '') return;
      const entry: HistoryEntry = { expression: source.trim(), value: current.value, angleMode: mode };
      const rest = history.filter((item) => item.expression !== entry.expression);
      persist([entry, ...rest].slice(0, MAX_HISTORY));
    },
    [history, persist],
  );

  /**
   * Inserts text at the caret, which is where a keypad should put it.
   *
   * `caretBack` pulls the caret back from the end of the inserted text, so a
   * function button can drop `sqrt()` in and leave the caret between the
   * brackets, ready for the argument.
   */
  const insert = useCallback((text: string, caretBack = 0) => {
    const input = inputRef.current;
    if (!input) {
      setExpression((current) => current + text);
      return;
    }
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    setExpression((current) => `${current.slice(0, start)}${text}${current.slice(end)}`);
    const caret = start + text.length - caretBack;
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  }, []);

  const copyResult = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; leaving the button unflipped is the
      // honest outcome rather than claiming a copy that did not happen.
      setCopied(false);
    }
  }, [formatted]);

  return (
    <div className="wt-surface">
      <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
        <div className={styles.stack}>
          <div className={styles.row}>
            <input
              ref={inputRef}
              className={`wt-inline-input ${styles.expression}`}
              value={expression}
              onChange={(event) => setExpression(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') remember(result, expression, angleMode);
              }}
              placeholder="输入表达式，例如 sqrt(2) * sin(pi/3) + 5!"
              aria-label="数学表达式"
              spellCheck={false}
              autoComplete="off"
            />
            <Button
              appearance="subtle"
              icon={<ArrowCounterclockwiseRegular />}
              onClick={() => setExpression('')}
              disabled={expression === ''}
            >
              清空
            </Button>
            <Button
              appearance="subtle"
              icon={<CopyRegular />}
              onClick={copyResult}
              disabled={!result.ok}
            >
              {copied ? '已复制' : '复制结果'}
            </Button>
          </div>

          {/* Errors are reported as errors: an invalid expression must never be
              presented as a NaN "result", because then a typo and a real
              not-a-number answer look the same. */}
          {result.ok ? (
            <div className={styles.resultBox}>
              <Text className={styles.result} aria-live="polite">
                {formatted}
              </Text>
              {artifact && (
                <Caption1 className={styles.resultNote}>
                  注意：这个值带有二进制浮点的表示误差（IEEE-754 双精度）。0.1 + 0.2 在双精度下不等于
                  0.3，需要整洁的显示可以在下面选择小数位数。
                </Caption1>
              )}
              {result.ok && !Number.isFinite(result.value) && (
                <Caption1 className={styles.resultNote}>
                  {Number.isNaN(result.value)
                    ? 'NaN：运算没有定义（例如 0/0 或 Infinity - Infinity）。'
                    : 'Infinity：结果溢出了双精度能表示的最大值，或者除以了 0。'}
                </Caption1>
              )}
            </div>
          ) : (
            <div className={styles.section}>
              <MessageBar intent="error">
                <MessageBarBody>
                  {result.message}
                  {result.position !== null ? `（第 ${result.position + 1} 个字符）` : ''}
                </MessageBarBody>
              </MessageBar>
              {result.position !== null && (
                <pre className={styles.caret} aria-hidden="true">
                  {`${expression}\n${' '.repeat(Math.min(result.position, expression.length))}^`}
                </pre>
              )}
            </div>
          )}

          <div className={styles.row}>
            <Text size={200}>三角函数单位</Text>
            <Dropdown
              aria-label="三角函数角度单位"
              selectedOptions={[angleMode]}
              value={angleMode === 'deg' ? '角度（deg）' : '弧度（rad）'}
              onOptionSelect={(_, data) => setAngleMode(data.optionValue as AngleMode)}
            >
              <Option value="rad" text="弧度（rad）">
                弧度（rad）
              </Option>
              <Option value="deg" text="角度（deg）">
                角度（deg）
              </Option>
            </Dropdown>

            <Text size={200}>小数位数</Text>
            <Dropdown
              aria-label="结果显示的小数位数"
              selectedOptions={[decimals === null ? 'auto' : String(decimals)]}
              value={decimals === null ? '自动（最短往返表示）' : `${decimals} 位小数`}
              onOptionSelect={(_, data) => {
                const next = data.optionValue;
                setDecimals(next === undefined || next === 'auto' ? null : Number(next));
              }}
            >
              {DECIMAL_OPTIONS.map((item) => (
                <Option key={item.value} value={item.value} text={item.label}>
                  {item.label}
                </Option>
              ))}
            </Dropdown>

            <Checkbox
              checked={group}
              onChange={(_, data) => setGroup(Boolean(data.checked))}
              label="千分位分隔"
            />
          </div>

          <div className={styles.section}>
            <Text as="h2" size={300} weight="semibold">
              示例
            </Text>
            <div className={styles.chips}>
              {EXAMPLES.map((example) => (
                <Button
                  key={example.text}
                  className={styles.chip}
                  appearance="outline"
                  title={example.note}
                  onClick={() => {
                    setExpression(example.text);
                    if (example.angleMode) setAngleMode(example.angleMode);
                  }}
                >
                  {example.text}
                </Button>
              ))}
            </div>
          </div>

          <Divider />

          {result.ok && (
            <div className={styles.section}>
              <Text as="h2" size={300} weight="semibold">
                计算过程
              </Text>
              {result.steps.length === 0 ? (
                <Caption1 className={styles.note}>输入就是一个数，没有中间步骤。</Caption1>
              ) : (
                <>
                  <Caption1 className={styles.note}>
                    按实际求值顺序折叠：先算的子表达式排在上面。这也是看清优先级最快的方式 ——
                    `-2^2` 的第一步是 `2^2 = 4`，然后才轮到负号。
                  </Caption1>
                  <ol className={styles.stepList}>
                    {result.steps.slice(0, MAX_RENDERED_STEPS).map((step: MathStep, index) => (
                      <li key={`${step.expression}-${index}`}>
                        {step.expression} = {formatNumber(step.value, { decimals, group })}
                      </li>
                    ))}
                  </ol>
                  {result.steps.length > MAX_RENDERED_STEPS && (
                    <Caption1 className={styles.note}>
                      步骤过多，只显示前 {MAX_RENDERED_STEPS} 步。
                    </Caption1>
                  )}
                </>
              )}
            </div>
          )}

          {result.ok && (
            <div className={styles.section}>
              <Text as="h2" size={300} weight="semibold">
                RPN（逆波兰）形式
              </Text>
              <div className={styles.rpn} aria-label="RPN 形式">
                {result.rpn}
              </div>
              <Caption1 className={styles.note}>
                后缀记法不需要括号，优先级已经在操作数的顺序里。一元负号写作 `neg`；`min`、`max`、
                `hypot` 这类多参函数会带上参数个数（如 `3 4 hypot#2`），因为后缀记法本身看不出参数
                到哪儿为止。
              </Caption1>
            </div>
          )}

          <Divider />

          <div className={styles.section}>
            <div className={styles.row}>
              <Text as="h2" size={300} weight="semibold">
                历史记录
              </Text>
              <Caption1 className={styles.note}>按回车记录当前表达式</Caption1>
              <Button
                appearance="subtle"
                size="small"
                icon={<DeleteRegular />}
                onClick={() => persist([])}
                disabled={history.length === 0}
              >
                清空历史
              </Button>
            </div>
            {history.length === 0 ? (
              <Caption1 className={styles.note}>还没有记录。</Caption1>
            ) : (
              <div>
                {history.map((entry, index) => (
                  <div className={styles.historyRow} key={`${entry.expression}-${index}`}>
                    <button
                      type="button"
                      className={styles.historyExpression}
                      onClick={() => {
                        setExpression(entry.expression);
                        setAngleMode(entry.angleMode);
                      }}
                      title="放回输入框"
                    >
                      {entry.expression}
                    </button>
                    <span className={styles.historyValue}>
                      = {formatNumber(entry.value, { decimals, group })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Divider />

          <div className={styles.section}>
            <div className={styles.row}>
              <Text as="h2" size={300} weight="semibold">
                为什么不用 eval
              </Text>
              <Badge appearance="tint" color="brand" icon={<CheckmarkRegular />}>
                没有 eval / new Function
              </Badge>
            </div>
            <Caption1 className={styles.note}>
              本工具的输入永远不会被交给 JavaScript 引擎求值。这不是洁癖，而是唯一正确的做法：
            </Caption1>
            <ul className={styles.list}>
              <li>
                eval 执行的是 JavaScript，不是算术。函数调用、`fetch("https://…")`、
                `localStorage.getItem("token")`、一段死循环，对它来说都是合法输入：粘贴进来的
                "表达式"可以读走会话数据并发出去，也可以直接把标签页卡死。
              </li>
              <li>
                用正则黑名单过滤输入挡不住：`\u0070` 这类转义由 JavaScript 解析器解码，而黑名单看到的
                只是反斜杠和数字，于是"已被过滤"的名字照样执行。
              </li>
              <li>
                失败方式也是错的：eval 对 `1+` 抛 SyntaxError，对非数字输入则悄悄给回 NaN，让"算错了"
                和"没算"看起来一模一样。
              </li>
            </ul>
            <Caption1 className={styles.note}>
              所以这里自己写了词法分析器和递归下降语法分析器，文法里只有数字、运算符、函数和常量。
              输入最坏只能换来一条错误提示。检查脚本 scripts/check-math-evaluator.mjs
              里有可运行的反证：同一段文本在 node:vm 的 eval 里修改了全局变量、读到了 process.version，
              而本工具把它拒之门外。
            </Caption1>
          </div>

          <Divider />

          <div className={styles.section}>
            <Text as="h2" size={300} weight="semibold">
              支持与不支持
            </Text>
            <Caption1 className={styles.note}>
              支持：`+ - * / % ^`（`**` 同义）、括号、一元负号、后缀阶乘 `!`、函数与常量、角度/弧度、
              小数位数与千分位、计算过程、RPN、历史记录。
            </Caption1>
            <Caption1 className={styles.note}>
              明确不做：符号求导与积分、方程求解、单位换算（仓库里已有单位换算工具）、隐式乘法
              （`2pi` 要写成 `2*pi`）、变量与赋值、任意精度。
            </Caption1>
            <ul className={styles.list}>
              <li>数字是 IEEE-754 双精度，和 Math、和 JavaScript 的 number 完全一致。</li>
              <li>`%` 是取余而不是百分号：`-7 % 3 = -1`，符号跟着被除数。</li>
              <li>`ln` 与 `log` 都是自然对数；常用对数是 `log10`。</li>
              <li>`round` 与 Math.round 一致：`round(-1.5) = -1`，`round(2.5) = 3`。</li>
              <li>`1/0` 是 Infinity、`0/0` 是 NaN，它们不是错误，是 IEEE-754 的结果。</li>
              <li>阶乘只对非负整数有定义；171! 起就超出双精度，结果是 Infinity。</li>
              <li>
                角度模式下三角函数仍是双精度计算，所以 `sin(180)` 会得到 1.22e-16 而不是 0 ——
                这也是浮点，不是 bug。
              </li>
            </ul>
          </div>

          <div className={styles.section}>
            <Text as="h2" size={300} weight="semibold">
              优先级与结合性
            </Text>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.tableCell}>优先级</th>
                  <th className={styles.tableCell}>运算符</th>
                  <th className={styles.tableCell}>结合性</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={styles.tableCell}>1（最低）</td>
                  <td className={styles.tableCell}>+ -</td>
                  <td className={styles.tableCell}>左结合：10-3-2 = 5</td>
                </tr>
                <tr>
                  <td className={styles.tableCell}>2</td>
                  <td className={styles.tableCell}>* / %</td>
                  <td className={styles.tableCell}>左结合：8/4/2 = 1</td>
                </tr>
                <tr>
                  <td className={styles.tableCell}>3</td>
                  <td className={styles.tableCell}>前缀负号 -</td>
                  <td className={styles.tableCell}>低于幂：-2^2 = -4</td>
                </tr>
                <tr>
                  <td className={styles.tableCell}>4</td>
                  <td className={styles.tableCell}>^ 与 **</td>
                  <td className={styles.tableCell}>右结合：2^3^2 = 512，指数可带负号：2^-1 = 0.5</td>
                </tr>
                <tr>
                  <td className={styles.tableCell}>5（最高）</td>
                  <td className={styles.tableCell}>后缀 !</td>
                  <td className={styles.tableCell}>高于幂：2^3! = 64</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className={styles.section}>
            <Text as="h2" size={300} weight="semibold">
              函数与常量
            </Text>
            <Caption1 className={styles.note}>
              点一下插入到光标处：
            </Caption1>
            <div className={styles.chips}>
              {FUNCTION_NAMES.map((name) => (
                <Button
                  key={name}
                  className={styles.chip}
                  appearance="subtle"
                  onClick={() => insert(`${name}()`, 1)}
                  title={`插入 ${name}()`}
                >
                  {name}
                </Button>
              ))}
            </div>
            <div className={styles.chips}>
              {CONSTANT_NAMES.map((name) => (
                <Button
                  key={name}
                  className={styles.chip}
                  appearance="subtle"
                  onClick={() => insert(name)}
                  title={`插入 ${name}`}
                >
                  {name}
                </Button>
              ))}
            </div>
            <Caption1 className={styles.note}>
              多参数：`pow(a, b)`、`min(...)`、`max(...)`、`hypot(...)` 用逗号分隔。插入函数后光标停在
              括号内。
            </Caption1>
          </div>
        </div>
      </div>
    </div>
  );
}
