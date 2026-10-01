import { useCallback, useMemo, useState } from 'react';
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
  Tooltip,
  makeStyles,
  tokens,
  Toast,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
} from '@fluentui/react-components';
import {
  ArrowSwap16Regular,
  Calculator16Regular,
  Checkmark16Regular,
  Copy16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  MAX_RADIX,
  MIN_RADIX,
  convert,
  convertAll,
} from './baseUtils';

const RADIXES = [2, 8, 10, 16, 32, 36];

const RADIX_LABEL: Record<number, string> = {
  2: '二进制 (2)',
  8: '八进制 (8)',
  10: '十进制 (10)',
  16: '十六进制 (16)',
  32: '32 进制 (32)',
  36: '36 进制 (36)',
};

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '9px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '120px',
    color: tokens.colorNeutralForeground3,
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '14px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  big: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: 'clamp(20px, 3vw, 30px)',
    fontWeight: 600,
    overflowWrap: 'anywhere',
    userSelect: 'all',
    padding: '4px 0',
  },
  keys: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
    gap: '6px',
    width: '100%',
    padding: '12px 14px',
  },
  key: {
    padding: '6px 8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '6px',
    background: 'transparent',
    color: tokens.colorNeutralForeground2,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    cursor: 'pointer',
    textAlign: 'left',
    ':hover': {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      color: tokens.colorNeutralForeground1,
    },
  },
});

export function NumberBaseTool() {
  const styles = useStyles();
  const toasterId = useId('base-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [from, setFrom] = useState(10);
  const [to, setTo] = useState(16);
  const [input, setInput] = useState('255');
  const [precision, setPrecision] = useState(8);
  const [uppercase, setUppercase] = useState(true);
  const [group, setGroup] = useState(false);
  const [prefix, setPrefix] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const notify = useCallback(
    (message: string) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{message}</ToastTitle>
        </Toast>,
        { timeout: 1400 },
      );
    },
    [dispatchToast],
  );

  const copy = useCallback(
    async (value: string, key: string) => {
      const ok = await copyText(value);
      if (ok) {
        setCopied(key);
        window.setTimeout(() => setCopied(null), 1400);
        notify('已复制');
      } else {
        notify('复制失败');
      }
    },
    [notify],
  );

  const result = useMemo(
    () =>
      convert(input, {
        from,
        to,
        precision,
        uppercase,
        group: group ? 4 : 0,
        prefix,
      }),
    [input, from, to, precision, uppercase, group, prefix],
  );

  const all = useMemo(
    () => (result.ok ? convertAll(input, from, precision) : []),
    [input, from, precision, result.ok],
  );

  const swapBases = useCallback(() => {
    if (!result.ok) return;
    setInput(result.value.replace(/^0[bxo]/, ''));
    setFrom(to);
    setTo(from);
  }, [result, from, to]);

  const appendDigit = useCallback((char: string) => {
    setInput((current) => (current === '0' ? char : current + char));
  }, []);

  const digitKeys = useMemo(
    () => Array.from({ length: Math.min(from, 36) }, (_, i) => i.toString(36)),
    [from],
  );

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Caption1 className={styles.hint}>从</Caption1>
          <Dropdown
            style={{ minWidth: 140 }}
            value={RADIX_LABEL[from]}
            selectedOptions={[String(from)]}
            onOptionSelect={(_, data) => setFrom(Number(data.optionValue))}
            aria-label="源进制"
          >
            {RADIXES.map((radix) => (
              <Option key={radix} value={String(radix)} text={RADIX_LABEL[radix]}>
                {RADIX_LABEL[radix]}
              </Option>
            ))}
          </Dropdown>

          <Button
            appearance="secondary"
            icon={<ArrowSwap16Regular />}
            onClick={swapBases}
            disabled={!result.ok}
          >
            对调
          </Button>

          <Caption1 className={styles.hint}>到</Caption1>
          <Dropdown
            style={{ minWidth: 140 }}
            value={RADIX_LABEL[to]}
            selectedOptions={[String(to)]}
            onOptionSelect={(_, data) => setTo(Number(data.optionValue))}
            aria-label="目标进制"
          >
            {RADIXES.map((radix) => (
              <Option key={radix} value={String(radix)} text={RADIX_LABEL[radix]}>
                {RADIX_LABEL[radix]}
              </Option>
            ))}
          </Dropdown>

          <span className={styles.spacer} />

          <Checkbox
            checked={uppercase}
            onChange={(_, data) => setUppercase(Boolean(data.checked))}
            label="大写字母"
          />
          <Checkbox
            checked={group}
            onChange={(_, data) => setGroup(Boolean(data.checked))}
            label="每 4 位分隔"
          />
          <Checkbox
            checked={prefix}
            onChange={(_, data) => setPrefix(Boolean(data.checked))}
            label="加进制前缀"
          />
        </div>

        <section className="wt-surface" aria-label="输入">
          <div className="wt-surface__header">
            <Calculator16Regular />
            <Text as="h2" size={300} weight="semibold">
              输入（{from} 进制）
            </Text>
            <span className={styles.spacer} />
            <Tooltip content="小数保留位数" relationship="description" withArrow>
              <div className={styles.toolbar}>
                <Caption1 className={styles.hint}>小数位数</Caption1>
                <Dropdown
                  style={{ minWidth: 84 }}
                  value={String(precision)}
                  selectedOptions={[String(precision)]}
                  onOptionSelect={(_, data) =>
                    setPrecision(Number(data.optionValue))
                  }
                  aria-label="小数位数"
                >
                  {[0, 2, 4, 6, 8, 12, 16, 24, 32].map((value) => (
                    <Option key={value} value={String(value)} text={String(value)}>
                      {value}
                    </Option>
                  ))}
                </Dropdown>
              </div>
            </Tooltip>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.row}>
              <input
                className="wt-inline-input"
                style={{ fontSize: 16 }}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={`输入 ${from} 进制数值，支持小数与负号`}
                aria-label="数值输入"
                spellCheck={false}
              />
              <Button
                appearance="subtle"
                onClick={() => setInput('')}
                disabled={!input}
              >
                清空
              </Button>
            </div>
            <div className={styles.keys}>
              {digitKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={styles.key}
                  onClick={() => appendDigit(key)}
                >
                  {uppercase ? key.toUpperCase() : key}
                </button>
              ))}
            </div>
          </div>
        </section>

        {!result.ok && (
          <MessageBar intent="error">
            <MessageBarBody>{result.error}</MessageBarBody>
          </MessageBar>
        )}

        {result.ok && (
          <>
            <section className="wt-surface" aria-label="转换结果">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  {to} 进制结果
                </Text>
                {result.rounded && (
                  <Badge appearance="tint" color="warning" size="small">
                    小数已按 {precision} 位截断
                  </Badge>
                )}
                <span className={styles.spacer} />
                <Tooltip content="复制结果" relationship="label" withArrow>
                  <Button
                    appearance="subtle"
                    icon={
                      copied === 'main' ? (
                        <Checkmark16Regular />
                      ) : (
                        <Copy16Regular />
                      )
                    }
                    onClick={() => copy(result.value, 'main')}
                    aria-label="复制结果"
                  />
                </Tooltip>
              </div>
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <div className={styles.row}>
                  <Text className={styles.big}>{result.value}</Text>
                </div>
              </div>
            </section>

            <section className="wt-surface" aria-label="常用进制对照">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  常用进制对照
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  整数部分使用 BigInt 精确计算，超长数值不会丢精度
                </Caption1>
              </div>
              <div className={`wt-surface__body ${styles.rows}`}>
                {all.map((item) => (
                  <div key={item.radix} className={styles.row}>
                    <Text className={styles.rowLabel} size={200}>
                      {item.label}
                    </Text>
                    <span className={styles.rowValue}>
                      {item.value ?? `—  ${item.error ?? ''}`}
                    </span>
                    {item.value && (
                      <Tooltip content="复制" relationship="label" withArrow>
                        <Button
                          appearance="subtle"
                          size="small"
                          icon={
                            copied === `all-${item.radix}` ? (
                              <Checkmark16Regular />
                            ) : (
                              <Copy16Regular />
                            )
                          }
                          onClick={() => copy(item.value!, `all-${item.radix}`)}
                          aria-label={`复制 ${item.label}`}
                        />
                      </Tooltip>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        <MessageBar intent="info">
          <MessageBarBody>
            支持 {MIN_RADIX}–{MAX_RADIX} 进制；数字键位随源进制自动调整
            （例如 2 进制只显示 0 和 1）。小数在不同进制间通常无法精确表示，
            超出设定位数时会明确提示已截断。
          </MessageBarBody>
        </MessageBar>

        <Divider />
      </div>
    </>
  );
}
