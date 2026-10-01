import { useEffect, useState } from 'react';
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
  ArrowSync16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Info16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  DEFAULT_PRESET_ID,
  MAX_COUNT,
  MAX_PORT,
  MIN_PORT,
  PortError,
  PORT_RANGE_PRESETS,
  assertRange,
  describePort,
  generatePorts,
  presetById,
  portsToTsv,
  portsToText,
  type PortResult,
  type RandomSource,
} from './randomPortUtils';

const MONO = "'Cascadia Code', 'Cascadia Mono', Consolas, monospace";

/** Pseudo-id for the "type a range yourself" entry in the preset list. */
const CUSTOM_ID = 'custom';

/**
 * Builds the only environment-dependent piece: a uniform `[0, 1)` source.
 *
 * It lives in the component, not in the utility module, for the same reason the
 * ULID tool does it: the generators take their randomness as an argument so a
 * check can supply its own deterministic sequence.
 *
 * Two 32-bit words provide 53 random bits, which is one more than a double's
 * mantissa holds, so the result is uniform to within 2^-53 — thousands of times
 * finer than the 65536 possible ports. `Math.random()` is only the fallback for
 * origins where `crypto` is missing (plain http on a LAN address), and it is
 * used at its own 53-bit-ish resolution rather than pretending to be better.
 */
function createRandomSource(): RandomSource {
  if (globalThis.crypto?.getRandomValues) {
    const buffer = new Uint32Array(2);
    return () => {
      globalThis.crypto.getRandomValues(buffer);
      const high = buffer[0] >>> 5;
      const low = buffer[1] >>> 6;
      return (high * 67_108_864 + low) / 9_007_199_254_740_992;
    };
  }
  return () => Math.random();
}

/** Parses a decimal integer field, rejecting "1.5", "" and "-1". */
function parseIntegerText(text: string, label: string): number {
  const value = text.trim();
  if (!/^\d+$/.test(value)) {
    throw new PortError(`${label}必须是非负整数，收到 "${value}"`);
  }
  return Number.parseInt(value, 10);
}

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    width: '100%',
    padding: '16px',
    boxSizing: 'border-box',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  presetSelect: {
    minWidth: '300px',
  },
  numberField: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  numberInput: {
    width: '84px',
    flex: 'none',
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums',
  },
  countInput: {
    width: '72px',
    flex: 'none',
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums',
  },
  label: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: 'nowrap',
  },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '8px',
    overflow: 'hidden',
  },
  scroll: {
    maxHeight: '420px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontVariantNumeric: 'tabular-nums',
  },
  headCell: {
    textAlign: 'left',
    padding: '8px 12px',
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    position: 'sticky',
    top: 0,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  cell: {
    padding: '6px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: 'nowrap',
  },
  portCell: {
    fontFamily: MONO,
    fontWeight: 600,
    userSelect: 'all',
  },
  monoCell: {
    fontFamily: MONO,
    userSelect: 'all',
  },
  binaryCell: {
    fontFamily: MONO,
    letterSpacing: '0.04em',
    userSelect: 'all',
  },
  sectionHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
  },
  badgeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
  },
  footnote: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    padding: '10px 12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '8px',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
});

export function RandomPortTool() {
  const styles = useStyles();
  const [presetId, setPresetId] = useState<string>(DEFAULT_PRESET_ID);
  const [customMin, setCustomMin] = useState('1024');
  const [customMax, setCustomMax] = useState('2048');
  const [countText, setCountText] = useState('10');
  const [unique, setUnique] = useState(true);
  const [excludeCommon, setExcludeCommon] = useState(true);
  const [result, setResult] = useState<PortResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'none' | 'list' | 'tsv'>('none');

  const presetLabel =
    presetId === CUSTOM_ID
      ? '自定义范围'
      : (presetById(presetId)?.label ?? '自定义范围');

  /** Resolves the selected preset (or the typed range) into min/max. */
  const resolveRange = (): { min: number; max: number } => {
    if (presetId !== CUSTOM_ID) {
      const preset = presetById(presetId);
      if (preset) return { min: preset.min, max: preset.max };
    }
    const min = parseIntegerText(customMin, '最小端口');
    const max = parseIntegerText(customMax, '最大端口');
    assertRange(min, max);
    return { min, max };
  };

  const regenerate = () => {
    try {
      const { min, max } = resolveRange();
      const count = parseIntegerText(countText, '生成数量');
      setResult(generatePorts({ min, max, count, unique, excludeCommon }, createRandomSource()));
      setError(null);
      setCopied('none');
    } catch (caught) {
      if (caught instanceof PortError) {
        setError(caught.message);
        setResult(null);
        return;
      }
      throw caught;
    }
  };

  // Re-roll when a switch or the preset changes, so the table can never show
  // ports that contradict the controls above it. The text fields (count, custom
  // bounds) deliberately do not re-roll on every keystroke: the list would
  // churn while the value is still half typed. The button covers those.
  useEffect(() => {
    regenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, unique, excludeCommon]);

  const copy = async (kind: 'list' | 'tsv') => {
    if (!result) return;
    const ok = await copyText(kind === 'list' ? portsToText(result.ports) : portsToTsv(result.ports));
    setCopied(ok ? kind : 'none');
  };

  return (
    <div className="wt-surface">
      <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
        <div className={styles.stack}>
          <MessageBar intent="warning">
            <MessageBarBody>
              这里只生成<strong>端口号数字</strong>，不会、也无法检测端口是否真的空闲。浏览器不能向任意端口发起
              TCP / UDP 连接，所以本机哪些端口已被占用，这个页面无从得知；结果请自行用
              <code>ss -lntu</code>（Linux）或 <code>netstat -ano</code>（Windows）核实。
            </MessageBarBody>
          </MessageBar>

          <div className={styles.toolbar}>
            <Dropdown
              className={styles.presetSelect}
              aria-label="端口范围"
              value={presetLabel}
              selectedOptions={[presetId]}
              onOptionSelect={(_event, data) => {
                if (data.optionValue) setPresetId(data.optionValue);
              }}
            >
              {PORT_RANGE_PRESETS.map((preset) => (
                <Option key={preset.id} value={preset.id} text={preset.label}>
                  {preset.label}
                </Option>
              ))}
              <Option value={CUSTOM_ID} text="自定义范围">
                自定义范围
              </Option>
            </Dropdown>

            {presetId === CUSTOM_ID && (
              <div className={styles.numberField}>
                <span className={styles.label}>最小</span>
                <input
                  className={`wt-inline-input ${styles.numberInput}`}
                  aria-label="自定义范围的最小端口"
                  inputMode="numeric"
                  value={customMin}
                  onChange={(event) => setCustomMin(event.target.value)}
                />
                <span className={styles.label}>最大</span>
                <input
                  className={`wt-inline-input ${styles.numberInput}`}
                  aria-label="自定义范围的最大端口"
                  inputMode="numeric"
                  value={customMax}
                  onChange={(event) => setCustomMax(event.target.value)}
                />
                <Caption1 className={styles.hint}>{`允许 ${MIN_PORT}–${MAX_PORT}`}</Caption1>
              </div>
            )}

            <div className={styles.numberField}>
              <span className={styles.label}>数量</span>
              <input
                className={`wt-inline-input ${styles.countInput}`}
                aria-label="生成数量"
                inputMode="numeric"
                value={countText}
                onChange={(event) => setCountText(event.target.value)}
              />
              <Caption1 className={styles.hint}>{`最多 ${MAX_COUNT}`}</Caption1>
            </div>

            <Checkbox
              checked={unique}
              onChange={(_event, data) => setUnique(Boolean(data.checked))}
              label="互不重复"
            />
            <Checkbox
              checked={excludeCommon}
              onChange={(_event, data) => setExcludeCommon(Boolean(data.checked))}
              label="排除常见占用端口"
            />

            <Button appearance="primary" icon={<ArrowSync16Regular />} onClick={regenerate}>
              生成
            </Button>
          </div>

          {presetId !== CUSTOM_ID && (
            <Caption1 className={styles.hint}>{presetById(presetId)?.note ?? ''}</Caption1>
          )}

          {error && (
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          )}

          {!error && result && (
            <>
              <div className={styles.sectionHead}>
                <Text as="h2" size={300} weight="semibold">
                  生成结果
                </Text>
                <div className={styles.badgeRow}>
                  <Badge appearance="filled" color="brand">{`${result.ports.length} 个端口`}</Badge>
                  <Badge appearance="tint" color="informative">{`范围内可选 ${result.available} 个`}</Badge>
                  {excludeCommon && (
                    <Badge appearance="outline">{`已跳过 ${result.excluded.length} 个常见端口`}</Badge>
                  )}
                  {!unique && (
                    <Badge appearance="tint" color="warning">
                      允许重复
                    </Badge>
                  )}
                </div>
                <div className={styles.badgeRow}>
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={copied === 'list' ? <Checkmark16Regular /> : <Copy16Regular />}
                    onClick={() => void copy('list')}
                  >
                    {copied === 'list' ? '已复制' : '复制端口列表'}
                  </Button>
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={copied === 'tsv' ? <Checkmark16Regular /> : <Copy16Regular />}
                    onClick={() => void copy('tsv')}
                  >
                    {copied === 'tsv' ? '已复制' : '复制为表格'}
                  </Button>
                </div>
              </div>

              <div className={styles.card}>
                <div className={styles.scroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.headCell}>#</th>
                        <th className={styles.headCell}>端口</th>
                        <th className={styles.headCell}>所属范围（IANA）</th>
                        <th className={styles.headCell}>十六进制</th>
                        <th className={styles.headCell}>二进制</th>
                        <th className={styles.headCell}>常见服务</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.ports.map((port, index) => {
                        const described = describePort(port);
                        return (
                          <tr key={`${port}-${index}`}>
                            <td className={styles.cell}>{index + 1}</td>
                            <td className={`${styles.cell} ${styles.portCell}`}>{port}</td>
                            <td className={styles.cell}>
                              {`${described.portClass.label}（${described.portClass.ianaRange}）`}
                            </td>
                            <td className={`${styles.cell} ${styles.monoCell}`}>{described.hex}</td>
                            <td className={`${styles.cell} ${styles.binaryCell}`}>{described.binary}</td>
                            <td className={styles.cell}>
                              {described.service ? (
                                <>
                                  {described.service}
                                  {described.ianaName ? (
                                    <Caption1 className={styles.hint}>{`（IANA: ${described.ianaName}）`}</Caption1>
                                  ) : null}
                                </>
                              ) : (
                                <span className={styles.hint}>—（表中未收录）</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={styles.footnote}>
                <Info16Regular style={{ flex: 'none', marginTop: 2 }} />
                <Caption1>
                  IANA 把 16 位端口空间分成三段（RFC 6335 第 6 节）：系统端口 / 知名端口 0–1023（绑定通常需要特权）、
                  用户端口 / 注册端口 1024–49151、动态 / 私有端口 49152–65535（内核从这里挑临时源端口，从不分配）。
                  其中 0 号端口被保留，不能作为实际连接端点。 「排除常见占用端口」用的是
                  22 / 80 / 443 / 3306 / 5432 / 6379 / 8080 这类常见默认值清单，
                  它们只是「大家默认这么用」的约定，不代表本机真的占用了这些端口 —— 反过来，清单以外的端口也可能已被占用。
                  本工具不扫端口、不查服务版本，也不做端口可用性检测。
                </Caption1>
              </div>
            </>
          )}

          <Divider />
          <Caption1 className={styles.hint}>
            同一范围下每次点「生成」都会重新取随机数；「互不重复」用部分洗牌实现（不需要的候选会被丢掉而不是反复重抽），
            因此当请求数量超过范围内可用端口数时会直接报错，而不是一直转圈。十六进制按 4 位补齐（80 → 0x0050），
            二进制按 4 位一组显示（80 → 0000 0000 0101 0000），因为端口在 TCP / UDP 头里就是大端 16 位字段。
          </Caption1>
        </div>
      </div>
    </div>
  );
}
