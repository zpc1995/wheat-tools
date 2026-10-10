import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
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
  NetworkAdapter16Regular,
  ShieldTask16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  DEFAULT_MAC_OPTIONS,
  MAC_LENGTH,
  MULTICAST_BIT,
  LOCAL_BIT,
  describePrefixSource,
  formatAllStyles,
  formatMac,
  generateMacBatch,
  generateWithoutLocalBit,
  normaliseMacText,
  readFlags,
  splitOuiAndNic,
  type MacBytes,
  type MacOptions,
} from './macGeneratorUtils';

const MONO = "'Cascadia Code', 'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace";

/** Bytes drawn from the environment; the utils themselves take bytes as a parameter. */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  // `crypto` is missing on plain-http LAN origins, where the tool would
  // otherwise be unusable. A weaker source is better than a dead button.
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

const useStyles = makeStyles({
  column: {
    flexDirection: 'column',
  },
  stage: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    alignItems: 'center',
    textAlign: 'center',
    padding: '22px 20px 18px',
  },
  big: {
    fontFamily: MONO,
    fontSize: 'clamp(20px, 3.4vw, 32px)',
    fontWeight: 600,
    letterSpacing: '0.02em',
    wordBreak: 'break-all',
    fontVariantNumeric: 'tabular-nums',
    userSelect: 'all',
  },
  caption: {
    color: tokens.colorNeutralForeground3,
  },
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    paddingTop: '6px',
  },
  prefixInput: {
    width: '220px',
    fontFamily: MONO,
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
    width: '150px',
    color: tokens.colorNeutralForeground3,
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  flags: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
    gap: '10px',
    width: '100%',
    padding: '14px',
  },
  flagCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '12px 14px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '6px',
    background: tokens.colorNeutralBackground2,
  },
  flagTitle: {
    fontFamily: MONO,
    fontWeight: 600,
  },
  note: {
    padding: '0 14px 14px',
    color: tokens.colorNeutralForeground3,
  },
  batchBox: {
    width: '100%',
    minHeight: '160px',
    maxHeight: '300px',
    fontVariantNumeric: 'tabular-nums',
  },
  pad: {
    padding: '12px 14px',
    width: '100%',
  },
});

export function MacGeneratorTool() {
  const styles = useStyles();
  const toasterId = useId('mac-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [prefix, setPrefix] = useState(DEFAULT_MAC_OPTIONS.prefix);
  const [multicast, setMulticast] = useState(DEFAULT_MAC_OPTIONS.multicast);
  const [locallyAdministered, setLocallyAdministered] = useState(
    DEFAULT_MAC_OPTIONS.locallyAdministered,
  );
  const [count, setCount] = useState(1);
  const [bytes, setBytes] = useState<MacBytes>([]);
  const [batch, setBatch] = useState<MacBytes[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [counterexample, setCounterexample] = useState<MacBytes | null>(null);
  const didInit = useRef(false);

  const options: MacOptions = useMemo(
    () => ({ prefix, multicast, locallyAdministered }),
    [prefix, multicast, locallyAdministered],
  );

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

  const markCopied = useCallback((key: string) => {
    setCopied(key);
    window.setTimeout(() => {
      setCopied((current) => (current === key ? null : current));
    }, 1500);
  }, []);

  const generate = useCallback(
    (amount: number, current: MacOptions) => {
      const generated = generateMacBatch(amount, current, randomBytes(amount * MAC_LENGTH));
      setBatch(generated);
      setBytes(generated[generated.length - 1]);
      setCounterexample(null);
      return generated;
    },
    [],
  );

  // One address on mount; the ref keeps StrictMode's double-invoked effect from
  // drawing twice.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    generate(1, DEFAULT_MAC_OPTIONS);
  }, [generate]);

  /** Parsing feedback for the prefix field, so a typo is visible before generating. */
  const prefixHint = useMemo(() => describePrefixSource(options), [options]);

  const prefixValid = useMemo(() => {
    if (prefix.trim() === '') return true;
    return normaliseMacText(prefix.trim()) !== null;
  }, [prefix]);

  const current = bytes.length === MAC_LENGTH ? bytes : null;
  const flags = useMemo(() => (current ? readFlags(current) : null), [current]);
  const parts = useMemo(() => (current ? splitOuiAndNic(current) : null), [current]);
  const formatted = useMemo(() => (current ? formatAllStyles(current) : []), [current]);

  const copyValue = useCallback(
    async (value: string, key: string) => {
      const done = await copyText(value);
      if (done) {
        markCopied(key);
        notify('已复制');
      } else {
        notify('复制失败，请手动选择', 'error');
      }
    },
    [markCopied, notify],
  );

  const showCounterexample = useCallback(() => {
    // The same random bytes, generated the naive way. It exists purely to make
    // the collision argument concrete on screen.
    const naive = generateWithoutLocalBit(DEFAULT_MAC_OPTIONS, randomBytes(MAC_LENGTH));
    setCounterexample(naive);
  }, []);

  const activeOptions: MacOptions = { ...options, prefix: prefixValid ? prefix : '' };

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      {/* -------- Generate -------- */}
      <section className="wt-surface" aria-label="生成 MAC 地址">
        <div className="wt-surface__header">
          <NetworkAdapter16Regular />
          <Text as="h2" size={300} weight="semibold">
            生成 MAC 地址
          </Text>
          <Badge appearance="tint" color="brand" size="small">
            48 位 · 6 字节
          </Badge>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Caption1 className={styles.caption}>默认：单播 + 本地管理</Caption1>
          </div>
        </div>

        <div className={`wt-surface__body ${styles.column}`}>
          <div className={styles.stage}>
            <Text as="p" className={styles.big} aria-live="polite" aria-label="当前 MAC 地址">
              {current ? formatMac(current, 'colon') : '—'}
            </Text>
            <Caption1 className={styles.caption}>
              OUI {parts ? parts.oui : '—'} · NIC {parts ? parts.nic : '—'}
            </Caption1>

            <div className={styles.controls}>
              <Button
                appearance="primary"
                size="large"
                icon={<ArrowSync16Regular />}
                onClick={() => generate(count, activeOptions)}
              >
                生成
              </Button>
              <Button
                appearance="secondary"
                size="large"
                icon={copied === 'latest' ? <Checkmark16Regular /> : <Copy16Regular />}
                onClick={() => current && copyValue(formatMac(current, 'colon'), 'latest')}
                disabled={!current}
              >
                复制冒号格式
              </Button>
            </div>
          </div>

          <Divider />

          <div className={styles.rows}>
            <div className={styles.row}>
              <Text className={styles.rowLabel}>OUI 前缀</Text>
              <input
                className={`wt-inline-input ${styles.prefixInput}`}
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
                placeholder="留空 = 全随机，如 00:1A:2B"
                aria-label="OUI 前缀（3 字节，可留空）"
                spellCheck={false}
              />
            </div>

            <div className={styles.row}>
              <Text className={styles.rowLabel}>地址类型（I/G 位）</Text>
              <Switch
                checked={multicast}
                onChange={(_, data) => setMulticast(data.checked)}
                label={multicast ? '组播（I/G = 1）' : '单播（I/G = 0）'}
              />
              <Caption1 className={styles.caption}>单播是设备地址的正常取值</Caption1>
            </div>

            <div className={styles.row}>
              <Text className={styles.rowLabel}>本地管理（U/L 位）</Text>
              <Switch
                checked={locallyAdministered}
                onChange={(_, data) => setLocallyAdministered(data.checked)}
                label={locallyAdministered ? '本地管理（U/L = 1，推荐）' : '全球唯一（U/L = 0）'}
              />
              <Caption1 className={styles.caption}>
                关掉就声称自己拥有某个 IEEE 注册的厂商 OUI
              </Caption1>
            </div>

            <div className={styles.row}>
              <Text className={styles.rowLabel}>批量数量</Text>
              <input
                className={`wt-inline-input ${styles.prefixInput}`}
                type="number"
                min={1}
                max={1000}
                value={count}
                onChange={(event) =>
                  setCount(Math.min(1000, Math.max(1, Number(event.target.value) || 1)))
                }
                aria-label="批量生成的地址数量"
              />
              <Caption1 className={styles.caption}>最多 1000 个</Caption1>
            </div>
          </div>

          <div className={styles.pad}>
            {!prefixValid ? (
              <MessageBar intent="error">
                <MessageBarBody>
                  前缀不是 6 位十六进制（可带 : - . 分隔），本次生成会忽略它。
                </MessageBarBody>
              </MessageBar>
            ) : (
              <Caption1 className={styles.caption}>{prefixHint}</Caption1>
            )}
          </div>
        </div>
      </section>

      {/* -------- Formats -------- */}
      <section className="wt-surface" aria-label="各种输出格式">
        <div className="wt-surface__header">
          <NetworkAdapter16Regular />
          <Text as="h2" size={300} weight="semibold">
            输出格式
          </Text>
          <Caption1 className={styles.caption}>同一串字节的四种写法</Caption1>
        </div>

        <div className={`wt-surface__body ${styles.column}`}>
          <div className={styles.rows}>
            {formatted.map((entry) => (
              <div key={entry.style} className={styles.row}>
                <Text className={styles.rowLabel}>{entry.label}</Text>
                <Text className={styles.rowValue}>{entry.value}</Text>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={copied === entry.style ? <Checkmark16Regular /> : <Copy16Regular />}
                  onClick={() => copyValue(entry.value, entry.style)}
                  aria-label={`复制 ${entry.label} 格式`}
                />
              </div>
            ))}
            {!current && (
              <div className={styles.row}>
                <Text className={styles.caption}>先生成一个地址。</Text>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* -------- Flag decode -------- */}
      <section className="wt-surface" aria-label="标志位解读">
        <div className="wt-surface__header">
          <ShieldTask16Regular />
          <Text as="h2" size={300} weight="semibold">
            首字节两个标志位
          </Text>
          <Caption1 className={styles.caption}>
            地址的前 3 字节是 OUI，后 3 字节是 NIC
          </Caption1>
        </div>

        <div className={`wt-surface__body ${styles.column}`}>
          <div className={styles.flags}>
            <div className={styles.flagCard}>
              <Text className={styles.flagTitle}>bit 0 · I/G</Text>
              <Text>{flags ? flags.individualLabel : '—'}</Text>
              <Caption1 className={styles.caption}>
                掩码 0x{MULTICAST_BIT.toString(16).padStart(2, '0')}：首字节 &amp; 0x01 = 1
                即组播
              </Caption1>
            </div>
            <div className={styles.flagCard}>
              <Text className={styles.flagTitle}>bit 1 · U/L</Text>
              <Text>{flags ? flags.administrationLabel : '—'}</Text>
              <Caption1 className={styles.caption}>
                掩码 0x{LOCAL_BIT.toString(16).padStart(2, '0')}：首字节 &amp; 0x02 = 1
                即本地管理
              </Caption1>
            </div>
            <div className={styles.flagCard}>
              <Text className={styles.flagTitle}>OUI / NIC</Text>
              <Text>前 3 字节 OUI：{parts ? parts.oui : '—'}</Text>
              <Text>后 3 字节 NIC：{parts ? parts.nic : '—'}</Text>
              <Caption1 className={styles.caption}>
                首字节 {current ? `0x${current[0].toString(16).padStart(2, '0')}` : '—'}
                ，低 2 位是标志位而非地址的一部分
              </Caption1>
            </div>
          </div>

          <div className={styles.note}>
            <Text>{flags ? flags.note : ''}</Text>
          </div>

          <Divider />

          <div className={styles.pad}>
            <Tooltip
              content="用同样的随机字节生成一个不置 U/L 位的地址，看看它落进哪个厂商的号段"
              relationship="description"
              withArrow
            >
              <Button appearance="subtle" onClick={showCounterexample}>
                演示：不置本地管理位会发生什么
              </Button>
            </Tooltip>
          </div>

          {counterexample && (
            <div className={styles.pad}>
              <Text className={styles.rowValue}>
                同一随机源、未置 U/L 位：{formatMac(counterexample, 'colon')}
              </Text>
              <Caption1 className={styles.caption}>
                它的首字节低 2 位是 {counterexample[0] & 0x03}，即声称这段前缀来自 IEEE
                分配给某厂商的号段。两次生成碰上同一个真实 OUI 的概率随地址数量线性增长，
                而置上 U/L 位（首字节末位为 0b10）后这种撞车在定义上就不可能发生。
              </Caption1>
            </div>
          )}
        </div>
      </section>

      {/* -------- Batch -------- */}
      {batch.length > 1 && (
        <section className="wt-surface" aria-label="批量结果">
          <div className="wt-surface__header">
            <NetworkAdapter16Regular />
            <Text as="h2" size={300} weight="semibold">
              批量结果
            </Text>
            <Caption1 className={styles.caption}>{batch.length} 个地址</Caption1>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '2px' }}>
              <Button
                appearance="subtle"
                size="small"
                icon={copied === 'batch' ? <Checkmark16Regular /> : <Copy16Regular />}
                onClick={() =>
                  copyValue(
                    batch.map((item) => formatMac(item, 'colon')).join('\n'),
                    'batch',
                  )
                }
              >
                {copied === 'batch' ? '已复制' : '复制全部'}
              </Button>
            </div>
          </div>
          <div className={`wt-surface__body ${styles.column}`}>
            <textarea
              className={`wt-code-area ${styles.batchBox}`}
              value={batch.map((item) => formatMac(item, 'colon')).join('\n')}
              readOnly
              aria-label="批量生成的 MAC 地址"
              spellCheck={false}
            />
          </div>
        </section>
      )}
    </>
  );
}
