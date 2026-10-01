import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Divider,
  MessageBar,
  MessageBarBody,
  Text,
  Toast,
  ToastTitle,
  Toaster,
  Tooltip,
  makeStyles,
  tokens,
  useId,
  useToastController,
} from '@fluentui/react-components';
import {
  Checkmark16Regular,
  Copy16Regular,
  NumberSymbol16Regular,
  TextNumberFormat20Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  MAX_VALUE,
  MAX_ROMAN_LENGTH,
  convertArabic,
  convertRoman,
} from './romanNumeralUtils';

/** Values that show the interesting parts of the system at a glance. */
const EXAMPLES = [4, 9, 40, 1994, 2024, 3888, 3999];

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  body: {
    flexDirection: 'column',
    gap: '10px',
    padding: '12px 14px',
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
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  examples: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
  },
  exampleButton: {
    minWidth: 'auto',
    padding: '2px 8px',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
  },
  resultRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: 0,
  },
  big: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: 'clamp(20px, 3vw, 30px)',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
    userSelect: 'all',
    padding: '2px 0',
  },
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minWidth: 0,
  },
  expression: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '14px',
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
    userSelect: 'all',
    padding: '8px 10px',
    borderRadius: '6px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  additive: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minWidth: 0,
    padding: '10px',
    borderRadius: '6px',
    border: `1px dashed ${tokens.colorNeutralStroke1}`,
  },
  additiveHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
  },
});

export function RomanNumeralTool() {
  const styles = useStyles();
  const toasterId = useId('roman-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [arabicInput, setArabicInput] = useState('1994');
  const [romanInput, setRomanInput] = useState('MCMXCIV');
  const [showAdditive, setShowAdditive] = useState(false);
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

  const fromArabic = useMemo(() => convertArabic(arabicInput), [arabicInput]);
  const fromRoman = useMemo(() => convertRoman(romanInput), [romanInput]);

  // Filling both sides keeps the examples useful as a starting point for
  // editing, rather than leaving one half of the page showing an old answer.
  const applyExample = useCallback((value: number) => {
    const converted = convertArabic(String(value));
    setArabicInput(String(value));
    if (converted.ok) setRomanInput(converted.value.roman);
  }, []);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Caption1 className={styles.hint}>快速示例</Caption1>
          <div className={styles.examples}>
            {EXAMPLES.map((value) => (
              <Button
                key={value}
                className={styles.exampleButton}
                appearance="subtle"
                size="small"
                onClick={() => applyExample(value)}
                aria-label={`示例 ${value}`}
              >
                {value}
              </Button>
            ))}
          </div>
          <span className={styles.spacer} />
          <Checkbox
            checked={showAdditive}
            onChange={(_, data) => setShowAdditive(Boolean(data.checked))}
            label="同时显示非标准（加法式）写法"
          />
        </div>

        <section className="wt-surface" aria-label="阿拉伯数字转罗马数字">
          <div className="wt-surface__header">
            <TextNumberFormat20Regular />
            <Text as="h2" size={300} weight="semibold">
              阿拉伯数字 → 罗马数字
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>标准范围 1–{MAX_VALUE}</Caption1>
          </div>
          <div className={`wt-surface__body ${styles.body}`}>
            <div className={styles.inputRow}>
              <input
                className="wt-inline-input"
                style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}
                value={arabicInput}
                onChange={(event) => setArabicInput(event.target.value)}
                placeholder="输入 1–3999 的整数"
                aria-label="阿拉伯数字输入"
                inputMode="numeric"
                spellCheck={false}
              />
              <Button
                appearance="subtle"
                onClick={() => setArabicInput('')}
                disabled={!arabicInput}
              >
                清空
              </Button>
            </div>

            {!fromArabic.ok && (
              <MessageBar intent="error">
                <MessageBarBody>{fromArabic.error}</MessageBarBody>
              </MessageBar>
            )}

            {fromArabic.ok && (
              <>
                <div className={styles.resultRow}>
                  <Text className={styles.big}>{fromArabic.value.roman}</Text>
                  <Tooltip content="复制罗马数字" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      icon={
                        copied === 'roman' ? (
                          <Checkmark16Regular />
                        ) : (
                          <Copy16Regular />
                        )
                      }
                      onClick={() => copy(fromArabic.value.roman, 'roman')}
                      aria-label="复制罗马数字"
                    />
                  </Tooltip>
                </div>

                <div className={styles.block}>
                  <Text size={200} weight="semibold">
                    拆解过程
                  </Text>
                  <div className={styles.expression}>
                    {fromArabic.value.value} = {fromArabic.value.breakdown}
                  </div>
                  <Caption1 className={styles.hint}>
                    逐项相加：{fromArabic.value.breakdownValues}
                  </Caption1>
                  <div className={styles.chips}>
                    {fromArabic.value.steps.map((step, index) => (
                      <Badge
                        key={`${step.symbol}-${index}`}
                        appearance="tint"
                        color="informative"
                        size="small"
                      >
                        {step.symbol} = {step.value}
                      </Badge>
                    ))}
                  </div>
                </div>

                {showAdditive && (
                  <div className={styles.additive}>
                    <div className={styles.additiveHead}>
                      <Warning16Regular />
                      <Text size={200} weight="semibold">
                        非标准：加法式写法
                      </Text>
                      <Badge appearance="tint" color="warning" size="small">
                        不是标准写法，仅供对照
                      </Badge>
                      <Tooltip content="复制加法式写法" relationship="label" withArrow>
                        <Button
                          appearance="subtle"
                          size="small"
                          icon={
                            copied === 'additive' ? (
                              <Checkmark16Regular />
                            ) : (
                              <Copy16Regular />
                            )
                          }
                          onClick={() =>
                            copy(fromArabic.value.additive, 'additive')
                          }
                          aria-label="复制加法式写法"
                        />
                      </Tooltip>
                    </div>
                    <div className={styles.expression}>
                      {fromArabic.value.additive}
                    </div>
                    <Caption1 className={styles.hint}>
                      这种写法（如用 IIII 代替 IV、用 VIIII 代替 IX）来自钟面与铭文，
                      属于加法式惯例，不是标准罗马数字，正式场合请不要使用。
                    </Caption1>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <section className="wt-surface" aria-label="罗马数字转阿拉伯数字">
          <div className="wt-surface__header">
            <NumberSymbol16Regular />
            <Text as="h2" size={300} weight="semibold">
              罗马数字 → 阿拉伯数字
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              只接受标准减法制写法，最长 {MAX_ROMAN_LENGTH} 位
            </Caption1>
          </div>
          <div className={`wt-surface__body ${styles.body}`}>
            <div className={styles.inputRow}>
              <input
                className="wt-inline-input"
                style={{ fontSize: 15, letterSpacing: '0.08em' }}
                value={romanInput}
                onChange={(event) => setRomanInput(event.target.value)}
                placeholder="例如 MCMXCIV（不区分大小写）"
                aria-label="罗马数字输入"
                spellCheck={false}
              />
              <Button
                appearance="subtle"
                onClick={() => setRomanInput('')}
                disabled={!romanInput}
              >
                清空
              </Button>
            </div>

            {!fromRoman.ok && (
              <MessageBar intent="error">
                <MessageBarBody>{fromRoman.error}</MessageBarBody>
              </MessageBar>
            )}

            {fromRoman.ok && (
              <>
                <div className={styles.resultRow}>
                  <Text className={styles.big}>{fromRoman.value.value}</Text>
                  <Tooltip content="复制阿拉伯数字" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      icon={
                        copied === 'arabic' ? (
                          <Checkmark16Regular />
                        ) : (
                          <Copy16Regular />
                        )
                      }
                      onClick={() =>
                        copy(String(fromRoman.value.value), 'arabic')
                      }
                      aria-label="复制阿拉伯数字"
                    />
                  </Tooltip>
                  {fromRoman.value.original !== fromRoman.value.roman && (
                    <Badge appearance="tint" color="brand" size="small">
                      输入是小写，已按标准写法 {fromRoman.value.roman} 识别
                    </Badge>
                  )}
                </div>

                <div className={styles.block}>
                  <Text size={200} weight="semibold">
                    拆解过程
                  </Text>
                  <div className={styles.expression}>
                    {fromRoman.value.roman} = {fromRoman.value.breakdown} ={' '}
                    {fromRoman.value.value}
                  </div>
                  <Caption1 className={styles.hint}>
                    逐项相加：{fromRoman.value.breakdownValues}
                  </Caption1>
                  <div className={styles.chips}>
                    {fromRoman.value.steps.map((step, index) => (
                      <Badge
                        key={`${step.symbol}-${index}`}
                        appearance="tint"
                        color="informative"
                        size="small"
                      >
                        {step.symbol} = {step.value}
                      </Badge>
                    ))}
                  </div>
                </div>

                {showAdditive && (
                  <div className={styles.additive}>
                    <div className={styles.additiveHead}>
                      <Warning16Regular />
                      <Text size={200} weight="semibold">
                        非标准：同一数值的加法式写法
                      </Text>
                      <Badge appearance="tint" color="warning" size="small">
                        不是标准写法，仅供对照
                      </Badge>
                    </div>
                    <div className={styles.expression}>
                      {fromRoman.value.additive}
                    </div>
                    <Caption1 className={styles.hint}>
                      解码时不会接受这种写法，上面的结果只来自标准形式。
                    </Caption1>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <MessageBar intent="info">
          <MessageBarBody>
            标准罗马数字用减法制表示 1–{MAX_VALUE}：同一符号最多连续出现 3 次，
            且只有 I 可在 V、X 之前，X 可在 L、C 之前，C 可在 D、M 之前表示减法。
            因此 IIII、VX、IL、IC 这类写法会被判为非法，而不是被猜一个结果。
            0 与负数没有标准罗马数字写法，4000 及以上需要加横线或其它变体约定，
            本工具不做这类臆造；本工具也<strong>不做</strong>把日期按特殊历法转成罗马数字
            （那是另一套约定，容易误导）。
          </MessageBarBody>
        </MessageBar>

        <Divider />
      </div>
    </>
  );
}
