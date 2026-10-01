import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Slider,
  Switch,
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
  ArrowSync16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Key16Regular,
  Shield16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  AMBIGUOUS,
  CHAR_SETS,
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  WORD_LIST_SIZE,
  generatePassphrase,
  generatePassword,
  judgeStrength,
  type CharSetKey,
  type PassphraseOptions,
  type PasswordOptions,
} from './passwordUtils';

const SET_LABELS: Array<{ key: CharSetKey; label: string }> = [
  { key: 'lowercase', label: '小写字母 a-z' },
  { key: 'uppercase', label: '大写字母 A-Z' },
  { key: 'digits', label: '数字 0-9' },
  { key: 'symbols', label: '符号 !@#$…' },
];

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
  hero: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '20px',
    alignItems: 'stretch',
  },
  value: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: 'clamp(17px, 2.4vw, 26px)',
    fontWeight: 600,
    letterSpacing: '0.02em',
    wordBreak: 'break-all',
    userSelect: 'all',
    textAlign: 'center',
    padding: '10px 0',
    lineHeight: 1.45,
  },
  meter: {
    display: 'flex',
    gap: '4px',
    width: '100%',
  },
  meterCell: {
    flex: '1 1 0',
    height: '6px',
    borderRadius: '3px',
    backgroundColor: tokens.colorNeutralBackground4,
  },
  meterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  options: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '14px',
    width: '100%',
  },
  optionGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  setRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '14px',
  },
  batch: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  batchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '7px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  batchValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  batchIndex: {
    flex: 'none',
    width: '26px',
    color: tokens.colorNeutralForeground4,
    fontVariantNumeric: 'tabular-nums',
    fontSize: '12px',
  },
});

type Mode = 'password' | 'passphrase';

export function PasswordGeneratorTool() {
  const styles = useStyles();
  const toasterId = useId('pw-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [mode, setMode] = useState<Mode>('password');
  const [options, setOptions] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS);
  const [phraseOptions, setPhraseOptions] = useState<PassphraseOptions>(
    DEFAULT_PASSPHRASE_OPTIONS,
  );
  const [batch, setBatch] = useState(5);
  const [copied, setCopied] = useState<string | null>(null);

  // Generated values live in state so they persist across option tweaks; only
  // an explicit regenerate (or a mode/option change) replaces them.
  const [values, setValues] = useState<string[]>([]);
  const [entropy, setEntropy] = useState(0);

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

  const regenerate = useCallback(() => {
    const produced: string[] = [];
    let bits = 0;

    for (let index = 0; index < batch; index += 1) {
      const result =
        mode === 'password'
          ? generatePassword(options)
          : generatePassphrase(phraseOptions);

      if (!result.ok) {
        notify(result.error);
        return;
      }
      produced.push(result.value);
      bits = result.entropyBits;
    }

    setValues(produced);
    setEntropy(bits);
  }, [batch, mode, options, phraseOptions, notify]);

  // Generate on mount and whenever the configuration changes, so the shown
  // value always matches the options.
  useEffect(() => {
    regenerate();
    // Intentionally keyed on the configuration only; `regenerate` is stable
    // enough for this purpose and depending on it would re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, options, phraseOptions, batch]);

  const verdict = useMemo(() => judgeStrength(entropy), [entropy]);

  const meterFilled = Math.min(4, Math.max(0, Math.ceil(entropy / 30)));

  const toggleSet = useCallback((key: CharSetKey, checked: boolean) => {
    setOptions((current) => ({
      ...current,
      sets: checked
        ? [...new Set([...current.sets, key])]
        : current.sets.filter((item) => item !== key),
    }));
  }, []);

  const copyAll = useCallback(async () => {
    const ok = await copyText(values.join('\n'));
    if (ok) notify(`已复制 ${values.length} 条`);
    else notify('复制失败');
  }, [values, notify]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Switch
            checked={mode === 'passphrase'}
            onChange={(_, data) =>
              setMode(data.checked ? 'passphrase' : 'password')
            }
            label={mode === 'password' ? '当前：随机字符' : '当前：单词短语'}
          />
          <Button
            appearance="primary"
            icon={<ArrowSync16Regular />}
            onClick={regenerate}
          >
            重新生成
          </Button>
          <span className={styles.spacer} />
          <Caption1 className={styles.hint}>一次生成</Caption1>
          <Dropdown
            style={{ minWidth: 92 }}
            value={String(batch)}
            selectedOptions={[String(batch)]}
            onOptionSelect={(_, data) => setBatch(Number(data.optionValue))}
            aria-label="生成数量"
          >
            {[1, 3, 5, 10, 20].map((count) => (
              <Option key={count} value={String(count)} text={`${count} 条`}>
                {count} 条
              </Option>
            ))}
          </Dropdown>
          <Tooltip content="复制全部" relationship="label" withArrow>
            <Button
              appearance="secondary"
              icon={<Copy16Regular />}
              onClick={() => void copyAll()}
              disabled={values.length === 0}
            >
              复制全部
            </Button>
          </Tooltip>
        </div>

        <MessageBar intent="info">
          <MessageBarBody>
            使用 <code>crypto.getRandomValues</code> 生成，并采用拒绝采样消除取模偏差，
            因此字符分布是均匀的（测试里用两万次抽样验证过）。强度以熵（比特）表示，
            而不是主观评分：熵 = 长度 × log₂(字符池大小)，它直接决定暴力破解的下界。
            生成过程完全在本地，不产生任何网络请求，也不写入 localStorage。
          </MessageBarBody>
        </MessageBar>

        <section className="wt-surface" aria-label="生成结果">
          <div className="wt-surface__header">
            <Key16Regular />
            <Text as="h2" size={300} weight="semibold">
              生成结果
            </Text>
            <Badge appearance="tint" color={verdict.tone} size="small">
              {verdict.label} · {entropy} bit
            </Badge>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>{verdict.advice}</Caption1>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.hero}>
              <div className={styles.meter}>
                {[0, 1, 2, 3].map((index) => (
                  <span
                    key={index}
                    className={styles.meterCell}
                    style={{
                      backgroundColor:
                        index < meterFilled
                          ? verdict.tone === 'danger'
                            ? tokens.colorPaletteRedForeground1
                            : verdict.tone === 'warning'
                              ? tokens.colorPaletteMarigoldForeground1
                              : tokens.colorPaletteGreenForeground1
                          : tokens.colorNeutralBackground4,
                    }}
                  />
                ))}
              </div>

              {values.length === 1 && (
                <>
                  <Text className={styles.value}>{values[0]}</Text>
                  <div className={styles.meterRow} style={{ justifyContent: 'center' }}>
                    <Button
                      appearance="secondary"
                      icon={
                        copied === 'single' ? (
                          <Checkmark16Regular />
                        ) : (
                          <Copy16Regular />
                        )
                      }
                      onClick={() => void copy(values[0], 'single')}
                    >
                      复制
                    </Button>
                  </div>
                </>
              )}

              {values.length > 1 && (
                <div className={styles.batch}>
                  {values.map((value, index) => (
                    <div key={value} className={styles.batchRow}>
                      <Caption1 className={styles.batchIndex}>
                        {index + 1}
                      </Caption1>
                      <span className={styles.batchValue}>{value}</span>
                      <Tooltip content="复制" relationship="label" withArrow>
                        <Button
                          appearance="subtle"
                          size="small"
                          icon={
                            copied === `v${index}` ? (
                              <Checkmark16Regular />
                            ) : (
                              <Copy16Regular />
                            )
                          }
                          onClick={() => void copy(value, `v${index}`)}
                          aria-label="复制该条"
                        />
                      </Tooltip>
                    </div>
                  ))}
                </div>
              )}

              {values.length === 0 && (
                <Caption1 className={styles.hint} style={{ textAlign: 'center' }}>
                  选择参数后点击「重新生成」
                </Caption1>
              )}
            </div>
          </div>
        </section>

        <section className="wt-surface" aria-label="生成选项">
          <div className="wt-surface__header">
            <Shield16Regular />
            <Text as="h2" size={300} weight="semibold">
              选项
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              {mode === 'password'
                ? `字符池 ${new Set(options.sets.flatMap((key) => [...CHAR_SETS[key]])).size} 个`
                : `词表 ${WORD_LIST_SIZE} 个单词（公开词表，强度来自单词数量）`}
            </Caption1>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            {mode === 'password' ? (
              <div className={styles.options}>
                <div className={styles.optionGroup}>
                  <Caption1 className={styles.hint}>
                    长度：{options.length}
                  </Caption1>
                  <Slider
                    min={4}
                    max={128}
                    value={options.length}
                    onChange={(_, data) =>
                      setOptions((current) => ({ ...current, length: data.value }))
                    }
                  />
                </div>

                <div className={styles.setRow}>
                  {SET_LABELS.map((item) => (
                    <Checkbox
                      key={item.key}
                      checked={options.sets.includes(item.key)}
                      onChange={(_, data) =>
                        toggleSet(item.key, Boolean(data.checked))
                      }
                      label={item.label}
                    />
                  ))}
                </div>

                <div className={styles.setRow}>
                  <Checkbox
                    checked={options.requireEachSet}
                    onChange={(_, data) =>
                      setOptions((current) => ({
                        ...current,
                        requireEachSet: Boolean(data.checked),
                      }))
                    }
                    label="每类至少包含一个字符"
                  />
                  <Tooltip
                    content={`排除易混淆字符：${AMBIGUOUS}`}
                    relationship="description"
                    withArrow
                  >
                    <Checkbox
                      checked={options.excludeAmbiguous}
                      onChange={(_, data) =>
                        setOptions((current) => ({
                          ...current,
                          excludeAmbiguous: Boolean(data.checked),
                        }))
                      }
                      label="排除易混淆字符（0/O、1/l/I…）"
                    />
                  </Tooltip>
                </div>
              </div>
            ) : (
              <div className={styles.options}>
                <div className={styles.optionGroup}>
                  <Caption1 className={styles.hint}>
                    单词数量：{phraseOptions.words}
                  </Caption1>
                  <Slider
                    min={2}
                    max={12}
                    value={phraseOptions.words}
                    onChange={(_, data) =>
                      setPhraseOptions((current) => ({
                        ...current,
                        words: data.value,
                      }))
                    }
                  />
                </div>

                <div className={styles.setRow}>
                  <Checkbox
                    checked={phraseOptions.capitalize}
                    onChange={(_, data) =>
                      setPhraseOptions((current) => ({
                        ...current,
                        capitalize: Boolean(data.checked),
                      }))
                    }
                    label="首字母大写"
                  />
                  <Checkbox
                    checked={phraseOptions.includeNumber}
                    onChange={(_, data) =>
                      setPhraseOptions((current) => ({
                        ...current,
                        includeNumber: Boolean(data.checked),
                      }))
                    }
                    label="插入一个数字"
                  />
                </div>

                <div className={styles.optionGroup}>
                  <Caption1 className={styles.hint}>分隔符</Caption1>
                  <Dropdown
                    style={{ minWidth: 160 }}
                    value={
                      phraseOptions.separator === '-'
                        ? '连字符 -'
                        : phraseOptions.separator === '.'
                          ? '点 .'
                          : phraseOptions.separator === '_'
                            ? '下划线 _'
                            : '空格'
                    }
                    selectedOptions={[phraseOptions.separator]}
                    onOptionSelect={(_, data) =>
                      setPhraseOptions((current) => ({
                        ...current,
                        separator: data.optionValue ?? '-',
                      }))
                    }
                    aria-label="分隔符"
                  >
                    <Option value="-" text="连字符 -">连字符 -</Option>
                    <Option value="." text="点 .">点 .</Option>
                    <Option value="_" text="下划线 _">下划线 _</Option>
                    <Option value=" " text="空格">空格</Option>
                  </Dropdown>
                </div>
              </div>
            )}
          </div>
        </section>

        <MessageBar intent="warning">
          <MessageBarBody>
            生成后请用密码管理器保存。本工具不存储任何生成结果，
            刷新页面即消失（这是有意的：浏览器 localStorage 不是放密钥的地方）。
          </MessageBarBody>
        </MessageBar>

        <Divider />
      </div>
    </>
  );
}
