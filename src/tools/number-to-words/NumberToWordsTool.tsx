import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  Dropdown,
  MessageBar,
  MessageBarBody,
  Option,
  Text,
  makeStyles,
  tokens,
  Toast,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
} from '@fluentui/react-components';
import {
  Checkmark16Regular,
  Copy16Regular,
  NumberSymbolRegular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  CURRENCIES,
  DEFAULT_CURRENCY_ID,
  MAX_ABS_EXCLUSIVE,
  chineseWordsFor,
  englishCurrencyFor,
  englishOrdinalFor,
  englishWordsFor,
  parseNumericInput,
  type WordResult,
} from './numberToWordsUtils';

const MONO = "'Cascadia Code', 'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace";

const EXAMPLES = [
  { label: '123', value: '123' },
  { label: '100000000（一亿）', value: '100000000' },
  { label: '1e21-1（quintillion）', value: '999999999999999999999' },
  { label: '0.05', value: '0.05' },
  { label: '-42.5', value: '-42.5' },
  { label: '0.1+0.2 的浮点结果', value: String(0.1 + 0.2) },
];

const useStyles = makeStyles({
  column: {
    flexDirection: 'column',
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  inputRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 14px 10px',
  },
  input: {
    flex: '1 1 260px',
    minWidth: '220px',
    fontFamily: MONO,
    fontSize: '16px',
    fontVariantNumeric: 'tabular-nums',
  },
  examples: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    padding: '0 14px 12px',
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '10px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '150px',
    color: tokens.colorNeutralForeground3,
    paddingTop: '2px',
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: MONO,
    fontSize: '15px',
    lineHeight: 1.7,
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
    fontFamily: MONO,
  },
  caption: {
    color: tokens.colorNeutralForeground3,
  },
  rules: {
    padding: '12px 14px 14px',
    color: tokens.colorNeutralForeground3,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  currencySelect: {
    minWidth: '230px',
  },
});

/** One labelled conversion row with a copy button. */
function ResultRow({
  label,
  result,
  onCopy,
  copied,
}: {
  label: string;
  result: WordResult;
  onCopy: (value: string) => void;
  copied: boolean;
}) {
  const styles = useStyles();
  return (
    <div className={styles.row}>
      <Text className={styles.rowLabel}>{label}</Text>
      <Text className={styles.rowValue}>
        {result.ok ? result.text : <span className={styles.error}>{result.error}</span>}
      </Text>
      <Button
        appearance="subtle"
        size="small"
        icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
        onClick={() => onCopy(result.text)}
        disabled={!result.ok}
        aria-label={`复制“${label}”的结果`}
      />
    </div>
  );
}

export function NumberToWordsTool() {
  const styles = useStyles();
  const toasterId = useId('n2w-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [raw, setRaw] = useState('123');
  const [currencyId, setCurrencyId] = useState(DEFAULT_CURRENCY_ID);
  const [copied, setCopied] = useState<string | null>(null);

  const notify = useCallback(
    (title: string, intent: 'success' | 'error' = 'success') => {
      dispatchToast(
        <Toast>
          <ToastTitle>{title}</ToastTitle>
        </Toast>,
        { intent, timeout: 1500 },
      );
    },
    [dispatchToast],
  );

  const results = useMemo(() => {
    const parsed = parseNumericInput(raw);
    return {
      parsed,
      english: englishWordsFor(parsed),
      ordinal: englishOrdinalFor(parsed),
      currency: englishCurrencyFor(parsed, currencyId),
      chinese: chineseWordsFor(parsed, false),
      financial: chineseWordsFor(parsed, true),
    };
  }, [raw, currencyId]);

  const copy = useCallback(
    async (label: string, value: string) => {
      const done = await copyText(value);
      if (done) {
        setCopied(label);
        window.setTimeout(() => setCopied((current) => (current === label ? null : current)), 1500);
        notify('已复制');
      } else {
        notify('复制失败，请手动选择', 'error');
      }
    },
    [notify],
  );

  const parsed = results.parsed;

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <section className="wt-surface" aria-label="数字转文字">
        <div className="wt-surface__header">
          <NumberSymbolRegular />
          <Text as="h2" size={300} weight="semibold">
            输入数字
          </Text>
          <Badge appearance="tint" color="brand" size="small">
            绝对值 &lt; 10^21
          </Badge>
          <Caption1 className={styles.caption} style={{ marginLeft: 'auto' }}>
            按十进制字符串解析，不经过浮点数
          </Caption1>
        </div>

        <div className={`wt-surface__body ${styles.column}`}>
          <div className={styles.stack}>
            <div className={styles.inputRow}>
              <input
                className={`wt-inline-input ${styles.input}`}
                value={raw}
                onChange={(event) => setRaw(event.target.value)}
                placeholder="例如 123、-42.5、0.05、1e21"
                aria-label="要转换的数字"
                spellCheck={false}
                inputMode="text"
              />
              <Button appearance="secondary" onClick={() => setRaw('')}>
                清空
              </Button>
            </div>

            <div className={styles.examples}>
              {EXAMPLES.map((example) => (
                <Button
                  key={example.label}
                  appearance="subtle"
                  size="small"
                  onClick={() => setRaw(example.value)}
                >
                  {example.label}
                </Button>
              ))}
            </div>

            {parsed.ok && (
              <div className={styles.examples}>
                <Caption1 className={styles.caption}>
                  规范化：{parsed.canonical} · {parsed.isInteger ? '整数' : `${parsed.fraction.length} 位小数`}
                  {parsed.fraction !== '' ? '（逐位读出，末尾的 0 不会被丢弃）' : ''}
                </Caption1>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="wt-surface" aria-label="转换结果">
        <div className="wt-surface__header">
          <NumberSymbolRegular />
          <Text as="h2" size={300} weight="semibold">
            转换结果
          </Text>
          <div style={{ marginLeft: 'auto' }}>
            <Dropdown
              className={styles.currencySelect}
              value={CURRENCIES.find((item) => item.id === currencyId)?.label ?? ''}
              selectedOptions={[currencyId]}
              onOptionSelect={(_, data) => setCurrencyId(data.optionValue ?? DEFAULT_CURRENCY_ID)}
              aria-label="货币读法使用的币种"
            >
              {CURRENCIES.map((item) => (
                <Option key={item.id} value={item.id} text={item.label}>
                  {item.label}
                </Option>
              ))}
            </Dropdown>
          </div>
        </div>

        <div className={`wt-surface__body ${styles.column}`}>
          {!parsed.ok ? (
            <div style={{ padding: '14px' }}>
              <MessageBar intent="error">
                <MessageBarBody>{parsed.error}</MessageBarBody>
              </MessageBar>
            </div>
          ) : (
            <div className={styles.stack}>
              <ResultRow
                label="英文基数词"
                result={results.english}
                onCopy={(value) => copy('english', value)}
                copied={copied === 'english'}
              />
              <ResultRow
                label="英文序数词"
                result={results.ordinal}
                onCopy={(value) => copy('ordinal', value)}
                copied={copied === 'ordinal'}
              />
              <ResultRow
                label="英文货币（支票）"
                result={results.currency}
                onCopy={(value) => copy('currency', value)}
                copied={copied === 'currency'}
              />
              <ResultRow
                label="中文普通读法"
                result={results.chinese}
                onCopy={(value) => copy('chinese', value)}
                copied={copied === 'chinese'}
              />
              <ResultRow
                label="中文金融大写"
                result={results.financial}
                onCopy={(value) => copy('financial', value)}
                copied={copied === 'financial'}
              />
            </div>
          )}
        </div>
      </section>

      <section className="wt-surface" aria-label="规则说明">
        <div className="wt-surface__header">
          <NumberSymbolRegular />
          <Text as="h2" size={300} weight="semibold">
            规则与边界
          </Text>
        </div>
        <div className={`wt-surface__body ${styles.column}`}>
          <div className={styles.rules}>
            <Text>
              英文按三位分组（thousand / million / billion…），中文按四位分组（万 / 亿 / 兆 /
              京 / 垓）。同一个数在两种语言里的单位落点不同：100000000 英文是 one hundred
              million，中文是一亿，而不是「一百百万」。
            </Text>
            <Text>
              中文普通读法在 10~19 与十万级里省略前导「一」（12 读作十二），金融大写永不省略（10
              写作壹拾）。金融大写只切换数字与数位字形，分组与补零规则完全相同。
            </Text>
            <Text>
              小数一律逐位读：英文用 point，中文用点；序数词只支持非负整数（小数没有公认读法）。
            </Text>
            <Text>
              输入按十进制字符串处理，因此 0.1 + 0.2 的结果会被读出它实际携带的十七位小数，而输入
              「0.3」读作 zero point three —— 这正是不能先把值塞进浮点数的原因。
            </Text>
            <Text>
              支持范围：绝对值小于 10^21（999 quintillion / 999 垓），最多 30 位小数；不支持千分位逗号。
              不做其它语言 —— 要做就得做对。
            </Text>
            <Divider />
            <Caption1 className={styles.caption}>
              范围上限以常量形式固定为 10^21（{MAX_ABS_EXCLUSIVE.toString()}）。
            </Caption1>
          </div>
        </div>
      </section>
    </>
  );
}
